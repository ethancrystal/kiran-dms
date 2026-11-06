# 2026-11-06 07:43 PKT · Claude · Fable 5.1 · branch claude/m7-suspended-cash · TASK
**Task:** audit M7 (plan C2): cash held by a suspended or offboarded rep is visible to the office (areas: supabase/migrations/20261106020000_inactive_rep_cash.sql, apps/web/app/office/(shell)/handovers/page.tsx, supabase/tests, apps/web/e2e-stack/p130-screens.spec.ts)
**What / why:** The count form on Cash handover lists only active reps, and a rep who is suspended or has left cannot answer a count on their phone (A-15), so cash still on such a rep's ledger was invisible. Added the read app.office_inactive_rep_cash (owner or manager at AAL2; rep, status, amount from the cash ledger; largest first, 100) and a section on Cash handover that lists those reps with the amount and says how to count one (make the rep active again on People). Nothing is counted or moved: bringing in the cash of a rep who can no longer answer would be a new way for cash to move, which is MJ's decision, so "countable" in the plan line is NOT built and the plan row says so. Checked for overlap first: no open pull request or branch touches handovers, and the Main branch review session confirmed it is not working there.
**Evidence:** pnpm vitest run --config supabase/tests/vitest.config.ts audit-fixes verifier-attacks schema-hygiene rls-matrix: 2957 passed, 1 failed (my own test tried to reactivate an offboarded rep, which the database refuses as final; the test was corrected); rerun of the M7 tests: 3 passed. pnpm typecheck: pass. Biome: no errors. Not run locally: the stack journeys, including the new browser check (no Docker on this host); CI is the first run. Not applied to any hosted project.
**Next / needs:** CI on the pull request; MJ's OK to merge. MJ's decision on counting cash of a rep who cannot answer.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no table added; the function is in the grant allowlist test and the AAL1 and salon-login refusal test)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (no table touched)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (a read only; search_path pinned)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged; the read needs owner or manager at AAL2)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
