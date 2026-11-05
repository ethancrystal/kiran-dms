# 2026-11-05 14:06 PKT · Claude · Opus 5.5 · branch claude/p1-25-office-ops · TASK
**Task:** P1-25 (completion slice 8: office operations screens and the end-to-end journey; ORD-03, ORD-04, ORD-02, CTL-07, SEC-11, INV-02, INV-03, CTL-05; D-30, D-32, A-08, A-18; areas: new read app.office_pending_approvals (migration 20261105170000), screens /office/orders/[id], /office/approvals, /office/stock, /app/stock, the office nav, the stack test and its seed)
**What / why:** Session start and claim. Read first: CLAUDE.md, docs/ACTIVITY.md in full, docs/16-project-completion-goal.md, the completion design spec (section 7), docs/superpowers/plans/2026-11-05-final-review-checklist.md, docs/superpowers/plans/2026-11-05-frontend-structure.md and MJ's answers 2026-11-05-mj-frontend-structure, and the TASK entries of slices 4 to 7. Branch claude/p1-25-office-ops from local claude/p1-23-portal with claude/p1-24-rep-readonly (slice 7, local) merged, then origin/main d92191d (PR 63, slice 6) merged. Nothing is pushed; MJ approves pushes and merges.

The gap, checked by grep of apps/web: no page calls app.office_deliver, app.cancel_order, app.office_release_credit_hold, app.recheck_order, app.office_create_location, app.office_propose_stock_issue, app.office_cancel_stock_issue, app.office_post_adjustment or app.rep_confirm_stock_issue, and app.decide_approval is called only for missing-goods adjustments on /office/deliveries. So a rep-less order (manager-direct or a converted salon request) cannot be delivered from the UI (A-18), a held order has no exit, and a newly invited rep cannot get stock without seed SQL. The browser cannot read control.approval_request (the control schema is not exposed, B-18), so the approvals queue needs one read function; everything else reads through existing RLS or functions.

Plan: (1) migration 20261105170000 with app.office_pending_approvals only, test first; (2) /office/orders/[id]: deliver from a warehouse (lines and quantities), cancel with a reason, release a credit hold, recheck, timeline; (3) /office/approvals: approve or refuse pending discount and adjustment requests through app.decide_approval, then app.recheck_order for a discount; (4) /office/stock: locations (warehouse, rep bag for the owner, A-08), stock on hand, opening stock by an approved adjustment, propose and cancel stock issues; (5) /app/stock: the rep confirms an incoming issue with its own count; (6) the end-to-end journey in apps/web/e2e-stack. Reuses existing functions; A-18 is the existing assumption for rep-less delivery (no new row).
**Evidence:** Claim only; evidence follows in additions to this entry.
**Next / needs:** the build, then the checks named in the brief.

Addition, the build (2026-11-05 14:28 PKT). In the master prompt's words: IMPLEMENTED, NOT VERIFIED.
**What / why:** Built as planned in the claim, on the screens the frontend structure plan names (S-A stock, S-D2 approvals queue, the order detail page /office/orders/[id] of its route table); nav entries Approvals and Stock added to the existing flat office nav (the grouped sidebar F3 to F5 is not built here and the new pages need no change for it). English only (D-42): no Urdu in any new screen; the existing Urdu on /app and in components/money-section.tsx is left as it is (not this slice).
- Migration 20261105170000_office_pending_approvals.sql: app.office_pending_approvals only (owner or manager at AAL2, security definer, search_path empty, granted to authenticated). Pending discount and adjustment requests, plus approved adjustments on a warehouse or bag that no movement has used yet; allow-listed fields (order figures from the order row, location, SKU code, quantity; never the raw payload); newest 200.
- /office/orders/[id]: lines with delivered and left (app.order_remaining), invoices, status and holds; deliver from a warehouse (app.office_deliver, lines and quantities, received-by name, one client id per open form kept until success; it still finalises through app.finalise_delivery, slice 4 and 5 body unchanged); cancel with a reason (app.cancel_order); release a credit hold (app.office_release_credit_hold, shown only on a draft with a credit hold and no release); recheck (app.recheck_order); the order timeline. The order list links each row to it (aria-label names the salon and total, so no new row carries the salon name).
- /office/approvals: approve or refuse through app.decide_approval; the maker sees no buttons (the database refuses the maker anyway); after a discount decision the page calls app.recheck_order and shows the order's status as returned (decide_approval itself re-runs nothing: checked in office-approvals.test, the order stays draft until rechecked).
- /office/stock: locations; add a warehouse; add a rep bag with its value limit (form shown to the owner only, A-08; the database refuses others); stock on hand (app.stock_on_hand); opening stock as an adjustment request (app.request_approval), decided on Approvals, then Post to stock (app.office_post_adjustment); propose a stock issue to a bag (app.office_propose_stock_issue, CTL-05 limit and availability checked by the database); cancel a pending or disputed issue (app.office_cancel_stock_issue).
- /app/stock (link on /app): the rep's pending incoming issues (stock_issue under RLS, own bag only) and app.my_bag; confirm with app.rep_confirm_stock_issue.

Rulings (safe defaults; MJ may overrule):
- A-18 (rep-less orders are delivered by the office from a warehouse) is used as written; no new assumption row.
- The rep's count is blind: the fields start empty and the office's quantities are not shown, so the confirmation is a second count, not a rubber stamp (the issue row stays readable under RLS, so this is a screen choice, not a control).
- The Approvals queue lists only discount and adjustment kinds (the only kinds Phase 1 code creates); missing-goods adjustments on a pending-delivery location stay on Delivery approvals once approved.
- Credit holds have no approval request: they are released directly by app.office_release_credit_hold as the database already rules; nothing added.
- B-42 raised (board section 14): an owner converting a salon request discounted above the owner threshold makes an owner-only request the owner cannot decide (maker is not checker). Left as built.

Stack tests (apps/web/e2e-stack/office.spec.ts; seed gains journeyRep and journeySalon logins with no profile): (1) before the check-out test, the delivery-approval boundary: Rep One submits 1 more unit; no new invoice, no new sale movement, the order status unchanged; no Approve control on the rep's phone; app.office_approve_delivery with the rep's own claims is 42501; the manager approves in the browser: exactly one invoice and one sale movement more; a second approval with a new key is 55000 and adds nothing. (2) after the check-out test, the end-to-end journey (steps of the final review checklist, its differences written in that file's new section 5): invite a rep and a salon and redeem both (code sessions), a [Dummy] product at Rs 100, opening stock of 10 asked by the manager and approved and posted by the owner, the owner's bag for the new rep, an issue of 2 to Rep One's bag confirmed on /app/stock, the owner approving the slice 2 test's held discount (order confirmed), the salon requesting 3, one-click conversion, the office delivering from the warehouse (invoice INV-, Rs 300, warehouse left 5), the order and salon timelines, no commission for a rep-less order (Rep One's owed unchanged), a Rs 100 cash payment and the salon's balance moving by Rs 300 minus Rs 100 on both the office and salon pages, a direct order cancelled with a reason, an investor added; the rep reaches no office stock page. (3) signed-out redirects for /office/stock and /office/approvals. Locators were checked by reading for strict-mode collisions: every new label is unique on its page, new nav links use exact names, row filters combine the salon with the total where a salon has two orders.
**Evidence:** DATABASE_URL and KIRAN_TEST_DATABASE_URL unset in every shell; embedded Postgres; synthetic data only. Commits: d3b8036 (claim), e3ea6de (migration, office-approvals.test.ts, verifier-attacks allowlist), d82872a (order page, Approvals), 2efa7e5 (Stock, /app/stock), 243a992 (stack tests, seed), c361551 (docs, board, B-42), and the commit carrying this addition.
- Test first: pnpm vitest run --config supabase/tests/vitest.config.ts office-approvals with the migration moved out: 16 failed, 2 passed of 18; with it: 18 passed.
- office-approvals verifier-attacks schema-hygiene reverify3 (after the allowlist line): 4 files, 86 passed.
- Combined, ONE command: pnpm vitest run --config supabase/tests/vitest.config.ts office-approvals orders office-orders deliveries delivery-approval office-order-access requests-portal rep-readonly inventory rls-matrix schema-hygiene verifier-attacks reverify3 visits: 14 files, 2823 passed, 0 failed.
- pnpm typecheck: pass. pnpm exec biome check --diagnostic-level=error: no errors (144 files). pnpm lint: pass, 36 warnings and 42 infos (the slice 6 and 7 counts).
- pnpm -C apps/web build with the CI placeholder public settings: pass; routes include /office/orders/[id], /office/approvals, /office/stock, /app/stock.
- CI=true pnpm -C apps/web test:e2e: 4 passed. pnpm service-role:scan: OK, 86 files; node scripts/service-role-scan.mjs --bundle apps/web/.next/static: OK, 137 files. node --check scripts/e2e-stack-seed.mjs: exit 0.
- node scripts/activity-log-check.mjs origin/main and pnpm agent:preflight: in the addition below.

Not run here: apps/web/e2e-stack (no Docker on this host; CI only), so the boundary test, the journey and every new screen are unexercised in a browser. Release of a credit hold has no browser step (it needs an installment plan over a credit limit; covered by the existing database tests of app.office_release_credit_hold). The rest of the database suite and the reverify suites other than reverify3. Nothing was pushed, merged or applied to any Supabase project.

Overlaps with docs/superpowers/plans/2026-11-05-frontend-structure.md: S-A (stock screens: on hand, issue and confirm, adjustments; availability, low stock, reorder points, counts and the lost-demand tap are still to do), S-D1 (the boundary stack test it asks for is this slice's test 1), S-D2 (the approvals queue read it says is missing now exists; the digest does not), and its /office/orders/[id] row (now built). The rep-detail page is not touched.

DoD (section 6):
[x] Requirement IDs implemented as written for the office screens; differences listed above
[x] Migration forward-only; applies on a fresh embedded database after every earlier migration
[ ] No new table (RLS matrix unchanged); the new function is tested for both reps, wrong device, suspended, AAL1 office, anon and a login with nothing redeemed
[ ] Append-only: no new table (n/a)
[x] Mutations through the existing security definer functions; replay of the post and of the approval decision tested; each screen keeps one client id per open form
[x] Reading writes no audit row (tested); writes are audited by the existing triggers
[x] No vault data; the queue never returns the request payload (tested)
[ ] Offline: n/a (office screens online; the rep's stock confirmation is online, as the function was)
[x] Money in integer paisa; no browser arithmetic on balances or stock (the journey's expected figures are hand-worked in the test)
[ ] Lint, typecheck, touched DB suites pass locally; CI not yet run (so not DONE)
[x] Docs (SPEC.md, doc 03, doc 06, the checklist) and the board updated
[x] No secrets, real personal or supplier data in the diff (read)
[x] This entry holds the evidence

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no new table; the new read refuses every non-office persona, tested)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (rep bags stay owner-only, A-08)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)
**Next / needs:** CI on a pull request (MJ decides when to push), above all the e2e-stack job with the new journey. MJ: B-42; confirm A-18 (open); the blind count ruling. A later forward migration extends the timeline maps to the slice 4 and 5 tables (checklist section 1).