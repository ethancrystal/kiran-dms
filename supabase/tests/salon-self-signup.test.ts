/**
 * Salon self-signup (migration 20261109200000; MJ's decision of 2026-11-09, docs/log/2026-11-09-mj-salon-self-signup.md).
 * A salon signs in with the emailed code and applies; the office (owner or manager, AAL2) approves it,
 * which makes the salon and its login, or rejects it with a reason. Reps stay invitation-only: nothing
 * here ever makes a user_profile. Tested as real signed-in roles, including a login with nothing redeemed.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
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
import { ALL_RELATIONS, asLoginCode, asLoginRows, type Login, newLogin, quote, tag, uuid } from "./helpers/invite";

const C = { commit: true };
const DENIED = "42501";
const BAD_INPUT = "22023";
const WRONG_STATE = "55000";
const DUPLICATE = "23505";
const CHECK_VIOLATION = "23514";
const FEATURE_NOT_SUPPORTED = "0A000";
const TRUNCATE_TRIGGER = 32; // pg_trigger.tgtype bit for a TRUNCATE trigger
const SWEEP_MINIMUM = 40; // our five schemas hold more relations than this; a broken sweep query does not
const REASON = "Not a salon we can serve";
const NAME_MAX = 120;
const ADDRESS_MAX = 300;
const REASON_MAX = 500;
const RATE_MAX_BP = 10_000; // 100 percent
const RATE_BP = 250; // 2.5 percent
const SMALL_RATE_BP = 100;

const T = uuid(),
  AREA = uuid();

type Apply = { client?: string; salon?: string | null; contact?: string | null; type?: string | null; address?: string | null };
const applySql = (a: Apply = {}) => `select app.salon_apply(${quote(a.client ?? uuid())},
  ${quote(a.salon === undefined ? `[Test] Applicant salon ${tag()}` : a.salon)},
  ${quote(a.contact === undefined ? "[Test] Applicant" : a.contact)},
  ${a.type === null ? "null" : quote(a.type ?? "unisex")}::public.salon_type,
  ${quote(a.address === undefined ? "12 Test Road, Karachi" : a.address)}) as r`;

type Decide = {
  client?: string;
  approve?: boolean;
  reason?: string | null;
  area?: string | null;
  salon?: string | null;
  rep?: string | null;
  rate?: number | null;
};
const decideSql = (
  request: string,
  d: Decide = {},
) => `select app.office_decide_signup(${quote(d.client ?? uuid())}, ${quote(request)},
  ${d.approve ?? true}, ${quote(d.reason ?? null)}, ${quote(d.area === undefined ? AREA : d.area)}, ${quote(d.salon ?? null)},
  ${quote(d.rep ?? null)}, ${d.rate ?? "null"}) as r`;
const decide = async (who: Who, request: string, d: Decide = {}) =>
  (await run<{ r: { request_id: string; status: string; salon_id: string | null } }>(who, decideSql(request, d), [], C)).rows[0]
    .r;

/** A confirmed login that has applied, from an emailed-code session. */
const applicant = async (a: Apply = {}) => {
  const l = await newLogin();
  const r = (await asLoginRows(l, applySql(a), { commit: true }))[0].r as { status: string };
  expect(r.status).toBe("pending");
  const request = (await run("postgres", "select id from public.salon_signup_request where user_id = $1", [l.id])).rows[0]
    .id as string;
  return { login: l, request };
};
const requestRow = async (id: string) =>
  (await run("postgres", "select * from public.salon_signup_request where id = $1", [id])).rows[0];
const status = async (l: Login) =>
  (await asLoginRows(l, "select app.salon_login_status() as s"))[0].s as { membership_status: string; name: string } | null;
const verify = async () => (await run("postgres", "select * from control.verify_audit_chain()")).rows[0];

const REFUSED: Array<[string, Who]> = [
  ["repA", REP_A],
  ["repA on a wrong device", REP_A_WRONG_DEVICE],
  ["a suspended rep", SUSPENDED],
  ["manager without MFA", MANAGER_AAL1],
  ["owner without MFA", OWNER_AAL1],
  ["anon", "anon" as Who],
];

beforeAll(async () => {
  await run(MANAGER, "select app.office_upsert_territory($1, $2)", [T, `[Test] Self-signup ${tag()}`], C);
  await run(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Self-signup area')", [AREA, T], C);
});

describe("a salon applies", () => {
  it("an emailed-code session applies: a request is made, and no profile, salon or membership", async () => {
    const email = `Applicant.${tag()}@Example.TEST`;
    const l = await newLogin({ email });
    const r = (
      await asLoginRows(l, applySql({ salon: "[Test] Rose Parlour", contact: "[Test] Rose", type: "ladies_parlor" }), C)
    )[0].r;
    expect(r).toEqual({ status: "pending" });
    const row = (await run("postgres", "select * from public.salon_signup_request where user_id = $1", [l.id])).rows[0];
    expect(row).toMatchObject({
      email: email.toLowerCase(),
      salon_name: "[Test] Rose Parlour",
      contact_name: "[Test] Rose",
      type: "ladies_parlor",
      status: "pending",
      salon_id: null,
      decided_by: null,
    });
    const made = await run(
      "postgres",
      `select (select count(*) from public.user_profile where id = $1)::int profiles,
              (select count(*) from public.salon_membership where user_id = $1)::int memberships,
              (select count(*) from public.salon where name = '[Test] Rose Parlour')::int salons`,
      [l.id],
    );
    expect(made.rows[0]).toEqual({ profiles: 0, memberships: 0, salons: 0 });
  });

  it("the request is audited", async () => {
    const { request } = await applicant();
    const audit = await run(
      "postgres",
      "select e.purpose from control.audit_event e where e.table_name = 'public.salon_signup_request' and e.row_id = $1",
      [request],
    );
    expect(audit.rows.map((x) => x.purpose)).toEqual(["salon signup"]);
    expect((await verify()).ok).toBe(true);
  });

  it("a replay of the same call changes nothing", async () => {
    const l = await newLogin();
    const a = { client: uuid(), salon: "[Test] Replay", contact: "[Test] Replayer", type: "barber", address: "5 Replay Lane" };
    await asLoginRows(l, applySql(a), C);
    const again = (await asLoginRows(l, applySql(a), C))[0].r;
    expect(again).toEqual({ status: "pending" });
    expect((await run("postgres", "select 1 from public.salon_signup_request where user_id = $1", [l.id])).rows.length).toBe(1);
  });

  it("the same login with other details is refused; a client_id used by another login is refused", async () => {
    const { login } = await applicant();
    expect(await asLoginCode(login, applySql())).toBe(WRONG_STATE);
    const used = (await run("postgres", "select client_id from public.salon_signup_request where user_id = $1", [login.id]))
      .rows[0].client_id;
    const other = await newLogin();
    expect(await asLoginCode(other, applySql({ client: used }))).toBe(DUPLICATE);
  });

  it.each([
    ["a one-letter salon name", { salon: "x" }],
    ["a tab for a salon name", { salon: "\t\t" }],
    ["no salon name", { salon: null }],
    ["a one-letter contact name", { contact: "x" }],
    ["no contact name", { contact: null }],
    ["no salon type", { type: null }],
    ["a four-character address", { address: "abcd" }],
    ["no address", { address: null }],
    ["an address over the limit", { address: "a".repeat(ADDRESS_MAX + 1) }],
    ["a salon name over the limit", { salon: "n".repeat(NAME_MAX + 1) }],
  ] as Array<[string, Apply]>)("%s is refused and writes nothing", async (_n, a) => {
    const l = await newLogin();
    expect(await asLoginCode(l, applySql(a))).toBe(BAD_INPUT);
    expect((await run("postgres", "select 1 from public.salon_signup_request where user_id = $1", [l.id])).rows).toEqual([]);
  });

  it("a password session cannot apply: only the emailed code proves the mailbox", async () => {
    const l = await newLogin();
    expect(await asLoginCode(l, applySql(), "password")).toBe(DENIED);
  });

  it("anon cannot apply", async () => {
    expect(await sqlstate("anon" as Who, applySql())).toBe(DENIED);
  });

  it("a login whose email is not confirmed cannot apply", async () => {
    const l = await newLogin({ confirmed: false });
    expect(await asLoginCode(l, applySql())).toBe(BAD_INPUT);
  });

  it.each([
    ["repA", REP_A],
    ["a suspended rep", SUSPENDED],
    ["the manager", MANAGER],
    ["the owner", OWNER],
  ] as Array<[string, Who]>)("staff (%s) cannot apply: no request is made for a staff login", async (_n, who) => {
    const code = await sqlstate(who, applySql());
    expect(code).not.toBeNull();
    expect(
      (
        await run(
          "postgres",
          "select 1 from public.salon_signup_request where email like '%@example.test' and user_id in (select id from public.user_profile)",
        )
      ).rows,
    ).toEqual([]);
  });

  it("a real rep, signed in with the emailed code, cannot apply: it reaches the staff check and writes nothing", async () => {
    const email = `rep.${tag()}@example.test`;
    const invited = await run(MANAGER, "select app.office_invite($1, 'rep', '[Test] Real rep', $2) as r", [uuid(), email], C);
    const rep = await newLogin({ email });
    await asLoginRows(rep, `select app.redeem_invitation(${quote(invited.rows[0].r.token)})`, C);
    expect(await asLoginCode(rep, applySql())).toBe(WRONG_STATE);
    expect((await run("postgres", "select 1 from public.salon_signup_request where user_id = $1", [rep.id])).rows).toEqual([]);
  });

  it("a login that already has a salon account cannot apply for a second one", async () => {
    const salon = uuid();
    await run(
      MANAGER,
      "select app.create_salon($1, $2, 'unisex', $3, 'manual')",
      [salon, `[Test] Has account ${tag()}`, AREA],
      C,
    );
    const email = `member.${tag()}@example.test`;
    const invited = await run(
      MANAGER,
      "select app.office_invite($1, 'salon', '[Test] Member', $2, $3) as r",
      [uuid(), email, salon],
      C,
    );
    const member = await newLogin({ email });
    await asLoginRows(member, `select app.redeem_invitation(${quote(invited.rows[0].r.token)})`, C);
    expect(await asLoginCode(member, applySql())).toBe(WRONG_STATE);
    expect((await run("postgres", "select 1 from public.salon_signup_request where user_id = $1", [member.id])).rows).toEqual([]);
  });

  it("a login with a live invitation is told to use the invitation", async () => {
    const email = `invited.${tag()}@example.test`;
    await run(MANAGER, "select app.office_invite($1, 'rep', '[Test] Invited rep', $2)", [uuid(), email], C);
    const l = await newLogin({ email });
    expect(await asLoginCode(l, applySql())).toBe(WRONG_STATE);
  });

  it("a password set on the address before is cleared: the code is the only way in afterwards", async () => {
    const l = await newLogin({ password: "squatter-password-1234" });
    await asLoginRows(l, applySql(), C);
    const u = (await run("postgres", "select encrypted_password from auth.users where id = $1", [l.id])).rows[0];
    expect(u.encrypted_password).toBe("");
  });
});

describe("what an applicant can reach", () => {
  it("is told it is waiting, by name, and nothing else", async () => {
    const { login } = await applicant({ salon: "[Test] Waiting Salon" });
    expect(await status(login)).toEqual({ membership_status: "applied", name: "[Test] Waiting Salon" });
    expect((await asLoginRows(login, "select app.salon_me() as m"))[0].m).toBeNull();
  });

  it.each([
    ["the catalogue", "select * from app.salon_catalogue()"],
    ["its account", "select app.salon_my_account()"],
    ["its orders", "select * from app.salon_my_orders()"],
    ["its requests", "select * from app.salon_my_requests()"],
  ])("cannot read %s", async (_n, sql) => {
    const { login } = await applicant();
    expect(await asLoginCode(login, sql)).toBe(DENIED);
  });

  it("cannot read or write the request table, or any relation", async () => {
    const { login } = await applicant();
    expect(await asLoginCode(login, "select * from public.salon_signup_request")).toBe(DENIED);
    expect(await asLoginCode(login, "update public.salon_signup_request set status = 'approved'")).toBe(DENIED);
    expect(
      await asLoginCode(
        login,
        `insert into public.salon_signup_request (client_id, user_id, email, contact_name, salon_name, type, address)
         values (gen_random_uuid(), '${login.id}', 'x@example.test', 'Xx', 'Xx', 'unisex', 'xxxxx')`,
      ),
    ).toBe(DENIED);
    const all = await run("postgres", ALL_RELATIONS);
    expect(all.rows.length).toBeGreaterThan(SWEEP_MINIMUM);
    const tables = (all.rows as Array<{ t: string }>)
      .map((x) => x.t)
      .filter((t) => !t.startsWith("app.") && !t.startsWith("vault_api."));
    await Promise.all(
      tables.map(async (t) => {
        const code = await asLoginCode(login, `select 1 from ${t} limit 1`);
        expect(code === DENIED || code === "42P01" || code === null, `${t}: ${code}`).toBe(true);
        if (code === null) {
          const seen = await asLoginRows(login, `select count(*)::int n from ${t}`);
          expect(seen[0].n, `${t} showed rows to an applicant`).toBe(0);
        }
      }),
    );
  });

  it("cannot approve its own request", async () => {
    const { login, request } = await applicant();
    expect(await asLoginCode(login, decideSql(request))).toBe(DENIED);
    expect((await requestRow(request)).status).toBe("pending");
  });
});

describe("the office lists and decides", () => {
  it.each([
    ["manager", MANAGER],
    ["owner", OWNER],
  ] as Array<[string, Who]>)("%s sees the pending request with its details", async (_n, who) => {
    const { request } = await applicant({ salon: "[Test] Listed Salon", contact: "[Test] Lister", type: "mens_salon" });
    const rows = (await run(who, "select * from app.office_pending_signups()")).rows;
    const mine = rows.find((r) => r.request_id === request);
    expect(mine).toMatchObject({ salon_name: "[Test] Listed Salon", contact_name: "[Test] Lister", type: "mens_salon" });
    expect(mine?.similar_salons).toEqual([]);
  });

  it.each(REFUSED)("%s cannot list or decide", async (_n, who) => {
    const { request } = await applicant();
    expect(await sqlstate(who, "select * from app.office_pending_signups()")).toBe(DENIED);
    expect(await sqlstate(who, decideSql(request))).toBe(DENIED);
    expect((await requestRow(request)).status).toBe("pending");
  });

  it("the list shows an imported salon of the same name that has no account, as a match", async () => {
    const name = `[Test] Twin ${tag()}`;
    const salon = uuid();
    await run(MANAGER, "select app.create_salon($1, $2, 'unisex', $3, 'excel_import')", [salon, name, AREA], C);
    const { request } = await applicant({ salon: name });
    const mine = (await run(MANAGER, "select * from app.office_pending_signups()")).rows.find((r) => r.request_id === request);
    expect(mine?.similar_salons).toEqual([expect.objectContaining({ id: salon, name })]);
  });

  it("approving with an area makes the salon, approved, and the login's account", async () => {
    const { login, request } = await applicant({
      salon: "[Test] New Approved",
      contact: "[Test] Owner One",
      type: "bridal_studio",
      address: "9 Bridal Road",
    });
    const r = await decide(MANAGER, request);
    expect(r).toMatchObject({ request_id: request, status: "approved" });
    const salon = (await run("postgres", "select * from public.salon where id = $1", [r.salon_id])).rows[0];
    expect(salon).toMatchObject({
      name: "[Test] New Approved",
      type: "bridal_studio",
      address: "9 Bridal Road",
      area_id: AREA,
      approval_status: "approved",
      source: "manual",
      created_by: fx.manager.id,
    });
    const m = (await run("postgres", "select * from public.salon_membership where user_id = $1", [login.id])).rows[0];
    expect(m).toMatchObject({
      salon_id: r.salon_id,
      signup_request_id: request,
      invitation_id: null,
      status: "active",
      full_name: "[Test] Owner One",
    });
    const row = await requestRow(request);
    expect(row).toMatchObject({ status: "approved", salon_id: r.salon_id, decided_by: fx.manager.id });
    // the applicant is in: the portal opens
    expect((await asLoginRows(login, "select app.salon_me() as m"))[0].m).toMatchObject({
      name: "[Test] New Approved",
      approval_status: "approved",
      membership_status: "active",
    });
    expect(await asLoginCode(login, "select * from app.salon_catalogue()")).toBeNull();
    expect((await status(login))?.membership_status).toBe("active");
  });

  it("the owner can approve too, with a rep and a rate", async () => {
    const { request } = await applicant();
    const r = await decide(OWNER, request, { rep: fx.repA.id, rate: RATE_BP });
    const a = (
      await run("postgres", "select rep_id, rate_bp, assigned_by from public.salon_rep_assignment where salon_id = $1", [
        r.salon_id,
      ])
    ).rows;
    expect(a).toEqual([{ rep_id: fx.repA.id, rate_bp: RATE_BP, assigned_by: fx.owner.id }]);
  });

  it("approving can attach the login to an imported salon that has no account", async () => {
    const salon = uuid();
    await run(
      MANAGER,
      "select app.create_salon($1, $2, 'unisex', $3, 'excel_import')",
      [salon, `[Test] Imported ${tag()}`, AREA],
      C,
    );
    const before = (await run("postgres", "select count(*)::int n from public.salon")).rows[0].n;
    const { login, request } = await applicant({ salon: "[Test] Whatever Name" });
    const r = await decide(MANAGER, request, { area: null, salon });
    expect(r.salon_id).toBe(salon);
    expect((await run("postgres", "select count(*)::int n from public.salon")).rows[0].n).toBe(before);
    expect(
      (await run("postgres", "select salon_id, signup_request_id from public.salon_membership where user_id = $1", [login.id]))
        .rows[0],
    ).toEqual({ salon_id: salon, signup_request_id: request });
  });

  it("a salon that already has an account cannot be attached to (one login per salon)", async () => {
    const first = await applicant();
    const r = await decide(MANAGER, first.request);
    const second = await applicant();
    expect(await sqlstate(MANAGER, decideSql(second.request, { area: null, salon: r.salon_id }))).toBe(WRONG_STATE);
    expect((await requestRow(second.request)).status).toBe("pending");
  });

  it("an unknown salon, an unknown area and an unknown request are refused, writing nothing", async () => {
    const { request } = await applicant();
    expect(await sqlstate(MANAGER, decideSql(request, { area: null, salon: uuid() }))).toBe(BAD_INPUT);
    expect(await sqlstate(MANAGER, decideSql(request, { area: uuid() }))).toBe(BAD_INPUT);
    expect(await sqlstate(MANAGER, decideSql(uuid()))).toBe(BAD_INPUT);
    expect((await requestRow(request)).status).toBe("pending");
    expect((await run("postgres", "select 1 from public.salon_membership where signup_request_id = $1", [request])).rows).toEqual(
      [],
    );
  });

  it.each([
    ["both an area and a salon", { area: AREA, salon: uuid() }],
    ["neither an area nor a salon", { area: null }],
    ["a rate without a rep", { rate: SMALL_RATE_BP }],
    ["a rate above 100 percent", { rep: fx.repA.id, rate: RATE_MAX_BP + 1 }],
    ["a suspended rep", { rep: fx.suspendedRep.id }],
    ["a reason over the limit", { reason: "r".repeat(REASON_MAX + 1) }],
  ] as Array<[string, Decide]>)("approving with %s is refused, writing nothing", async (_n, d) => {
    const { request } = await applicant();
    expect(await sqlstate(MANAGER, decideSql(request, d))).toBe(BAD_INPUT);
    expect((await requestRow(request)).status).toBe("pending");
  });

  it("rejecting needs a reason of at least 5 characters, and takes no area, salon, rep or rate", async () => {
    const { request } = await applicant();
    const bad = [{ reason: null }, { reason: "   " }, { reason: "no" }, { reason: "r".repeat(REASON_MAX + 1) }];
    const codes = await Promise.all(bad.map((d) => sqlstate(MANAGER, decideSql(request, { approve: false, area: null, ...d }))));
    expect(codes).toEqual(bad.map(() => BAD_INPUT));
    expect(await sqlstate(MANAGER, decideSql(request, { approve: false, reason: REASON, area: AREA }))).toBe(BAD_INPUT);
    expect(await sqlstate(MANAGER, decideSql(request, { approve: false, reason: REASON, area: null, rep: fx.repA.id }))).toBe(
      BAD_INPUT,
    );
    expect((await requestRow(request)).status).toBe("pending");
  });

  it("a rejected applicant is told so, gets no salon or account, and cannot apply again", async () => {
    const { login, request } = await applicant({ salon: "[Test] Rejected Salon" });
    const r = await decide(MANAGER, request, { approve: false, reason: REASON, area: null });
    expect(r).toEqual({ request_id: request, status: "rejected", salon_id: null });
    expect(await status(login)).toEqual({ membership_status: "application_rejected", name: "[Test] Rejected Salon" });
    expect(JSON.stringify(await status(login))).not.toContain(REASON);
    expect((await run("postgres", "select 1 from public.salon where name = '[Test] Rejected Salon'")).rows).toEqual([]);
    expect((await run("postgres", "select 1 from public.salon_membership where user_id = $1", [login.id])).rows).toEqual([]);
    expect(await asLoginCode(login, "select * from app.salon_catalogue()")).toBe(DENIED);
    expect(await asLoginCode(login, applySql())).toBe(WRONG_STATE);
  });

  it("a request is decided once", async () => {
    const { request } = await applicant();
    await decide(MANAGER, request);
    expect(await sqlstate(OWNER, decideSql(request))).toBe(WRONG_STATE);
    expect(await sqlstate(OWNER, decideSql(request, { approve: false, reason: REASON, area: null }))).toBe(WRONG_STATE);
    const { request: second } = await applicant();
    await decide(MANAGER, second, { approve: false, reason: REASON, area: null });
    expect(await sqlstate(OWNER, decideSql(second))).toBe(WRONG_STATE);
  });

  it("a replay of the same decision returns the same answer and makes one salon; another content is refused", async () => {
    const { request } = await applicant({ salon: `[Test] Once ${tag()}` });
    const client = uuid();
    const first = await decide(MANAGER, request, { client });
    const again = await decide(MANAGER, request, { client });
    expect(again).toEqual(first);
    expect(
      (await run("postgres", "select count(*)::int n from public.salon_membership where signup_request_id = $1", [request]))
        .rows[0].n,
    ).toBe(1);
    expect(await sqlstate(MANAGER, decideSql(request, { client, approve: false, reason: REASON, area: null }))).toBe(DUPLICATE);
    expect(await sqlstate(OWNER, decideSql(request, { client }))).toBe(DUPLICATE);
    expect(await sqlstate(MANAGER, decideSql(uuid(), { client }))).toBe(DUPLICATE);
  });

  it("each step is audited with the session's own login as the actor, and the chain verifies", async () => {
    const { login, request } = await applicant();
    await decide(MANAGER, request);
    const audit = await run(
      "postgres",
      "select e.actor_id, e.purpose from control.audit_event e where e.table_name = 'public.salon_signup_request' and e.row_id = $1 order by e.seq",
      [request],
    );
    expect(audit.rows).toEqual([
      { actor_id: login.id, purpose: "salon signup" },
      { actor_id: fx.manager.id, purpose: "salon signup approved" },
    ]);
    expect((await verify()).ok).toBe(true);
  });
});

describe("the table keeps its promises", () => {
  it("facts cannot change, even for the table's owner", async () => {
    const { request } = await applicant();
    const sets = ["salon_name = 'Changed'", "email = 'changed@example.test'", "address = 'changed address'", "type = 'barber'"];
    const codes = await Promise.all(
      sets.map((set) => sqlstate("postgres" as Who, `update public.salon_signup_request set ${set} where id = '${request}'`)),
    );
    expect(codes).toEqual(sets.map(() => DENIED));
  });

  it("a decided request cannot move back or sideways, and nothing deletes or truncates", async () => {
    const { request } = await applicant();
    await decide(MANAGER, request);
    expect(
      await sqlstate("postgres" as Who, `update public.salon_signup_request set status = 'pending' where id = '${request}'`),
    ).toBe(DENIED);
    expect(
      await sqlstate("postgres" as Who, `update public.salon_signup_request set status = 'rejected' where id = '${request}'`),
    ).toBe(DENIED);
    expect(await sqlstate("postgres" as Who, `delete from public.salon_signup_request where id = '${request}'`)).toBe(DENIED);
    // Postgres refuses a TRUNCATE of a table another table references (0A000) before any trigger runs, so the
    // trigger is checked in the catalog as well: a BEFORE TRUNCATE statement trigger (tgtype bit 32) exists.
    expect([DENIED, FEATURE_NOT_SUPPORTED]).toContain(await sqlstate("postgres" as Who, "truncate public.salon_signup_request"));
    const guard = await run(
      "postgres",
      `select count(*)::int n from pg_trigger
       where tgrelid = 'public.salon_signup_request'::regclass and not tgisinternal and (tgtype & ${TRUNCATE_TRIGGER}) = ${TRUNCATE_TRIGGER}`,
    );
    expect(guard.rows[0].n).toBe(1);
  });

  it("a pending request cannot be marked approved by hand (the shape check wants a decider and a salon)", async () => {
    const { request } = await applicant();
    const code = await sqlstate(
      "postgres" as Who,
      `update public.salon_signup_request set status = 'approved' where id = '${request}'`,
    );
    expect(code).toBe(CHECK_VIOLATION);
  });

  it("a membership has exactly one source: an invitation or a signup request", async () => {
    const l = await newLogin();
    const salon = uuid();
    await run(MANAGER, "select app.create_salon($1, $2, 'unisex', $3, 'manual')", [salon, `[Test] Source ${tag()}`, AREA], C);
    expect(
      await sqlstate(
        "postgres" as Who,
        `insert into public.salon_membership (user_id, salon_id, full_name, email) values ('${l.id}', '${salon}', 'Nobody', 'n@example.test')`,
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("a membership's source cannot be changed", async () => {
    const { login, request } = await applicant();
    await decide(MANAGER, request);
    expect(
      await sqlstate(
        "postgres" as Who,
        `update public.salon_membership set signup_request_id = null where user_id = '${login.id}'`,
      ),
    ).toBe(DENIED);
  });

  it("nobody holds a privilege on the table, and anon cannot run any of the functions", async () => {
    const t = await run(
      "postgres",
      `select r, has_table_privilege(r, 'public.salon_signup_request', 'select, insert, update, delete') p
       from unnest(array['anon', 'authenticated', 'service_role']) r`,
    );
    expect(t.rows.every((x) => x.p === false)).toBe(true);
    const f = await run(
      "postgres",
      `select fn, has_function_privilege('anon', fn, 'execute') a, has_function_privilege('authenticated', fn, 'execute') u
       from unnest(array[
         'app.salon_apply(uuid, text, text, public.salon_type, text)',
         'app.office_pending_signups()',
         'app.office_decide_signup(uuid, uuid, boolean, text, uuid, uuid, uuid, integer)',
         'app.salon_login_status()']) fn`,
    );
    expect(f.rows.map((x) => [x.fn, x.a, x.u])).toEqual(f.rows.map((x) => [x.fn, false, true]));
  });

  it("self-signup never reaches the staff tables: the profile table holds nothing for an applicant", async () => {
    const { login } = await applicant();
    expect((await run("postgres", "select 1 from public.user_profile where id = $1", [login.id])).rows).toEqual([]);
    // RLS answers with no rows, not an error: an applicant sees no one's profile.
    expect((await asLoginRows(login, "select count(*)::int n from public.user_profile"))[0].n).toBe(0);
  });
});
