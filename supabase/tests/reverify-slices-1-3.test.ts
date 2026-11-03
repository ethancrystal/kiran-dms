/**
 * Re-verification of execution-map slices 1 to 3 on merged main 3630998 (ACTIVITY C-025, L-0288).
 * Written by a fresh verifier that did not build or previously verify these slices. It tries to get
 * around MJ's four B-33 rules (L-0284, migration 0018) by other routes than b33-decisions.test.ts
 * takes: two office sessions acting at the same moment, other whitespace, NULLs, other functions
 * that touch the same state, and direct table writes.
 *
 * Every committed row uses fresh synthetic people, territories and salons made in this file
 * ([Test] names, example.test addresses, H-03); every assignment it makes is ended before the file
 * finishes, so no other file's reps, days or routes are touched.
 *
 * A test named "DEFECT CHECK" is an `it.fails`: it asserts the secure end state, fails today because
 * the defect is real, and keeps the suite green until a builder fixes it; then it must become a
 * plain `it()` with the same assertion (convention of reverify11-attacks.test.ts, H-23).
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { errorOf, fx, MANAGER, MANAGER_AAL1, OWNER, OWNER_AAL1, REP_A, run, SUSPENDED, sqlstate, type Who } from "./helpers/db";
import { claims } from "./setup/fixtures";

const C = { commit: true };
const id = () => randomUUID();
const tag = () => randomUUID().slice(0, 8);
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];
const pg1 = async (sql: string, params: unknown[] = []) => (await run("postgres", sql, params)).rows;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Two office sessions open at once, the way two browser tabs (or the owner and the manager) would
// reach PostgREST: each its own connection, role and JWT claims, in its own transaction.
const pool = new pg.Pool({ connectionString: inject("databaseUrl"), max: 4 });

async function openAs(who: "owner" | "manager") {
  const c = await pool.connect();
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)", [
    claims(fx[who].id, "aal2"),
    JSON.stringify({ "x-kiran-device": fx[who].device }),
  ]);
  await c.query("set local role authenticated");
  return c;
}

/** Outcome of a statement that may wait on the other session's locks: its rows, or its SQLSTATE. */
async function settle(p: Promise<pg.QueryResult>) {
  try {
    return { rows: (await p).rows, code: null as string | null };
  } catch (e) {
    return { rows: [], code: (e as { code?: string }).code ?? "unknown" };
  }
}

/**
 * Runs `first` in session 1 and leaves it uncommitted; starts `second` in session 2 while session 1
 * holds its locks; then commits session 1, lets session 2 finish and commits (or rolls back) it.
 */
async function race(
  first: { who: "owner" | "manager"; sql: string; params: unknown[] },
  second: { who: "owner" | "manager"; sql: string; params: unknown[] },
) {
  const c1 = await openAs(first.who);
  const c2 = await openAs(second.who);
  try {
    const r1 = await settle(c1.query(first.sql, first.params));
    const p2 = settle(c2.query(second.sql, second.params));
    await pause(400); // session 2 has run its checks and waits on session 1's locks (or has finished)
    await c1.query(r1.code ? "rollback" : "commit");
    const r2 = await p2;
    await c2.query(r2.code ? "rollback" : "commit");
    return { r1, r2 };
  } finally {
    c1.release();
    c2.release();
  }
}

// ---------------------------------------------------------------- own personas ----
const REP = id(); // active rep, assigned and unassigned in the races
const LEAVER = id(); // offboarding race target
const LEAVER2 = id(); // offboarded the plain way, for the NULL-status and re-create attempts
const T1 = id(); // race: assign first, deactivate second
const T2 = id(); // race: deactivate first, assign second
const A1 = id();
const S = id(); // office salon for the blank-field attempts
const ADDRESS = "[Test] 12 Fake Road";
const NAME = "[Test] Reverify Salon";

beforeAll(async () => {
  for (const [p, n] of [
    [REP, "rep"],
    [LEAVER, "leaver"],
    [LEAVER2, "leaver2"],
  ] as const) {
    await run("postgres", "insert into auth.users (id, email) values ($1, $2)", [p, `reverify13-${n}-${tag()}@example.test`], C);
  }
  await one(OWNER, "select app.owner_create_user($1, '[Test] Reverify Rep', 'rep', '+920000009101')", [REP]);
  await one(OWNER, "select app.owner_create_user($1, '[Test] Reverify Leaver', 'rep', '+920000009102')", [LEAVER]);
  await one(OWNER, "select app.owner_create_user($1, '[Test] Reverify Leaver 2', 'rep', '+920000009103')", [LEAVER2]);
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T1, `[Test] Reverify T1 ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T2, `[Test] Reverify T2 ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Reverify area')", [A1, T1]);
  await one(MANAGER, "select app.create_salon($1, $2, 'barber', $3, 'manual', $4, null, null, 3)", [S, NAME, A1, ADDRESS]);
});

afterAll(async () => {
  const open = await pg1("select territory_id from public.rep_territory where rep_id = $1 and to_date is null", [REP]);
  for (const r of open) {
    await one(MANAGER, "select app.office_end_territory($1, $2, '[Test] reverify finished')", [REP, r.territory_id]);
  }
  await pool.end();
});

const openAssignment = async (t: string) =>
  (
    await pg1("select count(*)::int n from public.rep_territory where rep_id = $1 and territory_id = $2 and to_date is null", [
      REP,
      t,
    ])
  )[0].n as number;
const isActive = async (t: string) => (await pg1("select active from public.territory where id = $1", [t]))[0].active as boolean;

// ------------------------------------------------------------ B-33 (a) and (b) ----
describe("B-33 (a) and (b) under two office sessions at once (PIP-01)", () => {
  it.fails("DEFECT CHECK (B-33 a/b, race): assigning a rep while another session makes the territory inactive leaves no open assignment on an inactive territory", async () => {
    // Session 1 (manager) assigns REP to the active territory T1 and has not committed yet.
    // Session 2 (owner) makes T1 inactive: its "no open assignment" check cannot see session 1's row.
    const { r1, r2 } = await race(
      { who: "manager", sql: "select (app.office_assign_territory($1, $2)).id", params: [REP, T1] },
      {
        who: "owner",
        sql: "select (app.office_upsert_territory($1, $2, false)).active",
        params: [T1, `[Test] Reverify T1 ${tag()}`],
      },
    );
    const state = { assign: r1.code, deactivate: r2.code, active: await isActive(T1), open: await openAssignment(T1) };
    // Clean up before asserting: end the assignment and make the territory active again.
    if (state.open) await one(MANAGER, "select app.office_end_territory($1, $2, '[Test] reverify race a')", [REP, T1]);
    await one(MANAGER, "select app.office_upsert_territory($1, $2, true)", [T1, `[Test] Reverify T1 ${tag()}`]);
    // Secure end state (L-0284 a and b): never an inactive territory with an open assignment.
    expect(state.active || state.open === 0).toBe(true);
  });

  it.fails("DEFECT CHECK (B-33 b, race): making a territory inactive while another session assigns a rep to it leaves no open assignment on an inactive territory", async () => {
    // Session 1 (owner) makes T2 inactive and has not committed yet; session 2 (manager) assigns REP:
    // its "territory is active" check reads the committed row, which is still active.
    const { r1, r2 } = await race(
      {
        who: "owner",
        sql: "select (app.office_upsert_territory($1, $2, false)).active",
        params: [T2, `[Test] Reverify T2 ${tag()}`],
      },
      { who: "manager", sql: "select (app.office_assign_territory($1, $2)).id", params: [REP, T2] },
    );
    const state = { deactivate: r1.code, assign: r2.code, active: await isActive(T2), open: await openAssignment(T2) };
    if (state.open) await one(MANAGER, "select app.office_end_territory($1, $2, '[Test] reverify race b')", [REP, T2]);
    await one(MANAGER, "select app.office_upsert_territory($1, $2, true)", [T2, `[Test] Reverify T2 ${tag()}`]);
    expect(state.active || state.open === 0).toBe(true);
  });

  it("sequentially both rules hold, also with a NULL active flag, a new id created inactive, and direct table writes", async () => {
    await one(MANAGER, "select app.office_assign_territory($1, $2)", [REP, T1]);
    // p_active null means active (coalesce), so it cannot be used to slip past the check.
    expect(
      (await one(MANAGER, "select (app.office_upsert_territory($1, $2, null)).active", [T1, `[Test] Reverify T1 ${tag()}`]))
        .active,
    ).toBe(true);
    expect(
      await errorOf(OWNER, "select app.office_upsert_territory($1, $2, false)", [T1, `[Test] Reverify T1 ${tag()}`]),
    ).toMatch(/end every rep assignment/);
    // No application role writes the tables directly (RLS has no write policy, no grant).
    for (const who of [OWNER, MANAGER]) {
      expect(await sqlstate(who, "update public.territory set active = false where id = $1", [T1])).toBe("42501");
      expect(await sqlstate(who, "update public.rep_territory set to_date = null where rep_id = $1", [REP])).toBe("42501");
      expect(
        await sqlstate(who, "insert into public.rep_territory (rep_id, territory_id, assigned_by) values ($1, $2, $1)", [
          REP,
          T2,
        ]),
      ).toBe("42501");
    }
    await one(MANAGER, "select app.office_end_territory($1, $2, '[Test] reverify sequential')", [REP, T1]);
    // A territory created inactive cannot take an assignment.
    const TX = id();
    await one(MANAGER, "select app.office_upsert_territory($1, $2, false)", [TX, `[Test] Reverify TX ${tag()}`]);
    expect(await errorOf(MANAGER, "select app.office_assign_territory($1, $2)", [REP, TX])).toMatch(/only to active territories/);
    expect(await isActive(T1)).toBe(true);
    expect(await openAssignment(T1)).toBe(0);
  });
});

describe("the four functions migration 0018 replaced keep their role boundaries", () => {
  it("rep (own device), suspended rep, manager and owner at AAL1, and anon are refused each of them", async () => {
    const calls: [string, unknown[]][] = [
      ["select app.office_upsert_territory($1, $2, false)", [T2, `[Test] Reverify T2 ${tag()}`]],
      ["select app.office_assign_territory($1, $2)", [REP, T2]],
      ["select app.owner_set_status($1, 'suspended', '[Test] not allowed')", [REP]],
      ["select app.update_salon($1, null, 'barber', $2, '[Test] other address')", [S, A1]],
    ];
    for (const who of [REP_A, SUSPENDED, MANAGER_AAL1, OWNER_AAL1, "anon"] as Who[]) {
      for (const [sql, params] of calls) expect(await sqlstate(who, sql, params)).toBe("42501");
    }
    // The manager may run the office functions but not the owner one.
    expect(await sqlstate(MANAGER, "select app.owner_set_status($1, 'suspended', '[Test] not allowed')", [REP])).toBe("42501");
    expect(await isActive(T2)).toBe(true);
    expect((await pg1("select status from public.user_profile where id = $1", [REP]))[0].status).toBe("active");
    expect((await pg1("select address from public.salon where id = $1", [S]))[0].address).toBe(ADDRESS);
  });
});

// ------------------------------------------------------------------- B-33 (c) ----
describe("B-33 (c): offboarding is final (SEC-08)", () => {
  it.fails("DEFECT CHECK (B-33 c, race): a reactivation sent while another session offboards the person does not undo the offboarding", async () => {
    // Session 1 (owner, tab 1) offboards LEAVER and has not committed yet. Session 2 (owner, tab 2)
    // sets LEAVER active: its "already offboarded?" check reads the committed row (active), then its
    // UPDATE waits on session 1's row lock and, once session 1 commits, overwrites offboarded.
    const { r1, r2 } = await race(
      {
        who: "owner",
        sql: "select (app.owner_set_status($1, 'offboarded', '[Test] left the company')).status",
        params: [LEAVER],
      },
      {
        who: "owner",
        sql: "select (app.owner_set_status($1, 'active', '[Test] reactivated in another tab')).status",
        params: [LEAVER],
      },
    );
    const status = (await pg1("select status from public.user_profile where id = $1", [LEAVER]))[0].status;
    // Clean up before asserting: offboard again (active to offboarded is allowed).
    if (status !== "offboarded") await one(OWNER, "select app.owner_set_status($1, 'offboarded', '[Test] cleanup')", [LEAVER]);
    expect({ offboard: r1.code, status }).toEqual({ offboard: null, status: "offboarded" });
    expect(r2.code === null ? r2.rows[0].status : "refused").not.toBe("active");
  });

  it("other routes to an offboarded person stay closed: NULL status, re-creating the profile, direct writes", async () => {
    await one(OWNER, "select app.owner_set_status($1, 'offboarded', '[Test] left')", [LEAVER2]);
    // NULL status: the offboarded check is skipped (NULL <> 'offboarded'), but the column is not null.
    expect(await sqlstate(OWNER, "select app.owner_set_status($1, null, '[Test] null status')", [LEAVER2])).not.toBeNull();
    // owner_create_user on the same id: a replay returns the offboarded row; anything else is 23505.
    expect(
      (await one(OWNER, "select (app.owner_create_user($1, '[Test] Reverify Leaver 2', 'rep')).status", [LEAVER2])).status,
    ).toBe("offboarded");
    expect(await sqlstate(OWNER, "select app.owner_create_user($1, '[Test] Someone Else', 'rep')", [LEAVER2])).toBe("23505");
    expect(await sqlstate(OWNER, "select app.owner_create_user($1, '[Test] Reverify Leaver 2', 'manager')", [LEAVER2])).toBe(
      "23505",
    );
    // Direct writes: no update grant or policy for any application role.
    for (const who of [OWNER, MANAGER]) {
      expect(await sqlstate(who, "update public.user_profile set status = 'active' where id = $1", [LEAVER2])).toBe("42501");
    }
    // The manager cannot call the owner function at all.
    expect(await sqlstate(MANAGER, "select app.owner_set_status($1, 'active', '[Test] manager tries')", [LEAVER2])).toBe("42501");
    expect((await pg1("select status from public.user_profile where id = $1", [LEAVER2]))[0].status).toBe("offboarded");
    // The offboarded person cannot get back in with a new phone: registration is refused.
    const dev = `dev-${id()}`;
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)", [
        claims(LEAVER2, "aal1"),
        JSON.stringify({ "x-kiran-device": dev }),
      ]);
      await c.query("set local role authenticated");
      const code = await c
        .query("select app.register_device($1, 'android', '[Test] new phone')", [dev])
        .then(() => null)
        .catch((e: { code?: string }) => e.code ?? "unknown");
      expect(code).not.toBeNull();
    } finally {
      await c.query("rollback").catch(() => {});
      c.release();
    }
  });
});

// ------------------------------------------------------------------- B-33 (d) ----
describe("B-33 (d): a blank address keeps the recorded one (SAL-01)", () => {
  const addressAfter = async (blank: string) =>
    (await one(MANAGER, "select (app.update_salon($1, null, 'barber', $2, $3)).address", [S, A1, blank])).address as string;

  it("NULL, empty and space-only addresses keep the recorded address (as b33-decisions.test.ts shows)", async () => {
    for (const blank of [null, "", "     "]) expect(await addressAfter(blank as string)).toBe(ADDRESS);
  });

  it.fails("DEFECT CHECK (B-33 d): a tab-only address keeps the recorded address", async () => {
    // btrim() with no second argument strips spaces only, so a tab is not blank to the database.
    const after = await addressAfter("\t");
    if (after !== ADDRESS) await one(MANAGER, "select app.update_salon($1, null, 'barber', $2, $3)", [S, A1, ADDRESS]);
    expect(after).toBe(ADDRESS);
  });

  it.fails("DEFECT CHECK (B-33 d): a line-break or no-break-space address keeps the recorded address", async () => {
    const results: string[] = [];
    for (const blank of ["\n", "\u00a0", " \r\n\u00a0"]) {
      results.push(await addressAfter(blank));
      await one(MANAGER, "select app.update_salon($1, null, 'barber', $2, $3)", [S, A1, ADDRESS]);
    }
    expect(results).toEqual([ADDRESS, ADDRESS, ADDRESS]);
  });

  it.fails("DEFECT CHECK (B-33 d, same rule for the name): a tab-only name keeps the recorded name", async () => {
    // The salon name check is length(btrim(name)) between 2 and 120, so two tabs pass it.
    const after = (await one(MANAGER, "select (app.update_salon($1, $2, 'barber', $3)).name", [S, "\t\t", A1])).name as string;
    if (after !== NAME) await one(MANAGER, "select app.update_salon($1, $2, 'barber', $3)", [S, NAME, A1]);
    expect(after).toBe(NAME);
  });
});
