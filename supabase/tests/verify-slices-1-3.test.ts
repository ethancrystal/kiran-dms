/**
 * Independent verification of execution-map slices 1 to 3 (ACTIVITY C-023, L-0272): office shell
 * (devices, team, territories), the rep's working day, salons (list, detail, edit, notes, visits,
 * stages, phone reveal, park, office override). Written by a verifier that did not build them, to
 * try to break the controls of ACTIVITY §7 items 1 to 7 as they apply here.
 *
 * Every committed row uses fresh synthetic people, territories and salons made in this file
 * ([Test] names, example.test addresses, +92000… phones, H-03), so no other file's reps, days or
 * routes are touched. Assignments this file makes are ended in afterAll.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { fx, MANAGER, MANAGER_AAL1, OWNER, REP_A, REP_A_WRONG_DEVICE, run, SUSPENDED, sqlstate, type Who } from "./helpers/db";
import { claims } from "./setup/fixtures";

const C = { commit: true };
const id = () => randomUUID();
const tag = () => randomUUID().slice(0, 8);
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];

// ---------------------------------------------------------------- own personas ----
type P = { id: string; device: string; office: boolean };
const pool = new pg.Pool({ connectionString: inject("databaseUrl"), max: 2 });

/** Runs as one of this file's people, the way PostgREST does (role, JWT claims, device header). */
async function as(
  p: P,
  sql: string,
  params: unknown[] = [],
  o: { commit?: boolean; aal?: "aal1" | "aal2"; device?: string | null } = {},
) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const device = o.device === undefined ? p.device : o.device;
    await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)", [
      claims(p.id, o.aal ?? (p.office ? "aal2" : "aal1")),
      JSON.stringify(device ? { "x-kiran-device": device } : {}),
    ]);
    await c.query("set local role authenticated");
    const r = await c.query(sql, params);
    await c.query(o.commit ? "commit" : "rollback");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
const asC = (p: P, sql: string, params: unknown[] = [], o: { aal?: "aal1" | "aal2"; device?: string | null } = {}) =>
  as(p, sql, params, { ...o, commit: true });
async function stateOf(p: P, sql: string, params: unknown[] = [], o: { aal?: "aal1" | "aal2"; device?: string | null } = {}) {
  try {
    await as(p, sql, params, o);
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "unknown";
  }
}
const pg1 = async (sql: string, params: unknown[] = []) => (await run("postgres", sql, params)).rows;

const mk = (office = false): P => ({ id: id(), device: `dev-${id()}`, office });
const vMgr = mk(true); // a second manager, for self-approval
const rep1 = mk(); // territory TA, has a bag
const rep2 = mk(); // territory TB
const rep3 = mk(); // revocation, suspension and offboarding target

const TA = id(),
  TB = id(),
  AA1 = id(),
  AA2 = id(),
  AB1 = id();
const SA = id(); // rep1's salon in TA
const SB = id(); // rep2's salon in TB
const PHONE_A = "+920000007001";
let bag1: string;
let bag2: string;
let group: string;
let TODAY: string; // Karachi date, read as postgres (karachi_today is not granted to app roles)

async function register(p: P, device = p.device) {
  const r = await asC(p, "select (app.register_device($1, 'android', '[Test] phone')).id", [device], { device });
  return r.rows[0].id as string;
}

beforeAll(async () => {
  for (const [p, n] of [
    [vMgr, "mgr"],
    [rep1, "rep1"],
    [rep2, "rep2"],
    [rep3, "rep3"],
  ] as const) {
    await run("postgres", "insert into auth.users (id, email) values ($1, $2)", [p.id, `verify-${n}-${tag()}@example.test`], C);
  }
  await one(OWNER, "select app.owner_create_user($1, '[Test] Verify Manager', 'manager')", [vMgr.id]);
  await one(OWNER, "select app.owner_create_user($1, '[Test] Verify Rep 1', 'rep', '+920000007101')", [rep1.id]);
  await one(OWNER, "select app.owner_create_user($1, '[Test] Verify Rep 2', 'rep', '+920000007102')", [rep2.id]);
  await one(OWNER, "select app.owner_create_user($1, '[Test] Verify Rep 3', 'rep', '+920000007103')", [rep3.id]);
  for (const p of [rep1, rep2, rep3]) await one(MANAGER, "select app.approve_device($1, 'verify fixture')", [await register(p)]);

  bag1 = id();
  bag2 = id();
  await one(OWNER, "select app.office_create_location($1, 'rep_bag', '[Test] Verify bag 1', $2, 1000000)", [bag1, rep1.id]);
  await one(OWNER, "select app.office_create_location($1, 'rep_bag', '[Test] Verify bag 2', $2, 1000000)", [bag2, rep2.id]);

  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [TA, `[Test] Verify A ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [TB, `[Test] Verify B ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Verify area A1')", [AA1, TA]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Verify area A2')", [AA2, TA]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Verify area B1')", [AB1, TB]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [rep1.id, TA]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [rep2.id, TB]);

  await asC(
    rep1,
    `select app.create_salon($1, '[Test] Verify Salon A', 'ladies_parlor', $2, 'map_pin', '[Test] 1 Fake Street',
            24.9, 67.1, 4, '[Test] Contact', $3, '[Test] first chit')`,
    [SA, AA1, PHONE_A],
  );
  await asC(rep2, "select app.create_salon($1, '[Test] Verify Salon B', 'barber', $2, 'manual')", [SB, AB1]);
  group = id();
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, 30)", [group, `[Test] Verify group ${tag()}`]);
  TODAY = (await pg1("select app.karachi_today()::text d"))[0].d;
  await one(MANAGER, "select app.office_set_last_purchase($1, $2, $3::date - 60)", [SB, group, TODAY]);
});

afterAll(async () => {
  for (const [p, t] of [
    [rep1, TA],
    [rep2, TB],
  ] as const) {
    const cur = await pg1("select 1 from public.rep_territory where rep_id = $1 and territory_id = $2 and to_date is null", [
      p.id,
      t,
    ]);
    if (cur.length) await one(MANAGER, "select app.office_end_territory($1, $2, 'verify tests finished')", [p.id, t]);
  }
  await pool.end();
});

// ----------------------------------------------------------------- slice 1 ----
describe("slice 1: office functions refuse everyone but the right office user (H-15, A-03, doc 06 §2)", () => {
  const officeCalls: Array<[string, () => unknown[]]> = [
    ["select app.office_upsert_territory($1, '[Test] x territory')", () => [id()]],
    ["select app.office_upsert_area($1, $2, '[Test] x area')", () => [id(), TA]],
    ["select app.office_assign_territory($1, $2)", () => [rep2.id, TA]],
    ["select app.office_end_territory($1, $2, 'verify attack')", () => [rep1.id, TA]],
    ["select app.approve_device($1, 'verify attack')", () => [id()]],
    ["select app.office_override_stage($1, 'trial', 'verify attack')", () => [SA]],
    ["select app.duplicate_phones()", () => []],
  ];
  const ownerCalls: Array<[string, () => unknown[]]> = [
    ["select app.owner_create_user($1, '[Test] Intruder', 'manager')", () => [fx.repB.id]],
    ["select app.owner_set_status($1, 'suspended', 'verify attack')", () => [rep2.id]],
    ["select app.owner_set_status($1, 'active', 'verify attack')", () => [fx.suspendedRep.id]],
  ];
  const outsiders: Array<[string, Who]> = [
    ["rep A", REP_A],
    ["rep A on an unapproved phone", REP_A_WRONG_DEVICE],
    ["suspended rep", SUSPENDED],
    ["manager at AAL1", MANAGER_AAL1],
    ["owner at AAL1", { as: "owner", aal: "aal1" }],
    ["anon", "anon"],
  ];

  for (const [label, who] of outsiders) {
    it(`${label} is refused every slice 1 office and owner function`, async () => {
      for (const [sql, args] of [...officeCalls, ...ownerCalls]) {
        expect([label, sql, await sqlstate(who, sql, args())]).toEqual([label, sql, "42501"]);
      }
    });
  }

  it("the manager (AAL2) is refused every owner-only function, on others, on the owner and on itself", async () => {
    for (const [sql, args] of ownerCalls) expect(await sqlstate(MANAGER, sql, args())).toBe("42501");
    expect(await sqlstate(MANAGER, "select app.owner_set_status($1, 'suspended', 'verify attack')", [fx.owner.id])).toBe("42501");
    expect(await sqlstate(MANAGER, "select app.owner_set_status($1, 'active', 'verify attack')", [fx.manager.id])).toBe("42501");
    expect(await sqlstate(MANAGER, "select app.owner_create_user($1, '[Test] Self', 'owner')", [fx.manager.id])).toBe("42501");
    // Nothing changed behind the refusals.
    expect((await pg1("select status from public.user_profile where id = $1", [rep2.id]))[0].status).toBe("active");
  });

  it("the owner cannot change its own status (no self-lockout or self-reactivation)", async () => {
    expect(await sqlstate(OWNER, "select app.owner_set_status($1, 'suspended', 'verify attack')", [fx.owner.id])).toBe("42501");
  });
});

describe("slice 1: devices (SEC-03, H-12 spirit: nobody approves their own)", () => {
  it("a manager registers a phone and cannot approve it; another office user can", async () => {
    const dev = await register(vMgr);
    expect(await stateOf(vMgr, "select app.approve_device($1, 'self')", [dev])).toBe("42501");
    expect((await pg1("select status from public.device where id = $1", [dev]))[0].status).toBe("pending");
    await one(OWNER, "select app.approve_device($1, 'verify: other office user')", [dev]);
    expect((await pg1("select status, approved_by from public.device where id = $1", [dev]))[0]).toEqual({
      status: "approved",
      approved_by: fx.owner.id,
    });
  });

  it("a rep cannot approve its own pending phone, nor anyone else's", async () => {
    const second = `dev-${id()}`;
    const dev = await register(rep3, second);
    expect(await stateOf(rep3, "select app.approve_device($1, 'self')", [dev])).toBe("42501");
    expect(await stateOf(rep3, "select app.approve_device($1, 'self')", [dev], { device: second })).toBe("42501");
    // The pending phone cannot act: every rep read is empty and every rep write refused.
    expect((await as(rep3, "select * from app.my_areas()", [], { device: second })).rows).toEqual([]);
    expect(await stateOf(rep3, "select app.rep_check_in('[]')", [], { device: second })).toBe("42501");
    await one(MANAGER, "select app.revoke_device($1, 'verify cleanup')", [dev]);
  });

  it("a rep cannot revoke another person's phone; a revoked phone is dead at once and for good", async () => {
    const victim = (await pg1("select id from public.device where user_id = $1 and status = 'approved'", [rep2.id]))[0].id;
    expect(await stateOf(rep3, "select app.revoke_device($1, 'verify attack')", [victim])).toBe("42501");
    expect((await pg1("select status from public.device where id = $1", [victim]))[0].status).toBe("approved");

    const mine = (await pg1("select id from public.device where user_id = $1 and status = 'approved'", [rep3.id]))[0].id;
    await one(MANAGER, "select app.revoke_device($1, 'verify: lost phone')", [mine]);
    expect(await stateOf(rep3, "select app.rep_check_in('[]')")).toBe("42501");
    expect((await as(rep3, "select * from app.my_salons()")).rows).toEqual([]);
    expect(await sqlstate(MANAGER, "select app.approve_device($1, 'verify: re-approve')", [mine])).toBe("42501");
    expect(await stateOf(rep3, "select app.register_device($1)", [rep3.device])).toBe("42501");
    // A fresh id is pending again and needs an office approval.
    const fresh = `dev-${id()}`;
    const again = await register(rep3, fresh);
    expect((await pg1("select status from public.device where id = $1", [again]))[0].status).toBe("pending");
    await one(MANAGER, "select app.approve_device($1, 'verify: new phone')", [again]);
    rep3.device = fresh;
    expect((await as(rep3, "select app.my_session() s")).rows[0].s.device_status).toBe("approved");
  });

  it("suspending a rep locks it out at once and revokes every phone; reactivation does not revive them", async () => {
    await one(OWNER, "select app.owner_set_status($1, 'suspended', 'verify: suspended')", [rep3.id]);
    expect(
      (await pg1("select count(*)::int n from public.device where user_id = $1 and status <> 'revoked'", [rep3.id]))[0].n,
    ).toBe(0);
    expect(await stateOf(rep3, "select app.rep_check_in('[]')")).toBe("42501");
    expect(await stateOf(rep3, "select app.register_device($1)", [`dev-${id()}`])).toBe("42501");
    expect((await as(rep3, "select * from app.my_areas()")).rows).toEqual([]);
    await one(OWNER, "select app.owner_set_status($1, 'active', 'verify: back')", [rep3.id]);
    expect(await stateOf(rep3, "select app.rep_check_in('[]')")).toBe("42501");
    expect((await as(rep3, "select app.my_session() s")).rows[0].s.device_status).toBe("revoked");
  });

  it("offboarding revokes every phone, and an offboarded rep can do nothing", async () => {
    const fresh = `dev-${id()}`;
    const dev = await register(rep3, fresh);
    await one(MANAGER, "select app.approve_device($1, 'verify')", [dev]);
    rep3.device = fresh;
    await one(OWNER, "select app.owner_set_status($1, 'offboarded', 'verify: left the company')", [rep3.id]);
    expect(
      (await pg1("select count(*)::int n from public.device where user_id = $1 and status <> 'revoked'", [rep3.id]))[0].n,
    ).toBe(0);
    for (const sql of [
      "select app.rep_check_in('[]')",
      "select app.register_device('dev-0123456789abcdef')",
      "select app.reveal_phone(gen_random_uuid())",
    ]) {
      expect(await stateOf(rep3, sql)).toBe("42501");
    }
    expect(await sqlstate(MANAGER, "select app.office_assign_territory($1, $2)", [rep3.id, TA])).toBe("22023");
  });
});

// ----------------------------------------------------------------- slice 3 ----
describe("slice 3: territory scoping of every salon read and write (H-14, doc 06 §4, ACTIVITY §7 item 4)", () => {
  const reads = [
    "select count(*)::int n from app.my_salon($1)",
    "select count(*)::int n from app.salon_notes($1)",
    "select count(*)::int n from app.salon_visits($1)",
    "select count(*)::int n from app.salon_stages($1)",
  ];

  it("rep 2 reads nothing of rep 1's salon through any function, and every write is refused", async () => {
    for (const sql of reads) expect((await as(rep2, sql, [SA])).rows[0].n).toBe(0);
    expect((await as(rep2, "select count(*)::int n from app.my_salons() where id = $1", [SA])).rows[0].n).toBe(0);
    const writes: Array<[string, unknown[]]> = [
      ["select app.reveal_phone($1)", [SA]],
      ["select app.update_salon($1, '[Test] hijack', 'barber', $2)", [SA, AB1]],
      ["select app.update_salon($1, null, 'ladies_parlor', $2)", [SA, AA1]],
      ["select app.add_salon_note($1, $2, '[Test] hijack')", [id(), SA]],
      ["select app.rep_park_salon($1, 'verify attack')", [SA]],
      ["select app.rep_add_stop($1)", [SA]],
    ];
    for (const [sql, params] of writes) expect([sql, await stateOf(rep2, sql, params)]).toEqual([sql, "42501"]);
  });

  it("a rep cannot move its salon into another territory's area or into an inactive area of its own", async () => {
    expect(await stateOf(rep1, "select app.update_salon($1, null, 'ladies_parlor', $2)", [SA, AB1])).toBe("42501");
    await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Verify area A2', false)", [AA2, TA]);
    expect(await stateOf(rep1, "select app.update_salon($1, null, 'ladies_parlor', $2)", [SA, AA2])).toBe("42501");
    await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Verify area A2', true)", [AA2, TA]);
    expect((await pg1("select area_id from public.salon where id = $1", [SA]))[0].area_id).toBe(AA1);
  });

  it("my_salon gives exactly the rows my_salons gives the same rep, masked, and nothing to anyone else", async () => {
    const list = (await as(rep1, "select id, phone_masked from app.my_salons()")).rows;
    expect(list.map((r) => r.id)).toContain(SA);
    for (const r of list) {
      const d = (await as(rep1, "select id, phone_masked, address, chairs from app.my_salon($1)", [r.id])).rows;
      expect(d).toHaveLength(1);
      expect(d[0].phone_masked).toBe(r.phone_masked);
    }
    const a = (await as(rep1, "select phone_masked, address, chairs from app.my_salon($1)", [SA])).rows[0];
    expect(a.phone_masked).not.toBe(PHONE_A);
    expect(a.phone_masked).toMatch(/\*/);
    expect(a).toMatchObject({ address: "[Test] 1 Fake Street", chairs: 4 });
    for (const who of [OWNER, MANAGER, MANAGER_AAL1, SUSPENDED, REP_A, REP_A_WRONG_DEVICE] as Who[]) {
      expect((await run(who, "select count(*)::int n from app.my_salon($1)", [SA])).rows[0].n).toBe(0);
    }
    expect((await as(rep1, "select count(*)::int n from app.my_salon($1)", [SA], { device: `dev-${id()}` })).rows[0].n).toBe(0);
    expect(await sqlstate("anon", "select * from app.my_salon($1)", [SA])).toBe("42501");
  });

  it("due_list and my_route cannot be widened to another territory by a parameter", async () => {
    expect((await as(rep2, "select count(*)::int n from app.due_list(null, null) where salon_id = $1", [SB])).rows[0].n).toBe(1);
    expect((await as(rep1, "select count(*)::int n from app.due_list(null, $1)", [TB])).rows[0].n).toBe(0);
    expect((await as(rep1, "select count(*)::int n from app.due_list(null, null) where salon_id = $1", [SB])).rows[0].n).toBe(0);
    expect((await as(rep1, "select count(*)::int n from app.my_route($1::date)", [TODAY])).rows[0].n).toBe(0);
  });

  it("the office reads salon and salon_contact only at AAL2; reps, AAL1 office users and the suspended read nothing", async () => {
    for (const [who, n] of [
      [OWNER, 1],
      [MANAGER, 1],
      [MANAGER_AAL1, 0],
      [{ as: "owner", aal: "aal1" }, 0],
      [REP_A, 0],
      [SUSPENDED, 0],
    ] as Array<[Who, number]>) {
      expect((await run(who, "select count(*)::int n from public.salon where id = $1", [SA])).rows[0].n).toBe(n);
      expect((await run(who, "select count(*)::int n from public.salon_contact where salon_id = $1", [SA])).rows[0].n).toBe(n);
    }
    expect((await as(rep1, "select count(*)::int n from public.salon where id = $1", [SA])).rows[0].n).toBe(0);
    expect((await as(rep1, "select count(*)::int n from public.salon_contact")).rows[0].n).toBe(0);
    expect(await sqlstate("anon", "select count(*) from public.salon")).toBe("42501");
  });

  it("no role writes the slice tables directly: owner, manager and rep get 42501 on INSERT, UPDATE and DELETE", async () => {
    const stmts: Array<[string, unknown[]]> = [
      ["update public.salon set name = '[Test] direct' where id = $1", [SA]],
      ["update public.salon set lat = 1, lng = 1 where id = $1", [SA]],
      ["delete from public.salon where id = $1", [SA]],
      [
        "insert into public.salon (id, type, area_id, source, created_by) values (gen_random_uuid(), 'barber', $1, 'manual', auth.uid())",
        [AA1],
      ],
      ["update public.salon_contact set phone = '+920000009999' where salon_id = $1", [SA]],
      [
        "insert into public.salon_note (client_id, salon_id, author_id, body) values (gen_random_uuid(), $1, auth.uid(), '[Test] x')",
        [SA],
      ],
      [
        "insert into public.stage_event (salon_id, from_stage, to_stage, trigger, reason) values ($1, 'prospect', 'trial', 'manual', 'direct')",
        [SA],
      ],
      ["update public.rep_territory set to_date = current_date, ended_by = auth.uid() where territory_id = $1", [TA]],
      ["insert into public.rep_territory (rep_id, territory_id, assigned_by) values (auth.uid(), $1, auth.uid())", [TB]],
      ["update public.territory set active = false where id = $1", [TB]],
      ["update public.area set territory_id = $1 where id = $2", [TA, AB1]],
      ["update public.device set status = 'approved' where user_id = auth.uid()", []],
      ["update public.user_profile set role = 'owner' where id = auth.uid()", []],
      ["insert into public.rep_day (rep_id, day) values (auth.uid(), current_date - 3)", []],
      ["delete from control.phone_reveal", []],
    ];
    for (const who of [OWNER, MANAGER] as Who[]) {
      for (const [sql, params] of stmts) expect([sql, await sqlstate(who, sql, params)]).toEqual([sql, "42501"]);
    }
    for (const [sql, params] of stmts) expect([sql, await stateOf(rep1, sql, params)]).toEqual([sql, "42501"]);
  });
});

describe("slices 2 and 3: the rep's day, visits, notes, park and override (PIP-02, PIP-09, INV-05, SAL-03, H-08, H-09)", () => {
  const PAST = "2020-01-01T08:00:00+05:00";
  const close = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) < 10 * 60_000;

  it("check-in is one open day: a second check-in returns the same day; a backdated client time stays evidence", async () => {
    // Half a GPS fix is refused (the pair check), and leaves no day behind.
    expect(await stateOf(rep1, "select app.rep_check_in('[]', 24.9, null)")).toBe("23514");
    const d1 = (await asC(rep1, "select (app.rep_check_in('[]', 24.9, 67.1, $1)).*", [PAST])).rows[0];
    const d2 = (await asC(rep1, "select (app.rep_check_in('[]', 24.9, 67.1, now())).*")).rows[0];
    expect(d2.id).toBe(d1.id);
    expect(close(new Date(d1.check_in_at), new Date())).toBe(true);
    expect(new Date(d1.check_in_at_client).toISOString()).toBe(new Date(PAST).toISOString());
    expect((await pg1("select app.karachi_today()::text = $1::date::text ok", [d1.day]))[0].ok).toBe(true);
    expect((await pg1("select count(*)::int n from public.rep_day where rep_id = $1", [rep1.id]))[0].n).toBe(1);
  });

  it("a visit needs GPS, is one row per client id, and a backdated arrival does not move the server time", async () => {
    expect(await stateOf(rep1, "select app.log_visit($1, $2, 'intro', null, null)", [id(), SA])).toBe("23502");
    const cid = id();
    const v1 = (await asC(rep1, "select (app.log_visit($1, $2, 'intro', 24.9001, 67.1001, $3)).*", [cid, SA, PAST])).rows[0];
    const v2 = (await asC(rep1, "select (app.log_visit($1, $2, 'intro', 24.9001, 67.1001, $3)).*", [cid, SA, PAST])).rows[0];
    expect(v2.id).toBe(v1.id);
    expect((await pg1("select count(*)::int n from public.visit where client_id = $1", [cid]))[0].n).toBe(1);
    expect(close(new Date(v1.arrived_at), new Date())).toBe(true);
    expect(new Date(v1.arrived_at_client).toISOString()).toBe(new Date(PAST).toISOString());
    expect(v1.rep_id).toBe(rep1.id);
    // Same client id, other outcome; other rep with the same id: refused, nothing written or revealed.
    expect(await stateOf(rep1, "select app.log_visit($1, $2, 'sample', 24.9, 67.1)", [cid, SA])).toBe("23505");
    expect(await stateOf(rep2, "select app.log_visit($1, $2, 'intro', 24.9, 67.1)", [cid, SA])).toBe("23505");
    expect(await stateOf(rep2, "select app.log_visit($1, $2, 'intro', 24.9, 67.1)", [id(), SA])).toBe("42501");
    // The first visit moved the stage, recorded with a visit trigger and rep1 as the actor.
    expect((await pg1("select stage from public.salon where id = $1", [SA]))[0].stage).toBe("visited");
  });

  it("create_salon and add_salon_note replay to one row; a reused id with other content or by another rep is refused", async () => {
    const sid = id();
    const create = `select (app.create_salon($1, '[Test] Verify Replay', 'barber', $2, 'manual', null, null, null, null,
                     null, null, null, $3)).*`;
    const s1 = (await asC(rep1, create, [sid, AA1, PAST])).rows[0];
    const s2 = (await asC(rep1, create, [sid, AA1, PAST])).rows[0];
    expect(s2.id).toBe(s1.id);
    expect(close(new Date(s1.created_at), new Date())).toBe(true);
    expect(new Date(s1.created_at_client).toISOString()).toBe(new Date(PAST).toISOString());
    expect((await pg1("select count(*)::int n from public.stage_event where salon_id = $1", [sid]))[0].n).toBe(1);
    expect(await stateOf(rep1, create, [sid, AA2, PAST])).toBe("23505");
    expect(await stateOf(rep2, create, [sid, AB1, PAST])).toBe("23505");
    // A rep cannot create in another territory's area or from an office-only source.
    expect(await stateOf(rep1, create, [id(), AB1, PAST])).toBe("42501");
    expect(await stateOf(rep1, "select app.create_salon($1, '[Test] x', 'barber', $2, 'excel_import')", [id(), AA1])).toBe(
      "42501",
    );
    expect(
      await stateOf(rep1, "select app.create_salon($1, '[Test] x', 'barber', $2, 'manual', null, 24.9, null)", [id(), AA1]),
    ).toBe("23514");

    const nid = id();
    const n1 = (await asC(rep1, "select (app.add_salon_note($1, $2, '[Test] verify note', $3)).*", [nid, SA, PAST])).rows[0];
    const n2 = (await asC(rep1, "select (app.add_salon_note($1, $2, '[Test] verify note', $3)).*", [nid, SA, PAST])).rows[0];
    expect(n2.id).toBe(n1.id);
    expect(close(new Date(n1.created_at), new Date())).toBe(true);
    expect(n1.author_id).toBe(rep1.id);
    expect(await stateOf(rep1, "select app.add_salon_note($1, $2, '[Test] other text')", [nid, SA])).toBe("23505");
    expect(await stateOf(rep2, "select app.add_salon_note($1, $2, '[Test] verify note')", [nid, SA])).toBe("23505");
    expect((await pg1("select count(*)::int n from public.salon_note where client_id = $1", [nid]))[0].n).toBe(1);
  });

  it("reveal_phone: own territory only, every rep reveal logged against the session's user; office needs AAL2", async () => {
    const before = (await pg1("select count(*)::int n from control.phone_reveal where salon_id = $1", [SA]))[0].n;
    expect((await asC(rep1, "select app.reveal_phone($1) p", [SA])).rows[0].p).toBe(PHONE_A);
    const after = await pg1("select actor_id from control.phone_reveal where salon_id = $1 order by created_at", [SA]);
    expect(after).toHaveLength(before + 1);
    expect(after[after.length - 1].actor_id).toBe(rep1.id);
    expect(await stateOf(rep2, "select app.reveal_phone($1)", [SA])).toBe("42501");
    expect(await sqlstate(MANAGER_AAL1, "select app.reveal_phone($1)", [SA])).toBe("42501");
    expect((await as(rep1, "select count(*)::int n from control.phone_reveal")).rows[0].n).toBe(0);
  });

  it("park: own acquisition-stage salon with a reason; reps never override; the office override needs AAL2 and a reason", async () => {
    expect(await stateOf(rep1, "select app.rep_park_salon($1, '  ')", [SA])).toBe("23514");
    expect(await stateOf(rep1, "select app.office_override_stage($1, 'active_new', 'verify attack')", [SA])).toBe("42501");
    await asC(rep1, "select app.rep_park_salon($1, '[Test] closed for renovation')", [SA]);
    expect(await sqlstate(MANAGER_AAL1, "select app.office_override_stage($1, 'prospect', 'verify attack')", [SA])).toBe("42501");
    expect(await sqlstate(MANAGER, "select app.office_override_stage($1, 'prospect', 'x')", [SA])).toBe("23514");
    await one(MANAGER, "select app.office_override_stage($1, 'visited', '[Test] reopened by the office')", [SA]);
    const ev = await pg1(
      "select to_stage, trigger, actor_id, reason from public.stage_event where salon_id = $1 order by created_at, id",
      [SA],
    );
    expect(ev.map((e) => e.to_stage)).toEqual(["prospect", "visited", "parked", "visited"]);
    expect(ev[2]).toMatchObject({ trigger: "manual", actor_id: rep1.id });
    expect(ev[3]).toMatchObject({ trigger: "manual", actor_id: fx.manager.id, reason: "[Test] reopened by the office" });
    // Rep cannot park a salon past the acquisition stages.
    await one(MANAGER, "select app.office_override_stage($1, 'active_new', '[Test] first order on paper')", [SA]);
    expect(await stateOf(rep1, "select app.rep_park_salon($1, 'verify attack')", [SA])).toBe("42501");
    await one(MANAGER, "select app.office_override_stage($1, 'visited', '[Test] back for the rest of the tests')", [SA]);
  });

  it("the route: a rep adds only own-territory salons, cannot reorder another rep's stops or a past day", async () => {
    const st = (await asC(rep1, "select (app.rep_add_stop($1)).*", [SA])).rows[0];
    const again = (await asC(rep1, "select (app.rep_add_stop($1)).*", [SA])).rows[0];
    expect(again.id).toBe(st.id);
    expect(await stateOf(rep1, "select app.rep_add_stop($1)", [SB])).toBe("42501");
    expect(await stateOf(rep2, "select app.rep_reorder_route($1::date, $2)", [TODAY, [st.id]])).toBe("22023");
    expect(await stateOf(rep1, "select app.rep_reorder_route($1::date - 1, $2)", [TODAY, [st.id]])).toBe("42501");
    expect((await as(rep2, "select count(*)::int n from app.my_route($1::date)", [TODAY])).rows[0].n).toBe(0);
  });

  it("check-out needs the evening close of the rep's own bag; after it, no visit, no second check-in", async () => {
    expect(await stateOf(rep1, "select app.rep_check_out()")).toBe("42501");
    expect(await stateOf(rep1, "select app.record_count($1, $2, 'daily_close', '[]')", [id(), bag2])).toBe("42501");
    expect(await stateOf(rep1, "select app.record_count($1, $2, 'spot_check', '[]')", [id(), bag1])).toBe("42501");
    expect((await as(rep1, "select app.my_bag_id() b")).rows[0].b).toBe(bag1);
    await asC(rep1, "select app.record_count($1, app.my_bag_id(), 'daily_close', '[]')", [id()]);
    const out = (await asC(rep1, "select (app.rep_check_out($1)).*", [PAST])).rows[0];
    expect(out.status).toBe("closed");
    expect(close(new Date(out.check_out_at), new Date())).toBe(true);
    expect((await asC(rep1, "select (app.rep_check_out()).status")).rows[0].status).toBe("closed");
    expect(await stateOf(rep1, "select app.rep_check_in('[]')")).toBe("42501");
    expect(await stateOf(rep1, "select app.log_visit($1, $2, 'intro', 24.9, 67.1)", [id(), SA])).toBe("42501");
    expect(await sqlstate(MANAGER, "select app.rep_check_out()")).toBe("42501");
  });
});

describe("slice 3: edits keep history and the audit chain (H-07, H-17)", () => {
  // Slice 7 (D-35, R3): reps no longer edit a salon. This was "a partial rep edit keeps the rest": the
  // rep's edit is now refused before anything else (42501, also for a half pin, which was 22023), and
  // the partial-edit rule is checked on the office's edit, which later tests of this file rely on.
  it("a rep's edit is refused; a partial office edit keeps the rest; a half pin is refused for the office", async () => {
    const repEdit = "select app.update_salon($1, '[Test] Verify Salon A2', 'ladies_parlor', $2, null, null, null, 6)";
    expect(await stateOf(rep1, repEdit, [SA, AA2])).toBe("42501");
    expect((await pg1("select area_id from public.salon where id = $1", [SA]))[0].area_id).toBe(AA1);
    await one(MANAGER, repEdit, [SA, AA2]);
    const s = (await pg1("select name, area_id, address, lat, lng, chairs from public.salon where id = $1", [SA]))[0];
    expect(s).toMatchObject({ name: "[Test] Verify Salon A2", area_id: AA2, address: "[Test] 1 Fake Street", chairs: 6 });
    expect([Number(s.lat), Number(s.lng)]).toEqual([24.9, 67.1]);
    expect(await stateOf(rep1, "select app.update_salon($1, null, 'ladies_parlor', $2, null, 25.0, null)", [SA, AA2])).toBe(
      "42501",
    );
    expect(await sqlstate(MANAGER, "select app.update_salon($1, null, 'ladies_parlor', $2, null, null, 67.0)", [SA, AA2])).toBe(
      "22023",
    );
    expect(await sqlstate(MANAGER_AAL1, "select app.update_salon($1, null, 'ladies_parlor', $2)", [SA, AA2])).toBe("42501");
  });

  it("every slice write is in the audit log under the session's user and device, a rep cannot read it, and the chain verifies", async () => {
    const ev = await pg1(
      "select action, actor_id, purpose, device_id from control.audit_event where table_name = 'public.salon' and row_id = $1 order by seq",
      [SA],
    );
    // Slice 7: a rep's new salon is a proposal (purpose "salon proposed"), and the edit is the office's.
    expect(ev[0]).toMatchObject({ action: "INSERT", actor_id: rep1.id, purpose: "salon proposed" });
    expect(ev[0].device_id).toBe((await pg1("select app.fingerprint_hash($1) h", [rep1.device]))[0].h);
    const edit = ev.find((e) => e.purpose === "salon edited");
    expect(edit).toMatchObject({ action: "UPDATE", actor_id: fx.manager.id });
    expect(ev.some((e) => e.actor_id === fx.manager.id && String(e.purpose).startsWith("stage override"))).toBe(true);
    for (const t of [
      "public.rep_territory",
      "public.device",
      "public.user_profile",
      "public.visit",
      "public.salon_note",
      "public.rep_day",
      "control.phone_reveal",
    ]) {
      expect([t, (await pg1("select count(*)::int n from control.audit_event where table_name = $1", [t]))[0].n > 0]).toEqual([
        t,
        true,
      ]);
    }
    expect(
      (
        await pg1(
          "select count(*)::int n from control.audit_event where table_name = 'public.user_profile' and row_id = $1 and purpose like 'set status%'",
          [rep3.id],
        )
      )[0].n,
    ).toBeGreaterThanOrEqual(3);
    // Owner-only at AAL2 (doc 06 §2, H-15): the rep and the manager see no audit row.
    expect((await as(rep1, "select count(*)::int n from control.audit_event")).rows[0].n).toBe(0);
    expect((await run(MANAGER, "select count(*)::int n from control.audit_event")).rows[0].n).toBe(0);
    expect(
      (await run(OWNER, "select count(*)::int n from control.audit_event where row_id = $1", [SA])).rows[0].n,
    ).toBeGreaterThan(0);
    expect(await sqlstate(OWNER, "select * from control.verify_audit_chain()")).toBe("42501");
    expect((await pg1("select ok from control.verify_audit_chain()"))[0].ok).toBe(true);
  });
});

describe("slice 1 and 3: ending an assignment takes the salon away at once, on every path (ACTIVITY §7 item 4)", () => {
  it("after the office ends rep 1's territory, rep 1 reads and writes nothing of its salon", async () => {
    await one(MANAGER, "select app.office_end_territory($1, $2, '[Test] moved to another route')", [rep1.id, TA]);
    for (const sql of [
      "select count(*)::int n from app.my_salon($1)",
      "select count(*)::int n from app.salon_notes($1)",
      "select count(*)::int n from app.salon_visits($1)",
      "select count(*)::int n from app.salon_stages($1)",
      "select count(*)::int n from app.my_salons() where id = $1",
    ]) {
      expect([sql, (await as(rep1, sql, [SA])).rows[0].n]).toEqual([sql, 0]);
    }
    expect((await as(rep1, "select count(*)::int n from app.my_areas()")).rows[0].n).toBe(0);
    for (const [sql, params] of [
      ["select app.reveal_phone($1)", [SA]],
      ["select app.update_salon($1, null, 'ladies_parlor', $2)", [SA, AA2]],
      ["select app.add_salon_note($1, $2, '[Test] after the end')", [id(), SA]],
      ["select app.rep_park_salon($1, 'verify attack')", [SA]],
      ["select app.rep_add_stop($1)", [SA]],
      ["select app.create_salon($1, '[Test] x', 'barber', $2, 'manual')", [id(), AA1]],
    ] as Array<[string, unknown[]]>) {
      expect([sql, await stateOf(rep1, sql, params)]).toEqual([sql, "42501"]);
    }
  });

  // Was it.fails while B-32 was open (verifier-slices-1-3, L-0274); migration 0017 fixed it, so
  // it is a plain it() as this comment's earlier text required (ACTIVITY L-0279).
  it("DEFECT CHECK (slice 3, H-14): replaying its own old create_salon id does not hand the rep the salon's current row", async () => {
    // The office has since changed the salon; the rep no longer holds the territory.
    await one(MANAGER, "select app.update_salon($1, null, 'ladies_parlor', $2, '[Test] office-corrected address')", [SA, AA2]);
    // The replay key is (creator, area, type), and the salon now sits in area A2.
    const st = await stateOf(rep1, "select app.create_salon($1, '[Test] whatever', 'ladies_parlor', $2, 'manual')", [SA, AA2]);
    const leaked =
      st === null
        ? (await as(rep1, "select (app.create_salon($1, '[Test] whatever', 'ladies_parlor', $2, 'manual')).address", [SA, AA2]))
            .rows[0].address
        : null;
    expect({ state: st, leaked }).toEqual({ state: "42501", leaked: null });
  });
});
