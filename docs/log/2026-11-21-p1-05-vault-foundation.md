# 2026-11-21 23:35 PKT · AutoClaw (cluster agent, slice C0) · AutoClaw runtime · branch feat/p1-05-vault-foundation · TASK
**Task:** P1-05, first slice adoption per docs/plans/in-progress/2026-11-21-execution-handoff.md section 2 C0 (the vault foundation worktree; areas: the snapshot only this wave, the security review of migration 20261121150000 against doc 07, docs/log, docs/ACTIVITY.md section 14)

**What / why:** Adopt the vault worktree, preserve the previous session's uncommitted work, and run the security review the work order asks for instead of blind implementation: the migration versus doc 07's encryption requirement, with the options put to MJ. No encryption is implemented this wave.

Guards (before any touch): git status showed exactly the uncommitted set the handoff expects (layout and office nav modified, lib rpc modified, three supabase test files modified; the office vault page directory, migration 20261121150000_vault_suppliers.sql and vault-suppliers.test.ts untracked). The three newest file mtimes were the vitest results cache at 2026-11-21 08:58:05 PKT, the apps/web tsbuildinfo at 08:57:18 and vault-suppliers.test.ts at 08:55:53, all about 14 hours before the guard ran (23:07 to 23:08 PKT); no file was modified within the last 3 hours, so the worktree was cold and the snapshot went ahead.

Snapshot: commit a6ecdc7 "snapshot: uncommitted work found in the worktree, 2026-11-21 (preserved before continuation)", 10 files, 1042 insertions and 15 deletions, pushed as origin/feat/p1-05-vault-foundation; the branch did not exist on origin before, so nothing of the previous session can now be lost. origin/main was then merged in (merge commit 77b4b32, no conflicts) so the branch carries the same log files main already merged and the activity check passes.

Security review, not blind implementation: the migration creates supplier_vault.supplier with name, contact_name, phone and note as plain text columns. Doc 07 line 23 requires column encryption for identity and cost fields with a *_enc suffix using pgsodium and a key stored in Supabase Vault, and doc 07 section 5 acceptance test 3 requires a database dump opened without the key to show ciphertext in every *_enc column. The snapshot carries strong compensating controls instead: supplier_vault is not in the PostgREST exposed schemas (no REST surface at all), RLS is enabled and forced with no policies written (deny by default), the only door is three vault_api SECURITY DEFINER functions that check app.has_vault_grant() (an active profile, owner or granted manager, at AAL2), the append-only vault_access_log requires a purpose and replays by client_id (H-08), and the audit trigger's row images are redacted for supplier_vault in control.audit_row (DA-033) so no vault value reaches control.audit_event while the hash chain still extends (H-17). What the snapshot does not give is the dump-ciphertext guarantee: a full database dump or a leaked backup file yields plain text, which is exactly the threat doc 07 names. Because doc 07 is MJ's to change (H-26), the choice is not an agent's: BLOCKER B-63 records the three options (plain-text DEVIATION, pgcrypto pgp symmetric encryption, full pgsodium parity) and the draft pull request carries the brief.

Extension availability, verified on this host: the embedded Postgres the db suite uses (npm embedded-postgres; the installed package is @embedded-postgres/windows-x64 17.9.0-beta.17 under the vault worktree's node_modules) ships pgcrypto (native/share/extension/pgcrypto.control, native/lib/pgcrypto.dll and its version sql files) and does NOT ship pgsodium (no file in the whole dependency tree matches the name). The root package.json declares embedded-postgres for CI (17.9.0-beta.16 on this branch); CI's runner installs the linux-x64 package of the same npm family, and the pull request's database job is the direct CI-platform proof of that variant.

**Evidence:**
- Guards and snapshot: the status and mtime listings above; snapshot commit a6ecdc7 pushed; merge commit 77b4b32 of origin/main.
- Reads: supabase/migrations/20261121150000_vault_suppliers.sql in full; docs/07-supplier-confidentiality.md line 23 and section 5.
- pnpm lint (biome ci): exit 0, 249 files, 42 warnings and 38 infos, all pre-existing baseline (the snapshot's own files included).
- pnpm -C apps/web typecheck: exit 0.
- node scripts/agent-preflight.mjs: PREFLIGHT OK, worktree clean.
- node scripts/activity-log-check.mjs: OK after the entries and the section 14 blocker row of this slice.
- Not run: pnpm db:test (forbidden on this host per the handoff) and with it supabase/tests/vault-suppliers.test.ts, the previous session's own db test file; no CI run read yet (the draft PR opens it). No migration, function or encryption work was done this wave, per the work order.

**Next / needs:** MJ answers B-63 (the three options are in the BLOCKER entry and the draft PR body); the next wave implements the chosen option on this branch, and only then continues the vault slices. The sheet half of C0 and the board row P1-43 live on feat/office-sheet-import (pull request 135).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies and role x table tests added/updated (H-13) - n/a this wave, no database object touched by me; the snapshot's tables carry RLS enabled and forced
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) - n/a this wave; the snapshot's access log carries the append-only triggers
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) - n/a this wave; the snapshot's vault_api functions match this shape
[x] Audit trigger present; hash chain verifies (H-17) - n/a this wave; the snapshot redacts vault row images (DA-033)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) - n/a this wave; no fixture data added by me
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20) - my diff is log entries and one board row; no keys, no real names
[x] Governance powers still owner-only + AAL2 (H-15) - n/a this wave; the snapshot's grant function stays owner-only
[x] No control weakened, skipped or temporarily disabled (H-16) - nothing weakened; the encryption question is escalated, not bypassed
[x] Docs match code; deviations logged (H-25) - the plain-text deviation from doc 07 line 23 is NOT silently kept: it is escalated as B-63 with options, per the work order
[x] Tests actually run; real results recorded (H-23, H-24) - the lint, typecheck, preflight and activity results above; the db suite is listed as not run with the reason
