/**
 * Shared synthetic personas (H-03: no real people, phones or ids).
 * Built through the real RPC surface wherever the platform allows it, so fixture
 * creation itself exercises the owner-only and device-approval paths.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";

export type PersonaKey = "owner" | "manager" | "repA" | "repB" | "suspendedRep";

export interface Persona {
  id: string;
  /** device fingerprint registered (and, for active reps, approved) for this persona */
  device: string;
}

export type Fixtures = Record<PersonaKey, Persona>;

export function claims(id: string, aal: "aal1" | "aal2") {
  return JSON.stringify({ sub: id, role: "authenticated", aal });
}

async function asUser(c: pg.Client, id: string, aal: "aal1" | "aal2", device: string | null, sql: string, params: unknown[]) {
  await c.query("begin");
  try {
    await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)", [
      claims(id, aal),
      JSON.stringify(device ? { "x-kiran-device": device } : {}),
    ]);
    await c.query("set local role authenticated");
    const r = await c.query(sql, params);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback");
    throw e;
  }
}

export async function createFixtures(c: pg.Client): Promise<Fixtures> {
  const mk = (): Persona => ({ id: randomUUID(), device: `dev-${randomUUID()}` });
  const f: Fixtures = { owner: mk(), manager: mk(), repA: mk(), repB: mk(), suspendedRep: mk() };

  for (const [k, p] of Object.entries(f)) {
    await c.query("insert into auth.users (id, email) values ($1, $2)", [p.id, `${k.toLowerCase()}@example.test`]);
  }
  // Human-only bootstrap path (ACTIVITY §10), run as postgres.
  await c.query("select app.bootstrap_owner($1, $2)", [f.owner.id, "[Test] Owner"]);

  const create = (p: Persona, name: string, role: string, phone: string) =>
    asUser(c, f.owner.id, "aal2", null, "select app.owner_create_user($1, $2, $3::public.app_role, $4)", [p.id, name, role, phone]);
  await create(f.manager, "[Test] Manager", "manager", "+920000000001");
  await create(f.repA, "[Test] Rep A", "rep", "+920000000002");
  await create(f.repB, "[Test] Rep B", "rep", "+920000000003");
  await create(f.suspendedRep, "[Test] Rep Suspended", "rep", "+920000000004");

  for (const p of [f.repA, f.repB, f.suspendedRep]) {
    const { rows } = await asUser(c, p.id, "aal1", p.device, "select (app.register_device($1, 'android', 'test phone')).id", [p.device]);
    await asUser(c, f.manager.id, "aal2", null, "select app.approve_device($1, 'fixture')", [rows[0].id]);
  }
  await asUser(c, f.owner.id, "aal2", null, "select app.owner_set_status($1, 'suspended', 'fixture: suspended rep')", [f.suspendedRep.id]);
  return f;
}
