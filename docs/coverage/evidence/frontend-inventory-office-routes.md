# Office route table — reconciliation supplement to frontend-inventory.md

Written 2026-11-21 (PKT), AutoClaw project 「K」. Purpose: the delegated frontend-inventory report ([frontend-inventory.md](frontend-inventory.md)) covered the office surface by totals, gating, partials and components, but did not tabulate the 30 office routes individually. This supplement closes that gap with the same evidence discipline.

**Method:** route list and page headings extracted directly from the files (`Get-ChildItem -Recurse apps/web/app/office -Filter page.tsx` = 30 files; first `<h1>` per file via ripgrep). Data sources are the office call sites already mapped in [backend-inventory.md](../../../backend-inventory.md) §2 (function → first UI caller); purposes for detail pages come from the file's own heading. Nothing was run; read-only.

Office gating, precisely (verified in `apps/web/proxy.ts:40-43` and the `(shell)` layout): `/office/login` is intentionally reachable signed-out; every other `/office/*` route requires a signed-in user; AAL2 is required on all of them **except `/office/mfa`**, which must accept the AAL1 session exactly so MFA can be completed; the 28 `(shell)` application routes additionally pass the layout's active owner/manager-profile check. See frontend-inventory.md §5. Status: BUILT means code-verified on branch `integration/single-repo-consolidation`; per ACTIVITY §12 many of these slices are merged but "awaiting an independent check" — that caveat applies to every row below and is not repeated.

| Route | File (under `apps/web/app/office/`) | Page heading (from file) | Data sources (`app.*` unless noted) | Status |
|---|---|---|---|---|
| `/office` | `(shell)/page.tsx` | Overview | `office_overview_counts`, `office_overview_rows`, `office_pending_stock`, `office_cash_cap_reps`; ~20 direct table reads (backend-inventory §5) | BUILT (P1-25/26/30) |
| `/office/approvals` | `(shell)/approvals/page.tsx` | Approvals | `office_pending_approvals`, `office_refused_approvals`, `decide_approval`, `cancel_approval`, `recheck_order` | BUILT (P1-30) |
| `/office/commission` | `(shell)/commission/page.tsx` | Commission | `office_set_commission_rate`, `office_record_commission_payment`, `office_reverse_commission_payment`, `office_commission`, `office_commission_reps` | BUILT (P1-22) |
| `/office/deliveries` | `(shell)/deliveries/page.tsx` | Delivery approvals | `office_pending_deliveries`, `office_approve_delivery`, `office_reject_delivery`, `office_resolve_pending`, `office_pending_stock`, `request_approval`, `decide_approval`, `office_adjustment_checker` | BUILT (P1-21/30) |
| `/office/devices` | `(shell)/devices/page.tsx` | Devices | `approve_device`, `revoke_device`; `device` table reads | BUILT |
| `/office/handovers` | `(shell)/handovers/page.tsx` | Cash handover | `office_count_handover`, `owner_settle_handover`, `office_withdraw_handover`, `office_handovers`, `office_cash_position`, `office_inactive_rep_cash`, `office_rep_cash_position` | BUILT (P1-07/30) |
| `/office/investors` | `(shell)/investors/page.tsx` | Investors | `office_create_investor`, `office_investors` | BUILT (P1-20) |
| `/office/investors/[id]` | `(shell)/investors/[id]/page.tsx` | (investor name) | `office_investor_investments`, `office_investor_statement`, `office_add_investment`, `office_decide_profit`, `office_record_payout`, `office_reverse_investor_entry`, `office_update_investor` | BUILT (P1-20; recurring return per 20261120060000) |
| `/office/invoices` | `(shell)/invoices/page.tsx` | Invoices and receipts | `office_invoices`, `office_receipts` (document-lists component) | BUILT (P1-28) |
| `/office/invoices/[id]` | `(shell)/invoices/[id]/page.tsx` | Invoice | `invoice_document`, `office_signature_image`; `invoice` table read | BUILT (P1-28/31) |
| `/office/orders` | `(shell)/orders/page.tsx` | Orders | `office_create_order`, `office_orders`, `office_open_cards`, `office_dismiss_card` (order-form component: `office_salon_prices`) | BUILT (P1-30, D-30) |
| `/office/orders/[id]` | `(shell)/orders/[id]/page.tsx` | Order for (salon) | `order_remaining`, `recheck_order`, `office_release_credit_hold`, `cancel_order`, `office_deliver`, `office_attach_signature` | BUILT (P1-25/30/31) |
| `/office/orders/[id]/invoice` | `(shell)/orders/[id]/invoice/page.tsx` | Prepare the invoice | `office_order_signature`, `office_invoice_preview`, `office_save_invoice_draft` | BUILT (P1-31) |
| `/office/people` | `(shell)/people/page.tsx` | People | `office_invite`, `office_invitations`, `office_revoke_invitation`, `office_set_member_status` | BUILT (P1-18) |
| `/office/products` | `(shell)/products/page.tsx` | Products | `office_catalogue`, `office_upsert_product_group`, `office_upsert_product`, `office_upsert_sku`, `office_set_sku_price`, `office_storefront_sheet`; `online-shop.tsx`: `office_set_storefront_published`, `office_upsert_storefront_category`, `office_upsert_storefront_product` | BUILT (P1-19/33); product-group controls owner-only (B-41 follow-up) |
| `/office/receipts/[id]` | `(shell)/receipts/[id]/page.tsx` | Receipt | `receipt_document` | BUILT (P1-28) |
| `/office/receivables` | `(shell)/receivables/page.tsx` | Receivables | `office_receivables_ageing` | BUILT (P1-07, PAY-07) |
| `/office/reps` | `(shell)/reps/page.tsx` | Rep performance | `office_rep_month` | BUILT (P1-26/30) |
| `/office/reps/[id]` | `(shell)/reps/[id]/page.tsx` | Rep (name) | `office_rep_detail`, `office_rep_cash_position`, `office_commission` | BUILT (P1-28); partial: payments/collections, handover history and approving from this page not built (frontend plan §6) |
| `/office/routes` | `(shell)/routes/page.tsx` | Routes | `office_set_route`, `due_list`; `route_stop` reads | BUILT (P1-29) |
| `/office/salons` | `(shell)/salons/page.tsx` | Salons | direct RLS reads `salon`, `salon_approval_decision` (:43, :62); `OfficeAddSalon` (`create_salon`), `DuplicatePhones` (`duplicate_phones`) | BUILT (P1-02/24) |
| `/office/salons/approvals` | `(shell)/salons/approvals/page.tsx` | Salon approvals | `office_pending_salons`, `office_decide_salon`, `office_pending_signups`, `office_decide_signup` | BUILT (P1-18) |
| `/office/salons/[id]` | `(shell)/salons/[id]/page.tsx` | (salon name) | `update_salon` (:286), `office_override_stage` (:189), timeline component (`office_salon_timeline`, :243), `office_assign_salon_rep`, `office_set_salon_price`, MoneySection (`office_record_payment`, `office_record_cash`, `salon_balance`, `salon_installments`), salon-payments (`office_salon_payments`, `office_reverse_payment`) | BUILT (P1-24/30) |
| `/office/settings` | `(shell)/settings/page.tsx` | Settings | `owner_set_config`; `office_reminder_log` (reminder-log); read-only config keys | BUILT; partial: several config keys presentational, reminder job has no runner (B-61) |
| `/office/stock` | `(shell)/stock/page.tsx` | Stock | `stock_on_hand` (whole-stock view, `p_location_id null`, :84), `office_propose_stock_issue`, `office_cancel_stock_issue`, `owner_adjust_stock`, `office_post_adjustment`, `office_create_location`, `owner_set_bag_limit`; direct reads `stock_location`, `user_profile`, `sku`, `stock_issue` | BUILT (P1-04/29/30) |
| `/office/stock/levels` | `(shell)/stock/levels/page.tsx` | Stock levels | `warehouse_availability`, `low_stock` (:61-62), `stock_on_hand` (per-location held check in the count flow, :294 — both stock pages call it), `office_set_reorder_point`, `record_count`; direct reads `sku`, `reorder_rule`, `stock_location`, `stock_count`, `user_profile` | BUILT (P1-29) |
| `/office/team` | `(shell)/team/page.tsx` | Team | `owner_create_user`, `owner_set_status` | BUILT; **partial: `owner_set_role` has no UI control** (plan slice C2) |
| `/office/territories` | `(shell)/territories/page.tsx` | Territories | `office_upsert_territory`, `office_upsert_area`, `office_assign_territory`, `office_end_territory` | BUILT (P1-02/28); B-35 minor error-card defect noted, fix awaiting re-verification |
| `/office/login` | `login/page.tsx` | Office sign-in | Supabase auth `signInWithPassword` | BUILT |
| `/office/mfa` | `mfa/page.tsx` | Two-step verification | auth.mfa enroll/verify; `my_session`, `salon_me` | BUILT |

**No office route calls an uncovered capability except those named in the plan:** `office_receive_stock` / `office_restock_suggestions` (slice C1), `owner_set_role` (C2), `owner_set_vault_grant` (C2/deferred), and the storefront visitor reads (C11) have no office page either — consistent with backend-inventory.md §3.

**Coverage note for the delegation record:** this supplement, plus frontend-inventory.md §5–§9, now completes the office half of the delegated "every route under apps/web/app" scope. Phase B's coverage matrix and its route-completeness check (`scripts/coverage/check.mjs`) are **planned, not built** — only once Phase B lands is this enumeration CI-enforced.

**Counting methods differ and that is expected:** 171 (frontend inventory: call-site scan of `rpc`/`useRpcRead`/outbox names) and 177 (backend inventory: string-literal matches of all 309 names across `apps/web`, including e2e specs and non-call references) measure different things; a third measurement — strict `rpc(` call sites — yields 163. None of these global counts is authoritative: the coverage matrix verifies each route-to-function row individually.

**Behavioural caveat:** the static placeholder scan proves no TODO/fake-success/dead-button text exists; it does not prove every button and workflow behaves correctly. That proof is Phase C/D's behavioural and stack testing (frontend-structure plan rule 9, ACTIVITY §6.2).

**Revised 2026-11-21 (PKT)** after an external review round: office auth wording narrowed, salon list/detail and stock attribution corrected against the code, and the "CI-enforced" claim downgraded to planned. See the plan's §11 for the full verdict.
