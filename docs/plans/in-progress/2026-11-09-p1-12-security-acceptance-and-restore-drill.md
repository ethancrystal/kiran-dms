# P1-12 Security Acceptance Suite and Restore Drill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** DRAFT FOR MJ REVIEW, written 2026-11-09 against `origin/main` `4e0c690`. Nothing here has been run. Status of the task itself lives only on the board (`docs/ACTIVITY.md` section 12, row P1-12, NOT STARTED).

**Before building:** the executor follows the build protocol in `CLAUDE.md` (read `docs/ACTIVITY.md` and the 20 newest `docs/log/` entries, run `pnpm agent:preflight`, keep one log entry per PR, never work on `main`). Never touch production, hosted data or secrets (H-19, H-02, H-03): everything below is built and rehearsed on the local Supabase stack with synthetic data.

**Goal:** Close what can be closed today of doc 06 section 10 (the eight launch criteria) and give MJ a rehearsed, timed, encrypted backup-and-restore procedure to run once before go-live, with every criterion mapped to a named check so nothing is claimed that no test proves.

**Architecture:** Three independent pieces. (A) CI gates for dependency advisories and secrets, which doc 06 section 10.8 requires and the repo lacks. (B) An acceptance index: a document plus a test that fails if any criterion points at a test, job or file that does not exist, and two catalog guards for gaps in criteria 2 and 3. (C) Backup and restore scripts (`pg_dump` piped straight into `age` public-key encryption, a manifest from the same snapshot, a refuse-by-default restore) proven by a CI rehearsal on the local stack, plus a runbook for MJ's real drill. Criteria that depend on unbuilt features are marked blocked, never passed.

**Tech Stack:** Node `.mjs` scripts in `scripts/` (the repo's pattern), Vitest in `supabase/tests`, `node --test` for pure script tests, GitHub Actions, `pg_dump`/`pg_restore`, `age`, `gitleaks`.

**Spec:** `docs/06-security-plan.md` sections 5, 7, 10; `docs/07-supplier-confidentiality.md` section 5; `docs/03-requirements.md` NFR-07, NFR-09, NFR-10, NFR-12; `docs/audit-2026-10-31/security-nfr-webapp.md` SEC-10, SEC-12, NFR-07, NFR-10; `docs/11-roadmap.md` Phase 1 exit criteria 1, 5 and 7.

## Global Constraints

- Doc 06 section 10.7: "Backup restore drill performed once before go-live, documented."
- Doc 06 section 10.8: "Dependency and secret scans clean; service-role key absent from all client bundles (checked in CI)."
- Doc 06 section 5, Backups: "Provider PITR (7–28 days) + weekly `pg_dump` encrypted with an owner-held key to a separate cloud account; vault tables included (encrypted columns stay encrypted)".
- NFR-10: "RPO ≤ 24 h (PITR gives minutes), RTO ≤ 4 h". NFR-09: "≤ USD 60/month infrastructure at launch scale".
- Doc 06 section 7: "production data never leaves production except as encrypted backups".
- H-19: no production access (no migrations, SQL, deploys, data reads) without MJ's explicit approval recorded in a `DECISION` entry. A scheduled production dump is a data read: it ships switched off.
- A plaintext dump never touches disk, logs or CI artifacts. Secrets only in GitHub Actions secrets or the owner's offline custody; none in the repo (H-02, H-20).
- English only (D-42). No new runtime dependency in `apps/web`.
- One branch and one pull request per row of the PR split below, each merged before the next; no stacked PRs. The ruleset and required checks are MJ's to change.

## Open questions for MJ (the plan does not decide these)

1. **Recovery target against budget.** Doc 06 asks for weekly dumps plus provider PITR. A weekly dump alone gives a 7-day RPO, which fails NFR-10 (24 h). PITR on the hosted plan is a paid add-on whose price must be checked against NFR-09's USD 60 cap (doc 05 assumes Supabase Pro at about USD 25). **Recommendation:** daily encrypted dumps (this plan builds them), plus PITR only if the price fits. **Default:** daily dumps, PITR undecided.
2. **Where do backups go?** Doc 06 says "a separate cloud account". Pick an S3-compatible bucket provider and own the account; the workflow reads its endpoint and keys from secrets. **Default:** workflow stays disabled until you answer.
3. **Who holds the `age` private key?** Recommended: generated offline, printed twice, kept in two places you control. Whoever holds it can read every backup.
4. **Where does the real drill run?** Recommended: a fresh temporary Supabase project that you create and delete, restored from an encrypted backup (allowed by doc 06 section 7). Not the staging project.
5. **Storage files.** `pg_dump` does not contain files in Storage buckets (product pictures). Back them up too, or accept re-uploading? **Default:** not covered.

## Review Focus

- A plaintext dump appears anywhere: temp file, log line, artifact, error message.
- Restore pointed at a database that already has data, or at the wrong database: refused.
- Restore succeeds but `auth` data is missing, so nobody can sign in (owner with TOTP included).
- Dump and manifest taken at different instants, hiding a loss or inventing a difference.
- The scheduled backup stops silently (expired secret, full bucket, disabled workflow) and nobody notices.

## Findings that shape the plan (read from `origin/main`)

| Criterion (doc 06 section 10) | Today | This plan |
|---|---|---|
| 1 RLS matrix, territory A cannot read B | Covered: `supabase/tests/rls-matrix.test.ts` (coverage guard, per-role cases) | Map it (Task 3). |
| 2 No role can UPDATE/DELETE append-only tables | Partly: the matrix denies writes per role; the append-only trigger is tested for `control.audit_event` in `foundation.test.ts`. No test enumerates every append-only table. | Task 4, if the executor confirms the gap. |
| 3 TOTP and approved device | Partly: `device-guard.test.ts`, AAL2 cases in several suites. No guard that a new rep-callable function cannot skip the device check. | Task 5. |
| 4 Vault unreadable via the API | Partly: `schema-hygiene.test.ts` "supplier_vault is unreachable for every application role (doc 07 §5.1)". There is no vault migration yet. | Map it; doc 07 section 5.2 to 5.6 are **blocked on P1-05**. |
| 5 Audit chain verifies; mirror nightly | Chain: covered (`foundation.test.ts`, `control.verify_audit_chain()`). Mirror: not built. | Map the chain; mirror is **blocked** and needs MJ's storage account (separate plan). |
| 6 Offboarding in under 10 minutes | Not built (P1-08). | **Blocked on P1-08**; mapped as such. |
| 7 Restore drill | Nothing exists. | Tasks 6 to 9. |
| 8 Dependency and secret scans | Service-role scan exists (`scripts/service-role-scan.mjs`, CI step). No dependency or secret scan. The log check scans added lines in a PR for secret patterns, not the tree. | Tasks 1 and 2. |

## File structure

| File | Responsibility |
|---|---|
| `scripts/dependency-audit.mjs`, `docs/security/audit-exceptions.json` | Fails on high or critical advisories unless an unexpired, reasoned exception exists. |
| `.github/dependabot.yml`, `.gitleaks.toml` | Weekly update PRs; secret-scan allowlist for the public local-stack credentials. |
| `docs/runbooks/launch-security-acceptance.md`, `supabase/tests/launch-acceptance.test.ts` | The criterion-to-evidence index and the test that keeps it honest. |
| `supabase/tests/append-only-sweep.test.ts`, `supabase/tests/function-gates.test.ts` | Catalog guards for criteria 2 and 3. |
| `scripts/backup/manifest.mjs` | `buildManifest`, `compareManifests` (pure parts are unit-tested). |
| `scripts/backup/backup.mjs`, `scripts/backup/restore.mjs`, `scripts/backup/rehearse.mjs` | Encrypted dump, guarded restore, the CI rehearsal driver. |
| `.github/workflows/backup.yml`, `docs/runbooks/backup-restore-drill.md` | Scheduled backup (shipped disabled) and MJ's drill procedure. |

## PR split

| PR | Tasks | Needs from MJ |
|---|---|---|
| A | 1, 2 (scans) | Make the new job required in the ruleset if wanted. |
| B | 3, 4, 5 (acceptance index and guards) | — |
| C | 6, 7, 8, 9 (backup, restore, rehearsal, runbook) | Open questions 1 to 4; a `DECISION` entry before the workflow is enabled. |
| D | 10 (records) | — |

---

### Task 1: Dependency advisory gate

**Files:**
- Create: `scripts/dependency-audit.mjs`, `docs/security/audit-exceptions.json`, `.github/dependabot.yml`
- Modify: `.github/workflows/ci.yml` (new job `dependency-audit`)
- Test: `supabase/tests/dependency-audit.test.ts` (follow `service-role-scan.test.ts`: it runs the script as a subprocess with `spawnSync`, in a throwaway directory, and checks exit code and output)

**Interfaces:**
- Produces: `type Exception = { id: string; reason: string; expires: string }` (`expires` is `YYYY-MM-DD`); `evaluateAudit(report: unknown, exceptions: Exception[], today: string): { ok: boolean; failures: string[] }` exported for reuse. Run directly, the script reads `pnpm audit --json --prod` output on stdin, the exceptions file path from `--exceptions <file>` (default `docs/security/audit-exceptions.json`) and the date from `--today <YYYY-MM-DD>` (default: the current UTC date), prints one line per failure and exits non-zero when `ok` is false.

- [ ] **Step 1: Capture a real sample.** Run `pnpm audit --json --prod` once and save the real output as the test fixture; do not hand-write the JSON shape. Record the pnpm version (`packageManager` in `package.json` is `pnpm@10.33.4`).
- [ ] **Step 2: Write the failing tests** against that fixture, one assertion each:
  - a high or critical advisory with no exception makes `ok` false and the failure names the advisory id;
  - the same advisory with a valid exception makes `ok` true;
  - an exception whose `expires` is before `today` fails and the failure says it expired;
  - an exception with an empty `reason`, or `expires` more than 90 days after `today`, is invalid and fails;
  - moderate and low advisories never fail.
- [ ] **Step 3: Run** `pnpm db:test supabase/tests/dependency-audit.test.ts` — Expected: FAIL. (The tests pass the fixture, exceptions file and `--today` to the subprocess.)
- [ ] **Step 4: Implement** `evaluateAudit` and the CLI wrapper. CI job: `pnpm audit --json --prod | node scripts/dependency-audit.mjs`. `dependabot.yml`: weekly, ecosystems `npm` and `github-actions`, grouped minor and patch updates.
- [ ] **Step 5: Run** the test again — Expected: PASS. If the live audit finds real high advisories, list each in the PR description; do not add exceptions silently.
- [ ] **Step 6: Commit** `ci: dependency advisories fail the build unless excepted with an expiry`.

### Task 2: Secret scan of the whole tree

**Files:**
- Create: `.gitleaks.toml`
- Modify: `.github/workflows/ci.yml` (new job `secret-scan`)

**Interfaces:**
- Produces: a CI job that fails on any committed secret and a canary step that proves it would.

- [ ] **Step 1: Pick the pinned action.** Use the official gitleaks action or a pinned release of the binary, referenced by full commit SHA, and check the current release on the day. Record the version in the log entry.
- [ ] **Step 2: Write the canary.** In the job, before the real scan, create a temporary git repository in `$RUNNER_TEMP`, commit a file containing a token generated at run time (never a literal in this repository) in a pattern gitleaks detects, run the scanner against it, and require a non-zero exit. A scanner that passes the canary is broken.
- [ ] **Step 3: Allowlist exactly the public local-stack credentials** that `ci.yml` already documents as fixed development values, by regex on the value, not by path. Everything else is a finding.
- [ ] **Step 4: Run** the real scan on the full history: `gitleaks detect --config .gitleaks.toml` — Expected: exit 0. Any finding is reported to MJ, not allowlisted.
- [ ] **Step 5: Commit** `ci: secret scan with a canary`. Open PR A (with Task 1).

### Task 3: The acceptance index

**Files:**
- Create: `docs/runbooks/launch-security-acceptance.md`, `supabase/tests/launch-acceptance.test.ts`

**Interfaces:**
- Produces: `type Evidence = { kind: "test" | "ci" | "manual" | "blocked"; ref: string }` where `ref` is `path::exact test title` for `test`, a job name in `.github/workflows/ci.yml` for `ci`, the blocking task id (for example `P1-05`) for `blocked`, and a runbook path for `manual`; `ACCEPTANCE: { criterion: string; evidence: Evidence[] }[]` (criteria `06.10.1` to `06.10.8` and `07.5.1` to `07.5.6`); `checkEvidence(entry: { criterion: string; evidence: Evidence[] }, root: string): string[]` returns one message per broken reference.

- [ ] **Step 1: Write the failing tests:**
  - every `test` reference resolves: the file exists and contains the exact title string;
  - every `ci` reference names a job that exists in `ci.yml`;
  - every `manual` reference is a file that exists;
  - the markdown table in `launch-security-acceptance.md` lists exactly the criteria in `ACCEPTANCE`, in order;
  - a criterion with no evidence fails;
  - the guard itself: `checkEvidence` on a planted reference to a missing file returns a message (the guard is tested, not only run, as in `schema-hygiene.test.ts`);
  - a `blocked` entry is reported in the test output as blocked, never as passing.
- [ ] **Step 2: Run** `pnpm db:test supabase/tests/launch-acceptance.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the index with the mapping from the findings table above. Use the real titles from `rls-matrix.test.ts`, `foundation.test.ts`, `schema-hygiene.test.ts` and `device-guard.test.ts`; read them, do not paraphrase. Criteria 4 (items 2 to 6 of doc 07), 5 (mirror) and 6 are `blocked` with `P1-05`, a new task id for the mirror that MJ assigns, and `P1-08`. Criterion 7 is `manual` pointing at the drill runbook; criterion 8 is `ci` for `dependency-audit`, `secret-scan` and `typecheck + service-role scan`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `tests: launch security criteria mapped to evidence`.

### Task 4: Append-only sweep (only if the gap is real)

**Files:**
- Create: `supabase/tests/append-only-sweep.test.ts`

**Interfaces:**
- Produces: `appendOnlyTables(): Promise<string[]>` returning every table in the five schemas that has a trigger calling the append-only function (read its exact name in `supabase/migrations/20261024223304_foundation.sql` near line 374).

- [ ] **Step 1: Check the gap.** Read `rls-matrix.test.ts` around the per-operation cases and `schema-hygiene.test.ts`. If a test already enumerates append-only tables and attempts UPDATE, DELETE and TRUNCATE as each application role, do not write this task: add that test's title to the Task 3 index and record the finding in the log.
- [ ] **Step 2: Write the failing tests:** for every table from `appendOnlyTables()` and each role in `rep`, `manager`, `owner` and `anon`, UPDATE, DELETE and TRUNCATE all raise (either `permission denied` or the append-only message); a planted table with the trigger removed is reported (the guard is tested).
- [ ] **Step 3: Run** `pnpm db:test supabase/tests/append-only-sweep.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 4: Implement**, using the persona helpers the matrix uses.
- [ ] **Step 5: Run** — Expected: PASS. A real violation found is a defect: report it, do not weaken the test.
- [ ] **Step 6: Commit** `tests: no role can change an append-only table (doc 06 10.2)`.

### Task 5: Every rep-callable function passes a gate

**Files:**
- Create: `supabase/tests/function-gates.test.ts`

**Interfaces:**
- Produces: `GATES: string[]` (the gate helpers found by reading the migrations, for example `app.assert_actor_ready`, `app.self_ok`, `app.assert_office`); `ALLOWLIST: { fn: string; reason: string }[]`.

- [ ] **Step 1: Find the gates.** `grep` the migrations for how existing `app.*` functions check actor, device and role; write the final `GATES` list from that, not from this plan.
- [ ] **Step 2: Write the failing tests:** every function in schema `app` that `authenticated` can execute has a body (`prosrc`) containing at least one `GATES` entry, or appears in `ALLOWLIST` with a reason; every `ALLOWLIST` entry still exists and still lacks a gate (a stale entry fails); a planted function without a gate is reported.
- [ ] **Step 3: Run** `pnpm db:test supabase/tests/function-gates.test.ts` — Expected: FAIL.
- [ ] **Step 4: Implement.** Expected allowlist: functions that must work before a device exists (for example `register_device`, `my_session`); every entry needs a reason a reviewer can check against the function.
- [ ] **Step 5: Run** — Expected: PASS. A function with no gate and no good reason is a finding for MJ.
- [ ] **Step 6: Commit** `tests: a new function cannot skip the device and role gate`. Open PR B.

### Task 6: Backup manifest

**Files:**
- Create: `scripts/backup/manifest.mjs`
- Modify: `package.json` (add `"backup:test": "node --test scripts/backup/*.test.mjs"`, the same shape as the existing `agent:preflight:test`), and the CI job that already runs `agent:preflight:test` (find it in `.github/workflows/agent-compliance.yml` or `ci.yml`) so `pnpm backup:test` runs there too
- Test: `scripts/backup/manifest.test.mjs` (`node --test`, as in `scripts/agent-preflight.test.mjs`)

**Interfaces:**
- Produces: `type Manifest = { createdAt: string; migrations: string[]; tables: Record<string, number>; rlsForced: Record<string, boolean>; authUsers: number; auditHead: { seq: number; hash: string } | null }`; `buildManifest(client: { query(sql: string): Promise<{ rows: unknown[] }> }): Promise<Manifest>` run inside one transaction; `compareManifests(source: Manifest, restored: Manifest): string[]` returns one message per difference and `[]` when equal.

- [ ] **Step 1: Write the failing tests** for `compareManifests` with hand-built manifests: equal gives `[]`; a table count that differs names the table; a missing migration is named; a table whose `rlsForced` went from true to false is named; a different `authUsers` is named; a different `auditHead` is named; `createdAt` alone differing is ignored.
- [ ] **Step 2: Run** `pnpm backup:test` — Expected: FAIL.
- [ ] **Step 3: Implement** both functions. `buildManifest` counts rows of every table in `public`, `control`, `app`-owned tables and `supplier_vault` if present, reads `supabase_migrations.schema_migrations`, `pg_class.relforcerowsecurity`, `count(*)` of `auth.users`, and the last `control.audit_event` row.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `backup: manifest and comparison`.

### Task 7: Encrypted backup and guarded restore

**Files:**
- Create: `scripts/backup/backup.mjs`, `scripts/backup/restore.mjs`
- Test: exercised end to end by Task 8; unit-test only the argument checks here in `scripts/backup/backup.test.mjs`.

**Interfaces:**
- Consumes: `buildManifest`, `compareManifests` (Task 6).
- Produces:
  - `runBackup(opts: { databaseUrl: string; recipient: string; outDir: string; now: () => Date }): Promise<{ file: string; manifestFile: string; sha256: string }>` writes `kiran-<UTC timestamp>.dump.age`, a `.manifest.json` and a `.sha256`. `pg_dump --format=custom --snapshot=<id>` runs against a snapshot exported from the same transaction that builds the manifest, covering schemas `public`, `control`, `app`, `vault_api`, `supplier_vault` (when present) and the `auth` schema data (users, identities, MFA factors, so people can sign in after a restore). Its stdout is piped into `age -r <recipient>` and never written unencrypted.
  - `runRestore(opts: { databaseUrl: string; file: string; identityFile: string; confirmDatabase: string }): Promise<{ seconds: number }>` verifies the `.sha256` first, decrypts through `age -d -i` into `pg_restore` without a plaintext file, and records elapsed seconds.

- [ ] **Step 1: Write the failing argument tests:** `runBackup` rejects a `recipient` that is not an `age1…` public key; `runRestore` rejects when `confirmDatabase` does not equal the database name in `databaseUrl`; both reject when `age` or `pg_dump` is not on the path, with a message naming the missing tool; neither prints the connection string or the identity path content.
- [ ] **Step 2: Run** `pnpm backup:test` — Expected: FAIL.
- [ ] **Step 3: Implement.** Restore refuses a target that already holds tables in `public` (an empty database only) and refuses on a checksum mismatch before decrypting anything. Order of schema restore must satisfy foreign keys from `public` to `auth.users`; settle it in the rehearsal, not by guessing.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `backup: encrypted dump and guarded restore`.

### Task 8: CI rehearsal of the whole procedure

**Files:**
- Create: `scripts/backup/rehearse.mjs`
- Modify: `.github/workflows/ci.yml` (new job `restore-rehearsal`, modelled on the `e2e-stack` job: reserve ports, `supabase start`, seed with `scripts/e2e-stack-seed.mjs`)

**Interfaces:**
- Consumes: Tasks 6 and 7.
- Produces: a driver that prints `dump_seconds`, `restore_seconds` and the manifest comparison, and exits non-zero on any difference or any failed negative case.

- [ ] **Step 1: Write the driver as the failing test.** It generates a throwaway `age` key pair, seeds the source database, runs `runBackup`, creates an empty second database on the same server, runs `runRestore`, builds the manifest of both and requires `compareManifests` to return `[]`, runs `select control.verify_audit_chain()` as `postgres` on the restored database and requires success, and signs in as a seeded user on the restored data (auth rows present).
- [ ] **Step 2: Add the negative cases**, each must fail loudly: a different identity file cannot decrypt; one flipped byte in the `.age` file fails the checksum; restore into a database that already has tables is refused; the backup output directory contains no file that `pg_restore --list` can read directly (no plaintext leaked).
- [ ] **Step 3: Run locally against the CI stack setup** and then in CI — Expected: exit 0, and the printed timings go in the log entry.
- [ ] **Step 4: Commit** `ci: restore rehearsal on the local stack`.

### Task 9: Scheduled backup (shipped off) and the drill runbook

**Files:**
- Create: `.github/workflows/backup.yml`, `docs/runbooks/backup-restore-drill.md`

**Interfaces:**
- Produces: a workflow with `schedule` (daily) and `workflow_dispatch`, gated by `if: vars.BACKUP_ENABLED == 'true'`, reading `secrets.BACKUP_DATABASE_URL`, `secrets.AGE_RECIPIENT`, `secrets.BACKUP_BUCKET_ENDPOINT`, `secrets.BACKUP_BUCKET_KEY` and `secrets.BACKUP_BUCKET_SECRET`. Its last step lists the bucket and fails if the newest object is older than 26 hours or does not match the file just uploaded.

- [ ] **Step 1: Write the workflow** so that no step echoes a secret, the dump goes straight into `age`, only the `.age`, manifest and checksum files are uploaded, and a failed run notifies through the repository's normal workflow failure email.
- [ ] **Step 2: Write the runbook** for MJ, in order: generate the `age` key pair offline and store the private key; set the secrets; record the `DECISION` entry quoting approval (H-19); set `BACKUP_ENABLED`; run the workflow by hand; create a fresh temporary Supabase project; run `restore.mjs` into it with a stopwatch; run the verification (manifest equal, audit chain ok, owner signs in with TOTP, one salon page opens); delete the temporary project; write the drill result in a log entry (date, backup age, dump and restore times, pass or fail). State the pass rule: restore time under 4 hours (NFR-10) and backup age under 24 hours.
- [ ] **Step 3: Check the runbook is executable by someone who did not write it:** every command is copy-pasteable and every placeholder is named.
- [ ] **Step 4: Run** `pnpm activity:check origin/main HEAD`, `pnpm lint` — Expected: pass. The workflow is inert until MJ sets `BACKUP_ENABLED`; confirm it is skipped on the pull request.
- [ ] **Step 5: Commit** `backup: scheduled workflow (off by default) and the drill runbook`. Open PR C.

### Task 10: Records

**Files:**
- Modify: `docs/ACTIVITY.md` (board row P1-12; any new blocker), new entry under `docs/log/`, `docs/plans/README.md`, `SPEC.md` if it names P1-12

- [ ] **Step 1:** Log entry in the repo's format with real command output: test counts, rehearsal timings, scanner versions.
- [ ] **Step 2:** Set P1-12 to PARTIALLY IMPLEMENTED with the open pieces named: vault tests (P1-05), audit mirror, offboarding rehearsal (P1-08), the real drill (MJ). Do not mark it VERIFIED.
- [ ] **Step 3:** Add blockers B-xx for open questions 1 to 5, each with its default.
- [ ] **Step 4:** Run `pnpm activity:check origin/main HEAD`, `pnpm lint`, `pnpm typecheck` — Expected: pass. Open PR D.

## Not in this plan

The nightly audit mirror to write-only storage (doc 06 section 6, criterion 5) needs MJ's storage account and an Edge Function; it is its own plan. The offboarding rehearsal (criterion 6) waits for P1-08. Doc 07 section 5.2 to 5.6 wait for the supplier vault (P1-05). Backing up Storage files waits for open question 5. When the vault exists, the backup design must also settle where the encryption keys live: a `pg_dump` carries ciphertext but not the platform's key material, and a restore into another project may leave it unreadable (to verify, not assumed). The third-party penetration test is Phase 3.

## Self-review (2026-11-09)

- Spec coverage: all eight criteria of doc 06 section 10 and six of doc 07 section 5 appear in Task 3's index; criteria 1, 5 (chain) and the first part of 4 map to existing tests; 2 and 3 get guards (Tasks 4, 5); 7 and 8 get Tasks 1, 2, 6 to 9; 4 (rest), 5 (mirror) and 6 are marked blocked with their blocking task, deliberately.
- Not verified when writing: the output shape of `pnpm audit --json` (Task 1 step 1 captures a real sample), the current gitleaks release and `age` package availability on the CI image (Tasks 2 and 8 check on the day), whether Task 4's gap is real (step 1 checks), the price of PITR (open question 1), and the restore order of the `auth` schema (settled by the rehearsal).
- Types: `Manifest`, `buildManifest`, `compareManifests` are defined in Task 6 and used unchanged in Tasks 7 and 8; `Evidence` and `ACCEPTANCE` are defined and used in Task 3 only.
- Proportion: mostly signatures, test names and decisions; no function bodies.
