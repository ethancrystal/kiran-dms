# Backend capability inventory — Kiran DMS (for the Frontend Alignment plan)

> NOTE ON LOCATION: the requested path `.zwork/derived/fe-plan/backend-inventory.md` is platform-reserved
> and write-denied. This file is the same report, written one level up at the repo root.
> It is the single report file for the BACKEND INVENTORY task; everything else in this run was read-only.

Date: 2026-11-21 (Asia/Karachi). Branch: `integration/single-repo-consolidation`. Repo root = workspace root.
Scope: read-only inventory of the backend capability surface (schemas, tables, RPC functions) and its frontend coverage in `apps/web`.

**Method (all read-only):**
- Table and function inventories grepped from `supabase/migrations/*.sql` (57 files, `20261024223304_foundation.sql` … `20261121130000_catalogue_availability.sql`).
- Function purposes taken from the migration source: `COMMENT ON FUNCTION`/`COMMENT ON TABLE` statements and the comment block directly above each `create function` (extracted for all 418 definition statements).
- RPC exposure derived from `grant execute on function` / `revoke execute on function` statements, applied in migration order (last action per function name wins). Caveat: `create or replace` keeps earlier grants; grants were never re-revoked unless a later `revoke` names the function, so "granted" = last grant/revoke state.
- Frontend cross-check: string-literal search for each of the 309 function names across all `apps/web` source (`app/`, `components/`, `lib/`, e2e dirs tagged separately; `.next`/`node_modules` excluded). Frontend calls go through `apps/web/lib/rpc.ts` (`rpc()` → `supabaseBrowser().schema("app").rpc(fn)`) and `useRpcRead`; the offline outbox (`lib/outbox/`) replays queued writes by the same function names (`OutboxFn`, `lib/outbox/types.ts:10-20`). Direct public-table reads use `.from("<table>")` (list in §5).

Result: **309 unique `app.*` functions (418 definition statements incl. re-definitions); 0 `vault_api.*` functions. 201 granted (RPC-exposed), 72 revoked-internal, 36 never granted (internal). 177 names appear in apps/web source; 24 granted names have no non-test frontend caller** (categorised in §3).

Confidence: HIGH for tables/functions/grants/UI-caller findings (all from direct source evidence). Purposes are quoted/compressed from migration comments (HIGH); a few internal helpers have no comment and are marked "(name-derived)".

---

## 1. Schemas and tables

Schemas created by `20261024223304_foundation.sql:20-23` (+ Supabase's stock `public`):

| Schema | Tables | Purpose (foundation header) |
|---|---|---|
| `public` | **71** | RLS-scoped business data (incl. all `storefront_*` tables — there is **no `storefront` schema**) |
| `control` | **6** | approvals, audit, counters, phone-reveal log |
| `app` | 0 (functions only) | RPC write path + RLS helpers |
| `supplier_vault` | **0** | classified supplier data — **schema created but empty** (only reference: a comment in `20261105180000_overviews.sql:17`) |
| `vault_api` | **0 tables, 0 functions** | grant-checked functions over supplier_vault (P1-05) — **schema created but never populated** |

### 1.1 public — 71 tables (append-only marked ★)

Foundation (`20261024223304`): user_profile, device, app_config.
Inventory (`20261028050000`): product_group, product, sku, stock_location, ★stock_movement, stock_issue, ★stock_count, reorder_rule, ★demand_signal.
Salons (`20261028060000`): territory, area, rep_territory, salon, salon_contact, ★salon_note, ★stage_event.
Visits (`20261028070000`): rep_day, ★visit.
Routes (`20261028080000`): cycle_estimate, ★route, route_stop.
Orders (`20261028090000`): salon_credit, ★credit_event, sales_order, ★sales_order_line.
Deliveries (`20261028100000`): ★delivery, ★delivery_line, ★invoice.
Payments (`20261103154528`): ★installment, ★payment, ★payment_allocation, ★receipt, ★cash_ledger_entry.
Handover (`20261103200000`): ★handover, ★handover_response.
Order cards (`20261104090000`): ★order_intake_card, ★order_intake_card_close.
Invitations/approval (`20261105100000`): invitation, salon_membership, ★salon_approval_decision, ★salon_rep_assignment.
Catalogue prices (`20261105110000`): ★sku_price_change, ★salon_sku_price.
Investors (`20261105120000`): investor, ★investment, ★investor_profit_decision, ★investor_payout.
Delivery approval (`20261105130100`): ★delivery_submission, ★delivery_submission_decision, ★pending_stock_resolution.
Commission (`20261105140000`): ★rep_commission_rate, ★commission_payment.
Requests portal (`20261105150000`): ★order_intake_card_version, ★order_intake_card_line.
Invoice composer/signature (`20261105220000`): ★invoice_draft_version, ★invoice_snapshot, ★delivery_signature, ★delivery_signature_image, ★delivery_signature_access, ★delivery_signature_use.
Audit fixes (`20261105230000`): ★owner_stock_adjustment, ★payment_reversal, ★handover_settlement.
Salon self-signup (`20261109200000`): salon_signup_request (no_truncate only, not row-locked).
Storefront (`20261111010000`): storefront_category, storefront_product, storefront_sku, ★storefront_write.

★ = `create trigger append_only before update or delete … control.forbid_mutation()` (doc 04 invariant 1, H-06) → **45 public tables are append-only**. Many others carry only `no_truncate` triggers. `stock_issue` has no row-level append-only trigger (its `disputed` state is an UPDATE by design).

### 1.2 control — 6 tables

★audit_event, audit_chain_head, approval_request, doc_counter (foundation); ★phone_reveal (salons); ★approval_reminder_log (order steps/reminders). ★ = append-only trigger (audit_event: foundation:421; phone_reveal: `20261028060000_salons.sql:222`; approval_reminder_log: `20261111020000_order_steps_reminders.sql:345`). **3 of 6 control tables are append-only.**

`control.forbid_mutation()` (foundation:369) is the shared guard trigger. control.* trigger functions (audit_row, device_guard, invitation_guard, salon_membership_guard, investor_guard, commission_payment_guard, salon_signup_request_guard, sales_order_creator, stock_location_pending_twin, pending_resolution_guard, investment_reversal_guard) are trigger/infrastructure code, not RPC.

---

## 2. RPC function inventory by domain

Conventions: **W** = write path (mutates data, SECURITY DEFINER via `app.*`), **R** = read, **H** = helper (internal; revoked or never granted — not callable by the app). "Exposed" = granted to `authenticated` unless noted; purposes from migration comments. UI caller = first apps/web caller (paths relative to `apps/web/`; `—` = none found).

### 2.1 Auth & devices — 21 functions

| Function | W/R | Purpose (from migration comments) | UI caller |
|---|---|---|---|
| app.my_session | R | The caller's own session: profile, role, device status (device_hardening §3) | app/app/layout.tsx:26, office page.tsx:43, mfa page.tsx:32, lib/rpc.ts:36 |
| app.self_ok | H | True when caller has an active profile and, if a rep, is on the approved device | — (infrastructure) |
| app.register_device | W | SEC-03: register a device fingerprint (hashed); starts `pending`, needs office approval | lib/supabase/browser.ts:80 |
| app.approve_device | W | Office approves a pending device | office/devices/page.tsx:58 |
| app.revoke_device | W | Office revokes a device | office/devices/page.tsx:58 |
| app.fingerprint_hash | H | sha256 of the device fingerprint (revoked from all API roles) | — |
| app.rep_session_ok | H | AUTH-05: an invited rep acts only with an emailed-code session | — |
| app.rep_device_ok | H | Device gate (doc 04 invariant 7); granted to authenticated for RLS | — |
| app.request_device_id | H | Reads the `x-kiran-device` header; granted for RLS | — |
| app.user_role | H | RLS helper: caller's role from the DB | — |
| app.is_aal2 / is_office / is_owner / is_rep | H | RLS role/AAL2 checks (office requires MFA-verified session, SEC-02) | — |
| app.has_vault_grant | H | VLT-06 vault grant check (vault empty; helper for future vault_api) | — |
| app.assert_actor_ready | H | Precondition for every write: active profile, office AAL2, rep on approved device | — |
| app.assert_office / assert_owner | H | Role refusals for write functions | — |
| app.raise_denied | H | Raises 42501 with a fixed message | — |
| app.set_purpose | H | Purpose string carried into the audit row | — |
| app.bootstrap_owner | H | One-time human bootstrap as `postgres` (ACTIVITY §10); never granted | — |

### 2.2 Admin, config & approval framework — 13 functions

| Function | W/R | Purpose | UI caller |
|---|---|---|---|
| app.owner_create_user | W | Owner creates staff users (owner-only, AAL2) | office/team/page.tsx:154 |
| app.owner_set_role | W | Owner sets a user's role | — (see §3) |
| app.owner_set_status | W | Owner suspends/offboards/reactivates a user | office/team/page.tsx:53 |
| app.owner_set_vault_grant | W | VLT-06: grant/revoke vault access | — (see §3) |
| app.owner_set_config | W | Owner sets app_config values (key, value, rep visibility) | office/settings/page.tsx:234 |
| app.request_approval | W | Generic maker-checker request (SEC-11); writeoff checker role added 20261120020000 | office/deliveries/page.tsx:356, office/stock/page.tsx:531 |
| app.decide_approval | W | Checker approves/refuses a request | office/approvals/page.tsx:114, office/deliveries/page.tsx:409 |
| app.cancel_approval | W | Maker cancels own request | office/approvals/page.tsx:102 |
| app.office_pending_approvals | R | The office's open approval requests | office/approvals/page.tsx:71 |
| app.office_refused_approvals | R | Discount/adjustment requests refused in the last 14 days ("vanished from every page" fix) | office/approvals/page.tsx:72 |
| app.fiscal_year | H | Pakistan FY ends 30 June (doc 09 §8) | — |
| app.next_doc_number | H | Gapless document numbers inside the issuing transaction (H-11) | — |
| app.config_number | H | Numeric config value or null (callers fail closed) | — |

### 2.3 Salons / customers — 49 functions (territories, invitations, salon signup, timelines)

| Function | W/R | Purpose | UI caller |
|---|---|---|---|
| app.create_salon | W | SAL-01: create a salon (rep = pending proposal, office = approved); idempotent on client_id | app/salons/new/page.tsx:45, components/office-add-salon.tsx:63 |
| app.update_salon | W | Edit descriptive fields; reps only between areas of their territories | office/salons/[id]/page.tsx:286 |
| app.add_salon_note | W | MAP-03: append a note (append-only chit) | app/salons/[id]/page.tsx:314 (outbox: lib/outbox/types.ts:14) |
| app.rep_park_salon | W | Rep parks a not-interested-now salon | app/salons/[id]/page.tsx:232 |
| app.office_override_stage | W | SAL-03 stage override, mandatory reason, always in history (H7: also writes a credit event) | office/salons/[id]/page.tsx:189 |
| app.office_set_primary_contact | W | Office-only set/replace of the primary phone (until CTL-18 OTP flow) | components/salon-contact.tsx:50 |
| app.move_stage | H | Internal: the only path that moves a stage (event + mirror) | — |
| app.office_upsert_territory | W | Create/update a territory | office/territories/page.tsx:73 |
| app.office_upsert_area | W | Create/update an area | office/territories/page.tsx:128 |
| app.office_assign_territory | W | Assign a territory to a rep | office/territories/page.tsx:186 |
| app.office_end_territory | W | End a rep's territory holding | office/territories/page.tsx:174 |
| app.my_territory_ids | H | Territories the calling rep holds today (RLS helper; granted) | — |
| app.rep_can_reach_salon / rep_can_use_area / rep_holds_salon | H | Reachability tests (R4: direct assignment beats territory coverage) | — |
| app.mask_phone | H | '+920000001234' → '+920*******34' | — |
| app.my_salons | R | The rep's salons, masked phone, keyset-paged cap 50 | lib/salons.ts:47, app/order-notes/page.tsx:56 |
| app.my_salon | R | One salon the rep can reach (R4) | lib/salons.ts:63 |
| app.salon_notes | R | Notes of one salon (newest first, capped) | app/salons/[id]/page.tsx:52, office/salons/[id]/page.tsx:78 |
| app.salon_stages | R | Stage history of one salon | app/salons/[id]/page.tsx:54 |
| app.my_areas | R | The rep's territories + areas (for adding a salon) | app/salons/new/page.tsx:21 |
| app.reveal_phone | W(log) | One phone reveal, logged to control.phone_reveal | app/salons/[id]/page.tsx:139 |
| app.duplicate_phones | R | Phones on more than one active salon (CTL-18 digest) | components/duplicate-phones.tsx:27 |
| app.office_salon_timeline | R | The salon's full timeline (salon row + related event tables) | components/timeline.tsx:18 |
| app.timeline_actor / timeline_label | H | Timeline rendering helpers (internal) | — |
| app.office_invite | W | D-39: invite a rep or salon at AAL2 (emailed code) | office/people/page.tsx:299 |
| app.office_invitations | R | The office's invitation list (no token data) | office/people/page.tsx:50 |
| app.office_revoke_invitation | W | Revoke an unused invitation link | office/people/page.tsx:126 |
| app.invitation_preview | R | What the invitee sees before accepting | app/invite/[token]/page.tsx:49 |
| app.redeem_invitation | W | Redeem token after emailed-code proof; creates profile/membership | app/invite/[token]/page.tsx:133 |
| app.office_set_member_status | W | Suspend/reactivate reps; suspend/reactivate/revoke salon accounts | office/people/page.tsx:76 |
| app.salon_me | R | The caller's own active salon account (allow-listed fields) | app/salon/page.tsx:136, app/app/layout.tsx:30 |
| app.office_decide_salon | W | D-35/D-36: approve (with rep+rate) or reject a pending salon | office/salons/approvals/page.tsx:122 |
| app.office_assign_salon_rep | W | D-36: assign/change/clear a salon's rep (latest row wins) | office/salons/[id]/page.tsx:470 |
| app.office_pending_salons | R | Approvals queue: pending salons (oldest first, cap 200) | office/salons/approvals/page.tsx:46 |
| app.salon_apply | W | Salon self-signup application (emailed-code proof) | app/salon/signup/page.tsx:88 |
| app.office_pending_signups | R | Signup queue with similar-name salons | office/salons/approvals/page.tsx:47 |
| app.office_decide_signup | W | Approve (new or existing salon) or reject a signup | office/salons/approvals/signups.tsx:88 |
| app.salon_login_status | R | AUTH-09: this login's salon account status + name | app/salon/page.tsx:139, app/salon/signup/page.tsx:33 |
| app.session_proved_email, invitation_hash, invitation_state, salon_direct_rep, assert_assignable_rep, assert_assignment_rate, assert_salon_approved, blank_to_null | H | Internal helpers (email proof, token hashing, assignment/rate checks, blank-trimming) | — |

### 2.4 Reps & rep-days (visits) — 10 functions

| Function | W/R | Purpose | UI caller |
|---|---|---|---|
| app.rep_check_in | W | PIP-09: start the day; bag count vs system figures (20261118120000 made the count optional) | app/rep-day.tsx:169 (outbox types.ts:10) |
| app.rep_check_out | W | Close the day (evening daily-close requirement removed 20261118120000) | app/rep-day.tsx:329 (outbox types.ts:12) |
| app.office_force_close_rep_day | W | PIP-09 manager override: close a rep's open day with a reason | components/open-rep-days.tsx:80 |
| app.log_visit | W | PIP-02: log a visit with an outcome; GPS + mock-location flag feed fake-visit detectors | app/salons/[id]/page.tsx:258 (outbox types.ts:13) |
| app.my_day | R | The rep's own day today | app/rep-day.tsx:73 |
| app.salon_visits | R | A salon's visits for a rep who can reach it, or the office | app/salons/[id]/page.tsx:53, office/salons/[id]/page.tsx:79 |
| app.office_rep_detail | R | One rep's detail (documents, figures) for the office | office/reps/[id]/page.tsx:129 |
| app.karachi_today, distance_m, my_open_day_id | H | Karachi date; haversine distance; the rep's open day id | — |

### 2.5 Routes — 7 functions

| Function | W/R | Purpose | UI caller |
|---|---|---|---|
| app.office_set_route | W | PIP-03: office sets a rep's stops for a day, in order (replaces the list) | office/routes/page.tsx:206 |
| app.rep_add_stop | W | Rep adds a salon to today's route (idempotent) | app/route/page.tsx:111, app/rep-day.tsx:278 |
| app.rep_reorder_route | W | PIP-03/REP-13: reorder a route's stops (must name every stop) | app/route/page.tsx:108, app/rep-day.tsx:232 |
| app.office_set_last_purchase | W | A-09: record a salon's last purchase per product group | components/opening-purchase.tsx:83 |
| app.due_list | R | PIP-05/06: salons due/at-risk on a day, per scope | app/route/page.tsx:69, app/rep-day.tsx:88, office/routes/page.tsx:152 |
| app.my_route | R | The rep's route for a day with nearest-due and visited flags | app/route/page.tsx:68 |
| app.parse_route_stops | H | Validate/normalise the stops JSON | — |

### 2.6 Orders — 65 functions (credit, orders, cards/requests portal, order steps & reminders, overviews)

**Credit profile:**

| Function | W/R | Purpose | UI caller |
|---|---|---|---|
| app.owner_set_credit | W | MJ L-0163: owner sets plan eligibility and limit by hand | components/salon-credit.tsx:223 |
| app.office_raise_limit | W | Doc 09 §2: manager raise within cap/percent; owner any amount | components/salon-credit.tsx:296 |
| app.office_set_blocked | W | Block (any office) / unblock (manager within cap; owner always) | components/salon-credit.tsx:168 |
| app.salon_credit_status | R | Credit terms a rep needs to choose a plan | components/salon-credit.tsx:70 |
| app.write_credit, credit_of, salon_exposure, manager_overrides_this_month, assert_manager_override_allowed | H | Internal credit engine (exposure redefined by H4/FLOW-03 in audit fixes) | — |

**Order engine & lists:**

| Function | W/R | Purpose | UI caller |
|---|---|---|---|
| app.build_order | H | Shared order engine: checks, discount approval, insert (D-35 approved-salon check; D-37 salon price; D-45 owner discount) | — |
| app.create_order | W | Rep order path — **closed by D-30**: body now raises "reps no longer place orders: record an order card"; still granted | — (deliberate; see §3) |
| app.office_create_order | W | D-30: office makes the order (from a card or not); assigned rep per R4 | office/orders/page.tsx:160, components/order-form.tsx:284 |
| app.recheck_order | W | ORD-10: re-run checks after approval/credit change/sync | office/approvals/page.tsx:93, office/orders/[id]/page.tsx:310 |
| app.office_release_credit_hold | W | ORD-02: release a credit-held order with a reason | office/orders/[id]/page.tsx:260 |
| app.cancel_order | W | ORD-03: cancel draft (rep) or draft/confirmed (office) with reason | office/orders/[id]/page.tsx:273 |
| app.evaluate_order | H | Re-run checks and confirm a draft | — |
| app.my_orders | R | ORD-01-era: the rep's own orders (superseded in UI by territory/month lists) | — (see §3) |
| app.my_territory_orders | R | Rep territory view: orders of reachable salons (newest 50) | app/orders/page.tsx:49 |
| app.my_territory_order | R | REP-03: one territory order by id (delivery page) | app/orders/[id]/deliver/page.tsx:57 |
| app.office_orders | R | Office order list (newest 200, status/channel filters) | office/orders/page.tsx:117 |
| app.order_remaining | R | What is left on an order | app/orders/[id]/deliver/page.tsx:58, office/orders/[id]/page.tsx:80 |
| app.order_lines_left, order_lines_open | H | Per-line left-to-deliver and open-to-submit quantities | — |

**Order cards / salon requests portal (D-30, D-34, SAL-12):**

| Function | W/R | Purpose | UI caller |
|---|---|---|---|
| app.rep_create_card | W | ORD-14: rep saves what the salon needs as a card | app/order-notes/page.tsx:174, app/salons/[id]/page.tsx:376 (outbox types.ts:16) |
| app.rep_edit_card | W | B-40(d): new version of an open card | app/cards/page.tsx:198 |
| app.rep_cancel_card | W | Rep cancels own open card | app/cards/page.tsx:142 |
| app.my_cards | R | The rep's cards and how each ended | app/cards/page.tsx:54, app/order-notes/page.tsx:55 |
| app.office_open_cards | R | The office's queue of open cards (oldest 200) | office/orders/page.tsx:105 |
| app.office_dismiss_card | W | Close a card without an order (reason 5–500 chars) | office/orders/page.tsx:293 |
| app.salon_submit_request | W | SAL-12/ORD-11 (D-34/D-41): salon sends its own request | app/salon/page.tsx:378 |
| app.salon_edit_request | W | B-40(d): salon edits its request until reviewed | app/salon/page.tsx:541 |
| app.salon_cancel_request | W | Salon cancels own request until reviewed | app/salon/page.tsx:483 |
| app.salon_catalogue | R | Catalogue the salon orders from (salon's own price when set; availability added 20261121130000) | app/salon/page.tsx:145 |
| app.salon_my_requests | R | The salon's own requests with versions/lines | app/salon/page.tsx:146 |
| app.salon_my_orders | R | The salon's official orders (no rep/creator/hold details) | app/salon/page.tsx:147 |
| app.card_* (version, body, updated_at, order_lines, lines_shown, lines_key, stored_key, note), insert_card_lines, assert_card_lines, my_salon_id, assert_salon_member | H | Card versioning/lines helpers (all internal, no grant) | — |

**Order steps & reminders (P1-38, MSG-03):**

| Function | W/R | Purpose | UI caller |
|---|---|---|---|
| app.office_order_steps | R | Step projection for the office | components/order-steps.tsx:93 |
| app.salon_order_steps | R | Same projection, own orders, no actor names | components/order-steps.tsx:101 |
| app.office_reminder_log | R | Recorded reminder rounds | components/reminder-log.tsx:37 |
| app.approval_reminders_due | R | **Granted to `service_role` only**: one row per recipient due a reminder | — (see §3: no production wiring) |
| app.record_approval_reminders | W | **service_role only**: records every claim or none | — (no production wiring) |
| app.order_step_registry, order_steps_projected, reminder_config_int, reminder_enabled, reminder_body, assert_service_role | H | Step registry/projection + reminder helpers (internal/service) | — |

**Overviews (office home, rep month, investor month):**

| Function | W/R | Purpose | UI caller |
|---|---|---|---|
| app.office_overview_counts | R | Office home counts (whole table) + cash-cap reps + waiting handovers | office/page.tsx:44 |
| app.office_overview_rows | R | Office home lists (placed/waiting/deliveries/…) + undelivered_paisa (FLOW-09) | office/page.tsx:45 |
| app.office_rep_month | R | Every rep's month: orders by status + commission earned/paid/owed | office/reps/page.tsx:16 |
| app.my_month_orders | R | The rep's orders of the month | components/rep-month.tsx:25 |
| app.office_investor_month | R | Investor "This month" block | components/investor-month.tsx:72 |
| app.rep_month_orders, order_placed_by, order_undelivered_paisa, karachi_month, overview_month | H | Overview helpers (internal) | — |

### 2.7 Deliveries, invoices & signature documents — 36 functions

| Function | W/R | Purpose | UI caller |
|---|---|---|---|
| app.rep_submit_delivery | W | D-32: rep hands goods over; bag→pending custody; nothing official changes until office decides | app/orders/[id]/deliver/page.tsx:99 (outbox types.ts:19) |
| app.office_approve_delivery | W | Office approves a submission → app.finalise_delivery writes delivery/invoice/order moves | office/deliveries/page.tsx:142 |
| app.office_reject_delivery | W | Reject with reason; goods stay in pending custody to settle | office/deliveries/page.tsx:214 |
| app.office_resolve_pending | W | Settle rejected-submission goods: returned_to_bag / to_warehouse / missing (owner path in audit fixes) | office/deliveries/page.tsx:245 |
| app.office_pending_stock | R | What waits to be settled per rejected submission/SKU | office/deliveries/page.tsx:107, office/page.tsx:49 |
| app.office_pending_deliveries | R | Office queue of undecided submissions (oldest 200) | office/deliveries/page.tsx:106 |
| app.my_submissions | R | The rep's submissions: pending/approved/rejected | app/deliveries/page.tsx:119 |
| app.finalise_delivery | H | The one finalising path (stock, invoice numbering, order/salon moves, cycle estimate) | — |
| app.deliver / rep_deliver / office_deliver | H/legacy | Pre-D-32 direct delivery paths; rep_deliver **revoked** (closed, plan Task 7); office_deliver still granted but refuses while a submission waits (Review Focus 3) | office_deliver: office/orders/[id]/page.tsx:367 |
| app.pending_location_of, pending_unsettled, post_adjustment, office_post_adjustment | H/W | Pending-custody helpers; office_post_adjustment granted (posts an approved adjustment request) | office/stock/page.tsx:606 |
| app.delivery_ack_text | R | The acknowledgement statement the rep shows the customer | components/acknowledgement.tsx:63 |
| app.rep_attach_signature | W | Attach customer ack/refusal (base64) to own undecided submission | app/deliveries/page.tsx:91, app/orders/[id]/deliver/page.tsx:153 (outbox types.ts:20) |
| app.my_signature_status | R | Rep's own submission ack status (no picture) | app/deliveries/page.tsx:53 |
| app.office_delivery_signature | R | Office reads one submission's ack status + exception | components/submission-signature.tsx:40 |
| app.office_signature_image | R | The ack picture as base64, office only; every opening logged | office/invoices/[id]/page.tsx:73 |
| app.office_attach_signature | W | Rep-less order: office records the salon's ack before delivering | office/orders/[id]/page.tsx:411 |
| app.office_order_signature | R | Whether a waiting order has an unused signed ack | office/orders/[id]/invoice/page.tsx:59 |
| app.office_save_invoice_draft | W | Save the invoice composer draft (versioned, snapshot on issue) | office/orders/[id]/invoice/page.tsx:76 |
| app.office_invoice_preview | R | Draft preview: invoice as it would be issued now (marked draft, no number) | office/orders/[id]/invoice/page.tsx:54 |
| app.invoice_document | R | Issued invoice: issue-time snapshot + payments overlay (office or the invoice's rep) | office/invoices/[id]/page.tsx:34 |
| app.invoice_document_live, invoice_payments_overlay | H | Snapshot builder + post-issue overlay (internal; overlay revoked) | — |
| app.plan_schedule | H | Installments of a plan for a total (internal, no grant) | — |
| app.salon_my_invoices | R | Salon lists its own issued invoices | components/salon-invoices.tsx:25 |
| app.salon_invoice_document | R | Salon opens its own invoice document | app/salon/invoices/[id]/page.tsx:22 |
| app.office_invoices | R | Newest 100 invoices (filter by salon); total_count over filter | components/document-lists.tsx:21 |
| app.receipt_document | R | Everything a receipt shows (CTL-01), as one JSON value | app/receipts/[id]/page.tsx:26, office/receipts/[id]/page.tsx:27 |
| app.office_receipts | R | Newest 100 receipts (by salon/invoice/all) | components/document-lists.tsx:63 |
| app.delivery_ack_statement, delivery_lines_hash, submission_lines_hash | H | Ack statement + lines-hash helpers (internal) | — |

### 2.8 Payments, cash & handover — 26 functions

| Function | W/R | Purpose | UI caller |
|---|---|---|---|
| app.rep_record_payment | W | PAY-02/CTL-02: rep records payment at the salon (GPS, flags); D-47 intraday cash cap | components/money-section.tsx:48 (outbox types.ts:17) |
| app.office_record_payment | W | Office records a bank transfer on behalf (flagged on_behalf, never cash) | components/money-section.tsx:37 |
| app.office_record_cash | W | PAY-02/L-0362: owner/manager records cash collected | components/money-section.tsx:44 |
| app.record_payment | H | Internal: the one payment path (refusal message quotes rupees, REP-16); revoked from roles | — |
| app.office_reverse_payment | W | D-48: reverse a payment with a reason; cash leaves the ledger | components/salon-payments.tsx:124 |
| app.office_salon_payments | R | FLOW-13/D-48: a salon's payments with flags + reversal; may_reverse | components/salon-payments.tsx:74 |
| app.my_collections | R | REP-09: the rep's own payments (newest 50) | components/my-collections.tsx:26 |
| app.salon_installments | R | What the salon owes, installment by installment | components/money-section.tsx:87 |
| app.salon_balance | R | Derived receivable: invoiced − paid, overdue part, next due | components/money-section.tsx:86 |
| app.salon_my_account | R | The salon's account: balance + payments (reversal-aware, D-48) | app/salon/page.tsx:144 |
| app.office_receivables_ageing | R | PAY-07/D-48: ageing buckets by days past due (salon/territory/rep) | office/receivables/page.tsx:53 |
| app.my_cash_position | R | PAY-04: cash in hand from the ledger (own or any rep for office) | app/handovers/page.tsx:52 |
| app.office_rep_cash_position | R | A rep's cash position for the office | office/handovers/page.tsx:262, office/reps/[id]/page.tsx:399 |
| app.office_cash_cap_reps | R | D-47: reps at/over the intraday cash cap | office/page.tsx:46 |
| app.office_inactive_rep_cash | R | Suspended/offboarded reps still holding cash | office/handovers/page.tsx:83 |
| app.office_count_handover | W | PAY-05: record counted cash from a rep (idempotent) | office/handovers/page.tsx:284 |
| app.rep_respond_handover | W | CTL-03: rep answers once — ack (cash moves) or dispute | app/handovers/page.tsx:137 |
| app.owner_settle_handover | W | D-46: owner settles a disputed handover | office/handovers/page.tsx:111 |
| app.office_withdraw_handover | W | D-46: withdraw an unanswered count (second-reader case) | office/handovers/page.tsx:122 |
| app.my_handovers | R | Rep's handovers: what to answer, what was decided | app/handovers/page.tsx:52 |
| app.office_handovers | R | Office list (open first, newest 100) | office/handovers/page.tsx:80 |
| app.office_cash_position | R | Office cash = handovers in − deposits out (deposits not built yet) | office/handovers/page.tsx:81 |
| app.rep_cash_balance, installment_state, can_see_salon_money, assert_salon_money | H | Ledger/access helpers (internal) | — |

### 2.9 Inventory, stock, warehouses & catalogue prices — 40 functions

| Function | W/R | Purpose | UI caller |
|---|---|---|---|
| app.office_upsert_product_group | W | Catalogue: create/update product group | office/products/page.tsx:184 |
| app.office_upsert_product | W | Catalogue: create/update product (D-39) | office/products/page.tsx:381 |
| app.office_upsert_sku | W | Catalogue: create/update SKU (structure only; prices owner-only) | office/products/page.tsx:664 |
| app.office_set_sku_price | W | D-39: set a SKU's list price with reason (history in sku_price_change) | office/products/page.tsx:701 |
| app.owner_set_sku_price | W | Owner-only price path (also writes history) | — (see §3) |
| app.office_set_salon_price | W | D-37: set/clear one salon's price for one SKU | office/salons/[id]/page.tsx:638 |
| app.office_salon_prices | R | The office price sheet for one salon | office/salons/[id]/page.tsx:564, components/order-form.tsx:226 |
| app.office_catalogue | R | The office catalogue (inactive too; no vault figures) | office/products/page.tsx:92 |
| app.office_create_location | W | Create warehouse/bag/pending location (pending only via twin trigger) | office/stock/page.tsx:340 |
| app.owner_set_bag_limit | W | Bag value limit per location | office/stock/page.tsx:387 |
| app.office_set_reorder_point | W | Set a SKU's reorder point | office/stock/levels/page.tsx:243 |
| app.office_propose_stock_issue | W | INV-05: propose stock issue to rep bag / return to warehouse | office/stock/page.tsx:658 |
| app.rep_confirm_stock_issue | W | Rep confirms with own count; mismatch = disputed, nothing moves (20261107020000 status-only confirm) | app/stock/page.tsx:179 |
| app.office_cancel_stock_issue | W | Cancel a disputed/unconfirmed issue | office/stock/page.tsx:299 |
| app.record_count | W | INV-05: record a stock count (variance → approval-gated adjustment) | office/stock/levels/page.tsx:316 (outbox types.ts:11) |
| app.office_post_adjustment | W | Post an approved `adjustment` request (owner threshold re-checked at use) | office/stock/page.tsx:606 |
| app.owner_adjust_stock | W | D-45: owner adjusts warehouse/bag directly | office/stock/page.tsx:518 |
| app.office_adjustment_checker | R | H2: which checker an adjustment needs | office/deliveries/page.tsx:364 |
| app.record_demand | W | DEM-01: lost demand ("asked for, could not sell") | components/lost-demand.tsx:106 (outbox types.ts:18) |
| app.my_bag | R | INV-04: the rep's bag contents | app/stock/page.tsx:48, app/rep-day.tsx:74 |
| app.warehouse_availability | R | Warehouse available quantities (AAL2 gate added 20261117120000) | app/stock/page.tsx:49, office/stock/levels/page.tsx:61 |
| app.stock_on_hand | R | Stock on hand per location/SKU (office) | office/stock/levels/page.tsx:294 |
| app.low_stock | R | SKUs at/below reorder point | office/stock/levels/page.tsx:62 |
| app.my_pending_issues | R | Issues waiting for the rep's confirmation (blind counts) | app/stock/page.tsx:47 |
| app.my_issue_skus | R | SKU names for an issue (20261106070000) | app/stock/page.tsx:53 |
| app.office_receive_stock | W | **20261121010000 (newest): receive stock into a warehouse + restock suggestions** | — (see §3) |
| app.office_restock_suggestions | R | **20261121010000: restock suggestions from reorder points/demand** | — (see §3) |
| app.my_bag_id, on_hand, pending_out, parse_lines, assert_reason, price_ceiling_paisa, salon_price, assert_office_price, assert_price_reason, may_read_product_images, adjustment_needs_owner, post_adjustment, owner_post_adjustment | H | Internal helpers (bag id, stock sums, line/reason/price validation, storage RLS helper, adjustment internals) | — |

### 2.10 Investors — 19 functions

| Function | W/R | Purpose | UI caller |
|---|---|---|---|
| app.office_create_investor | W | CAP-01: add an investor (idempotent on client_id) | office/investors/page.tsx:131 |
| app.office_update_investor | W | Update name/phone/note; close needs nothing outstanding (accrued return aware, 20261120060000) | office/investors/[id]/page.tsx:577 |
| app.office_add_investment | W | CAP-01: money in (reversal rows correct mistakes) | office/investors/[id]/page.tsx:303 |
| app.office_decide_profit | W | CAP-02: owner/manager types a profit amount (nothing calculates it) | office/investors/[id]/page.tsx:360 |
| app.office_record_payout | W | CAP-02/03: profit or principal payout (capped at accrued promised return + decisions, 20261120060000) | office/investors/[id]/page.tsx:393 |
| app.office_reverse_investor_entry | W | CAP-02: reversal row with a reason (once per entry) | office/investors/[id]/page.tsx:553 |
| app.office_investors | R | Every investor with derived figures + totals row | office/investors/page.tsx:23 |
| app.office_investor_investments | R | One investor's investments with derived figures | office/investors/[id]/page.tsx:51 |
| app.office_investor_statement | R | One investor's statement with running balances (accrued return aware) | office/investors/[id]/page.tsx:463 |
| app.investor_assert_* (amount/date/note/details), investment_figures, investor_lock, investor_entry_lock, investor_open_investment, investor_accrued_return | H | Internal validation/derivation/locking helpers | — |

### 2.11 Commission — 11 functions

| Function | W/R | Purpose | UI caller |
|---|---|---|---|
| app.office_set_commission_rate | W | D-31/D-38: set a rep's default rate (basis points) | office/commission/page.tsx:101 |
| app.office_record_commission_payment | W | Pay a rep (≤ earned and unpaid; guard trigger) | office/commission/page.tsx:120 |
| app.office_reverse_commission_payment | W | Reverse one payment in full (once) | office/commission/page.tsx:332 |
| app.my_commission | R | The rep's commission statement for a range | app/commission/page.tsx:23, components/rep-month.tsx:28 |
| app.office_commission | R | One rep's statement for the office | office/commission/page.tsx:65, office/reps/[id]/page.tsx:395 |
| app.office_commission_reps | R | Every rep with rate/earned/paid/owed (cap 200) | office/commission/page.tsx:62 |
| app.commission_rate_for, assert_commission_range, commission_earned_paisa, commission_paid_paisa, commission_statement | H | Internal rate/statement helpers | — |

### 2.12 Storefront / public shop — 12 functions (P1-33; no `storefront` schema — tables live in `public`)

| Function | W/R | Purpose | UI caller |
|---|---|---|---|
| app.storefront_catalogue | R | **Visitor reads, granted to `anon` + authenticated**: public catalogue | — (no public shop page in apps/web; see §3) |
| app.storefront_product | R | **Visitor reads, granted to `anon` + authenticated**: one product page | — (no public shop page) |
| app.office_upsert_storefront_category | W | Office writes a category page (slug/meta unique) | office/products/online-shop.tsx:161 |
| app.office_upsert_storefront_product | W | Office writes a product page | office/products/online-shop.tsx:264 |
| app.office_set_storefront_published | W | Publish/unpublish; pictures of published pages are protected | office/products/online-shop.tsx:119 |
| app.office_storefront_sheet | R | The office panel's read (direct table selects stay denied) | office/products/page.tsx:79 |
| app.storefront_image_published | H | Storage delete-policy helper (granted to authenticated) | — |
| app.storefront_seen, storefront_record, storefront_hash, storefront_shade_available, storefront_duplicate | H | Write idempotency, shade availability, duplicate-message helpers (internal) | — |

---

## 3. Granted functions with NO frontend caller (cross-check result)

309 names → 177 with a non-test caller, 24 granted names with none, plus 108 internal (revoked/never granted) that are not meant to be called from the UI. The 24 split as follows:

**A. Genuinely uncovered business capabilities (frontend work candidates):**

| Function | Kind | Why it matters |
|---|---|---|
| `app.office_receive_stock` | W | Newest capability (20261121010000): receiving stock into a warehouse. No UI anywhere. |
| `app.office_restock_suggestions` | R | Same migration: restock suggestions read. No UI. (These two ship together.) |
| `app.owner_set_role` | W | Owner can change a user's role; the team page (office/team/page.tsx) only calls owner_set_status/owner_create_user. |
| `app.owner_set_vault_grant` | W | Vault grant toggle; vault_api/supplier_vault are empty, so low value today, but the write exists. |
| `app.storefront_catalogue` | R | Granted to **anon** — the public shop. apps/web has only the office panel (`office/products/online-shop.tsx`) and `lib/storefront-images.ts`; no visitor-facing page calls these. The migration header says "Visitors read two functions only" (20261111010000_storefront_catalogue.sql:4). |
| `app.storefront_product` | R | Same as above (public product page). |

**B. Exposed but superseded / deliberately retired (probably fine to leave uncalled):**

| Function | Note |
|---|---|
| `app.my_orders` | Granted since the orders migration; UI moved to `my_month_orders` + `my_territory_orders`. Legacy read. |
| `app.create_order` | Granted but body raises "reps no longer place orders: record an order card (D-30)" (20261104090000_office_orders_cards.sql:940-949). Deliberately closed rep path. |
| `app.owner_set_sku_price` | Owner price path; the UI uses `office_set_sku_price` (products page). |
| `app.my_bag_id` | Granted to authenticated; used internally by `my_bag`/RLS; UI reads `my_bag`. |

**C. Backend infrastructure — no UI caller by design (RLS/storage/device helpers):**
`user_role`, `is_aal2`, `is_office`, `is_owner`, `is_rep`, `has_vault_grant`, `request_device_id`, `rep_device_ok`, `self_ok`, `my_territory_ids`, `may_read_product_images`, `storefront_image_published`.

**D. service_role jobs with no production wiring:**
`approval_reminders_due`, `record_approval_reminders` are granted **only to service_role** (20261111020000_order_steps_reminders.sql:617-622). `apps/web/lib/email/reminder-job.ts` implements the job logic with injected `due`/`record` deps, but only its test file (`reminder-job.test.ts`) constructs it — no production caller calls these two DB functions from anywhere in the repo (mail adapter is intentionally unconfigured until B-61).

**Coverage of internal helpers:** all 72 revoked + 36 never-granted functions have no caller, correctly — they are unreachable by the app (default privileges in schema `app` revoke execute from public; foundation.sql:34, 758).

---

## 4. packages/import and packages/shared status

- **packages/import** — EXISTS, built. `@kiran/import` (package.json): "Excel/CSV salon import: field mapping and dry-run (P0-02, SAL-10). **Writes nothing to any database**"; bin `kiran-import-dry-run` → `src/cli.ts`; deps: exceljs 4.4.0; scripts: dry-run/test/typecheck. Source: `src/cli.ts`, `src/core/` (the normalisers CLAUDE.md mentions), `src/read.ts`, `src/xlsx-raw.ts`; tests present. Not wired to apps/web (no reference found in apps/web source).
- **packages/shared** — DOES NOT EXIST in this branch (`ls packages/` → only `import/`). Root CLAUDE.md: "**Planned, not built yet** (first needed by the offline PWA, P1-09; P1-02 parts a and b shipped without it): types generated from the DB, validation schemas. Today the import normalisers live in `packages/import/src/core/`." (High confidence: directory absent + doc statement.)

---

## 5. Direct table reads from apps/web (RLS-gated, via `.from(...)`)

The frontend also reads public tables directly under RLS (not RPC). Distinct tables observed at ~60 call sites: user_profile, device, app_config, territory, area, rep_territory, salon, salon_contact, salon_membership, salon_approval_decision, salon_rep_assignment, salon_credit, credit_event, sales_order, sales_order_line, invoice, investor, product_group, sku, stock_location, stock_issue, stock_count, reorder_rule, rep_day, cycle_estimate, route, route_stop, demand_signal. This is the read-path complement to the RPC write path ("the only write path, H-08", lib/rpc.ts).

Representative call sites: app/app/layout.tsx:22 (user_profile); components/duplicate-phones.tsx:30 (salon); components/lost-demand.tsx:48,61,62 (demand_signal, sku, product_group); components/office-add-salon.tsx:32 (area); components/open-rep-days.tsx:30 (rep_day); components/opening-purchase.tsx:31,32 (product_group, cycle_estimate); components/order-form.tsx:98,111,117,192,201 (salon_rep_assignment, salon, rep_territory, salon, sku); office/(shell)/page.tsx:31-110 (many: territory, area, rep_territory, user_profile, device, investor, stock_issue, rep_day, salon_membership, sku, reorder_rule, stock_location, salon, sales_order, sales_order_line, stock_count, salon_contact, route); components/salon-credit.tsx:72,76,82 (salon_credit, credit_event, app_config); components/request-lines.tsx:19 (sku); components/reminder-log.tsx:40 (user_profile); app/rep-day.tsx:77 (rep_day); office/(shell)/routes/page.tsx (route_stop); office/(shell)/stock pages (stock_location, sku, stock_issue); office/(shell)/invoices/[id]/page.tsx:42 (invoice); office/(shell)/territories/page.tsx (territory/area/rep_territory); office/(shell)/investors/[id]/page.tsx:49 (investor).

---

## 6. Counts summary (for the coverage matrix)

| Domain | Unique functions |
|---|---|
| Auth & devices | 21 |
| Admin, config & approval framework | 13 |
| Salons/customers (territories, invitations, signup, timelines) | 49 |
| Reps & rep-days (visits) | 10 |
| Routes | 7 |
| Orders (credit, engine, cards/requests, steps/reminders, overviews) | 65 |
| Deliveries, invoices & signature documents | 36 |
| Payments, cash & handover | 26 |
| Inventory, stock, warehouses & catalogue prices | 40 |
| Investors | 19 |
| Commission | 11 |
| Storefront / public shop | 12 |
| **Total unique app.\*** | **309** (418 definitions; 201 granted / 72 revoked / 36 never granted) |
| vault_api.\* | **0** (schema created, never populated) |
| Schemas | public (71 tables, 45 append-only), control (6 tables, 3 append-only), app (0 tables), supplier_vault (empty), vault_api (empty) |

**Uncovered business capabilities (frontend candidates):** `office_receive_stock`, `office_restock_suggestions`, `owner_set_role`, `owner_set_vault_grant`, `storefront_catalogue`, `storefront_product` (+ service-role reminder pair with no production wiring, + legacy `my_orders`/`create_order`/`owner_set_sku_price`/`my_bag_id`).

**Independent agents:** no tables, no functions, no UI — the domain exists only in the cross-domain brief (docs/14). Not part of the Phase 1 backend surface.

## 7. Unknowns / caveats

- Grant-state derivation is name-based; same-name functions with different signatures over time (e.g. `register_device`, `record_payment`) are treated as one name. Spot-checks of grant blocks matched the headers.
- `alter default privileges … revoke execute` (foundation.sql:34-36) applies to functions created later by the same migration role; every later migration still issues explicit grants for its exposed functions, so "never granted = internal" matches the migration headers ("Internal (no grant)").
- The 24-name no-caller list is a string-literal search; a caller that builds function names dynamically would be missed. None found: `lib/rpc.ts` passes literals everywhere.
- Whether `office_receive_stock`/`office_restock_suggestions` have UI work in progress elsewhere (e.g. `worktrees/`, `.worktrees/`) was not checked — out of scope; those directories were not inventoried.
