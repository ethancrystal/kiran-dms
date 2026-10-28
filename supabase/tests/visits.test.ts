/**
 * Rep day and visits (migration 0010, task P1-02 part b): PIP-02, PIP-09, doc 08 §3 and rule 7,
 * doc 13 R8 / D-06 (GPS, distance from pin, mock-location flag).
 *
 * Multi-persona steps commit with fresh ids, like the other module tests. Each rep's day is
 * one per Karachi day, so this file owns repA's and repB's day for the run. It does not
 * depend on other files: bags are created here when they do not exist yet.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorOf, fx, MANAGER, OWNER, REP_A, REP_A_WRONG_DEVICE, REP_B, run, SUSPENDED, sqlstate, type Who } from "./helpers/db";

const C = { commit: true };
const id = () => randomUUID();
const tag = () => randomUUID().slice(0, 8);
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];

const T_A = id(),
  T_B = id(),
  AREA_A = id(),
  AREA_B = id();
const SALON = id(),
  FRESH = id(),
  SALON_B = id();
const PIN = { lat: 24.9, lng: 67.1 };

/** The rep's bag as counted lines, so a check-in or daily close can match the system figure. */
const bagAsCounted = async (who: Who) =>
  JSON.stringify(
    (await run(who, "select sku_id, on_hand from app.my_bag()")).rows.map((r) => ({ sku_id: r.sku_id, qty: Number(r.on_hand) })),
  );
const stageOf = async (salon: string) =>
  (await run("postgres", "select stage from public.salon where id = $1", [salon])).rows[0].stage;
const visit = (who: Who, cid: string, salon: string, outcome: string, lat = PIN.lat, lng = PIN.lng, mock = false) =>
  run(
    who,
    "select (app.log_visit($1, $2, $3::public.visit_outcome, $4, $5, now(), 'met the owner', $6)).*",
    [cid, salon, outcome, lat, lng, mock],
    C,
  );

beforeAll(async () => {
  for (const [rep, label] of [
    [fx.repA.id, "A"],
    [fx.repB.id, "B"],
  ] as const) {
    const has = (
      await run("postgres", "select 1 from public.stock_location where kind = 'rep_bag' and owner_user_id = $1", [rep])
    ).rows.length;
    if (!has)
      await one(OWNER, "select app.office_create_location($1, 'rep_bag', $2, $3, 2000000)", [id(), `[Test] Bag ${label}`, rep]);
  }
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_A, `[Test] Visits A ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_B, `[Test] Visits B ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Visits area A')", [AREA_A, T_A]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Visits area B')", [AREA_B, T_B]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repB.id, T_B]);
  for (const [who, sid, area] of [
    [REP_A, SALON, AREA_A],
    [REP_A, FRESH, AREA_A],
    [REP_B, SALON_B, AREA_B],
  ] as const) {
    await one(who, "select app.create_salon($1, $2, 'mens_salon', $3, 'map_pin', null, $4, $5)", [
      sid,
      `[Test] Visit salon ${tag()}`,
      area,
      PIN.lat,
      PIN.lng,
    ]);
  }
});

// Leave the reps' territories as other files expect them: end this file's assignments.
afterAll(async () => {
  await one(MANAGER, "select app.office_end_territory($1, $2, 'visits tests finished')", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_end_territory($1, $2, 'visits tests finished')", [fx.repB.id, T_B]);
});

describe("no field work without an open day (PIP-09)", () => {
  it("a visit before check-in is refused", async () => {
    expect(await errorOf(REP_A, "select app.log_visit($1, $2, 'intro', 24.9, 67.1)", [id(), SALON])).toMatch(/check in before/);
  });

  it("only an active rep on the approved device checks in; the office cannot", async () => {
    expect(await sqlstate(MANAGER, "select app.rep_check_in('[]')")).toBe("42501");
    expect(await sqlstate(REP_A_WRONG_DEVICE, "select app.rep_check_in('[]')")).toBe("42501");
    expect(await sqlstate(SUSPENDED, "select app.rep_check_in('[]')")).toBe("42501");
  });

  it("check-in records the bag count against the system figure; a replay returns the same day", async () => {
    const d = await one(REP_A, "select (app.rep_check_in($1, 24.9, 67.1, now())).*", [await bagAsCounted(REP_A)]);
    expect(d.status).toBe("open");
    expect(d.bag_variance_units).toBe(0);
    const again = await one(REP_A, "select (app.rep_check_in('[]')).id");
    expect(again.id).toBe(d.id);
    const mine = (await run(REP_A, "select status, visits from app.my_day()")).rows;
    expect(mine).toEqual([{ status: "open", visits: 0 }]);
  });

  it("an earlier day still open blocks check-in until the office closes it with a reason", async () => {
    const stale = await one(
      "postgres",
      "insert into public.rep_day (rep_id, day) values ($1, app.karachi_today() - 1) returning id",
      [fx.repB.id],
    );
    expect(await errorOf(REP_B, "select app.rep_check_in('[]')")).toMatch(/earlier day is still open/);
    expect(await errorOf(REP_B, "select app.log_visit($1, $2, 'intro', 24.9, 67.1)", [id(), SALON_B])).toMatch(/check in before/);
    expect(await sqlstate(REP_B, "select app.office_force_close_rep_day($1, 'closing my own day')", [stale.id])).toBe("42501");
    expect(await sqlstate(MANAGER, "select app.office_force_close_rep_day($1, 'x')", [stale.id])).toBe("23514");
    const closed = await one(MANAGER, "select (app.office_force_close_rep_day($1, 'handover done on paper, reconciled')).*", [
      stale.id,
    ]);
    expect(closed.status).toBe("force_closed");
    expect(closed.closed_by).toBe(fx.manager.id);
    const d = await one(REP_B, "select (app.rep_check_in($1)).status", [await bagAsCounted(REP_B)]);
    expect(d.status).toBe("open");
  });
});

describe("visits (PIP-02, doc 08 rule 7)", () => {
  const first = id();

  it("a visit at the pin records server time, GPS and a zero distance, and moves a prospect to visited", async () => {
    const v = (await visit(REP_A, first, SALON, "intro")).rows[0];
    expect(v.distance_from_pin_m).toBe(0);
    expect(v.rep_id).toBe(fx.repA.id);
    expect(v.mock_location).toBe(false);
    expect(await stageOf(SALON)).toBe("visited");
    const h = (await run(REP_A, "select from_stage, to_stage, trigger from app.salon_stages($1) order by created_at", [SALON]))
      .rows;
    expect(h.at(-1)).toEqual({ from_stage: "prospect", to_stage: "visited", trigger: "visit" });
  });

  it("a replay returns the same visit; the same client_id with other content is refused", async () => {
    const again = (await visit(REP_A, first, SALON, "intro")).rows[0];
    expect((await run("postgres", "select count(*)::int n from public.visit where client_id = $1", [first])).rows[0].n).toBe(1);
    expect(again.client_id).toBe(first);
    expect(await sqlstate(REP_A, "select app.log_visit($1, $2, 'order', 24.9, 67.1)", [first, SALON])).toBe("23505");
  });

  it("a sample away from the pin records the distance and the phone's mock-location flag, and moves to trial", async () => {
    const v = (await visit(REP_A, id(), SALON, "sample", PIN.lat + 0.01, PIN.lng, true)).rows[0];
    expect(v.distance_from_pin_m).toBe(1112);
    expect(v.mock_location).toBe(true);
    expect(await stageOf(SALON)).toBe("trial");
  });

  it("'not present' is logged but does not move a prospect", async () => {
    await visit(REP_A, id(), FRESH, "not_present");
    expect(await stageOf(FRESH)).toBe("prospect");
  });

  it("a rep cannot visit another territory's salon; the office does not log visits", async () => {
    expect(await errorOf(REP_B, "select app.log_visit($1, $2, 'intro', 24.9, 67.1)", [id(), SALON])).toMatch(/own territories/);
    expect(await sqlstate(MANAGER, "select app.log_visit($1, $2, 'intro', 24.9, 67.1)", [id(), SALON])).toBe("42501");
    expect(await sqlstate(REP_A_WRONG_DEVICE, "select app.log_visit($1, $2, 'intro', 24.9, 67.1)", [id(), SALON])).toBe("42501");
  });

  it("visits are read through the capped function; reps never read the table", async () => {
    expect((await run(REP_A, "select outcome from app.salon_visits($1)", [SALON])).rows.map((r) => r.outcome).sort()).toEqual([
      "intro",
      "sample",
    ]);
    expect((await run(REP_B, "select outcome from app.salon_visits($1)", [SALON])).rows).toEqual([]);
    expect((await run(REP_A, "select count(*)::int n from public.visit")).rows[0].n).toBe(0);
    expect((await run(MANAGER, "select count(*)::int n from public.visit where salon_id = $1", [SALON])).rows[0].n).toBe(2);
    expect((await run(REP_A, "select visits from app.my_day()")).rows[0].visits).toBe(3);
  });
});

describe("check-out (PIP-09, INV-05)", () => {
  it("the day closes only after the evening bag count; then no more visits that day", async () => {
    expect(await errorOf(REP_A, "select app.rep_check_out(now())")).toMatch(/daily close/);
    await one(REP_A, "select app.record_count($1, app.my_bag_id(), 'daily_close', $2)", [id(), await bagAsCounted(REP_A)]);
    const d = await one(REP_A, "select (app.rep_check_out(now())).*");
    expect(d.status).toBe("closed");
    expect(d.closed_by).toBe(fx.repA.id);
    expect(await errorOf(REP_A, "select app.log_visit($1, $2, 'intro', 24.9, 67.1)", [id(), SALON])).toMatch(/check in before/);
    expect(await errorOf(REP_A, "select app.rep_check_in('[]')")).toMatch(/already closed/);
  });
});

describe("history cannot be rewritten (H-06, H-07)", () => {
  it("visits refuse UPDATE, DELETE and TRUNCATE for every role, including postgres", async () => {
    expect(await sqlstate("postgres", "update public.visit set outcome = 'order'")).toBe("42501");
    expect(await sqlstate("postgres", "delete from public.visit")).toBe("42501");
    // Plain TRUNCATE is refused by the sales_order foreign key (0A000, migration 0012); CASCADE reaches
    // the append-only trigger.
    expect(await sqlstate("postgres", "truncate public.visit")).toBe("0A000");
    expect(await sqlstate("postgres", "truncate public.visit cascade")).toBe("42501");
  });

  it("a closed day is final; days are never deleted", async () => {
    expect(
      await errorOf(
        "postgres",
        "update public.rep_day set status = 'open', check_out_at = null, closed_by = null where rep_id = $1 and status = 'closed'",
        [fx.repA.id],
      ),
    ).toMatch(/final/);
    expect(await sqlstate("postgres", "delete from public.rep_day")).toBe("42501");
    expect(await sqlstate("postgres", "truncate public.rep_day cascade")).toBe("42501");
  });

  it("the audit chain still verifies (H-17)", async () => {
    expect((await run("postgres", "select ok from control.verify_audit_chain()")).rows[0].ok).toBe(true);
  });
});
