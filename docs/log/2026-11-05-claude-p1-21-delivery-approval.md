# 2026-11-05 01:03 PKT · Claude · Opus 5.5 · branch claude/p1-21-delivery-approval · TASK
**Task:** P1-21 (completion slice 4; ORD-03, ORD-04, ADM-03, SEC-11, CTL-05; D-32, D-31, D-30, A-16, A-18, L-0163, L-0385; areas: stock_location kind pending_delivery, stock_movement kinds submitted_to_salon and pending_returned, delivery_submission, delivery_submission_decision, pending_stock_resolution, invoice.delivered_by and commission_rep_id, app.finalise_delivery replacing app.deliver, app.rep_submit_delivery, app.rep_deliver closed, app.office_approve_delivery, app.office_reject_delivery, app.office_resolve_pending, app.office_post_adjustment, app.office_create_location, app.office_deliver, app.cancel_order, reads app.my_submissions, app.office_pending_deliveries, app.office_pending_stock; DB test fixtures that delivered through rep_deliver; rep Deliver and My deliveries pages; office Delivery approvals page; stack seed and stack test)
**What / why:** Build slice 4 of the project completion plan from docs/superpowers/plans/2026-11-04-delivery-submission-approval.md (MJ accepted every recommended default of its decisions table on 2026-11-04). Migrations 20261105130000 (enum values alone, Decision 7) and 20261105130100 (everything else). Work in progress; this entry grows with each commit.
**Evidence:** In progress. DATABASE_URL unset; embedded Postgres, one test command at a time.
- Task 1 (schema): pnpm exec vitest run --config supabase/tests/vitest.config.ts delivery-approval: first attempt hit the known No test files found and Unknown Error setup flake, rerun: 6 passed. Then rls-matrix schema-hygiene verifier-attacks inventory in one command: 4 files, 2157 passed.
**Next / needs:** Tasks 2 to 10 of the plan.

Security checklist (tick honestly):
[ ] RLS enabled+forced; policies + role×table tests added/updated (H-13)
[ ] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[ ] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[ ] Audit trigger present; hash chain verifies (H-17)
[ ] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[ ] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[ ] Governance powers still owner-only + AAL2 (H-15)
[ ] No control weakened, skipped or "temporarily" disabled (H-16)
[ ] Docs match code; deviations logged (H-25)
[ ] Tests actually run; real results recorded (H-23, H-24)
