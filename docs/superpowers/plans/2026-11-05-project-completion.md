# Project completion: implementation checklist

**Spec:** `docs/superpowers/specs/2026-11-05-reps-salons-catalogue-investors-design.md`. **Authority:** `docs/16-project-completion-goal.md`. **Decisions:** D-33 to D-41. **Live status:** ACTIVITY section 12, rows P1-18 to P1-24.

Each slice is one pull request, built one at a time, stacked on the last until merged. An implementer reads the spec, this slice's section and the sibling migration `20261104090000_office_orders_cards.sql`, then writes the database test first. Local runs: only the test files a slice touches, one at a time, plus typecheck and lint; the full suite and browser stack run in CI. No test is weakened to pass.

## Global constraints

- Migration versions, forward-only and in order: slice 1 `20261105100000`, slice 2 `20261105110000`, slice 3 `20261105120000`, slice 4 `20261105130000` and `20261105130100`, slice 5 `20261105140000`, slice 6 `20261105150000`, slice 7 `20261105160000`.
- No service role in `apps/` or `packages/` (`scripts/service-role-scan.mjs`). Salons are never a `user_profile.role`.
- Every new table: forced RLS, audit trigger, grants as in the sibling migration; writes through `security definer` functions with pinned `search_path`, `client_id` replay, actor from the session. Every table and function gets RLS matrix rows, allowlist entries and schema hygiene.
- CI job names do not change. One `docs/log` TASK entry per pull request with Evidence and the security checklist. Docs that a slice changes land with it; status only on the board.

## What exists and is reused

| Area | Existing (on main) | Used by |
|---|---|---|
| Official orders | `sales_order`, `sales_order_line`, `app.build_order`, `app.office_create_order`, `evaluate_order`, `app.office_orders`, `/office/orders`, `components/order-form.tsx` | 2, 6 |
| Requests | `order_intake_card`, `order_intake_card_close`, `app.rep_create_card`, `app.my_cards`, `app.office_open_cards`, `app.office_dismiss_card`, `/app/cards` | 6 |
| Catalogue | `product_group`, `product`, `sku`, `app.office_upsert_product_group`, `app.office_upsert_product`, `app.office_upsert_sku`, `app.owner_set_sku_price` (owner only) | 2 |
| People | `user_profile`, `app.owner_create_user`, `app.owner_set_status`, `app.my_session`, `app.register_device`, `/office/team`, rep email code login with `shouldCreateUser:false` | 1 |
| Reach | `rep_territory`, `app.rep_can_reach_salon`, `app.my_salons` | 1, 7 |
| Money | `app.rep_record_payment`, `app.office_record_payment`, receivables, handover, ageing, office cash, `components/money-section.tsx` | 5, 6 |
| Delivery | `app.rep_deliver`, `app.deliver`, `app.office_deliver`; no rep delivery screen exists | 4 |
| Audit | `control.audit_event` hash chain | 7 |
| Commission, invitations, membership, portal, investors, storage | Nothing built | 1 to 7 |

## Slice 1 (P1-18): invitations, membership, salon approval, assignment

- Tables: `invitation`, `salon_membership`, `salon_approval_decision`, `salon_rep_assignment`; column `salon.approval_status`, existing rows backfilled to approved.
- Functions: `app.office_invite` (rep or salon), `app.office_invitations`, `app.office_revoke_invitation`, `app.redeem_invitation(token)`, `app.office_set_member_status`, `app.office_decide_salon`, `app.office_assign_salon_rep`, `app.office_pending_salons`, `app.salon_me`.
- Manager may suspend and reactivate reps; `app.owner_create_user` and role changes stay owner-only, tested.
- `app.rep_can_reach_salon` follows R4: a direct assignment limits the salon to that rep; otherwise territory coverage. Existing territory tests stay green.
- `supabase/config.toml`: `enable_signup = true` for the email code. `apps/web`: `/invite/[token]` is the only page that creates a login; login pages keep `shouldCreateUser:false`.
- Screens: `/office/people`, `/office/salons/approvals`, assign rep and rate on the salon page (rate column stored; used in slice 5).
- Tests: token reuse, expiry, wrong email; unredeemed login sees nothing; manager cannot create owner or manager; revoked membership stops at once.

## Slice 2 (P1-19): products, pictures, prices

- Columns `product.image_path`, `product.description`; bucket `product-images` with storage policies in the migration and `config.toml`; `app.office_set_sku_price`; table `salon_sku_price` with `app.office_set_salon_price`.
- OQ-33 default: the price gate stays as written, so a salon price below list still goes through the discount hold unless the owner set it.
- Screen `/office/products`. `order-form.tsx` shows pictures and the salon's price.
- Tests: rep and salon cannot write; image type and size limits; supplier and cost columns never returned.

## Slice 3 (P1-20): investor ledger

- As in spec section 3 and CAP-01 to 03. `investor`, `investment`, `investor_profit_decision`, `investor_payout`; add and decide, pay, reverse, `app.office_investors`, `app.office_investor_statement`. `investor` has `client_id`; reversal rows carry a reason; unknown reference is 22023.
- Screens `/office/investors`, `/office/investors/[id]`. Tests with hand-worked totals; overpay refused; two-session payouts.

## Slice 4 (P1-21): delivery approval

- Execute `docs/superpowers/plans/2026-11-04-delivery-submission-approval.md`, as updated by its Status note.

## Slice 5 (P1-22): commission

- `rep_commission_rate`, `commission_payment`; `invoice.commission_rate_bp` stamped in `app.finalise_delivery`: current assignment rate for that rep and salon, else rep default, else 0.
- `app.office_set_commission_rate`, `app.office_record_commission_payment`, `app.office_reverse_commission_payment`, `app.my_commission(from, to)`, `app.office_commission(rep, from, to)`.
- OQ-34 default: append-only with reversals and reasons, no second person.
- Screens `/office/commission`, rep dashboard on `/app`, read-only account page. Rate changes apply forward; reassignment does not move stamped commission.

## Slice 6 (P1-23): requests queue and salon portal

- `order_intake_card` gains `submitter_kind`, salon submitter, nullable `rep_id`; `order_intake_card_line`; edit versions. `app.rep_create_card` accepts optional lines; `app.salon_submit_request`, `app.salon_edit_request`, `app.salon_cancel_request`, `app.rep_edit_card`, `app.rep_cancel_card`.
- `app.office_open_cards` lists both. One-click convert through `app.office_create_order`, with channel `salon_portal` for salon cards; reject through `app.office_dismiss_card`.
- `app.salon_catalogue`, `app.salon_my_requests`, `app.salon_my_orders`, `app.salon_my_account` (balance and payments, allow-listed).
- Screens `/salon` (account, catalogue, basket, requests, orders, payments), Requests queue on `/office/orders`, product picker on the rep card form.
- Tests: salon A against salon B on every function; prices never from the submitter; replays; edits after review refused.

## Slice 7 (P1-24): rep read-only, proposals, timelines, end to end

- `app.update_salon` refuses reps; rep edit screen removed; `app.create_salon` by a rep becomes pending; `rep_park_salon` stays (B-28 default); office approves through slice 1.
- `app.office_salon_timeline`, `app.office_order_timeline` over `control.audit_event`; timelines on office pages.
- End-to-end stack test from spec section 7.
- Final review: duplicate entities, contradictory rules, permission gaps; docs and board.
