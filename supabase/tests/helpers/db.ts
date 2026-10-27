/**
 * Test helpers: run SQL as a persona inside a transaction that is always rolled back
 * (unless `commit` is set), exactly as PostgREST does: SET LOCAL ROLE + request.jwt.claims
 * + request.headers.
 */
import { inject } from "vitest";
import pg from "pg";
import { claims, type Fixtures, type PersonaKey } from "../setup/fixtures";

export const fx: Fixtures = inject("fixtures");
const pool = new pg.Pool({ connectionString: inject("databaseUrl"), max: 4 });

export type Who =
  | "anon"
  | "postgres"
  | "service_role"
  | { as: PersonaKey; aal?: "aal1" | "aal2"; device?: string | null };

export const OWNER: Who = { as: "owner" };
export const OWNER_AAL1: Who = { as: "owner", aal: "aal1" };
export const MANAGER: Who = { as: "manager" };
export const MANAGER_AAL1: Who = { as: "manager", aal: "aal1" };
export const REP_A: Who = { as: "repA" };
export const REP_B: Who = { as: "repB" };
export const REP_A_WRONG_DEVICE: Who = { as: "repA", device: "dev-not-approved-0000" };
export const SUSPENDED: Who = { as: "suspendedRep" };

function idOf(w: Who) {
  return typeof w === "string" ? null : fx[w.as].id;
}

export async function run<T extends pg.QueryResultRow = any>(
  who: Who,
  sql: string,
  params: unknown[] = [],
  opts: { commit?: boolean } = {},
): Promise<pg.QueryResult<T>> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    if (who === "anon") {
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
      await c.query("set local role anon");
    } else if (who === "service_role") {
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
      await c.query("set local role service_role");
    } else if (who !== "postgres") {
      const p = fx[who.as];
      const isRep = who.as.startsWith("rep") || who.as === "suspendedRep";
      const aal = who.aal ?? (isRep ? "aal1" : "aal2");
      const device = who.device === undefined ? p.device : who.device;
      await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)", [
        claims(p.id, aal),
        JSON.stringify(device ? { "x-kiran-device": device } : {}),
      ]);
      await c.query("set local role authenticated");
    }
    const r = await c.query<T>(sql, params);
    await c.query(opts.commit ? "commit" : "rollback");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Returns the SQLSTATE of the error, or null when the statement succeeded. */
export async function sqlstate(who: Who, sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await run(who, sql, params);
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "unknown";
  }
}

export async function errorOf(who: Who, sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await run(who, sql, params);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export { idOf };
