/**
 * Independent verifier attacks (ACTIVITY §7) on P1-01 / P0-06 / P0-08.
 * Written by the verifier, not the builder. Every test states the SECURE expectation:
 * a failing test here is a defect, not a broken test. Do not loosen these to make them pass.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  errorOf, fx, run, sqlstate, type Who,
  MANAGER, MANAGER_AAL1, OWNER, OWNER_AAL1, REP_A, REP_A_WRONG_DEVICE, REP_B, SUSPENDED,
} from "./helpers/db";

const APP_ROLES: Array<[string, Who]> = [
  ["anon", "anon"], ["service_role", "service_role"], ["repA", REP_A], ["repB", REP_B],
  ["repA_wrong_device", REP_A_WRONG_DEVICE], ["manager", MANAGER], ["managerAal1", MANAGER_AAL1],
  ["owner", OWNER], ["ownerAal1", OWNER_AAL1], ["suspended", SUSPENDED],
];

const verify = async () => (await run("postgres", "select * from control.verify_audit_chain()")).rows[0];

describe("§7.5 approvals: self-approval and tampering", () => {
  const request = async (who: Who, kind: string, checker = "manager") => {
    const { rows } = await run(who,
      `select (app.request_approval($1, $2::public.approval_kind, 'order', null, '{}', 'verifier probe', $3::public.app_role)).*`,
      [randomUUID(), kind, checker], { commit: true });
    return rows[0];
  };

  it("rep B cannot read rep A's approval requests (matrix test is vacuous without rows)", async () => {
    const a = await request(REP_A, "discount");
    const { rows } = await run(REP_B, "select id from control.approval_request where id = $1", [a.id]);
    expect(rows).toEqual([]);
    const own = await run(REP_A, "select id from control.approval_request where id = $1", [a.id]);
    expect(own.rows.length).toBe(1);
  });

  it("replaying someone else's client_id is refused and does not return their row", async () => {
    const cid = randomUUID();
    await run(REP_A, "select app.request_approval($1, 'discount', 'order', null, '{}', 'mine')", [cid], { commit: true });
    expect(await sqlstate(REP_B, "select app.request_approval($1, 'discount', 'order', null, '{}', 'steal')", [cid])).toBe("23505");
    expect(await sqlstate(MANAGER, "select app.request_approval($1, 'discount', 'order', null, '{}', 'steal')", [cid])).toBe("23505");
  });

  it("nobody approves their own request (manager, owner) and AAL1 cannot decide", async () => {
    const m = await request(MANAGER, "adjustment");
    expect(await errorOf(MANAGER, "select app.decide_approval($1, true, 'self ok')", [m.id])).toMatch(/maker cannot approve/);
    expect(await errorOf(MANAGER, "select app.decide_approval($1, false, 'self reject')", [m.id])).toMatch(/maker cannot approve/);
    const r = await request(REP_A, "discount");
    expect(await errorOf(MANAGER_AAL1, "select app.decide_approval($1, true, 'aal1 try')", [r.id])).toMatch(/AAL2/);
    expect(await errorOf(OWNER_AAL1, "select app.decide_approval($1, true, 'aal1 try')", [r.id])).toMatch(/AAL2/);
    expect(await errorOf(REP_A, "select app.decide_approval($1, true, 'rep self')", [r.id])).toMatch(/owner or manager only/);
  });

  it("a manager cannot decide an owner-level request; requesting with checker 'rep' is lifted to manager", async () => {
    const w = await request(OWNER, "write_off", "manager");
    expect(w.checker_role_required).toBe("owner");
    expect(await errorOf(MANAGER, "select app.decide_approval($1, true, 'mgr try')", [w.id])).toMatch(/owner's decision/);
    const x = await request(REP_A, "discount", "rep");
    expect(x.checker_role_required).toBe("manager");
  });

  it("checker_role_required cannot be lowered, and a decided row cannot be re-decided, even by postgres", async () => {
    const o = await request(MANAGER, "adjustment", "owner");
    expect(await errorOf("postgres",
      "update control.approval_request set checker_role_required = 'manager' where id = $1", [o.id])).toMatch(/immutable/);
    expect(await errorOf("postgres",
      "update control.approval_request set maker_id = $2 where id = $1", [o.id, fx.repA.id])).toMatch(/immutable/);
    await run(OWNER, "select app.decide_approval($1, false, 'owner rejects')", [o.id], { commit: true });
    expect(await errorOf("postgres",
      "update control.approval_request set status = 'approved', decision_reason = 'flip' where id = $1", [o.id])).toMatch(/already decided/);
    expect(await errorOf(OWNER, "select app.decide_approval($1, true, 'flip')", [o.id])).toMatch(/already decided/);
  });

  it("a decided request cannot be cancelled by its maker; nobody else can cancel", async () => {
    const r = await request(REP_A, "discount");
    expect(await errorOf(REP_B, "select app.cancel_approval($1, 'not mine')", [r.id])).toMatch(/only the maker/);
    expect(await errorOf(MANAGER, "select app.cancel_approval($1, 'not mine')", [r.id])).toMatch(/only the maker/);
    await run(MANAGER, "select app.decide_approval($1, true, 'approved')", [r.id], { commit: true });
    expect(await errorOf(REP_A, "select app.cancel_approval($1, 'undo')", [r.id])).toMatch(/already decided/);
  });

  it("no app role (incl. service_role) can write approval_request directly", async () => {
    for (const [, who] of APP_ROLES) {
      expect(await sqlstate(who, `insert into control.approval_request (client_id, kind, subject_type, maker_id, checker_role_required, reason)
        values (gen_random_uuid(), 'discount', 'order', '${fx.repA.id}', 'manager', 'direct')`)).toBe("42501");
    }
  });

  it("created_at is server time; a caller cannot backdate a request (§7.6)", async () => {
    const r = await request(REP_A, "discount");
    const { rows } = await run("postgres", "select abs(extract(epoch from (now() - created_at))) < 120 fresh from control.approval_request where id = $1", [r.id]);
    expect(rows[0].fresh).toBe(true);
  });
});

describe("§7.6 replay of an offline mutation", () => {
  it("replaying request_approval and decide_approval yields one effect each", async () => {
    const cid = randomUUID();
    const sql = "select (app.request_approval($1, 'payment_reversal', 'payment', null, '{}', 'replay')).id";
    const a = (await run(REP_A, sql, [cid], { commit: true })).rows[0].id;
    const b = (await run(REP_A, sql, [cid], { commit: true })).rows[0].id;
    expect(a).toBe(b);
    const before = Number((await verify()).checked);
    await run(MANAGER, "select app.decide_approval($1, true, 'ok replay')", [a], { commit: true });
    await run(MANAGER, "select app.decide_approval($1, true, 'ok replay')", [a], { commit: true });
    const after = Number((await verify()).checked);
    expect(after - before).toBe(1); // one UPDATE audited, the replay wrote nothing
    expect(await errorOf(MANAGER, "select app.decide_approval($1, false, 'opposite')", [a])).toMatch(/already decided/);
  });
});

describe("device binding (SEC-03, doc 04 invariant 7)", () => {
  it("an office user cannot approve their own device", async () => {
    const fp = `dev-${randomUUID()}`;
    const d = await run(MANAGER, "select (app.register_device($1)).id", [fp], { commit: true });
    expect(await errorOf(MANAGER, "select app.approve_device($1, 'self')", [d.rows[0].id])).toMatch(/your own device/);
    const fo = `dev-${randomUUID()}`;
    const o = await run(OWNER, "select (app.register_device($1)).id", [fo], { commit: true });
    expect(await errorOf(OWNER, "select app.approve_device($1, 'self')", [o.rows[0].id])).toMatch(/your own device/);
  });

  it("a rep cannot approve or revoke another rep's device; a suspended rep cannot register", async () => {
    const { rows } = await run("postgres", "select id from public.device where user_id = $1 and status = 'approved'", [fx.repB.id]);
    expect(await errorOf(REP_A, "select app.revoke_device($1, 'grief')", [rows[0].id])).toMatch(/device owner or the office/);
    expect(await errorOf(REP_A, "select app.approve_device($1, 'x')", [rows[0].id])).toMatch(/owner or manager only/);
    expect(await errorOf(SUSPENDED, "select app.register_device($1)", [`dev-${randomUUID()}`])).toMatch(/no active user profile/);
  });

  it("DEFECT CHECK: a rep on an unapproved device must not be able to read the approved device fingerprint", async () => {
    // The fingerprint (x-kiran-device, a localStorage UUID) is the only proof of device.
    const { rows } = await run(REP_A_WRONG_DEVICE,
      "select device_fingerprint from public.device where status = 'approved'");
    expect(rows.map((r) => r.device_fingerprint)).not.toContain(fx.repA.device);
  });

  it("DEFECT CHECK: reading the fingerprint and replaying it as the header must not pass the device gate", async () => {
    // Step 1: from the unapproved phone, read the approved fingerprint through RLS.
    const leaked = (await run(REP_A_WRONG_DEVICE,
      "select device_fingerprint from public.device where status = 'approved' limit 1")).rows[0]?.device_fingerprint ?? null;
    // Step 2: same session, header set to the leaked value: the gate should still refuse.
    const err = await errorOf({ as: "repA", device: leaked },
      "select app.request_approval(gen_random_uuid(), 'discount', 'order', null, '{}', 'from stolen session')");
    // err === null means the stolen-session write SUCCEEDED from the unapproved phone.
    expect(err ?? "SUCCEEDED: request_approval accepted with the leaked fingerprint").toMatch(/device is not approved/);
    expect(leaked).toBeNull();
  });

  it("DEFECT CHECK: rep sessions from an unapproved device are rejected for reads too (doc 04 inv. 7)", async () => {
    const n = async (sql: string) => (await run(REP_A_WRONG_DEVICE, sql)).rows[0].n as number;
    expect({
      user_profile: await n("select count(*)::int n from public.user_profile"),
      device: await n("select count(*)::int n from public.device"),
      app_config: await n("select count(*)::int n from public.app_config"),
    }).toEqual({ user_profile: 0, device: 0, app_config: 0 });
  });
});

describe("§7.2 vault: no path for a rep or an un-granted manager", () => {
  it("supplier_vault is unreachable for every app role; vault_api has no functions yet", async () => {
    for (const [, who] of APP_ROLES) {
      expect(await sqlstate(who, "select count(*) from supplier_vault.anything")).toBe("42501");
    }
    const { rows } = await run("postgres",
      "select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'vault_api'");
    expect(rows[0].n).toBe(0);
  });

  it("has_vault_grant is false for reps, AAL1 office, suspended, and a manager right after revoke", async () => {
    for (const who of [REP_A, REP_A_WRONG_DEVICE, MANAGER_AAL1, OWNER_AAL1, SUSPENDED]) {
      expect((await run(who, "select app.has_vault_grant() g")).rows[0].g).toBe(false);
    }
    const r = await run("postgres", `
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.owner.id, role: "authenticated", aal: "aal2" })}', true);
      set local role authenticated;
      select app.owner_set_vault_grant('${fx.manager.id}', false, 'verifier revoke');
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.manager.id, role: "authenticated", aal: "aal2" })}', true);
      select app.has_vault_grant() g;`) as unknown as Array<{ rows: Array<{ g: boolean }> }>;
    expect(r[r.length - 1].rows[0].g).toBe(false);
  });

  it("a manager cannot grant themselves the vault or escalate role", async () => {
    expect(await errorOf(MANAGER, "select app.owner_set_vault_grant($1, true, 'self grant')", [fx.manager.id])).toMatch(/owner only/);
    expect(await errorOf(MANAGER, "select app.owner_set_role($1, 'owner', 'self promote')", [fx.manager.id])).toMatch(/owner only/);
    expect(await errorOf(OWNER_AAL1, "select app.owner_set_role($1, 'owner', 'aal1 promote')", [fx.manager.id])).toMatch(/AAL2/);
    expect(await errorOf(OWNER_AAL1, "select app.owner_set_vault_grant($1, false, 'aal1')", [fx.manager.id])).toMatch(/AAL2/);
    expect(await errorOf(MANAGER, "select app.owner_set_status($1, 'active', 'unsuspend')", [fx.suspendedRep.id])).toMatch(/owner only/);
  });
});

describe("§7.3 append-only and direct writes as every app role", () => {
  const TABLES: Array<[string, string]> = [
    ["public.user_profile", "full_name"], ["public.device", "label"], ["public.app_config", "note"],
    ["control.approval_request", "reason"], ["control.audit_event", "purpose"],
    ["control.audit_chain_head", "last_hash"], ["control.doc_counter", "last_no"],
  ];
  it("INSERT/UPDATE/DELETE/TRUNCATE refused for every app role on every table", async () => {
    for (const [, who] of APP_ROLES) {
      for (const [t, col] of TABLES) {
        expect(await sqlstate(who, `update ${t} set ${col} = ${col}`)).toBe("42501");
        expect(await sqlstate(who, `delete from ${t}`)).toBe("42501");
        expect(await sqlstate(who, `truncate ${t}`)).toBe("42501");
      }
    }
  });

  it("service_role cannot forge an audit row or move the chain head", async () => {
    expect(await sqlstate("service_role", `insert into control.audit_event (seq, occurred_at, action, table_name, prev_hash, hash)
      values (999999, now(), 'INSERT', 'x', repeat('0', 64), repeat('1', 64))`)).toBe("42501");
    expect(await sqlstate("service_role", "update control.audit_chain_head set last_seq = 0")).toBe("42501");
  });
});

describe("internal functions are not callable by app roles", () => {
  const CALLS = [
    "select app.next_doc_number('INV')",
    "select app.bootstrap_owner(gen_random_uuid(), 'x x')",
    "select app.set_purpose('forged')",
    "select app.assert_owner()",
    "select app.assert_office()",
    "select app.assert_actor_ready()",
    "select app.raise_denied('x')",
    "select app.fiscal_year(current_date)",
    "select * from control.verify_audit_chain()",
    "select control.audit_canonical(1, now(), null, null, null, 'INSERT', 't', null, null, null, null, null, null)",
    // Migration 20261105130100 (slice 4, P1-21, D-32): the one finalising path, internal.
    "select app.finalise_delivery(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), null, 'x y', 1, 1, false, null, null, gen_random_uuid(), 'rep')",
  ];
  it.each(CALLS)("%s → 42501 for every app role", async (sql) => {
    for (const [, who] of APP_ROLES) expect(await sqlstate(who, sql)).toBe("42501");
  });

  it("every function in app/control/vault_api pins search_path (definer or not)", async () => {
    const { rows } = await run("postgres", `
      select n.nspname || '.' || p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('app', 'control', 'vault_api')
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(rows).toEqual([]);
  });

  it("the only functions authenticated may execute are the documented RLS helpers + RPCs", async () => {
    const { rows } = await run("postgres", `
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('app', 'control', 'vault_api', 'public')
        and has_function_privilege('authenticated', p.oid, 'execute') order by 1`);
    expect(rows.map((r) => r.proname)).toEqual([
      "add_salon_note", "approve_device", "cancel_approval", "cancel_order", "create_order", "create_salon",
      "decide_approval", "due_list", "duplicate_phones", "has_vault_grant", "invitation_preview", "invoice_document", "is_aal2", "is_office", "is_owner",
      "is_rep", "log_visit", "low_stock", "my_areas", "my_bag", "my_bag_id", "my_cards", "my_cash_position", "my_day", "my_handovers", "my_orders", "my_route",
      "my_salon", "my_salons", "my_session", "my_territory_ids", "my_territory_orders", "office_assign_salon_rep", "office_assign_territory", "office_cancel_stock_issue",
      "office_cash_position", "office_count_handover", "office_create_location", "office_create_order", "office_decide_salon", "office_deliver", "office_dismiss_card", "office_end_territory",
      "office_force_close_rep_day", "office_handovers", "office_invitations", "office_invite", "office_open_cards", "office_orders", "office_override_stage", "office_pending_salons", "office_post_adjustment", "office_propose_stock_issue", "office_raise_limit", "office_receivables_ageing",
      "office_record_cash", "office_record_payment", "office_release_credit_hold", "office_rep_cash_position", "office_revoke_invitation", "office_set_blocked", "office_set_last_purchase", "office_set_member_status",
      "office_set_primary_contact", "office_set_reorder_point", "office_set_route", "office_upsert_area",
      "office_upsert_product", "office_upsert_product_group", "office_upsert_sku", "office_upsert_territory",
      "order_remaining", "owner_create_user", "owner_set_bag_limit", "owner_set_config", "owner_set_credit",
      "owner_set_role", "owner_set_sku_price", "owner_set_status", "owner_set_vault_grant", "receipt_document", "recheck_order",
      "record_count", "record_demand", "redeem_invitation", "register_device", "rep_add_stop", "rep_check_in", "rep_check_out",
      "rep_confirm_stock_issue", "rep_create_card", "rep_deliver", "rep_device_ok", "rep_park_salon", "rep_record_payment", "rep_reorder_route",
      "rep_respond_handover", "request_approval", "request_device_id", "reveal_phone", "revoke_device", "salon_balance", "salon_credit_status", "salon_installments", "salon_me",
      "salon_notes", "salon_stages", "salon_visits", "self_ok", "stock_on_hand", "update_salon", "user_role",
      "warehouse_availability",
      // my_session, self_ok: added by migration 0004 (L-0026). Inventory RPCs and the my_bag_id RLS
      // helper: migration 0008 (P1-04); list change approved by MJ (L-0130, H-23). Territory and salon
      // RPCs and the my_territory_ids RLS helper: migration 0009 (P1-02a); MJ approval L-0144.
      // Rep day and visit RPCs: migration 0010 (P1-02 part b); MJ standing approval L-0144.
      // Due-list and route RPCs: migration 0011 (P1-16); MJ standing approval L-0144.
      // Credit and order RPCs: migration 0012 (P1-06 part a); MJ standing approval L-0144.
      // Delivery RPCs: migration 0013 (P1-06 part b); MJ standing approval L-0144.
      // Invoice document read: migration 0014 (P1-06 part c); MJ standing approval L-0144.
      // Money-in and receipt/cash reads: migration 0021 (P1-07 part a); test and permission boundary recorded in ACTIVITY C-033/B-37.
      // Receivables ageing read: migration 0022 (P1-07, PAY-07); MJ standing approval L-0144.
      // Handover count, answer and reads: migration 0023 (P1-07, PAY-05, CTL-03); MJ standing approval L-0144.
      // Office cash collection: migration 0024 (P1-07, PAY-02; MJ resolved B-37, L-0362); standing approval L-0144.
      // One salon for the rep edit form: migration 0016 (slice 3, C-014); MJ standing approval L-0144.
      // Invitations, member status, salon decisions and assignment, salon_me: migration 20261105100000
      // (slice 1, P1-18; D-39, decision file 2026-11-05-mj-reps-salons-orders); MJ standing approval L-0144.
      // office_create_order: migration 0025 (D-30 PR A); MJ standing approval L-0144.
      // order cards: migration 0025 (D-30 PR A); MJ standing approval L-0144.
      // my_territory_orders, office_orders: migration 0025 (D-30 PR A); MJ standing approval L-0144.
    ]);
    const sr = await run("postgres", `
      select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('app', 'control', 'vault_api') and has_function_privilege('service_role', p.oid, 'execute')`);
    expect(sr.rows[0].n).toBe(0);
  });
});

describe("spoofing and suspended users", () => {
  it("aal claimed in a header does not count; only the JWT claim does", async () => {
    const r = await run("postgres", `
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.owner.id, role: "authenticated", aal: "aal1" })}', true),
             set_config('request.headers', '${JSON.stringify({ aal: "aal2", "x-aal": "aal2" })}', true);
      set local role authenticated;
      select app.is_owner() o;`) as unknown as Array<{ rows: Array<{ o: boolean }> }>;
    expect(r[r.length - 1].rows[0].o).toBe(false);
  });

  it("a suspended user cannot act through any RPC", async () => {
    for (const sql of [
      "select app.request_approval(gen_random_uuid(), 'discount', 'order', null, '{}', 'try')",
      "select app.register_device('dev-suspended-0000000001')",
      `select app.revoke_device((select id from public.device where user_id = '${fx.suspendedRep.id}' limit 1), 'x y z')`,
    ]) expect(await errorOf(SUSPENDED, sql)).toMatch(/no active user profile/);
  });

  it("governance config values are invisible to reps and AAL1 office users", async () => {
    for (const who of [REP_A, REP_B, MANAGER_AAL1, OWNER_AAL1]) {
      const { rows } = await run(who, "select key from public.app_config where key like 'approval.%' or key like 'credit.%' or key like 'cash.%' or key in ('collections.escalation_days', 'pipeline.timers')");
      expect(rows).toEqual([]);
    }
  });
});

describe("audit chain after the attacks", () => {
  it("still verifies end to end", async () => {
    const v = await verify();
    expect(v.ok).toBe(true);
  });

  it("an appended row forged by postgres with a wrong hash is detected", async () => {
    const r = await run("postgres", `
      insert into control.audit_event (seq, occurred_at, action, table_name, prev_hash, hash)
      select last_seq + 1, now(), 'INSERT', 'public.forged', last_hash, repeat('a', 64) from control.audit_chain_head;
      update control.audit_chain_head set last_seq = last_seq + 1, last_hash = repeat('a', 64);
      select ok from control.verify_audit_chain();`) as unknown as Array<{ rows: Array<{ ok: boolean }> }>;
    expect(r[r.length - 1].rows[0].ok).toBe(false);
  });
});
