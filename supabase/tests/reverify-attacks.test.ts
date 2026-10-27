/**
 * Re-verification attacks (ACTIVITY §7, L-0030) on P1-01 / P0-06 / P0-08 after migration 0004.
 * Written by the re-verifier subagent, not the builder. Every test states the SECURE
 * expectation: a failing test here is a defect, not a broken test. Do not loosen these.
 */
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { describe, expect, inject, it } from "vitest";
import {
  errorOf, fx, run, sqlstate, type Who,
  MANAGER, MANAGER_AAL1, OWNER, OWNER_AAL1, REP_A, REP_A_WRONG_DEVICE, REP_B, SUSPENDED,
} from "./helpers/db";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const asUser = (id: string, aal: "aal1" | "aal2", device: string | null) => `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: id, role: "authenticated", aal })}', true),
         set_config('request.headers', '${JSON.stringify(device ? { "x-kiran-device": device } : {})}', true);
  set local role authenticated;`;
type Multi = Array<{ rows: Array<Record<string, any>> }>;
const last = (r: unknown) => (r as Multi)[(r as Multi).length - 1].rows;

const ALL: Array<[string, Who]> = [
  ["anon", "anon"], ["service_role", "service_role"], ["repA", REP_A], ["repB", REP_B],
  ["repA_wrong_device", REP_A_WRONG_DEVICE], ["manager", MANAGER], ["managerAal1", MANAGER_AAL1],
  ["owner", OWNER], ["ownerAal1", OWNER_AAL1], ["suspended", SUSPENDED],
];

describe("function surface after migration 0004 replaced functions", () => {
  it("replaced/new definer functions keep search_path = '' and the right grants", async () => {
    const { rows } = await run("postgres", `
      select n.nspname || '.' || p.proname f, p.prosecdef d, p.proconfig c,
             has_function_privilege('authenticated', p.oid, 'execute') auth,
             has_function_privilege('anon', p.oid, 'execute') anon,
             has_function_privilege('service_role', p.oid, 'execute') sr,
             has_function_privilege('public', p.oid, 'execute') pub
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('app', 'control') and p.proname in
        ('rep_device_ok', 'register_device', 'audit_row', 'my_session', 'self_ok', 'fingerprint_hash')
      order by 1`);
    const by = Object.fromEntries(rows.map((r) => [r.f, r]));
    for (const r of rows) {
      expect(r.c, r.f).toContain('search_path=""');
      expect(r.anon || r.sr || r.pub, r.f).toBe(false);
    }
    expect(by["app.rep_device_ok"].d && by["app.register_device"].d && by["control.audit_row"].d && by["app.my_session"].d).toBe(true);
    expect(by["app.fingerprint_hash"].auth).toBe(false);
    expect(by["control.audit_row"].auth).toBe(false);
    expect(by["app.my_session"].auth && by["app.self_ok"].auth).toBe(true);
  });

  it("app.fingerprint_hash is not callable by any app role (no hashing oracle)", async () => {
    for (const [, who] of ALL) expect(await sqlstate(who, "select app.fingerprint_hash('x')")).toBe("42501");
  });
});

describe("device gate on write paths (doc 04 invariant 7)", () => {
  it("an idempotent replay from an unapproved device is refused, not answered with the stored row", async () => {
    const cid = randomUUID();
    const { rows } = await run(REP_A, "select (app.request_approval($1, 'discount', 'order', null, '{}', 'reverify replay')).id", [cid], { commit: true });
    const err = await errorOf(REP_A_WRONG_DEVICE, "select app.request_approval($1, 'discount', 'order', null, '{}', 'reverify replay')", [cid]);
    expect(err).toMatch(/device is not approved/);
    expect(await errorOf(REP_A_WRONG_DEVICE, "select app.cancel_approval($1, 'thief cancels')", [rows[0].id])).toMatch(/device is not approved/);
  });

  it("a thief on an unapproved phone cannot revoke the rep's approved device", async () => {
    const { rows } = await run("postgres", "select id from public.device where user_id = $1 and status = 'approved'", [fx.repA.id]);
    expect(await errorOf(REP_A_WRONG_DEVICE, "select app.revoke_device($1, 'thief')", [rows[0].id])).toMatch(/device is not approved/);
  });

  it("device-gate refusals leak neither the raw id nor the stored hash", async () => {
    const { rows } = await run("postgres", "select device_fingerprint f from public.device where user_id = $1 and status = 'approved'", [fx.repA.id]);
    const err = (await errorOf(REP_A_WRONG_DEVICE, "select app.request_approval(gen_random_uuid(), 'discount', 'order', null, '{}', 'probe')")) ?? "";
    expect(err).not.toContain(rows[0].f);
    expect(err).not.toContain(fx.repA.device);
  });

  it("register_device from an unapproved phone only ever touches the caller's own rows", async () => {
    // Rep A's session (wrong phone) registers rep B's raw device id: a new pending row for A, B untouched.
    const r = await run("postgres", `${asUser(fx.repA.id, "aal1", "dev-not-approved-0000")}
      select (app.register_device('${fx.repB.device}')).status s;
      reset role;
      select count(*)::int n from public.device where user_id = '${fx.repB.id}' and status = 'approved';
      ${asUser(fx.repB.id, "aal1", fx.repB.device)}
      select app.rep_device_ok() ok;`) as unknown as Multi;
    const statuses = r.filter((x) => x.rows?.[0] && "s" in x.rows[0]).map((x) => x.rows[0].s);
    expect(statuses).toEqual(["pending"]);
    expect(last(r)[0].ok).toBe(true);
  });

  it("QUESTION (not a defect): an unapproved-phone session can create unlimited pending devices", async () => {
    let sql = asUser(fx.repA.id, "aal1", "dev-not-approved-0000");
    for (let i = 0; i < 50; i++) sql += `select app.register_device('dev-flood-${randomUUID()}');`;
    sql += "reset role; select count(*)::int n from public.device where user_id = '" + fx.repA.id + "' and status = 'pending';";
    const n = last(await run("postgres", sql))[0].n;
    // Observed on 2026-10-25: all 50 accepted (no cap or rate limit). Asserted loosely so a future cap does not fail this test.
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it("a device the office revoked can never re-enter the queue or be approved again (MJ approval L-0040, B-16a)", async () => {
    const r = await run("postgres", `
      ${asUser(fx.manager.id, "aal2", null)}
      select (app.revoke_device((select id from public.device where user_id = '${fx.repA.id}' and status = 'approved'), 'reported stolen')).status s1;
      ${asUser(fx.repA.id, "aal1", fx.repA.device)}
      do $$ begin perform app.register_device('${fx.repA.device}'); raise exception 'REGISTER_NOT_REFUSED'; exception when insufficient_privilege then null; end $$;
      ${asUser(fx.manager.id, "aal2", null)}
      do $$ begin perform app.approve_device((select id from public.device where user_id = '${fx.repA.id}' and device_fingerprint = '${sha(fx.repA.device)}'), 'one click'); raise exception 'APPROVE_NOT_REFUSED'; exception when insufficient_privilege then null; end $$;
      reset role;
      select status::text s2 from public.device where user_id = '${fx.repA.id}' and device_fingerprint = '${sha(fx.repA.device)}';`) as unknown as Multi;
    const vals = r.flatMap((x) => (x.rows?.[0] ? Object.entries(x.rows[0]).filter(([k]) => /^s\d$/.test(k)).map(([, v]) => v) : []));
    // Revoked, re-registration refused, approval refused, still revoked (the do-blocks raise if either was allowed).
    expect(vals).toEqual(["revoked", "revoked"]);
  });

  it("a device registered before its user is suspended cannot be approved afterwards, even after reactivation", async () => {
    const fp = `dev-${randomUUID()}`;
    const r = await run("postgres", `
      ${asUser(fx.repB.id, "aal1", fx.repB.device)}
      select (app.register_device('${fp}')).id;
      ${asUser(fx.owner.id, "aal2", null)}
      select app.owner_set_status('${fx.repB.id}', 'suspended', 'reverify');
      select app.owner_set_status('${fx.repB.id}', 'active', 'reverify');
      reset role;
      select status::text s from public.device where user_id = '${fx.repB.id}' and device_fingerprint = '${sha(fp)}';`);
    expect(last(r)[0].s).toBe("revoked");
    const e = await errorOf("postgres", `
      ${asUser(fx.repB.id, "aal1", fx.repB.device)}
      select (app.register_device('${fp}')).id;
      ${asUser(fx.owner.id, "aal2", null)}
      select app.owner_set_status('${fx.repB.id}', 'suspended', 'reverify');
      ${asUser(fx.manager.id, "aal2", null)}
      select app.approve_device((select id from public.device where device_fingerprint = '${sha(fp)}'), 'try');`);
    expect(e).toMatch(/revoked devices cannot be re-approved/);
  });

  it("no RLS policy relies on rep_device_ok() alone (it is TRUE for a user with no active profile)", async () => {
    const { rows } = await run("postgres", `
      select schemaname || '.' || tablename || ':' || policyname p, qual from pg_policies
      where schemaname in ('public', 'control', 'supplier_vault')`);
    for (const r of rows) {
      if (/rep_device_ok/.test(r.qual ?? "")) expect(r.qual, r.p).toMatch(/user_role|self_ok|is_office/);
    }
    expect((await run(SUSPENDED, "select app.rep_device_ok() ok")).rows[0].ok).toBe(true); // documents the masking dependency
  });
});

describe("device gate on read paths and side channels", () => {
  it("my_session returns only the documented keys and never another device's status", async () => {
    const s = (await run(REP_A_WRONG_DEVICE, "select app.my_session() s")).rows[0].s;
    expect(Object.keys(s).sort()).toEqual(["aal", "device_status", "full_name", "role", "status", "user_id"]);
    expect(s.device_status).toBeNull();
    // Rep A's session presenting rep B's raw id learns nothing about B's device.
    const cross = (await run({ as: "repA", device: fx.repB.device }, "select app.my_session() s")).rows[0].s;
    expect(cross.device_status).toBeNull();
    expect(cross.user_id).toBe(fx.repA.id);
    expect(await sqlstate("service_role", "select app.my_session()")).toBe("42501");
    expect(await sqlstate("anon", "select app.my_session()")).toBe("42501");
  });

  it("a config row the owner makes rep-visible reaches only reps on their approved device", async () => {
    const r = await run("postgres", `
      ${asUser(fx.owner.id, "aal2", null)}
      select app.owner_set_config('visit.outcomes', '[]'::jsonb, 'reverify probe', true);
      ${asUser(fx.repA.id, "aal1", fx.repA.device)}       select count(*)::int a  from public.app_config;
      ${asUser(fx.repA.id, "aal1", "dev-not-approved-0000")} select count(*)::int w  from public.app_config;
      ${asUser(fx.suspendedRep.id, "aal1", fx.suspendedRep.device)} select count(*)::int su from public.app_config;
      ${asUser(fx.repA.id, "aal1", null)}                  select count(*)::int nh from public.app_config;`) as unknown as Multi;
    const got = Object.assign({}, ...r.filter((x) => x.rows?.length === 1).map((x) => x.rows[0]));
    expect({ a: got.a, w: got.w, su: got.su, nh: got.nh }).toEqual({ a: 1, w: 0, su: 0, nh: 0 });
  });

  it("a rep claiming aal2 gains nothing; malformed or odd device headers fail closed without error", async () => {
    const { rows } = await run({ as: "repA", aal: "aal2" }, "select app.is_office() o, (select count(*)::int from public.user_profile) n");
    expect(rows[0]).toEqual({ o: false, n: 1 });
    for (const hdr of ["not json", JSON.stringify({ "x-kiran-device": [fx.repA.device] }), JSON.stringify({ "X-Kiran-Device": fx.repA.device })]) {
      const r = await run("postgres", `
        select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.repA.id, role: "authenticated", aal: "aal1" })}', true),
               set_config('request.headers', $q$${hdr}$q$, true);
        set local role authenticated;
        select app.rep_device_ok() ok, (select count(*)::int from public.device) n;`);
      expect(last(r)[0]).toEqual({ ok: false, n: 0 });
    }
  });

  it("audit log: device_id is the sha256 of the header; office write without header has null; rows unreadable below owner AAL2", async () => {
    await run(REP_A, "select app.request_approval(gen_random_uuid(), 'discount', 'order', null, '{}', 'reverify audit')", [], { commit: true });
    const a = (await run("postgres", "select device_id, actor_id from control.audit_event order by seq desc limit 1")).rows[0];
    expect(a).toEqual({ device_id: sha(fx.repA.device), actor_id: fx.repA.id });
    await run({ as: "manager", device: null }, "select app.request_approval(gen_random_uuid(), 'adjustment', 'order', null, '{}', 'reverify audit')", [], { commit: true });
    expect((await run("postgres", "select device_id from control.audit_event order by seq desc limit 1")).rows[0].device_id).toBeNull();
    for (const who of [REP_A, REP_A_WRONG_DEVICE, REP_B, MANAGER, MANAGER_AAL1, OWNER_AAL1, SUSPENDED]) {
      expect((await run(who, "select count(*)::int n from control.audit_event")).rows[0].n).toBe(0);
    }
    expect(await sqlstate("service_role", "select 1 from control.audit_event limit 1")).toBe("42501");
    expect(await sqlstate("anon", "select 1 from control.audit_event limit 1")).toBe("42501");
    for (const [, who] of ALL) {
      expect(await sqlstate(who, "select 1 from control.audit_chain_head")).toBe("42501");
      expect(await sqlstate(who, "select 1 from control.doc_counter")).toBe("42501");
    }
  });

  it("no raw device id of any persona appears anywhere in this database (tables or audit log)", async () => {
    const { rows } = await run("postgres", `
      select 'audit' src, count(*)::int n from control.audit_event e, unnest($1::text[]) d
        where coalesce(e.before::text, '') like '%' || d || '%' or coalesce(e.after::text, '') like '%' || d || '%' or e.device_id = d
      union all
      select 'device', count(*)::int from public.device x, unnest($1::text[]) d where x.device_fingerprint = d`,
      [Object.values(fx).map((p) => p.device)]);
    expect(rows).toEqual([{ src: "audit", n: 0 }, { src: "device", n: 0 }]);
  });

  it("the audit chain still verifies after every attack in this file", async () => {
    const v = (await run("postgres", "select * from control.verify_audit_chain()")).rows[0];
    expect(v.ok).toBe(true);
  });
});

describe("upgrade path: a database that had devices before migration 0004", () => {
  // Builds a separate throwaway database on the same server: migrations 0001–0003, a rep
  // with an approved device who makes one audited write, then migration 0004.
  it("DEFECT CHECK: a raw device id left in append-only audit history is worthless after all migrations (B-16a, L-0040)", async () => {
    const root = resolve(import.meta.dirname, "../..");
    const migDir = join(root, "supabase", "migrations");
    const files = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
    const pre = files.filter((f) => f < "20261024232225");
    const hardening = files.find((f) => f.startsWith("20261024232225"))!;
    const baseUrl = inject("databaseUrl");
    const dbName = `kiran_reverify_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const admin = new pg.Client({ connectionString: baseUrl });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const u = new URL(baseUrl);
    u.pathname = `/${dbName}`;
    const c = new pg.Client({ connectionString: u.toString() });
    await c.connect();
    const raw = `web-${randomUUID()}`;
    try {
      const hasJwt = (await c.query("select to_regprocedure('auth.jwt()') is not null h")).rows[0].h;
      if (!hasJwt) await c.query(readFileSync(join(root, "supabase", "tests", "shim", "supabase-shim.sql"), "utf8"));
      for (const f of pre) await c.query(readFileSync(join(migDir, f), "utf8"));
      const owner = randomUUID();
      const rep = randomUUID();
      await c.query("insert into auth.users (id, email) values ($1, 'o@example.test'), ($2, 'r@example.test')", [owner, rep]);
      await c.query("select app.bootstrap_owner($1, '[Test] Owner')", [owner]);
      const as = async (id: string, aal: string, dev: string | null, sql: string, params: unknown[] = []) => {
        await c.query("begin");
        await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)",
          [JSON.stringify({ sub: id, role: "authenticated", aal }), JSON.stringify(dev ? { "x-kiran-device": dev } : {})]);
        await c.query("set local role authenticated");
        const r = await c.query(sql, params);
        await c.query("commit");
        return r;
      };
      await as(owner, "aal2", null, "select app.owner_create_user($1, '[Test] Rep', 'rep')", [rep]);
      const dev = (await as(rep, "aal1", raw, "select (app.register_device($1)).id", [raw])).rows[0].id;
      await as(owner, "aal2", null, "select app.approve_device($1, 'fixture')", [dev]);
      await as(rep, "aal1", raw, "select app.request_approval(gen_random_uuid(), 'discount', 'order', null, '{}', 'pre-0004 write')");
      // MJ approval L-0040 (B-16a): apply every migration from 0004 on, as a real upgrade would.
      for (const f of files.filter((f) => f >= "20261024232225")) await c.query(readFileSync(join(migDir, f), "utf8"));

      const chain = (await c.query("select ok from control.verify_audit_chain()")).rows[0].ok;
      expect(chain).toBe(true); // the replaced audit_row keeps the chain intact across the upgrade
      const tableRaw = (await c.query("select count(*)::int n from public.device where device_fingerprint = $1", [raw])).rows[0].n;
      expect(tableRaw).toBe(0);
      const leaks = (await c.query(`
        select seq, action, table_name,
               (coalesce(before::text, '') like '%' || $1 || '%') in_before,
               (coalesce(after::text, '')  like '%' || $1 || '%') in_after,
               (device_id = $1) in_device_id
        from control.audit_event
        where coalesce(before::text, '') like '%' || $1 || '%' or coalesce(after::text, '') like '%' || $1 || '%' or device_id = $1
        order by seq`, [raw])).rows;
      // Secure end state (MJ approval L-0040, B-16a). History is append-only and hash-chained, so a raw
      // id written before 0004 stays in it and can never be edited away ...
      expect(leaks.length).toBeGreaterThan(0);
      let editErr: string | null = null;
      try {
        await c.query("update control.audit_event set device_id = null where seq = $1", [leaks[0].seq]);
      } catch (e) {
        editErr = (e as Error).message;
      }
      expect(editErr).toMatch(/append-only/);
      // ... but the leaked id is worthless: its device is revoked, it never passes the gate, and it
      // can never be registered again.
      const devStatus = (await c.query("select status::text s from public.device where user_id = $1 order by created_at limit 1", [rep])).rows[0].s;
      expect(devStatus).toBe("revoked");
      let gateErr: string | null = null;
      try {
        await as(rep, "aal1", raw, "select app.request_approval(gen_random_uuid(), 'discount', 'order', null, '{}', 'replayed leaked id')");
      } catch (e) {
        gateErr = (e as Error).message;
        await c.query("rollback"); // this test's as() helper does not roll back on error
      }
      expect(gateErr).toMatch(/device is not approved/);
      let regErr: string | null = null;
      try {
        await as(rep, "aal1", "dev-other-phone-0001", "select app.register_device($1)", [raw]);
      } catch (e) {
        regErr = (e as Error).message;
        await c.query("rollback");
      }
      expect(regErr).toMatch(/device id revoked; generate a new one/);
      expect((await c.query("select ok from control.verify_audit_chain()")).rows[0].ok).toBe(true);
    } finally {
      await c.end();
      await admin.query(`drop database if exists ${dbName} with (force)`);
      await admin.end();
    }
  });
});
