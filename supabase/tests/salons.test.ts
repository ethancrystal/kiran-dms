/**
 * Territories and salons (migration 0009, task P1-02 part a): PIP-01, SAL-01 to SAL-03, SAL-09,
 * MAP-03, CTL-18 (duplicate phones), doc 06 §4 (masked phones, logged reveals, page caps, H-14).
 *
 * Multi-persona steps commit with fresh ids, like inventory.test.ts. Each check tries to
 * break a control.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  errorOf,
  fx,
  MANAGER,
  MANAGER_AAL1,
  OWNER,
  REP_A,
  REP_A_WRONG_DEVICE,
  REP_B,
  run,
  SUSPENDED,
  sqlstate,
  type Who,
} from "./helpers/db";

const C = { commit: true };
const id = () => randomUUID();
const tag = () => randomUUID().slice(0, 8);
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];

const T1 = id(),
  T2 = id(),
  A1 = id(),
  A1b = id(),
  A2 = id();
const PHONE = "+920000001234";
let S1: string; // repA's salon in T1

const createSalon = (who: Who, sid: string, area: string, phone: string | null = null, source = "map_pin") =>
  one(
    who,
    `select (app.create_salon($1, $2, 'ladies_parlor', $3, $4::public.salon_source, null, 24.9, 67.1, 3,
             '[Test] Owner', $5, '[Test] first chit')).*`,
    [sid, `[Test] Salon ${tag()}`, area, source, phone],
  );

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T1, `[Test] Territory 1 ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T2, `[Test] Territory 2 ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Area 1')", [A1, T1]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Area 1b')", [A1b, T1]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Area 2')", [A2, T2]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T1]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repB.id, T2]);
  S1 = id();
  await createSalon(REP_A, S1, A1, PHONE);
});

// Leave the reps' territories as other files expect them: end this file's assignments.
afterAll(async () => {
  await one(MANAGER, "select app.office_end_territory($1, $2, 'salons tests finished')", [fx.repA.id, T1]);
  await one(MANAGER, "select app.office_end_territory($1, $2, 'salons tests finished')", [fx.repB.id, T2]);
});

describe("territories (PIP-01)", () => {
  it("only the office defines territories and assigns them, only to active reps", async () => {
    expect(await sqlstate(REP_A, "select app.office_upsert_territory($1, 'x territory')", [id()])).toBe("42501");
    expect(await sqlstate(MANAGER_AAL1, "select app.office_assign_territory($1, $2)", [fx.repA.id, T2])).toBe("42501");
    expect(await sqlstate(MANAGER, "select app.office_assign_territory($1, $2)", [fx.manager.id, T1])).toBe("22023");
    expect(await sqlstate(MANAGER, "select app.office_assign_territory($1, $2)", [fx.suspendedRep.id, T1])).toBe("22023");
  });

  it("a rep sees its own territories and areas only", async () => {
    const a = (await run(REP_A, "select area_id from app.my_areas()")).rows.map((r) => r.area_id).sort();
    expect(a).toEqual([A1, A1b].sort());
    const b = (await run(REP_B, "select area_id from app.my_areas()")).rows.map((r) => r.area_id);
    expect(b).toEqual([A2]);
  });

  it("an assignment changes once, by being ended; nobody deletes it", async () => {
    expect(await sqlstate("postgres", "delete from public.rep_territory")).toBe("42501");
    expect(await sqlstate("postgres", "update public.rep_territory set from_date = from_date - 1 where to_date is null")).toBe(
      "42501",
    );
  });
});

describe("salons are scoped to the rep's territories (SAL-09, H-14)", () => {
  it("a rep adds a salon only in its own territory, from field sources only; a replay returns the same row", async () => {
    const again = await createSalon(REP_A, S1, A1, PHONE);
    expect(again.id).toBe(S1);
    expect(again.stage).toBe("prospect");
    expect(await errorOf(REP_A, "select app.create_salon($1, 'x salon', 'barber', $2, 'map_pin')", [id(), A2])).toMatch(
      /own territories/,
    );
    expect(await errorOf(REP_A, "select app.create_salon($1, 'x salon', 'barber', $2, 'excel_import')", [id(), A1])).toMatch(
      /field only/,
    );
    expect(await sqlstate(REP_B, "select app.create_salon($1, 'x salon', 'barber', $2, 'map_pin')", [S1, A2])).toBe("23505");
    expect(
      await sqlstate(REP_A_WRONG_DEVICE, "select app.create_salon($1, 'x salon', 'barber', $2, 'map_pin')", [id(), A1]),
    ).toBe("42501");
    expect(await sqlstate(SUSPENDED, "select app.create_salon($1, 'x salon', 'barber', $2, 'map_pin')", [id(), A1])).toBe(
      "42501",
    );
  });

  it("reps cannot read salon tables directly; they read their own list through the capped function", async () => {
    for (const t of ["public.salon", "public.salon_contact", "public.salon_note", "public.stage_event"]) {
      const r = (await run(REP_A, `select count(*) n from ${t}`)).rows[0];
      expect(Number(r.n), t).toBe(0);
    }
    const mine = (await run(REP_A, "select id, phone_masked from app.my_salons() where id = $1", [S1])).rows;
    expect(mine).toEqual([{ id: S1, phone_masked: "+920*******34" }]);
    expect((await run(REP_B, "select id from app.my_salons() where id = $1", [S1])).rows).toEqual([]);
    expect((await run(REP_A_WRONG_DEVICE, "select id from app.my_salons()")).rows).toEqual([]);
  });

  it("my_salon (migration 0016) gives the rep one own salon with address and chairs, and nobody else anything", async () => {
    await one(REP_A, "select app.update_salon($1, null, 'ladies_parlor', $2, '[Test] 1 Fake Street')", [S1, A1]);
    expect(await one(REP_A, "select id, phone_masked, address, chairs, lat, lng from app.my_salon($1)", [S1])).toEqual({
      id: S1,
      phone_masked: "+920*******34",
      address: "[Test] 1 Fake Street",
      chairs: 3,
      lat: "24.900000",
      lng: "67.100000",
    });
    for (const who of [REP_B, REP_A_WRONG_DEVICE, SUSPENDED, MANAGER, OWNER, MANAGER_AAL1]) {
      expect((await run(who, "select id from app.my_salon($1)", [S1])).rows, String(who)).toEqual([]);
    }
    expect(await sqlstate("anon", "select * from app.my_salon($1)", [S1])).toBe("42501");
  });

  it("a page holds at most 50 salons, whatever the caller asks for", async () => {
    await run(
      REP_A,
      `select app.create_salon(gen_random_uuid(), '[Test] bulk ' || g, 'barber', $1, 'sweep')
                      from generate_series(1, 55) g`,
      [A1b],
      C,
    );
    const page = (await run(REP_A, "select id, name from app.my_salons(null, null, 500)")).rows;
    expect(page.length).toBe(50);
    const last = page[49];
    const next = (await run(REP_A, "select id from app.my_salons($1, $2, 50)", [last.name, last.id])).rows;
    expect(next.length).toBeGreaterThan(0);
    expect(next.some((n) => page.some((p) => p.id === n.id))).toBe(false);
  });

  it("a rep moves a salon only between areas of its own territories", async () => {
    expect(await errorOf(REP_A, "select app.update_salon($1, 'renamed', 'unisex', $2)", [S1, A2])).toMatch(/own territories/);
    expect(await errorOf(REP_B, "select app.update_salon($1, 'renamed', 'unisex', $2)", [S1, A2])).toMatch(/own territories/);
    const r = await one(REP_A, "select (app.update_salon($1, '[Test] Renamed', 'unisex', $2, null, 24.9, 67.1, 4)).*", [S1, A1b]);
    expect(r.area_id).toBe(A1b);
    expect(r.stage).toBe("prospect");
  });

  it("nobody deletes a salon or rewrites its identity, not even postgres", async () => {
    expect(await sqlstate("postgres", "delete from public.salon where id = $1", [S1])).toBe("42501");
    expect(await sqlstate("postgres", "update public.salon set created_by = $2 where id = $1", [S1, fx.repB.id])).toBe("42501");
    expect(await sqlstate("postgres", "update public.salon set source = 'excel_import' where id = $1", [S1])).toBe("42501");
    expect(await sqlstate("postgres", "truncate public.salon cascade")).toBe("42501");
  });
});

describe("phones: masked in lists, revealed one at a time and logged (doc 06 §4)", () => {
  it("a rep reveals a phone of its own territory's salon, and the owner sees the reveal", async () => {
    const before = Number(
      (await run("postgres", "select count(*) n from control.phone_reveal where salon_id = $1", [S1])).rows[0].n,
    );
    const r = await one(REP_A, "select app.reveal_phone($1) p", [S1]);
    expect(r.p).toBe(PHONE);
    const log = (await run(OWNER, "select actor_id from control.phone_reveal where salon_id = $1", [S1])).rows;
    expect(log.length).toBe(before + 1);
    expect(log.every((l) => l.actor_id === fx.repA.id)).toBe(true);
    expect((await run(MANAGER, "select count(*) n from control.phone_reveal")).rows[0].n).toBe("0");
  });

  it("another territory's rep cannot reveal it", async () => {
    expect(await sqlstate(REP_B, "select app.reveal_phone($1)", [S1])).toBe("42501");
    expect(await sqlstate(REP_A_WRONG_DEVICE, "select app.reveal_phone($1)", [S1])).toBe("42501");
  });

  it("the same phone on two salons is flagged for the office; reps cannot list duplicates", async () => {
    const other = id();
    await createSalon(REP_A, other, A1, PHONE);
    const d = (await run(MANAGER, "select salon_ids from app.duplicate_phones() where phone = $1", [PHONE])).rows[0];
    expect(d.salon_ids.sort()).toEqual([S1, other].sort());
    expect(await sqlstate(REP_A, "select * from app.duplicate_phones()")).toBe("42501");
  });

  it("only the office changes a primary phone, with a reason; the old contact stays as history", async () => {
    expect(await sqlstate(REP_A, "select app.office_set_primary_contact($1, 'x', '+920000009999', 'new number')", [S1])).toBe(
      "42501",
    );
    await one(MANAGER, "select app.office_set_primary_contact($1, '[Test] Owner', '+920000009999', 'salon called the office')", [
      S1,
    ]);
    const all = (
      await run(MANAGER, "select phone, is_primary, active from public.salon_contact where salon_id = $1 order by created_at", [
        S1,
      ])
    ).rows;
    expect(all).toEqual([
      { phone: PHONE, is_primary: false, active: false },
      { phone: "+920000009999", is_primary: true, active: true },
    ]);
    expect(await sqlstate("postgres", "delete from public.salon_contact where salon_id = $1", [S1])).toBe("42501");
  });
});

describe("notes are append-only (MAP-03)", () => {
  const note = id();
  it("a rep adds a note to its own territory's salon; a replay returns the same row", async () => {
    const a = await one(REP_A, "select (app.add_salon_note($1, $2, 'met the owner, uses brand-free colour')).id", [note, S1]);
    const b = await one(REP_A, "select (app.add_salon_note($1, $2, 'met the owner, uses brand-free colour')).id", [note, S1]);
    expect(b.id).toBe(a.id);
    expect(await sqlstate(REP_A, "select app.add_salon_note($1, $2, 'changed text')", [note, S1])).toBe("23505");
    expect(await errorOf(REP_B, "select app.add_salon_note($1, $2, 'not mine')", [id(), S1])).toMatch(/own territories/);
    const notes = (await run(REP_A, "select body from app.salon_notes($1)", [S1])).rows.map((n) => n.body);
    expect(notes).toContain("met the owner, uses brand-free colour");
    expect((await run(REP_B, "select body from app.salon_notes($1)", [S1])).rows).toEqual([]);
  });

  it("notes, stage events and reveals refuse UPDATE, DELETE and TRUNCATE for every role", async () => {
    for (const t of ["public.salon_note", "public.stage_event", "control.phone_reveal"]) {
      expect(await sqlstate("postgres", `update ${t} set created_at = created_at`), t).toBe("42501");
      expect(await sqlstate("postgres", `delete from ${t}`), t).toBe("42501");
      expect(await sqlstate("postgres", `truncate ${t} cascade`), t).toBe("42501");
    }
  });
});

describe("stages: stage_event is the truth (SAL-03, doc 02)", () => {
  it("the stage cannot change without a stage_event, for any role", async () => {
    expect(await errorOf("postgres", "update public.salon set stage = 'active_regular' where id = $1", [S1])).toMatch(
      /stage_event/,
    );
    expect(await errorOf("postgres", "update public.salon set verification_status = 'verified' where id = $1", [S1])).toMatch(
      /CTL-09/,
    );
  });

  it("a rep parks an acquisition-stage salon with a reason, and cannot push it forward", async () => {
    expect(await sqlstate(REP_A, "select app.rep_park_salon($1, 'x')", [S1])).toBe("23514");
    expect(await sqlstate(REP_B, "select app.rep_park_salon($1, 'not interested now')", [S1])).toBe("42501");
    const p = await one(REP_A, "select (app.rep_park_salon($1, 'not interested now')).stage s", [S1]);
    expect(p.s).toBe("parked");
    expect(await sqlstate(REP_A, "select app.office_override_stage($1, 'active_regular', 'trying it')", [S1])).toBe("42501");
  });

  it("the office overrides with a mandatory reason; the history shows every move", async () => {
    expect(await sqlstate(MANAGER, "select app.office_override_stage($1, 'prospect', '')", [S1])).toBe("23514");
    await one(MANAGER, "select app.office_override_stage($1, 'prospect', 'came back, wants a visit')", [S1]);
    const h = (await run(REP_A, "select from_stage, to_stage, trigger from app.salon_stages($1) order by created_at", [S1])).rows;
    expect(h).toEqual([
      { from_stage: null, to_stage: "prospect", trigger: "created" },
      { from_stage: "prospect", to_stage: "parked", trigger: "manual" },
      { from_stage: "parked", to_stage: "prospect", trigger: "manual" },
    ]);
  });
});

describe("territory change and lost demand", () => {
  it("lost demand names only a salon the rep can reach, and must name a real salon", async () => {
    const group = id();
    await one(MANAGER, "select app.office_upsert_product_group($1, $2, 21)", [group, `[Dummy] Group ${tag()}`]);
    expect(await sqlstate(REP_B, "select app.record_demand($1, null, $2, 1, 'not_in_catalogue', $3)", [id(), group, S1])).toBe(
      "42501",
    );
    const ok = await one(REP_A, "select (app.record_demand($1, null, $2, 1, 'not_in_catalogue', $3)).salon_id s", [
      id(),
      group,
      S1,
    ]);
    expect(ok.s).toBe(S1);
    expect(
      await sqlstate(
        MANAGER,
        `insert into public.demand_signal (client_id, product_group_id, qty, reason, source, salon_id, captured_by)
      values ($1, $2, 1, 'not_in_catalogue', 'visit_tap', $3, $4)`,
        [id(), group, id(), fx.manager.id],
      ),
    ).toBe("42501");
    expect(
      await sqlstate(
        "postgres",
        `insert into public.demand_signal (client_id, product_group_id, qty, reason, source, salon_id, captured_by)
      values ($1, $2, 1, 'not_in_catalogue', 'visit_tap', $3, $4)`,
        [id(), group, id(), fx.manager.id],
      ),
    ).toBe("23503");
  });

  it("ending a rep's territory removes its salons from that rep at once", async () => {
    // Reach is checked through app.salon_stages (one salon, any page): app.my_salons returns one
    // 50-row page, and where S1 falls on it depends on the database collation (en_US on Supabase).
    const reach = async () => (await run(REP_A, "select to_stage from app.salon_stages($1)", [S1])).rows.length;
    expect(await reach()).toBeGreaterThan(0);
    await one(MANAGER, "select app.office_end_territory($1, $2, 'moved to territory 2')", [fx.repA.id, T1]);
    expect(await reach()).toBe(0);
    expect((await run(REP_A, "select id from app.my_salons() where id = $1", [S1])).rows).toEqual([]);
    expect(await sqlstate(REP_A, "select app.reveal_phone($1)", [S1])).toBe("42501");
    expect(
      await errorOf("postgres", "update public.rep_territory set to_date = null where rep_id = $1 and territory_id = $2", [
        fx.repA.id,
        T1,
      ]),
    ).toMatch(/final/);
    // Give it back so other files see the original fixture state.
    await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T1]);
    expect(await reach()).toBeGreaterThan(0);
  });

  it("the audit chain still verifies (H-17)", async () => {
    expect((await run("postgres", "select ok from control.verify_audit_chain()")).rows[0].ok).toBe(true);
  });
});
