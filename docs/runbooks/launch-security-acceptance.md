# Launch security acceptance index

Task: P1-12. This page maps every launch security criterion to the evidence that proves it, and says plainly where nothing proves it yet. Nothing here is a claim without a named check behind it.

The criteria are the eight items of doc 06 section 10 (security acceptance criteria for launch) and the six items of doc 07 section 5 (acceptance tests). Two further controls from the hard rules in docs/ACTIVITY.md are listed separately at the end, because they are not rows of either list and are not given invented criterion numbers.

## How to read this page

The mapping is held in code, in `supabase/tests/helpers/launch-acceptance.ts`, and checked by `supabase/tests/launch-acceptance.test.ts`. That test fails when:

- a cited test title no longer exists in its file, or is skipped, marked todo, or marked `it.fails`;
- a cited CI job no longer exists in `.github/workflows/ci.yml`, or no longer contains the text it is cited for;
- a cited runbook file does not exist;
- a cited defect check is no longer an `it.fails` check (the defect was fixed, so the row must be cleaned up);
- the table below does not list exactly the criteria of the index, in order, with each wording quoted verbatim from its source document and each status equal to the one computed from the evidence;
- the evidence list of a criterion below omits a reference of the index;
- the set of blocked criteria or the set of criteria with an open defect differs from the pinned lists in the test file.

Evidence kinds:

- test: a live test, named as `path::exact title`.
- ci: a job key under `jobs:` in `.github/workflows/ci.yml`, optionally `job::text` when the job must contain that text.
- manual: a runbook that exists in the repository.
- blocked: the task that has to land before the criterion can be proven. A blocked entry is never counted as proof and the test reports it as todo, never as passing.
- defect: the `it.fails` check of an open defect against the criterion. It is never counted as proof.

Status of a criterion:

- met: every piece of evidence proves the criterion.
- partial: some evidence proves part of it and some part is blocked.
- blocked: nothing proves it yet.
- defect: an open defect is recorded against it. It is not met until the defect is fixed.

To run the index on its own: `pnpm exec vitest run --config supabase/tests/vitest.config.ts launch-acceptance`. It reads files only and needs no database rows, but it runs under the database test configuration.

## Summary

| Criterion | Wording in the source document | Status | Open |
|---|---|---|---|
| 06.10.1 | RLS matrix tests pass for every table × role, including a rep in territory A failing to read territory B. | met | none |
| 06.10.2 | No application role can UPDATE/DELETE on any append-only table (tested). | met | none |
| 06.10.3 | Owner/manager cannot log in without TOTP; rep cannot operate from an unapproved device (tested). | met | none |
| 06.10.4 | Vault columns are unreadable via the REST API with any user token (tested); vault reads appear in the access log and the digest. | partial | access log and digest wait for P1-05 |
| 06.10.5 | Audit hash chain verifies; mirror receives rows nightly. | partial | the mirror has no task id yet |
| 06.10.6 | A full offboarding completes from one screen in under 10 minutes (rehearsed). | blocked | waits for P1-08 |
| 06.10.7 | Backup restore drill performed once before go-live, documented. | blocked | the drill runbook is PR C of P1-12 |
| 06.10.8 | Dependency and secret scans clean; service-role key absent from all client bundles (checked in CI). | partial | gitleaks fixture findings, awaiting MJ |
| 07.5.1 | With a rep token, every `vault_api` function returns `permission denied`; no vault table appears in the REST schema; `select * from vault.supplier` via the API is impossible. | met | none, but see the note on this row |
| 07.5.2 | With a manager token **without** grant, the same holds; with grant **and** AAL2, calls succeed and produce access-log rows. | partial | calls and access-log rows wait for P1-05 |
| 07.5.3 | A database dump opened without the key shows ciphertext in every `*_enc` column. | blocked | waits for P1-05 |
| 07.5.4 | Rendering every customer-facing document template with a full fixture produces no string from the vault fixture. | blocked | waits for P1-05 |
| 07.5.5 | The bank-statement importer masks sensitive counterparties for non-grantees. | blocked | waits for P1-05 |
| 07.5.6 | Revoking the manager's grant takes effect on the next request. | partial | the effect on vault calls waits for P1-05 |

Counts: 4 met (06.10.1, 06.10.2, 06.10.3, 07.5.1), 5 partial (06.10.4, 06.10.5, 06.10.8, 07.5.2, 07.5.6), 5 blocked (06.10.6, 06.10.7, 07.5.3, 07.5.4, 07.5.5), 0 with an open defect. No criterion is met in full except the four counted as met.

## Evidence by criterion

### 06.10.1 RLS matrix, territory and masking

- test: `supabase/tests/rls-matrix.test.ts::every table, view, materialized view and foreign table in our five schemas is covered by the matrix`
- test: `supabase/tests/rls-matrix.test.ts::the coverage query sees a planted view in an exposed schema and a planted table in public`
- test: `supabase/tests/rls-matrix.test.ts::the SELECT comparison catches a same-count leak: repA shown other users' devices instead of its own (L-0116 D2)`
- test: `supabase/tests/schema-hygiene.test.ts::every table has RLS enabled AND forced (H-13)`
- test: `supabase/tests/salons.test.ts::a rep sees its own territories and areas only`
- test: `supabase/tests/salons.test.ts::another territory's rep cannot reveal it`
- test: `supabase/tests/reverify3-attacks.test.ts::§7.4 list-dump: a rep on the approved phone sees only its own rows; it reads no salon rows (H-14)`
- test: `supabase/tests/verify-slices-1-3.test.ts::my_salon gives exactly the rows my_salons gives the same rep, masked, and nothing to anyone else`
- test: `supabase/tests/verify-slices-1-3.test.ts::after the office ends rep 1's territory, rep 1 reads and writes nothing of its salon`
- test: `supabase/tests/verify-slices-1-3.test.ts::reveal_phone: own territory only, every rep reveal logged against the session's user; office needs AAL2`
- test: `supabase/tests/crm-attacks.test.ts::my_salons caps a page at 50 rows however large the limit, and masks phone numbers`
- test: `supabase/tests/rep-detail-documents.test.ts::no cost, margin, supplier, credit, fingerprint or GPS key at any depth, and no unmasked phone anywhere`
- test: `supabase/tests/rep-readonly-timelines.test.ts::an unknown salon id and another territory's salon get the same 42501 for a rep (no lookup first)`

Notes:

- The RLS matrix names its per-table cases from data (for example "repA SELECT" for each table), so those titles cannot be quoted here. The static tests above cover the matrix as a whole: every table in the five schemas is in it, the coverage query is itself tested, and the SELECT comparison is tested against a planted leak. The per-table cases run as real signed-in roles and compare the rows seen with the rows expected.
- A rep in territory A failing to read territory B, and phone masking, are covered by the named tests from salons through rep-readonly-timelines.

### 06.10.2 Append-only tables cannot be changed by any role

- test: `supabase/tests/append-only-sweep.test.ts::finds the append-only tables by catalog, and the list is not vacuous`
- test: `supabase/tests/append-only-sweep.test.ts::every append-only table has an enabled, unconditional BEFORE UPDATE OR DELETE row trigger`
- test: `supabase/tests/append-only-sweep.test.ts::every table that calls itself append-only or immutable has the trigger, and the list is not vacuous`
- test: `supabase/tests/append-only-sweep.test.ts::no application role holds an UPDATE, DELETE or TRUNCATE privilege on any append-only or immutable table`
- test: `supabase/tests/append-only-sweep.test.ts::%s: UPDATE, DELETE and TRUNCATE on every append-only table are refused (42501)`
- test: `supabase/tests/append-only-sweep.test.ts::the table owner is stopped by the trigger when a row exists (planted table with a real row)`
- test: `supabase/tests/append-only-sweep.test.ts::the guard reports a planted table whose trigger is missing, disabled, partial or conditional`
- test: `supabase/tests/foundation.test.ts::audit_event is append-only even for postgres (UPDATE, DELETE, TRUNCATE)`
- test: `supabase/tests/salons.test.ts::notes, stage events and reveals refuse UPDATE, DELETE and TRUNCATE for every role`

### 06.10.3 TOTP and approved device

- test: `supabase/tests/device-guard.test.ts::refuses every change to a revoked device, even by the table owner`
- test: `supabase/tests/device-guard.test.ts::refuses identity changes and the backward move approved -> pending`
- test: `supabase/tests/foundation.test.ts::a rep on an unapproved device cannot act`
- test: `supabase/tests/foundation.test.ts::a suspended rep cannot act, and their devices were revoked`
- test: `supabase/tests/foundation.test.ts::a revoked device id is dead for good: registering it again is refused (0006, L-0035)`
- test: `supabase/tests/foundation.test.ts::owner without MFA (AAL1) cannot create users`
- test: `supabase/tests/foundation.test.ts::vault grant: owner AAL2 yes, manager with grant yes, manager AAL1 no, rep no`
- test: `supabase/tests/verify-slices-1-3.test.ts::a rep cannot approve its own pending phone, nor anyone else's`
- test: `supabase/tests/function-gates.test.ts::the gates exist once each in schema app and still have the parts that make them gates`
- test: `supabase/tests/function-gates.test.ts::every function that authenticated or anon can execute calls a gate, or is on the allowlist with a reason`
- test: `supabase/tests/function-gates.test.ts::every function that passes only on a device-only gate (self_ok, rep_device_ok) also carries a rep-only marker, or is a named exception`
- test: `supabase/tests/function-gates.test.ts::every device-only exception still exists and still passes on a device-only gate alone (a fixed one must leave the list)`
- test: `supabase/tests/function-gates.test.ts::anon can execute no function in our schemas`
- test: `supabase/tests/function-gates.test.ts::DEFECT CHECK: an office session without TOTP (AAL1) must not read app.warehouse_availability()`
- test: `supabase/tests/function-gates.test.ts::a rep on the approved device sees app.warehouse_availability(); an unapproved device sees no rows`

Notes:

- `app.warehouse_availability()` (migration 20261117120000) lets a rep through `app.self_ok()` and everyone else through `app.assert_office()`, which requires an MFA-verified (AAL2) session. An owner or manager at AAL1 is refused. The check that used to be `it.fails` is now a live test. The title still says DEFECT CHECK so the old citation stays findable.
- The database enforces TOTP as the AAL2 requirement on each function that needs it, and these tests exercise that. Enrolling TOTP and refusing a sign-in without it is a setting of the sign-in service, which no test here exercises.

### 06.10.4 Vault unreadable through the API; reads logged

- test: `supabase/tests/schema-hygiene.test.ts::supplier_vault is unreachable for every application role (doc 07 §5.1)`
- test: `supabase/tests/schema-hygiene.test.ts::no public column name hints at supplier or cost data (H-01, H-27)`
- test: `supabase/tests/verifier-attacks.test.ts::supplier_vault is unreachable for every app role; vault_api has no functions yet`
- blocked: `P1-05`

Notes:

- The first half is proven at the database: no application role can reach the vault schema, and no public column name hints at supplier or cost data. The tests check grants, not a live REST call.
- Vault reads appearing in the access log and the digest need the vault itself, which is task P1-05. No vault migration exists yet.

### 06.10.5 Audit chain verifies; mirror receives rows nightly

- test: `supabase/tests/foundation.test.ts::verifies after fixtures were created`
- test: `supabase/tests/foundation.test.ts::detects tampering with an existing audit row`
- test: `supabase/tests/foundation.test.ts::no application role can execute the audit or verification functions`
- test: `supabase/tests/schema-hygiene.test.ts::every table except the audit chain itself has an enabled AFTER ROW INSERT/UPDATE/DELETE audit trigger calling control.audit_row (H-17)`
- test: `supabase/tests/schema-hygiene.test.ts::control.audit_event keeps one SELECT policy, owner-only; no app function returns its raw columns`
- blocked: `audit mirror (no task id yet, MJ assigns)`

Notes:

- The hash chain, its tamper detection, and the fact that every table writes to it are tested.
- The nightly mirror has no task id yet. MJ assigns one. Until then it is blocked.

### 06.10.6 Offboarding from one screen in under 10 minutes

- blocked: `P1-08`

### 06.10.7 Backup restore drill

- blocked: `P1-12 PR C`

Notes:

- The restore drill runbook does not exist yet. It is PR C of P1-12. When it lands, this entry becomes a manual entry pointing at it, and the drill itself still has to be performed once and recorded.

### 06.10.8 Scans clean; service-role key absent from client bundles

- ci: `typecheck::scripts/service-role-scan.mjs`
- ci: `dependency-audit::scripts/dependency-audit.mjs`
- test: `supabase/tests/service-role-scan.test.ts::refuses a key name anywhere in apps or packages, including the lines the old grep skipped`
- test: `supabase/tests/service-role-scan.test.ts::fails closed when a root is missing or nothing is scanned`
- test: `supabase/tests/service-role-scan.test.ts::bundle: library comments pass; key values fail`
- test: `supabase/tests/dependency-audit.test.ts::runs the CLI over the real sample with no exceptions and exits zero (moderate only)`
- test: `supabase/tests/dependency-audit.test.ts::high advisory with no exception makes ok false and names the advisory id`
- ci: `secret-scan::gitleaks detect`
- blocked: `gitleaks fixture findings, awaiting MJ`

Notes:

- The ci entry names the job key `typecheck` (its display name is "typecheck + service-role scan") and requires that the job runs `scripts/service-role-scan.mjs`. The index test proves the job is defined and runs the scan. It cannot prove the job passed on a given commit; that is the pull request check.
- The dependency advisory gate (`dependency-audit`, Task 1 of P1-12) pipes `pnpm audit --json --prod` into `scripts/dependency-audit.mjs`, which fails on a high or critical advisory that has no unexpired, reasoned exception in `docs/security/audit-exceptions.json`.
- Job `secret-scan` installs gitleaks 8.30.1, fails the build when a throwaway token in the runner temp directory is missed, then runs `gitleaks detect` on this repository with `.gitleaks.toml`. The allowlist is the public local-stack values already written in the workflow, matched by value.
- The first local run of gitleaks 8.30.1 was not clean. It reported 72 hits, all rule generic-api-key, all an eight-letter uppercase token in old commits of fixture lines (`SMS_API_KEY`, `DOC_COUNTER_KEY`, and `api_key` in the attack tests, the archived log, and an old ACTIVITY row). Nothing was allowlisted. The job will fail until MJ rules on those fixtures.

### 07.5.1 Rep token cannot reach the vault

- test: `supabase/tests/schema-hygiene.test.ts::supplier_vault is unreachable for every application role (doc 07 §5.1)`
- test: `supabase/tests/verifier-attacks.test.ts::supplier_vault is unreachable for every app role; vault_api has no functions yet`
- test: `supabase/tests/reverify3-attacks.test.ts::§7.2 vault: no persona reaches supplier_vault; the grant is true only for granted office at AAL2, and an owner revoke bites at once`

Notes:

- `vault_api` has no functions yet, so "every `vault_api` function returns `permission denied`" holds because there is nothing to call. The schema-level tests above are the real evidence: no application role can use the vault schema, and no vault table is exposed. When P1-05 adds functions, they must be added to this check.

### 07.5.2 Manager without grant refused; with grant and AAL2 allowed and logged

- test: `supabase/tests/verifier-attacks.test.ts::has_vault_grant is false for reps, AAL1 office, suspended, and a manager right after revoke`
- test: `supabase/tests/foundation.test.ts::vault grant: owner AAL2 yes, manager with grant yes, manager AAL1 no, rep no`
- blocked: `P1-05`

Notes:

- The grant check is tested for every role at the right assurance level. Calls succeeding and writing access-log rows need the vault, so that part is blocked on P1-05.

### 07.5.3 Dump shows ciphertext in every encrypted column

- blocked: `P1-05`

### 07.5.4 Document templates leak no vault string

- blocked: `P1-05`

### 07.5.5 Bank-statement importer masks sensitive counterparties

- blocked: `P1-05`

### 07.5.6 Revoked grant bites on the next request

- test: `supabase/tests/foundation.test.ts::revoking the manager's vault grant takes effect on the next request (doc 07 §5.6)`
- blocked: `P1-05`

Notes:

- The grant check flipping at once is tested. Its effect on actual vault calls needs the vault, so that part is blocked on P1-05.

## Additional controls checked

These two controls are not rows of doc 06 section 10 or doc 07 section 5. They come from hard rules H-12 and H-09 in docs/ACTIVITY.md.

| Control | Wording in the source document | Status | Open |
|---|---|---|---|
| ADD.1 | Maker ≠ checker is a database constraint (checker_id <> maker_id) on every approval, not a UI rule. | met | none |
| ADD.2 | Server time is authoritative. created_at/recorded_at come from the database. Client timestamps are stored in separate columns as evidence only. | met | none |

### ADD.1 A maker cannot approve its own request

- test: `supabase/tests/foundation.test.ts::the maker can never approve their own request, even the owner`
- test: `supabase/tests/foundation.test.ts::the database constraint holds even for a direct write by postgres`
- test: `supabase/tests/foundation.test.ts::a rep cannot request owner-level kinds, and cannot decide anything`

### ADD.2 A backdated client timestamp is governed by server time

- test: `supabase/tests/crm-attacks.test.ts::a backdated or future client timestamp never moves the server timestamps (H-09)`
- test: `supabase/tests/crm-attacks.test.ts::a delivery needs a receiver name and sane GPS; a backdated client time does not move the invoice time (H-09)`
- test: `supabase/tests/crm-attacks.test.ts::a stock count and a demand signal accept no backdated server time (H-09)`
- test: `supabase/tests/payments.test.ts::the phone's time is kept as evidence only: recorded_at is the database's time`
- test: `supabase/tests/verifier-attacks.test.ts::created_at is server time; a caller cannot backdate a request (§7.6)`
- test: `supabase/tests/verify-slices-1-3.test.ts::a visit needs GPS, is one row per client id, and a backdated arrival does not move the server time`

## How the six launch checks asked for map onto this index

1. No rep or un-granted manager token reaches vault data or functions: 07.5.1 and 07.5.2 (the grant check), with 06.10.4.
2. UPDATE and DELETE fail on append-only tables for all roles: 06.10.2.
3. Rep tokens cannot read unmasked phone numbers or other-territory salons: 06.10.1.
4. A maker cannot approve its own request: ADD.1.
5. A backdated client timestamp is governed by server time: ADD.2.
6. The audit chain verifies: 06.10.5 (the nightly mirror half is blocked).

## Keeping this page honest

- When a blocked task lands, replace its blocked entry with the real evidence in `supabase/tests/helpers/launch-acceptance.ts`, edit the pinned list in `supabase/tests/launch-acceptance.test.ts`, and update the status and the summary here. The test fails until all three agree.
- When a defect is fixed, its `it.fails` check is turned into a normal test; the index test then fails until the defect entry is removed or replaced by that test.
- Do not cite a job, test or file that does not exist. The test will say which reference is broken.
