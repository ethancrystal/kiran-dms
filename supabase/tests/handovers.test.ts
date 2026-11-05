/**
 * Two-party cash handover (migration 0023, task P1-07): PAY-05 (manager counts, the system shows
 * what is expected, a variance needs a reason, nothing is edited afterwards), PAY-10 (append-only),
 * CTL-03 (the rep acknowledges on their own phone before it is final; a dispute locks it for the
 * owner), doc 09 section 5, doc 08's chain (rep minus, office plus), doc 06 section 2 (manager or
 * owner counts, the rep acknowledges), ACTIVITY L-0356 (MJ: B-37 does not hold back the handover),
 * L-0357 (two immutable tables), A-15 (how the ledger moves).
 *
 * Each test runs in one rolled-back transaction: rep A has an open day, an INST4 order is delivered
 * to SALON, and rep A collects cash, so rep A holds cash on the ledger. Expected figures are read
 * from the database in the same transaction, because other test files share rep A. Amounts are paisa.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveSalon, errorOf, fx, MANAGER, OWNER, run, sqlstate, type Who } from "./helpers/db";
import { submitApproveSql } from "./helpers/submit-approve";

const C = { commit: true };
const id = () => randomUUID();
const TAG_LENGTH = 8;
const tag = () => randomUUID().slice(0, TAG_LENGTH);
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];
const TODAY = "(now() at time zone 'Asia/Karachi')::date";

const UNIT = 100000; // one unit lists at Rs 1,000
const COLLECTED = 150000; // rep A collects Rs 1,500 in cash in every test
const LATER = 30000; // a second cash payment, recorded after the count
const SHORT_BY = 2000; // the office counts Rs 20 less than expected
const INST4_QTY = 4;
const STOCK_QTY = 1000;
const BAG_QTY = 40;
const BAG_LIMIT = 50000000;
const CREDIT_LIMIT = 100000000;
const GROUP_CYCLE_DAYS = 21;
const SKU_SIZE = 100;

const T_A = id(),
  AREA_A = id();
const SALON = id();
const GROUP = id(),
  PRODUCT = id(),
  SKU = id(),
  WH = id();
const BAG_A = `(select l.id from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}')`;

type P = "repA" | "repAWrongDevice" | "repB" | "manager" | "managerAal1" | "owner";
const WRONG_DEVICE = "dev-not-approved-0000";
// The fixture person behind each test persona.
const PERSON: Record<P, "repA" | "repB" | "manager" | "owner"> = {
  repA: "repA",
  repAWrongDevice: "repA",
  repB: "repB",
  manager: "manager",
  managerAal1: "manager",
  owner: "owner",
};
const asUser = (k: P) => {
  const who = PERSON[k];
  const device = k === "repAWrongDevice" ? WRONG_DEVICE : fx[who].device;
  const aal = k.startsWith("rep") || k === "managerAal1" ? "aal1" : "aal2";
  return `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx[who].id, role: "authenticated", aal })}', true),
         set_config('request.headers', '${JSON.stringify({ "x-kiran-device": device })}', true);
  set local role authenticated;`;
};
type Step = [P | "postgres", string];
const prelude = `
  insert into public.rep_day (rep_id, day) values ('${fx.repA.id}', ${TODAY}) on conflict (rep_id, day) do nothing;
  ${asUser("owner")}
  select app.office_create_location('${id()}', 'rep_bag', '[Test] Handover bag A', '${fx.repA.id}', ${BAG_LIMIT})
   where not exists (select 1 from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}');
  reset role;
  insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
  values (gen_random_uuid(), '${SKU}', ${BAG_QTY}, '${WH}', ${BAG_A}, 'issue_to_rep', '${fx.manager.id}');`;
const script = (steps: Step[]) =>
  `${prelude}\n${steps.map(([k, sql]) => `${k === "postgres" ? "reset role;" : asUser(k)}\n${sql}`).join("\n")}`;
type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
const tx = async (steps: Step[]) => ((await run("postgres", script(steps))) as unknown as Multi).at(-1)?.rows ?? [];
const txCode = (steps: Step[]) => sqlstate("postgres", script(steps));
const txError = (steps: Step[]) => errorOf("postgres", script(steps));

// Rep A's ledger balance and the office's, read as postgres so nothing hides them.
const REP_BALANCE = `(select coalesce(sum(case direction when 'in' then amount_paisa else -amount_paisa end), 0)::bigint
  from public.cash_ledger_entry where holder_type = 'rep' and holder_id = '${fx.repA.id}')`;
const OFFICE_BALANCE = `(select coalesce(sum(case direction when 'in' then amount_paisa else -amount_paisa end), 0)::bigint
  from public.cash_ledger_entry where holder_type = 'office')`;

// SALON owes Rs 4,000 on one INST4 delivery; rep A then collects COLLECTED in cash.
const collected = (amount = COLLECTED): Step[] => {
  const [ocid, dcid] = [id(), id()];
  return [
    [
      "manager",
      `select app.office_create_order('${ocid}', '${SALON}', 'INST4', '${JSON.stringify([{ sku_id: SKU, qty: INST4_QTY }])}'::jsonb, '${fx.repA.id}');`,
    ],
    // A rep's delivery (D-32): rep A submits it and the manager approves it.
    [
      "postgres",
      submitApproveSql(asUser, {
        clientId: dcid,
        orderExpr: `(select id from public.sales_order where client_id = '${ocid}')`,
        rep: "repA",
        approver: "manager",
      }),
    ],
    pay(amount),
  ];
};
const pay = (amount: number): Step => [
  "repA",
  `select (app.rep_record_payment('${id()}', '${SALON}', 'cash', ${amount}, 24.9, 67.1)).number;`,
];
// The office counts rep A's cash: `counted` is an SQL expression, so a test can count "expected minus 20".
const count = (cid: string, counted: string, reason: string | null = null, who: P = "manager"): Step => [
  who,
  `select (app.office_count_handover('${cid}', '${fx.repA.id}', ${counted}, ${reason === null ? "null" : `'${reason}'`})).id;`,
];
const HANDOVER = (cid: string) => `(select h.id from public.handover h where h.client_id = '${cid}')`;
const respond = (cid: string, hcid: string, accept: boolean, note: string | null = null, who: P = "repA"): Step => [
  who,
  `select (app.rep_respond_handover('${cid}', ${HANDOVER(hcid)}, ${accept}, ${note === null ? "null" : `'${note}'`})).kind;`,
];
const state = (hcid: string): Step => [
  "postgres",
  `select h.expected_paisa, h.counted_paisa, h.variance_paisa, h.variance_reason,
          coalesce(r.kind, 'pending') as status, ${REP_BALANCE} as rep_balance, ${OFFICE_BALANCE} as office_balance,
          (select count(*)::int from public.cash_ledger_entry e where e.source_type = 'handover' and e.source_id = h.id) as ledger_rows
   from public.handover h left join public.handover_response r on r.handover_id = h.id where h.client_id = '${hcid}';`,
];
const n = (v: unknown) => Number(v);
const LEDGER_ROWS_PER_ACK = 2; // the rep's `out` and the office's `in`
// The database's refusal of a change to an append-only row: "handover is append-only" matches; "permission denied" does not.
// https://regex101.com/?regex=append-only&testString=handover%20is%20append-only&flavor=javascript
const APPEND_ONLY = /append-only/;

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_A, `[Test] Handover A ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Handover area A')", [AREA_A, T_A]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T_A]);
  await one({ as: "repA" }, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, 24.9, 67.1)", [
    SALON,
    `[Test] Handover salon ${tag()}`,
    AREA_A,
  ]);
  // D-35 (slice 7): a rep's salon is a proposal; the office approves it before any order.
  await approveSalon(SALON);
  await one(OWNER, "select app.owner_set_credit($1, 'INST4', $2, 'handover tests, owner decision')", [SALON, CREDIT_LIMIT]);
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, $3)", [
    GROUP,
    `[Test] Handover colour ${tag()}`,
    GROUP_CYCLE_DAYS,
  ]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Handover colour')", [PRODUCT, GROUP]);
  await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', $4)", [
    SKU,
    PRODUCT,
    `T-HND-${tag().toUpperCase()}`,
    SKU_SIZE,
  ]);
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU, UNIT]);
  await one(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Handover store')", [WH]);
  await one(
    "postgres",
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, $2, $3, 'receipt', $4)`,
    [SKU, STOCK_QTY, WH, fx.manager.id],
  );
});

afterAll(async () => {
  await one(MANAGER, "select app.office_end_territory($1, $2, 'handover tests finished')", [fx.repA.id, T_A]);
});

describe("the office counts, the rep acknowledges (PAY-05, CTL-03, A-15)", () => {
  it("a count records the database's expected figure and moves no cash until the rep acknowledges", async () => {
    const h = id();
    const [before] = await tx([...collected(), ["postgres", `select ${REP_BALANCE} as rep, ${OFFICE_BALANCE} as office;`]]);
    const [after] = await tx([...collected(), count(h, REP_BALANCE), state(h)]);
    expect(n(after.expected_paisa)).toBe(n(before.rep));
    expect([n(after.variance_paisa), after.status, after.ledger_rows]).toEqual([0, "pending", 0]);
    expect([n(after.rep_balance), n(after.office_balance)]).toEqual([n(before.rep), n(before.office)]);
  });

  it("an acknowledged count is final: the rep's ledger is cleared by the expected amount and the office gets the counted amount", async () => {
    const [h, r] = [id(), id()];
    const [before] = await tx([...collected(), ["postgres", `select ${REP_BALANCE} as rep, ${OFFICE_BALANCE} as office;`]]);
    const [after] = await tx([...collected(), count(h, REP_BALANCE), respond(r, h, true), state(h)]);
    expect(after.status).toBe("ack");
    expect(n(after.rep_balance)).toBe(0);
    expect(n(after.office_balance)).toBe(n(before.office) + n(before.rep));
    expect(after.ledger_rows).toBe(LEDGER_ROWS_PER_ACK);
  });

  it("a short count needs a reason; acknowledged, the variance stays on the handover and the office gets what was counted", async () => {
    const [h, r] = [id(), id()];
    expect(await txCode([...collected(), count(h, `${REP_BALANCE} - ${SHORT_BY}`)])).toBe("22023");
    expect(await txCode([...collected(), count(h, `${REP_BALANCE} - ${SHORT_BY}`, "  ")])).toBe("22023");
    const [before] = await tx([...collected(), ["postgres", `select ${REP_BALANCE} as rep, ${OFFICE_BALANCE} as office;`]]);
    const [after] = await tx([
      ...collected(),
      count(h, `${REP_BALANCE} - ${SHORT_BY}`, "one note missing at the count"),
      respond(r, h, true),
      state(h),
    ]);
    expect([n(after.variance_paisa), after.variance_reason]).toEqual([SHORT_BY, "one note missing at the count"]);
    expect(n(after.rep_balance)).toBe(0);
    expect(n(after.office_balance)).toBe(n(before.office) + n(before.rep) - SHORT_BY);
  });

  it("a disputed count moves no cash and needs a reason; the cash stays with the rep", async () => {
    const [h, r] = [id(), id()];
    expect(await txCode([...collected(), count(h, REP_BALANCE), respond(r, h, false)])).toBe("22023");
    const [before] = await tx([...collected(), ["postgres", `select ${REP_BALANCE} as rep;`]]);
    const [after] = await tx([
      ...collected(),
      count(h, `${REP_BALANCE} - ${SHORT_BY}`, "short at the count"),
      respond(r, h, false, "I handed over the full amount"),
      state(h),
    ]);
    expect([after.status, after.ledger_rows, n(after.rep_balance)]).toEqual(["dispute", 0, n(before.rep)]);
  });

  it("cash collected after the count stays with the rep when the count is acknowledged", async () => {
    const [h, r] = [id(), id()];
    const [after] = await tx([...collected(), count(h, REP_BALANCE), pay(LATER), respond(r, h, true), state(h)]);
    expect(n(after.rep_balance)).toBe(LATER);
  });

  it("a rep with a pending or disputed handover cannot be counted again", async () => {
    const [h1, h2, r] = [id(), id(), id()];
    expect(await txCode([...collected(), count(h1, REP_BALANCE), count(h2, REP_BALANCE)])).toBe("55000");
    expect(
      await txCode([...collected(), count(h1, REP_BALANCE), respond(r, h1, false, "not what I gave"), count(h2, REP_BALANCE)]),
    ).toBe("55000");
    // Once acknowledged, the next count is allowed (it may be for nothing more than new cash).
    const rows = await tx([
      ...collected(),
      count(h1, REP_BALANCE),
      respond(r, h1, true),
      pay(LATER),
      count(h2, REP_BALANCE),
      state(h2),
    ]);
    expect(n(rows[0]?.expected_paisa)).toBe(LATER);
  });

  it("nothing to hand over, a negative count or a person who is not a rep is refused (22023)", async () => {
    const h = id();
    expect(await txCode([count(h, "0")])).toBe("22023");
    expect(await txCode([...collected(), count(h, "-1")])).toBe("22023");
    expect(
      await txCode([...collected(), ["manager", `select app.office_count_handover('${h}', '${fx.manager.id}', 100, null);`]]),
    ).toBe("22023");
  });
});

describe("replays and second answers (H-08)", () => {
  it("the same count replayed returns the same handover; a changed replay is refused", async () => {
    const h = id();
    const rows = await tx([
      ...collected(),
      count(h, REP_BALANCE),
      count(h, `(select counted_paisa from public.handover where client_id = '${h}')`),
      ["postgres", `select count(*)::int as n from public.handover where client_id = '${h}';`],
    ]);
    expect(rows[0]?.n).toBe(1);
    expect(await txCode([...collected(), count(h, REP_BALANCE), count(h, `${REP_BALANCE} - 1`, "changed")])).toBe("22023");
  });

  it("the same answer replayed returns it again; a second, different answer is refused", async () => {
    const [h, r, r2] = [id(), id(), id()];
    const rows = await tx([...collected(), count(h, REP_BALANCE), respond(r, h, true), respond(r, h, true), state(h)]);
    expect([rows[0]?.status, rows[0]?.ledger_rows]).toEqual(["ack", LEDGER_ROWS_PER_ACK]);
    expect(
      await txCode([...collected(), count(h, REP_BALANCE), respond(r, h, true), respond(r2, h, false, "changed my mind")]),
    ).toBe("55000");
  });
});

describe("who may do what (doc 06 section 2, SEC-02, SEC-03)", () => {
  it.each([
    ["repA", "a rep cannot count"],
    ["managerAal1", "the office without MFA cannot count"],
  ] as const)("%s: %s (42501)", async (k, _what) => {
    expect(await txCode([...collected(), count(id(), REP_BALANCE, null, k)])).toBe("42501");
  });

  it("the owner can count", async () => {
    const h = id();
    const rows = await tx([...collected(), count(h, REP_BALANCE, null, "owner"), state(h)]);
    expect(rows[0]?.status).toBe("pending");
  });

  it.each([
    ["repB", "another rep"],
    ["repAWrongDevice", "rep A on an unapproved phone"],
    ["manager", "the office"],
  ] as const)("%s (%s) cannot answer rep A's handover (42501)", async (k, _who) => {
    const h = id();
    expect(await txCode([...collected(), count(h, REP_BALANCE), respond(id(), h, true, null, k)])).toBe("42501");
  });

  it("handover rows cannot be changed or deleted, even by the database owner", async () => {
    const [h, r] = [id(), id()];
    const base = [...collected(), count(h, REP_BALANCE), respond(r, h, true)];
    expect(
      await txError([...base, ["postgres", `update public.handover set counted_paisa = 1 where client_id = '${h}';`]]),
    ).toMatch(APPEND_ONLY);
    expect(await txError([...base, ["postgres", `delete from public.handover_response where client_id = '${r}';`]])).toMatch(
      APPEND_ONLY,
    );
  });
});

describe("what each side reads", () => {
  it("the rep sees its own handover to answer; the office sees it in its list and its cash position", async () => {
    const h = id();
    const [mine] = await tx([...collected(), count(h, REP_BALANCE), ["repA", "select * from app.my_handovers();"]]);
    expect([mine?.status, n(mine?.counted_paisa) > 0]).toEqual(["pending", true]);
    const [office] = await tx([
      ...collected(),
      count(h, REP_BALANCE),
      [
        "manager",
        `select o.status, o.rep_name = (select u.full_name from public.user_profile u where u.id = '${fx.repA.id}') as named
         from app.office_handovers() o where o.handover_id = ${HANDOVER(h)};`,
      ],
    ]);
    expect([office?.status, office?.named]).toEqual(["pending", true]);
    const [pos] = await tx([
      ...collected(),
      count(h, REP_BALANCE),
      respond(id(), h, true),
      ["manager", `select (app.office_cash_position()).balance_paisa as office, ${OFFICE_BALANCE} as truth;`],
    ]);
    expect(n(pos?.office)).toBe(n(pos?.truth));
  });

  it("a rep cannot read the office list or the office cash (42501); repB sees none of rep A's handovers", async () => {
    expect(await txCode([["repA", "select * from app.office_handovers();"]])).toBe("42501");
    expect(await txCode([["repA", "select * from app.office_cash_position();"]])).toBe("42501");
    const rows = await tx([...collected(), count(id(), REP_BALANCE), ["repB", "select * from app.my_handovers();"]]);
    expect(rows).toEqual([]);
  });
});
