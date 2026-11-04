# Execution map of the master prompt (Phase 1 completion)

One row per step of MJ's master execution prompt (2026-11-01), mapped to what it needs, the slice that covers it, and any human action. It indexes the four requirement tables and the README in this folder; it does not repeat them. **It states no status: task status is only on the ACTIVITY §12 board.**

The order journey (D-30 and its follow-up decisions): Phase 1 includes office-created orders and rep order-intake cards (ORD-01, ORD-14); Phase 2 includes the salon portal order channel and shared customer-safe reads (SAL-11/12, ORD-11/13, SEC-13/15, INV-12). Reps continue delivery and collections under L-0374; they do not create official orders. A portal order is editable or cancellable only until manager approval (L-0378); one invited login per salon, no sub-accounts for now (L-0382). The delivering rep of an office order is picked by the manager from the salon's territory reps, or none for a manager-direct or salon order (A-16, L-0385). The order rework is three pull requests in order (design spec `docs/superpowers/specs/2026-11-03-orders-delivery-commission-design.md` section 2): PR A, office orders and order cards; PR B, delivery submission and office approval (D-32); PR C, commission on delivered and invoiced value of assigned orders (D-31, Phase 1 by L-0385).

This is many sessions of work. Each slice below is one branch and one pull request (prompt §12). Slices run in this order because each needs the one before.

## Hard gates (nothing below can be proven end to end until these are done)

| Gate | Who | Blocks |
|---|---|---|
| G1. Owner account with TOTP on staging (gate-0 checklist) | MJ, human-only (ACTIVITY §10) | Every signed-in call on staging; manager and rep accounts are created by the owner (`app.owner_create_user`) |
| G2. A real local Supabase stack for browser tests (Auth + PostgREST + Postgres) | CI job | Prompt §13 "real local Supabase Auth and Postgres" |
| G3. Pushing branches and opening pull requests | MJ approves each push | CI evidence (§16 "CI passes") |
| G4. Owner decisions and blockers | MJ | Only the work item named by each current row in ACTIVITY §14/§15 |

## §2 Repository instructions and §5 audit

| Step | Evidence |
|---|---|
| Read the protocol, log, hand off | L-0186 to L-0200 |
| Branch, working tree, recent commits, open PRs, blockers | L-0186 |
| Test baseline | L-0187, L-0198 |
| Requirement-level matrix (§5 questions 1 to 17) | `salons-map-routes.md`, `stock-orders-agents.md`, `money-controls-vault.md`, `security-nfr-webapp.md` |
| Independent attack pass (§9 negative tests) | `supabase/tests/crm-attacks.test.ts`, L-0191 |

## §6 Business modules

| Module | Slice | Human or decision |
|---|---|---|
| A. Auth and users | 1 (office: devices, users) | G1; offboarding function missing (SEC-08) |
| B. Salon CRM | 3 | B-31 a, b; Excel import waits on B-02 |
| C. Territory and map | 1 (territories), 3 (map) | map provider needs MJ approval (H-21) |
| D. Rep app | 2, 3, 4, 5, 6, 9 | B-31 c; D-30 (L-0363), rep delivery/collection retained (L-0374) |
| E. Routes and due list | 2 (rep), 5 (office) | none |
| F. Inventory | 5 | B-10 (real catalogue); B-31 f |
| G. Orders | 4 | Office creates official orders; rep cards are converted by office (ORD-14); salon portal ordering is Phase 2 (ORD-11–13); delivering rep per A-16 (confirmed, L-0385); A-18 open (L-0386); PR B (delivery approval, D-32) and then PR C (commission, D-31) |
| H. Payments | 6 | See the P1-07 board row |
| M. Salon portal | Phase 2 | Invitation-only, one login per salon (L-0376, L-0382); manager approval and pre-approval edit/cancel cutoff (L-0378) |
| I. Vault | 7 | B-04; real supplier data is human-only |
| J. Approvals and governance | 1 (devices), 5 (approvals queue), 7 (digest, offboarding) | B-01 (D-08) |
| K. Owner dashboard | 7 | depends on H |
| L. Independent agents | 7 | B-31 g (how an agent is represented) |

## §7 Frontend and §8 Backend standards

Applied in every slice: one layout with role-aware navigation; each page has loading, empty, error, permission-denied and success states; no button without a working server call; authorisation only in the database; forward-only migrations; RPCs validate, check role, device and territory, are idempotent and audited.

## §10 Journeys, step by step

J1 Representative's day

| Step | Database and RPC | Page | Slice |
|---|---|---|---|
| 1 sign in | Supabase Auth email OTP | `/app/login` | foundation |
| 2 account and device status | `app.my_session`, `app.register_device` | `/app` | foundation (needs G1) |
| 3 office approves device | `app.approve_device` | `/office/devices` | slice 1 |
| 4 assigned territory | `app.my_areas`, `app.my_territory_ids` | `/app` | slice 2 |
| 5 due list and route | `app.due_list`, `app.my_route` | `/app/route` | slice 2 |
| 6 check in | `app.rep_check_in` | `/app` | slice 2 |
| 7 open a salon | `app.my_salons`, `app.salon_notes`, `app.salon_visits`, `app.salon_stages` | `/app/salons/[id]` | slice 3 |
| 8 record a visit | `app.log_visit` | salon page | slice 3 |
| 9 record requirements during a visit | `app.rep_create_card`, `app.my_cards` (ORD-14) | rep salon page, `/app/cards` | slice 4 |
| 10 office converts intake card into an official order | `app.office_open_cards`, `app.office_create_order` (with the card; delivering rep per A-16, L-0385), `app.office_dismiss_card`; reads `app.office_orders`, rep `app.my_territory_orders` (D-30) | `/office/orders`; rep `/app/orders` read-only | slice 4 |
| 11 stock, price and credit checks | shared server-side builder `app.build_order` | office order flow | slice 4 |
| 12 order states | `sales_order.status` | office order view | slice 4 |
| 13 delivery and acknowledgment | `app.rep_deliver` (name and GPS, L-0163) for the order's assigned rep until PR B replaces it with a delivery submission and office approval (D-32); a rep-less order through `app.office_deliver` (A-18, open) | rep order view | slice 4 |
| 14 payment and receipt | payment write path and receipt adapter | rep/office payment flow | slice 6 |
| 15 close the bag | `app.record_count` daily close, `app.rep_check_out` | `/app` | slice 5 |
| 16 to 18 cash handover, manager confirms, variances | handover write path and office cash screen | rep and office | slice 6 |

J2 Salon acquisition: steps 1 to 6 have `app.create_salon` (initial stage prospect), `app.duplicate_phones`; step 7 `stage_event`; step 8 office history. Pages: slice 3. Map pin capture: slice 3.

J3 Agent purchase: slice 7, after B-31 g and payments (slice 6).

J4 Manager's day: stock review, routes, assignments, stock issues (slices 1, 5); cash handover (slice 6); approvals queue, which needs a read function for `control.approval_request`, not exposed (slice 5).

J5 Owner's view: dashboard, receivables, digest (slice 7); audit history, which needs a read function, `control` not being exposed (slice 7); governance pages (slice 1).

## §11 Offline PWA

P1-09. The Phase 1 offline order artifact is the rep's ORD-14 intake card, not an official order. Sync must preserve the creator, salon and visit context, use idempotent replay, and surface server rejection. Salon portal submission is online-first (doc 15) and must not show success before server acknowledgement. Slice 8 follows the approved rep operations from slices 2 to 6.

## §12 Slices (order)

1. Office shell: layout and navigation, devices, users, territories and assignments; CI job with a real local Supabase stack and Playwright (G2).
2. Rep shell: check-in and check-out, territory, route and due list.
3. Salons: list, detail (notes, visits, stages, phone reveal), create with pin, edit.
4. **D-30 order rework (Phase 1):** office Orders area creates official orders; rep records a New Order Details card during an authorized visit; office converts and links the card. Preserve the common server-side SKU, price, stock, credit, idempotency and state rules. Reps remain read-only on official orders and retain delivery/payment actions as decided in L-0374. Do not implement salon portal ordering in this slice; it remains Phase 2 under docs 03 and 11. The delivering rep follows A-16 as confirmed by MJ (L-0385): picked from the salon's territory reps, the card's rep pre-selected, or none for a manager-direct or salon order. Three pull requests in order (design spec section 2): PR A, office orders, order cards and the Orders area (PR 48, L-0400); PR B, delivery submission and office approval with pending-delivery stock (D-32); PR C, commission rates and the commission area (D-31), after PR B. Verify B-31 (d) and (e) against the current decision table before changing invoice or delivery behavior.
5. Stock: bag, issue and confirm, daily close, office stock, low stock, adjustments and the approvals queue.
6. Payments, receipts, cash ledger, handover and remaining P1-07 controls.
7. Control layer and digest (P1-08), vault (P1-05), dashboards (P1-10), agents (P1-15), offboarding.
8. Offline client (P1-09): offline visits, prospects, payment capture and ORD-14 intake cards; Urdu strings throughout. No offline salon portal order submission.
9. Security acceptance suite and restore drill (P1-12), then the pilot (MJ).

## §13 Required commands

Run and logged per slice: install, `db:test`, typecheck, import tests, lint, build, e2e, activity check, service-role scan.

## §14 Environments

| Environment | Note |
|---|---|
| Local | embedded Postgres suite; Docker availability is machine-specific |
| Staging | Re-check only after MJ authorizes the exact read-only check (ACTIVITY §14) |
| Production | never touched by agents (H-19) |

## §16 and §17 Deliverables

| Deliverable | Built from |
|---|---|
| A. completion report | this map plus the README |
| B. traceability matrix | the four requirement tables (add Frontend, E2E columns per slice) |
| C. frontend report | route list per slice |
| D. backend report | migration and RPC list (`supabase/migrations`, audit tables) |
| E. security report | `crm-attacks.test.ts`, rls-matrix, advisors (L-0200) |
| F. E2E report | Playwright journeys in CI (G2) |
| G. deployment readiness | the §14 table |
| H. human actions | the gates table plus ACTIVITY §14 |
| I. handoff | the task entries in `docs/log/` |
