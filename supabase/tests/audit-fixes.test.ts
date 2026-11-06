/**
 * P1-30, migration 20261105230000: fixes from the backend-to-screen wiring audit of 2026-11-05 and MJ's
 * decisions D-45 to D-48 (decision file 2026-11-05-mj-audit-decisions).
 *
 * Each test runs as one rolled-back script of steps, each step as a persona the way PostgREST would run it
 * (SET LOCAL ROLE + request.jwt.claims + the device header). Shared fixtures (a territory, an area, an
 * approved salon with INST4 credit, a product, a SKU, a warehouse with stock) are committed once. Other
 * files share the database, so ledger and month figures are read before and after inside the same script.
 * Amounts are paisa.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fx, MANAGER, MANAGER_AAL1, OWNER, OWNER_AAL1, run, sqlstate } from "./helpers/db";
import { asLogin, asLoginRows, type Login, newLogin } from "./helpers/invite";
import { submitApproveSql } from "./helpers/submit-approve";

const C = { commit: true };
const id = () => randomUUID();
const TAG_LENGTH = 8;
const tag = () => randomUUID().slice(0, TAG_LENGTH);
const TODAY = "(now() at time zone 'Asia/Karachi')::date";

const UNIT = 100000; // Rs 1,000 a unit
const QTY = 4;
const CREDIT_LIMIT = 600000; // Rs 6,000: one INST4 order of four units fits, two do not
const STOCK_QTY = 1000;
const BAG_QTY = 60;
const BAG_LIMIT = 500000000;
const TWO = 2; // a two-unit order or request
const OPENING = 25; // units the owner adds as opening stock
const FEW = 5; // a small adjustment
const TENTH = 10; // a handover counted short by a tenth of a unit
const ABOVE_UNITS = -11; // over the 10-unit owner threshold
const AT_UNITS = -10; // 10 units and Rs 10,000 exactly: within both lines
const SMALL = 3;

const DENIED = "42501";
const BAD_INPUT = "22023";
const LIMIT = "23514";
const WRONG_STATE = "55000";
const USED = "23505";

const T = id(),
  AREA = id(),
  SALON = id(),
  SALON2 = id(),
  GROUP = id(),
  PRODUCT = id(),
  SKU = id(),
  WH = id();
const BAG_A = `(select l.id from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}')`;
const PENDING_A = `(select l.id from public.stock_location l where l.kind = 'pending_delivery' and l.owner_user_id = '${fx.repA.id}')`;

type P = "owner" | "manager" | "repA" | "repB";
const asUser = (who: P) => {
  const aal = who.startsWith("rep") ? "aal1" : "aal2";
  const device = fx[who].device;
  return `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx[who].id, role: "authenticated", aal })}', true),
         set_config('request.headers', '${JSON.stringify(device ? { "x-kiran-device": device } : {})}', true);
  set local role authenticated;`;
};
/** "pg:manager" runs as the table owner with the manager's claims (for internal helpers with no grant). */
type Who = P | "postgres" | `pg:${P}`;
type Step = [Who, string];
const switchTo = (k: Who) => {
  if (k === "postgres") return "reset role;";
  if (k.startsWith("pg:")) return `${asUser(k.slice("pg:".length) as P)} reset role;`;
  return asUser(k as P);
};
const prelude = `
  insert into public.rep_day (rep_id, day) values ('${fx.repA.id}', ${TODAY}) on conflict (rep_id, day) do nothing;
  ${asUser("owner")}
  select app.office_create_location('${id()}', 'rep_bag', '[Test] Audit fixes bag A', '${fx.repA.id}', ${BAG_LIMIT})
   where not exists (select 1 from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}');
  reset role;
  insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
  values (gen_random_uuid(), '${SKU}', ${BAG_QTY}, '${WH}', ${BAG_A}, 'issue_to_rep', '${fx.manager.id}');`;
const script = (steps: Step[]) => `${prelude}\n${steps.map(([k, sql]) => `${switchTo(k)}\n${sql}`).join("\n")}`;
type Row = Record<string, unknown>;
type Multi = Array<{ rows: Row[] }>;
/** Runs the steps in one rolled-back transaction; returns the rows of every statement that selected a `mark`. */
const tx = async (steps: Step[]) => {
  const res = (await run("postgres", script(steps))) as unknown as Multi;
  return Object.fromEntries(
    res.filter((r) => typeof r.rows?.[0]?.mark === "string").map((r) => [String(r.rows[0].mark), r.rows]),
  ) as Record<string, Row[]>;
};
const txCode = (steps: Step[]) => sqlstate("postgres", script(steps));
const txError = async (steps: Step[]) => {
  try {
    await run("postgres", script(steps));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};
const n = (v: unknown) => Number(v);

// ---------------------------------------------------------------- fixtures as steps ----
const order = (cid: string, qty = QTY, rep: string | null = fx.repA.id, salon = SALON, plan = "INST4"): Step => [
  "manager",
  `select app.office_create_order('${cid}', '${salon}', '${plan}', '${JSON.stringify([{ sku_id: SKU, qty }])}'::jsonb, ${
    rep ? `'${rep}'` : "null"
  });`,
];
const orderOf = (cid: string) => `(select id from public.sales_order where client_id = '${cid}')`;
const deliver = (ocid: string, qty?: number): Step => [
  "postgres",
  submitApproveSql(asUser, {
    clientId: id(),
    orderExpr: orderOf(ocid),
    rep: "repA",
    approver: "manager",
    lines: qty ? `'${JSON.stringify([{ sku_id: SKU, qty }])}'::jsonb` : null,
    returning: "number",
  }),
];
const repCash = (cid: string, amount: number, salon = SALON): Step => [
  "repA",
  `select (app.rep_record_payment('${cid}', '${salon}', 'cash', ${amount}, 24.9, 67.1)).number;`,
];
const mark = (m: string, sql: string, who: Who = "postgres"): Step => [who, `select '${m}' as mark, ${sql};`];
// Rep A's cash in hand from the ledger, readable by the office under RLS (app.rep_cash_balance has no grant).
const repBalance = `(select coalesce(sum(case direction when 'in' then amount_paisa else -amount_paisa end), 0)::bigint
                     from public.cash_ledger_entry where holder_type = 'rep' and holder_id = '${fx.repA.id}')`;
const owed = (salon = SALON) => `(select coalesce(sum(remaining_paisa), 0)::bigint from app.installment_state('${salon}'))`;
const officeCash = `(select coalesce(sum(case direction when 'in' then amount_paisa else -amount_paisa end), 0)::bigint
                       from public.cash_ledger_entry where holder_type = 'office')`;

let salonLogin: Login;

beforeAll(async () => {
  await run(MANAGER, "select app.office_upsert_territory($1, $2)", [T, `[Test] Audit fixes ${tag()}`], C);
  await run(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Audit fixes area')", [AREA, T], C);
  await run(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T], C);
  await run(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repB.id, T], C);
  // Made by the manager, so approved at once (D-35); both get INST4 credit from the owner.
  const makeSalon = async (salon: string, name: string) => {
    await run(
      MANAGER,
      "select app.create_salon($1, $2, 'ladies_parlor', $3, 'manual', null, 24.9, 67.1)",
      [salon, `[Test] Audit fixes salon ${name} ${tag()}`, AREA],
      C,
    );
    await run(
      OWNER,
      "select app.owner_set_credit($1, 'INST4', $2, 'audit fixes tests, owner decision')",
      [salon, CREDIT_LIMIT],
      C,
    );
  };
  await makeSalon(SALON, "one");
  await makeSalon(SALON2, "two");
  await run(MANAGER, "select app.office_upsert_product_group($1, $2, 21)", [GROUP, `[Test] Audit fixes group ${tag()}`], C);
  await run(
    MANAGER,
    "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Audit fixes colour')",
    [PRODUCT, GROUP],
    C,
  );
  await run(
    MANAGER,
    "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100)",
    [SKU, PRODUCT, `T-AUD-${tag().toUpperCase()}`],
    C,
  );
  await run(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU, UNIT], C);
  await run(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Audit fixes store')", [WH], C);
  await run(
    "postgres",
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, $2, $3, 'receipt', $4)`,
    [SKU, STOCK_QTY, WH, fx.manager.id],
    C,
  );
  // A salon login for SALON2 (an invitation redeemed with an emailed code), for D-45 and AUTH-01.
  const email = `audit.salon.${tag()}@example.test`;
  const inv = (
    await run<{ r: { token: string } }>(
      MANAGER,
      `select app.office_invite(gen_random_uuid(), 'salon', '[Test] Audit salon login', '${email}', '${SALON2}') as r`,
      [],
      C,
    )
  ).rows[0].r;
  salonLogin = await newLogin({ email });
  await asLoginRows(salonLogin, `select app.redeem_invitation('${inv.token}') as r`, { commit: true });
});

afterAll(async () => {
  await run(MANAGER, "select app.office_end_territory($1, $2, 'audit fixes tests finished')", [fx.repA.id, T], C);
  await run(MANAGER, "select app.office_end_territory($1, $2, 'audit fixes tests finished')", [fx.repB.id, T], C);
});

// =============================================================================
describe("AUTH-01: a salon's login is never made staff", () => {
  it("owner_create_user refuses a login with a salon membership (22023); a plain login is still accepted", async () => {
    expect(await sqlstate(OWNER, `select app.owner_create_user('${salonLogin.id}', '[Test] Salon as rep', 'rep')`)).toBe(
      BAD_INPUT,
    );
    expect(await sqlstate(OWNER, `select app.owner_create_user('${salonLogin.id}', '[Test] Salon as manager', 'manager')`)).toBe(
      BAD_INPUT,
    );
    const plain = await newLogin();
    expect(await sqlstate(OWNER, `select app.owner_create_user('${plain.id}', '[Test] New rep', 'rep')`)).toBeNull();
  });
});

// =============================================================================
describe("AUTH-05: an invited rep acts only with an emailed-code session", () => {
  const as = (l: Login, method: "otp" | "password", device: string | null) => {
    const claims = JSON.stringify({
      sub: l.id,
      role: "authenticated",
      aal: "aal1",
      session_id: l.session,
      email: l.email,
      amr: [{ method, timestamp: 1 }],
    });
    return `reset role;
      select set_config('request.jwt.claims', '${claims}', true),
             set_config('request.headers', '${JSON.stringify(device ? { "x-kiran-device": device } : {})}', true);
      set local role authenticated;`;
  };

  it("after redemption, a password token reads no session, registers no phone and passes no device check; the code session does", async () => {
    const email = `audit.rep.${tag()}@example.test`;
    const inv = (
      await run<{ r: { token: string } }>(
        MANAGER,
        `select app.office_invite(gen_random_uuid(), 'rep', '[Test] Invited rep', '${email}') as r`,
        [],
        C,
      )
    ).rows[0].r;
    const l = await newLogin({ email, password: "a-squatter-set-this" });
    await asLoginRows(l, `select app.redeem_invitation('${inv.token}') as r`, { commit: true });
    const device = `audit-device-${tag()}-0000`;
    // The real rep registers its phone with the code session, and the manager approves it (committed).
    await run("postgres", `${as(l, "otp", device)} select app.register_device('${device}', 'web', 'phone');`, [], C);
    await run(
      MANAGER,
      `select app.approve_device((select d.id from public.device d where d.user_id = '${l.id}' order by d.created_at desc limit 1), 'audit test')`,
      [],
      C,
    );
    const pw = async (sql: string) => sqlstate("postgres", `${as(l, "password", device)} ${sql}`);
    const pwRows = async (sql: string) =>
      ((await run("postgres", `${as(l, "password", device)} ${sql}`)) as unknown as Multi).at(-1)?.rows ?? [];
    expect((await pwRows("select app.my_session() as s;"))[0].s).toBeNull();
    expect((await pwRows("select app.rep_device_ok() as ok;"))[0].ok).toBe(false);
    expect(await pw(`select app.register_device('audit-other-${tag()}-000', 'web', 'squatter');`)).toBe(DENIED);
    expect(await pw("select * from app.my_handovers();")).toBe(DENIED);
    const codeRows =
      (
        (await run(
          "postgres",
          `${as(l, "otp", device)} select app.my_session() as s, app.rep_device_ok() as ok;`,
        )) as unknown as Multi
      ).at(-1)?.rows ?? [];
    expect(codeRows[0]).toMatchObject({ ok: true, s: expect.objectContaining({ role: "rep", device_status: "approved" }) });

    // Review of P1-30: the two RLS helpers granted to authenticated return nothing to the password token
    // either (they checked only the role); the code session gets its territory and bag.
    await run(MANAGER, "select app.office_assign_territory($1, $2)", [l.id, T], C);
    await run(
      OWNER,
      "select app.office_create_location(gen_random_uuid(), 'rep_bag', $1, $2, $3)",
      [`[Test] Invited rep bag ${tag()}`, l.id, BAG_LIMIT],
      C,
    );
    const helpers = "select (select count(*)::int from app.my_territory_ids()) as t, app.my_bag_id() is not null as b;";
    expect((await pwRows(helpers))[0]).toEqual({ t: 0, b: false });
    const codeHelpers = ((await run("postgres", `${as(l, "otp", device)} ${helpers}`)) as unknown as Multi).at(-1)?.rows ?? [];
    expect(codeHelpers[0]).toEqual({ t: 1, b: true });
    await run(MANAGER, "select app.office_end_territory($1, $2, 'audit fixes tests finished')", [l.id, T], C);
  });

  it("reps the owner created without an invitation are unaffected (the fixture reps carry no amr claim)", async () => {
    const r = await tx([mark("me", "app.my_session() ->> 'role' as role, app.rep_device_ok() as ok", "repA")]);
    expect(r.me[0]).toMatchObject({ role: "rep", ok: true });
  });
});

// =============================================================================
describe("H7: the manager's stage unblock respects the CTL-08 cap and writes its event", () => {
  const stage = (who: P, to: string): Step => [
    who,
    `select app.office_override_stage('${SALON}', '${to}', 'audit test stage move');`,
  ];
  const events = `(select count(*)::int from public.credit_event e where e.salon_id = '${SALON}' and e.kind = 'unblock' and e.actor_role = 'manager'
                     and e.created_at >= (date_trunc('month', now() at time zone 'Asia/Karachi') at time zone 'Asia/Karachi'))`;

  it("each manager unblock writes an unblock credit_event; past the cap it is refused (42501); the owner still may", async () => {
    const setCap = (v: number): Step => [
      "postgres",
      `update public.app_config set value = '${v}'::jsonb where key = 'credit.manager_override.max_per_salon_month';`,
    ];
    const before = await tx([mark("e", `${events} as n`)]);
    const base = n(before.e[0].n);
    const r = await tx([
      setCap(base + 1),
      stage("manager", "blocked"),
      stage("manager", "active_regular"),
      mark("e", `${events} as n`),
    ]);
    expect(n(r.e[0].n)).toBe(base + 1);
    expect(
      await txCode([
        setCap(base + 1),
        stage("manager", "blocked"),
        stage("manager", "active_regular"),
        stage("manager", "blocked"),
        stage("manager", "active_regular"),
      ]),
    ).toBe(DENIED);
    const o = await tx([
      setCap(base),
      stage("manager", "blocked"),
      stage("owner", "active_regular"),
      mark(
        "o",
        `(select jsonb_build_object('kind', e.kind, 'role', e.actor_role, 'old', e.old_blocked, 'new', e.new_blocked) from public.credit_event e
          where e.salon_id = '${SALON}' order by e.created_at desc, e.tx_id desc limit 1) as e`,
      ),
    ]);
    expect(o.o[0].e).toEqual({ kind: "unblock", role: "owner", old: true, new: false });
  });
});

// =============================================================================
describe("H2: an adjustment request goes to the checker who can approve it", () => {
  const req = (m: string, delta: number, sku = SKU): Step => [
    "manager",
    `select '${m}' as mark, app.office_adjustment_checker('${sku}', ${delta})::text as c;`,
  ];
  it("above the threshold (11 units, or over Rs 10,000) the owner; within it the manager; an unknown SKU the owner", async () => {
    const r = await tx([req("above", ABOVE_UNITS), req("at", AT_UNITS), req("small", SMALL), req("unknown", SMALL, id())]);
    expect(r.above[0].c).toBe("owner");
    expect(r.at[0].c).toBe("manager"); // 10 units at Rs 1,000 is Rs 10,000: not over either line
    expect(r.small[0].c).toBe("manager");
    expect(r.unknown[0].c).toBe("owner");
  });

  it("the same rule as posting: a manager's request it names the owner for cannot be posted on a manager's approval", async () => {
    const cid = id();
    const ask: Step = [
      "manager",
      `select app.request_approval('${cid}', 'adjustment', 'stock_location', '${WH}',
         jsonb_build_object('sku_id', '${SKU}', 'qty_delta', ${-ABOVE_UNITS}), 'opening stock count',
         app.office_adjustment_checker('${SKU}', ${-ABOVE_UNITS}));`,
    ];
    const rid = `(select id from control.approval_request where client_id = '${cid}')`;
    const r = await tx([
      ask,
      ["owner", `select app.decide_approval(${rid}, true, 'counted and checked');`],
      mark("m", `(app.office_post_adjustment(gen_random_uuid(), ${rid})).qty as q`, "manager"),
    ]);
    expect(r.m[0].q).toBe(-ABOVE_UNITS);
    expect(await txCode([["repA", `select app.office_adjustment_checker('${SKU}', ${SMALL});`]])).toBe(DENIED);
  });
});

// =============================================================================
describe("D-45: the owner's own stock adjustment takes effect at once", () => {
  const adjust = (who: P, cid: string, delta: number, loc = `'${WH}'`, reason = "opening stock, counted"): Step => [
    who,
    `select 'adj' as mark, m.* from app.owner_adjust_stock('${cid}', ${loc}, '${SKU}', ${delta}, '${reason}') m;`,
  ];
  const onHand = `(select coalesce(sum(case when to_location_id = '${WH}' then qty else -qty end), 0)::bigint
                     from public.stock_movement where sku_id = '${SKU}' and '${WH}' in (from_location_id, to_location_id))`;

  it("posts an adjustment movement with no approval, pointing at the owner's record; replays; stock follows", async () => {
    const cid = id();
    const r = await tx([
      mark("b", `${onHand} as q`),
      adjust("owner", cid, OPENING),
      adjust("owner", cid, OPENING),
      mark("a", `${onHand} as q`),
      mark(
        "row",
        `(select jsonb_build_object('n', count(*), 'reason', min(reason), 'owner', min(owner_id::text)) from public.owner_stock_adjustment where client_id = '${cid}') as x`,
      ),
    ]);
    expect(r.adj[0]).toMatchObject({
      kind: "adjustment",
      approval_id: null,
      source_type: "owner_stock_adjustment",
      qty: OPENING,
      to_location_id: WH,
    });
    expect(n(r.a[0].q) - n(r.b[0].q)).toBe(OPENING);
    expect(r.row[0].x).toEqual({ n: 1, reason: "opening stock, counted", owner: fx.owner.id });
  });

  it("refuses the manager and the rep (42501), a short reason and a pending location (22023), a reused client id (23505)", async () => {
    expect(await txCode([adjust("manager", id(), FEW)])).toBe(DENIED);
    expect(await txCode([adjust("repA", id(), FEW)])).toBe(DENIED);
    expect(await txCode([adjust("owner", id(), FEW, `'${WH}'`, "no")])).toBe(BAD_INPUT);
    expect(await txCode([adjust("owner", id(), -1, PENDING_A)])).toBe(BAD_INPUT);
    const cid = id();
    expect(await txCode([adjust("owner", cid, FEW), adjust("owner", cid, FEW + 1)])).toBe(USED);
  });

  it("the table is append-only and only the owner, as itself, writes it; an adjustment movement still needs an approval or that record", async () => {
    const cid = id();
    expect(
      await txCode([
        adjust("owner", cid, FEW),
        ["postgres", `update public.owner_stock_adjustment set reason = 'changed later' where client_id = '${cid}';`],
      ]),
    ).not.toBeNull();
    expect(
      await txCode([
        [
          // The table owner with the manager's session, naming the owner: the guard still refuses.
          "pg:manager",
          `insert into public.owner_stock_adjustment (client_id, location_id, sku_id, qty_delta, reason, owner_id)
                      values (gen_random_uuid(), '${WH}', '${SKU}', ${FEW}, 'planted by hand', '${fx.owner.id}');`,
        ],
      ]),
    ).toBe(DENIED);
    expect(
      await txCode([
        [
          "postgres",
          `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, source_type, source_id, actor_id)
                      values (gen_random_uuid(), '${SKU}', ${FEW}, '${WH}', 'adjustment', 'something_else', gen_random_uuid(), '${fx.owner.id}');`,
        ],
      ]),
    ).toBe(LIMIT);
    // Review of P1-30: the label alone is not enough. A movement naming an owner adjustment needs that record,
    // with the same SKU, quantity, location and direction (42501), even from the table owner.
    const planted = (source: string, qty = FEW) => `insert into public.stock_movement
        (client_id, sku_id, qty, to_location_id, kind, source_type, source_id, actor_id)
        values (gen_random_uuid(), '${SKU}', ${qty}, '${WH}', 'adjustment', 'owner_stock_adjustment', ${source}, '${fx.owner.id}');`;
    expect(await txCode([["postgres", planted("gen_random_uuid()")]])).toBe(DENIED);
    const own = id();
    expect(
      await txCode([
        adjust("owner", own, FEW),
        ["postgres", planted(`(select a.id from public.owner_stock_adjustment a where a.client_id = '${own}')`, FEW + 1)],
      ]),
    ).toBe(DENIED);
  });

  it("when the owner settles goods as missing, a pending request for them that no longer fits is cancelled", async () => {
    const ocid = id(),
      scid = id(),
      rcid = id();
    const sub = `(select id from public.delivery_submission where client_id = '${scid}')`;
    const r = await tx([
      order(ocid, TWO),
      ["repA", `select app.rep_submit_delivery('${scid}', ${orderOf(ocid)}, 'Counter', 24.9, 67.1, null);`],
      ["manager", `select app.office_reject_delivery(${sub}, gen_random_uuid(), 'salon refused the goods');`],
      [
        "manager",
        `select app.request_approval('${rcid}', 'adjustment', 'stock_location', ${PENDING_A},
         jsonb_build_object('sku_id', '${SKU}', 'qty_delta', -${TWO}, 'submission_id', ${sub}), 'two units missing');`,
      ],
      [
        "owner",
        `select app.office_resolve_pending(gen_random_uuid(), ${sub}, '${SKU}', 1, 'missing', 'one counted gone', null, null);`,
      ],
      mark("s", `(select status::text from control.approval_request where client_id = '${rcid}') as s`),
    ]);
    expect(r.s[0].s).toBe("cancelled");
  });

  it("goods of a rejected delivery: the owner settles them as missing at once; the manager still needs an approved request", async () => {
    const ocid = id(),
      scid = id();
    const reject: Step[] = [
      order(ocid, TWO),
      ["repA", `select app.rep_submit_delivery('${scid}', ${orderOf(ocid)}, 'Counter', 24.9, 67.1, null);`],
      [
        "manager",
        `select app.office_reject_delivery((select id from public.delivery_submission where client_id = '${scid}'), gen_random_uuid(), 'salon refused the goods');`,
      ],
    ];
    const sub = `(select id from public.delivery_submission where client_id = '${scid}')`;
    const resolve = (who: P) => `select '${who}' as mark, r.outcome, r.approval_id, r.owner_adjustment_id is not null as own
       from app.office_resolve_pending(gen_random_uuid(), ${sub}, '${SKU}', ${TWO}, 'missing', 'counted twice, gone', null, null) r;`;
    const r = await tx([...reject, ["owner", resolve("owner")]]);
    expect(r.owner[0]).toMatchObject({ outcome: "missing", approval_id: null, own: true });
    expect(await txCode([...reject, ["manager", resolve("manager")]])).toBe(DENIED);
  });

  it("M8: the missing-goods row shows the request's quantity and checker, and a refused request with its reason", async () => {
    const ocid = id(),
      scid = id();
    const sub = `(select id from public.delivery_submission where client_id = '${scid}')`;
    const r = await tx([
      order(ocid, TWO),
      ["repA", `select app.rep_submit_delivery('${scid}', ${orderOf(ocid)}, 'Counter', 24.9, 67.1, null);`],
      ["manager", `select app.office_reject_delivery(${sub}, gen_random_uuid(), 'salon refused the goods');`],
      [
        "manager",
        `select app.request_approval(gen_random_uuid(), 'adjustment', 'stock_location', ${PENDING_A},
         jsonb_build_object('sku_id', '${SKU}', 'qty_delta', -${TWO}, 'submission_id', ${sub}), 'two units missing');`,
      ],
      ["postgres", "select 1;"],
      mark(
        "p",
        `(select jsonb_build_object('qty', request_qty, 'status', request_status, 'checker', request_checker_role)
                  from app.office_pending_stock() where submission_id = ${sub}) as x`,
        "owner",
      ),
      [
        "owner",
        `select app.decide_approval((select request_id from app.office_pending_stock() where submission_id = ${sub}), false, 'recount first please');`,
      ],
      mark(
        "q",
        `(select jsonb_build_object('status', request_status, 'why', request_decision_reason)
                  from app.office_pending_stock() where submission_id = ${sub}) as x`,
        "manager",
      ),
      mark(
        "a",
        `(select jsonb_build_object('why', decision_reason, 'by', checker_name)
                  from app.office_refused_approvals() where reason = 'two units missing') as x`,
        "manager",
      ),
    ]);
    expect(r.p[0].x).toEqual({ qty: TWO, status: "pending", checker: "manager" });
    expect(r.q[0].x).toEqual({ status: "rejected", why: "recount first please" });
    expect(r.a[0].x).toMatchObject({ why: "recount first please" });
  });

  it("a refused request stops showing once a newer request for the same goods was withdrawn", async () => {
    const ocid = id(),
      scid = id(),
      rcid = id();
    const sub = `(select id from public.delivery_submission where client_id = '${scid}')`;
    const shown = (m: string) =>
      mark(
        m,
        `(select jsonb_build_object('id', request_id, 'status', request_status, 'why', request_decision_reason)
                  from app.office_pending_stock() where submission_id = ${sub}) as x`,
        "manager",
      );
    const r = await tx([
      order(ocid, TWO),
      ["repA", `select app.rep_submit_delivery('${scid}', ${orderOf(ocid)}, 'Counter', 24.9, 67.1, null);`],
      ["manager", `select app.office_reject_delivery(${sub}, gen_random_uuid(), 'salon refused the goods');`],
      // An older request, already refused. Planted with an earlier created_at: two requests made through
      // the API inside one transaction would share now(), and the newest could not be told apart.
      [
        "postgres",
        `insert into control.approval_request (client_id, kind, subject_type, subject_id, payload, maker_id,
           checker_role_required, checker_id, status, reason, decision_reason, created_at, decided_at)
         values (gen_random_uuid(), 'adjustment', 'stock_location', ${PENDING_A},
           jsonb_build_object('sku_id', '${SKU}', 'qty_delta', -${TWO}, 'submission_id', ${sub}), '${fx.manager.id}',
           'manager', '${fx.owner.id}', 'rejected', 'two units missing', 'recount first please',
           now() - interval '1 hour', now() - interval '50 minutes');`,
      ],
      shown("before"),
      [
        "manager",
        `select app.request_approval('${rcid}', 'adjustment', 'stock_location', ${PENDING_A},
         jsonb_build_object('sku_id', '${SKU}', 'qty_delta', -${TWO}, 'submission_id', ${sub}), 'two units missing again');`,
      ],
      [
        "manager",
        `select app.cancel_approval((select id from control.approval_request where client_id = '${rcid}'), 'made by mistake');`,
      ],
      shown("after"),
    ]);
    expect(r.before[0].x).toMatchObject({ status: "rejected", why: "recount first please" });
    expect(r.after[0].x).toEqual({ id: null, status: null, why: null });
  });

  it("the maker withdraws its own pending request (app.cancel_approval); nobody else can", async () => {
    const cid = id();
    const reqStep: Step = [
      "manager",
      `select app.request_approval('${cid}', 'adjustment', 'stock_location', '${WH}',
       jsonb_build_object('sku_id', '${SKU}', 'qty_delta', ${TWO}), 'opening stock count');`,
    ];
    const rid = `(select id from control.approval_request where client_id = '${cid}')`;
    const r = await tx([reqStep, mark("c", `(app.cancel_approval(${rid}, 'made by mistake')).status::text as s`, "manager")]);
    expect(r.c[0].s).toBe("cancelled");
    expect(await txCode([reqStep, ["owner", `select app.cancel_approval(${rid}, 'not mine to withdraw');`]])).toBe(DENIED);
  });
});

// =============================================================================
describe("D-45: the owner's own discount takes effect whatever the order's source (B-42, M1)", () => {
  const price = (p: number): Step => [
    "manager",
    `select app.office_set_salon_price(gen_random_uuid(), '${SALON2}', '${SKU}', ${p}, 'audit test salon price');`,
  ];
  const request = (rcid: string): Step => [
    "postgres",
    `${asLogin(salonLogin)} select app.salon_submit_request('${rcid}', '${JSON.stringify([{ sku_id: SKU, qty: 1 }])}'::jsonb, null);`,
  ];
  const card = (rcid: string) => `(select k.id from public.order_intake_card k where k.client_id = '${rcid}')`;
  const convert = (who: P, ocid: string, rcid: string): Step => [
    who,
    `select '${who}' as mark, o.status::text, o.discount_by_owner, o.discount_approval_id is null as no_request, o.source_channel::text as ch
       from app.office_create_order('${ocid}', '${SALON2}', 'CASH', null, null, ${card(rcid)}, null) o;`,
  ];

  it("the owner converting a salon's request below list: confirmed at once, discount_by_owner, no request (was held, B-42)", async () => {
    const rcid = id();
    const r = await tx([price(UNIT / TWO), request(rcid), convert("owner", id(), rcid)]);
    // D-45 changes the rule of MJ's 2026-11-04 (office channel only): the owner's own order, any source.
    expect(r.owner[0]).toMatchObject({ status: "confirmed", discount_by_owner: true, no_request: true, ch: "salon_portal" });
  });

  it("the manager converting the same request still waits for a decision (unchanged)", async () => {
    const rcid = id();
    const r = await tx([price(UNIT / TWO), request(rcid), convert("manager", id(), rcid)]);
    expect(r.manager[0]).toMatchObject({ status: "draft", discount_by_owner: false, no_request: false });
  });
});

// =============================================================================
describe("H4: credit exposure falls as the salon pays (replaces A-10's interim rule)", () => {
  const exposure = (m: string) => mark(m, `app.salon_exposure('${SALON}') as e`);
  it("undelivered value, then what is owed; a full payment frees the limit and the held order confirms on recheck", async () => {
    const [a, b] = [id(), id()];
    const before = await tx([exposure("x")]);
    const base = n(before.x[0].e);
    expect(base).toBe(0);
    const r = await tx([
      order(a),
      exposure("ordered"),
      deliver(a, 1),
      exposure("part"),
      deliver(a),
      exposure("delivered"),
      order(b),
      mark("held", `(select hold_credit from public.sales_order where client_id = '${b}') as h`),
      ["manager", `select app.office_record_payment(gen_random_uuid(), '${SALON}', ${QTY * UNIT}, '[Dummy] Bank', 'AUD-REF-1');`],
      exposure("paid"),
      mark("re", `(app.recheck_order(${orderOf(b)})).status::text as s`, "manager"),
    ]);
    expect(n(r.ordered[0].e)).toBe(QTY * UNIT);
    expect(n(r.part[0].e)).toBe(QTY * UNIT); // Rs 1,000 invoiced and owed plus Rs 3,000 not yet delivered
    expect(n(r.delivered[0].e)).toBe(QTY * UNIT);
    expect(r.held[0].h).toBe("over_limit");
    expect(n(r.paid[0].e)).toBe(0);
    expect(r.re[0].s).toBe("confirmed");
  });

  it("a cash order and a cash invoice never count (MJ L-0163)", async () => {
    const c = id();
    const r = await tx([order(c, 1, fx.repA.id, SALON, "CASH"), deliver(c), exposure("e")]);
    expect(n(r.e[0].e)).toBe(0);
  });
});

// =============================================================================
describe("D-48: payment reversal", () => {
  const setup = (ocid: string): Step[] => [order(ocid), deliver(ocid)];
  const reverse = (who: P, cid: string, payCid: string, reason = "wrong salon, recorded by mistake"): Step => [
    who,
    `select 'rev' as mark, r.* from app.office_reverse_payment('${cid}', (select id from public.payment where client_id = '${payCid}'), '${reason}') r;`,
  ];

  it("a rep's cash collection reversed by the manager: the salon owes it again, ageing and the receipt follow, the rep's cash goes back", async () => {
    const [o, p, rc] = [id(), id(), id()];
    const ageing = `(select coalesce(sum(total_paisa), 0)::bigint from app.office_receivables_ageing('salon') where group_id = '${SALON}')`;
    const r = await tx([
      ...setup(o),
      mark("b", `${owed()} as owed, ${repBalance} as cash`),
      repCash(p, UNIT),
      mark("m", `${owed()} as owed, ${repBalance} as cash, ${ageing} as ageing`, "pg:manager"),
      reverse("manager", rc, p),
      reverse("manager", rc, p),
      mark("a", `${owed()} as owed, ${repBalance} as cash, ${ageing} as ageing`, "pg:manager"),
      mark(
        "doc",
        `app.receipt_document((select r.id from public.receipt r join public.payment q on q.id = r.payment_id where q.client_id = '${p}')) -> 'reversed' ->> 'reason' as why`,
        "manager",
      ),
      mark(
        "list",
        `(select jsonb_build_object('may', may_reverse, 'why', reversal_reason) from app.office_salon_payments('${SALON}')
                     where payment_id = (select id from public.payment where client_id = '${p}')) as x`,
        "owner",
      ),
      repCash(id(), UNIT),
      mark("again", `${owed()} as owed`),
    ]);
    expect(n(r.m[0].owed)).toBe(n(r.b[0].owed) - UNIT);
    expect(n(r.m[0].cash)).toBe(n(r.b[0].cash) + UNIT);
    expect(r.rev[0]).toMatchObject({ cash_holder: "rep", reversed_by_role: "manager" });
    expect(n(r.a[0].owed)).toBe(n(r.b[0].owed));
    expect(n(r.a[0].cash)).toBe(n(r.b[0].cash));
    expect(n(r.a[0].ageing)).toBe(n(r.m[0].ageing) + UNIT);
    expect(r.doc[0].why).toBe("wrong salon, recorded by mistake");
    expect(r.list[0].x).toEqual({ may: false, why: "wrong salon, recorded by mistake" });
    expect(n(r.again[0].owed)).toBe(n(r.b[0].owed) - UNIT); // the installment can be paid again
  });

  it("refusals: a rep (42501), a short reason (22023), a second reversal (55000), a reused client id (23505)", async () => {
    const [o, p] = [id(), id()];
    expect(await txCode([...setup(o), repCash(p, UNIT), reverse("repA", id(), p)])).toBe(DENIED);
    expect(await txCode([...setup(o), repCash(p, UNIT), reverse("manager", id(), p, "no")])).toBe(BAD_INPUT);
    expect(await txCode([...setup(o), repCash(p, UNIT), reverse("manager", id(), p), reverse("owner", id(), p)])).toBe(
      WRONG_STATE,
    );
    const rc = id();
    expect(await txCode([...setup(o), repCash(p, UNIT), reverse("manager", rc, p), reverse("owner", rc, p)])).toBe(USED);
  });

  it("a manager cannot reverse a payment they recorded; the owner can, and office cash goes out", async () => {
    const [o, p] = [id(), id()];
    const own: Step = ["manager", `select app.office_record_cash('${p}', '${SALON}', ${UNIT});`];
    expect(await txCode([...setup(o), own, reverse("manager", id(), p)])).toBe(DENIED);
    const r = await tx([
      ...setup(o),
      own,
      mark("b", `${officeCash} as c`),
      reverse("owner", id(), p),
      mark("a", `${officeCash} as c`),
    ]);
    expect(r.rev[0]).toMatchObject({ cash_holder: "office", reversed_by_role: "owner" });
    expect(n(r.a[0].c)).toBe(n(r.b[0].c) - UNIT);
  });

  it("after the rep handed the cash over, the reversal takes it from the office, not from the rep", async () => {
    const [o, p] = [id(), id()];
    const hcid = id();
    const r = await tx([
      ...setup(o),
      repCash(p, UNIT),
      ["manager", `select app.office_count_handover('${hcid}', '${fx.repA.id}', ${repBalance});`],
      [
        "repA",
        `select app.rep_respond_handover(gen_random_uuid(), (select id from public.handover where client_id = '${hcid}'), true);`,
      ],
      mark("b", `${repBalance} as cash`),
      reverse("manager", id(), p),
      mark("a", `${repBalance} as cash`),
    ]);
    expect(r.rev[0].cash_holder).toBe("office");
    expect(n(r.a[0].cash)).toBe(n(r.b[0].cash));
  });

  // Review of P1-30: a count made after the payment already holds that cash in its expected figure. If the
  // reversal took the cash from the rep while that count was open, the rep's later answer (or the owner's
  // settlement) would take it out a second time. So the reversal waits until the open handover is answered,
  // settled or withdrawn.
  const countAll = (hcid: string): Step => [
    "manager",
    `select app.office_count_handover('${hcid}', '${fx.repA.id}', ${repBalance});`,
  ];
  const hOf = (hcid: string) => `(select id from public.handover where client_id = '${hcid}')`;
  const disputeOf = (hcid: string): Step => [
    "repA",
    `select app.rep_respond_handover(gen_random_uuid(), ${hOf(hcid)}, false, 'I handed over more than that');`,
  ];

  it("is refused (55000) while the rep's count waits for an answer or is under dispute", async () => {
    const [o, p, hc] = [id(), id(), id()];
    const counted: Step[] = [...setup(o), repCash(p, UNIT), countAll(hc)];
    expect(await txCode([...counted, reverse("manager", id(), p)])).toBe(WRONG_STATE);
    expect(await txCode([...counted, disputeOf(hc), reverse("owner", id(), p)])).toBe(WRONG_STATE);
  });

  it("after the owner settles the dispute, the reversal takes the cash from the office and the rep's ledger is not touched again", async () => {
    const [o, p, hc] = [id(), id(), id()];
    const r = await tx([
      ...setup(o),
      repCash(p, UNIT),
      countAll(hc),
      disputeOf(hc),
      ["owner", `select app.owner_settle_handover(gen_random_uuid(), ${hOf(hc)}, 'counted', 'checked the till roll');`],
      mark("b", `${repBalance} as rep, ${officeCash} as office`),
      reverse("manager", id(), p),
      mark("a", `${repBalance} as rep, ${officeCash} as office`),
    ]);
    expect(r.rev[0].cash_holder).toBe("office");
    expect(n(r.a[0].rep)).toBe(n(r.b[0].rep));
    expect(n(r.a[0].office)).toBe(n(r.b[0].office) - UNIT);
  });

  it("after the office withdraws the count, the rep still holds the cash, so the reversal takes it from the rep", async () => {
    const [o, p, hc] = [id(), id(), id()];
    const r = await tx([
      ...setup(o),
      mark("b", `${repBalance} as rep, ${officeCash} as office`),
      repCash(p, UNIT),
      countAll(hc),
      ["owner", `select app.office_withdraw_handover(gen_random_uuid(), ${hOf(hc)}, 'phone lost, counting again');`],
      reverse("manager", id(), p),
      mark("a", `${repBalance} as rep, ${officeCash} as office`),
    ]);
    expect(r.rev[0].cash_holder).toBe("rep");
    expect(n(r.a[0].rep)).toBe(n(r.b[0].rep));
    expect(n(r.a[0].office)).toBe(n(r.b[0].office));
  });

  it("a count that took the rep's lock after the payment counts it, even in the same transaction (counted_at is the clock after the lock)", async () => {
    const [o, p, hc] = [id(), id(), id()];
    const r = await tx([
      ...setup(o),
      repCash(p, UNIT),
      countAll(hc),
      ["repA", `select app.rep_respond_handover(gen_random_uuid(), ${hOf(hc)}, true);`],
      repCash(id(), UNIT),
      mark("b", `${repBalance} as rep`),
      reverse("manager", id(), p),
      mark("a", `${repBalance} as rep`),
    ]);
    expect(r.rev[0].cash_holder).toBe("office");
    expect(n(r.a[0].rep)).toBe(n(r.b[0].rep));
  });

  it("the reversal row is append-only", async () => {
    const [o, p, rc] = [id(), id(), id()];
    expect(
      await txCode([
        ...setup(o),
        repCash(p, UNIT),
        reverse("manager", rc, p),
        ["postgres", `delete from public.payment_reversal where client_id = '${rc}';`],
      ]),
    ).not.toBeNull();
  });
});

// =============================================================================
describe("D-47: the intraday cash cap (CTL-17)", () => {
  const cap = (extra: string): Step => [
    "postgres",
    `update public.app_config set value = to_jsonb(${repBalance} + ${extra}) where key = 'cash.intraday_cap_paisa';`,
  ];
  it("a collection that would pass the cap is refused in rupees; within it, and a replay, and a bank transfer go through", async () => {
    const [o, p1] = [id(), id()];
    const msg = await txError([order(o), deliver(o), cap(String(UNIT + UNIT / TWO)), repCash(p1, UNIT), repCash(id(), UNIT)]);
    // The refusal in rupees, e.g. "cash limit reached: you hold Rs 1,000.00 and the limit is Rs 1,500.00"; not "... 150000 paisa".
    // https://regex101.com/?regex=cash%20limit%20reached%3A%20you%20hold%20Rs%20%5B0-9%2C%5D%2B%5C.00%20and%20the%20limit%20is%20Rs%20%5B0-9%2C%5D%2B%5C.00&flavor=javascript
    expect(msg).toMatch(/cash limit reached: you hold Rs [0-9,]+\.00 and the limit is Rs [0-9,]+\.00/);
    const r = await tx([
      order(o),
      deliver(o),
      cap(String(UNIT + UNIT / TWO)),
      repCash(p1, UNIT),
      repCash(p1, UNIT),
      [
        "repA",
        `select app.rep_record_payment(gen_random_uuid(), '${SALON}', 'bank_transfer', ${UNIT}, 24.9, 67.1, '[Dummy] Bank', 'AUD-REF-2');`,
      ],
      mark("n", `(select count(*)::int from public.payment where client_id = '${p1}') as c`),
    ]);
    expect(r.n[0].c).toBe(1);
  });

  it("a missing cap refuses cash (fails closed); the office home lists the rep at the cap", async () => {
    const o = id();
    expect(
      await txCode([
        order(o),
        deliver(o),
        ["postgres", "update public.app_config set value = '\"x\"' where key = 'cash.intraday_cap_paisa';"],
        repCash(id(), UNIT),
      ]),
    ).toBe(DENIED);
    const r = await tx([
      order(o),
      deliver(o),
      cap(String(UNIT)),
      repCash(id(), UNIT),
      mark("list", `(select count(*)::int from app.office_cash_cap_reps() where rep_id = '${fx.repA.id}') as c`, "manager"),
      mark("home", "(select reps_at_cash_cap from app.office_overview_counts()) as c", "manager"),
    ]);
    expect(r.list[0].c).toBe(1);
    expect(n(r.home[0].c)).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
describe("M7: cash held by a rep who is no longer active is listed for the office", () => {
  const status = (to: string): Step => ["owner", `select app.owner_set_status('${fx.repA.id}', '${to}', 'left the company');`];
  const listed = (m: string): Step =>
    mark(
      m,
      `(select count(*)::int from app.office_inactive_rep_cash() where rep_id = '${fx.repA.id}') as c,
       (select cash_paisa from app.office_inactive_rep_cash() where rep_id = '${fx.repA.id}') as cash,
       (select status::text from app.office_inactive_rep_cash() where rep_id = '${fx.repA.id}') as st,
       ${repBalance} as ledger`,
      "manager",
    );
  it("an active rep is not listed; a suspended or offboarded one with cash is, with the ledger's amount; reactivated, it leaves the list", async () => {
    const o = id();
    const r = await tx([
      order(o),
      deliver(o),
      repCash(id(), UNIT),
      listed("active"),
      status("suspended"),
      listed("suspended"),
      status("active"),
      listed("back"),
    ]);
    expect(r.active[0].c).toBe(0);
    expect(r.suspended[0].c).toBe(1);
    expect(r.suspended[0].st).toBe("suspended");
    expect(n(r.suspended[0].cash)).toBe(n(r.suspended[0].ledger));
    expect(n(r.suspended[0].cash)).toBeGreaterThanOrEqual(UNIT);
    expect(r.back[0].c).toBe(0);
  });

  it("an offboarded rep (final) with cash is listed as offboarded", async () => {
    const o = id();
    const r = await tx([order(o), deliver(o), repCash(id(), UNIT), status("offboarded"), listed("gone")]);
    expect(r.gone[0].c).toBe(1);
    expect(r.gone[0].st).toBe("offboarded");
    expect(n(r.gone[0].cash)).toBe(n(r.gone[0].ledger));
  });

  it("a rep who is not active and holds nothing is not listed", async () => {
    const r = await tx([
      status("suspended"),
      mark(
        "n",
        `(select count(*)::int from app.office_inactive_rep_cash() where rep_id = '${fx.repA.id}' and cash_paisa <= 0) as c`,
        "manager",
      ),
    ]);
    expect(r.n[0].c).toBe(0);
  });
});

// =============================================================================
describe("D-46: the owner settles a disputed handover; the office withdraws an unanswered one", () => {
  const [o] = [id()];
  const count = (cid: string, less = 0): Step => [
    "manager",
    `select app.office_count_handover('${cid}', '${fx.repA.id}', ${repBalance} - ${less}, ${less ? "'counted less at the desk'" : "null"});`,
  ];
  const h = (cid: string) => `(select id from public.handover where client_id = '${cid}')`;
  const dispute = (cid: string): Step => [
    "repA",
    `select app.rep_respond_handover(gen_random_uuid(), ${h(cid)}, false, 'I handed over the full amount');`,
  ];
  const settle = (who: P, cid: string, scid = id(), outcome = "counted"): Step => [
    who,
    `select 'set' as mark, s.* from app.owner_settle_handover('${scid}', ${h(cid)}, '${outcome}', 'checked the till roll') s;`,
  ];
  const base = (hc: string): Step[] => [order(o), deliver(o), repCash(id(), UNIT), count(hc, UNIT / TENTH), dispute(hc)];

  it("a dispute blocks the next count until it is settled", async () => {
    const hc = id();
    expect(await txCode([...base(hc), repCash(id(), UNIT), count(id())])).toBe(WRONG_STATE);
  });

  it.each([
    "counted",
    "rep",
  ])("the owner settles it (%s): the cash moves as an acknowledgment, the rep sees why, the next count goes ahead", async (outcome) => {
    const hc = id();
    const scid = id();
    const r = await tx([
      ...base(hc),
      mark(
        "b",
        `${repBalance} as rep, ${officeCash} as office, (select expected_paisa from public.handover where client_id = '${hc}') as exp,
                   (select counted_paisa from public.handover where client_id = '${hc}') as cnt`,
      ),
      settle("owner", hc, scid, outcome),
      settle("owner", hc, scid, outcome),
      mark("a", `${repBalance} as rep, ${officeCash} as office`),
      mark(
        "mine",
        `(select jsonb_build_object('status', status, 'settlement', settlement, 'why', settlement_reason) from app.my_handovers() where handover_id = ${h(hc)}) as x`,
        "repA",
      ),
      repCash(id(), UNIT),
      count(id()),
      mark("next", "1 as ok"),
    ]);
    expect(r.set[0]).toMatchObject({ outcome, settled_by_role: "owner" });
    expect(n(r.a[0].rep)).toBe(n(r.b[0].rep) - n(r.b[0].exp));
    expect(n(r.a[0].office)).toBe(n(r.b[0].office) + n(r.b[0].cnt));
    expect(r.mine[0].x).toEqual({ status: "settled", settlement: outcome, why: "checked the till roll" });
    expect(r.next[0].ok).toBe(1);
  });

  it("refusals: the manager (42501), a bad outcome (22023), a second settlement (55000), a handover not under dispute (55000)", async () => {
    const hc = id();
    expect(await txCode([...base(hc), settle("manager", hc)])).toBe(DENIED);
    expect(await txCode([...base(hc), settle("owner", hc, id(), "split")])).toBe(BAD_INPUT);
    expect(await txCode([...base(hc), settle("owner", hc), settle("owner", hc)])).toBe(WRONG_STATE);
    const plain = id();
    expect(await txCode([order(o), deliver(o), repCash(id(), UNIT), count(plain), settle("owner", plain)])).toBe(WRONG_STATE);
  });

  // Review of P1-30 (SEC-11, as D-48 does for reversals): the manager who made a count cannot withdraw it;
  // the owner can. The fixtures have one manager, who makes every count here, so the owner withdraws.
  it("an unanswered count: the owner withdraws it, nothing moves, the rep can no longer answer, the next count goes ahead", async () => {
    const hc = id();
    const withdraw = (who: P): Step => [
      who,
      `select 'w' as mark, s.outcome from app.office_withdraw_handover(gen_random_uuid(), ${h(hc)}, 'phone lost, counting again') s;`,
    ];
    const r = await tx([
      order(o),
      deliver(o),
      repCash(id(), UNIT),
      count(hc),
      mark("b", `${repBalance} as rep, ${officeCash} as office`),
      withdraw("owner"),
      mark("a", `${repBalance} as rep, ${officeCash} as office`),
      count(id()),
      mark("next", "1 as ok"),
    ]);
    expect(r.w[0].outcome).toBe("withdrawn");
    expect(r.a[0]).toMatchObject({ rep: r.b[0].rep, office: r.b[0].office });
    expect(r.next[0].ok).toBe(1);
    expect(
      await txCode([
        order(o),
        deliver(o),
        repCash(id(), UNIT),
        count(hc),
        withdraw("owner"),
        ["repA", `select app.rep_respond_handover(gen_random_uuid(), ${h(hc)}, true);`],
      ]),
    ).toBe(WRONG_STATE);
    expect(await txCode([...base(hc), withdraw("owner")])).toBe(WRONG_STATE);
    expect(await txCode([order(o), deliver(o), repCash(id(), UNIT), count(hc), withdraw("repA")])).toBe(DENIED);
    // The manager who made the count cannot withdraw it (42501).
    expect(await txCode([order(o), deliver(o), repCash(id(), UNIT), count(hc), withdraw("manager")])).toBe(DENIED);
  });

  it("the settlement row is append-only", async () => {
    const hc = id(),
      scid = id();
    expect(
      await txCode([
        ...base(hc),
        settle("owner", hc, scid),
        ["postgres", `update public.handover_settlement set reason = 'changed afterwards' where client_id = '${scid}';`],
      ]),
    ).not.toBeNull();
  });
});

// =============================================================================
describe("FLOW-09, FLOW-10: the month and home figures", () => {
  const month = (m: string, who: "repA" | "repB") => mark(m, `x.* from app.my_month_orders(${TODAY}) x`, who);
  it("a part delivery counts its delivered part as delivered and only the rest as waiting; the home row shows what is left", async () => {
    const a = id();
    const r = await tx([
      month("b", "repA"),
      order(a),
      deliver(a, 1),
      month("a", "repA"),
      mark(
        "row",
        `(select undelivered_paisa from app.office_overview_rows() where section = 'waiting' and order_id = ${orderOf(a)}) as left_paisa`,
        "manager",
      ),
    ]);
    const d = (k: string) => n(r.a[0][k]) - n(r.b[0][k]);
    expect(d("delivered_value_paisa")).toBe(UNIT);
    expect(d("waiting_value_paisa")).toBe((QTY - 1) * UNIT);
    expect(d("waiting_count")).toBe(1);
    expect(n(r.row[0].left_paisa)).toBe((QTY - 1) * UNIT);
  });

  it("an order from rep A's card that the office gives to rep B: placed by A (as the home says), assigned to B", async () => {
    const [ccid, ocid] = [id(), id()];
    const r = await tx([
      month("ab", "repA"),
      month("bb", "repB"),
      [
        "repA",
        `select app.rep_create_card('${ccid}', '${SALON}', 'two of the shade', null, '${JSON.stringify([{ sku_id: SKU, qty: TWO }])}'::jsonb);`,
      ],
      [
        "manager",
        `select app.office_create_order('${ocid}', '${SALON}', 'INST4', null, '${fx.repB.id}',
                     (select id from public.order_intake_card where client_id = '${ccid}'), null);`,
      ],
      month("aa", "repA"),
      month("ba", "repB"),
      mark(
        "home",
        `(select jsonb_build_object('kind', placed_by_kind, 'same', placed_by_name = (select u.full_name from public.user_profile u where u.id = '${fx.repA.id}')) from app.office_overview_rows()
                     where section = 'placed' and order_id = ${orderOf(ocid)}) as x`,
        "manager",
      ),
    ]);
    const d = (after: Row, before: Row, k: string) => n(after[k]) - n(before[k]);
    expect(d(r.aa[0], r.ab[0], "placed_count")).toBe(1);
    expect(d(r.aa[0], r.ab[0], "orders_count")).toBe(0);
    expect(d(r.ba[0], r.bb[0], "placed_count")).toBe(0);
    expect(d(r.ba[0], r.bb[0], "orders_count")).toBe(1);
    expect(r.home[0].x).toEqual({ kind: "rep", same: true });
  });
});

// =============================================================================
// Part 2 (P1-30, the screens package): reads added at the end of the migration.
// =============================================================================
const wrongDevice = (sql: string) => `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.repA.id, role: "authenticated", aal: "aal1" })}', true),
         set_config('request.headers', '${JSON.stringify({ "x-kiran-device": "dev-not-approved-p130" })}', true);
  set local role authenticated;
  ${sql}`;
const asSalon = (sql: string): Step => ["postgres", `${asLogin(salonLogin)} ${sql}`];
const membership = () => `(select id from public.salon_membership where user_id = '${salonLogin.id}')`;
const REP_PAGE_CAP = 50; // H-14: a rep read returns at most 50 rows
// A receipt number: "R-26-000001" matches; "R-2026-1" and "R26000001" do not.
// https://regex101.com/?regex=%5ER-%5Cd%7B2%7D-%5Cd%7B6%7D%24&flavor=javascript
const RECEIPT = /^R-\d{2}-\d{6}$/;

describe("REP-03, FLOW-06, FLOW-18: the rep's orders", () => {
  it("my_territory_order reads one order by id with its hold codes and the cancel reason; another territory gets nothing", async () => {
    const [a, b] = [id(), id()];
    const r = await tx([
      order(a),
      order(b),
      ["manager", `select app.cancel_order(${orderOf(b)}, 'the salon closed for a month');`],
      mark("a", `t.* from app.my_territory_order(${orderOf(a)}) t`, "repA"),
      mark("b", `t.* from app.my_territory_order(${orderOf(b)}) t`, "repA"),
      mark("none", `(select count(*)::int from app.my_territory_order(gen_random_uuid())) as k`, "repA"),
    ]);
    expect(r.a[0].status).toBe("confirmed");
    expect(r.a[0].assigned_rep_id).toBe(fx.repA.id);
    expect(typeof r.a[0].salon_name).toBe("string");
    expect(r.b[0].status).toBe("cancelled");
    expect(r.b[0].cancel_reason).toBe("the salon closed for a month");
    expect(n(r.none[0].k)).toBe(0);
  });

  it("an order held over the credit limit carries its hold code for the rep", async () => {
    const big = id();
    const r = await tx([
      order(big, QTY * TWO),
      mark("h", `t.status::text s, t.hold_credit from app.my_territory_order(${orderOf(big)}) t`, "repA"),
    ]);
    expect(r.h[0].s).toBe("draft");
    expect(r.h[0].hold_credit).toBe("over_limit");
  });

  it("the rep's own open assigned orders come before newer orders of others in my_territory_orders", async () => {
    const mine = id();
    const others = [id(), id(), id()];
    const r = await tx([
      order(mine),
      ...others.map((o) => order(o, 1, null)),
      mark("list", `jsonb_agg(t.order_id order by t.ordinality) as ids from app.my_territory_orders() with ordinality t`, "repA"),
      mark(
        "ids",
        `jsonb_build_object('mine', ${orderOf(mine)}, 'others', jsonb_build_array(${others.map(orderOf).join(", ")})) as x`,
      ),
    ]);
    const list = r.list[0].ids as string[];
    const x = r.ids[0].x as { mine: string; others: string[] };
    expect(list).toContain(x.mine);
    const later = x.others.filter((o) => list.includes(o)).map((o) => list.indexOf(o));
    expect(later.every((i) => list.indexOf(x.mine) < i)).toBe(true);
    expect(list.length).toBeLessThanOrEqual(REP_PAGE_CAP);
  });

  it("is for reps on their approved phone: a wrong device, the office and anon are refused 42501", async () => {
    expect(await sqlstate("postgres", wrongDevice("select * from app.my_territory_order(gen_random_uuid());"))).toBe(DENIED);
    expect(await sqlstate(MANAGER, "select * from app.my_territory_order(gen_random_uuid())")).toBe(DENIED);
    expect(await sqlstate(OWNER, "select * from app.my_territory_order(gen_random_uuid())")).toBe(DENIED);
    expect(await sqlstate("anon", "select * from app.my_territory_order(gen_random_uuid())")).toBe(DENIED);
  });
});

describe("REP-10: a rejected proposal tells the rep why", () => {
  it("my_salon returns the office's rejection reason and my_salons the approval state", async () => {
    const s = id();
    const r = await tx([
      ["repA", `select app.create_salon('${s}', '[Test] Proposal ${tag()}', 'ladies_parlor', '${AREA}', 'manual');`],
      mark("pending", `t.approval_status::text a, t.rejection_reason from app.my_salon('${s}') t`, "repA"),
      ["manager", `select app.office_decide_salon('${id()}', '${s}', false, 'already a customer under another name');`],
      mark("rejected", `t.approval_status::text a, t.rejection_reason from app.my_salon('${s}') t`, "repA"),
      mark("list", `(select approval_status::text from app.my_salons(null, null, 50) where id = '${s}') as a`, "repA"),
      mark("other", `(select count(*)::int from app.my_salon('${s}')) as k`, "repB"),
    ]);
    expect(r.pending[0]).toEqual({ mark: "pending", a: "pending", rejection_reason: null });
    expect(r.rejected[0]).toEqual({ mark: "rejected", a: "rejected", rejection_reason: "already a customer under another name" });
    expect(r.list[0].a).toBe("rejected");
    // Rep B covers the same territory, so it reaches the salon too; the reason is the same office text.
    expect(n(r.other[0].k)).toBe(1);
  });
});

describe("REP-09: the rep's own collections", () => {
  it("my_collections lists the rep's payment with its receipt number, marks a reversal, and shows nothing to rep B", async () => {
    const [o, p] = [id(), id()];
    const r = await tx([
      order(o),
      deliver(o),
      repCash(p, UNIT),
      mark(
        "before",
        `c.receipt_number, c.reversed, c.amount_paisa, c.method::text m from app.my_collections('${SALON}') c
                      where c.payment_id = (select id from public.payment where client_id = '${p}')`,
        "repA",
      ),
      [
        "manager",
        `select app.office_reverse_payment('${id()}', (select id from public.payment where client_id = '${p}'), 'recorded against the wrong salon');`,
      ],
      mark(
        "after",
        `c.reversed from app.my_collections(null) c where c.payment_id = (select id from public.payment where client_id = '${p}')`,
        "repA",
      ),
      mark(
        "b",
        `(select count(*)::int from app.my_collections(null) c where c.payment_id = (select id from public.payment where client_id = '${p}')) as k`,
        "repB",
      ),
    ]);
    expect(String(r.before[0].receipt_number)).toMatch(RECEIPT);
    expect(r.before[0].reversed).toBe(false);
    expect(n(r.before[0].amount_paisa)).toBe(UNIT);
    expect(r.before[0].m).toBe("cash");
    expect(r.after[0].reversed).toBe(true);
    expect(n(r.b[0].k)).toBe(0);
  });

  it("is for reps only: the office, a wrong device and anon are refused 42501", async () => {
    expect(await sqlstate(MANAGER, "select * from app.my_collections()")).toBe(DENIED);
    expect(await sqlstate("postgres", wrongDevice("select * from app.my_collections();"))).toBe(DENIED);
    expect(await sqlstate("anon", "select * from app.my_collections()")).toBe(DENIED);
  });
});

describe("AUTH-10, AUTH-09: what the salon is told", () => {
  it("an order on hold for credit reads waiting_on credit_check in the portal, with no hold field or figure", async () => {
    const big = id();
    const r = await tx([
      order(big, QTY * TWO, null, SALON2),
      // The salon cannot read sales_order under RLS, so the order id is pinned as postgres first.
      ["postgres", `select set_config('kiran_test.oid', ${orderOf(big)}::text, true);`],
      asSalon(
        `select 'o' as mark, o.status::text s, o.waiting_on, row_to_json(o)::text j from app.salon_my_orders() o
          where o.order_id = current_setting('kiran_test.oid')::uuid;`,
      ),
    ]);
    expect(r.o[0].s).toBe("draft");
    expect(r.o[0].waiting_on).toBe("credit_check");
    expect(String(r.o[0].j)).not.toContain("hold_");
    expect(String(r.o[0].j)).not.toContain("over_limit");
  });

  it("salon_login_status says active, then suspended (where salon_me says nothing); null for a password session and for staff", async () => {
    const r = await tx([
      asSalon("select 'a' as mark, app.salon_login_status() as x;"),
      ["manager", `select app.office_set_member_status('salon', ${membership()}, 'suspended', 'unpaid for three months');`],
      asSalon("select 's' as mark, app.salon_login_status() as x, app.salon_me() as me;"),
      ["postgres", `${asLogin(salonLogin, "password")} select 'p' as mark, app.salon_login_status() as x;`],
      mark("staff", "app.salon_login_status() as x", "manager"),
    ]);
    expect((r.a[0].x as { membership_status: string }).membership_status).toBe("active");
    expect(r.s[0].x).toMatchObject({ membership_status: "suspended" });
    expect(JSON.stringify(r.s[0].x)).not.toContain("unpaid");
    expect(r.s[0].me).toBeNull();
    expect(r.p[0].x).toBeNull();
    expect(r.staff[0].x).toBeNull();
  });
});

// =============================================================================
// Review of P1-30: every new office write and read refuses an office login at AAL1 and a salon login
// (the master prompt's negative case per operation). assert_office and assert_owner refuse before any input
// is looked at, so made-up ids are enough.
describe("timelines cover delivery submissions, decisions, signatures and payment reversals (plan C2)", () => {
  const KEYS = ["action", "actor_kind", "actor_name", "detail", "entity", "entity_id", "occurred_at", "seq"];
  const timeline = (m: string, fn: "salon" | "order", arg: string): Step =>
    mark(
      m,
      `(select coalesce(jsonb_agg(to_jsonb(t) order by t.seq), '[]'::jsonb) from app.office_${fn}_timeline(${arg}) t) as x`,
      "manager",
    );
  const actionsOf = (rows: unknown) => (rows as Row[]).map((e) => String(e.action));

  it("a delivered order shows the submission, the acknowledgement and the approval; the salon also shows a reversal", async () => {
    const ocid = id(),
      pcid = id();
    const r = await tx([
      order(ocid),
      deliver(ocid),
      repCash(pcid, UNIT),
      [
        "manager",
        `select app.office_reverse_payment(gen_random_uuid(), (select id from public.payment where client_id = '${pcid}'), '[Test] tl-secret reversal');`,
      ],
      timeline("o", "order", orderOf(ocid)),
      timeline("s", "salon", `'${SALON}'`),
    ]);
    const orderRows = r.o[0].x as Row[];
    const salonRows = r.s[0].x as Row[];
    expect(actionsOf(orderRows)).toEqual(
      expect.arrayContaining(["delivery submitted", "receipt acknowledgement", "delivery approved"]),
    );
    expect(actionsOf(salonRows)).toEqual(
      expect.arrayContaining(["delivery submitted", "receipt acknowledgement", "delivery approved", "payment reversed"]),
    );
    expect(orderRows.find((e) => e.action === "receipt acknowledgement")?.detail).toBe("signed");
    for (const e of [...orderRows, ...salonRows]) expect(Object.keys(e).sort()).toEqual(KEYS);
    const all = JSON.stringify([...orderRows, ...salonRows]);
    for (const s of ["tl-secret", "Ayesha Khan", "token", "hash", "purpose"]) expect(all, s).not.toContain(s);
    for (const e of [...orderRows, ...salonRows]) {
      expect(String(e.entity), String(e.entity)).not.toMatch(/commission|handover|stock|signature_(use|image|access)/);
    }
  });

  it("a rejected delivery reads delivery rejected on the order, without the office's reason", async () => {
    const ocid = id(),
      scid = id();
    const sub = `(select id from public.delivery_submission where client_id = '${scid}')`;
    const r = await tx([
      order(ocid, TWO),
      ["repA", `select app.rep_submit_delivery('${scid}', ${orderOf(ocid)}, '[Test] Tl Receiver', 24.9, 67.1, null);`],
      ["manager", `select app.office_reject_delivery(${sub}, gen_random_uuid(), '[Test] tl-secret reject');`],
      timeline("o", "order", orderOf(ocid)),
    ]);
    const rows = r.o[0].x as Row[];
    expect(actionsOf(rows)).toEqual(expect.arrayContaining(["delivery submitted", "delivery rejected"]));
    const all = JSON.stringify(rows);
    for (const s of ["tl-secret", "Tl Receiver"]) expect(all, s).not.toContain(s);
  });
});

describe("the new office functions refuse AAL1 office sessions and a salon login (42501)", () => {
  const u = () => `'${id()}'`;
  const calls: Array<[string, string]> = [
    ["owner_adjust_stock", `select app.owner_adjust_stock(${u()}, ${u()}, ${u()}, 1, 'opening stock, counted')`],
    ["office_adjustment_checker", `select app.office_adjustment_checker(${u()}, 1)`],
    [
      "office_resolve_pending",
      `select app.office_resolve_pending(${u()}, ${u()}, ${u()}, 1, 'missing', 'counted gone', null, null)`,
    ],
    ["office_pending_stock", "select * from app.office_pending_stock()"],
    ["office_refused_approvals", "select * from app.office_refused_approvals()"],
    ["office_reverse_payment", `select app.office_reverse_payment(${u()}, ${u()}, 'recorded by mistake')`],
    ["office_salon_payments", `select * from app.office_salon_payments(${u()})`],
    ["office_cash_cap_reps", "select * from app.office_cash_cap_reps()"],
    ["office_inactive_rep_cash", "select * from app.office_inactive_rep_cash()"],
    ["owner_settle_handover", `select app.owner_settle_handover(${u()}, ${u()}, 'counted', 'checked the till roll')`],
    ["office_withdraw_handover", `select app.office_withdraw_handover(${u()}, ${u()}, 'phone lost, counting again')`],
  ];
  it.each(calls)("%s", async (_name, sql) => {
    expect(await sqlstate(MANAGER_AAL1, sql)).toBe(DENIED);
    expect(await sqlstate(OWNER_AAL1, sql)).toBe(DENIED);
    expect(await sqlstate("postgres", `${asLogin(salonLogin)} ${sql};`)).toBe(DENIED);
  });
});
