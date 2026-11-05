# Remaining implementation

Written 2026-11-05, after PRs 53 to 69 merged and with PR 70 (P1-30, wiring-audit fixes) open. This file lists everything still to build, decide or do before and after go-live. It is a work list under `docs/16-project-completion-goal.md` and the board in `docs/ACTIVITY.md` section 12; it is not a second plan. Status lives only on the board.

## Rules for all remaining work

1. **Add on, never rebuild.** Every item below names the existing table, function or page it extends. No second order engine, ledger, invoice path, signature store, catalogue or approval mechanism. If an item seems to need one, stop and log a BLOCKER.
2. **One issuing path.** An invoice is issued only by `app.finalise_delivery`, reached through `app.office_approve_delivery` or `app.office_deliver`, and only with the salon's signed acknowledgement plus the office's approval (D-49).
3. **Forward-only migrations**, numbered after `20261105230000`. A function already redefined by a later migration is changed in a new migration, never by editing a merged file.
4. **One branch and one PR per item or small group**, each merged before the next that touches the same files. Shared files that always conflict: the verifier allowlist, the RLS matrix, `lib/office-nav.ts`, `e2e-stack/office.spec.ts`, the board, docs 03, 04, 06, 12 and `SPEC.md`.
5. **A fixture that delivers through the API signs first** (`signSubmissionSql`, `signOrderSql` in `supabase/tests/helpers/submit-approve.ts`).
6. English only (D-42). Reps never create or approve official orders. The manager cannot promote anyone to owner or manager.

## What is built (do not rebuild)

| Area | Where |
|---|---|
| Invitations, salon membership, salon approval, rep assignment | migration `20261105100000`; `/office/people`, `/office/salons/approvals`, `/invite/[token]` |
| Products, pictures, list and per-salon prices | `20261105110000`; `/office/products` |
| Investor ledger and "This month" | `20261105120000`, `20261105180000`; `/office/investors` |
| Delivery submission and office approval | `20261105130000`, `20261105130100`; `/office/deliveries`, `/app/deliveries` |
| Commission rates, stamps, payments | `20261105140000`; `/office/commission`, `/app/commission` |
| Requests queue and salon portal | `20261105150000`; `/salon`, Requests on `/office/orders` |
| Rep read-only salons, proposals, timelines | `20261105160000` |
| Office order page, approvals, stock, bag issue and return, counts, routes | `20261105170000`; `/office/orders/[id]`, `/office/approvals`, `/office/stock`, `/office/stock/levels`, `/office/routes`, `/app/route`, `/app/stock` |
| Office home, rep performance, rep detail, grouped sidebar | `20261105180000`, `20261105190000`; `/office`, `/office/reps`, `/office/reps/[id]` |
| Invoice composer, issued-invoice snapshot, A4 print, customer signature, the delivery rule | `20261105220000`; `/office/orders/[id]/invoice`, `/office/invoices`, `/salon/invoices/[id]` |
| Audit fixes: owner's own requests, dispute settlement, cash cap, payment reversal, credit screens, settings | `20261105230000` (PR 70) |
| Product-group controls on Products; storage started in the office browser job; the catalogue journey uploads a product picture | no migration; PR 71 (`claude/product-group-screen`), IMPLEMENTED, NOT VERIFIED until its office browser job passes |

## A. Before go-live: MJ's own actions (no agent may do these)

| # | Action | Notes |
|---|---|---|
| A1 | Approve applying the 13 migrations `20261105100000` to `20261105230000` to the Kiran project | The project stops at `office_orders_cards`. Each application needs MJ's say-so (H-19). Version names on the project differ from the file names; record the mapping |
| A2 | Create the owner account with TOTP | `docs/runbooks/owner-bootstrap.md` (rewritten in PR 70) |
| A3 | Hosted auth settings: email sign-up on, SMS sign-up off, decide Confirm email (B-47) | Invitations need email sign-up on |
| A4 | Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` on the web deployment; turn off Vercel deployment protection when users should reach it | Never a service-role key |
| A5 | Rotate the service-role key, secret key and database password (B-25) | |
| A6 | Set the `KIRAN_SENSITIVE_TERMS` secret | The log check runs without the supplier list today |
| A7 | Enter the real company name, address, bank accounts and limits in `/office/settings` | Invoices print "[Dummy] Kiran Company" until then |
| A8 | Enter real products, prices and pictures; import salons from Excel (OQ-01) | Needs the product-group screen (C1) on a fresh database |
| A9 | Adviser input on investor terms (OQ-23, OQ-26 to OQ-28) | Before any live payout |

## B. Decisions waiting on MJ (each has a default as built)

| Ref | Question | Default today |
|---|---|---|
| B-45 | How does a part-delivered order end when the rest will never ship? | No way to close it; it stays in "to deliver" |
| D-49 exception | May a delivery ever be final when the salon cannot sign (shop closed)? | No. It is rejected and the goods return |
| B-48 | Reversal threshold (doc 13 says Rs 10,000) and who carries a reversal made after a short handover | No threshold; the office pays back in full |
| B-49 | Should settling a dispute write a variance amount, not only a label? | A label and a reason only |
| B-50 | D-45 wording: may a second manager check a manager's small missing-goods request? Should the owner's own discount record a reason? | Yes; no reason captured |
| B-51 | Cash cap: list reps close to the cap, not only at it | Only reps at or over the cap are listed |
| B-47 | Lost authenticator and forgotten password: in-app recovery or dashboard steps | Dashboard steps, documented |
| B-46 | Expiry and batch on invoices; logo; server-side PDF; signature pictures in Storage | None built |
| A-14 | Receivables "by rep": territory or direct assignment | Territory |
| A-18, A-20, A-22 | Rep-less delivery by the office; month rules; display-text-only composer | As built |
| OQ-33, OQ-34 | Salon price against the discount gate; second person on commission and investor payouts | Gate applies; no second person |
| B-28, B-31 | Rep parking against the matrix; pin moves, phone-reveal cap, past-midnight work, low stock scope | As built |
| Commission basis | Invoice total at approval, or something else | Invoice total |
| Role change | Should the owner change a person's role in the app? | No screen; `owner_set_role` ignores device, bag and territory |

## C. Remaining build, in order

Each item: what to add, what it extends, and what it waits for.

### C1. Unblock a fresh database (first)
- **Product-group screen** (audit H5, FLOW-01). Extends `/office/products` with add and edit over the existing `app.office_upsert_product_group`. Built on `claude/product-group-screen` and open as PR 71 together with the CI storage change and the picture-upload step of the catalogue journey. Remaining: the office browser job passes on the exact head, then MJ's OK to merge. Do not rebuild it.
- **Settings in the sidebar.** Add `/office/settings` to `lib/office-nav.ts` with the existing `ownerOnly` flag. One line plus the sidebar test.

### C2. Close the loops the audit left open (small, each over existing functions)
| Item | Extends | Waits for |
|---|---|---|
| Close a part-delivered order (M6, FLOW-08) | `sales_order.status` `closed` already exists; add `app.office_close_order` and a button on `/office/orders/[id]` | B-45 |
| Unreconciled handover blocks the next check-in, with a manager override (PIP-09, FLOW-07 part) | `app.rep_check_in`, `/app/day`, `/office/handovers` | — |
| Receivables by rep follow direct assignment (M4, FLOW-12) | `app.office_receivables_ageing`, reuse `app.rep_holds_salon` | A-14 |
| Cash held by a suspended or offboarded rep is visible and countable (M7) | `/office/handovers` reads | — |
| Timelines cover delivery submissions, commission, signatures, reversals, settlements | `app.timeline_label` and the two timeline functions, in a forward migration | — |
| Stale refused request shown on pending stock | `app.office_pending_stock` | — |
| AUTH-05 residual: a password token still reads its own profile and device rows | policies on `user_profile` and `device` | — |

### C3. Rep app polish (all over existing pages and functions)
- REP-05: the blind stock count sends the office's quantities to the browser. Add a rep read that withholds quantities until the count is sent; `/app/stock` uses it.
- REP-07: a rep can add only due salons to the route. Let `/app/route` add any salon the rep reaches (`app.my_salons`).
- REP-12, REP-13: hide Park where the database refuses it; make reorder survive a stop whose salon moved.
- REP-14, L1: a deactivated SKU shows as "Unknown SKU". Read inactive SKU names where stock or orders still hold them.
- REP-16, L3: refusals that quote paisa. Word amounts in rupees in the database messages that reach a screen.
- REP-19: pass the phone's mock-location flag from the delivery and payment forms.
- REP-20, L2: show times in Karachi time on every rep and office page (one shared formatter; several pages still use the browser's zone).
- Rep home has no Salons link; add it.

### C4. Salon portal and sign-in polish
- AUTH-08: the office side is covered by PR 71 (the manager uploads a picture and it loads, also after a reload). Still to add: a stack test that a salon and a rep load a product picture through their own screens.
- AUTH-12: an office user signing in by email code on the rep or salon page gets a device row; refuse it.
- AUTH-13, AUTH-14: editing a request that holds a removed product; request lines should keep the price shown when the order was made.
- AUTH-15, FLOW-19: lists capped at 50 or 100 say "showing N of M".
- AUTH-16: two dead ends (no way back on the salon code screen; an accepted invitation offers no link onward).
- L6, L7, L8: Office cash note wording; searchable salon pickers past 500; rejected-salon reason and a filter on `/office/salons`.

### C5. Documents and money (extend the invoice and payment work, no new path)
| Item | Extends | Waits for |
|---|---|---|
| Rep and salon receipt views; a payments list page | `app.receipt_document`, `app.office_salon_payments`, `components/invoice-sheet.tsx` pattern | — |
| Salon statement | existing installment and payment reads | — |
| Server-side PDF file of an invoice (ORD-05) | `invoice_snapshot.document` as the only source | B-46 |
| Logo on documents | `company.profile` plus an asset store | B-46 |
| Expiry and batch on invoice lines | needs batch capture at goods receipt first (P1-05) | B-46, P1-05 |
| Signature pictures in Supabase Storage | `delivery_signature_image`, same functions | B-46 |
| Sending receipts by SMS or WhatsApp | existing adapter, B-08 | OQ-11, a provider |
| Credit notes and invoice corrections | a new append-only table referencing `invoice`; never an update | Phase 2 decision |
| Bank deposits with slip photo (CTL-04) | cash ledger; storage | storage |
| Correcting adjustment from a count variance | `request_approval` and `app.post_adjustment` | — |

### C6. Larger Phase 1 items still on the board (unchanged, not started)
| Board row | What | Note |
|---|---|---|
| P1-08 | Approval registry (`control.approval_use`, D-25), daily owner digest, bank-detail lock, offboarding in one screen | The approvals page exists; the registry and digest do not |
| P1-09 | Offline rep PWA: outbox, idempotent sync, rejection display | Needed before the field pilot; queues the existing rep functions only |
| P1-05 | Supplier vault: purchase orders, goods receipts, grants | Brings batch and expiry |
| P1-03 | Rep map with pins | — |
| P1-10 | In-app notifications | The dashboard part is built |
| P1-12 | Security acceptance suite and a backup restore drill | — |
| P1-15 | Independent agents | Waits for D10 (agent representation) |
| P1-17 | Office view of lost demand; bag load suggestion | The rep tap is built |
| OQ-32 | Rep location tracking | Policy not decided |
| P0-02, P0-06, P0-09 | Open defect checks in the import and the log check | `it.fails` tests mark them |

### C7. Shared foundation from the frontend structure plan (do when a slice touches the page, no big-bang rewrite)
F8 test helpers (sign in as each role, wait-for-loaded), F1 generated database types in `packages/shared`, F2 typed RPC client over `lib/rpc.ts`, F3 one component set, F4 one table pattern with paging. Convert a page when its slice touches it.

### C8. Records and housekeeping
- Give MJ's frontend-structure rulings their number (D-44 is reserved) and add work packages S-A to S-F to `docs/superpowers/plans/2026-11-05-project-completion.md` and the board.
- Update board rows P1-18 to P1-31: their PRs are merged and CI was green; the cells still say "awaiting CI".
- Final review against `docs/superpowers/plans/2026-11-05-final-review-checklist.md` and the handoff report required by the master prompt.
- Independent verification of slices 1 to 11 has not been done (MJ removed the rule; CI is the evidence).
- Remove merged local branches and worktrees after MJ's OK.

## Suggested order

1. PR 70 is merged. Merge PR 71 (product groups, storage, picture step) when its checks are green and MJ says so; then the Settings link in C1. 3. MJ's actions A1 to A8 and a staging smoke test. 4. C2, then C3 and C4 as small PRs. 5. C5 items that have no open decision. 6. P1-09 offline before the pilot; P1-08 and P1-12 before Gate 1. 7. C8 alongside.
