# 2026-11-06 15:10 PKT · Claude · Sonnet 5.5 · branch claude/rupees-in-refusals · TASK
**Task:** H4 of the Hermes work order (remaining-implementation plan C3, REP-16, PAY-02; areas: migration 20261106060000, supabase/tests/payments.test.ts)
**What / why:** The one payment refusal a rep sees with a figure, "the payment is more than the salon owes", quoted paisa. app.record_payment is copied unchanged from 20261103210000_office_cash.sql except that line, which now quotes rupees in the format of the two rupee messages in 20261105230000_audit_fixes.sql. Eight office-only messages that also quote paisa are left for MJ. The one existing expectation changed is the line in payments.test.ts that pins this message, as the work order allows, because that message is the thing being changed.
**Evidence:** `pnpm db:test payments office-cash audit-fixes`: 3 files, 147 tests pass. Guard files `pnpm db:test verifier-attacks schema-hygiene rls-matrix`: 3 files, 2900 tests pass. Browser journeys not run locally (no Docker); CI is the first run.
**Next / needs:** CI on the pull request; MJ's OK to merge.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no table or policy touched)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (function copied unchanged except the message)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
