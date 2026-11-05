# Frontend structure plan

Status: DRAFT FOR REVIEW, 2026-11-05. MJ approved the direction and the corrections below in chat on 2026-11-05 (recorded in `docs/log/2026-11-05-mj-frontend-structure.md`). This plan is the architectural roadmap for the three applications. It is not a second phase plan: it sits under `docs/superpowers/plans/2026-11-05-project-completion.md` (slices P1-18 to P1-24), the decision register (doc 12) and the status board (ACTIVITY §12), and it reopens none of their decisions (D-30, D-31, D-32, D-34 to D-42 and the others stand). It authorises no new role, permission, financial term, phase change or production action. Where it disagrees with `docs/16-project-completion-goal.md`, doc 16 wins.

Evidence base, all read on 2026-11-05: `origin/main` at e703fe3 (P1-21 delivery approval merged); branch `claude/p1-22-commission` (open PR 61); branch `claude/p1-23-portal` (built, not merged); branch `claude/p1-24-rep-readonly` (claimed only); SPEC.md; docs 03, 08, 15, 16; the two superpowers specs; the audit execution map. Page status below was checked against those trees by listing the route files and searching `apps/web` for each function name. A function that no page calls is marked "no page", but a page may exist under another name or inside a shared component (for example payment recording lives in `components/money-section.tsx`), so check the code before building.

## 1. Decisions this plan rests on (already made)

| Decision | Source | Effect on the frontend |
|---|---|---|
| UI is English only; no Urdu labels, no i18n layer | D-42 (PR 60) | No `ur` strings, no locale switch, no Nastaliq font |
| Roman Urdu and Urdu stay accepted and stored in free text | D-42, doc 03 | Notes, visit notes, order cards, reasons, customer descriptions: never translated, stripped or rejected; UTF-8 end to end |
| System-generated invoice and receipt wording is English only, including the sentence that only the numbered system receipt is valid proof of payment | MJ chat 2026-11-05 (log entry above) | Invoice and receipt views use English templates; doc 08 line 37 updated in this branch; stored Urdu or Roman Urdu customer data is unaffected |
| Office sidebar is grouped, collapsible, permission-aware, shows only working pages | MJ chat 2026-11-05 | Section 4 |
| The Office app has a dedicated Rep-detail page | MJ chat 2026-11-05 | Section 6 |
| Orders are created only by the office; a rep submits cards | D-30 | Rep screens never create orders |
| A rep's delivery is a submission; only the owner or manager approves (D-32) | D-32, P1-21 (merged) | Section 5 |
| Commission rates by owner or manager, for future invoices only | D-31, H-15 | Commission screens show database figures only |

## 2. Rules every screen follows

1. Authorisation lives in the database. A screen may hide what a role cannot do. Hiding a menu item is not a security control. RLS and the `app.*` functions decide every read and write.
2. Five states on every data surface: loading, empty, error, permission denied, success. An empty message never shows while loading. A capped list says it is capped.
3. Refusals show the database's own message. No fake success, no dead button, no hardcoded figure or static array in a delivered workflow.
4. No financial or stock figure is calculated in the browser. Balances, totals, ageing, availability and commission come from database functions or authoritative records. Formatting is the only client-side work (`lib/money.ts`), and it normalises a negative zero.
5. Totals come from the source, never from the loaded page.
6. A mutation carries a `client_id` made once per user intent, so a replay creates nothing new.
7. A rep never sees supplier, cost or margin data, or an unmasked phone except through the logged reveal. A salon never sees another salon, stock (INV-12), cost or margin.
8. Historical financial and operational records are immutable in the interface; corrections go through authorised, audited workflows (reversal, adjustment, approval).
9. Each screen is defined before it is built (section 9 template) and ships with at least one stack or browser test that exercises the real UI-to-database path and the relevant role restrictions. A test that only shows a route renders does not count.

## 3. Shared foundation (F1 to F8)

| # | Item | Conditions MJ set | State today |
|---|---|---|---|
| F1 | Generated database types in `packages/shared` | Generated from the real migrations and schema, not hand-written | Not built; pages hand-type their rows |
| F2 | Typed RPC client over `lib/rpc.ts` | Typed arguments and results; one error mapping for `42501`, `22023`, `55000`, `23505` that still shows the database text; never bypasses database authorisation | `lib/rpc.ts`, untyped |
| F3 | Design system shared by Office, Rep and Salon | One token set and component set (button, field, select, money field, date range, badge, table, modal, toast, confirm, tabs, page header) | One stylesheet; `confirm-action`, `money-section`, `order-form`, `request-lines` |
| F4 | Data table pattern | Keyset paging, URL filters, row actions, the five states | Each page its own |
| F5 | Navigation shells, one per app | Permission-aware; the office shell is grouped (section 4) | Office flat list; rep and salon none |
| F6 | Invoice, receipt and statement views | Read `app.invoice_document` and `app.receipt_document` (and the statement reads); no local arithmetic; English template | No page calls either function |
| F7 | Rep offline outbox | Stable idempotency keys; reconcile against server results; retry, conflict handling, rejection display, recovery. No i18n | Not built (P1-09) |
| F8 | Test helpers | Sign in as each role, seeded fixtures, wait-for-loaded helper so an empty assertion cannot pass while loading. Built before the complex workflows | `apps/web/e2e-stack/`, `scripts/e2e-stack-seed.mjs` |

Ordering corrections: F8 comes first, then F1 and F2, then F3 to F5. F6 lands with the money screens. F7 is not a prerequisite for Office or Salon screens, which are online first. F7 must be complete for the Rep workflows before the field pilot.

## 4. Office sidebar

Collapsible groups, current route highlighted, items shown by role (owner and manager). A page that is not working is not listed. Items in brackets are not built yet and appear only when they are.

| Group | Items |
|---|---|
| Overview | Overview |
| Customers and Salons | Salons, Salon approvals, Territories |
| Orders and Deliveries | Orders and Requests, Delivery approvals |
| Inventory and Stock | Products and prices, [Warehouse stock], [Stock issues], [Adjustments] |
| Money and Collections | Receivables, Cash handover, Commission, Investors, [Payments], [Invoices], [Deposits] |
| Field Team | People, Team, Devices, [Rep detail], [Routes] |
| Controls and Approvals | [Approvals], [Daily digest] |
| Reports and Analytics | [Dashboards and reports] |
| Administration and Settings | [Settings], [Vault], [Offboarding] |

Owner-only items (settings, vault, write-offs, governance) are hidden from the manager and refused by the database if reached.

## 5. Delivery approval: the security boundary (S-D first item)

Required behaviour, from D-32 and MJ's instruction of 2026-11-05:

1. A rep may submit delivery evidence and quantities. A rep cannot mark an order officially delivered.
2. Only a manager or owner approves a submission. A rep never approves their own.
3. The approval happens in PostgreSQL, in one transaction: the delivery is written, the sale stock movement is posted, the authoritative invoice and its installments are issued, the order status moves, and the commission attribution is stamped. Until approval none of these exist.
4. This is not blocked by the unrelated approval-lifecycle questions (D11 to D15 in the blocker report).

State found: the database side is merged (migration `20261105130100_delivery_approval.sql`). `app.rep_submit_delivery` is rep-only; `app.office_approve_delivery` calls `app.assert_office()` and runs `app.finalise_delivery`, the single internal function that writes the delivery, movement, invoice and order state; `app.office_reject_delivery` and `app.office_resolve_pending` keep rejected goods in pending custody. Pages exist: `/app/orders/[id]/deliver`, `/app/deliveries`, `/office/deliveries`. Remaining frontend work:

- A stack test that proves the boundary through the UI: a rep submit leaves no invoice, no sale movement and an unchanged order; the rep has no approve control and a direct call is refused; a manager approval creates all of them once; a replayed approval creates nothing twice.
- A page for delivering a rep-less order through `app.office_deliver` (no page calls it today; A-18 is still an open assumption).
- Delivery history and pending submissions on the Rep-detail page (section 6).
- Commission figures show only after approval, because attribution is stamped at approval.

## 6. Rep-detail page (`/office/reps/[id]`)

A read-mostly oversight page for one rep, owner and manager, following the existing permission matrix. It is not an editing surface: historical records are never edited here; any correction uses the existing audited workflow reached from the owning page.

Sections: profile and account status; assigned territories and salons; check-in and check-out history; visits and activity; New Order Details cards submitted; orders assigned to the rep; delivery submissions awaiting approval (with approve and reject for the office, reusing the Delivery approvals functions); approved deliveries and history; payments and collections; cash in hand and handover history; bag stock and count variances; performance and operational indicators; commission information (see below).

Rules: no governance-only action (role change, status change, bag limit, vault) is shown unless the viewer holds that power; no sensitive personal data beyond what the matrix allows; no unmasked phone. Data comes from existing office reads where they exist (`office_rep_cash_position`, `office_handovers`, `office_orders`, `office_pending_deliveries`, `office_open_cards`); where no read exists for a section, that section waits for a read function written in its own slice, never a browser-side join of raw tables for money or stock.

Commission: the commission section and the Commission pages (`/office/commission`, `/app/commission`, in PR 61, unmerged) render only what `app.office_commission`, `app.commission_statement` and `app.my_commission` return. The frontend contains no commission formula and does not describe the basis. The basis and payouts are not treated as an approved feature until MJ's separate policy decision; until then the pages are labelled as not yet approved for payout use and the sidebar item is hidden outside owner and manager.

## 7. Work packages and dependencies

These are dependency-managed packages, not one linear chain. Verify and extend what exists; do not duplicate a ledger or rebuild what works.

| Package | Scope | Starts when | Does not wait for |
|---|---|---|---|
| WP-0 In-flight slices | P1-22 commission (PR 61), P1-23 portal, P1-24 rep read-only and proposals, finished and merged as planned. They use today's components | Already running | The foundation |
| F8, F1, F2 | Test helpers, generated types, typed RPC client | Now; docs and tooling only | Everything else |
| F3, F4, F5 | Design system, table pattern, grouped shells | After F8 and F1 to F2; needs a plan for converting existing pages without a big-bang rewrite (convert a page when its slice touches it) | S-A to S-C backend checks |
| S-D1 Delivery approval boundary | Section 5 | Now (database merged); needs F8 | Approval-lifecycle questions D11 to D15 |
| S-A Stock | Verify P1-04's functions through new screens (warehouse on hand, availability, low stock, reorder points, stock issue and confirm, counts, adjustments, rep bag page, lost-demand tap). Reuses the existing stock ledger | F1 to F5; independent verification of P1-04 from the board | S-B, S-C |
| S-B Money | Reconcile and complete P1-07 (payments, receipts, ageing, handover, office cash): invoice, receipt and statement views (F6), a payments list and reversal, credit controls on the salon page, rep collection page, deposits. PR 46 is recorded as merged in the 2026-11-03 audit, and its independent verification is still outstanding on the board; follow the recorded D-30 order model | F1 to F6; independent verification of P1-07 | S-A, S-C |
| S-C Routes | `/office/routes` and `/app/route` over the existing due list, route and territory functions (`due_list`, `my_route`, `office_set_route`, `rep_add_stop`, `rep_reorder_route`) | F1 to F5 | S-A, S-B |
| S-D2 Control layer | Approvals queue (needs a read function for `control.approval_request`; none exists), daily digest (needs read functions), settings, offboarding screen | After S-D1; the approval rules D11 to D15 block only these, not S-D1 | S-D1 |
| Rep-detail page | Section 6 | After S-D1 and the sections' reads exist | Commission policy |
| S-E Dashboards | Office dashboard and rep Today, built only from verified reporting functions (`office_receivables_ageing`, `office_cash_position`, `office_pending_deliveries`, `low_stock`, and read functions added by S-A, S-B, S-D2). No browser-side balance or stock arithmetic | S-A and S-B reads verified | S-C |
| S-F Offline client | Rep outbox, sync, retry, conflict handling, recovery for visits, prospects, collections, lost demand, cards and delivery submissions | The mutation contracts it queues are stable | Office and Salon screens; it is a field-pilot requirement |

Salon portal screens are online first and not offline.

## 8. Screen catalogue

Status key, checked against the trees named above: BUILT (page exists on main), IN FLIGHT (page exists on an unmerged branch), PARTIAL (works but some of the area has no UI), NO PAGE (database function exists, no page calls it), NOT STARTED (no backend either). Commission and portal rows are IN FLIGHT; they are not approved features by being listed.

### Office (`/office`, owner and manager, TOTP)

| Route | Purpose | Main functions | Status |
|---|---|---|---|
| `/office` | Overview and dashboard | counts through RLS today | PARTIAL (4 counters, stale note about unbuilt screens) |
| `/office/login`, `/office/mfa` | Sign-in, TOTP | Auth | BUILT |
| `/office/devices` | Approve or revoke phones | `approve_device`, `revoke_device` | BUILT |
| `/office/team` | Create users, status | `owner_create_user`, `owner_set_status` | BUILT; rate field with PR 61 |
| `/office/people` | Invitations, members, rep assignment | `office_invite`, `office_revoke_invitation`, `office_set_member_status`, `office_assign_salon_rep` | BUILT |
| `/office/territories` | Territories, areas, assignment | `office_upsert_territory`, `office_upsert_area`, `office_assign_territory`, `office_end_territory` | BUILT |
| `/office/salons`, `/office/salons/[id]` | List; detail with notes, visits, stages, phone reveal, money section | `office_pending_salons`, `reveal_phone`, `office_override_stage`, money-section reads | PARTIAL: detail exists; credit controls (`office_raise_limit`, `office_release_credit_hold`, `office_set_blocked`, `owner_set_credit`) have no page |
| `/office/salons/approvals` | Approve or reject proposed salons | `office_pending_salons`, `office_decide_salon` | BUILT |
| `/office/orders` | Create order; open cards queue; order list | `office_create_order`, `office_open_cards`, `office_dismiss_card`, `office_orders` | BUILT; salon requests join the queue in P1-23 (IN FLIGHT) |
| `/office/orders/[id]` | Order detail, status timeline, cancel | `office_orders`, `recheck_order`, `cancel_order` | NO PAGE (`cancel_order` has no caller) |
| `/office/deliveries` | Pending submissions, approve, reject, settle pending stock | `office_pending_deliveries`, `office_approve_delivery`, `office_reject_delivery`, `office_pending_stock`, `office_resolve_pending` | BUILT |
| rep-less delivery | Deliver a rep-less order from the warehouse | `office_deliver` | NO PAGE |
| `/office/receivables` | Ageing by salon; payment and cash recording through `money-section` | `office_receivables_ageing`, `office_record_payment`, `office_record_cash` | BUILT (payment recording is here, not a separate page) |
| payments list, reversal | List and reverse payments | not confirmed | NOT STARTED |
| invoices and receipts | Printable views | `invoice_document`, `receipt_document` | NO PAGE |
| `/office/handovers` | Count and settle handovers | `office_handovers`, `office_count_handover`, `office_rep_cash_position` | BUILT (dispute settlement waits on D17) |
| deposits | Bank deposits with slip photo | not built (CTL-04) | NOT STARTED |
| `/office/commission` | Rates, earned, paid, owed, payments | `office_commission`, `office_set_commission_rate`, `office_record_commission_payment`, `office_reverse_commission_payment` | IN FLIGHT (PR 61); policy not final |
| `/office/investors`, `/office/investors/[id]` | Investor ledger, no calculations | `office_investors`, `office_investor_statement` and siblings | BUILT |
| `/office/products` | Products, SKUs, pictures, prices, per-salon prices | `office_upsert_product`, `office_upsert_sku`, `office_set_sku_price`, `office_set_salon_price` | BUILT |
| warehouse stock | On hand, availability, low stock, reorder points | `stock_on_hand`, `warehouse_availability`, `low_stock`, `office_set_reorder_point` | NO PAGE |
| stock issues | Propose, cancel, see confirmation | `office_propose_stock_issue`, `office_cancel_stock_issue` | NO PAGE |
| adjustments | Post an adjustment under approval | `office_post_adjustment`, `request_approval` | NO PAGE |
| `/office/routes` | Build a rep's route | `due_list`, `office_set_route` | NO PAGE |
| `/office/reps/[id]` | Rep-detail (section 6) | assembled | NOT STARTED |
| approvals, digest | Queue and daily digest | `decide_approval`, `cancel_approval`; reads missing | NOT STARTED |
| settings, vault, offboarding | Owner-only configuration, vault, one-screen offboarding | `owner_set_config`, `owner_set_vault_grant`, `owner_set_status` | NOT STARTED (offboarding in one screen is a launch check) |

### Rep (`/app`, installable PWA)

Navigation: a bottom bar of Today, Route, Salons, Cards, Cash; Me (commission, account) in the header.

| Route | Purpose | Main functions | Status |
|---|---|---|---|
| `/app/login` | Email code | Auth | BUILT |
| `/app` | Today | `my_session`, `my_day`, `my_bag`, `my_cash_position` | PARTIAL (thin home) |
| `/app/day` and `rep-day.tsx` | Check in and out; route stops reorder and add live here | `rep_check_in`, `rep_check_out`, `record_count`, `my_route`, `due_list`, `rep_add_stop`, `rep_reorder_route` | PARTIAL: route handling exists inside this page, so a separate Route page may not be needed; decide in S-C |
| `/app/salons`, `/app/salons/[id]`, `/app/salons/new` | Salons, notes, visits, propose | `my_salons`, `my_salon`, `add_salon_note`, `log_visit`, `create_salon` | BUILT; read-only change in P1-24 |
| `/app/salons/[id]/edit` | Edit a salon | `update_salon` | BUILT; removed by P1-24 per spec |
| `/app/cards` | My cards: create, edit, cancel | `rep_create_card`, `rep_edit_card`, `rep_cancel_card`, `my_cards` | BUILT (edit and cancel with P1-23, IN FLIGHT) |
| `/app/orders` | Read-only territory orders | `my_orders`, `my_territory_orders` | BUILT |
| `/app/orders/[id]/deliver`, `/app/deliveries` | Submit delivery; see submissions | `rep_submit_delivery`, `my_submissions` | BUILT |
| collection | Record a collection, show the receipt | `rep_record_payment`, `receipt_document` | PARTIAL: payment recording is in `money-section`; no receipt view |
| bag | Bag, confirm a stock issue, lost-demand tap | `my_bag`, `rep_confirm_stock_issue`, `record_demand` | NO PAGE |
| `/app/handovers` | Acknowledge the counted figure | `my_handovers`, `rep_respond_handover` | BUILT |
| `/app/commission`, `/app/account` | Commission by date range; account | `my_commission` | IN FLIGHT (PR 61); policy not final |
| map | Salon map | MAP-01, 02 | NOT STARTED (needs map provider approval, H-21) |
| sync status | Pending, retry, rejected | outbox | NOT STARTED (F7) |

### Salon portal (`/salon`, online only)

| Route | Purpose | Main functions | Status |
|---|---|---|---|
| `/invite/[token]` | Redeem an invitation | `invitation_preview`, `redeem_invitation` | BUILT |
| `/salon/login` | Email code | Auth | BUILT |
| `/salon` | Account, catalogue with the salon's own prices, basket, requests, orders, payments | `salon_my_account`, `salon_catalogue`, `salon_submit_request`, `salon_edit_request`, `salon_cancel_request`, `salon_my_requests`, `salon_my_orders` | IN FLIGHT (branch `claude/p1-23-portal`): one page today; split into routes with F5 |
| salon invoices and receipts | Permitted documents | `invoice_document` | NOT STARTED (named in the P1-23 entry as not built) |

## 9. Per-screen definition

Fill this in before a screen is built; a screen without it is not ready.

```
Route:
Roles allowed and what each other role or an anonymous visitor sees:
Functions read and written (exact names and arguments):
Data dependencies (read functions that must exist; new ones named):
Fields and columns (label, source, format):
Filters and sort:
Actions (button, function, confirmation, reason field and minimum length):
States (loading, empty, error, denied, success; exact wording):
Money shown (paisa source; no browser arithmetic):
Offline behaviour (rep screens only):
Acceptance criteria:
Test (stack spec name; positive path; wrong role; other territory or salon; replay):
```

## 10. Documents touched or still to touch

Changed in this branch: this plan; doc 08 line 37 (invoice and receipt wording English only); `docs/log/2026-11-05-mj-frontend-structure.md` and `docs/log/2026-11-05-claude-frontend-structure-plan.md`.

Covered elsewhere: the Urdu wording in SPEC.md, docs 00, 01, 03 (NFR-03), 05, 15, CLAUDE.md, AGENTS.md and the PR B plan is D-42 in PR 60. This branch does not edit those files, to avoid a conflict with it.

Not done here, and why: the new work packages are not yet added to `2026-11-05-project-completion.md` or the status board; that follows MJ's review of this plan. The stale text in the office Overview page is a code change for a later slice.

## 11. Open points for MJ

1. Commission basis and payout policy (stated as separate): until decided the frontend shows database figures only.
2. Rep-less order delivery (`office_deliver`, A-18, still an assumption): a page waits on confirmation.
3. Whether the separate Route page for reps is needed, given route handling inside `rep-day.tsx` (decide in S-C).
