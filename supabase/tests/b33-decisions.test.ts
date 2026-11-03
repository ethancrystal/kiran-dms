/**
 * MJ's B-33 decisions (ACTIVITY L-0284), enforced by migration 0018:
 * (a) no inactive territory while a rep assignment to it is open; (b) no assignment to an
 * inactive territory; (c) offboarding is final; (d) a blank address keeps the recorded one.
 *
 * Uses its own synthetic rep, territories and salon ([Test] names, example.test address,
 * H-03); every assignment it makes is ended inside the tests, so no other file is disturbed.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { errorOf, MANAGER, OWNER, run, type Who } from "./helpers/db";

const C = { commit: true };
const id = () => randomUUID();
const tag = () => randomUUID().slice(0, 8);
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];

const REP = id();
const LEAVER = id();
const T = id();
const A = id();
const S = id();

beforeAll(async () => {
  for (const [p, n] of [
    [REP, "rep"],
    [LEAVER, "leaver"],
  ] as const) {
    await run("postgres", "insert into auth.users (id, email) values ($1, $2)", [p, `b33-${n}-${tag()}@example.test`], C);
  }
  await one(OWNER, "select app.owner_create_user($1, '[Test] B33 Rep', 'rep', '+920000008101')", [REP]);
  await one(OWNER, "select app.owner_create_user($1, '[Test] B33 Leaver', 'rep', '+920000008102')", [LEAVER]);
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T, `[Test] B33 ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] B33 area')", [A, T]);
  await one(
    MANAGER,
    "select app.create_salon($1, '[Test] B33 Salon', 'barber', $2, 'manual', '[Test] 9 Fake Lane', null, null, 2)",
    [S, A],
  );
});

describe("B-33 (a) and (b): territories and assignments (PIP-01)", () => {
  it("(a) a territory with an open assignment cannot be made inactive; after the assignment ends it can", async () => {
    await one(MANAGER, "select app.office_assign_territory($1, $2)", [REP, T]);
    expect(await errorOf(MANAGER, "select app.office_upsert_territory($1, $2, false)", [T, "[Test] B33 renamed"])).toMatch(
      /end every rep assignment/,
    );
    expect((await one("postgres", "select active from public.territory where id = $1", [T])).active).toBe(true);
    // Renaming while active is unaffected.
    await one(MANAGER, "select app.office_upsert_territory($1, $2, true)", [T, `[Test] B33 renamed ${tag()}`]);
    await one(MANAGER, "select app.office_end_territory($1, $2, '[Test] b33 moving on')", [REP, T]);
    expect(
      (await one(MANAGER, "select (app.office_upsert_territory($1, $2, false)).active", [T, `[Test] B33 ${tag()}`])).active,
    ).toBe(false);
  });

  it("(b) a rep cannot be assigned to an inactive territory; reactivated, it can", async () => {
    expect(await errorOf(MANAGER, "select app.office_assign_territory($1, $2)", [REP, T])).toMatch(/only to active territories/);
    expect(
      (
        await one(
          "postgres",
          "select count(*)::int n from public.rep_territory where rep_id = $1 and territory_id = $2 and to_date is null",
          [REP, T],
        )
      ).n,
    ).toBe(0);
    await one(MANAGER, "select app.office_upsert_territory($1, $2, true)", [T, `[Test] B33 ${tag()}`]);
    await one(MANAGER, "select app.office_assign_territory($1, $2)", [REP, T]);
    await one(MANAGER, "select app.office_end_territory($1, $2, '[Test] b33 done')", [REP, T]);
  });
});

describe("B-33 (c): offboarding is final (SEC-08)", () => {
  it("an offboarded person cannot be set active or suspended again; offboarding again is a harmless replay", async () => {
    await one(OWNER, "select app.owner_set_status($1, 'offboarded', '[Test] left the company')", [LEAVER]);
    for (const status of ["active", "suspended"]) {
      expect(await errorOf(OWNER, `select app.owner_set_status($1, '${status}', '[Test] coming back')`, [LEAVER])).toMatch(
        /offboarding is final/,
      );
    }
    expect((await one(OWNER, "select (app.owner_set_status($1, 'offboarded', '[Test] again')).status", [LEAVER])).status).toBe(
      "offboarded",
    );
    expect((await one("postgres", "select status from public.user_profile where id = $1", [LEAVER])).status).toBe("offboarded");
  });

  it("a suspended person can still be reactivated (only offboarding is final)", async () => {
    await one(OWNER, "select app.owner_set_status($1, 'suspended', '[Test] on leave')", [REP]);
    expect((await one(OWNER, "select (app.owner_set_status($1, 'active', '[Test] back')).status", [REP])).status).toBe("active");
  });
});

describe("B-33 (d): a blank address keeps the recorded one (SAL-01)", () => {
  it("empty and blank addresses keep the address; a real one replaces it", async () => {
    for (const blank of ["", "   "]) {
      const r = await one(MANAGER, "select (app.update_salon($1, null, 'barber', $2, $3)).address", [S, A, blank]);
      expect(r.address).toBe("[Test] 9 Fake Lane");
    }
    const r = await one(MANAGER, "select (app.update_salon($1, null, 'barber', $2, '[Test] 10 Fake Lane')).address", [S, A]);
    expect(r.address).toBe("[Test] 10 Fake Lane");
  });
});
