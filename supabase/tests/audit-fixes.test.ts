/**
 * P1-30, migration 20261105210000: fixes from the backend-to-screen wiring audit of 2026-11-05 and MJ's
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
import { fx, MANAGER, OWNER, run, sqlstate } from "./helpers/db";
import { asLogin, asLoginRows, newLogin, type Login } from "./helpers/invite";
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
        `(select jsonb_build_object('status', status, 'why', decision_reason, 'by', checker_name)
                  from app.office_pending_approvals() where status = 'rejected' and reason = 'two units missing') as x`,
        "manager",
      ),
    ]);
    expect(r.p[0].x).toEqual({ qty: TWO, status: "pending", checker: "manager" });
    expect(r.q[0].x).toEqual({ status: "rejected", why: "recount first please" });
    expect(r.a[0].x).toMatchObject({ status: "rejected", why: "recount first please" });
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

  it("an unanswered count: the manager withdraws it, nothing moves, the rep can no longer answer, the next count goes ahead", async () => {
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
      withdraw("manager"),
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
        withdraw("manager"),
        ["repA", `select app.rep_respond_handover(gen_random_uuid(), ${h(hc)}, true);`],
      ]),
    ).toBe(WRONG_STATE);
    expect(await txCode([...base(hc), withdraw("manager")])).toBe(WRONG_STATE);
    expect(await txCode([order(o), deliver(o), repCash(id(), UNIT), count(hc), withdraw("repA")])).toBe(DENIED);
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
        `(select jsonb_build_object('kind', placed_by_kind, 'name', placed_by_name) from app.office_overview_rows()
                     where section = 'placed' and order_id = ${orderOf(ocid)}) as x`,
        "manager",
      ),
    ]);
    const d = (after: Row, before: Row, k: string) => n(after[k]) - n(before[k]);
    expect(d(r.aa[0], r.ab[0], "placed_count")).toBe(1);
    expect(d(r.aa[0], r.ab[0], "orders_count")).toBe(0);
    expect(d(r.ba[0], r.bb[0], "placed_count")).toBe(0);
    expect(d(r.ba[0], r.bb[0], "orders_count")).toBe(1);
    expect(r.home[0].x).toEqual({ kind: "rep", name: fx.repA.full_name ?? expect.any(String) });
  });
});
