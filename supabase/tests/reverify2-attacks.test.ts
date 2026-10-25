/**
 * Second re-verification (ACTIVITY §7, L-0035) of P1-01 after migration 0005 (L-0032).
 * Written by the re-verifier-2 subagent, not the builder. Tests named "DEFECT CHECK" state
 * the SECURE expectation: a failure there is a defect, not a broken test. Do not loosen them.
 * Tests named "QUESTION" record observed behaviour for MJ and pass either way.
 */
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { describe, expect, inject, it } from "vitest";
import {
  fx, run, sqlstate, type Who,
  MANAGER, MANAGER_AAL1, OWNER, OWNER_AAL1, REP_A, REP_A_WRONG_DEVICE, REP_B, SUSPENDED,
} from "./helpers/db";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const ROOT = resolve(import.meta.dirname, "../..");
const MIG = join(ROOT, "supabase", "migrations");
const FILES = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const PRE = FILES.filter((f) => f < "20261024232225");
const POST = FILES.filter((f) => f >= "20261024232225");
const RETIRE = FILES.find((f) => f.startsWith("20261025001514"))!;

const asUser = (id: string, aal: "aal1" | "aal2", device: string | null) => `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: id, role: "authenticated", aal })}', true),
         set_config('request.headers', '${JSON.stringify(device ? { "x-kiran-device": device } : {})}', true);
  set local role authenticated;`;
type Multi = Array<{ rows: Array<Record<string, any>> }>;
const last = (r: unknown) => (r as Multi)[(r as Multi).length - 1].rows;

/**
 * A separate throwaway database on the embedded server: migrations 0001–0003, an owner,
 * a rep whose phone (raw id `raw`) is approved and makes one audited write, then every
 * later migration (0004, 0005, ...). Mirrors a production database upgraded in place.
 */
async function upgradedDb(extra?: (c: pg.Client, as: AsFn, ids: { owner: string; rep: string }) => Promise<void>) {
  const base = inject("databaseUrl");
  const dbName = `kiran_rv2_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  const u = new URL(base);
  u.pathname = `/${dbName}`;
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  const as: AsFn = async (id, aal, dev, sql, params = []) => {
    await c.query("begin");
    try {
      await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)",
        [JSON.stringify({ sub: id, role: "authenticated", aal }), JSON.stringify(dev ? { "x-kiran-device": dev } : {})]);
      await c.query("set local role authenticated");
      const r = await c.query(sql, params);
      await c.query("commit");
      return r;
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  };
  const close = async () => {
    await c.end();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  };
  const raw = `web-${randomUUID()}`;
  const owner = randomUUID();
  const rep = randomUUID();
  try {
    if (!(await c.query("select to_regprocedure('auth.jwt()') is not null h")).rows[0].h) {
      await c.query(readFileSync(join(ROOT, "supabase", "tests", "shim", "supabase-shim.sql"), "utf8"));
    }
    for (const f of PRE) await c.query(readFileSync(join(MIG, f), "utf8"));
    await c.query("insert into auth.users (id, email) values ($1, 'o@example.test'), ($2, 'r@example.test')", [owner, rep]);
    await c.query("select app.bootstrap_owner($1, '[Test] Owner')", [owner]);
    await as(owner, "aal2", null, "select app.owner_create_user($1, '[Test] Rep', 'rep')", [rep]);
    const dev = (await as(rep, "aal1", raw, "select (app.register_device($1, 'android', 'rep phone')).id", [raw])).rows[0].id as string;
    await as(owner, "aal2", null, "select app.approve_device($1, 'fixture')", [dev]);
    await as(rep, "aal1", raw, "select app.request_approval(gen_random_uuid(), 'discount', 'order', null, '{}', 'pre-0004 write')");
    if (extra) await extra(c, as, { owner, rep });
    for (const f of POST) await c.query(readFileSync(join(MIG, f), "utf8"));
    return { c, as, close, raw, owner, rep, dev };
  } catch (e) {
    await close();
    throw e;
  }
}
type AsFn = (id: string, aal: string, dev: string | null, sql: string, params?: unknown[]) => Promise<pg.QueryResult>;

describe("0005 retirement of pre-0004 device ids (L-0032)", () => {
  it("DEFECT CHECK: a raw id leaked into pre-0004 audit history never passes the device gate again, and its phone cannot be re-registered or re-approved (B-16a, L-0040)", async () => {
    const db = await upgradedDb();
    try {
      // Precondition (builder's claim, L-0032): revoked, and the leaked id alone is refused.
      expect((await db.c.query("select status::text s from public.device where id = $1", [db.dev])).rows[0].s).toBe("revoked");
      const leaked = (await db.c.query(
        "select device_id from control.audit_event where device_id is not null and device_id !~ '^[0-9a-f]{64}$' limit 1")).rows[0].device_id;
      expect(leaked).toBe(db.raw); // the bearer value anyone with audit/backup access can read

      // Secure end state (MJ approval L-0040, B-16a): the thief (stolen session, own phone) cannot
      // re-register the leaked id; it is dead for good and the original row stays revoked.
      const orig = (await db.c.query("select id, platform, label, created_at from public.device where id = $1", [db.dev])).rows[0];
      let regErr: string | null = null;
      try {
        await db.as(db.rep, "aal1", "dev-thief-phone-000001",
          "select app.register_device($1, 'thief-browser', 'thief')", [db.raw]);
      } catch (e) {
        regErr = (e as Error).message;
      }
      expect(regErr).toMatch(/device id revoked; generate a new one/);
      expect((await db.c.query("select status::text s from public.device where id = $1", [orig.id])).rows[0].s).toBe("revoked");
      const madeUp = (await db.as(db.rep, "aal1", "dev-thief-phone-000001",
        "select id, platform from app.register_device($1, 'thief-browser', 'thief')", [`dev-${randomUUID()}`])).rows[0];
      expect(madeUp.id).not.toBe(orig.id);
      expect(madeUp.platform).toBe("thief-browser");

      // The office cannot approve the rep's old row either: a revoked device stays revoked.
      let approveErr: string | null = null;
      try {
        await db.as(db.owner, "aal2", null, "select app.approve_device($1, 'rep says the phone was reset')", [db.dev]);
      } catch (e) {
        approveErr = (e as Error).message;
      }
      expect(approveErr).toMatch(/revoked devices cannot be re-approved/);

      // Secure expectation: the id that sits readable in the audit log is dead for good.
      let err: string | null = null;
      try {
        await db.as(db.rep, "aal1", db.raw, "select app.request_approval(gen_random_uuid(), 'discount', 'order', null, '{}', 'leaked id after re-approval')");
      } catch (e) {
        err = (e as Error).message;
      }
      expect(err ?? "SUCCEEDED: request_approval accepted the raw id read from control.audit_event").toMatch(/device is not approved/);
    } finally {
      await db.close();
    }
  });

  it("QUESTION: a pre-0004 raw id that is already 64 lowercase hex is neither hashed by 0004 nor revoked by 0005", async () => {
    const raw64 = sha(`known-${randomUUID()}`);
    const rep2 = randomUUID();
    const db = await upgradedDb(async (c, as, ids) => {
      await c.query("insert into auth.users (id, email) values ($1, 'r2@example.test')", [rep2]);
      await as(ids.owner, "aal2", null, "select app.owner_create_user($1, '[Test] Rep 2', 'rep')", [rep2]);
      const d = (await as(rep2, "aal1", raw64, "select (app.register_device($1)).id", [raw64])).rows[0].id;
      await as(ids.owner, "aal2", null, "select app.approve_device($1, 'fixture')", [d]);
    });
    try {
      const row = (await db.c.query("select status::text s, device_fingerprint = $2 raw_kept from public.device where user_id = $1", [rep2, raw64])).rows[0];
      let err: string | null = null;
      try {
        await db.as(rep2, "aal1", raw64, "select app.request_approval(gen_random_uuid(), 'discount', 'order', null, '{}', 'hash-shaped id')");
      } catch (e) {
        err = (e as Error).message;
      }
      // Observed 2026-10-25: { s: 'approved', raw_kept: true } and the phone is locked out
      // (sha256(raw64) <> raw64). Not exploitable without a preimage; recorded for MJ only.
      expect(typeof row.s).toBe("string");
      expect(err === null || /device is not approved/.test(err)).toBe(true);
      console.log("rv2 hash-shaped pre-0004 id:", JSON.stringify(row), "gate:", err ?? "PASSED");
    } finally {
      await db.close();
    }
  });

  it("0005 makes no false revocations on post-0004 data and is safe to re-run", async () => {
    const sql = readFileSync(join(MIG, RETIRE), "utf8");
    const r = await run("postgres", `
      select count(*)::int n from public.device where status <> 'revoked';
      ${sql};
      select count(*)::int n from public.device where status <> 'revoked';`) as unknown as Multi;
    const counts = r.filter((x) => x.rows?.[0] && "n" in x.rows[0]).map((x) => x.rows[0].n);
    expect(counts.length).toBe(2);
    expect(counts[1]).toBe(counts[0]);
    expect(counts[0]).toBeGreaterThanOrEqual(2); // rep A and rep B approved devices
  });

  it("after 0005 the leaked id, the stored hash, and the hash of the hash are all refused on the upgraded database", async () => {
    const db = await upgradedDb();
    try {
      const stored = (await db.c.query("select device_fingerprint f from public.device where id = $1", [db.dev])).rows[0].f;
      for (const hdr of [db.raw, stored, sha(stored), ` ${db.raw}`, db.raw.toUpperCase()]) {
        let err: string | null = null;
        try {
          await db.as(db.rep, "aal1", hdr, "select app.request_approval(gen_random_uuid(), 'discount', 'order', null, '{}', 'probe')");
        } catch (e) {
          err = (e as Error).message;
        }
        expect(err, hdr).toMatch(/device is not approved/);
        const reads = (await db.as(db.rep, "aal1", hdr,
          "select (select count(*)::int from public.user_profile) p, (select count(*)::int from public.device) d, (select count(*)::int from control.approval_request) a")).rows[0];
        expect(reads, hdr).toEqual({ p: 0, d: 0, a: 0 });
      }
      const s = (await db.as(db.rep, "aal1", db.raw, "select app.my_session() s")).rows[0].s;
      expect(s.device_status).toBe("revoked");
      expect((await db.c.query("select ok from control.verify_audit_chain()")).rows[0].ok).toBe(true);
      // 0005 records no revoking user: the audit row for the retirement has no actor.
      const ret = (await db.c.query(
        "select actor_id, purpose, (after ->> 'revoked_by') rb from control.audit_event where table_name = 'public.device' and action = 'UPDATE' order by seq desc limit 1")).rows[0];
      expect(ret).toEqual({ actor_id: null, purpose: "retire device ids exposed in pre-0004 audit history (L-0030)", rb: null });
    } finally {
      await db.close();
    }
  });
});

describe("device gate and the audit log under an unapproved phone", () => {
  it("QUESTION (consequence of B-16b): repeated register_device of ONE pending id from an unapproved phone writes one audit row per call, so a pending-device cap alone does not bound audit growth", async () => {
    const id = `dev-flood-${randomUUID()}`;
    let sql = `select count(*)::int n0 from control.audit_event; ${asUser(fx.repA.id, "aal1", "dev-not-approved-0000")}`;
    for (let i = 0; i < 25; i++) sql += `select (app.register_device('${id}')).status;`;
    sql += "reset role; select count(*)::int n1 from control.audit_event;";
    const r = (await run("postgres", sql)) as unknown as Multi;
    const n0 = r.find((x) => x.rows?.[0] && "n0" in x.rows[0])!.rows[0].n0;
    const n1 = last(r)[0].n1;
    // Observed 2026-10-25: 25 audit rows (1 INSERT + 24 last_seen_at UPDATEs). Asserted loosely.
    console.log("rv2 audit rows from 25 register_device calls of one id:", n1 - n0);
    expect(n1 - n0).toBeGreaterThanOrEqual(1);
  });

  it("a rep on the approved device still works after 0005 (no regression for current data)", async () => {
    const r = await run(REP_A, "select app.rep_device_ok() ok, (select count(*)::int from public.device) d");
    expect(r.rows[0]).toEqual({ ok: true, d: 1 });
  });
});

describe("§7 sweep, written independently by re-verifier-2", () => {
  const PERSONAS: Array<[string, Who]> = [
    ["anon", "anon"], ["service_role", "service_role"], ["repA", REP_A], ["repB", REP_B],
    ["repA_wrong_device", REP_A_WRONG_DEVICE], ["manager", MANAGER], ["managerAal1", MANAGER_AAL1],
    ["owner", OWNER], ["ownerAal1", OWNER_AAL1], ["suspended", SUSPENDED],
  ];

  it("§7.2 vault: no app role can use supplier_vault; vault_api has no functions; only granted AAL2 office has the grant", async () => {
    const { rows } = await run("postgres", `
      select r, has_schema_privilege(r, 'supplier_vault', 'usage') u from unnest(array['anon','authenticated','service_role']) r`);
    expect(rows.every((x) => x.u === false)).toBe(true);
    expect((await run("postgres", "select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'vault_api'")).rows[0].n).toBe(0);
    const grants: Record<string, boolean | string> = {};
    for (const [k, who] of PERSONAS) {
      try { grants[k] = (await run(who, "select app.has_vault_grant() g")).rows[0].g; } catch (e) { grants[k] = (e as { code: string }).code; }
    }
    expect(grants).toEqual({ anon: "42501", service_role: "42501", repA: false, repB: false, repA_wrong_device: false,
      manager: true, managerAal1: false, owner: true, ownerAal1: false, suspended: false });
  });

  it("§7.3 append-only: UPDATE and DELETE on audit_event and approval_request fail for every app role", async () => {
    for (const [k, who] of PERSONAS) {
      for (const sql of ["update control.audit_event set purpose = 'x'", "delete from control.audit_event",
                         "update control.approval_request set reason = 'xxx'", "delete from control.approval_request",
                         "update public.device set status = 'approved'", "delete from public.device"]) {
        expect(await sqlstate(who, sql), `${k}: ${sql}`).toBe("42501");
      }
    }
  });

  it("§7.5 approvals: self-approval refused; a rep cannot decide; a wrong-device rep cannot request", async () => {
    expect(await errorOfMulti(`
      ${asUser(fx.manager.id, "aal2", null)}
      select (app.request_approval('11111111-2222-4333-8444-555555555555', 'adjustment', 'order', null, '{}', 'rv2 self')).id;
      select app.decide_approval((select id from control.approval_request where client_id = '11111111-2222-4333-8444-555555555555'), true, 'approving my own');`))
      .toMatch(/maker cannot approve/);
    expect(await errorOfMulti(`
      ${asUser(fx.manager.id, "aal2", null)}
      select (app.request_approval('11111111-2222-4333-8444-555555555556', 'adjustment', 'order', null, '{}', 'rv2')).id;
      ${asUser(fx.repA.id, "aal1", fx.repA.device)}
      select app.decide_approval((select id from control.approval_request limit 1), true, 'rep decides');`))
      .toMatch(/owner or manager only/);
    expect(await errorOfMulti(`
      ${asUser(fx.repA.id, "aal1", "dev-not-approved-0000")}
      select app.request_approval(gen_random_uuid(), 'discount', 'order', null, '{}', 'thief');`)).toMatch(/device is not approved/);
  });

  it("§7.6 replay: the same client_id twice gives one row and one audit insert; created_at is server time", async () => {
    const cid = randomUUID();
    const r = await run("postgres", `
      select count(*)::int a0 from control.audit_event;
      ${asUser(fx.repA.id, "aal1", fx.repA.device)}
      select (app.request_approval('${cid}', 'discount', 'order', null, '{}', 'rv2 replay')).id x1;
      select (app.request_approval('${cid}', 'discount', 'order', null, '{"changed": true}', 'rv2 replay')).id x2;
      reset role;
      select count(*)::int n, max(abs(extract(epoch from (created_at - now()))))::int skew from control.approval_request where client_id = '${cid}';
      select count(*)::int a1 from control.audit_event;`) as unknown as Multi;
    const got = Object.assign({}, ...r.filter((x) => x.rows?.length === 1).map((x) => x.rows[0]));
    expect(got.x1).toBe(got.x2);
    expect(got.n).toBe(1);
    expect(got.skew).toBeLessThanOrEqual(5);
    expect(got.a1 - got.a0).toBe(1);
  });
});

async function errorOfMulti(sql: string): Promise<string | null> {
  try {
    await run("postgres", sql);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
