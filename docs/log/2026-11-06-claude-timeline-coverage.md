# 2026-11-06 21:36 PKT · Grok · Grok 4.7 · claude/timeline-on-main · TASK

**Task:** H2 (C2; migration `20261106040000_timeline_coverage.sql`, `supabase/tests/audit-fixes.test.ts`, `docs/06-security-plan.md`, `docs/plans/in-progress/2026-11-05-remaining-implementation.md`), per `docs/plans/in-progress/hermes.md`.

**What / why:** The salon and order timelines now include four more tables: delivery_submission, delivery_submission_decision, delivery_signature and payment_reversal. Labels are fixed strings (delivery submitted, delivery approved or rejected, receipt acknowledgement with the outcome as detail, payment reversed). The three functions are replaced with the same arguments and return types, so no grant changed and no function name was added. SPEC.md names only functions, not tables, so it is unchanged. The test sits in audit-fixes.test.ts, not rep-readonly-timelines.test.ts, because the delivery fixtures (warehouse, bag, stock, credit) exist only there. The reversal call matches the argument order of the existing test.

**Deliberately not done:** commission_payment, rep_commission_rate, handover_settlement, pending_stock_resolution, delivery_signature_use, delivery_signature_image, delivery_signature_access, and every stock, location, vault and investor table. They name neither a salon nor an order, or hold pictures. Commission and handover settlements would need a rep timeline and wait for MJ.

**Landing:** pull request 82 merged commit 9ce874f into claude/stale-refused-request, not into main, so migration 20261106040000 was absent from main at f0a8e8e. This branch cherry-picks that commit onto origin/main. Later migrations 20261106050000, 20261106060000 and 20261106070000 do not replace these three functions. No lint edits from the old checkout are included.

**Evidence:** Re-run on branch claude/timeline-on-main, base f0a8e8e. Windows pnpm. Embedded Postgres. KIRAN_TEST_DATABASE_URL and DATABASE_URL were removed from the test process and their values were not read. No Docker, so no office stack journey locally.
- pnpm agent:preflight: PREFLIGHT OK.
- pnpm db:test audit-fixes rep-readonly-timelines: 2 files, 102 passed (audit-fixes 62, rep-readonly-timelines 40).
- pnpm db:test verifier-attacks schema-hygiene rls-matrix: 3 files, 2900 passed (rls-matrix 2843, schema-hygiene 14, verifier-attacks 43).
- pnpm typecheck: exit 0.
- pnpm lint: exit 0 (195 files, 39 warnings, 43 infos; none in the files this branch changes).
- Not repeated: the absence check that fails the two new tests when the migration file is moved away. It passed on the original branch.

**Next / needs:** pull request into main. H3 to H10 are already on main. Open pull request 97 edits other rows of the same plan file and does not change the timeline row.

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
