# 2026-11-05 17:01 PKT · Claude · Opus 5.5 · branch claude/p1-30-audit-fixes · TASK
**Task:** P1-30 (fixes from the backend-to-screen wiring audit; D-45 to D-48; CTL-07, CTL-08, CTL-17, PAY-05, PAY-10, CTL-03, INV-03, ORD-02, SEC-13, SEC-16, RPT-01 thin; areas: one forward migration 20261105210000_audit_fixes.sql, its tests, and the screens /office/stock, /office/approvals, /office/deliveries, /office/handovers, /office (home), /office/salons/[id], /app/handovers, the rep money section, the order form and convert, the rep month block)
**What / why:** Session start and claim. Read first: CLAUDE.md, docs/ACTIVITY.md (rules, board, blockers, assumptions; docs/AGENT-COMPLIANCE-PROTOCOL.md does not exist on this tree, as the P1-29 entry also noted), the newest log entries, and the wiring audit (sections Office, Rep app, Salon portal and sign-in, Order-to-money flow). Branch claude/p1-30-audit-fixes from origin/main at 1a053ba, then origin/claude/p1-26-overviews and claude/p1-29-routes-stock merged in (both unmerged slices; one conflict each in docs/ACTIVITY.md and SPEC.md, resolved by keeping both rows). Baseline: pnpm agent:preflight OK, worktree clean.

Not in this slice, by the brief: a product-group screen (audit H5, FLOW-01; another session holds it on claude/product-group-screen); the grouped sidebar, /office/reps/[id], and the invoice and receipt views (slice 10).

Plan, one migration (20261105210000_audit_fixes.sql), tests first for each rule:
1. D-45 (H1, M1, B-42): the owner's own discount takes effect whatever the order's source; the owner's own stock adjustment posts at once through a new append-only record; Withdraw for a pending request by its maker (app.cancel_approval).
2. H2, M8 and the second reader's two dead ends: an adjustment request on a stock location goes to the owner above the threshold; a refused request stays visible with its reason; the missing-goods row shows the right quantity.
3. H4, FLOW-03: credit exposure is what is still owed on installment invoices plus the undelivered value of open installment orders.
4. H7: the stage unblock respects the CTL-08 cap and writes its credit event.
5. D-46: settlement of a disputed handover (owner only), withdrawal of an unanswered one.
6. D-47: the intraday cash cap in the rep's collection; reps over the cap on the office home.
7. D-48: payment reversal, with the payments list on the office salon page (FLOW-13).
8. AUTH-05 and AUTH-01.
9. FLOW-09, FLOW-10, FLOW-11.
**Evidence:** Claim only; evidence follows in additions to this entry.
**Next / needs:** the build.

Addition, the build (2026-11-05 18:13 PKT). In the master prompt's words: IMPLEMENTED, NOT VERIFIED. One forward migration, supabase/migrations/20261105210000_audit_fixes.sql; tests first in supabase/tests/audit-fixes.test.ts (written before the screens, run red, then green).
**What / why:**
- D-45 (H1, M1, B-42). New append-only public.owner_stock_adjustment (RLS enabled and forced, office read only, audit trigger, a guard trigger so only the owner as itself writes it); stock_movement_kind_shape now lets an adjustment movement point at that record instead of an approval, and only that. app.owner_adjust_stock (owner, warehouse or bag) and app.office_resolve_pending (the owner settles goods as missing with no approval; pending_stock_resolution gains owner_adjustment_id, and its check takes one of the two). app.build_order: v_by_owner is now the owner, whatever the channel. Screens: Stock shows the owner "Add opening stock" (at once, reason kept) and the manager the existing request form; Withdraw (app.cancel_approval) on Approvals, Stock and Delivery approvals for a pending request by its maker; the Approvals notice for the owner's own owner-level request now says it would wait and points to the direct way; a manager sees "Waiting for the owner" instead of buttons on owner-level rows (audit M2).
- H2, M8 and the second reader's dead ends. app.office_adjustment_checker (owner or manager) names the checker app.post_adjustment will need; Delivery approvals passes it when it raises a missing-goods request. app.office_pending_stock (dropped and recreated) returns the request's quantity and the newest refused request with its reason; the page fills the quantity from the request, offers a new request when the approved one no longer fits, and shows the refusal. app.office_refused_approvals lists discount and adjustment requests refused in the last 14 days with the checker and reason, shown on Approvals.
- H4, FLOW-03. app.salon_exposure is what is still owed on non-CASH invoices (installment state, reversals counted) plus the undelivered value of confirmed or part-delivered non-CASH orders (app.order_undelivered_paisa). A-10 closed.
- H7. app.office_override_stage: a manager moving a salon out of stage blocked is held to the CTL-08 cap, and every move into or out of blocked writes a block or unblock credit_event (inserted directly, so no salon_credit row is created as a side effect). The salon page explains the limit without a figure.
- D-46. New append-only public.handover_settlement. app.owner_settle_handover (owner only, a disputed handover, outcome counted or rep, reason 5 to 300, replay safe) and app.office_withdraw_handover (owner or manager, an unanswered handover, nothing moves). app.office_count_handover no longer counts settled or withdrawn handovers as blocking; app.rep_respond_handover refuses a withdrawn one; app.my_handovers and app.office_handovers (dropped and recreated) return the settlement, its reason and when. Screens: settle and withdraw on /office/handovers; the rep sees the outcome and the reason on /app/handovers; the rep's dispute wording no longer promises a review that did not exist.
- D-47. app.rep_record_payment refuses a cash collection when the rep's ledger balance plus the amount is over cash.intraday_cap_paisa (23514, in rupees, after a replay check, under the per-rep handover lock; fails closed when the setting is missing or not a number). app.office_cash_cap_reps and two new counts on app.office_overview_counts (reps at the cap, handovers unanswered or disputed) feed the office home's Needs your attention list.
- D-48 (FLOW-05, FLOW-13). New append-only public.payment_reversal (a guard trigger refuses a manager reversing a payment they recorded). app.office_reverse_payment and app.office_salon_payments. Reversed allocations stop counting in control.allocation_guard, app.installment_state, app.office_receivables_ageing, app.receipt_document (the remaining schedule as of the receipt; a reversed key when there is one), app.invoice_document and app.salon_my_account (a reversed key only on a reversed payment, so unreversed rows read as before). Screens: a Payments section on the office salon page (receipt, method, recorder, flags in words, Reverse with a reason, the reversal shown), and "Reversed by the office" in the salon portal's payment list.
- AUTH-05. app.rep_session_ok: a login that redeemed a rep invitation acts as a rep only with an emailed-code session; used in app.rep_device_ok, app.register_device and app.my_session (which returns nothing for such a password token). AUTH-01: app.owner_create_user refuses a login with a salon membership that is not revoked.
- FLOW-09, FLOW-10. app.rep_month_orders, app.my_month_orders, app.office_rep_month (dropped and recreated): delivered value is the total of the order's invoices, waiting value the undelivered value, and placed_count and placed_value_paisa count orders from the rep's own cards (the office home's placed-by rule) beside the assigned orders (A-20 kept). app.office_overview_rows (dropped and recreated) adds undelivered_paisa; the home's waiting rows show what is still to deliver. The rep's month says "Orders assigned to me" and "Orders made from my cards"; Rep performance says "Orders assigned" and adds "Placed from their cards" as the last column. FLOW-11: the order form preselects a salon's own rep, with a note and "No rep" still a choice; one-click Convert of a salon's request carries the salon's own active rep.

Rulings (safe readings; MJ may overrule):
- D-46 ledger. Both outcomes move the cash as an acknowledgment (A-15, which MJ confirmed with no rep debt): the rep's ledger out by the expected amount, the office's in by the counted amount; the outcome records whose the difference is (counted: the rep's, as on an acknowledged handover; rep: the office's). The dispute stores no amount, so "the rep's amount" is the expected figure the rep held. The alternative MJ could choose: under "counted", leave the shortfall as a balance in the rep's cash ledger.
- D-46 withdrawal. The second reader's unanswered-handover case is solved by a withdrawal the owner or the manager may make (nothing moved, so nothing to settle), not by the owner only.
- D-48 cash. The office pool for office cash; for a rep's cash, the rep's ledger while the rep holds it, the office's once a final handover (acknowledged or settled) was counted after the payment, or when the rep's ledger no longer covers the amount. No approval step: D-48 names who may reverse, so the audit's threshold suggestion is not built.
- D-47 compare. Cash held plus the new collection must not pass the cap; a rep exactly at the cap collects nothing more in cash. Bank transfers are not capped. The home lists reps at or over the cap.
- H2 approach. app.request_approval is unchanged: routing inside it broke the existing posting-guard tests (delivery-approval, inventory), which the brief forbids changing; that change was reverted before commit 48f988f. The page asks app.office_adjustment_checker, and app.post_adjustment stays the gate, so a caller that asks the wrong checker meets the old dead end, not a security hole.
- Refused requests stay listed for 14 days.
- AUTH-05 covers invited reps only; reps the owner created are unaffected (the fixture tokens carry no amr claim).

Tests changed where an MJ decision changed the rule: requests-portal, "the owner converting a salon request priced below list", now expects confirmed with no hold under D-45 (the comment in the test says so). No other existing test was changed; office_pending_approvals was left as it was, so the office-approvals tests stand.

Not changed, noted: office_pending_stock can show an older refused request when the newest one was used or withdrawn (a stale refusal line). A password token of an invited rep can still read its own user_profile and device rows (policies keyed on auth.uid() without the device gate), no business data and no write. The existing loops and numbers in rls-matrix.test.ts and the salon page that the editor's pattern hook flags are older code, left alone.
**Evidence:** DATABASE_URL and KIRAN_TEST_DATABASE_URL unset in every shell; embedded Postgres; synthetic data only. Commits 6b49117 (migration and tests), 9f4a1c0 (matrix and allowlist), 48f988f (H2 as a read), 4050fde (refused list, conditional reversal keys, the D-45 portal test), 14db699 (screens), 2d4a9d0 (owner notice, portal mark, docs and board), and the commit carrying this addition.
- pnpm vitest run --config supabase/tests/vitest.config.ts audit-fixes (alone, while developing): 31 passed.
- Batches while developing: rls-matrix verifier-attacks (2646 passed); orders office-orders deliveries payments handovers office-cash receivables-ageing commission overviews (269 passed); audit-fixes office-approvals requests-portal verifier-attacks payments invoice-document (230 passed); requests-portal rep-readonly office-approvals visits reverify4 reverify5 invitations catalogue-prices device-guard (an earlier run of the tree: 5 failed, all fixed in 4050fde and rerun green in the batch before).
- Combined, ONE command, as the brief lists it: pnpm vitest run --config supabase/tests/vitest.config.ts audit-fixes rls-matrix schema-hygiene verifier-attacks reverify3 reverify4 reverify5 orders office-orders deliveries delivery-approval payments handovers office-cash receivables-ageing commission overviews requests-portal rep-readonly office-approvals visits: 21 files, 3150 tests, 3149 passed, 1 failed (1465 s). The failure: reverify4 "DEFECT CHECK (rule 4)", "Test timed out in 120000ms" (142 s), while this builder ran the web build at the same time on this low-memory host; its own output shows the checks it makes returned the expected status. Rerun alone at once: pnpm vitest run --config supabase/tests/vitest.config.ts reverify4: 12 passed. reverify5 passed in the combined run (its UTF-32 observation did not fail this time). The cash cap refused nothing in the other files: every collection there stays under Rs 50,000 per rep between handovers.
- pnpm typecheck: pass. pnpm lint: pass, 36 warnings, 43 infos. pnpm exec biome check --diagnostic-level=error: no errors.
- NEXT_PUBLIC_SUPABASE_URL=https://ci-placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-placeholder pnpm -C apps/web build: exit 0.
- pnpm service-role:scan: OK, 96 files; node scripts/service-role-scan.mjs --bundle apps/web/.next/static: OK, 151 files.
- E2E check by reading: no e2e-stack journey or scripts/e2e-stack-seed.mjs sets a salon's direct rep (so the FLOW-11 preselect changes no journey), and the journeys collect Rs 100 at a time, far under the cap. The strings the journeys assert on Stock, Approvals and Handovers ("Ask for opening stock", "You asked for this; another office user decides it.", office-cash) are kept for the manager.
- node scripts/activity-log-check.mjs origin/main: OK (5 new log entries). pnpm agent:preflight: PREFLIGHT OK.

Not run here: apps/web/e2e-stack (no Docker on this host; CI only), so no new screen has been exercised in a browser. The rest of the database suite beyond the files named. Nothing pushed, merged or applied to any Supabase project.

DoD (section 6):
[x] Requirement IDs implemented as written for D-45 to D-48 and the listed findings; differences are the rulings above
[x] Migration forward-only; applies to a fresh database (every test run applies all migrations)
[x] New tables have RLS enabled and forced, policies, and rows in the RLS matrix (rep own, rep other, manager, owner, AAL1, suspended, anon)
[x] Append-only: the three new tables have the forbid_mutation triggers; the RLS matrix proves app roles cannot write them, and audit-fixes proves the table owner's UPDATE or DELETE is refused by the trigger
[x] Mutations through security definer functions with search_path pinned and client_id replay tested
[x] Audit triggers on the new tables
[x] No vault data touched
[ ] Offline: not done (P1-09)
[x] Integer paisa throughout; no browser arithmetic on money beyond showing the database's figures
[ ] Lint, typecheck and the database suites pass locally; CI not yet run (so not DONE)
[x] Docs (doc 09, doc 12, SPEC.md) and the board updated; A-10, A-15, A-20, B-42 and P1-07 updated
[x] No secrets, real personal or supplier data in the diff (read)
[x] This entry holds the evidence

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15): handover settlement and the direct adjustment are owner only; reversal follows D-48
[x] No control weakened, skipped or "temporarily" disabled (H-16): maker-checker between two people is unchanged; the owner's direct path is MJ's D-45; the posting guard stays the gate for adjustments
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)
**Next / needs:** CI on the pushed branch (MJ pushes), including the e2e-stack journey; MJ to confirm the D-46 and D-48 rulings and the decision wording in 2026-11-05-mj-audit-decisions.
