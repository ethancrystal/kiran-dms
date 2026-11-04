/**
 * Invitations and salon membership (migration 20261105100000, slice 1, P1-18; D-39, spec section 3).
 * The office invites a rep or a salon; the token is random, stored only as its sha256, single use,
 * 7 days, bound to the invited email, and redeemed only from a session that proved that email with
 * the emailed code. Redeeming creates the rep's profile or the salon's membership, never a role for a
 * salon. Tested as real signed-in roles, including a login with nothing redeemed.
 */
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  errorOf,
  fx,
  MANAGER,
  MANAGER_AAL1,
  OWNER,
  OWNER_AAL1,
  REP_A,
  REP_A_WRONG_DEVICE,
  run,
  SUSPENDED,
  sqlstate,
  type Who,
} from "./helpers/db";
import {
  ALL_RELATIONS,
  asLogin,
  asLoginCode,
  asLoginError,
  asLoginRows,
  type Login,
  newLogin,
  quote,
  tag,
  uuid,
} from "./helpers/invite";

const C = { commit: true };
const DENIED = "42501";
const BAD_INPUT = "22023";
const WRONG_STATE = "55000";
const DUPLICATE = "23505";
const TOKEN_LENGTH = 64; // 32 random bytes, in hex
const HEX_DIGITS = "0123456789abcdef";
const SEVEN_DAYS_MS = 604_800_000;
const MINUTE_MS = 60_000;
const SWEEP_MINIMUM = 40; // our five schemas hold more relations than this (49 at slice 1); a broken sweep query does not
const NOT_A_TOKEN = "0".repeat(TOKEN_LENGTH);
const NOT_FOR_YOU = "does not exist or was sent to another email";

const T = uuid(),
  AREA = uuid();
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const isToken = (t: string | null) => t?.length === TOKEN_LENGTH && [...t].every((c) => HEX_DIGITS.includes(c));

type Args = {
  client?: string;
  kind?: string;
  name?: string;
  email?: string;
  salon?: string | null;
  newSalon?: string | null;
  newName?: string | null;
  newType?: string | null;
  newArea?: string | null;
};
const inviteSql = (a: Args = {}) => `select app.office_invite(${quote(a.client ?? uuid())}, ${quote(a.kind ?? "rep")},
  ${quote(a.name ?? "[Test] Invitee")}, ${quote(a.email ?? `invitee.${tag()}@example.test`)}, ${quote(a.salon ?? null)},
  ${quote(a.newSalon ?? null)}, ${quote(a.newName ?? null)}, ${quote(a.newType ?? null)}, ${quote(a.newArea ?? null)}) as r`;
type Invitation = {
  id: string;
  kind: string;
  email: string;
  full_name: string;
  salon_id: string | null;
  status: string;
  expires_at: string;
  token: string | null;
};
const invite = async (who: Who, a: Args = {}) => (await run<{ r: Invitation }>(who, inviteSql(a), [], C)).rows[0].r;
const codeOf = (who: Who, a: Args = {}) => sqlstate(who, inviteSql(a));

const makeSalon = async () => {
  const id = uuid();
  await run(
    MANAGER,
    "select app.create_salon($1, $2, 'ladies_parlor', $3, 'manual')",
    [id, `[Test] Invited salon ${tag()}`, AREA],
    C,
  );
  return id;
};
const redeemSql = (token: string) => `select app.redeem_invitation(${quote(token)}) as r`;
const redeem = async (l: Login, token: string, commit = true) =>
  (await asLoginRows(l, redeemSql(token), { commit }))[0].r as { kind: string };
/** An expired copy of the invitation inside one rolled-back transaction, then the rest of the script. */
const expired = (id: string, then: string) => `
  alter table public.invitation disable trigger invitation_guard;
  update public.invitation set expires_at = now() - interval '1 second' where id = '${id}';
  alter table public.invitation enable trigger invitation_guard;
  ${then}`;
const invitationRow = async (id: string) =>
  (await run("postgres", "select * from public.invitation where id = $1", [id])).rows[0];
const verify = async () => (await run("postgres", "select * from control.verify_audit_chain()")).rows[0];

const REFUSED: Array<[string, Who]> = [
  ["repA", REP_A],
  ["repA on a wrong device", REP_A_WRONG_DEVICE],
  ["a suspended rep", SUSPENDED],
  ["manager without MFA", MANAGER_AAL1],
  ["owner without MFA", OWNER_AAL1],
];

beforeAll(async () => {
  await run(MANAGER, "select app.office_upsert_territory($1, $2)", [T, `[Test] Invitations ${tag()}`], C);
  await run(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Invitations area')", [AREA, T], C);
});

describe("the office invites a rep or a salon", () => {
  it.each([
    ["manager", MANAGER],
    ["owner", OWNER],
  ])("%s invites a rep: the token is shown once and only its sha256 is stored", async (_n, who) => {
    const i = await invite(who, { name: "[Test] New rep" });
    expect(isToken(i.token)).toBe(true);
    expect(i.kind).toBe("rep");
    expect(i.status).toBe("pending");
    expect(Math.abs(new Date(i.expires_at).getTime() - Date.now() - SEVEN_DAYS_MS)).toBeLessThan(MINUTE_MS);
    const row = await invitationRow(i.id);
    expect(row.token_hash).toBe(hash(i.token as string));
    expect(JSON.stringify(row)).not.toContain(i.token);
    const audit = await run(
      "postgres",
      "select e.after, e.purpose from control.audit_event e where e.table_name = 'public.invitation' and e.row_id = $1",
      [i.id],
    );
    expect(audit.rows.length).toBe(1);
    expect(JSON.stringify(audit.rows)).not.toContain(i.token);
  });

  it("two invitations get different tokens", async () => {
    const [a, b] = [await invite(MANAGER), await invite(MANAGER)];
    expect(a.token).not.toBe(b.token);
  });

  it("the email is stored in lower case, trimmed", async () => {
    const i = await invite(MANAGER, { email: `  MixedCase.${tag()}@Example.TEST ` });
    expect(i.email).toBe(i.email.trim().toLowerCase());
  });

  it("a salon invitation names an existing approved salon", async () => {
    const salon = await makeSalon();
    const i = await invite(MANAGER, { kind: "salon", salon, name: "[Test] Salon owner" });
    expect(i.kind).toBe("salon");
    expect(i.salon_id).toBe(salon);
  });

  it("a salon invitation can create the salon, approved, in the same call", async () => {
    const newSalon = uuid();
    const i = await invite(MANAGER, {
      kind: "salon",
      newSalon,
      newName: "[Test] Brand new salon",
      newType: "unisex",
      newArea: AREA,
    });
    expect(i.salon_id).toBe(newSalon);
    const s = (
      await run("postgres", "select name, approval_status, created_by, source, stage from public.salon where id = $1", [newSalon])
    ).rows[0];
    expect(s).toMatchObject({
      name: "[Test] Brand new salon",
      approval_status: "approved",
      created_by: fx.manager.id,
      source: "manual",
      stage: "prospect",
    });
  });

  it("a new salon with a bad area writes nothing (no partial write)", async () => {
    const newSalon = uuid();
    expect(
      await codeOf(MANAGER, { kind: "salon", newSalon, newName: "[Test] No area", newType: "unisex", newArea: uuid() }),
    ).toBe(BAD_INPUT);
    expect((await run("postgres", "select 1 from public.salon where id = $1", [newSalon])).rows).toEqual([]);
  });

  it.each([
    ["no client id", { client: "" }],
    ["a one-letter name", { name: "x" }],
    ["a tab for a name", { name: "\t\t" }],
    ["no at sign", { email: "not-an-email" }],
    ["an unknown kind", { kind: "agent" }],
    ["a rep with a salon", { kind: "rep", salon: uuid() }],
    ["a salon with neither salon nor name", { kind: "salon" }],
    ["an unknown salon", { kind: "salon", salon: uuid() }],
    ["a new salon with no type", { kind: "salon", newSalon: uuid(), newName: "[Test] Half", newArea: uuid() }],
    ["a new salon with a blank name", { kind: "salon", newSalon: uuid(), newName: "  ", newType: "unisex", newArea: uuid() }],
    ["a new salon with no id", { kind: "salon", newName: "[Test] No id", newType: "unisex", newArea: uuid() }],
    [
      "both a salon and a new salon",
      { kind: "salon", salon: uuid(), newSalon: uuid(), newName: "[Test] Both", newType: "unisex", newArea: uuid() },
    ],
  ])("%s is refused as bad input", async (_n, a) => {
    const sql =
      (a as Args).client === ""
        ? "select app.office_invite(null, 'rep', '[Test] Invitee', 'x.y@example.test')"
        : inviteSql(a as Args);
    expect(await sqlstate(MANAGER, sql)).toBe(BAD_INPUT);
  });

  it.each([
    ["owner", OWNER, "owner"],
    ["owner", OWNER, "manager"],
    ["manager", MANAGER, "owner"],
    ["manager", MANAGER, "manager"],
  ])("%s cannot invite through this path as %s (D-39)", async (_n, who, kind) => {
    expect(await codeOf(who, { kind: kind as string })).toBe(DENIED);
  });

  it("nothing but rep or salon can ever be stored: the kind enum has no staff role", async () => {
    const { rows } = await run("postgres", "select unnest(enum_range(null::public.invitation_kind))::text k order by 1");
    expect(rows.map((r) => r.k)).toEqual(["rep", "salon"]);
  });

  it.each(REFUSED)("%s cannot invite", async (_n, who) => {
    expect(await codeOf(who)).toBe(DENIED);
  });

  it("anon cannot invite", async () => {
    expect(await codeOf("anon")).toBe(DENIED);
  });

  it("an unredeemed login cannot invite", async () => {
    const l = await newLogin();
    expect(await asLoginCode(l, inviteSql())).toBe(DENIED);
  });

  it("a replay returns the same invitation with no token and creates nothing new", async () => {
    const client = uuid();
    const email = `replay.${tag()}@example.test`;
    const first = await invite(MANAGER, { client, email });
    const again = await invite(MANAGER, { client, email });
    expect(again.id).toBe(first.id);
    expect(again.token).toBeNull();
    expect(
      (await run("postgres", "select count(*)::int n from public.invitation where client_id = $1", [client])).rows[0].n,
    ).toBe(1);
  });

  it("a replay of a new-salon invitation does not make a second salon", async () => {
    const client = uuid();
    const newSalon = uuid();
    const a = {
      client,
      kind: "salon",
      email: `replay.${tag()}@example.test`,
      newSalon,
      newName: "[Test] Replay salon",
      newType: "unisex",
      newArea: AREA,
    };
    expect(isToken((await invite(MANAGER, a)).token)).toBe(true);
    expect((await invite(MANAGER, a)).token).toBeNull();
    expect((await run("postgres", "select count(*)::int n from public.salon where id = $1", [newSalon])).rows[0].n).toBe(1);
  });

  it("the same client id with different facts, or from another person, is refused", async () => {
    const client = uuid();
    const email = `replay.${tag()}@example.test`;
    await invite(MANAGER, { client, email });
    expect(await codeOf(MANAGER, { client, email: `other.${tag()}@example.test` })).toBe(DUPLICATE);
    expect(await codeOf(OWNER, { client, email })).toBe(DUPLICATE);
  });

  it("an email with a staff account or a live invitation is refused", async () => {
    expect(await codeOf(MANAGER, { email: "repa@example.test" })).toBe(WRONG_STATE);
    expect(await codeOf(MANAGER, { email: "manager@example.test" })).toBe(WRONG_STATE);
    const email = `live.${tag()}@example.test`;
    await invite(MANAGER, { email });
    expect(await codeOf(MANAGER, { email })).toBe(WRONG_STATE);
  });

  it("a salon with a live invitation or a membership is refused a second one", async () => {
    const salon = await makeSalon();
    const first = await invite(MANAGER, { kind: "salon", salon });
    expect(await codeOf(MANAGER, { kind: "salon", salon })).toBe(WRONG_STATE);
    const l = await newLogin({ email: first.email });
    await redeem(l, first.token as string);
    expect(await codeOf(MANAGER, { kind: "salon", salon })).toBe(WRONG_STATE);
  });

  it("a pending or rejected salon cannot be invited", async () => {
    const salon = uuid();
    await run(
      "postgres",
      `insert into public.salon (id, name, type, area_id, source, created_by, approval_status)
      values ($1, '[Test] Pending invite', 'unisex', $2, 'manual', $3, 'pending')`,
      [salon, AREA, fx.manager.id],
      C,
    );
    expect(await errorOf(MANAGER, inviteSql({ kind: "salon", salon }))).toContain("approved");
    expect(await codeOf(MANAGER, { kind: "salon", salon })).toBe(WRONG_STATE);
  });
});

describe("what the invitee sees before accepting", () => {
  const preview = (token: string) => `select app.invitation_preview(${quote(token)}) as r`;

  it("anon cannot call it: the page shows it only after the emailed code", async () => {
    expect(await sqlstate("anon", preview(NOT_A_TOKEN))).toBe(DENIED);
  });

  it("the invited email, signed in by code, sees who invited whom for what and nothing else", async () => {
    const salon = await makeSalon();
    const i = await invite(MANAGER, { kind: "salon", salon, name: "[Test] Salon owner" });
    const l = await newLogin({ email: i.email });
    const p = (await asLoginRows(l, preview(i.token as string)))[0].r as Record<string, unknown>;
    expect(Object.keys(p).sort()).toEqual(["expires_at", "full_name", "invited_by", "kind", "salon_name", "status"]);
    expect(p).toMatchObject({ kind: "salon", full_name: "[Test] Salon owner", invited_by: "[Test] Manager", status: "pending" });
    expect(p.salon_name).toContain("[Test] Invited salon");
  });

  it("an unknown token, another email and a password session all get the same nothing", async () => {
    const i = await invite(MANAGER);
    const other = await newLogin();
    const invitee = await newLogin({ email: i.email });
    expect((await asLoginRows(other, preview(NOT_A_TOKEN)))[0].r).toBeNull();
    expect((await asLoginRows(other, preview(i.token as string)))[0].r).toBeNull();
    expect((await asLoginRows(invitee, preview(i.token as string), { method: "password" }))[0].r).toBeNull();
  });

  it("a revoked invitation shows its state, so the page can say so", async () => {
    const i = await invite(MANAGER);
    await run(MANAGER, "select app.office_revoke_invitation($1, 'wrong person')", [i.id], C);
    const l = await newLogin({ email: i.email });
    expect((await asLoginRows(l, preview(i.token as string)))[0].r).toMatchObject({ status: "revoked" });
  });

  it("a magic-link session counts as the emailed proof", async () => {
    const i = await invite(MANAGER);
    const l = await newLogin({ email: i.email });
    expect((await asLoginRows(l, preview(i.token as string), { method: "magiclink" }))[0].r).toMatchObject({ kind: "rep" });
  });
});

describe("redeeming an invitation", () => {
  it("anon cannot redeem", async () => {
    expect(await sqlstate("anon", redeemSql(NOT_A_TOKEN))).toBe(DENIED);
  });

  it("a rep invitation creates the rep's profile: role rep, the invitation's name, no vault", async () => {
    const i = await invite(MANAGER, { name: "[Test] Fresh rep" });
    const l = await newLogin({ email: i.email });
    expect(await redeem(l, i.token as string)).toEqual({ kind: "rep" });
    const p = (
      await run("postgres", "select full_name, role, status, vault_grant, created_by from public.user_profile where id = $1", [
        l.id,
      ])
    ).rows[0];
    expect(p).toEqual({
      full_name: "[Test] Fresh rep",
      role: "rep",
      status: "active",
      vault_grant: false,
      created_by: fx.manager.id,
    });
    expect(await invitationRow(i.id)).toMatchObject({ status: "redeemed", redeemed_by: l.id });
    // SEC-03 stands: a new rep's phone waits for the office.
    const dev = `dev-${uuid()}`;
    const reg = await asLoginRows(
      l,
      `select set_config('request.headers', '${JSON.stringify({ "x-kiran-device": dev })}', true); select (app.register_device('${dev}')).status`,
    );
    expect(reg[0].status).toBe("pending");
  });

  it("a salon invitation creates a membership and no staff role", async () => {
    const salon = await makeSalon();
    const i = await invite(MANAGER, { kind: "salon", salon, name: "[Test] Salon owner" });
    const l = await newLogin({ email: i.email });
    expect(await redeem(l, i.token as string)).toEqual({ kind: "salon" });
    const m = (
      await run(
        "postgres",
        "select salon_id, status, full_name, email, invitation_id from public.salon_membership where user_id = $1",
        [l.id],
      )
    ).rows[0];
    expect(m).toEqual({
      salon_id: salon,
      status: "active",
      full_name: "[Test] Salon owner",
      email: i.email,
      invitation_id: i.id,
    });
    expect((await run("postgres", "select 1 from public.user_profile where id = $1", [l.id])).rows).toEqual([]);
    expect((await asLoginRows(l, "select app.my_session() as r"))[0].r).toBeNull();
  });

  it("a replay by the same login changes nothing", async () => {
    const i = await invite(MANAGER);
    const l = await newLogin({ email: i.email });
    await redeem(l, i.token as string);
    const audits = async () =>
      (
        await run(
          "postgres",
          "select count(*)::int n from control.audit_event where table_name = 'public.invitation' and row_id = $1",
          [i.id],
        )
      ).rows[0].n;
    const before = await audits();
    expect(await redeem(l, i.token as string)).toEqual({ kind: "rep" });
    expect(await audits()).toBe(before);
    expect((await run("postgres", "select count(*)::int n from public.user_profile where id = $1", [l.id])).rows[0].n).toBe(1);
  });

  it("two redemptions at once create one profile", async () => {
    const i = await invite(MANAGER);
    const l = await newLogin({ email: i.email });
    const both = await Promise.allSettled([redeem(l, i.token as string), redeem(l, i.token as string)]);
    expect(both.map((b) => b.status)).toEqual(["fulfilled", "fulfilled"]);
    expect((await run("postgres", "select count(*)::int n from public.user_profile where id = $1", [l.id])).rows[0].n).toBe(1);
  });

  it("a used token refuses any other login", async () => {
    const i = await invite(MANAGER);
    const l = await newLogin({ email: i.email });
    await redeem(l, i.token as string);
    const other = await newLogin();
    expect(await asLoginError(other, redeemSql(i.token as string))).toContain(NOT_FOR_YOU);
    // The same address on a second login (an address change after redeeming): the token is spent.
    expect(
      await sqlstate(
        "postgres",
        `update auth.users set email = '${tag()}.${i.email}' where id = '${l.id}';
         update auth.users set email = '${i.email}' where id = '${other.id}';
         ${asLogin(other)} ${redeemSql(i.token as string)}`,
      ),
    ).toBe(WRONG_STATE);
  });

  it("another email is refused with the unknown-token words, and the invitation stays open", async () => {
    const i = await invite(MANAGER);
    const other = await newLogin();
    expect(await asLoginCode(other, redeemSql(i.token as string))).toBe(BAD_INPUT);
    expect(await asLoginError(other, redeemSql(i.token as string))).toContain(NOT_FOR_YOU);
    expect(await asLoginError(other, redeemSql(NOT_A_TOKEN))).toContain(NOT_FOR_YOU);
    expect((await invitationRow(i.id)).status).toBe("pending");
  });

  it("the email's case does not matter, and an unconfirmed address is refused", async () => {
    const i = await invite(MANAGER);
    const upper = await newLogin({ email: i.email.toUpperCase() });
    expect(await redeem(upper, i.token as string)).toEqual({ kind: "rep" });
    const j = await invite(MANAGER);
    const unconfirmed = await newLogin({ email: j.email, confirmed: false });
    expect(await asLoginCode(unconfirmed, redeemSql(j.token as string))).toBe(BAD_INPUT);
  });

  it("a password session cannot redeem even with the right email and token: the code is the proof", async () => {
    const i = await invite(MANAGER);
    const l = await newLogin({ email: i.email });
    expect(await asLoginCode(l, redeemSql(i.token as string), "password")).toBe(DENIED);
    expect((await invitationRow(i.id)).status).toBe("pending");
  });

  it("an expired token is refused", async () => {
    const i = await invite(MANAGER);
    const l = await newLogin({ email: i.email });
    const code = await sqlstate("postgres", expired(i.id, `${asLogin(l)} ${redeemSql(i.token as string)}`));
    expect(code).toBe(WRONG_STATE);
    expect((await run("postgres", "select 1 from public.user_profile where id = $1", [l.id])).rows).toEqual([]);
  });

  it("a revoked token is refused", async () => {
    const i = await invite(MANAGER);
    await run(MANAGER, "select app.office_revoke_invitation($1, 'wrong person')", [i.id], C);
    const l = await newLogin({ email: i.email });
    expect(await asLoginCode(l, redeemSql(i.token as string))).toBe(WRONG_STATE);
  });

  it("a login that became staff before redeeming is refused, and so is one already in a salon", async () => {
    const i = await invite(MANAGER);
    const l = await newLogin({ email: i.email });
    await run(OWNER, "select app.owner_create_user($1, '[Test] Became a manager', 'manager')", [l.id], C);
    expect(await asLoginCode(l, redeemSql(i.token as string))).toBe(WRONG_STATE);
    expect((await run("postgres", "select role from public.user_profile where id = $1", [l.id])).rows[0].role).toBe("manager");

    const salonA = await invite(MANAGER, { kind: "salon", salon: await makeSalon() });
    const member = await newLogin({ email: salonA.email });
    await redeem(member, salonA.token as string);
    const again = await invite(MANAGER);
    const s = `update auth.users set email = '${again.email}' where id = '${member.id}';
      ${asLogin(member)} ${redeemSql(again.token as string)}`;
    expect(await sqlstate("postgres", s)).toBe(WRONG_STATE);
  });

  it("redeeming clears any password on the login and ends its other sessions: the code stays the only way in", async () => {
    const i = await invite(MANAGER);
    const l = await newLogin({ email: i.email, password: "a-squatter-set-this" });
    const other = uuid();
    await run("postgres", "insert into auth.sessions (id, user_id) values ($1, $2), ($3, $2)", [l.session, l.id, other], C);
    await redeem(l, i.token as string);
    const u = (await run("postgres", "select encrypted_password from auth.users where id = $1", [l.id])).rows[0];
    expect(u.encrypted_password).toBe("");
    const s = await run("postgres", "select id from auth.sessions where user_id = $1", [l.id]);
    expect(s.rows.map((r) => r.id)).toEqual([l.session]);
  });

  it("the audit rows carry the session's actor, and the chain still verifies", async () => {
    const i = await invite(MANAGER);
    const l = await newLogin({ email: i.email });
    await redeem(l, i.token as string);
    const rows = async (table: string, id: string) =>
      (
        await run(
          "postgres",
          "select actor_id, action from control.audit_event where table_name = $1 and row_id = $2 order by seq",
          [table, id],
        )
      ).rows;
    expect(await rows("public.invitation", i.id)).toEqual([
      { actor_id: fx.manager.id, action: "INSERT" },
      { actor_id: l.id, action: "UPDATE" },
    ]);
    expect(await rows("public.user_profile", l.id)).toEqual([{ actor_id: l.id, action: "INSERT" }]);
    expect((await verify()).ok).toBe(true);
  });
});

describe("the invitation list and revoking", () => {
  it("the office lists invitations without any token data; an expired one reads expired", async () => {
    const i = await invite(MANAGER);
    const { rows } = await run(MANAGER, "select * from app.office_invitations() where id = $1", [i.id]);
    expect(rows.length).toBe(1);
    expect(Object.keys(rows[0]).some((k) => k.includes("token") || k.includes("hash"))).toBe(false);
    expect(rows[0]).toMatchObject({ status: "pending", email: i.email, invited_by_name: "[Test] Manager" });
    const res = (await run(
      "postgres",
      expired(
        i.id,
        `${asLogin({ id: fx.owner.id, email: "owner@example.test", session: uuid() })}
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.owner.id, role: "authenticated", aal: "aal2" })}', true);
      select status from app.office_invitations() where id = '${i.id}'`,
      ),
    )) as unknown as Array<{ rows: Array<{ status: string }> }>;
    expect(res.at(-1)?.rows[0].status).toBe("expired");
  });

  it.each([...REFUSED, ["anon", "anon" as Who]] as Array<[string, Who]>)("%s cannot list or revoke", async (_n, who) => {
    expect(await sqlstate(who, "select * from app.office_invitations()")).toBe(DENIED);
    expect(await sqlstate(who, `select app.office_revoke_invitation('${uuid()}', 'a reason')`)).toBe(DENIED);
  });

  it("an unredeemed login cannot list or revoke", async () => {
    const l = await newLogin();
    expect(await asLoginCode(l, "select * from app.office_invitations()")).toBe(DENIED);
    expect(await asLoginCode(l, `select app.office_revoke_invitation('${uuid()}', 'a reason')`)).toBe(DENIED);
  });

  it("revoking needs a reason and a real invitation; a revoke replays; a used one is refused", async () => {
    const i = await invite(MANAGER);
    expect(await sqlstate(MANAGER, "select app.office_revoke_invitation($1, ' ')", [i.id])).toBe("23514");
    expect(await sqlstate(MANAGER, `select app.office_revoke_invitation('${uuid()}', 'no such row')`)).toBe(BAD_INPUT);
    const first = (await run(MANAGER, "select app.office_revoke_invitation($1, 'wrong person') as r", [i.id], C)).rows[0].r;
    expect(first).toMatchObject({ id: i.id, status: "revoked" });
    expect(JSON.stringify(first)).not.toContain("hash");
    const again = (await run(OWNER, "select app.office_revoke_invitation($1, 'again') as r", [i.id], C)).rows[0].r;
    expect(again).toMatchObject({ id: i.id, status: "revoked" });
    expect((await invitationRow(i.id)).revoked_by).toBe(fx.manager.id);

    const j = await invite(MANAGER);
    await redeem(await newLogin({ email: j.email }), j.token as string);
    expect(await sqlstate(MANAGER, "select app.office_revoke_invitation($1, 'too late')", [j.id])).toBe(WRONG_STATE);
  });

  it("a new invitation may follow a revoked or expired one", async () => {
    const i = await invite(MANAGER);
    await run(MANAGER, "select app.office_revoke_invitation($1, 'wrong person')", [i.id], C);
    expect(isToken((await invite(MANAGER, { email: i.email })).token)).toBe(true);
    const j = await invite(MANAGER);
    expect(
      await sqlstate(
        "postgres",
        expired(
          j.id,
          `select 1; ${asLogin({ id: fx.manager.id, email: "m", session: uuid() })}
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.manager.id, role: "authenticated", aal: "aal2" })}', true);
      ${inviteSql({ email: j.email })}`,
        ),
      ),
    ).toBeNull();
  });

  it("an invitation's facts cannot be changed, and it is never deleted, even by the table owner", async () => {
    const i = await invite(MANAGER);
    expect(await sqlstate("postgres", "update public.invitation set email = 'other@example.test' where id = $1", [i.id])).toBe(
      DENIED,
    );
    expect(
      await sqlstate("postgres", "update public.invitation set expires_at = now() + interval '1 year' where id = $1", [i.id]),
    ).toBe(DENIED);
    expect(await sqlstate("postgres", "delete from public.invitation where id = $1", [i.id])).toBe(DENIED);
    await run(MANAGER, "select app.office_revoke_invitation($1, 'wrong person')", [i.id], C);
    expect(
      await sqlstate(
        "postgres",
        "update public.invitation set status = 'pending', revoked_by = null, revoked_at = null, revoke_reason = null where id = $1",
        [i.id],
      ),
    ).toBe(DENIED);
  });
});

describe("suspending and reactivating reps and salons (D-39)", () => {
  const setStatus = (kind: string, id: string, status: string, reason = "test reason") =>
    `select app.office_set_member_status(${quote(kind)}, ${quote(id)}, ${quote(status)}, ${quote(reason)}) as r`;

  const redeemedRep = async () => {
    const i = await invite(MANAGER);
    const l = await newLogin({ email: i.email });
    await redeem(l, i.token as string);
    return l;
  };
  const member = async () => {
    const salon = await makeSalon();
    const i = await invite(MANAGER, { kind: "salon", salon });
    const l = await newLogin({ email: i.email });
    await redeem(l, i.token as string);
    const m = (await run("postgres", "select id from public.salon_membership where user_id = $1", [l.id])).rows[0];
    return { l, membership: m.id as string, salon };
  };

  it.each([
    ["manager", MANAGER],
    ["owner", OWNER],
  ])("%s suspends a rep, who stops at once and whose devices are revoked; then reactivates", async (_n, who) => {
    const l = await redeemedRep();
    const dev = `dev-${uuid()}`;
    await asLoginRows(
      l,
      `select set_config('request.headers', '${JSON.stringify({ "x-kiran-device": dev })}', true); select app.register_device('${dev}')`,
      { commit: true },
    );
    expect((await run(who, setStatus("rep", l.id, "suspended"), [], C)).rows[0].r).toMatchObject({ status: "suspended" });
    expect((await run("postgres", "select status from public.device where user_id = $1", [l.id])).rows[0].status).toBe("revoked");
    expect(await asLoginError(l, "select app.rep_check_in('x')")).toBeTruthy();
    expect((await asLoginRows(l, "select app.user_role() as r"))[0].r).toBeNull();
    expect((await run(who, setStatus("rep", l.id, "active"), [], C)).rows[0].r).toMatchObject({ status: "active" });
    expect((await run("postgres", "select status from public.user_profile where id = $1", [l.id])).rows[0].status).toBe("active");
  });

  it("the same status again changes nothing", async () => {
    const l = await redeemedRep();
    await run(MANAGER, setStatus("rep", l.id, "suspended"), [], C);
    const n = async () =>
      (
        await run(
          "postgres",
          "select count(*)::int n from control.audit_event where table_name = 'public.user_profile' and row_id = $1",
          [l.id],
        )
      ).rows[0].n;
    const before = await n();
    expect((await run(MANAGER, setStatus("rep", l.id, "suspended"), [], C)).rows[0].r).toMatchObject({ status: "suspended" });
    expect(await n()).toBe(before);
  });

  it("offboarding and role changes stay with the owner: a manager is refused through every door", async () => {
    const l = await redeemedRep();
    expect(await sqlstate(MANAGER, setStatus("rep", l.id, "offboarded"))).toBe(DENIED);
    expect(await sqlstate(OWNER, setStatus("rep", l.id, "offboarded"))).toBe(DENIED);
    expect(await errorOf(MANAGER, "select app.owner_set_status($1, 'offboarded', 'a reason')", [l.id])).toContain("owner only");
    expect(await errorOf(MANAGER, "select app.owner_set_role($1, 'manager', 'a reason')", [l.id])).toContain("owner only");
    expect(await errorOf(MANAGER, "select app.owner_create_user($1, '[Test] Sneak', 'manager')", [uuid()])).toContain(
      "owner only",
    );
    expect(await errorOf(MANAGER, "select app.owner_create_user($1, '[Test] Sneak', 'owner')", [uuid()])).toContain("owner only");
  });

  it("a manager cannot touch another manager or the owner, and neither can the owner on this path", async () => {
    const tries = [MANAGER, OWNER].flatMap((who) =>
      [fx.owner.id, fx.manager.id].map((id) => sqlstate(who, setStatus("rep", id, "suspended"))),
    );
    expect(await Promise.all(tries)).toEqual([DENIED, DENIED, DENIED, DENIED]);
    expect((await run("postgres", "select status from public.user_profile where id = $1", [fx.manager.id])).rows[0].status).toBe(
      "active",
    );
  });

  it("an offboarded rep stays offboarded (B-33 c)", async () => {
    const l = await redeemedRep();
    await run(OWNER, "select app.owner_set_status($1, 'offboarded', 'left the company')", [l.id], C);
    expect(await sqlstate(MANAGER, setStatus("rep", l.id, "active"))).toBe(WRONG_STATE);
  });

  it("bad input: unknown person, unknown kind, unknown status, no reason", async () => {
    expect(await sqlstate(MANAGER, setStatus("rep", uuid(), "suspended"))).toBe(BAD_INPUT);
    expect(await sqlstate(MANAGER, setStatus("salon", uuid(), "suspended"))).toBe(BAD_INPUT);
    expect(await sqlstate(MANAGER, setStatus("owner", fx.owner.id, "suspended"))).toBe(BAD_INPUT);
    const l = await redeemedRep();
    expect(await sqlstate(MANAGER, setStatus("rep", l.id, "paused"))).toBe(BAD_INPUT);
    expect(await sqlstate(MANAGER, setStatus("rep", l.id, "suspended", " "))).toBe("23514");
  });

  it.each([...REFUSED, ["anon", "anon" as Who]] as Array<[string, Who]>)("%s cannot change a status", async (_n, who) => {
    expect(await sqlstate(who, setStatus("rep", fx.repB.id, "suspended"))).toBe(DENIED);
  });

  it("an unredeemed login and a salon member cannot change a status", async () => {
    expect(await asLoginCode(await newLogin(), setStatus("rep", fx.repB.id, "suspended"))).toBe(DENIED);
    const { l } = await member();
    expect(await asLoginCode(l, setStatus("rep", fx.repB.id, "suspended"))).toBe(DENIED);
  });

  it("a suspended membership stops at once and can come back; a revoked one is final", async () => {
    const { l, membership } = await member();
    expect((await asLoginRows(l, "select app.salon_me() as r"))[0].r).toMatchObject({ membership_status: "active" });
    await run(MANAGER, setStatus("salon", membership, "suspended"), [], C);
    expect((await asLoginRows(l, "select app.salon_me() as r"))[0].r).toBeNull();
    await run(MANAGER, setStatus("salon", membership, "active"), [], C);
    expect((await asLoginRows(l, "select app.salon_me() as r"))[0].r).toMatchObject({ membership_status: "active" });
    await run(OWNER, setStatus("salon", membership, "revoked"), [], C);
    expect((await asLoginRows(l, "select app.salon_me() as r"))[0].r).toBeNull();
    expect(await sqlstate(MANAGER, setStatus("salon", membership, "active"))).toBe(WRONG_STATE);
    const row = (
      await run("postgres", "select status, status_by, status_reason from public.salon_membership where id = $1", [membership])
    ).rows[0];
    expect(row).toEqual({ status: "revoked", status_by: fx.owner.id, status_reason: "test reason" });
  });

  it("a revoked membership frees the salon for a new invitation", async () => {
    const { membership, salon } = await member();
    await run(MANAGER, setStatus("salon", membership, "revoked"), [], C);
    const again = await invite(MANAGER, { kind: "salon", salon });
    const l = await newLogin({ email: again.email });
    expect(await redeem(l, again.token as string)).toEqual({ kind: "salon" });
  });

  it("a membership's identity cannot be changed and it is never deleted, even by the table owner", async () => {
    const { membership, salon } = await member();
    const other = await makeSalon();
    expect(salon).not.toBe(other);
    expect(
      await sqlstate("postgres", "update public.salon_membership set salon_id = $2 where id = $1", [membership, other]),
    ).toBe(DENIED);
    expect(await sqlstate("postgres", "delete from public.salon_membership where id = $1", [membership])).toBe(DENIED);
  });
});

describe("salon_me and isolation", () => {
  const me = "select app.salon_me() as r";

  it("returns the caller's own salon, allow-listed fields only; a salon cannot ask for another", async () => {
    const [a, b] = [await makeSalon(), await makeSalon()];
    await run(MANAGER, "select app.update_salon($1, null, 'ladies_parlor', $2, '[Test] Street 1')", [a, AREA], C);
    const ia = await invite(MANAGER, { kind: "salon", salon: a });
    const ib = await invite(MANAGER, { kind: "salon", salon: b });
    const la = await newLogin({ email: ia.email });
    const lb = await newLogin({ email: ib.email });
    await redeem(la, ia.token as string);
    await redeem(lb, ib.token as string);
    const ra = (await asLoginRows(la, me))[0].r as Record<string, unknown>;
    const rb = (await asLoginRows(lb, me))[0].r as Record<string, unknown>;
    expect(Object.keys(ra).sort()).toEqual(["address", "approval_status", "membership_status", "name"]);
    expect(ra).toMatchObject({ address: "[Test] Street 1", approval_status: "approved", membership_status: "active" });
    const name = async (id: string) => (await run("postgres", "select name from public.salon where id = $1", [id])).rows[0].name;
    expect(ra.name).toBe(await name(a));
    expect(rb.name).toBe(await name(b));
    expect(ra.name).not.toBe(rb.name);
    // salon_me takes no id: nothing to change.
    expect(await asLoginCode(la, `select app.salon_me('${b}')`)).toBe("42883");
  });

  it("is null for anyone without a membership: staff, an unredeemed login", async () => {
    const staff = await Promise.all([REP_A, MANAGER, OWNER].map((who) => run(who, me)));
    expect(staff.map((res) => res.rows[0].r)).toEqual([null, null, null]);
    expect((await asLoginRows(await newLogin(), me))[0].r).toBeNull();
  });

  it("is refused to anon, and null for a member's password session", async () => {
    expect(await sqlstate("anon", me)).toBe(DENIED);
    const i = await invite(MANAGER, { kind: "salon", salon: await makeSalon() });
    const l = await newLogin({ email: i.email });
    await redeem(l, i.token as string);
    expect((await asLoginRows(l, me, { method: "password" }))[0].r).toBeNull();
  });

  it("a salon member cannot use staff functions or read another salon's data", async () => {
    const salon = await makeSalon();
    const other = await makeSalon();
    const i = await invite(MANAGER, { kind: "salon", salon });
    const l = await newLogin({ email: i.email });
    await redeem(l, i.token as string);
    await Promise.all(
      [salon, other].map(async (id) => {
        expect(await asLoginCode(l, `select app.add_salon_note(gen_random_uuid(), '${id}', 'try')`)).toBe(DENIED);
        expect((await asLoginRows(l, `select count(*)::int n from app.salon_notes('${id}')`))[0].n).toBe(0);
        expect((await asLoginRows(l, `select count(*)::int n from app.salon_stages('${id}')`))[0].n).toBe(0);
      }),
    );
    expect(await asLoginCode(l, "select app.office_orders()")).toBe(DENIED);
    expect(await asLoginCode(l, "select app.rep_create_card(gen_random_uuid(), gen_random_uuid(), 'try')")).toBe(DENIED);
    expect((await asLoginRows(l, "select count(*)::int n from app.my_salons()"))[0].n).toBe(0);
  });
});

describe("a login with nothing redeemed sees nothing (spec section 3)", () => {
  const sweep = async (l: Login) => {
    const { rows } = await run<{ t: string }>("postgres", ALL_RELATIONS);
    expect(rows.length).toBeGreaterThan(SWEEP_MINIMUM);
    await Promise.all(
      rows.map(async ({ t }) => {
        const code = await asLoginCode(l, `select count(*) from ${t}`);
        if (code === null) {
          const seen = await asLoginRows(l, `select count(*)::int n from ${t}`);
          expect(seen[0].n, `${t} shows rows to a login with no profile`).toBe(0);
        } else {
          expect(code, t).toBe(DENIED);
        }
      }),
    );
  };

  it("no relation in our five schemas shows it a row", async () => {
    await sweep(await newLogin());
  });

  it("nor to a salon member: the membership opens no table", async () => {
    const i = await invite(MANAGER, { kind: "salon", salon: await makeSalon() });
    const l = await newLogin({ email: i.email });
    await redeem(l, i.token as string);
    await sweep(l);
  });

  it("every write function refuses it, and the reads answer empty", async () => {
    const l = await newLogin();
    await Promise.all(
      [
        "select app.register_device('dev-unredeemed-000000')",
        "select app.create_salon(gen_random_uuid(), 'x y', 'unisex', gen_random_uuid(), 'manual')",
        "select app.office_assign_salon_rep(gen_random_uuid(), gen_random_uuid(), null)",
        "select app.office_decide_salon(gen_random_uuid(), gen_random_uuid(), true, null)",
        "select * from app.office_pending_salons()",
        "select app.office_create_order(gen_random_uuid(), gen_random_uuid(), 'CASH', '[]')",
      ].map(async (sql) => expect(await asLoginCode(l, sql), sql).toBe(DENIED)),
    );
    expect((await asLoginRows(l, "select app.my_session() as r"))[0].r).toBeNull();
    expect((await asLoginRows(l, "select app.user_role() as r"))[0].r).toBeNull();
  });
});
