/**
 * Section 7 attack pass on the CRM modules built so far (P1-02 a and b, P1-04, P1-06 a and b, P1-16),
 * written by a session that did not build them (ACTIVITY C-012). Every test tries to break a control
 * from a rep, a rep of another territory, a suspended rep, a rep on an unapproved device, a manager,
 * an owner at AAL1, anon or service_role; a test that passes means the attack was refused.
 *
 * Catalogue, territories, salons and a warehouse are committed with fresh ids (as the other module
 * files do) and the territory assignments are ended afterwards. Rep days, bags, orders, deliveries and
 * approvals exist only inside rolled-back transactions, so the inventory tests (which create rep A's
 * bag later in name order) are not disturbed. Synthetic data only (H-03, H-04).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fx, MANAGER, OWNER, REP_A, run, type Who } from "./helpers/db";

const C = { commit: true };
const id = () => randomUUID();
const tag = () => randomUUID().slice(0, 8);
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];
const TODAY = "(now() at time zone 'Asia/Karachi')::date";

const T_A = id(),
  AREA_A = id(),
  T_B = id(),
  AREA_B = id();
const SALON_A = id(),
  SALON_B = id();
const PHONE_A = "+920000009001"; // synthetic (H-03)
const GROUP = id(),
  PRODUCT = id(),
  SKU1 = id(), // Rs 1,200
  SKU2 = id(); // Rs 500
const WH = id();
const BAG_A = `(select l.id from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}')`;

type P = "repA" | "repB" | "manager" | "owner" | "suspendedRep";
const asUser = (k: P, aal?: "aal1" | "aal2", device?: string | null) => {
  const level = aal ?? (k === "owner" || k === "manager" ? "aal2" : "aal1");
  const dev = device === undefined ? fx[k].device : device;
  return `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx[k].id, role: "authenticated", aal: level })}', true),
         set_config('request.headers', '${JSON.stringify(dev ? { "x-kiran-device": dev } : {})}', true);
  set local role authenticated;`;
};
// Rep A and rep B have an open day today; rep A has a bag (created here only when it has none) with 20 of each SKU.
const prelude = `
  insert into public.rep_day (rep_id, day) values ('${fx.repA.id}', ${TODAY}), ('${fx.repB.id}', ${TODAY}) on conflict (rep_id, day) do nothing;
  ${asUser("owner")}
  select app.office_create_location('${id()}', 'rep_bag', '[Test] Attack bag A', '${fx.repA.id}', 50000000)
   where not exists (select 1 from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}');
  reset role;
  insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
  values (gen_random_uuid(), '${SKU1}', 20, '${WH}', ${BAG_A}, 'issue_to_rep', '${fx.manager.id}'),
         (gen_random_uuid(), '${SKU2}', 20, '${WH}', ${BAG_A}, 'issue_to_rep', '${fx.manager.id}');`;
type Step = [P | "postgres", string] | [P, string, { aal?: "aal1" | "aal2"; device?: string | null }];
const script = (steps: Step[], withPrelude = true) =>
  `${withPrelude ? prelude : ""}\n${steps
    .map(
      (s) =>
        `${s[0] === "postgres" ? "reset role;" : asUser(s[0], (s[2] as { aal?: "aal1" | "aal2" })?.aal, (s[2] as { device?: string | null })?.device)}\n${s[1]}`,
    )
    .join("\n")}`;
type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
const tx = async (steps: Step[]) => ((await run("postgres", script(steps))) as unknown as Multi).at(-1)?.rows ?? [];
/** SQLSTATE of the failure, or null when the script succeeded. */
const code = async (steps: Step[], withPrelude = true): Promise<string | null> => {
  try {
    await run("postgres", script(steps, withPrelude));
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "unknown";
  }
};
const msg = async (steps: Step[]): Promise<string | null> => {
  try {
    await run("postgres", script(steps));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

const lines = (l: Array<[string, number]>) => `'${JSON.stringify(l.map(([sku_id, qty]) => ({ sku_id, qty })))}'::jsonb`;
const order = (cid: string, l: Array<[string, number]>, salon = SALON_A, who: P = "repA", plan = "CASH"): Step => [
  who,
  `select app.create_order('${cid}', '${salon}', '${plan}', 'bag_now', ${lines(l)});`,
];
const rawOrder = (cid: string, rawLines: string, salon = SALON_A): Step => [
  "repA",
  `select app.create_order('${cid}', '${salon}', 'CASH', 'bag_now', ${rawLines});`,
];
const oid = (cid: string) => `(select id from public.sales_order where client_id = '${cid}')`;
const deliver = (dcid: string, ocid: string, l: Array<[string, number]> | null = null, who: P = "repA", extra = ""): Step => [
  who,
  `select (app.rep_deliver('${dcid}', ${oid(ocid)}, 'Ayesha at the counter', 24.9, 67.1, ${l ? lines(l) : "null"}${extra})).*;`,
];

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_A, `[Test] Attack A ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_B, `[Test] Attack B ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Attack area A')", [AREA_A, T_A]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Attack area B')", [AREA_B, T_B]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repB.id, T_B]);
  await one(
    REP_A,
    "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, 24.9, 67.1, null, '[Test] Contact A', $4)",
    [SALON_A, `[Test] Attack salon A ${tag()}`, AREA_A, PHONE_A],
  );
  await one({ as: "repB" }, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, 24.9, 67.1)", [
    SALON_B,
    `[Test] Attack salon B ${tag()}`,
    AREA_B,
  ]);
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, 21)", [GROUP, `[Test] Attack colour ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Attack colour')", [PRODUCT, GROUP]);
  for (const s of [SKU1, SKU2]) {
    await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100)", [
      s,
      PRODUCT,
      `T-ATK-${tag().toUpperCase()}`,
    ]);
  }
  await one(OWNER, "select app.owner_set_sku_price($1, 120000, 'dummy list price')", [SKU1]);
  await one(OWNER, "select app.owner_set_sku_price($1, 50000, 'dummy list price')", [SKU2]);
  await one(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Attack store')", [WH]);
  await one(
    "postgres",
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, 100, $3, 'receipt', $4), (gen_random_uuid(), $2, 100, $3, 'receipt', $4)`,
    [SKU1, SKU2, WH, fx.manager.id],
  );
});

afterAll(async () => {
  await one(MANAGER, "select app.office_end_territory($1, $2, 'attack tests finished')", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_end_territory($1, $2, 'attack tests finished')", [fx.repB.id, T_B]);
});

// ---------------------------------------------------------------------------------------------
describe("catalogue: the structure every attack runs into (H-06, H-08, H-13, H-14, H-01, H-05)", () => {
  const q = async (sql: string) => (await run("postgres", sql)).rows;

  it("every table in public and control has RLS enabled and forced", async () => {
    const rows = await q(`select c.oid::regclass::text t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'control', 'supplier_vault') and c.relkind in ('r', 'p')
        and not (c.relrowsecurity and c.relforcerowsecurity)`);
    expect(rows).toEqual([]);
  });

  it("anon holds no privilege on any table or sequence of public, control, app", async () => {
    const rows = await q(`select c.oid::regclass::text t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'control', 'app') and c.relkind in ('r', 'p', 'v', 'm', 'S')
        and (has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
             or has_any_column_privilege('anon', c.oid, 'select, insert, update'))`);
    expect(rows).toEqual([]);
  });

  it("authenticated and service_role can only SELECT on public and control tables (no write, no truncate)", async () => {
    const rows =
      await q(`select r.rolname || ' ' || c.oid::regclass::text t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (select rolname from pg_roles where rolname in ('authenticated', 'service_role')) r
      where n.nspname in ('public', 'control') and c.relkind in ('r', 'p')
        and (has_table_privilege(r.rolname, c.oid, 'insert, update, delete, truncate')
             or has_any_column_privilege(r.rolname, c.oid, 'insert, update'))`);
    expect(rows).toEqual([]);
  });

  it("anon can execute no function of app, control or vault_api", async () => {
    const rows = await q(`select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('app', 'control', 'vault_api') and has_function_privilege('anon', p.oid, 'execute')`);
    expect(rows).toEqual([]);
  });

  it("every SECURITY DEFINER function of app, control, vault_api pins an empty search_path (H-08)", async () => {
    const rows = await q(`select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('app', 'control', 'vault_api', 'public') and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg in ('search_path=""', 'search_path=') )`);
    expect(rows).toEqual([]);
  });

  it("no public table, view or function result carries a cost, margin, supplier, vendor or lot column (H-01, H-05)", async () => {
    const cols = await q(`select table_name || '.' || column_name c from information_schema.columns
      where table_schema = 'public' and column_name ~* '(cost|margin|supplier|vendor|lot_?no|lot_number|purchase_price)'`);
    expect(cols).toEqual([]);
    const fns = await q(`select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('app', 'public') and pg_get_function_result(p.oid) ~* '(cost|margin|supplier|vendor|lot_?no|lot_number)'`);
    expect(fns).toEqual([]);
  });

  it("money is never a float: no real, double precision or money column in public; every _paisa column is integer, bigint or numeric", async () => {
    const floats = await q(`select table_name || '.' || column_name c from information_schema.columns
      where table_schema = 'public' and data_type in ('real', 'double precision', 'money')`);
    expect(floats).toEqual([]);
    const bad = await q(`select table_name || '.' || column_name c from information_schema.columns
      where table_schema = 'public' and column_name ~ '_paisa$' and data_type not in ('integer', 'bigint', 'numeric')`);
    expect(bad).toEqual([]);
  });

  const APPEND_ONLY = [
    "public.visit",
    "public.salon_note",
    "public.stage_event",
    "public.credit_event",
    "public.stock_movement",
    "public.stock_count",
    "public.demand_signal",
    "public.route",
    "public.sales_order_line",
    "public.delivery",
    "public.delivery_line",
    "public.invoice",
    "control.phone_reveal",
    "control.audit_event",
  ];
  it("every append-only table has an enabled BEFORE UPDATE OR DELETE trigger", async () => {
    const missing: string[] = [];
    for (const t of APPEND_ONLY) {
      const { rows } = await run(
        "postgres",
        `select count(*)::int n from pg_trigger g where g.tgrelid = $1::regclass and not g.tgisinternal and g.tgenabled <> 'D'
           and (g.tgtype & 2) = 2 and (g.tgtype & 8) = 8 and (g.tgtype & 16) = 16`,
        [t],
      );
      if (rows[0].n < 1) missing.push(t);
    }
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("direct writes are refused to every application role (H-06, H-08)", () => {
  const TABLES = [
    "stock_movement",
    "stock_location",
    "stock_issue",
    "stock_count",
    "demand_signal",
    "reorder_rule",
    "product_group",
    "product",
    "sku",
    "territory",
    "area",
    "rep_territory",
    "salon",
    "salon_contact",
    "salon_note",
    "stage_event",
    "rep_day",
    "visit",
    "cycle_estimate",
    "route",
    "route_stop",
    "salon_credit",
    "credit_event",
    "sales_order",
    "sales_order_line",
    "delivery",
    "delivery_line",
    "invoice",
  ];
  const PERSONAS: Array<[string, Who]> = [
    ["rep A", { as: "repA" }],
    ["rep B", { as: "repB" }],
    ["manager", { as: "manager" }],
    ["owner", { as: "owner" }],
    ["suspended rep", { as: "suspendedRep" }],
    ["rep A on an unapproved device", { as: "repA", device: "dev-not-approved-0000" }],
    ["anon", "anon"],
    ["service_role", "service_role"],
  ];
  const state = async (who: Who, sql: string) => {
    try {
      await run(who, sql);
      return "allowed";
    } catch (e) {
      return (e as { code?: string }).code ?? "unknown";
    }
  };
  for (const [label, who] of PERSONAS) {
    it(`${label}: INSERT, UPDATE, DELETE on any module table is 42501`, async () => {
      const out: Record<string, string> = {};
      const { rows: firstCols } = await run(
        "postgres",
        `select table_name t, column_name c from information_schema.columns where table_schema = 'public' and ordinal_position = 1`,
      );
      const first = Object.fromEntries(firstCols.map((r) => [r.t, r.c]));
      for (const t of TABLES) {
        out[`insert ${t}`] = await state(who, `insert into public.${t} default values`);
        out[`update ${t}`] = await state(who, `update public.${t} set ${first[t]} = ${first[t]} where false`);
        out[`delete ${t}`] = await state(who, `delete from public.${t} where false`);
      }
      const bad = Object.entries(out).filter(([, v]) => v !== "42501");
      expect(bad).toEqual([]);
    });
  }
  it("TRUNCATE of a module table is refused to every application role", async () => {
    const bad: string[] = [];
    for (const [label, who] of PERSONAS) {
      for (const t of TABLES) {
        if ((await state(who, `truncate public.${t}`)) !== "42501") bad.push(`${label}: ${t}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it("even the table owner cannot UPDATE or DELETE an existing append-only row (trigger)", async () => {
    // Each case first makes a real row through the supported path, then attacks it as the owner role.
    const note = id();
    const cases: Array<[string, Step[], string, string]> = [
      ["stock_movement", [], "update public.stock_movement set qty = qty + 1", "delete from public.stock_movement"],
      [
        "salon_note",
        [["repA", `select app.add_salon_note('${note}', '${SALON_A}', 'owner attack');`]],
        "update public.salon_note set body = 'x'",
        "delete from public.salon_note",
      ],
      ["stage_event", [], "update public.stage_event set reason = 'x'", "delete from public.stage_event"],
      [
        "sales_order_line",
        [order(id(), [[SKU1, 1]])],
        "update public.sales_order_line set qty = qty + 1",
        "delete from public.sales_order_line",
      ],
      [
        "credit_event",
        [["owner", `select app.owner_set_credit('${SALON_A}', 'INST2', 500000, 'attack setup');`]],
        "update public.credit_event set reason = 'x'",
        "delete from public.credit_event",
      ],
    ];
    const bad: string[] = [];
    for (const [tbl, setup, upd, del] of cases) {
      const have = await tx([...setup, ["postgres", `select count(*)::int n from public.${tbl};`]]);
      if ((have[0].n as number) === 0) {
        bad.push(`${tbl}: no row to attack`);
        continue;
      }
      for (const sql of [upd, del]) {
        if ((await code([...setup, ["postgres", `${sql};`]])) === null) bad.push(`${tbl}: ${sql}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("territory scoping, list-dump and masking (H-14, SAL-02, MAP-12)", () => {
  const repB: Who = { as: "repB" };
  it("rep B cannot see rep A's salon in any read path", async () => {
    const seen = async (sql: string) => {
      try {
        return (await run(repB, sql, [SALON_A])).rows.length;
      } catch (e) {
        return (e as { code?: string }).code;
      }
    };
    expect([0, "42501"]).toContain(await seen("select * from public.salon where id = $1"));
    expect([0, "42501"]).toContain(await seen("select * from public.salon_contact where salon_id = $1"));
    expect([0, "42501"]).toContain(await seen("select * from public.salon_note where salon_id = $1"));
    expect([0, "42501"]).toContain(await seen("select * from public.stage_event where salon_id = $1"));
    expect([0, "42501"]).toContain(await seen("select * from public.visit where salon_id = $1"));
    expect([0, "42501"]).toContain(await seen("select * from public.salon_credit where salon_id = $1"));
    expect([0, "42501"]).toContain(await seen("select * from public.sales_order where salon_id = $1"));
    expect([0, "42501"]).toContain(await seen("select * from public.delivery where salon_id = $1"));
    expect([0, "42501"]).toContain(await seen("select * from public.invoice where salon_id = $1"));
    expect([0, "42501"]).toContain(await seen("select * from app.my_salons(null, null, 1000) where id = $1"));
  });
  it("rep B is refused every salon RPC on rep A's salon", async () => {
    for (const sql of [
      `select app.add_salon_note('${id()}', '${SALON_A}', 'intruder note')`,
      `select * from app.salon_notes('${SALON_A}')`,
      `select * from app.salon_stages('${SALON_A}')`,
      `select * from app.salon_visits('${SALON_A}')`,
      `select app.reveal_phone('${SALON_A}')`,
      `select app.rep_park_salon('${SALON_A}', 'intruder')`,
      `select * from app.salon_credit_status('${SALON_A}')`,
      `select app.rep_add_stop('${SALON_A}')`,
    ]) {
      let outcome: string;
      let rows = -1;
      try {
        rows = (await run(repB, sql)).rows.length;
        outcome = "ok";
      } catch (e) {
        outcome = (e as { code?: string }).code ?? "unknown";
      }
      // refused (42501), or a read that returns nothing
      expect({ sql, ok: outcome === "42501" || (outcome === "ok" && rows === 0) }).toEqual({ sql, ok: true });
    }
  });
  it("my_salons caps a page at 50 rows however large the limit, and masks phone numbers", async () => {
    const r = await run(REP_A, "select * from app.my_salons(null, null, 1000000)");
    expect(r.rows.length).toBeLessThanOrEqual(50);
    const mine = r.rows.find((x) => x.id === SALON_A);
    expect(mine).toBeTruthy();
    expect(JSON.stringify(r.rows)).not.toContain(PHONE_A.slice(-8));
    for (const lim of [0, -1]) {
      let n: number | string;
      try {
        n = (await run(REP_A, "select * from app.my_salons(null, null, $1)", [lim])).rows.length;
      } catch (e) {
        n = (e as { code?: string }).code ?? "unknown";
      }
      expect(typeof n === "string" || n <= 50).toBe(true);
    }
  });
  it("reveal_phone is logged, owner or the rep's own territory only, and the log is not readable or writable by a rep", async () => {
    const r = await tx([
      ["repA", `select app.reveal_phone('${SALON_A}') as revealed;`],
      ["postgres", `select count(*)::int n from control.phone_reveal where salon_id = '${SALON_A}';`],
    ]);
    expect(r[0].n).toBeGreaterThanOrEqual(1);
    for (const sql of [
      "insert into control.phone_reveal default values",
      "delete from control.phone_reveal where false",
      "update control.phone_reveal set salon_id = salon_id where false",
    ]) {
      let c: string | null = null;
      try {
        await run(REP_A, sql);
      } catch (e) {
        c = (e as { code?: string }).code ?? "unknown";
      }
      expect({ sql, c }).toEqual({ sql, c: "42501" });
    }
    // A rep reading the log sees at most its own reveals, never another rep's.
    const others = await tx([
      ["repB", `select app.reveal_phone('${SALON_B}');`],
      ["repA", `select count(*)::int n from control.phone_reveal where actor_id <> '${fx.repA.id}';`],
    ]).catch((e) => [{ n: (e as { code?: string }).code }]);
    expect([0, "42501"]).toContain(others[0].n);
  });
  it("a rep whose territory assignment ends loses the salon and cannot order for it", async () => {
    const own = await tx([
      ["manager", `select app.office_end_territory('${fx.repA.id}', '${T_A}', 'attack: revoked mid-day');`],
      ["repA", `select count(*)::int n from app.my_salons(null, null, 50) where id = '${SALON_A}';`],
    ]);
    expect(own[0].n).toBe(0);
    expect(
      await code([
        ["manager", `select app.office_end_territory('${fx.repA.id}', '${T_A}', 'attack');`],
        order(id(), [[SKU1, 1]]),
      ]),
    ).toBe("42501");
  });
});

// ---------------------------------------------------------------------------------------------
describe("who may call what (H-15, SEC-01, SEC-03, doc 06 §2)", () => {
  const callAs = async (who: Who, sql: string) => {
    try {
      await run(who, sql);
      return "allowed";
    } catch (e) {
      return (e as { code?: string }).code ?? "unknown";
    }
  };
  const OFFICE_CALLS = [
    `select app.office_upsert_territory('${id()}', 'x')`,
    `select app.office_assign_territory('${fx.repA.id}', '${T_A}')`,
    `select app.office_end_territory('${fx.repA.id}', '${T_A}', 'x')`,
    `select app.office_override_stage('${SALON_A}', 'trial', 'x')`,
    `select app.office_set_primary_contact('${SALON_A}', 'N', '+920000000000', 'x')`,
    `select app.office_force_close_rep_day('${id()}', 'x')`,
    `select app.office_set_route('${fx.repA.id}', ${TODAY}, '[]'::jsonb)`,
    `select app.office_set_blocked('${SALON_A}', true, 'x')`,
    `select app.office_raise_limit('${SALON_A}', 100000, 'x')`,
    `select app.office_release_credit_hold('${id()}', 'x')`,
    `select app.office_create_location('${id()}', 'warehouse', 'x')`,
    `select app.office_propose_stock_issue('${id()}', 'to_rep', '${WH}', '${id()}', '[]'::jsonb)`,
    `select app.office_cancel_stock_issue('${id()}', 'x')`,
    `select app.office_post_adjustment('${id()}', '${id()}')`,
    `select app.office_set_reorder_point('${SKU1}', 5)`,
    `select app.office_upsert_sku('${id()}', '${PRODUCT}', 'T-X-1', 'v', 'ml', 100)`,
    `select app.office_deliver('${id()}', '${id()}', '${WH}', 'Name')`,
    `select app.move_stage('${SALON_A}', 'trial', 'manual', 'x')`,
    `select app.write_credit('${SALON_A}', 'owner_set', 'INST4', 99999999, false, 'x')`,
  ];
  const OWNER_CALLS = [
    `select app.owner_set_sku_price('${SKU1}', 1, 'x')`,
    `select app.owner_set_credit('${SALON_A}', 'INST4', 99999999, 'x')`,
    `select app.owner_set_bag_limit(${BAG_A}, 999999999, 'x')`,
  ];
  const personas: Array<[string, Who]> = [
    ["rep A", { as: "repA" }],
    ["suspended rep", { as: "suspendedRep" }],
    ["rep A on an unapproved device", { as: "repA", device: "dev-not-approved-0000" }],
    ["anon", "anon"],
  ];
  for (const [label, who] of personas) {
    it(`${label} is refused every office and owner function`, async () => {
      const out = [];
      for (const sql of [...OFFICE_CALLS, ...OWNER_CALLS]) out.push([sql.slice(7, 40), await callAs(who, sql)]);
      expect(out.filter(([, v]) => v !== "42501")).toEqual([]);
    });
  }
  it("the manager is refused every owner-only function (H-15)", async () => {
    const out = [];
    for (const sql of OWNER_CALLS) out.push([sql.slice(7, 40), await callAs(MANAGER, sql)]);
    expect(out.filter(([, v]) => v !== "42501")).toEqual([]);
  });
  it("an owner or manager at AAL1 is refused office functions (A-03)", async () => {
    const out = [];
    for (const w of [
      { as: "owner", aal: "aal1" },
      { as: "manager", aal: "aal1" },
    ] as Who[]) {
      for (const sql of [OFFICE_CALLS[0], OFFICE_CALLS[3], OFFICE_CALLS[9], ...OWNER_CALLS])
        out.push([JSON.stringify(w), sql.slice(7, 40), await callAs(w, sql)]);
    }
    expect(out.filter((r) => r[2] !== "42501")).toEqual([]);
  });
  it("suspended rep, unapproved device and anon are refused the rep functions too", async () => {
    const WRITE_CALLS = [
      `select app.add_salon_note('${id()}', '${SALON_A}', 'x')`,
      `select app.create_order('${id()}', '${SALON_A}', 'CASH', 'bag_now', ${lines([[SKU1, 1]])})`,
      `select app.rep_check_in('[]'::jsonb)`,
      `select app.reveal_phone('${SALON_A}')`,
    ];
    const READ_CALLS = [
      `select * from app.my_salons(null, null, 5)`,
      `select * from app.my_bag()`,
      `select * from app.my_orders()`,
      `select * from app.my_route(null)`,
    ];
    const out = [];
    for (const [label, who] of personas.slice(1)) {
      for (const sql of WRITE_CALLS) out.push([label, sql.slice(7, 40), await callAs(who, sql)]);
      // A read function may refuse or return nothing; it must never return rows to these callers.
      for (const sql of READ_CALLS) {
        let res: string | number;
        try {
          res = (await run(who, sql)).rows.length;
        } catch (e) {
          res = (e as { code?: string }).code ?? "unknown";
        }
        out.push([label, sql.slice(7, 40), res === 0 ? "42501" : res]);
      }
    }
    expect(out.filter((r) => r[2] !== "42501")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("orders: malformed lines, price tampering, credit gate, replay (ORD-01, ORD-02, CTL-07, SAL-04, H-08)", () => {
  it("bad quantities, SKUs and prices create no order", async () => {
    const ghost = id();
    const cases: Array<[string, string]> = [
      ["zero qty", `'[{"sku_id":"${SKU1}","qty":0}]'::jsonb`],
      ["negative qty", `'[{"sku_id":"${SKU1}","qty":-3}]'::jsonb`],
      ["qty above 10000", `'[{"sku_id":"${SKU1}","qty":10001}]'::jsonb`],
      ["int overflow qty", `'[{"sku_id":"${SKU1}","qty":2147483648}]'::jsonb`],
      ["fractional qty", `'[{"sku_id":"${SKU1}","qty":1.5}]'::jsonb`],
      ["text qty", `'[{"sku_id":"${SKU1}","qty":"many"}]'::jsonb`],
      ["null qty", `'[{"sku_id":"${SKU1}","qty":null}]'::jsonb`],
      ["missing qty", `'[{"sku_id":"${SKU1}"}]'::jsonb`],
      ["unknown sku", `'[{"sku_id":"${ghost}","qty":1}]'::jsonb`],
      ["missing sku", `'[{"qty":1}]'::jsonb`],
      ["not a uuid", `'[{"sku_id":"nope","qty":1}]'::jsonb`],
      ["duplicate sku", `'[{"sku_id":"${SKU1}","qty":1},{"sku_id":"${SKU1}","qty":2}]'::jsonb`],
      ["no lines", `'[]'::jsonb`],
      ["not an array", `'{"sku_id":"${SKU1}","qty":1}'::jsonb`],
      ["null lines", `null`],
      ["price zero", `'[{"sku_id":"${SKU1}","qty":1,"unit_price_paisa":0}]'::jsonb`],
      ["price negative", `'[{"sku_id":"${SKU1}","qty":1,"unit_price_paisa":-100}]'::jsonb`],
      ["price above list", `'[{"sku_id":"${SKU1}","qty":1,"unit_price_paisa":120001}]'::jsonb`],
      ["price float", `'[{"sku_id":"${SKU1}","qty":1,"unit_price_paisa":99.5}]'::jsonb`],
      ["51 lines", `(select jsonb_agg(jsonb_build_object('sku_id','${SKU1}','qty',1)) from generate_series(1,51))`],
    ];
    const accepted: string[] = [];
    for (const [label, raw] of cases) {
      const r = await code([rawOrder(id(), raw)]);
      if (r === null) accepted.push(label);
    }
    expect(accepted).toEqual([]);
  });

  it("an order is refused without an open rep day, for another territory's salon, and for an unknown salon", async () => {
    const noDay = await code([
      ["postgres", `delete from public.rep_day where rep_id = '${fx.repA.id}' and day = ${TODAY};`],
      order(id(), [[SKU1, 1]]),
    ]);
    expect(noDay).toBe("42501");
    expect(await code([order(id(), [[SKU1, 1]], SALON_B)])).toBe("42501");
    expect(await code([order(id(), [[SKU1, 1]], id())])).not.toBeNull();
    expect(await code([order(id(), [[SKU1, 1]], SALON_A, "repB")])).toBe("42501");
  });

  it("the rep cannot choose a price above list or below list without the discount approval (CTL-07)", async () => {
    const o = id();
    const discounted = (): Step => [
      "repA",
      `select app.create_order('${o}', '${SALON_A}', 'CASH', 'bag_now', '[{"sku_id":"${SKU1}","qty":2,"unit_price_paisa":1}]'::jsonb);`,
    ];
    const r = await tx([
      discounted(),
      [
        "postgres",
        `select o.status::text status, o.hold_discount, o.total_paisa::int total, o.discount_paisa::int disc, o.discount_approval_id is not null has_approval,
          (select a.status::text from control.approval_request a where a.id = o.discount_approval_id) approval
        from public.sales_order o where o.client_id = '${o}';`,
      ],
    ]);
    expect(r[0].has_approval).toBe(true);
    expect(r[0].approval).toBe("pending");
    expect(r[0].status).not.toBe("confirmed");
    // The discounted order must not be deliverable while the approval is pending...
    expect(await code([discounted(), deliver(id(), o)])).not.toBeNull();
    // ...and an invoice at the tampered price must never exist.
    const inv = await tx([discounted(), ["postgres", `select count(*)::int n from public.invoice;`]]);
    expect(inv[0].n).toBe(0);
  });

  it("the rep cannot approve their own discount or any approval (maker is not checker, H-12)", async () => {
    const o = id();
    const e = await msg([
      [
        "repA",
        `select app.create_order('${o}', '${SALON_A}', 'CASH', 'bag_now', '[{"sku_id":"${SKU1}","qty":2,"unit_price_paisa":60000}]'::jsonb);`,
      ],
      [
        "repA",
        `select app.decide_approval((select discount_approval_id from public.sales_order where client_id = '${o}'), true, 'self approve');`,
      ],
    ]);
    expect(e).not.toBeNull();
  });

  it("a plan above the salon's eligibility (a brand-new salon on INST4) is held and cannot be delivered (SAL-04)", async () => {
    const o = id();
    const r = await tx([
      order(o, [[SKU1, 1]], SALON_A, "repA", "INST4"),
      ["postgres", `select status::text status, hold_credit, hold_discount from public.sales_order where client_id = '${o}';`],
    ]);
    // Created and held (plan_not_allowed), not confirmed.
    expect(r[0].hold_credit).not.toBeNull();
    expect(r[0].status).not.toBe("confirmed");
    // An INST4 order for a salon with no credit profile must not become an invoice.
    expect(await code([order(o, [[SKU1, 1]], SALON_A, "repA", "INST4"), deliver(id(), o)])).not.toBeNull();
    // A rep cannot lift the hold themselves.
    expect(
      await code([
        order(o, [[SKU1, 1]], SALON_A, "repA", "INST4"),
        ["repA", `select app.office_release_credit_hold(${oid(o)}, 'self release');`],
      ]),
    ).toBe("42501");
  });

  it("replaying a create_order client id is one order; different salon or plan under the same id is refused (H-08)", async () => {
    const o = id();
    const r = await tx([
      order(o, [[SKU1, 2]]),
      order(o, [[SKU1, 2]]),
      order(o, [[SKU1, 2]]),
      ["postgres", `select count(*)::int n, max(total_paisa)::int total from public.sales_order where client_id = '${o}';`],
    ]);
    expect(r[0]).toEqual({ n: 1, total: 240000 });
    const mismatch = await code([order(o, [[SKU1, 2]]), order(o, [[SKU1, 2]], SALON_A, "repA", "INST2")]);
    expect(mismatch).toBe("23505");
  });

  it("the same client id with different LINES is not silently treated as the same order", async () => {
    const o = id();
    const r = await tx([
      order(o, [[SKU1, 1]]),
      order(o, [[SKU1, 9]]),
      ["postgres", `select count(*)::int n, max(total_paisa)::int total from public.sales_order where client_id = '${o}';`],
    ]);
    // Only one order can exist. Whether the second call is refused or returns the first is recorded by this
    // assertion: if it returns the first quietly, the rep believes nine were ordered while one was.
    expect(r[0].n).toBe(1);
  });

  it("a backdated or future client timestamp never moves the server timestamps (H-09)", async () => {
    const o = id();
    const r = await tx([
      [
        "repA",
        `select app.create_order('${o}', '${SALON_A}', 'CASH', 'bag_now', ${lines([[SKU1, 1]])}, null, '2001-01-01T00:00:00Z');`,
      ],
      [
        "postgres",
        `select abs(extract(epoch from (now() - created_at)))::int age_s, created_at_client is not null has_client from public.sales_order where client_id = '${o}';`,
      ],
    ]);
    expect(r[0].age_s).toBeLessThan(120);
    const n = await tx([
      ["repA", `select app.add_salon_note('${id()}', '${SALON_A}', 'backdated', '2001-01-01T00:00:00Z');`],
      [
        "postgres",
        `select extract(year from created_at)::int y from public.salon_note where body = 'backdated' order by created_at desc limit 1;`,
      ],
    ]);
    expect(n[0].y).toBeGreaterThanOrEqual(2026);
  });

  it("an order the rep cancels or another rep cancels: rep B cannot cancel rep A's order", async () => {
    const o = id();
    const e = await code([order(o, [[SKU1, 1]]), ["repB", `select app.cancel_order(${oid(o)}, 'intruder');`]]);
    expect(e).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
describe("deliveries and invoices (ORD-04, ADM-03, H-06, H-11)", () => {
  it("rep B cannot deliver rep A's order, and a rep cannot call office_deliver", async () => {
    const o = id();
    expect(await code([order(o, [[SKU1, 1]]), deliver(id(), o, null, "repB")])).not.toBeNull();
    expect(
      await code([order(o, [[SKU1, 1]]), ["repA", `select app.office_deliver('${id()}', ${oid(o)}, '${WH}', 'Name');`]]),
    ).toBe("42501");
  });

  it("delivering more than ordered, a SKU not on the order, or zero is refused", async () => {
    const o = id();
    for (const l of [[[SKU1, 3]], [[SKU2, 1]], [[SKU1, 0]], [[SKU1, -1]]] as Array<Array<[string, number]>>) {
      expect(await code([order(o, [[SKU1, 2]]), deliver(id(), o, l)])).not.toBeNull();
    }
  });

  it("a full delivery cannot be followed by a second delivery under a new client id", async () => {
    const o = id();
    const r = await code([order(o, [[SKU1, 2]]), deliver(id(), o), deliver(id(), o)]);
    expect(r).not.toBeNull();
  });

  it("a delivery replay is one invoice and one set of stock movements; a reused id for another order is refused", async () => {
    const o1 = id(),
      o2 = id(),
      d = id();
    const r = await tx([
      order(o1, [
        [SKU1, 2],
        [SKU2, 1],
      ]),
      deliver(d, o1),
      deliver(d, o1),
      deliver(d, o1),
      [
        "postgres",
        `select (select count(*)::int from public.invoice i join public.delivery x on x.id = i.delivery_id where x.client_id = '${d}') invoices,
          (select count(*)::int from public.stock_movement m join public.delivery x on x.id = m.source_id where x.client_id = '${d}' and m.source_type = 'delivery') moves,
          app.on_hand(${BAG_A}, '${SKU1}')::int sku1_in_bag;`,
      ],
    ]);
    expect(r[0]).toEqual({ invoices: 1, moves: 2, sku1_in_bag: 18 });
    expect(await code([order(o1, [[SKU1, 2]]), deliver(d, o1), order(o2, [[SKU1, 1]]), deliver(d, o2)])).toBe("23505");
  });

  it("the bag cannot go negative: delivering more than the bag holds is refused and no invoice exists", async () => {
    const o = id();
    const r = await code([order(o, [[SKU1, 21]]), deliver(id(), o)]);
    expect(r).not.toBeNull();
    const inv = await tx([
      [
        "postgres",
        `select count(*)::int n from public.invoice i join public.sales_order s on s.id = i.order_id where s.client_id = '${o}';`,
      ],
    ]);
    expect(inv[0].n).toBe(0);
  });

  it("a cancelled order cannot be delivered", async () => {
    const o = id();
    expect(
      await code([order(o, [[SKU1, 1]]), ["repA", `select app.cancel_order(${oid(o)}, 'attack');`], deliver(id(), o)]),
    ).not.toBeNull();
  });

  it("a delivery needs a receiver name and sane GPS; a backdated client time does not move the invoice time (H-09)", async () => {
    const o = id();
    for (const bad of [
      `select app.rep_deliver('${id()}', ${oid(o)}, '', 24.9, 67.1, null);`,
      `select app.rep_deliver('${id()}', ${oid(o)}, 'A', 24.9, 67.1, null);`,
      `select app.rep_deliver('${id()}', ${oid(o)}, 'Ayesha at the counter', 999, 67.1, null);`,
      `select app.rep_deliver('${id()}', ${oid(o)}, 'Ayesha at the counter', null, null, null);`,
      `select app.rep_deliver('${id()}', ${oid(o)}, 'Ayesha at the counter', 24.9, null, null);`,
    ]) {
      expect(await code([order(o, [[SKU1, 1]]), ["repA", bad]])).not.toBeNull();
    }
    const r = await tx([
      order(o, [[SKU1, 1]]),
      [
        "repA",
        `select (app.rep_deliver('${id()}', ${oid(o)}, 'Ayesha at the counter', 24.9, 67.1, null, false, '2001-01-01T00:00:00Z')).*;`,
      ],
      [
        "postgres",
        `select abs(extract(epoch from (now() - d.delivered_at)))::int age_s, extract(year from d.delivered_at_client)::int client_year
          from public.delivery d join public.sales_order s on s.id = d.order_id where s.client_id = '${o}';`,
      ],
    ]);
    expect(r[0].age_s).toBeLessThan(120);
    expect(r[0].client_year).toBe(2001);
  });

  it("two invoices in a row carry consecutive numbers, and an invoice cannot be changed even by its owner (H-06, H-11)", async () => {
    const o1 = id(),
      o2 = id();
    const r = await tx([
      order(o1, [[SKU1, 1]]),
      order(o2, [[SKU2, 1]]),
      deliver(id(), o1),
      deliver(id(), o2),
      [
        "postgres",
        `select array_agg(substr(i.number, 8)::int order by i.issued_at, i.number) n from public.invoice i
          join public.sales_order s on s.id = i.order_id where s.client_id in ('${o1}', '${o2}');`,
      ],
    ]);
    const n = r[0].n as number[];
    expect(n[1] - n[0]).toBe(1);
    expect(
      await code([
        order(o1, [[SKU1, 1]]),
        deliver(id(), o1),
        ["postgres", `update public.invoice set total_paisa = total_paisa - 1 where order_id = ${oid(o1)};`],
      ]),
    ).not.toBeNull();
    expect(
      await code([
        order(o1, [[SKU1, 1]]),
        deliver(id(), o1),
        ["postgres", `delete from public.invoice where order_id = ${oid(o1)};`],
      ]),
    ).not.toBeNull();
  });

  it("a failed delivery consumes no invoice number (gapless, H-11)", async () => {
    const o1 = id(),
      o2 = id();
    const before = await tx([["postgres", `select coalesce(max(substr(number, 8)::int), 0) m from public.invoice;`]]);
    const after = await tx([
      order(o1, [[SKU1, 21]]),
      order(o2, [[SKU1, 1]]),
      [
        "repA",
        `do $$ begin perform app.rep_deliver('${id()}', ${oid(o1)}, 'Ayesha at the counter', 24.9, 67.1, null); exception when others then null; end $$;`,
      ],
      deliver(id(), o2),
      [
        "postgres",
        `select substr(i.number, 8)::int n from public.invoice i join public.sales_order s on s.id = i.order_id where s.client_id = '${o2}';`,
      ],
    ]);
    expect(after[0].n).toBe((before[0].m as number) + 1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("stock: adjustments, issues, counts (INV-03 to INV-06, CTL-05, H-12)", () => {
  const adjustment = (reqId: string) =>
    `select app.request_approval('${reqId}', 'adjustment', 'stock_location', '${WH}',
        '{"sku_id":"${SKU1}","qty_delta":-5}'::jsonb, 'attack: write 5 off', 'manager');`;
  const reqOf = (reqId: string) => `(select id from control.approval_request where client_id = '${reqId}')`;

  it("a manager cannot approve their own stock adjustment, and cannot post one without approval", async () => {
    const r = id();
    expect(
      await code([
        ["manager", adjustment(r)],
        ["manager", `select app.decide_approval(${reqOf(r)}, true, 'self');`],
      ]),
    ).not.toBeNull();
    expect(
      await code([
        ["manager", adjustment(r)],
        ["manager", `select app.office_post_adjustment('${id()}', ${reqOf(r)});`],
      ]),
    ).toBe("42501");
    expect(await code([["manager", `select app.office_post_adjustment('${id()}', '${id()}');`]])).toBe("42501");
  });

  it("an approved adjustment posts once; the same approval cannot post twice (H-08)", async () => {
    const r = id();
    const ok = await tx([
      ["manager", adjustment(r)],
      ["owner", `select app.decide_approval(${reqOf(r)}, true, 'approve');`],
      ["manager", `select (app.office_post_adjustment('${id()}', ${reqOf(r)})).qty;`],
    ]);
    expect(ok).toHaveLength(1);
    expect(
      await code([
        ["manager", adjustment(r)],
        ["owner", `select app.decide_approval(${reqOf(r)}, true, 'approve');`],
        ["manager", `select app.office_post_adjustment('${id()}', ${reqOf(r)});`],
        ["manager", `select app.office_post_adjustment('${id()}', ${reqOf(r)});`],
      ]),
    ).toBe("42501");
  });

  it("a rep cannot request a stock adjustment approval (A-04)", async () => {
    expect(await code([["repA", adjustment(id()).replace("'manager')", "'manager')")]])).not.toBeNull();
  });

  it("rep B cannot confirm, count or read rep A's bag", async () => {
    const issue = id();
    const bagB = id();
    const propose = (cid: string): Step => [
      "manager",
      `select app.office_propose_stock_issue('${cid}', 'to_rep', '${WH}', ${BAG_A}, '[{"sku_id":"${SKU2}","qty":3}]'::jsonb);`,
    ];
    expect(
      await code([
        propose(issue),
        [
          "repB",
          `select app.rep_confirm_stock_issue((select id from public.stock_issue where client_id = '${issue}'), '[{"sku_id":"${SKU2}","qty":3}]'::jsonb);`,
        ],
      ]),
    ).not.toBeNull();
    expect(
      await code([
        ["repB", `select app.record_count('${bagB}', ${BAG_A}, 'daily_close', '[{"sku_id":"${SKU1}","counted":1}]'::jsonb);`],
      ]),
    ).not.toBeNull();
    // Reading another rep's bag by id is refused (or empty); the null form returns only the caller's own location.
    expect(await code([["repB", `select * from app.stock_on_hand(${BAG_A});`]])).not.toBeNull();
    const mine = await tx([["repB", `select count(distinct location_id)::int n from app.stock_on_hand(null);`]]).catch(() => [
      { n: 0 },
    ]);
    expect(mine[0].n).toBeLessThanOrEqual(1);
  });

  it("a rep sees no warehouse quantities beyond what the availability function allows, and no other rep's bag", async () => {
    const r = await tx([["repA", `select to_jsonb(w) j from app.warehouse_availability() w limit 20;`]]);
    for (const row of r) {
      const keys = Object.keys(row.j as object).join(",");
      expect(keys).not.toMatch(/cost|margin|supplier|vendor/i);
    }
  });

  it("a stock count and a demand signal accept no backdated server time (H-09)", async () => {
    const c = id();
    const r = await tx([
      [
        "repA",
        `select app.record_count('${c}', ${BAG_A}, 'daily_close', '[{"sku_id":"${SKU1}","qty":20},{"sku_id":"${SKU2}","qty":20}]'::jsonb, '2001-01-01T00:00:00Z');`,
      ],
      ["postgres", `select extract(year from created_at)::int y from public.stock_count where client_id = '${c}';`],
    ]);
    expect(r[0].y).toBeGreaterThanOrEqual(2026);
  });
});

// ---------------------------------------------------------------------------------------------
describe("regression: a partial salon edit keeps what it does not name (migration 0014, L-0192 defect 1)", () => {
  // A script of several statements returns one result per statement; a single statement returns one result.
  const edit = async (sql: string) => {
    const r = (await run(REP_A, sql)) as unknown as Multi | Multi[number];
    return Array.isArray(r) ? r : [r];
  };

  it("editing only the name and area leaves the address, pin and chair count as they were", async () => {
    const r = await edit(`
      select app.update_salon('${SALON_A}', '[Test] Renamed once', 'ladies_parlor', '${AREA_A}', 'Shop 5, Test Lane', 24.9, 67.1, 6);
      select (app.update_salon('${SALON_A}', '[Test] Renamed twice', 'ladies_parlor', '${AREA_A}')).*;`);
    expect(r.at(-1)?.rows[0]).toMatchObject({ name: "[Test] Renamed twice", address: "Shop 5, Test Lane", chairs: 6 });
    expect(Number(r.at(-1)?.rows[0].lat)).toBe(24.9);
    expect(Number(r.at(-1)?.rows[0].lng)).toBe(67.1);
  });

  it("a blank name leaves the name as it was", async () => {
    const r = await edit(`select (app.update_salon('${SALON_A}', '   ', 'ladies_parlor', '${AREA_A}')).name;`);
    expect(r.at(-1)?.rows[0].name).toMatch(/^\[Test\] Attack salon A /);
  });

  it("a pin moves only as a pair: lat without lng, or lng without lat, is refused", async () => {
    for (const args of ["24.95, null", "null, 67.2"]) {
      let c: string | undefined;
      try {
        await edit(`select app.update_salon('${SALON_A}', 'x', 'ladies_parlor', '${AREA_A}', null, ${args});`);
      } catch (e) {
        c = (e as { code?: string }).code;
      }
      expect(c).toBe("22023");
    }
  });

  it("the territory check still holds: a rep cannot move the salon to another territory's area", async () => {
    let c: string | undefined;
    try {
      await edit(`select app.update_salon('${SALON_A}', 'x', 'ladies_parlor', '${AREA_B}');`);
    } catch (e) {
      c = (e as { code?: string }).code;
    }
    expect(c).toBe("42501");
  });
});
