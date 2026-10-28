/**
 * Thin due-list and manual routes (migration 0011, task P1-16, D-19): PIP-03, PIP-05 and PIP-06 thin,
 * doc 02 (repeat-cycle engine), doc 08 §2 (the rep re-orders the route and adds pins).
 *
 * Setup commits with fresh ids, like the other module tests; checks that change shared state run in
 * rolled-back transactions. Dates are relative to the Karachi day the suite runs on.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorOf, fx, MANAGER, REP_A, REP_A_WRONG_DEVICE, REP_B, run, SUSPENDED, sqlstate, type Who } from "./helpers/db";

const C = { commit: true };
const id = () => randomUUID();
const tag = () => randomUUID().slice(0, 8);
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];

const T_A = id(),
  T_B = id(),
  AREA_A = id(),
  AREA_B = id();
const S1 = id(),
  S2 = id(),
  S3 = id(),
  SB = id();
const G1 = id(),
  G2 = id();
const G1_NAME = `[Test] Colour ${tag()}`;
const OURS = [S1, S2, S3, SB];
/** Today in Karachi, as SQL (personas cannot call app.karachi_today, which is internal). */
const TODAY = "(now() at time zone 'Asia/Karachi')::date";

/** Several statements in one rolled-back transaction, switching persona part-way (no bind parameters). */
const asUser = (who: { id: string; device: string | null }, aal: "aal1" | "aal2") => `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: who.id, role: "authenticated", aal })}', true),
         set_config('request.headers', '${JSON.stringify(who.device ? { "x-kiran-device": who.device } : {})}', true);
  set local role authenticated;`;
type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
const last = (r: unknown) => (r as Multi).at(-1)?.rows ?? [];

const due = async (who: Who, on = "null") =>
  (
    await run(
      who,
      `select salon_id, product_group_id, due_status, next_due_on - ${TODAY} as due_in
         from app.due_list(${on}) where salon_id = any($1::uuid[])`,
      [OURS],
    )
  ).rows;
const route = async (who: Who = REP_A) =>
  (await run(who, "select salon_id, sequence, reason, visited from app.my_route() where salon_id = any($1::uuid[])", [OURS]))
    .rows;
const stops = (list: Array<[string, string]>) => JSON.stringify(list.map(([salon_id, reason]) => ({ salon_id, reason })));
const setRoute = (list: Array<[string, string]>, day = `${TODAY}`) =>
  run(MANAGER, `select (app.office_set_route($1, ${day}, $2::jsonb)).*`, [fx.repA.id, stops(list)], C);

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_A, `[Test] Routes A ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_B, `[Test] Routes B ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Routes area A')", [AREA_A, T_A]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Routes area B')", [AREA_B, T_B]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repB.id, T_B]);
  for (const [who, sid, area] of [
    [REP_A, S1, AREA_A],
    [REP_A, S2, AREA_A],
    [REP_A, S3, AREA_A],
    [REP_B, SB, AREA_B],
  ] as const) {
    await one(who, "select app.create_salon($1, $2, 'mens_salon', $3, 'map_pin', null, 24.9, 67.1)", [
      sid,
      `[Test] Route salon ${tag()}`,
      area,
    ]);
  }
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, 20)", [G1, G1_NAME]);
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, 30)", [G2, `[Test] Shampoo ${tag()}`]);
  // S1 colour due in 3 days; S2 colour 5 days overdue; S3 shampoo 16 days overdue (at risk after 15);
  // S1 shampoo bought yesterday (not due); SB colour due today in rep B's territory.
  for (const [sid, g, ago] of [
    [S1, G1, 17],
    [S2, G1, 25],
    [S3, G2, 46],
    [S1, G2, 1],
    [SB, G1, 20],
  ] as const) {
    await one(MANAGER, `select app.office_set_last_purchase($1, $2, ${TODAY} - $3::integer)`, [sid, g, ago]);
  }
});

// Leave the reps' territories as other files expect them: end this file's assignments.
afterAll(async () => {
  await one(MANAGER, "select app.office_end_territory($1, $2, 'routes tests finished')", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_end_territory($1, $2, 'routes tests finished')", [fx.repB.id, T_B]);
});

describe("opening last purchase (A-09, MJ L-0151)", () => {
  it("only the office records it; a future date, an unknown salon or group is refused", async () => {
    const call = `select app.office_set_last_purchase($1, $2, ${TODAY} - 1)`;
    expect(await sqlstate(REP_A, call, [S1, G1])).toBe("42501");
    expect(await errorOf(MANAGER, `select app.office_set_last_purchase($1, $2, ${TODAY} + 1)`, [S1, G1])).toMatch(/future/);
    expect(await sqlstate(MANAGER, call, [id(), G1])).toBe("22023");
    expect(await sqlstate(MANAGER, call, [S1, id()])).toBe("22023");
  });

  it("a second entry replaces the date of the same salon and group", async () => {
    const r = await run(
      MANAGER,
      `select app.office_set_last_purchase('${S1}', '${G1}', ${TODAY} - 2);
       select count(*)::int n, max(${TODAY} - last_order_on) ago, max(basis::text) basis
         from public.cycle_estimate where salon_id = '${S1}' and product_group_id = '${G1}';`,
    );
    expect(last(r)).toEqual([{ n: 1, ago: 2, basis: "opening" }]);
  });

  it("once deliveries keep a cycle (basis orders), an opening date no longer applies", async () => {
    const r = await errorOf(
      "postgres",
      `update public.cycle_estimate set basis = 'orders', basis_orders = 3 where salon_id = '${S1}' and product_group_id = '${G1}';
       ${asUser(fx.manager, "aal2")}
       select app.office_set_last_purchase('${S1}', '${G1}', ${TODAY} - 1);`,
    );
    expect(r).toMatch(/kept by deliveries/);
  });

  it("estimates are never deleted or moved to another salon, for postgres too", async () => {
    expect(await sqlstate("postgres", "delete from public.cycle_estimate")).toBe("42501");
    expect(await sqlstate("postgres", "truncate public.cycle_estimate")).toBe("42501");
    expect(await sqlstate("postgres", "update public.cycle_estimate set salon_id = $1 where salon_id = $2", [S2, S1])).toBe(
      "42501",
    );
  });
});

describe("due-list (PIP-05, PIP-06 thin)", () => {
  it("lists due, overdue and at-risk salons of the rep's territories, most urgent first", async () => {
    expect(await due(REP_A)).toEqual([
      { salon_id: S3, product_group_id: G2, due_status: "at_risk", due_in: -16 },
      { salon_id: S2, product_group_id: G1, due_status: "overdue", due_in: -5 },
      { salon_id: S1, product_group_id: G1, due_status: "due", due_in: 3 },
    ]);
  });

  it("another rep sees only its own territory; the office sees all, or one territory", async () => {
    expect(await due(REP_B)).toEqual([{ salon_id: SB, product_group_id: G1, due_status: "overdue", due_in: 0 }]);
    expect((await due(MANAGER)).map((r) => r.salon_id)).toEqual([S3, S2, SB, S1]);
    const tb = await run(MANAGER, "select salon_id from app.due_list(null, $1)", [T_B]);
    expect(tb.rows).toEqual([{ salon_id: SB }]);
    expect(await due(REP_A_WRONG_DEVICE)).toEqual([]);
    expect(await due(SUSPENDED)).toEqual([]);
  });

  it("planning ahead: on a later day the due window moves with it", async () => {
    const ahead = await due(REP_A, `${TODAY} + 3`);
    expect(ahead.find((r) => r.salon_id === S1 && r.product_group_id === G1)?.due_status).toBe("overdue");
    expect(ahead.some((r) => r.product_group_id === G2 && r.salon_id === S1)).toBe(false);
  });

  it("the edges: listed from exactly 3 days before due; at risk from exactly half a cycle after", async () => {
    // S1 colour is due in 3 days: yesterday it was 4 days away. S3 shampoo (cycle 30) turned at risk
    // yesterday, 15 days after its due date: two days ago it was still overdue.
    const yesterday = await due(REP_A, `${TODAY} - 1`);
    expect(yesterday.some((r) => r.salon_id === S1 && r.product_group_id === G1)).toBe(false);
    expect(yesterday.find((r) => r.salon_id === S3)?.due_status).toBe("at_risk");
    expect((await due(REP_A, `${TODAY} - 2`)).find((r) => r.salon_id === S3)?.due_status).toBe("overdue");
  });

  it("a new default cycle for the product group applies at once (computed on read)", async () => {
    const r = await run(
      MANAGER,
      `select app.office_upsert_product_group('${G1}', '${G1_NAME}', 40);
       select count(*)::int n from app.due_list() where salon_id = '${S2}';`,
    );
    expect(last(r)).toEqual([{ n: 0 }]);
  });

  it("a parked salon leaves the due-list", async () => {
    const r = await run(
      "postgres",
      `${asUser(fx.repA, "aal1")}
       select app.rep_park_salon('${S2}', 'owner says not interested this season');
       select count(*)::int n from app.due_list() where salon_id = '${S2}';`,
    );
    expect(last(r)).toEqual([{ n: 0 }]);
  });

  it("reps never read the cycle table", async () => {
    expect((await run(REP_A, "select count(*)::int n from public.cycle_estimate")).rows[0].n).toBe(0);
  });
});

describe("routes (PIP-03)", () => {
  it("the office sets a rep's stops for today in order; reps cannot", async () => {
    const r = (
      await setRoute([
        [S2, "reorder_due"],
        [S1, "reorder_due"],
        [S3, "at_risk"],
      ])
    ).rows[0];
    expect(r.generated_by).toBe("manager");
    expect(r.rep_id).toBe(fx.repA.id);
    expect(await route()).toEqual([
      { salon_id: S2, sequence: 1, reason: "reorder_due", visited: false },
      { salon_id: S1, sequence: 2, reason: "reorder_due", visited: false },
      { salon_id: S3, sequence: 3, reason: "at_risk", visited: false },
    ]);
    const s1 = await run(REP_A, `select next_due_on - ${TODAY} d from app.my_route() where salon_id = $1`, [S1]);
    expect(s1.rows[0].d).toBe(3);
    expect(await sqlstate(REP_A, `select app.office_set_route($1, ${TODAY}, '[]')`, [fx.repA.id])).toBe("42501");
  });

  it("a bad route is refused: past day, inactive rep, other territory, duplicates, the rep's own reason, too many stops", async () => {
    const call = (rep: string, list: string, day = `${TODAY}`) =>
      sqlstate(MANAGER, `select app.office_set_route($1, ${day}, $2::jsonb)`, [rep, list]);
    expect(await call(fx.repA.id, stops([[S1, "manual"]]), `${TODAY} - 1`)).toBe("22023");
    expect(await call(fx.suspendedRep.id, stops([[S1, "manual"]]))).toBe("22023");
    expect(
      await errorOf(MANAGER, `select app.office_set_route($1, ${TODAY}, $2::jsonb)`, [fx.repA.id, stops([[SB, "manual"]])]),
    ).toMatch(/current territories/);
    expect(
      await call(
        fx.repA.id,
        stops([
          [S1, "manual"],
          [S1, "prospect"],
        ]),
      ),
    ).toBe("22023");
    expect(await call(fx.repA.id, stops([[S1, "pin_selected"]]))).toBe("22023");
    expect(await call(fx.repA.id, JSON.stringify([{ salon_id: S1 }]))).toBe("22023");
    expect(await call(fx.repA.id, stops([[S1, "lunch_break"]]))).toBe("22P02");
    expect(await call(fx.repA.id, stops(Array.from({ length: 51 }, () => [S1, "manual"] as [string, string])))).toBe("22023");
    expect(await call(fx.repA.id, '{"salon_id": "x"}')).toBe("22023");
  });

  it("the rep adds a salon from the map at the end; a replay returns the same stop", async () => {
    await setRoute([
      [S2, "reorder_due"],
      [S1, "reorder_due"],
    ]);
    const a = await one(REP_A, "select (app.rep_add_stop($1)).*", [S3]);
    expect(a.sequence).toBe(3);
    expect(a.reason).toBe("pin_selected");
    expect((await one(REP_A, "select (app.rep_add_stop($1)).id", [S3])).id).toBe(a.id);
    expect(await sqlstate(REP_B, "select app.rep_add_stop($1)", [S1])).toBe("42501");
    expect(await sqlstate(MANAGER, "select app.rep_add_stop($1)", [S1])).toBe("42501");
    expect(await sqlstate(REP_A_WRONG_DEVICE, "select app.rep_add_stop($1)", [S1])).toBe("42501");
  });

  it("the rep reorders its route; the list must name every stop exactly once", async () => {
    const ids = (await run(REP_A, "select stop_id from app.my_route() order by sequence")).rows.map((r) => r.stop_id as string);
    expect(ids).toHaveLength(3);
    const call = (who: Who, list: string[], day = `${TODAY}`) =>
      sqlstate(who, `select app.rep_reorder_route(${day}, $1::uuid[])`, [list]);
    expect(await call(REP_A, ids.slice(0, 2))).toBe("22023");
    expect(await call(REP_A, [ids[0], ids[0], ids[1]])).toBe("22023");
    expect(await call(REP_A, [ids[0], ids[1], id()])).toBe("22023");
    expect(await call(REP_B, ids)).toBe("22023"); // rep B has no route today; rep A's stops are not its own
    expect(await call(REP_A, ids, `${TODAY} - 1`)).toBe("42501");
    expect(await call(MANAGER, ids)).toBe("42501");
    const n = await one(REP_A, `select app.rep_reorder_route(${TODAY}, $1::uuid[]) n`, [[...ids].reverse()]);
    expect(n.n).toBe(3);
    expect((await route()).map((r) => [r.salon_id, r.sequence])).toEqual([
      [S3, 1],
      [S1, 2],
      [S2, 3],
    ]);
  });

  it("a stop shows whether the rep visited it that day", async () => {
    const r = await run(
      "postgres",
      `insert into public.rep_day (rep_id, day) values ('${fx.repA.id}', ${TODAY}) on conflict (rep_id, day) do nothing;
       insert into public.visit (client_id, rep_day_id, rep_id, salon_id, outcome, lat, lng)
       select gen_random_uuid(), d.id, d.rep_id, '${S1}', 'quote', 24.9, 67.1
         from public.rep_day d where d.rep_id = '${fx.repA.id}' and d.day = ${TODAY};
       ${asUser(fx.repA, "aal1")}
       select visited, last_outcome from app.my_route() where salon_id = '${S1}';`,
    );
    expect(last(r)).toEqual([{ visited: true, last_outcome: "quote" }]);
  });

  it("a stop outside the rep's current territories disappears from its route at once", async () => {
    const r = await run(
      "postgres",
      `${asUser(fx.manager, "aal2")}
       select app.office_end_territory('${fx.repA.id}', '${T_A}', 'territory handed to another rep');
       ${asUser(fx.repA, "aal1")}
       select count(*)::int n from app.my_route() where salon_id = any(array['${S1}', '${S2}', '${S3}']::uuid[]);`,
    );
    expect(last(r)).toEqual([{ n: 0 }]);
  });

  it("reps read their own route rows, never the stop table; another rep sees nothing", async () => {
    expect((await run(REP_A, "select count(*)::int n from public.route_stop")).rows[0].n).toBe(0);
    expect((await run(REP_A, "select count(*)::int n from public.route where rep_id <> $1", [fx.repA.id])).rows[0].n).toBe(0);
    expect((await run(REP_A, `select count(*)::int n from public.route where day = ${TODAY}`)).rows[0].n).toBe(1);
    expect(await route(REP_B)).toEqual([]);
    expect(
      (
        await run(
          MANAGER,
          `select count(*)::int n from public.route_stop s join public.route r on r.id = s.route_id where r.rep_id = $1 and r.day = ${TODAY}`,
          [fx.repA.id],
        )
      ).rows[0].n,
    ).toBe(3);
  });

  it("an office re-plan replaces the day's stops, the rep's own pin included", async () => {
    await setRoute([[S1, "collection_due"]]);
    expect(await route()).toEqual([{ salon_id: S1, sequence: 1, reason: "collection_due", visited: false }]);
  });
});

describe("history cannot be rewritten (H-06, H-07)", () => {
  // A route for yesterday, built with triggers off inside a rolled-back transaction.
  const pastRoute = (stmt: string) => `
    set local session_replication_role = replica;
    insert into public.route (id, rep_id, day, generated_by, created_by)
    values ('00000000-0000-4000-8000-0000000000a1', '${fx.repB.id}', ${TODAY} - 1, 'manager', '${fx.manager.id}');
    insert into public.route_stop (id, route_id, sequence, salon_id, reason, added_by)
    values ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1', 1, '${SB}', 'manual', '${fx.manager.id}');
    set local session_replication_role = origin;
    ${stmt}`;

  it("a past route is final for every role, including postgres", async () => {
    expect(
      await errorOf(
        "postgres",
        pastRoute("update public.route_stop set sequence = 1 where id = '00000000-0000-4000-8000-0000000000a2';"),
      ),
    ).toMatch(/past route is final/);
    expect(
      await errorOf("postgres", pastRoute("delete from public.route_stop where id = '00000000-0000-4000-8000-0000000000a2';")),
    ).toMatch(/past route is final/);
    expect(
      await errorOf(
        "postgres",
        pastRoute(
          `insert into public.route_stop (route_id, sequence, salon_id, reason, added_by)
           values ('00000000-0000-4000-8000-0000000000a1', 2, '${S1}', 'prospect', '${fx.manager.id}');`,
        ),
      ),
    ).toMatch(/past route is final/);
  });

  it("a stop changes only its place; routes are append-only", async () => {
    expect(await errorOf("postgres", "update public.route_stop set reason = 'prospect' where salon_id = $1", [S1])).toMatch(
      /only its place/,
    );
    expect(await sqlstate("postgres", "update public.route set day = day")).toBe("42501");
    expect(await sqlstate("postgres", "delete from public.route")).toBe("42501");
    expect(await sqlstate("postgres", "truncate public.route cascade")).toBe("42501");
    expect(await sqlstate("postgres", "truncate public.route_stop")).toBe("42501");
  });

  it("the audit chain still verifies (H-17)", async () => {
    expect((await run("postgres", "select ok from control.verify_audit_chain()")).rows[0].ok).toBe(true);
  });
});
