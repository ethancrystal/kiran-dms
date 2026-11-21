# Frontend inventory — `apps/web`

> **Path note:** the task asked for `.zwork/derived/fe-plan/frontend-inventory.md`, but the platform reserves `.zwork/` for runtime state and denies writes there. This file is the same deliverable at the closest allowed path: `derived/fe-plan/frontend-inventory.md`.

**Task:** Complete frontend inventory for the "Complete Frontend, Backend Alignment and Data Presentation" plan.
**Date:** 2026-11-21 (Asia/Karachi). **Branch:** `integration/single-repo-consolidation`. **Method:** read-only — every page file read (headers + key sections), full call-site scans for `rpc("fn")` / `useRpcRead("fn")` / `rpc(fn)` / `.from("table")` across `apps/web/**/*.{ts,tsx}` (bracket-safe `-LiteralPath` scan), cross-checked against `docs/ACTIVITY.md` §12 status board and `docs/plans/in-progress/2026-11-05-frontend-structure.md`. Nothing was run; no state written.

**Status vocabulary** (evidence tier noted per row):
- **BUILT** — page exists, reads/writes through `app.*` functions or RLS tables, shows the database's errors (code-verified by me).
- **BUILT — NOT INDEPENDENTLY VERIFIED** — same, plus its slice is recorded in `docs/ACTIVITY.md` §12 as merged with required checks green but "awaiting an independent check" (board tier).
- **PARTIAL** — works, but a bounded part of the area has no UI or is deliberately read-only (evidence cited).
- **NOT BUILT** — no page exists (backend/plans evidence cited).

---

## 0. Totals

| Surface | Routes (page.tsx) | Status summary |
|---|---|---|
| Public (`/`, landing) | 1 | BUILT (links only) |
| Public storefront (`khsalon.com` shop) | **0 pages** | NOT BUILT (admin panel only; P1-35 NOT STARTED) |
| Auth: `/office/login`, `/office/mfa` | 2 | BUILT |
| Auth: `/app/login` | 1 | BUILT |
| Auth: `/salon/login`, `/salon/signup` | 2 | BUILT |
| Invite: `/invite/[token]` | 1 | BUILT |
| Rep PWA `/app/*` | 18 | 17 BUILT (most NOT INDEPENDENTLY VERIFIED per board); `/app/outbox` PARTIAL (offline pipeline not wired) |
| Salon portal `/salon/*` | 4 | BUILT (P1-23/P1-31/P1-39; NOT INDEPENDENTLY VERIFIED per board) |
| Office `/office/*` | 30 (28 under `(shell)` + login + mfa) | BUILT; board marks P1-18…P1-31 slices "awaiting an independent check" |

**Data surface reached from the frontend:** **171 distinct `app.*` functions** called (call-site scan of `apps/web`), plus **28 `public` tables read directly through RLS** from the browser (list §7). No `route.ts` API handlers exist — the browser talks to PostgREST only; every write is an `app.*` RPC (H-08 honoured). No server actions (`"use server"`: zero matches).

**Placeholder scan:** `TODO|FIXME|coming soon|not implemented|stub|fake|dummy` and `alert(` over `apps/web` hit **only test fixtures** (`e2e`, `e2e-stack`, `lib/email/reminder-job.test.ts`). No TODO/FIXME comments, no fake success messages, no dead buttons found in `apps/web/app` or `apps/web/components`. Static arrays exist but are legitimate enumerations mirrored from DB enums (e.g. `STAGES`, `STATUSES`, `CHANNELS`, `OFFICE_REASONS` — each cites its migration/function). Hardcoded figures were not found; all money is `*_paisa` from the database formatted by `lib/money.ts`.

---

## 1. Public surface

| Route | File | Purpose | Data sources | Status |
|---|---|---|---|---|
| `/` | `apps/web/app/page.tsx` | Landing page: three links (field app, salon portal, office) + Supabase-not-configured warning | none | BUILT (code-verified) |

**Public shop:** no routes exist. The only storefront-related frontend is the office **Online shop panel** `apps/web/app/office/(shell)/products/online-shop.tsx` (category/product slugs, meta, body, publish toggle, image upload → `office_set_storefront_published`, `office_upsert_storefront_category`, `office_upsert_storefront_product`; bucket `storefront-images` via `lib/storefront-images.ts`). Visitor read functions and four storefront tables exist in the backend (P1-33 merged), catalogue seed P1-34 DONE self-reported — but **P1-35 (storefront pages, SEO, salon link, enquiry) is NOT STARTED** (ACTIVITY §12). Plans: `docs/plans/will-be-implemented/2026-11-10-khsalon-storefront-*.md`.

## 2. Auth pages

| Route | File | Purpose | Data sources | Status |
|---|---|---|---|---|
| `/office/login` | `apps/web/app/office/login/page.tsx` | Owner/manager email+password sign-in; no sign-up link (H-15) | Supabase auth `signInWithPassword`; no RPC | BUILT |
| `/office/mfa` | `apps/web/app/office/mfa/page.tsx` | Mandatory TOTP: enroll (QR+secret) or verify; redirects reps/salons to their surfaces (AUTH-06) | auth.mfa enroll/verify/unenroll; `my_session`, `salon_me` (role detection) | BUILT |
| `/app/login` | `apps/web/app/app/login/page.tsx` | Rep sign-in: email + 6-digit email code (L-0101); `shouldCreateUser:false` | Supabase auth `signInWithOtp` | BUILT (e2e: `rep-login.spec.ts` incl. 300 KB JS budget + security headers) |
| `/salon/login` | `apps/web/app/salon/login/page.tsx` | Salon sign-in: email + 6-digit code | Supabase auth `signInWithOtp` | BUILT (e2e `salon-login.spec.ts`) |
| `/salon/signup` | `apps/web/app/salon/signup/page.tsx` | Self sign-up (MJ 2026-11-09): email code → application form; members redirected | `salon_login_status`, `salon_apply`; `EmailCode` component | BUILT (e2e `salon-signup.spec.ts`; P1-18) |
| `/invite/[token]` | `apps/web/app/invite/[token]/page.tsx` | The only rep/salon login-creating page (D-39): preview → email code → redeem | `invitation_preview`, `redeem_invitation`; `EmailCode`; layout sets `no-referrer` + noindex | BUILT |

## 3. Rep PWA (`/app/*`) — 18 pages

Shared plumbing: `apps/web/app/app/layout.tsx` (client gate, §5), `lib/rpc.ts` (`rpc`, `rows`, `mySession`), `lib/outbox/*` (offline queue, not yet wired — §6 gap 3), `lib/supabase/browser.ts` (`register_device`, SEC-03 device binding).

| Route | File | Purpose | Data sources (`app.*` unless noted) | Status |
|---|---|---|---|---|
| `/app` | `app/app/page.tsx` | Rep home: registers the phone, explains device/account state, renders rep month | `my_session`, `salon_me` (salon redirect), `register_device`; `RepMonth` → `my_month_orders`, `my_commission` | BUILT (P1-30 AUTH-07) |
| `/app/account` | `app/app/account/page.tsx` | Read-only account status (rep cannot edit; goal wording) | `my_session` | BUILT |
| `/app/day` | `app/app/day/page.tsx` | Today page wrapper → `RepDay` (`app/app/rep-day.tsx`) | `my_day`, `my_bag`, `my_areas`, `my_route`, `due_list`, `rep_check_in`, `rep_reorder_route`, `rep_add_stop`, `rep_check_out`; table `rep_day` (stuck-day check, REP-01) | BUILT (P1-30) |
| `/app/route` | `app/app/route/page.tsx` | My route for a day; reorder stops, add salon stop, due list | `my_route`, `due_list`, `rep_reorder_route`, `rep_add_stop`; `my_salons` via `lib/salons.ts` | BUILT (P1-29 / S-C) |
| `/app/salons` | `app/app/salons/page.tsx` | Rep's salons, own territories, masked phones, 50/page | `my_salons`, `my_salon` (via `lib/salons.ts` `salonPage`) | BUILT (P1-24) |
| `/app/salons/[id]` | `app/app/salons/[id]/page.tsx` | One salon: notes, visits, stage history, phone reveal (logged), park, visit logging, order card, money, lost demand | `salon_notes`, `salon_visits`, `salon_stages`, `reveal_phone`, `rep_park_salon`, `log_visit`, `add_salon_note`, `rep_create_card`; `MoneySection` (`rep_record_payment`, `salon_balance`, `salon_installments`), `MyCollections` (`my_collections`), `LostDemand` (`record_demand`; tables `demand_signal`, `sku`, `product_group`) | BUILT |
| `/app/salons/new` | `app/app/salons/new/page.tsx` | Drop-a-pin new salon (GPS pin, idempotent client id) | `my_areas`, `create_salon` | BUILT |
| `/app/order-notes` | `app/app/order-notes/page.tsx` | Rep's order notes incl. potential salons (MJ 2026-11-20) — append-only intake cards | `my_cards`, `my_salons`, `rep_create_card`; `RequestLines` (table `sku`) | BUILT |
| `/app/cards` | `app/app/cards/page.tsx` | Rep's order cards: edit (version-checked), cancel | `my_cards`, `rep_edit_card`, `rep_cancel_card`; `RequestLines` | BUILT |
| `/app/orders` | `app/app/orders/page.tsx` | Orders in rep's territory (read-only, D-30) with deliver links | `my_territory_orders`, `my_submissions` | BUILT (P1-24) |
| `/app/orders/[id]/deliver` | `app/app/orders/[id]/deliver/page.tsx` | Delivery submission: remaining lines, receiver name, GPS, client-id idempotency, salon acknowledgement step | `my_territory_order`, `order_remaining`, `my_submissions`, `rep_submit_delivery`, `rep_attach_signature`; table `sku`; `Acknowledgement` (`delivery_ack_text`) | BUILT (P1-21/P1-31) |
| `/app/deliveries` | `app/app/deliveries/page.tsx` | My submissions + attach signature | `my_submissions`, `my_signature_status`, `rep_attach_signature`; `Acknowledgement` | BUILT |
| `/app/commission` | `app/app/commission/page.tsx` | Rep's own commission statement for a date range | `my_commission` | BUILT (P1-22) |
| `/app/handovers` | `app/app/handovers/page.tsx` | My handovers (two-party), cash position, respond | `my_handovers`, `my_cash_position`, `rep_respond_handover`; `MyCollections` | BUILT (P1-07/P1-30) |
| `/app/stock` | `app/app/stock/page.tsx` | My bag; blind two-party count of pending issues | `my_pending_issues`, `my_bag`, `warehouse_availability`, `my_issue_skus`, `rep_confirm_stock_issue` | BUILT (P1-29) |
| `/app/receipts/[id]` | `app/app/receipts/[id]/page.tsx` | Printable receipt for a payment the rep recorded | `receipt_document`; `ReceiptSheet` | BUILT (P1-28) |
| `/app/outbox` | `app/app/outbox/page.tsx` | Phone-held queue: waiting/refused items, last 50 sends, retry/discard — opens with no signal | none (IndexedDB via `lib/outbox/*`) | **PARTIAL** — UI + queue engine complete (9 spec files), but no page calls `submit()` and `startSync()` is never mounted (`lib/outbox/index.ts:197,255`; zero callers found), so **rep writes are still online-only** (ACTIVITY P1-09) |

## 4. Salon portal (`/salon/*`) — 4 pages (no layout file; each page self-gates, §5)

| Route | File | Purpose | Data sources | Status |
|---|---|---|---|---|
| `/salon` | `app/salon/page.tsx` | The salon's account: catalogue (availability-only per INV-12), submit/edit/cancel requests, own orders with tracked steps, invoices list | `salon_me`, `salon_login_status`, `salon_my_account`, `salon_catalogue`, `salon_my_requests`, `salon_my_orders`, `salon_submit_request`, `salon_cancel_request`, `salon_edit_request`; `SalonInvoices` (`salon_my_invoices`), `SalonSteps` (`salon_order_steps`), `RequestLines`, product images (`signedImageUrls`) | BUILT (P1-23/P1-31/P1-38/P1-39) |
| `/salon/login` | `app/salon/login/page.tsx` | Email-code sign-in | Supabase auth | BUILT |
| `/salon/signup` | `app/salon/signup/page.tsx` | Self sign-up application | `salon_login_status`, `salon_apply` | BUILT |
| `/salon/invoices/[id]` | `app/salon/invoices/[id]/page.tsx` | Salon's own printable invoice (snapshot; no signature image sent) | `salon_invoice_document`; `InvoiceSheet` | BUILT (P1-31) |

Note: the salon has **no receipt view** — `salon_my_invoices` lists invoices only; no `salon_receipt_document` is called anywhere (§6 gap 6).

## 5. Role-gating and navigation

**Layer 1 — `apps/web/proxy.ts`** (Next.js proxy = middleware; matcher `/office/:path*`, `/app/:path*`, `/salon/:path*`, `/invite/:path*`): refreshes the Supabase session cookie; `/office/*` (except `/office/login`, `/office/mfa`) requires a signed-in user **and AAL2** (`mfa.getAuthenticatorAssuranceLevel()`); `/app/*` (except `/app/login`) requires a signed-in user; `/salon/*` (except `/salon/login`, `/salon/signup`) requires a signed-in user; `/invite/*` only refreshes. Its own header comment states this is convenience only — "The control is RLS and the app.* functions".

**Layer 2 — server layout `apps/web/app/office/(shell)/layout.tsx`**: re-checks user + AAL2 (`assurance()`), reads `user_profile` by session id, requires `role ∈ {owner, manager}` **and** `status=active`, else renders a refusal card (never the shell); profile-read failure shows a generic error (server-side `console.error` only). Renders topbar + `OfficeNav` with the profile's role.

**Layer 3 — rep client gate `apps/web/app/app/layout.tsx`**: every `/app` page except `/app` and `/app/login` asks `app.my_session` (the one call that answers on an unapproved phone) and shows the database's reason instead of empty lists (REP-04, P1-30); `/app/outbox` may open with no signal under the remembered-gate rules of `lib/outbox/gate.ts` (localStorage per-login memory). `app/app/page.tsx` additionally drives device registration (SEC-03) and reroutes salon logins to `/salon`.

**Salon**: no layout; `app/salon/page.tsx` gates itself via `salon_me` + `salon_login_status` and renders by membership/approval status (pending → waiting text); `/salon/signup` redirects existing members. The database (`app.salon_me`, RLS) is the real boundary.

**Office role split (owner vs manager)**: `lib/office-nav.ts` — `navFor(role)` filters `ownerOnly` items (only Settings); `components/office-nav.tsx` renders the grouped sidebar; `currentHref()` longest-match highlights. Page-level: office home checks `my_session.role` to size owner-only queues (P1-30 review); Approvals/Team/Handovers read `mySession()` and hide owner-only controls (H-15) while the database refuses anyway. Navigation itself does **not** gate — every `app.*` function re-checks.

**Rep vs salon cross-redirects**: `my_session` null + `salon_me` truthy → salon portal links from the rep gate and rep home (AUTH-07).

## 6. Partials and gaps

### Pages that look partial (with evidence)
1. `/app/outbox` — see table above; the queue engine (9 outbox spec files, green per board P1-09) is mounted on exactly one page that displays it; **no page enqueues into it** and nothing calls `startSync` (`lib/outbox/index.ts:197,255`; callers scanned), so **rep writes are still online-only** (ACTIVITY P1-09).
2. `/office/settings` — intentionally read-only rows: `plan.templates`, `credit.rules`, `catalogue.product_groups` ("Kept read-only here… Changed in the database") and documented "seeded keys that no database function reads yet" shown read-only so a saved figure never looks in force. Honest, but part of the config surface is presentational.
3. `/office/settings` reminder log — `ReminderLog` UI + `lib/email/reminder-job.ts` (with unit test) exist, but **no scheduler or route runs the job** and real sending waits on B-61 (ACTIVITY P1-38).
4. `/office/reps/[id]` — Rep-detail covers profile, devices, territories, salons, days, visits, cards, orders, pending submissions, cash (`office_rep_detail`, `office_rep_cash_position`); the plan's §6 items "payments and collections, handover history, approving from this page" are **not built** (frontend plan progress note, P1-28).
5. `/office/receivables` — ageing read-only (`office_receivables_ageing`); payment recording lives on the salon detail page (`MoneySection`) and rep side, not here (deliberate per P1-30, but a "payments list" page does not exist).
6. Salon portal — invoices only; **no receipt document view** (no `salon_receipt_document` call site).

### Top 10 gaps (backend capability ↔ frontend coverage)
1. **Public storefront pages** (P1-35, plan D: pages, SEO, client-salon link, enquiry) — NOT STARTED; office admin panel and visitor read functions already exist, so the data is ahead of the interface.
2. **Restock suggestion & office goods-in** (P2-05, built 2026-11-21 with tests) — zero frontend references: grep `restock|goods_in|goods-in` over `apps/web` = no matches. Backend exists, no screen.
3. **Offline outbox not wired** — no mutation goes through `submit()`; `startSync` never mounted; rep writes online-only (P1-09 tasks 6–9 not started). Largest behavioural gap for the field pilot.
4. **Reminder job has no runner** — module + UI exist, nothing schedules it, no real sending (B-61) (P1-38).
5. **No server-side PDF renderer** for invoice/receipt/statement documents — print is `window.print()` on printable sheets (P1-28/P1-31 board notes; B-46 logo also open).
6. **Salon receipt view missing** (see partial 6) — receipts exist office-side (`office_receipts`) and rep-side.
7. **Statement views not built** (F6) — rep/salon printable statements; only on-screen statements exist (`my_commission`, `office_commission`, `office_investor_statement`).
8. **Deposits (CTL-04) NOT STARTED** and no dedicated payments list page (reversals exist inside `salon-payments.tsx` and Commission) (P1-07 note "deposits not started").
9. **Control layer screens (P1-08) NOT STARTED** — daily owner digest, balance-confirmation list, offboarding screen; Settings only previews config keys.
10. **`packages/shared` (F1 generated types) and typed RPC client (F2) not built** — every page hand-types its rows; `lib/rpc.ts` is untyped strings (frontend-structure plan §3 F1/F2 "Not built"). Also: rep map (P1-03) NOT STARTED (no map UI anywhere; pins are stored lat/lng only).

## 7. Direct table reads from the browser (RLS-scoped)

28 distinct tables: `area`, `app_config`, `credit_event`, `cycle_estimate`, `demand_signal`, `device`, `investor`, `invoice`, `product_group`, `reorder_rule`, `rep_day`, `rep_territory`, `route`, `route_stop`, `salon`, `salon_approval_decision`, `salon_contact`, `salon_credit`, `salon_membership`, `salon_rep_assignment`, `sales_order`, `sales_order_line`, `sku`, `stock_count`, `stock_issue`, `stock_location`, `territory`, `user_profile`. All reads are `select` with filters/limits; writes go only through `app.*` RPCs (including dynamic sites: `devices/page.tsx:58-59` `approve_device`/`revoke_device`, `order-steps.tsx:61` `office_order_steps`/`salon_order_steps`, `use-rpc-read.ts`, `lib/rpc.ts`, `lib/outbox/index.ts:140`).

## 8. E2E suites — what each file covers

### `apps/web/e2e/` (browser-only, mocked storage/network where needed)
| File | Journey |
|---|---|
| `rep-login.spec.ts` | Rep sign-in page: fits small phone, English only (D-42); refused sign-in shown (NFR-01); ≤300 KB gzipped JS (NFR-02); security headers (doc 06 §7) |
| `salon-login.spec.ts` | Salon email-code sign-in; mistyped email can go back from the code step |
| `salon-signup.spec.ts` | Sign-up from salon sign-in → email step; code step; invitation page keeps the same email step |
| `time.spec.ts` | Karachi-time formatting rules (DB time on Karachi calendar day; clock time; missing time = dash) |
| `list-cap-note.spec.ts` | Capped lists say they are capped (newest-shown note) only when at the cap |
| `office-gaps.spec.ts` | `app.mask_phone` masking parity; reminder-log kinds ↔ office page mapping; opening last-purchase date validation |
| `outbox-queue.spec.ts` | IndexedDB queue: order, dedupe, due items, retry, dependencies, per-user counts, clear |
| `outbox-classify.spec.ts` | Error taxonomy: transient vs auth vs rejected vs unknown-shape-kept |
| `outbox-gate.spec.ts` | The rep gate: what opens the page with no signal, remembered answers per login, stored-session precedence |
| `outbox-drain.spec.ts` | Drain: capture order, per-item args, refusal keeps DB words, backoff, concurrency, signature-after-delivery dependency |
| `outbox-history.spec.ts` | Send history: results, newest-50 trim, per-login isolation, clear-on-clear |
| `outbox-access.spec.ts` | Per-login access to waiting items/sends; retry/discard authorisation |
| `outbox-signout.spec.ts` | Sign-out wipe: counts only own unsent items, confirm flow, failure honesty |
| `outbox-crypto.spec.ts` | Seal/open of outbox payload (WebCrypto): tamper, key non-exportability, signature-size value |

### `apps/web/e2e-stack/` (real local Supabase stack, seeded `[Test]`/`[Dummy]` data, CI-only)
| File | Journey |
|---|---|
| `office.spec.ts` (~2,470 lines) | Slice 1–8 journeys J1–J5: owner/manager TOTP sign-in, territory/salon/product/investor setup, orders & cards, delivery approval boundary, stock issue/confirm, handover, commission, salon approvals, catalogue + online-shop panel incl. public picture URL check |
| `overviews.spec.ts` | P1-26 overview pages: every figure on `/office`, rep month, investor month read back from the database as deltas |
| `rep-detail-documents.spec.ts` | P1-28/P1-31: grouped sidebar, Rep-detail page, invoice/receipt printable views, composer draft |
| `p130-screens.spec.ts` | P1-30 part 2 screens: settings journey (city change + restore), opening stock, handover settlement/withdrawal, payment reversal, cash cap, D-45–D-48 decisions |
| `roles-coverage.spec.ts` | Holistic 4-role journeys (owner, manager, rep, salon) through GoTrue (TOTP + Mailpit email codes), no request interception, every assertion reads the database |

## 9. Components inventory (data-relevant)

`components/`: `acknowledgement` (`delivery_ack_text`), `confirm-action` (reason-confirmed mutations, `ListState`), `document-lists` (`office_invoices`, `office_receipts`), `duplicate-phones` (`duplicate_phones`), `email-code` (OTP), `investor-month` (presentational), `invoice-sheet` (printable), `list-cap-note`, `lost-demand` (`record_demand`), `money-section` (`office_record_payment`, `office_record_cash`, `rep_record_payment`, `salon_balance`, `salon_installments`), `month-picker`, `my-collections` (`my_collections`), `office-add-salon` (`create_salon`), `office-nav`, `open-rep-days` (`office_force_close_rep_day`; table `rep_day`), `opening-purchase` (`office_set_last_purchase`), `order-form` (`office_salon_prices`, `office_create_order`; tables `salon_rep_assignment`, `salon`, `rep_territory`, `sku`), `order-steps` (`office_order_steps`, `salon_order_steps`), `receipt-sheet`, `reminder-log` (`office_reminder_log`), `rep-month` (`my_month_orders`, `my_commission`), `rep-sign-out`, `request-lines` (table `sku`), `salon-contact` (`office_set_primary_contact`), `salon-credit` (`salon_credit_status`, `office_set_blocked`, `owner_set_credit`, `office_raise_limit`; tables `salon_credit`, `credit_event`, `app_config`), `salon-invoices` (`salon_my_invoices`), `salon-payments` (`office_salon_payments`, `office_reverse_payment`), `signature-pad`, `submission-signature` (`office_delivery_signature`, `office_signature_image`), `timeline`, `use-rpc-read`.

`lib/` (client data helpers): `rpc.ts` (rpc/rows/mySession/messageOf), `salons.ts` (`my_salons`, `my_salon` paging), `money.ts`, `time.ts` (Karachi), `overview.ts` (label maps), `commission.ts`, `documents.ts`, `investors.ts`, `approvals.ts`, `office-gaps.ts`, `list-cap.ts`, `product-images.ts` / `storefront-images.ts` (storage upload), `supabase/browser.ts` (`register_device`, device id), `supabase/server.ts` (`assurance()`), `outbox/*` (queue/drain/gate/crypto/store-idb/history/access/sign-out), `email/reminder-job.ts` (+ test). No lib module queries the database server-side except via these client paths; server-side data fetches exist only in the office shell and office home (server components using `supabaseServer()`).

## 10. Unknowns / caveats
- Board status per slice is quoted from `docs/ACTIVITY.md` §12 (read 2026-11-21); "awaiting an independent check" is the board's own wording — I did not verify runtime behaviour (no app run, per read-only constraint).
- `docs/plans/in-progress/2026-11-05-frontend-structure.md` §8 status table is **outdated** on several rows (e.g. routes/reps/stock/approvals/invoices marked NO PAGE/NOT STARTED there are built on this branch); the ACTIVITY board and the code are the current truth.
- Whether any storefront data is applied to a hosted Supabase project is explicitly unknown (P1-33 board note: "no log entry proves a hosted migration was applied"; P1-34 seed "never applied to a hosted project").
