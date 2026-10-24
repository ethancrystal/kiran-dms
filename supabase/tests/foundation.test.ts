/**
 * P1-01 foundation behaviour: audit chain (SEC-05/12, H-17), append-only (H-06),
 * maker ≠ checker (SEC-11, H-12), device binding (SEC-03/04), governance is owner-only
 * at AAL2 (H-15), gapless numbering (ADM-03, H-11), idempotency (H-08).
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  errorOf, fx, run, sqlstate,
  MANAGER, MANAGER_AAL1, OWNER, OWNER_AAL1, REP_A, REP_A_WRONG_DEVICE, REP_B, SUSPENDED,
} from "./helpers/db";

const verify = async () => (await run("postgres", "select * from control.verify_audit_chain()")).rows[0];

describe("audit chain (SEC-05, SEC-12, H-17)", () => {
  it("verifies after fixtures were created", async () => {
    const v = await verify();
    expect(v.ok).toBe(true);
    expect(Number(v.checked)).toBeGreaterThan(5);
  });

  it("records actor, role and purpose for a function call and still verifies", async () => {
    const before = Number((await verify()).checked);
    await run(OWNER, "select app.owner_set_config('test.audit_probe', '1'::jsonb, 'audit probe')", [], { commit: true });
    const { rows } = await run("postgres",
      "select actor_id, actor_role, purpose, table_name, action from control.audit_event order by seq desc limit 1");
    expect(rows[0]).toMatchObject({
      actor_id: fx.owner.id, actor_role: "owner", table_name: "public.app_config", action: "INSERT",
      purpose: "config test.audit_probe: audit probe",
    });
    const v = await verify();
    expect(v.ok).toBe(true);
    expect(Number(v.checked)).toBe(before + 1);
  });

  it("detects tampering with an existing audit row", async () => {
    // Simulates someone with table-owner rights bypassing the append-only trigger.
    const c = await run("postgres", `
      do $$ begin
        alter table control.audit_event disable trigger audit_event_append_only;
        update control.audit_event set purpose = 'tampered' where seq = 1;
        alter table control.audit_event enable trigger audit_event_append_only;
      end $$;
      select ok, first_bad_seq from control.verify_audit_chain();
    `) as unknown as Array<{ rows: Array<{ ok: boolean; first_bad_seq: string }> }>;
    const res = c[1].rows[0];
    expect(res.ok).toBe(false);
    expect(Number(res.first_bad_seq)).toBe(1);
    expect((await verify()).ok).toBe(true); // the transaction was rolled back
  });

  it("audit_event is append-only even for postgres (UPDATE, DELETE, TRUNCATE)", async () => {
    expect(await errorOf("postgres", "update control.audit_event set purpose = 'x' where seq = 1")).toMatch(/append-only/);
    expect(await errorOf("postgres", "delete from control.audit_event where seq = 1")).toMatch(/append-only/);
    expect(await errorOf("postgres", "truncate control.audit_event")).toMatch(/append-only/);
  });

  it("no application role can execute the audit or verification functions", async () => {
    expect(await sqlstate(OWNER, "select * from control.verify_audit_chain()")).toBe("42501");
    expect(await sqlstate(REP_A, "select control.audit_canonical(1, now(), null, null, null, 'INSERT', 't', null, null, null, null, null, null)")).toBe("42501");
  });
});

describe("hard deletes are impossible (H-07)", () => {
  it.each([
    ["public.user_profile", "users are offboarded"],
    ["public.device", "no hard deletes"],
  ])("postgres cannot delete from %s", async (table, msg) => {
    expect(await errorOf("postgres", `delete from ${table}`)).toMatch(new RegExp(msg));
  });

  it("postgres cannot delete from control.approval_request", async () => {
    // Make sure a row exists in the same transaction so the row trigger fires.
    expect(await errorOf("postgres", `
      insert into control.approval_request (client_id, kind, subject_type, maker_id, checker_role_required, reason)
      values (gen_random_uuid(), 'discount', 'order', '${fx.repA.id}', 'manager', 'probe');
      delete from control.approval_request;`)).toMatch(/never deleted/);
  });
});

describe("governance is owner-only and needs AAL2 (H-15, doc 06 §2)", () => {
  const newUser = async () => {
    const id = randomUUID();
    await run("postgres", "insert into auth.users (id) values ($1)", [id], { commit: true });
    return id;
  };

  it("manager cannot create users", async () => {
    const id = await newUser();
    expect(await errorOf(MANAGER, "select app.owner_create_user($1, '[Test] X', 'rep')", [id])).toMatch(/owner only/);
  });

  it("owner without MFA (AAL1) cannot create users", async () => {
    const id = await newUser();
    expect(await errorOf(OWNER_AAL1, "select app.owner_create_user($1, '[Test] X', 'rep')", [id])).toMatch(/AAL2/);
  });

  it("owner at AAL2 can create a user; replay is idempotent", async () => {
    const id = await newUser();
    await run(OWNER, "select app.owner_create_user($1, '[Test] Rep C', 'rep')", [id], { commit: true });
    await run(OWNER, "select app.owner_create_user($1, '[Test] Rep C', 'rep')", [id], { commit: true });
    const { rows } = await run("postgres", "select count(*)::int n, bool_or(vault_grant) g from public.user_profile where id = $1", [id]);
    expect(rows[0]).toEqual({ n: 1, g: false });
  });

  it("managers get the vault grant by default (VLT-06); reps can never hold it", async () => {
    const { rows } = await run("postgres", "select vault_grant from public.user_profile where id = $1", [fx.manager.id]);
    expect(rows[0].vault_grant).toBe(true);
    expect(await sqlstate(OWNER, "select app.owner_set_vault_grant($1, true, 'try')", [fx.repA.id])).toBe("23514");
  });

  it("vault grant: owner AAL2 yes, manager with grant yes, manager AAL1 no, rep no", async () => {
    const g = async (w: Parameters<typeof run>[0]) => (await run(w, "select app.has_vault_grant() g")).rows[0].g;
    expect(await g(OWNER)).toBe(true);
    expect(await g(MANAGER)).toBe(true);
    expect(await g(MANAGER_AAL1)).toBe(false);
    expect(await g(REP_A)).toBe(false);
  });

  it("revoking the manager's vault grant takes effect on the next request (doc 07 §5.6)", async () => {
    const out = await run(OWNER, `
      select app.owner_set_vault_grant('${fx.manager.id}', false, 'test revoke');
    `);
    expect(out.rowCount).toBe(1);
    // In one transaction: revoke, then check as the manager.
    const r = await run("postgres", `
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.owner.id, role: "authenticated", aal: "aal2" })}', true);
      set local role authenticated;
      select app.owner_set_vault_grant('${fx.manager.id}', false, 'test revoke');
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.manager.id, role: "authenticated", aal: "aal2" })}', true);
      select app.has_vault_grant() as g;
    `) as unknown as Array<{ rows: Array<{ g: boolean }> }>;
    expect(r[r.length - 1].rows[0].g).toBe(false);
  });

  it("only the owner may change configuration", async () => {
    expect(await errorOf(MANAGER, "select app.owner_set_config('cash.intraday_cap_paisa', '1'::jsonb, 'x y z')")).toMatch(/owner only/);
    expect(await errorOf(REP_A, "select app.owner_set_config('cash.intraday_cap_paisa', '1'::jsonb, 'x y z')")).toMatch(/owner only/);
  });

  it("owner cannot change their own role or status", async () => {
    expect(await errorOf(OWNER, "select app.owner_set_role($1, 'manager', 'nope')", [fx.owner.id])).toMatch(/own role/);
    expect(await errorOf(OWNER, "select app.owner_set_status($1, 'suspended', 'nope')", [fx.owner.id])).toMatch(/own status/);
  });

  it("the bootstrap function is not callable by any application role and refuses a second owner", async () => {
    expect(await sqlstate(OWNER, "select app.bootstrap_owner(gen_random_uuid(), 'x')")).toBe("42501");
    expect(await errorOf("postgres", "select app.bootstrap_owner(gen_random_uuid(), 'x')")).toMatch(/owner already exists/);
  });
});

describe("device binding (SEC-03, SEC-04)", () => {
  it("a rep on an unapproved device cannot act", async () => {
    expect(await errorOf(REP_A_WRONG_DEVICE, `select app.request_approval(gen_random_uuid(), 'discount', 'order', null, '{}', 'please')`))
      .toMatch(/device is not approved/);
  });

  it("a suspended rep cannot act, and their devices were revoked", async () => {
    expect(await errorOf(SUSPENDED, `select app.request_approval(gen_random_uuid(), 'discount', 'order', null, '{}', 'please')`))
      .toMatch(/no active user profile/);
    const { rows } = await run("postgres", "select status from public.device where user_id = $1", [fx.suspendedRep.id]);
    expect(rows.every((r) => r.status === "revoked")).toBe(true);
  });

  it("a new device starts pending; a rep cannot approve it; approval replaces the old device", async () => {
    const fp = `dev-${randomUUID()}`;
    const reg = await run({ as: "repB", device: fp }, "select (app.register_device($1, 'android', 'new phone')).*", [fp], { commit: true });
    expect(reg.rows[0].status).toBe("pending");
    expect(await errorOf(REP_A, "select app.approve_device($1, 'x')", [reg.rows[0].id])).toMatch(/owner or manager only/);

    // Approve and check in the same (rolled-back) transaction so shared fixtures stay intact.
    const r = await run("postgres", `
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.manager.id, role: "authenticated", aal: "aal2" })}', true);
      set local role authenticated;
      select app.approve_device('${reg.rows[0].id}', 'new phone');
      reset role;
      select device_fingerprint, status from public.device where user_id = '${fx.repB.id}' order by created_at;
    `) as unknown as Array<{ rows: Array<{ device_fingerprint: string; status: string }> }>;
    const devices = r[r.length - 1].rows;
    expect(devices.filter((d) => d.status === "approved").map((d) => d.device_fingerprint)).toEqual([fp]);
    expect(devices.find((d) => d.device_fingerprint === fx.repB.device)?.status).toBe("revoked");
  });

  it("registering the same device twice is idempotent", async () => {
    const a = await run(REP_A, "select (app.register_device($1)).id", [fx.repA.device]);
    const b = await run(REP_A, "select (app.register_device($1)).id", [fx.repA.device]);
    expect(a.rows[0].id).toBe(b.rows[0].id);
  });
});

describe("maker ≠ checker (SEC-11, H-12)", () => {
  const request = async (who: Parameters<typeof run>[0], kind: string, checker = "manager") => {
    const cid = randomUUID();
    const { rows } = await run(who,
      `select (app.request_approval($1, $2::public.approval_kind, 'order', null, '{"pct": 5}', 'test request', $3::public.app_role)).*`,
      [cid, kind, checker], { commit: true });
    return rows[0];
  };

  it("idempotent: the same client_id returns the same request, one row", async () => {
    const cid = randomUUID();
    const sql = `select (app.request_approval($1, 'discount', 'order', null, '{}', 'twice')).id`;
    const a = await run(REP_A, sql, [cid], { commit: true });
    const b = await run(REP_A, sql, [cid], { commit: true });
    expect(a.rows[0].id).toBe(b.rows[0].id);
    expect((await run("postgres", "select count(*)::int n from control.approval_request where client_id = $1", [cid])).rows[0].n).toBe(1);
    expect(await sqlstate(REP_B, sql, [cid])).toBe("23505");
  });

  it("a rep cannot request owner-level kinds, and cannot decide anything", async () => {
    expect(await errorOf(REP_A, `select app.request_approval(gen_random_uuid(), 'write_off', 'invoice', null, '{}', 'x y z')`)).toMatch(/reps may only/);
    const req = await request(REP_A, "discount");
    expect(await errorOf(REP_B, "select app.decide_approval($1, true, 'ok by me')", [req.id])).toMatch(/owner or manager only/);
  });

  it("the maker can never approve their own request, even the owner", async () => {
    const m = await request(MANAGER, "credit_override");
    expect(await errorOf(MANAGER, "select app.decide_approval($1, true, 'self')", [m.id])).toMatch(/maker cannot approve/);
    const o = await request(OWNER, "credit_override");
    expect(await errorOf(OWNER, "select app.decide_approval($1, true, 'self')", [o.id])).toMatch(/maker cannot approve/);
  });

  it("the database constraint holds even for a direct write by postgres", async () => {
    const m = await request(MANAGER, "credit_override");
    expect(await sqlstate("postgres",
      `update control.approval_request set status = 'approved', checker_id = maker_id, decided_at = now(), decision_reason = 'bypass' where id = $1`,
      [m.id])).toBe("23514");
  });

  it("write-offs always need the owner; a manager cannot decide them", async () => {
    const w = await request(MANAGER, "write_off", "manager");
    expect(w.checker_role_required).toBe("owner");
    expect(await errorOf(MANAGER_AAL1, "select app.decide_approval($1, true, 'x y z')", [w.id])).toMatch(/AAL2/);
    const r = await run(OWNER, "select (app.decide_approval($1, true, 'approved by owner')).*", [w.id], { commit: true });
    expect(r.rows[0]).toMatchObject({ status: "approved", checker_id: fx.owner.id });
  });

  it("a decided request cannot be decided again or edited", async () => {
    const req = await request(REP_A, "discount");
    await run(MANAGER, "select app.decide_approval($1, false, 'not this time')", [req.id], { commit: true });
    expect(await errorOf(OWNER, "select app.decide_approval($1, true, 'override')", [req.id])).toMatch(/already decided/);
    expect(await errorOf("postgres", "update control.approval_request set reason = 'edited' where id = $1", [req.id])).toMatch(/already decided/);
  });

  it("a decision needs a reason", async () => {
    const req = await request(REP_A, "discount");
    expect(await sqlstate(MANAGER, "select app.decide_approval($1, true, '')", [req.id])).toBe("23514");
  });
});

describe("gapless numbering per financial year (ADM-03, H-11)", () => {
  it("fiscal year rolls over on 1 July", async () => {
    const { rows } = await run("postgres",
      "select app.fiscal_year('2026-06-30') a, app.fiscal_year('2026-07-01') b, app.fiscal_year('2099-12-31') c");
    expect(rows[0]).toEqual({ a: 26, b: 27, c: 0 });
  });

  it("numbers are sequential and a rolled-back issue leaves no gap", async () => {
    const r = await run("postgres", "select app.next_doc_number('INV') a, app.next_doc_number('INV') b, app.fiscal_year((now() at time zone 'Asia/Karachi')::date) fy");
    const fy = String(r.rows[0].fy).padStart(2, "0");
    expect(r.rows[0].a).toBe(`INV-${fy}-000001`);
    expect(r.rows[0].b).toBe(`INV-${fy}-000002`);
    // previous transaction rolled back → the counter did too
    const again = await run("postgres", "select app.next_doc_number('INV') a");
    expect(again.rows[0].a).toBe(`INV-${fy}-000001`);
  });

  it("application roles cannot draw numbers directly", async () => {
    expect(await sqlstate(OWNER, "select app.next_doc_number('INV')")).toBe("42501");
    expect(await sqlstate(REP_A, "select app.next_doc_number('R')")).toBe("42501");
  });
});

describe("configuration defaults (P0-08, ADM-01)", () => {
  const KEYS = ["plan.templates", "credit.rules", "collections.escalation_days", "catalogue.product_groups",
    "visit.outcomes", "salon.types", "pipeline.timers", "map.discovery_radius_m"];

  it("every default is present and flagged [default-unconfirmed]", async () => {
    const { rows } = await run("postgres", "select key, note from public.app_config where key = any($1)", [KEYS]);
    expect(rows.map((r) => r.key).sort()).toEqual([...KEYS].sort());
    expect(rows.every((r) => String(r.note).startsWith("[default-unconfirmed]"))).toBe(true);
  });

  it("installment plan schedules each add up to 100%", async () => {
    const { rows } = await run("postgres", `
      select t->>'code' code, sum((s->>'pct')::numeric) total
      from public.app_config, jsonb_array_elements(value) t, jsonb_array_elements(t->'schedule') s
      where key = 'plan.templates' group by 1`);
    expect(rows.length).toBe(3);
    expect(rows.every((r) => Number(r.total) === 100)).toBe(true);
  });

  it("reps see the operational lists but not credit rules or thresholds", async () => {
    const { rows } = await run(REP_A, "select key from public.app_config order by key");
    expect(rows.map((r) => r.key)).toEqual(
      ["catalogue.product_groups", "map.discovery_radius_m", "plan.templates", "salon.types", "visit.outcomes"]);
  });
});
