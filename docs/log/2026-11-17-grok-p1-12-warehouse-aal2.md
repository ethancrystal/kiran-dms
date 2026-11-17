# 2026-11-17 14:06 PKT · Grok · grok-4.7 · branch claude/p1-12-acceptance-guards · TASK
**Task:** P1-12 (NFR-07, NFR-12, SEC-10; doc 06 section 10.3). Areas: supabase/migrations/20261117120000_warehouse_availability_office_aal2.sql, supabase/tests/function-gates.test.ts, supabase/tests/helpers/launch-acceptance.ts, supabase/tests/launch-acceptance.test.ts, docs/runbooks/launch-security-acceptance.md
**What / why:** app.warehouse_availability() answered an owner or manager at AAL1, because its only filter was app.self_ok() and that check is true for every active office profile. The replacement is plpgsql. A rep still goes through app.self_ok() and an unapproved device still sees no rows. Everyone else goes through app.assert_office(), which requires an MFA-verified session. The two checks are separate branches, because assert_office raises and a raise inside the old SQL filter would abort the query for a rep. The signature and the grants from 20261028050000 are unchanged. Criterion 06.10.3 is met in the index. The board row stays NOT STARTED. Nothing is committed.
**Evidence:** pnpm agent:preflight: PREFLIGHT OK on branch claude/p1-12-acceptance-guards, 8 existing changes preserved. pnpm db:test of function-gates.test.ts, launch-acceptance.test.ts and inventory.test.ts together: inventory 25 passed; launch-acceptance 14 passed and 10 todo (the 06.10.3 defect todo is gone); the AAL2 baseline and the AAL1 office check both passed. One planted-gate case timed out at 30000ms while the three files shared the database. Re-run of that case alone: passed in 20895ms. pnpm db:test supabase/tests/function-gates.test.ts alone: 19 passed. Biome check on the three TypeScript files: no fixes. Not run: full pnpm lint, the GitHub Actions jobs, and any hosted database. The secret-scan job is still expected to fail on the historical fixture findings until MJ rules.
**Next / needs:** MJ's say-so to commit and push. Criterion 06.10.8 stays partial. Backup and restore (P1-12 tasks 6 to 9) stay unbuilt. No payment collector is added (B-62).

**Self-verification:** the builder is the author of this entry. This is not an independent verification.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role x table tests added/updated (H-13) (n/a: no table or policy)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (n/a)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (read function, security definer, search_path empty; no write)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) (n/a: quantities and sku code only)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (office read now requires AAL2)
[x] No control weakened, skipped or temporarily disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)
