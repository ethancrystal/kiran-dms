/**
 * Office cash collection (migration 0024, task P1-07): PAY-02 and doc 06 section 2 ("Log payments:
 * Manager own + on behalf; Owner same as manager"), ACTIVITY L-0362 (MJ resolves B-37: the office may
 * record cash; it goes to the office cash pool, never to a rep's ledger, flagged office_collected).
 *
 * Each test runs in one rolled-back transaction in which an INST4 order is delivered to SALON by
 * rep A, so the salon owes Rs 4,000. Ledger balances are read before and after in the same
 * transaction, because other test files share the database. Amounts are paisa.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveSalon, fx, MANAGER, OWNER, run, sqlstate, type Who } from "./helpers/db";
import { submitApproveSql } from "./helpers/submit-approve";

const C = { commit: true };
const id = () => randomUUID();
const TAG_LENGTH = 8;
const tag = () => randomUUID().slice(0, TAG_LENGTH);
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];
const TODAY = "(now() at time zone 'Asia/Karachi')::date";

const UNIT = 100000;
const COLLECTED = 150000;
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

type P = "repA" | "manager" | "managerAal1" | "owner";
const PERSON: Record<P, "repA" | "manager" | "owner"> = {
  repA: "repA",
  manager: "manager",
  managerAal1: "manager",
  owner: "owner",
};
const asUser = (k: P) => {
  const who = PERSON[k];
  const aal = k === "repA" || k === "managerAal1" ? "aal1" : "aal2";
  return `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx[who].id, role: "authenticated", aal })}', true),
         set_config('request.headers', '${JSON.stringify({ "x-kiran-device": fx[who].device })}', true);
  set local role authenticated;`;
};
type Step = [P | "postgres", string];
const prelude = `
  insert into public.rep_day (rep_id, day) values ('${fx.repA.id}', ${TODAY}) on conflict (rep_id, day) do nothing;
  ${asUser("owner")}
  select app.office_create_location('${id()}', 'rep_bag', '[Test] Office cash bag A', '${fx.repA.id}', ${BAG_LIMIT})
   where not exists (select 1 from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}');
  reset role;
  insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
  values (gen_random_uuid(), '${SKU}', ${BAG_QTY}, '${WH}', ${BAG_A}, 'issue_to_rep', '${fx.manager.id}');`;
const script = (steps: Step[]) =>
  `${prelude}\n${steps.map(([k, sql]) => `${k === "postgres" ? "reset role;" : asUser(k)}\n${sql}`).join("\n")}`;
type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
const tx = async (steps: Step[]) => ((await run("postgres", script(steps))) as unknown as Multi).at(-1)?.rows ?? [];
const txCode = (steps: Step[]) => sqlstate("postgres", script(steps));

const delivered = (): Step[] => {
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
  ];
};
const officeCash = (cid: string, amount = COLLECTED, who: P = "manager"): Step => [
  who,
  `select (app.office_record_cash('${cid}', '${SALON}', ${amount})).number;`,
];
const BALANCES = `select
  (select coalesce(sum(case direction when 'in' then amount_paisa else -amount_paisa end), 0)::bigint
     from public.cash_ledger_entry where holder_type = 'office') as office,
  (select coalesce(sum(case direction when 'in' then amount_paisa else -amount_paisa end), 0)::bigint
     from public.cash_ledger_entry where holder_type = 'rep' and holder_id = '${fx.repA.id}') as rep_a,
  (select coalesce(sum(remaining_paisa), 0)::bigint from app.installment_state('${SALON}')) as owed;`;
const n = (v: unknown) => Number(v);

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_A, `[Test] Office cash A ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Office cash area A')", [AREA_A, T_A]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T_A]);
  await one({ as: "repA" }, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, 24.9, 67.1)", [
    SALON,
    `[Test] Office cash salon ${tag()}`,
    AREA_A,
  ]);
  // D-35 (slice 7): a rep's salon is a proposal; the office approves it before any order.
  await approveSalon(SALON);
  await one(OWNER, "select app.owner_set_credit($1, 'INST4', $2, 'office cash tests, owner decision')", [SALON, CREDIT_LIMIT]);
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, $3)", [
    GROUP,
    `[Test] Office cash colour ${tag()}`,
    GROUP_CYCLE_DAYS,
  ]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Office cash colour')", [PRODUCT, GROUP]);
  await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', $4)", [
    SKU,
    PRODUCT,
    `T-OFC-${tag().toUpperCase()}`,
    SKU_SIZE,
  ]);
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU, UNIT]);
  await one(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Office cash store')", [WH]);
  await one(
    "postgres",
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, $2, $3, 'receipt', $4)`,
    [SKU, STOCK_QTY, WH, fx.manager.id],
  );
});

afterAll(async () => {
  await one(MANAGER, "select app.office_end_territory($1, $2, 'office cash tests finished')", [fx.repA.id, T_A]);
});

describe("the office records cash collected from a salon (PAY-02, L-0362)", () => {
  it.each([
    "manager",
    "owner",
  ] as const)("%s: the cash goes to the office, not to any rep, and pays the oldest installments", async (who) => {
    const p = id();
    const [before] = await tx([...delivered(), ["postgres", BALANCES]]);
    const [after] = await tx([...delivered(), officeCash(p, COLLECTED, who), ["postgres", BALANCES]]);
    expect(n(after.office) - n(before.office)).toBe(COLLECTED);
    expect(n(after.rep_a)).toBe(n(before.rep_a));
    expect(n(before.owed) - n(after.owed)).toBe(COLLECTED);
  });

  it("the payment is the office's own, flagged office_collected, with a numbered receipt", async () => {
    const p = id();
    const rows = await tx([
      ...delivered(),
      officeCash(p),
      [
        "postgres",
        `select flags::text f, method::text m, recorded_by_role::text r, rep_day_id,
                (select count(*)::int from public.receipt x where x.payment_id = p.id) receipts
         from public.payment p where client_id = '${p}'`,
      ],
    ]);
    expect(rows[0]).toEqual({ f: '["office_collected"]', m: "cash", r: "manager", rep_day_id: null, receipts: 1 });
  });

  it("a replay returns the same receipt and moves the cash once", async () => {
    const p = id();
    const [before] = await tx([...delivered(), ["postgres", BALANCES]]);
    const [after] = await tx([...delivered(), officeCash(p), officeCash(p), ["postgres", BALANCES]]);
    expect(n(after.office) - n(before.office)).toBe(COLLECTED);
  });

  it("more than the salon owes, or nothing, is refused", async () => {
    expect(await txCode([...delivered(), officeCash(id(), INST4_QTY * UNIT + 1)])).toBe("23514");
    expect(await txCode([...delivered(), officeCash(id(), 0)])).toBe("22023");
  });

  it.each([
    ["repA", "a rep records its own collections with rep_record_payment"],
    ["managerAal1", "the office needs MFA"],
  ] as const)("%s is refused: %s (42501)", async (who, _why) => {
    expect(await txCode([...delivered(), officeCash(id(), COLLECTED, who)])).toBe("42501");
  });

  it("a bank transfer recorded by the office is still flagged on_behalf and moves no cash", async () => {
    const p = id();
    const [before] = await tx([...delivered(), ["postgres", BALANCES]]);
    const rows = await tx([
      ...delivered(),
      ["manager", `select (app.office_record_payment('${p}', '${SALON}', ${UNIT}, 'Dummy Bank', 'TRX-OFC1')).number;`],
      ["postgres", `select flags::text f, ${BALANCES.slice("select".length, -1)} from public.payment where client_id = '${p}'`],
    ]);
    expect(rows[0]?.f).toBe('["on_behalf"]');
    expect(n(rows[0]?.office)).toBe(n(before.office));
  });
});
