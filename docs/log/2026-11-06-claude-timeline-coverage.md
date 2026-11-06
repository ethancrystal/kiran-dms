# 2026-11-06 11:55 PKT · Claude · Sonnet 5.5 · claude/timeline-coverage · TASK

**Task:** H2 (C2; migration `20261106040000_timeline_coverage.sql`, `supabase/tests/audit-fixes.test.ts`, `docs/06-security-plan.md`, `docs/plans/in-progress/2026-11-05-remaining-implementation.md`), per `docs/plans/in-progress/hermes.md`.

**What / why:** The salon and order timelines now include four more tables: delivery_submission, delivery_submission_decision, delivery_signature and payment_reversal. Labels are fixed strings (delivery submitted, delivery approved or rejected, receipt acknowledgement with the outcome as detail, payment reversed). The three functions are replaced with the same arguments and return types, so no grant changed and no function name was added. SPEC.md names only functions, not tables, so it is unchanged. The test sits in audit-fixes.test.ts, not rep-readonly-timelines.test.ts, because the delivery fixtures (warehouse, bag, stock, credit) exist only there. The reversal call matches the argument order of the existing test.

**Deliberately not done:** commission_payment, rep_commission_rate, handover_settlement, pending_stock_resolution, delivery_signature_use, delivery_signature_image, delivery_signature_access, and every stock, location, vault and investor table. They name neither a salon nor an order, or hold pictures. Commission and handover settlements would need a rep timeline and wait for MJ.

**Stacking:** this branch is stacked on claude/stale-refused-request (PR 81, open, CI green), because both edit audit-fixes.test.ts. It must be merged after PR 81, and the pull request shows PR 81's commits until then.

**Evidence:** Run through Windows pnpm (WSL cannot load the rolldown binding); embedded Postgres; no Docker, so no stack journey locally.
- `pnpm db:test audit-fixes rep-readonly-timelines`: 2 files, 102 of 102 passed (audit-fixes 62, rep-readonly-timelines 40, whose leak test passed unchanged).
- Red check: with the migration moved away, `pnpm db:test audit-fixes -t "timelines cover"` failed 2 of 2 new tests; restored, they pass.
- `pnpm db:test verifier-attacks schema-hygiene rls-matrix`: 3 files, 2900 of 2900 passed.
- `pnpm typecheck`: exit 0. `pnpm lint`: exit 0 (24 warnings, 43 infos, none in these files). CI results are not yet recorded.

**Next / needs:** commit, push, open the pull request after PR 81 merges or stacked on it; then H3.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role x table tests added/updated (H-13) (n/a: no table; rls-matrix passes unchanged)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (n/a: read-only functions)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (read-only; security definer and search_path empty kept)
[x] Audit trigger present; hash chain verifies (H-17) (n/a: read-only)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) (the new test checks no reason, name, token, hash or purpose leaks)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged; both functions still start with app.assert_office())
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)
