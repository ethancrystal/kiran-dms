/**
 * Salon approval and direct rep assignment (migration 20261105100000, slice 1, P1-18; D-35, D-36,
 * spec rulings R3 and R4). Office-created salons are approved; a pending or rejected salon cannot get
 * an order or a card. A direct assignment limits the salon to that rep; otherwise territory coverage
 * applies. These tests insert their pending salons as postgres; since slice 7 a rep's app.create_salon
 * makes one too (rep-readonly-timelines.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  errorOf,
  fx,
  MANAGER,
  MANAGER_AAL1,
  OWNER,
  OWNER_AAL1,
  REP_A,
  REP_A_WRONG_DEVICE,
  REP_B,
  run,
  SUSPENDED,
  sqlstate,
  type Who,
} from "./helpers/db";
import { asLoginCode, asLoginRows, newLogin, tag, uuid } from "./helpers/invite";

const C = { commit: true };
const DENIED = "42501";
const BAD_INPUT = "22023";
const WRONG_STATE = "55000";
const DUPLICATE = "23505";
const RATE = 250; // 2.5%
const ONLY_WITH_A_DECISION = "only with a decision";
const OTHER_REP = "assigned to another rep";
const TERRITORY_RULE = "covers this salon's territory";
const RATE_MAX = 10_000;
const THREE_ROWS = 3; // assigned, reassigned, cleared
const UNIT = 100_000;
const SKU_SIZE = 100;
const GROUP_CYCLE_DAYS = 21;

const T_A = uuid(),
  AREA_A = uuid(),
  T_B = uuid(),
  AREA_B = uuid();
const GROUP = uuid(),
  PRODUCT = uuid(),
  SKU = uuid();
const TODAY = "(now() at time zone 'Asia/Karachi')::date";
const LINES = `'${JSON.stringify([{ sku_id: SKU, qty: 1 }])}'::jsonb`;

const REFUSED: Array<[string, Who]> = [
  ["anon", "anon"],
  ["repA", REP_A],
  ["repA on a wrong device", REP_A_WRONG_DEVICE],
  ["a suspended rep", SUSPENDED],
  ["manager without MFA", MANAGER_AAL1],
  ["owner without MFA", OWNER_AAL1],
];

const pendingSalon = async (area = AREA_A, status = "pending") => {
  const id = uuid();
  await run(
    "postgres",
    `insert into public.salon (id, name, type, area_id, source, created_by, approval_status)
     values ($1, $2, 'ladies_parlor', $3, 'map_pin', $4, $5::public.salon_approval)`,
    [id, `[Test] Proposed ${tag()}`, area, fx.repA.id, status],
    C,
  );
  return id;
};
const approvedSalon = async (area = AREA_A) => {
  const id = uuid();
  await run(MANAGER, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'manual')", [id, `[Test] Approved ${tag()}`, area], C);
  return id;
};
const decide = (
  salon: string,
  approve: boolean,
  reason: string | null = null,
  rep: string | null = null,
  rate: number | null = null,
  client = uuid(),
) => ({
  sql: "select (app.office_decide_salon($1, $2, $3, $4, $5, $6)).*",
  params: [client, salon, approve, reason, rep, rate],
});
const assign = (salon: string, rep: string | null, rate: number | null = null, client = uuid()) => ({
  sql: "select (app.office_assign_salon_rep($1, $2, $3, $4)).*",
  params: [client, salon, rep, rate],
});
const orderSql = (salon: string, rep: string | null = null) => ({
  sql: `select (app.office_create_order($1, $2, 'CASH', ${LINES}, $3)).id`,
  params: [uuid(), salon, rep],
});
const approvalOf = async (id: string) =>
  (await run("postgres", "select approval_status from public.salon where id = $1", [id])).rows[0].approval_status;
const mySalons = async (who: Who) => (await run(who, "select id from app.my_salons(null, null, 50)")).rows.map((r) => r.id);
const mySalon = async (who: Who, id: string) => (await run(who, "select id from app.my_salon($1)", [id])).rows.length;
const notesCode = (who: Who, id: string) =>
  sqlstate(who, "select app.add_salon_note(gen_random_uuid(), $1, 'reach probe')", [id]);

beforeAll(async () => {
  await run(MANAGER, "select app.office_upsert_territory($1, $2)", [T_A, `[Test] Approval A ${tag()}`], C);
  await run(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Approval area A')", [AREA_A, T_A], C);
  await run(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T_A], C);
  await run(MANAGER, "select app.office_upsert_territory($1, $2)", [T_B, `[Test] Approval B ${tag()}`], C);
  await run(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Approval area B')", [AREA_B, T_B], C);
  await run(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repB.id, T_B], C);
  await run(
    MANAGER,
    "select app.office_upsert_product_group($1, $2, $3)",
    [GROUP, `[Test] Approval colour ${tag()}`, GROUP_CYCLE_DAYS],
    C,
  );
  await run(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Approval colour')", [PRODUCT, GROUP], C);
  await run(
    MANAGER,
    "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', $4)",
    [SKU, PRODUCT, `T-APR-${tag().toUpperCase()}`, SKU_SIZE],
    C,
  );
  await run(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU, UNIT], C);
});

afterAll(async () => {
  // Leave the shared reps' reach as other files expect it: clear every direct assignment this file left
  // on its own salons, so no later file finds rep A or rep B holding a salon it never covered.
  const { rows: held } = await run(
    "postgres",
    `select s.id from public.salon s where s.area_id in ($1, $2) and app.salon_direct_rep(s.id) is not null`,
    [AREA_A, AREA_B],
  );
  await held.reduce(async (prev, { id }) => {
    await prev;
    const clear = assign(id, null);
    await run(MANAGER, clear.sql, clear.params, C);
  }, Promise.resolve());
  await run(MANAGER, "select app.office_end_territory($1, $2, 'approval tests finished')", [fx.repA.id, T_A], C);
  await run(MANAGER, "select app.office_end_territory($1, $2, 'approval tests finished')", [fx.repB.id, T_B], C);
});

describe("a salon's approval status", () => {
  // Slice 7 (migration 20261105160000, R3) made a rep's new salon a pending proposal; until then this
  // test pinned that a rep's add read approved.
  it("salons added by the office read approved; a salon a rep adds is a pending proposal (slice 7)", async () => {
    expect(await approvalOf(await approvedSalon())).toBe("approved");
    const id = uuid();
    await run(REP_A, "select app.create_salon($1, '[Test] Rep add', 'unisex', $2, 'map_pin')", [id, AREA_A], C);
    expect(await approvalOf(id)).toBe("pending");
  });

  it("moves only with a decision: a direct update is refused even for the table owner", async () => {
    const id = await pendingSalon();
    expect(await errorOf("postgres", "update public.salon set approval_status = 'approved' where id = $1", [id])).toContain(
      ONLY_WITH_A_DECISION,
    );
    expect(await sqlstate("postgres", "update public.salon set approval_status = 'approved' where id = $1", [id])).toBe(DENIED);
  });

  it("the office reads it through salon RLS; reps and other logins still see no salon row (no widening)", async () => {
    const id = await pendingSalon();
    expect((await run(MANAGER, "select approval_status from public.salon where id = $1", [id])).rows[0].approval_status).toBe(
      "pending",
    );
    const reps = await Promise.all([REP_A, REP_B].map((who) => run(who, "select id from public.salon where id = $1", [id])));
    expect(reps.flatMap((res) => res.rows)).toEqual([]);
    expect((await asLoginRows(await newLogin(), `select count(*)::int n from public.salon`))[0].n).toBe(0);
  });
});

describe("the office decides a pending salon", () => {
  it.each([
    ["manager", MANAGER],
    ["owner", OWNER],
  ])("%s approves with a rep and a rate: decision, status and assignment land together", async (_n, who) => {
    const id = await pendingSalon();
    const d = decide(id, true, null, fx.repB.id, RATE);
    const row = (await run(who, d.sql, d.params, C)).rows[0];
    expect(row).toMatchObject({ salon_id: id, decision: "approved", decided_by: who === MANAGER ? fx.manager.id : fx.owner.id });
    expect(await approvalOf(id)).toBe("approved");
    const a = await run("postgres", "select rep_id, rate_bp, assigned_by from public.salon_rep_assignment where salon_id = $1", [
      id,
    ]);
    expect(a.rows).toEqual([{ rep_id: fx.repB.id, rate_bp: RATE, assigned_by: who === MANAGER ? fx.manager.id : fx.owner.id }]);
  });

  it("approves with no rep: no assignment row, territory coverage applies", async () => {
    const id = await pendingSalon();
    const d = decide(id, true);
    await run(MANAGER, d.sql, d.params, C);
    expect(await approvalOf(id)).toBe("approved");
    expect((await run("postgres", "select 1 from public.salon_rep_assignment where salon_id = $1", [id])).rows).toEqual([]);
  });

  it("rejects with a reason of at least 5 characters; a rep or a rate on a rejection is refused", async () => {
    const id = await pendingSalon();
    await Promise.all(
      [null, "   ", "shrt"].map(async (reason) => {
        const d = decide(id, false, reason);
        expect(await sqlstate(MANAGER, d.sql, d.params), String(reason)).toBe(BAD_INPUT);
      }),
    );
    const withRep = decide(id, false, "not a salon", fx.repA.id);
    expect(await sqlstate(MANAGER, withRep.sql, withRep.params)).toBe(BAD_INPUT);
    const withRate = decide(id, false, "not a salon", null, RATE);
    expect(await sqlstate(MANAGER, withRate.sql, withRate.params)).toBe(BAD_INPUT);
    const ok = decide(id, false, "not a salon");
    expect((await run(MANAGER, ok.sql, ok.params, C)).rows[0]).toMatchObject({ decision: "rejected", reason: "not a salon" });
    expect(await approvalOf(id)).toBe("rejected");
  });

  it("a replay returns the same decision; other facts or another person are refused", async () => {
    const id = await pendingSalon();
    const client = uuid();
    const d = decide(id, true, null, fx.repA.id, RATE, client);
    const first = (await run(MANAGER, d.sql, d.params, C)).rows[0];
    const again = (await run(MANAGER, d.sql, d.params, C)).rows[0];
    expect(again.id).toBe(first.id);
    expect(
      (await run("postgres", "select count(*)::int n from public.salon_rep_assignment where salon_id = $1", [id])).rows[0].n,
    ).toBe(1);
    const other = decide(id, false, "not a salon", null, null, client);
    expect(await sqlstate(MANAGER, other.sql, other.params)).toBe(DUPLICATE);
    expect(await sqlstate(OWNER, d.sql, d.params)).toBe(DUPLICATE);
  });

  it("a salon is decided once: approved or rejected is final here", async () => {
    const id = await pendingSalon();
    const d = decide(id, true);
    await run(MANAGER, d.sql, d.params, C);
    const again = decide(id, false, "changed my mind");
    expect(await sqlstate(OWNER, again.sql, again.params)).toBe(WRONG_STATE);
    const rejected = await pendingSalon(AREA_A, "rejected");
    const r = decide(rejected, true);
    expect(await sqlstate(MANAGER, r.sql, r.params)).toBe(WRONG_STATE);
    const office = decide(await approvedSalon(), false, "not pending");
    expect(await sqlstate(MANAGER, office.sql, office.params)).toBe(WRONG_STATE);
  });

  it("bad input writes nothing: unknown salon, null client id, inactive or wrong-role rep, rate out of range, rate with no rep", async () => {
    const id = await pendingSalon();
    const cases: Array<[string, { sql: string; params: unknown[] }]> = [
      ["unknown salon", decide(uuid(), true)],
      ["manager as rep", decide(id, true, null, fx.manager.id)],
      ["suspended rep", decide(id, true, null, fx.suspendedRep.id)],
      ["no such rep", decide(id, true, null, uuid())],
      ["rate below 0", decide(id, true, null, fx.repA.id, -1)],
      ["rate above 100%", decide(id, true, null, fx.repA.id, RATE_MAX + 1)],
      ["rate with no rep", decide(id, true, null, null, RATE)],
    ];
    await Promise.all(cases.map(async ([n, d]) => expect(await sqlstate(MANAGER, d.sql, d.params), n).toBe(BAD_INPUT)));
    expect(await sqlstate(MANAGER, "select app.office_decide_salon(null, $1, true, null)", [id])).toBe(BAD_INPUT);
    expect(await approvalOf(id)).toBe("pending");
    expect(
      (await run("postgres", "select count(*)::int n from public.salon_approval_decision where salon_id = $1", [id])).rows[0].n,
    ).toBe(0);
  });

  it("the edges of the rate are allowed: 0 and 10000 basis points", async () => {
    await Promise.all(
      [0, RATE_MAX].map(async (rate) => {
        const d = decide(await pendingSalon(), true, null, fx.repA.id, rate);
        expect((await run(MANAGER, d.sql, d.params)).rows.length).toBe(1);
      }),
    );
  });

  it.each(REFUSED)("%s cannot decide", async (_n, who) => {
    const id = await pendingSalon();
    const d = decide(id, true);
    expect(await sqlstate(who, d.sql, d.params)).toBe(DENIED);
    expect(await approvalOf(id)).toBe("pending");
  });

  it("repB cannot decide, and an unredeemed login cannot either", async () => {
    const id = await pendingSalon();
    const d = decide(id, true);
    expect(await sqlstate(REP_B, d.sql, d.params)).toBe(DENIED);
    expect(await asLoginCode(await newLogin(), `select app.office_decide_salon(gen_random_uuid(), '${id}', true, null)`)).toBe(
      DENIED,
    );
  });

  it("decisions and assignments are append-only, even for the table owner", async () => {
    const id = await pendingSalon();
    const d = decide(id, true, null, fx.repA.id);
    const row = (await run(MANAGER, d.sql, d.params, C)).rows[0];
    const refused = async (sql: string, key: string) => expect(await sqlstate("postgres", sql, [key]), sql).toBe(DENIED);
    await refused("update public.salon_approval_decision set reason = 'x' where id = $1", row.id);
    await refused("delete from public.salon_approval_decision where id = $1", row.id);
    await refused("update public.salon_rep_assignment set rate_bp = 1 where salon_id = $1", id);
    await refused("delete from public.salon_rep_assignment where salon_id = $1", id);
  });

  it("the audit rows carry the session's actor", async () => {
    const id = await pendingSalon();
    const d = decide(id, true, null, fx.repA.id);
    const row = (await run(OWNER, d.sql, d.params, C)).rows[0];
    const audit = await run(
      "postgres",
      "select actor_id from control.audit_event where table_name = 'public.salon_approval_decision' and row_id = $1",
      [row.id],
    );
    expect(audit.rows).toEqual([{ actor_id: fx.owner.id }]);
  });
});

describe("the pending queue", () => {
  it("lists pending salons only, allow-listed columns, oldest first, with the proposer's name", async () => {
    const id = await pendingSalon();
    const rejected = await pendingSalon(AREA_A, "rejected");
    const { rows } = await run(MANAGER, "select * from app.office_pending_salons()");
    const row = rows.find((r) => r.salon_id === id);
    expect(row).toMatchObject({ area_name: "[Test] Approval area A", proposed_by_name: "[Test] Rep A" });
    expect(Object.keys(row).sort()).toEqual(
      [
        "address",
        "area_name",
        "created_at",
        "lat",
        "lng",
        "name",
        "proposed_by_name",
        "salon_id",
        "territory_name",
        "type",
      ].sort(),
    );
    expect(rows.some((r) => r.salon_id === rejected)).toBe(false);
  });

  it.each(REFUSED)("%s cannot read it", async (_n, who) => {
    expect(await sqlstate(who, "select * from app.office_pending_salons()")).toBe(DENIED);
  });
});

describe("a salon that is not approved gets no order and no card", () => {
  it.each(["pending", "rejected"])("a %s salon: office_create_order refuses with 55000 and writes nothing", async (status) => {
    const id = await pendingSalon(AREA_A, status);
    const o = orderSql(id);
    expect(await sqlstate(MANAGER, o.sql, o.params)).toBe(WRONG_STATE);
    expect(await errorOf(MANAGER, o.sql, o.params)).toContain("approved");
    expect((await run("postgres", "select 1 from public.sales_order where salon_id = $1", [id])).rows).toEqual([]);
  });

  it("an approved salon takes an order, and a salon approved later can too", async () => {
    const o = orderSql(await approvedSalon());
    expect((await run(MANAGER, o.sql, o.params)).rows.length).toBe(1);
    const id = await pendingSalon();
    const d = decide(id, true);
    await run(MANAGER, d.sql, d.params, C);
    const later = orderSql(id);
    expect((await run(MANAGER, later.sql, later.params)).rows.length).toBe(1);
  });

  it("a rep's card for a pending salon is refused with 55000", async () => {
    const id = await pendingSalon();
    // The open day lives only inside this rolled-back transaction: a committed rep_day would leave rep A
    // checked in for every later test file (visits.test.ts expects no open day).
    const asRepA = `reset role;
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.repA.id, role: "authenticated", aal: "aal1" })}', true),
             set_config('request.headers', '${JSON.stringify({ "x-kiran-device": fx.repA.device })}', true);
      set local role authenticated;`;
    const script = `insert into public.rep_day (rep_id, day) values ('${fx.repA.id}', ${TODAY}) on conflict (rep_id, day) do nothing;
      ${asRepA} select app.rep_create_card(gen_random_uuid(), '${id}', '[Test] 2 bottles');`;
    expect(await sqlstate("postgres", script)).toBe(WRONG_STATE);
  });
});

describe("a direct assignment limits the salon to that rep (R4)", () => {
  it("no assignment: the territory's rep reaches it, another rep does not", async () => {
    const id = await approvedSalon();
    expect(await mySalons(REP_A)).toContain(id);
    expect(await mySalons(REP_B)).not.toContain(id);
    expect(await mySalon(REP_A, id)).toBe(1);
    expect(await notesCode(REP_A, id)).toBeNull();
    expect(await notesCode(REP_B, id)).toBe(DENIED);
  });

  it("assigned to rep B outside its territory: B reaches it everywhere, the territory's rep A nowhere", async () => {
    const id = await approvedSalon(); // area A: rep A covers it
    const a = assign(id, fx.repB.id, RATE);
    await run(MANAGER, a.sql, a.params, C);
    expect(await mySalons(REP_B)).toContain(id);
    expect(await mySalon(REP_B, id)).toBe(1);
    expect(await notesCode(REP_B, id)).toBeNull();
    expect((await run(REP_B, "select count(*)::int n from app.salon_stages($1)", [id])).rows[0].n).toBeGreaterThan(0);

    expect(await mySalons(REP_A)).not.toContain(id);
    expect(await mySalon(REP_A, id)).toBe(0);
    expect(await notesCode(REP_A, id)).toBe(DENIED);
    expect((await run(REP_A, "select count(*)::int n from app.salon_stages($1)", [id])).rows[0].n).toBe(0);
  });

  it("the latest row wins, and a null rep clears it back to territory coverage", async () => {
    const id = await approvedSalon();
    const first = assign(id, fx.repB.id);
    await run(MANAGER, first.sql, first.params, C);
    expect(await mySalons(REP_B)).toContain(id);
    const second = assign(id, fx.repA.id);
    await run(OWNER, second.sql, second.params, C);
    expect(await mySalons(REP_A)).toContain(id);
    expect(await mySalons(REP_B)).not.toContain(id);
    const clear = assign(id, null);
    await run(MANAGER, clear.sql, clear.params, C);
    expect(await mySalons(REP_A)).toContain(id);
    expect(await mySalons(REP_B)).not.toContain(id);
    expect(
      (await run("postgres", "select count(*)::int n from public.salon_rep_assignment where salon_id = $1", [id])).rows[0].n,
    ).toBe(THREE_ROWS);
  });

  it("the office's due list and the rep's route follow it", async () => {
    const id = await approvedSalon();
    await run(
      MANAGER,
      "select app.office_set_last_purchase($1, $2, ((now() at time zone 'Asia/Karachi')::date - 40))",
      [id, GROUP],
      C,
    );
    const due = async (who: Who) => (await run(who, "select salon_id from app.due_list()")).rows.map((r) => r.salon_id);
    expect(await due(REP_A)).toContain(id);
    const a = assign(id, fx.repB.id);
    await run(MANAGER, a.sql, a.params, C);
    expect(await due(REP_A)).not.toContain(id);
    expect(await due(REP_B)).toContain(id);
    const stops = JSON.stringify([{ salon_id: id, reason: "reorder_due" }]);
    expect(await sqlstate(MANAGER, `select app.office_set_route($1, ${TODAY}, $2::jsonb)`, [fx.repA.id, stops])).toBe(BAD_INPUT);
    expect(await sqlstate(MANAGER, `select app.office_set_route($1, ${TODAY}, $2::jsonb)`, [fx.repB.id, stops])).toBeNull();
  });

  it("an office order's delivering rep follows it (A-16): the assigned rep only", async () => {
    const id = await approvedSalon();
    const a = assign(id, fx.repB.id);
    await run(MANAGER, a.sql, a.params, C);
    const wrong = orderSql(id, fx.repA.id);
    expect(await sqlstate(MANAGER, wrong.sql, wrong.params)).toBe(BAD_INPUT);
    expect(await errorOf(MANAGER, wrong.sql, wrong.params)).toContain(OTHER_REP);
    const right = orderSql(id, fx.repB.id);
    expect((await run(MANAGER, right.sql, right.params)).rows.length).toBe(1);
  });

  it("with no assignment the territory rule for the delivering rep is unchanged", async () => {
    const id = await approvedSalon();
    const other = orderSql(id, fx.repB.id);
    expect(await errorOf(MANAGER, other.sql, other.params)).toContain(TERRITORY_RULE);
    const own = orderSql(id, fx.repA.id);
    expect((await run(MANAGER, own.sql, own.params)).rows.length).toBe(1);
  });

  it("a suspended assigned rep leaves the salon with no rep: it does not fall back to the territory", async () => {
    // A fresh rep from an invitation, so suspending it touches no shared persona.
    const login = await newLogin();
    const inv = (
      await run(MANAGER, "select app.office_invite($1, 'rep', '[Test] Assigned rep', $2) as r", [uuid(), login.email], C)
    ).rows[0].r;
    await asLoginRows(login, `select app.redeem_invitation('${inv.token}')`, { commit: true });
    const id = await approvedSalon(); // area A: rep A covers it
    const a = assign(id, login.id);
    await run(MANAGER, a.sql, a.params, C);
    await run(MANAGER, "select app.office_set_member_status('rep', $1, 'suspended', 'test reason')", [login.id], C);
    expect(await mySalons(REP_A)).not.toContain(id);
    expect(await notesCode(REP_A, id)).toBe(DENIED);
    const territoryRep = orderSql(id, fx.repA.id);
    expect(await errorOf(MANAGER, territoryRep.sql, territoryRep.params)).toContain(OTHER_REP);
    const suspended = orderSql(id, login.id);
    expect(await errorOf(MANAGER, suspended.sql, suspended.params)).toContain(TERRITORY_RULE);
    // The office reassigns it, or clears it back to the territory.
    const clear = assign(id, null);
    await run(MANAGER, clear.sql, clear.params, C);
    expect(await mySalons(REP_A)).toContain(id);
  });
});

describe("assigning a rep later", () => {
  it("a replay returns the same row; other facts or another person are refused", async () => {
    const id = await approvedSalon();
    const client = uuid();
    const a = assign(id, fx.repA.id, RATE, client);
    const first = (await run(MANAGER, a.sql, a.params, C)).rows[0];
    expect((await run(MANAGER, a.sql, a.params, C)).rows[0].id).toBe(first.id);
    const other = assign(id, fx.repB.id, RATE, client);
    expect(await sqlstate(MANAGER, other.sql, other.params)).toBe(DUPLICATE);
    expect(await sqlstate(OWNER, a.sql, a.params)).toBe(DUPLICATE);
  });

  it("refuses bad input and a salon that is not approved", async () => {
    const id = await approvedSalon();
    const cases: Array<[string, string, { sql: string; params: unknown[] }]> = [
      ["unknown salon", BAD_INPUT, assign(uuid(), fx.repA.id)],
      ["manager as rep", BAD_INPUT, assign(id, fx.manager.id)],
      ["suspended rep", BAD_INPUT, assign(id, fx.suspendedRep.id)],
      ["no such rep", BAD_INPUT, assign(id, uuid())],
      ["rate above 100%", BAD_INPUT, assign(id, fx.repA.id, RATE_MAX + 1)],
      ["rate below 0", BAD_INPUT, assign(id, fx.repA.id, -1)],
      ["rate on a clear", BAD_INPUT, assign(id, null, RATE)],
      ["pending salon", WRONG_STATE, assign(await pendingSalon(), fx.repA.id)],
      ["rejected salon", WRONG_STATE, assign(await pendingSalon(AREA_A, "rejected"), fx.repA.id)],
    ];
    await Promise.all(cases.map(async ([n, code, a]) => expect(await sqlstate(MANAGER, a.sql, a.params), n).toBe(code)));
    expect(await sqlstate(MANAGER, "select app.office_assign_salon_rep(null, $1, null)", [id])).toBe(BAD_INPUT);
  });

  it.each(REFUSED)("%s cannot assign", async (_n, who) => {
    const a = assign(await approvedSalon(), fx.repA.id);
    expect(await sqlstate(who, a.sql, a.params)).toBe(DENIED);
  });

  it("a rep cannot assign itself, and an unredeemed login cannot assign", async () => {
    const id = await approvedSalon(AREA_B);
    const a = assign(id, fx.repA.id);
    expect(await sqlstate(REP_A, a.sql, a.params)).toBe(DENIED);
    expect(await asLoginCode(await newLogin(), `select app.office_assign_salon_rep(gen_random_uuid(), '${id}', null)`)).toBe(
      DENIED,
    );
    expect((await run("postgres", "select 1 from public.salon_rep_assignment where salon_id = $1", [id])).rows).toEqual([]);
  });
});
