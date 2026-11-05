/**
 * Third re-verification (ACTIVITY §7, L-0042) of P1-01 after migration 0006 (L-0037) and the
 * B-16a test updates (L-0040, L-0041). Written by the re-verifier-3 subagent, not the builder.
 * Tests named "DEFECT CHECK" state the SECURE expectation: a failure there is a defect, not a
 * broken test. Do not loosen them. Tests named "QUESTION" record observed behaviour for MJ and
 * pass either way.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  errorOf, fx, run, sqlstate, type Who,
  MANAGER, MANAGER_AAL1, OWNER, OWNER_AAL1, REP_A, REP_A_WRONG_DEVICE, REP_B, SUSPENDED,
} from "./helpers/db";

const PERSONAS: Array<[string, Who]> = [
  ["anon", "anon"], ["service_role", "service_role"], ["repA", REP_A], ["repB", REP_B],
  ["repA_wrong_device", REP_A_WRONG_DEVICE], ["manager", MANAGER], ["managerAal1", MANAGER_AAL1],
  ["owner", OWNER], ["ownerAal1", OWNER_AAL1], ["suspended", SUSPENDED],
];

const ROOT = resolve(import.meta.dirname, "../..");
const asUser = (id: string, aal: "aal1" | "aal2", device: string | null) => `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: id, role: "authenticated", aal })}', true),
         set_config('request.headers', '${JSON.stringify(device ? { "x-kiran-device": device } : {})}', true);
  set local role authenticated;`;
type Multi = Array<{ rows: Array<Record<string, any>> }>;
const pick = (r: unknown) => Object.assign({}, ...(r as Multi).filter((x) => x.rows?.length === 1 && !("set_config" in x.rows[0])).map((x) => x.rows[0]));
// A do-block that passes only if the statement is refused with the given message.
const mustRefuse = (stmt: string, msg: string, tag: string) => `
  do $$ begin ${stmt}; raise exception '${tag}_NOT_REFUSED';
  exception when insufficient_privilege then
    if sqlerrm not like '%${msg}%' then raise; end if;
  end $$;`;

describe("§7 sweep, written independently by re-verifier-3", () => {
  it("§7.2 vault: no persona reaches supplier_vault; the grant is true only for granted office at AAL2, and an owner revoke bites at once", async () => {
    for (const [k, who] of PERSONAS) {
      expect(await sqlstate(who, "select count(*) from supplier_vault.supplier"), k).toBe("42501");
    }
    const g: Record<string, unknown> = {};
    for (const [k, who] of PERSONAS) {
      try { g[k] = (await run(who, "select app.has_vault_grant() g")).rows[0].g; } catch (e) { g[k] = (e as { code: string }).code; }
    }
    expect(g).toEqual({ anon: "42501", service_role: "42501", repA: false, repB: false, repA_wrong_device: false,
      manager: true, managerAal1: false, owner: true, ownerAal1: false, suspended: false });
    const r = await run("postgres", `
      ${asUser(fx.owner.id, "aal2", null)}
      select (app.owner_set_vault_grant('${fx.manager.id}', false, 'rv3 revoke')).vault_grant v;
      ${asUser(fx.manager.id, "aal2", null)}
      select app.has_vault_grant() ungranted;`);
    expect(pick(r)).toEqual({ v: false, ungranted: false });
  });

  it("§7.3 append-only: UPDATE, DELETE and TRUNCATE are refused for every persona on every table", async () => {
    const tables: Record<string, string> = {
      "control.audit_event": "purpose", "control.audit_chain_head": "last_seq", "control.approval_request": "reason",
      "control.doc_counter": "last_no", "public.device": "label", "public.user_profile": "full_name", "public.app_config": "note",
    };
    for (const [k, who] of PERSONAS) {
      for (const [t, col] of Object.entries(tables)) {
        for (const sql of [`update ${t} set ${col} = ${col}`, `delete from ${t}`, `truncate ${t} cascade`]) {
          expect(await sqlstate(who, sql), `${k}: ${sql}`).toBe("42501");
        }
      }
    }
  });

  it("§7.4 list-dump: a rep on the approved phone sees only its own rows; it reads no salon rows (H-14)", async () => {
    // Was "salons do not exist yet" (to_regclass is null). Migration 0009 creates public.salon; reps read
    // salons only through capped functions, so the table shows them 0 rows (MJ approval L-0144).
    const r = await run(REP_A, `
      select (select count(*)::int from public.user_profile) p,
             (select count(*)::int from public.user_profile where id <> auth.uid()) p_other,
             (select count(*)::int from public.device where user_id <> auth.uid()) d_other,
             (select count(*)::int from control.approval_request where maker_id <> auth.uid()) a_other,
             (select count(*)::int from public.app_config) cfg,
             (select count(*)::int from public.salon) salon_rows`);
    expect(r.rows[0]).toEqual({ p: 1, p_other: 0, d_other: 0, a_other: 0, cfg: 0, salon_rows: 0 });
  });

  it("§7.5 approvals: nobody approves their own request; a rep cannot decide; a manager cannot decide a write-off", async () => {
    const own = (who: string, cid: string) => `
      ${asUser(who, "aal2", null)}
      select (app.request_approval('${cid}', 'adjustment', 'order', null, '{}', 'rv3 self')).id;
      select app.decide_approval((select id from control.approval_request where client_id = '${cid}'), true, 'rv3 approving my own');`;
    expect(await errorOf("postgres", own(fx.manager.id, randomUUID()))).toMatch(/maker cannot approve/);
    expect(await errorOf("postgres", own(fx.owner.id, randomUUID()))).toMatch(/maker cannot approve/);
    const cid = randomUUID();
    expect(await errorOf("postgres", `
      ${asUser(fx.manager.id, "aal2", null)}
      select (app.request_approval('${cid}', 'adjustment', 'order', null, '{}', 'rv3')).id;
      ${asUser(fx.repA.id, "aal1", fx.repA.device)}
      select app.decide_approval((select id from control.approval_request where client_id = '${cid}'), true, 'rv3 rep decides');`)).toMatch(/owner or manager only/);
    const wo = randomUUID();
    expect(await errorOf("postgres", `
      ${asUser(fx.owner.id, "aal2", null)}
      select (app.request_approval('${wo}', 'write_off', 'invoice', null, '{}', 'rv3 write-off', 'manager')).id;
      ${asUser(fx.manager.id, "aal2", null)}
      select app.decide_approval((select id from control.approval_request where client_id = '${wo}'), true, 'rv3 manager decides');`)).toMatch(/needs the owner/);
  });

  it("§7.6 replay: register_device and request_approval replayed give one row each", async () => {
    const fp = `web-${randomUUID()}`;
    const cid = randomUUID();
    const r = await run("postgres", `
      ${asUser(fx.repA.id, "aal1", fx.repA.device)}
      select (app.register_device('${fp}')).id d1;
      select (app.register_device('${fp}')).id d2;
      select (app.request_approval('${cid}', 'discount', 'order', null, '{}', 'rv3 replay')).id q1;
      select (app.request_approval('${cid}', 'discount', 'order', null, '{"changed": 1}', 'rv3 replay')).id q2;
      reset role;
      select (select count(*)::int from public.device where device_fingerprint = encode(sha256(convert_to('${fp}', 'UTF8')), 'hex')) nd,
             (select count(*)::int from control.approval_request where client_id = '${cid}') nq;`);
    const got = pick(r);
    expect(got.d1).toBe(got.d2);
    expect(got.q1).toBe(got.q2);
    expect({ nd: got.nd, nq: got.nq }).toEqual({ nd: 1, nq: 1 });
  });
});

describe("post-0006 device lifecycle (re-verifier-3)", () => {
  it("suspend then reactivate: the old id stays dead; only a fresh id, after office approval, passes the gate", async () => {
    const fresh = `web-${randomUUID()}`;
    const r = await run("postgres", `
      ${asUser(fx.owner.id, "aal2", null)}
      select (app.owner_set_status('${fx.repB.id}', 'suspended', 'rv3 lifecycle')).status::text st1;
      select (app.owner_set_status('${fx.repB.id}', 'active', 'rv3 lifecycle')).status::text st2;
      ${asUser(fx.repB.id, "aal1", fx.repB.device)}
      select app.rep_device_ok() ok_old_before;
      ${mustRefuse(`perform app.register_device('${fx.repB.device}')`, "device id revoked", "REGISTER_OLD")}
      ${asUser(fx.repB.id, "aal1", fresh)}
      select (app.register_device('${fresh}')).status::text s_fresh;
      select app.rep_device_ok() ok_fresh_pending;
      ${asUser(fx.manager.id, "aal2", null)}
      select (app.approve_device((select id from public.device where user_id = '${fx.repB.id}' and status = 'pending'), 'rv3 new phone')).status::text s_approved;
      ${asUser(fx.repB.id, "aal1", fresh)}
      select app.rep_device_ok() ok_fresh_approved, (select count(*)::int from public.device) visible;
      ${asUser(fx.repB.id, "aal1", fx.repB.device)}
      select app.rep_device_ok() ok_old_after;
      reset role;
      select count(*)::int total from public.device where user_id = '${fx.repB.id}';`);
    const { visible, total, ...got } = pick(r);
    expect(got).toEqual({
      st1: "suspended", st2: "active",
      ok_old_before: false, s_fresh: "pending", ok_fresh_pending: false, s_approved: "approved",
      ok_fresh_approved: true, ok_old_after: false,
    });
    // On the fresh approved phone rep B sees all of its own device rows (old revoked ones too; other
    // test files may have committed extra rep B rows), and nobody else's.
    expect(visible).toBe(total);
    expect(total).toBeGreaterThanOrEqual(2);
  });

  it("a role round trip (rep -> manager -> rep) does not revive a revoked id", async () => {
    const r = await run("postgres", `
      ${asUser(fx.manager.id, "aal2", null)}
      select (app.revoke_device((select id from public.device where user_id = '${fx.repA.id}' and status = 'approved'), 'rv3 reported lost')).status::text s1;
      ${asUser(fx.owner.id, "aal2", null)}
      select (app.owner_set_role('${fx.repA.id}', 'manager', 'rv3 promote')).role::text r1;
      select (app.owner_set_role('${fx.repA.id}', 'rep', 'rv3 demote')).role::text r2;
      ${asUser(fx.repA.id, "aal1", fx.repA.device)}
      ${mustRefuse(`perform app.register_device('${fx.repA.device}')`, "device id revoked", "REGISTER")}
      select app.rep_device_ok() ok;
      reset role;
      select count(*)::int n_live from public.device where user_id = '${fx.repA.id}' and status <> 'revoked';`);
    expect(pick(r)).toEqual({ s1: "revoked", r1: "manager", r2: "rep", ok: false, n_live: 0 });
  });
});

describe("§7.6 backdated client timestamps", () => {
  it("no function an app role can execute takes a client-supplied time (backdating is N/A in P1-01)", async () => {
    const { rows } = await run("postgres", `
      select distinct n.nspname || '.' || p.proname f
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace, unnest(p.proargtypes::oid[]) t
      where n.nspname in ('app', 'control', 'vault_api')
        and has_function_privilege('authenticated', p.oid, 'execute')
        and t in ('timestamptz'::regtype, 'timestamp'::regtype, 'date'::regtype, 'time'::regtype, 'timetz'::regtype)
      order by 1`);
    // owner_create_user(p_start_date date) is an HR start date, not an event time.
    // Migration 0008 (P1-04; MJ approval L-0130, H-23): office_propose_stock_issue(p_route_date) is a
    // planned route day; record_count(p_counted_at_client) and record_demand(p_captured_at_client) store
    // the phone's time as evidence only, in *_client columns, next to the server's created_at (H-09).
    // Migration 0009 (P1-02a; MJ approval L-0144): create_salon(p_created_at_client) and
    // add_salon_note(p_created_at_client) store the phone's time as evidence only (H-09).
    // Migration 0010 (P1-02 part b; MJ standing approval L-0144): log_visit(p_arrived_at_client),
    // rep_check_in(p_at_client) and rep_check_out(p_at_client) store the phone's time as evidence only.
    // Migration 0011 (P1-16): due_list(p_on), my_route(p_day), office_set_route(p_day) and
    // rep_reorder_route(p_day) take a planned day (standing approval L-0144); routes are written only for
    // today or later. office_set_last_purchase(p_last_order_on) is an office-entered opening date that
    // may not be in the future (MJ approval L-0157).
    // Migration 0012 (P1-06 part a; standing approval L-0144): create_order(p_created_at_client) stores the
    // phone's time as evidence only. Migration 0013 (P1-06 part b; L-0144): rep_deliver(p_delivered_at_client) too,
    // until migration 20261105130100 (D-32) revoked its grant; its replacement is listed below.
    // Migration 20261104090000 (D-30) keeps create_order's signature, so it stays listed, but it refuses every caller.
    // Migration 0021 (P1-07 part a; standing approval L-0144): rep_record_payment(p_recorded_at_client) stores the
    // phone's time as evidence only, in recorded_at_client, next to the server's recorded_at (H-09); a test in
    // payments.test.ts proves recorded_at is database time whatever the phone sends.
    // Migration 20261105130100 (D-32 PR B; L-0144): rep_submit_delivery(p_submitted_at_client) stores the phone's time
    // as evidence only, in submitted_at_client, next to the server's submitted_at.
    // Migration 20261105140000 (slice 5, P1-22; L-0144): my_commission(p_from, p_to), office_commission(p_rep_id,
    // p_from, p_to) and office_commission_reps(p_from, p_to) take a date range to read; they write nothing.
    // Migration 20261105120000 (slice 3, P1-20, D-40; standing approval L-0144): office_add_investment(p_invested_on),
    // office_decide_profit(p_decided_on) and office_record_payout(p_paid_on) take an office-entered business date that
    // may not be in the future (Karachi) and is kept next to the server's created_at; reversals are dated by the server.
    // office_investor_statement(p_from, p_to) is a read filter. investors.test.ts proves the future refusal.
    expect(rows.map((x) => x.f)).toEqual([
      "app.add_salon_note", "app.create_order", "app.create_salon", "app.due_list", "app.log_visit", "app.my_commission",
      "app.my_route", "app.office_add_investment", "app.office_commission", "app.office_commission_reps",
      "app.office_decide_profit", "app.office_investor_statement", "app.office_propose_stock_issue",
      "app.office_record_payout", "app.office_set_last_purchase", "app.office_set_route", "app.owner_create_user",
      "app.record_count", "app.record_demand", "app.rep_check_in", "app.rep_check_out", "app.rep_record_payment",
      "app.rep_reorder_route", "app.rep_submit_delivery"]);
  });
});

describe("QUESTION (not a defect): what the table owner can still do", () => {
  it("TRUNCATE by the table owner empties approval_request and device without an audit row; the chain still verifies", async () => {
    const r = await run("postgres", `
      ${asUser(fx.repA.id, "aal1", fx.repA.device)}
      select (app.request_approval(gen_random_uuid(), 'discount', 'order', null, '{}', 'rv3 row to truncate')).status::text s0;
      reset role;
      select count(*)::int a0, (select count(*)::int from control.approval_request) q0, (select count(*)::int from public.device) d0 from control.audit_event;
      truncate public.device;
      select count(*)::int a1, (select count(*)::int from control.approval_request) q1, (select count(*)::int from public.device) d1 from control.audit_event;
      select ok from control.verify_audit_chain();`);
    const got = pick(r);
    // Observed 2026-10-25 (rolled back): both tables emptied, 0 audit rows written, chain ok.
    // The owner can also DISABLE TRIGGER on any table it owns, so this adds no new capability;
    // detection relies on the off-site audit mirror (doc 06 §6). Recorded for MJ only.
    console.log("rv3 owner TRUNCATE:", JSON.stringify(got));
    expect(typeof got.ok).toBe("boolean");
    // Since migration 0008 (P1-04) stock_movement.approval_id references approval_request, so the
    // table owner can no longer TRUNCATE approval_request (0A000) (MJ approval L-0130, H-23).
    expect(await sqlstate("postgres", "truncate control.approval_request")).toBe("0A000");
  });

  it("a pending request stays decidable after its maker is suspended", async () => {
    const cid = randomUUID();
    let res: string;
    try {
      const r = await run("postgres", `
        ${asUser(fx.repA.id, "aal1", fx.repA.device)}
        select (app.request_approval('${cid}', 'discount', 'order', null, '{}', 'rv3 maker later suspended')).id;
        ${asUser(fx.owner.id, "aal2", null)}
        select app.owner_set_status('${fx.repA.id}', 'suspended', 'rv3');
        ${asUser(fx.manager.id, "aal2", null)}
        select (app.decide_approval((select id from control.approval_request where client_id = '${cid}'), true, 'rv3 approve')).status::text st;`);
      res = pick(r).st;
    } catch (e) {
      res = `refused: ${(e as Error).message}`;
    }
    // Observed 2026-10-25: "approved". No doc requires otherwise; recorded for MJ only.
    console.log("rv3 decide after maker suspended:", res);
    expect(typeof res).toBe("string");
  });
});

describe("apps/web device-id rotation (client half of L-0037)", () => {
  // Runs the real apps/web/lib/supabase/browser.ts (transpiled with the repo's TypeScript)
  // against the installed @supabase/ssr, in a separate node process with a minimal browser
  // stub and a fetch stub that records requests. Nothing leaves the machine.
  it("DEFECT CHECK: after rotateDeviceId() the rep client sends the NEW id in x-kiran-device", () => {
    const ssr = join(ROOT, "apps", "web", "node_modules", "@supabase", "ssr", "dist", "main", "index.js");
    expect(existsSync(ssr), "apps/web dependencies must be installed").toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "kiran-rv3-"));
    try {
      writeFileSync(join(dir, "env.mjs"), "export const SUPABASE_URL = 'http://127.0.0.1:1';\nexport const SUPABASE_ANON_KEY = 'placeholder-anon';\n");
      writeFileSync(join(dir, "probe.mjs"), `
        import { createRequire } from "node:module";
        import { readFileSync, writeFileSync } from "node:fs";
        import { pathToFileURL } from "node:url";
        const root = ${JSON.stringify(ROOT)};
        const ts = createRequire(root + "/package.json")("typescript");
        const store = new Map();
        globalThis.window = { document: { cookie: "" }, localStorage: {
          getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
        globalThis.document = globalThis.window.document;
        const sent = [];
        globalThis.fetch = async (url, init = {}) => {
          sent.push({ path: new URL(String(url)).pathname, device: new Headers(init.headers).get("x-kiran-device"), body: init.body ?? null });
          return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
        };
        let src = readFileSync(root + "/apps/web/lib/supabase/browser.ts", "utf8")
          .replace('"@/lib/env"', JSON.stringify(pathToFileURL(${JSON.stringify(join(dir, "env.mjs"))}).href))
          .replace('"@supabase/ssr"', JSON.stringify(pathToFileURL(${JSON.stringify(ssr)}).href));
        const out = ${JSON.stringify(join(dir, "browser.mjs"))};
        writeFileSync(out, ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
        const { deviceId, rotateDeviceId, supabaseBrowser } = await import(pathToFileURL(out).href);
        const first = supabaseBrowser();          // app/app/page.tsx (or the login page) builds the client
        const oldId = deviceId();
        rotateDeviceId();                          // page.tsx: my_session reported "revoked"
        const client = supabaseBrowser();
        const newId = deviceId();
        await client.schema("app").rpc("register_device", { p_fingerprint: newId, p_platform: "rv3", p_label: null });
        await client.schema("app").rpc("my_session");
        console.log(JSON.stringify({ oldId, newId, sameClient: first === client, rest: sent.filter((s) => s.path.includes("/rest/")) }));
        process.exit(0);
      `);
      const p = spawnSync(process.execPath, [join(dir, "probe.mjs")], { encoding: "utf8", timeout: 60_000 });
      expect(p.status, p.stderr).toBe(0);
      const got = JSON.parse(p.stdout.trim().split("\n").pop()!);
      console.log("rv3 rotation probe:", JSON.stringify(got));
      expect(got.oldId).not.toBe(got.newId);                               // the id in localStorage did rotate
      expect(got.rest.map((s: { path: string }) => s.path)).toEqual(["/rest/v1/rpc/register_device", "/rest/v1/rpc/my_session"]);
      // Secure/working expectation (browser.ts: "rebuild the client so the new header is sent"):
      // every request after the rotation carries the new id, not the revoked one.
      expect(got.rest.map((s: { device: string }) => s.device)).toEqual([got.newId, got.newId]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
