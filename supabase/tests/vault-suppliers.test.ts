/**
 * P1-05, first slice: the supplier vault (VLT-01, VLT-04, VLT-06; doc 07 sections 2 and 5).
 *
 * What this file proves, at the database layer, with real signed-in roles:
 *   - the owner reads and writes; every read and every write appends one vault_access_log row;
 *   - a replay of the same client_id gives one row and one log row (H-08);
 *   - a manager reads only while the owner's grant is on; the revoke bites on the next call;
 *   - a manager who is not granted, a rep, a suspended rep, anon and service_role get 42501;
 *   - office sessions at AAL1 get 42501 even with the grant (SEC-02, AAL2);
 *   - every vault table is unreachable directly by every application role, and the access log is
 *     append-only (H-06, H-07);
 *   - DA-033: control.audit_event records the event with the row images redacted, so no vault value
 *     ever reaches control, and the hash chain still verifies (H-01, H-17).
 *
 * All rows are synthetic ([Dummy], [Test]); no real supplier or personal data (H-02, H-03).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { fx, MANAGER, MANAGER_AAL1, OWNER, OWNER_AAL1, REP_A, REP_B, run, SUSPENDED, sqlstate } from "./helpers/db";

// The vault is read through vault_api only; no test here touches supplier_vault.supplier directly.
const LIST = "select * from vault_api.supplier_list('test: supplier directory')";
const DUMMY_NAME = "[Dummy] Vault Supplier One";
const DUMMY_CONTACT = "[Test] Contact Person";
const DUMMY_PHONE = "+920000001234";

const claimsOf = (id: string, aal: "aal1" | "aal2") => JSON.stringify({ sub: id, role: "authenticated", aal });

// A committed supplier the read tests all look at. Created once; every assertion names its id, so a
// second run of this file in the same database adds rows without changing an expected count.
let supplierId: string;
const insertClientId = randomUUID();

beforeAll(async () => {
  const { rows } = await run(
    OWNER,
    `select (vault_api.supplier_upsert($1, null, $2, $3, $4, $5, 'active', $6)).id id`,
    [insertClientId, DUMMY_NAME, DUMMY_CONTACT, DUMMY_PHONE, "[Dummy] note", "test: create"],
    { commit: true },
  );
  supplierId = rows[0].id as string;
});

describe("vault: the granted owner and manager", () => {
  it("the owner reads the directory, and the read adds one access-log row with the actor and purpose", async () => {
    const before = await run(
      "postgres",
      "select count(*)::int n from supplier_vault.vault_access_log where action = 'read' and user_id = $1",
      [fx.owner.id],
    );
    const { rows } = await run(OWNER, LIST, [], { commit: true });
    expect(rows.map((r) => r.id)).toContain(supplierId);
    const after = await run(
      "postgres",
      `select count(*)::int n, min(purpose) p from supplier_vault.vault_access_log
       where action = 'read' and user_id = $1`,
      [fx.owner.id],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n + 1);
    expect(after.rows[0].p).toBe("test: supplier directory");
    // The log names the records it returned, as doc 07 section 2 asks.
    const refs = await run(
      "postgres",
      `select record_refs from supplier_vault.vault_access_log
       where action = 'read' and user_id = $1 order by occurred_at desc, id desc limit 1`,
      [fx.owner.id],
    );
    expect(refs.rows[0].record_refs).toContain(supplierId);
  });

  it("a manager with the owner's grant reads the directory (default: granted, VLT-06)", async () => {
    expect((await run(MANAGER, "select app.has_vault_grant() g")).rows[0].g).toBe(true);
    const { rows } = await run(MANAGER, LIST, [], { commit: true });
    expect(rows.map((r) => r.id)).toContain(supplierId);
    const log = await run(
      "postgres",
      "select count(*)::int n from supplier_vault.vault_access_log where action = 'read' and user_id = $1",
      [fx.manager.id],
    );
    expect(log.rows[0].n).toBeGreaterThan(0);
  });

  it("an upsert edits the recorded row and stamps updated_at from the server", async () => {
    const { rows } = await run(
      OWNER,
      "select (vault_api.supplier_upsert($1, $2, $3, null, '', null, 'archived', $4)).*",
      [randomUUID(), supplierId, DUMMY_NAME, "test: archive"],
      { commit: true },
    );
    expect(rows[0].status).toBe("archived");
    expect(new Date(rows[0].updated_at).getTime()).toBeGreaterThanOrEqual(new Date(rows[0].created_at).getTime());
    // An empty string clears the phone; a null keeps the contact name (the office_upsert_product rule).
    expect(rows[0].phone).toBeNull();
    expect(rows[0].contact_name).toBe(DUMMY_CONTACT);
    // Put it back for the read tests that follow.
    await run(
      OWNER,
      "select vault_api.supplier_upsert($1, $2, $3, null, $4, null, 'active', $5)",
      [randomUUID(), supplierId, DUMMY_NAME, DUMMY_PHONE, "test: restore"],
      { commit: true },
    );
  });
});

describe("vault: idempotency (H-08)", () => {
  it("a replay of the same client_id returns the same row and adds no second row or write log", async () => {
    const c = randomUUID();
    const first = await run(
      OWNER,
      "select (vault_api.supplier_upsert($1, null, $2, null, null, null, 'active', $3)).id id",
      [c, "[Dummy] Vault Supplier Replay", "test: replay"],
      { commit: true },
    );
    const second = await run(
      OWNER,
      "select (vault_api.supplier_upsert($1, null, $2, null, null, null, 'active', $3)).id id",
      [c, "[Dummy] Vault Supplier Replay", "test: replay"],
      { commit: true },
    );
    expect(second.rows[0].id).toBe(first.rows[0].id);
    const rows = await run("postgres", "select count(*)::int n from supplier_vault.supplier where id = $1", [first.rows[0].id]);
    expect(rows.rows[0].n).toBe(1);
    const log = await run("postgres", "select count(*)::int n from supplier_vault.vault_access_log where client_id = $1", [c]);
    expect(log.rows[0].n).toBe(1);
  });

  it("a write without a client_id or a purpose is refused (22023)", async () => {
    expect(await sqlstate(OWNER, "select vault_api.supplier_upsert(null, null, '[Dummy] x')")).toBe("22023");
    expect(
      await sqlstate(OWNER, "select vault_api.supplier_upsert($1, null, '[Dummy] x', null, null, null, 'active', '')", [
        randomUUID(),
      ]),
    ).toBe("22023");
  });

  it("a read without a purpose is refused (22023, VLT-04)", async () => {
    expect(await sqlstate(OWNER, "select * from vault_api.supplier_list('')")).toBe("22023");
  });
});

describe("vault: who is refused", () => {
  it("a manager whose grant the owner revoked gets nothing on the very next call", async () => {
    // One rolled-back transaction: revoke as the owner, then call as the manager. No committed grant
    // change is left behind for another test file.
    const res = (await run(
      "postgres",
      `
      select set_config('request.jwt.claims', '${claimsOf(fx.owner.id, "aal2")}', true);
      set local role authenticated;
      select app.owner_set_vault_grant('${fx.manager.id}', false, 'vault test: revoke');
      select set_config('request.jwt.claims', '${claimsOf(fx.manager.id, "aal2")}', true);
      do $t$ begin
        begin
          perform vault_api.supplier_list('test: revoked manager');
          raise exception using errcode = 'P0001', message = 'NOT REFUSED: an un-granted manager read the vault';
        exception when insufficient_privilege then null;
        end;
      end $t$;
      select app.has_vault_grant() g;`,
    )) as unknown as Array<{ rows: Array<{ g: boolean }> }>;
    expect(res[res.length - 1].rows[0].g).toBe(false);
  });

  it("a manager cannot grant the vault to itself, or to anyone (governance is owner-only, H-15)", async () => {
    expect(
      await sqlstate(MANAGER, "select vault_api.supplier_grant_set($1, $2, true, 'self grant')", [randomUUID(), fx.manager.id]),
    ).toBe("42501");
    expect(
      await sqlstate(MANAGER, "select vault_api.supplier_grant_set($1, $2, true, 'grant a peer')", [randomUUID(), fx.repA.id]),
    ).toBe("42501");
  });

  it("the owner sets a grant, the change is logged as a grant with the reason, and a replay adds nothing", async () => {
    // Set to the value it already holds: the point is the owner's right and the log row, and the
    // test leaves no changed grant behind for another file.
    const c = randomUUID();
    const got = await run(
      OWNER,
      "select vault_api.supplier_grant_set($1, $2, true, $3) g",
      [c, fx.manager.id, "vault test: grant confirmed"],
      { commit: true },
    );
    expect(got.rows[0].g).toBe(true);
    const log = await run(
      "postgres",
      "select action, purpose, record_refs from supplier_vault.vault_access_log where client_id = $1",
      [c],
    );
    expect(log.rows).toEqual([{ action: "grant", purpose: "vault test: grant confirmed", record_refs: [fx.manager.id] }]);
    await run(OWNER, "select vault_api.supplier_grant_set($1, $2, true, $3)", [c, fx.manager.id, "vault test: grant confirmed"], {
      commit: true,
    });
    const again = await run("postgres", "select count(*)::int n from supplier_vault.vault_access_log where client_id = $1", [c]);
    expect(again.rows[0].n).toBe(1);
  });

  it("reps, a suspended rep, anon and service_role are refused (42501)", async () => {
    for (const who of [REP_A, REP_B, SUSPENDED, "anon", "service_role"] as const) {
      expect(await sqlstate(who, LIST)).toBe("42501");
      expect(
        await sqlstate(who, "select vault_api.supplier_upsert($1, null, '[Dummy] x', null, null, null, 'active', 'test')", [
          randomUUID(),
        ]),
      ).toBe("42501");
      expect(
        await sqlstate(who, "select vault_api.supplier_grant_set($1, $2, true, 'test')", [randomUUID(), fx.manager.id]),
      ).toBe("42501");
    }
  });

  it("an office session at AAL1 is refused even with a grant (AAL2 required)", async () => {
    for (const who of [OWNER_AAL1, MANAGER_AAL1]) expect(await sqlstate(who, LIST)).toBe("42501");
    // The grant is still on for both; AAL2 is what is missing.
    expect((await run(OWNER, "select app.has_vault_grant() g")).rows[0].g).toBe(true);
    expect((await run(MANAGER, "select app.has_vault_grant() g")).rows[0].g).toBe(true);
  });
});

describe("vault: the tables themselves", () => {
  it("no application role reaches a vault table directly, by read or by write", async () => {
    for (const who of [OWNER, MANAGER, REP_A, "anon", "service_role"] as const) {
      expect(await sqlstate(who, "select count(*) from supplier_vault.supplier")).toBe("42501");
      expect(await sqlstate(who, "select count(*) from supplier_vault.vault_access_log")).toBe("42501");
      expect(
        await sqlstate(who, "insert into supplier_vault.supplier (name, created_by) values ('[Dummy] x', gen_random_uuid())"),
      ).toBe("42501");
    }
  });

  it("the access log is append-only: UPDATE and DELETE are refused even for postgres", async () => {
    expect(await sqlstate("postgres", "update supplier_vault.vault_access_log set purpose = purpose")).toBe("42501");
    expect(await sqlstate("postgres", "delete from supplier_vault.vault_access_log")).toBe("42501");
    expect(await sqlstate("postgres", "truncate supplier_vault.vault_access_log")).toBe("42501");
  });

  it("a supplier row is archived, never deleted (H-07)", async () => {
    expect(await sqlstate("postgres", "delete from supplier_vault.supplier")).toBe("42501");
  });
});

describe("vault: DA-033, the audit record holds no vault value", () => {
  it("control.audit_event has an event per vault change, with both images redacted", async () => {
    const { rows } = await run(
      "postgres",
      `
      select action, row_id, before, after from control.audit_event
      where table_name = 'supplier_vault.supplier' and row_id = $1 order by seq`,
      [supplierId],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      if (r.before !== null) expect(r.before).toEqual({ redacted: true });
      if (r.after !== null) expect(r.after).toEqual({ redacted: true });
    }
  });

  it("no vault value (name, contact, phone, note) appears in a supplier_vault audit image", async () => {
    const { rows } = await run(
      "postgres",
      `
      select count(*)::int n from control.audit_event
      where table_name like 'supplier_vault.%'
        and (coalesce(before::text, '') || coalesce(after::text, ''))
            ~* '(Dummy|0000001234)'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it("the hash chain still verifies after vault writes (H-17)", async () => {
    const { rows } = await run("postgres", "select * from control.verify_audit_chain()");
    expect(rows[0].ok).toBe(true);
  });
});
