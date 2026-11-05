# 2026-11-05 08:15 PKT · Claude · Opus 5.5 · branch claude/p1-23-portal · TASK
**Task:** P1-23 (completion slice 6; ORD-01, ORD-11 to ORD-15, SAL-12, SEC-14, SEC-15; D-34, D-41; areas: order_intake_card and its close table, new order_intake_card_line and order_intake_card_version, app.rep_create_card, app.my_cards, app.office_open_cards, app.office_create_order, new app.rep_edit_card, app.rep_cancel_card, app.salon_submit_request, app.salon_edit_request, app.salon_cancel_request, app.salon_catalogue, app.salon_my_requests, app.salon_my_orders, app.salon_my_account; screens /salon, /office/orders, the rep card form, /app/cards; the stack test and its seed; docs 03, 04, 06, 10, 12, SPEC.md, the board row P1-23)
**What / why:** Session start and claim. Slice 6 of docs/superpowers/plans/2026-11-05-project-completion.md: one Requests queue for rep and salon submissions, with product lines, edits as versions and cancel before the office reviews; one-click convert through app.office_create_order (channel salon_portal for salon requests), prices only from the database; the salon portal (catalogue with pictures and the salon's own prices, basket, requests, orders, balance and payments), every salon read resolved from the active membership. Read first: CLAUDE.md, docs/ACTIVITY.md, the 20 newest docs/log entries, docs/16-project-completion-goal.md, the design spec (rulings R1 to R9, sections 3, 4, 7) and the plan's slice 6 section. Branch claude/p1-23-portal from origin/main 903cd29, in this session's worktree; migration 20261105150000_requests_portal.sql. Slices 4 and 5 (local branches claude/p1-21-delivery-approval, claude/p1-22-commission) are not on main; this slice redefines none of their functions (cancel_order, rep_deliver, office_deliver, finalise_delivery) and keeps its edits to shared lists additive. Database test first.
**Evidence:** Baseline: pnpm install (frozen lockfile) done; pnpm agent:preflight PREFLIGHT OK, worktree clean. Results follow in additions below.
**Next / needs:** build the slice; evidence and the security checklist in this entry.

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
