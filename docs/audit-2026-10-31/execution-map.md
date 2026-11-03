# Execution map of the master prompt (Phase 1 completion)

> **Update 2026-11-03 (ACTIVITY L-0370).** The rows below were last refreshed on 2026-11-01. Since then: G2 is done (CI job "office browser tests" runs Playwright on a real local stack); slices 1 to 3 have screens (office shell, rep day, salons) with the B-34/B-35 fixes awaiting re-verification; payments (module H) are built: migrations 0021 to 0024 with receivables, handover and office cash screens (PR 46, self-reported, not verified); slice 4 (orders) is reshaped by D-30: office and salon portal create orders, reps record order-intake cards. Staging still has 13 migrations. ACTIVITY §12 is the live status.

One row per step of MJ's master execution prompt (2026-11-01), mapped to what exists, the evidence, the slice that covers it, and any human action. It indexes the four requirement tables and the README in this folder; it does not repeat them. Status words are the prompt's own. Updated as slices land; ACTIVITY.md is the record if they disagree.

This is many sessions of work. Each slice below is one claim, one branch and one pull request (prompt §12). Slices run in this order because each needs the one before.

## Hard gates (nothing below can be proven end to end until these are done)

| Gate | Who | Blocks | State |
|---|---|---|---|
| G1. Owner account with TOTP on staging (gate-0 checklist) | MJ, human-only (ACTIVITY §10) | Every signed-in call on staging; manager and rep accounts are created by the owner (`app.owner_create_user`) | open |
| G2. A real local Supabase stack for browser tests (Auth + PostgREST + Postgres) | CI job, added in slice 1 (this machine has no Docker) | Prompt §13 "real local Supabase Auth and Postgres" | open (slice 1) |
| G3. Pushing branches and opening pull requests | MJ approves each push | CI evidence (§16 "CI passes") | open |
| G4. Decisions B-31 (a to g), B-28 to B-30, B-14, B-01 to B-11 | MJ | The rows that name them below | open |

## §2 Repository instructions and §5 audit

| Step | State | Evidence |
|---|---|---|
| Read the protocol, claim, log, hand off | done for this session | ACTIVITY L-0186 to L-0200 |
| Branch, working tree, recent commits, open PRs, active claims, blockers | done | L-0186; PR 14 (TLA spec) open and holding L-0186 to L-0195, renumber on merge |
| Test baseline | done | L-0187: 1789 passed; now 1847 with migration 0014 and the attack file (L-0198) |
| Requirement-level matrix (§5 questions 1 to 17) | done | `salons-map-routes.md`, `stock-orders-agents.md`, `money-controls-vault.md`, `security-nfr-webapp.md` |
| Independent attack pass (§9 negative tests) | done | `supabase/tests/crm-attacks.test.ts`, 58 tests, L-0191 |

## §6 Business modules

| Module | Backend today | Frontend today | Slice | Human or decision |
|---|---|---|---|---|
| A. Auth and users | sign-in, MFA gate, device register, approve, revoke, owner create user, set status (foundation) | sign-in and MFA pages only | 1 (office: devices, users) | G1; offboarding function missing (SEC-08) |
| B. Salon CRM | create, edit (fixed 0014), notes, stages, visits, phone reveal, duplicates | none | 3 | B-31 a, b; Excel import waits on B-02 |
| C. Territory and map | territories, areas, assignments | none | 1 (territories), 3 (map) | map provider needs MJ approval (H-21) |
| D. Rep app | check-in, check-out, route, visit, order, delivery, bag | an empty home page | 2, 3, 4 | B-31 c |
| E. Routes and due list | due list, set route, add stop, reorder | none | 2 (rep), 5 (office) | none |
| F. Inventory | catalogue, locations, movements, issue, confirm, count, adjustment, reorder point, low stock, demand | none | 5 | B-10 (real catalogue); B-31 f |
| G. Orders | create, credit gate, discount approval, cancel, deliver, invoice number | none | 4 | B-31 d, e; invoice document (ORD-05) not built |
| H. Payments | none | none | 6 (backend first) | B-05, B-06 |
| I. Vault | grant flag only | none | 7 | B-04; real supplier data is human-only |
| J. Approvals and governance | approvals with maker not checker; owner-only functions | none | 1 (devices), 5 (approvals queue), 7 (digest, offboarding) | B-01 (D-08) |
| K. Owner dashboard | `low_stock`, `duplicate_phones` | none | 7 | depends on H |
| L. Independent agents | none | none | 7 | B-31 g (how an agent is represented) |

## §7 Frontend and §8 Backend standards

Applied in every slice: one layout with role-aware navigation; each page has loading, empty, error, permission-denied and success states; no button without a working server call; authorisation only in the database; forward-only migrations; RPCs validate, check role, device and territory, are idempotent and audited.

## §10 Journeys, step by step

J1 Representative's day

| Step | Database and RPC | Page | State |
|---|---|---|---|
| 1 sign in | Supabase Auth email OTP | `/app/login` | built (e2e: page only) |
| 2 account and device status | `app.my_session`, `app.register_device` | `/app` | built, needs G1 to run |
| 3 office approves device | `app.approve_device` | `/office/devices` | slice 1 |
| 4 assigned territory | `app.my_areas`, `app.my_territory_ids` | `/app` | slice 2 |
| 5 due list and route | `app.due_list`, `app.my_route` | `/app/route` | slice 2 |
| 6 check in | `app.rep_check_in` | `/app` | slice 2 |
| 7 open a salon | `app.my_salons`, `app.salon_notes`, `app.salon_visits`, `app.salon_stages` | `/app/salons/[id]` | slice 3 |
| 8 record a visit | `app.log_visit` | salon page | slice 3 |
| 9 create an order | `app.create_order` | salon page | slice 4 |
| 10 stock, price, credit checks | inside `create_order`, `evaluate_order` | shown, never computed in the browser | slice 4 |
| 11 order states | `sales_order.status` | order page | slice 4 |
| 12 delivery and acknowledgment | `app.rep_deliver` (name and GPS, L-0163) | order page | slice 4 |
| 13 payment | not built | | slice 6 |
| 14 receipt through adapter | not built (no SMS adapter) | | slice 6, needs B-08 |
| 15 close the bag | `app.record_count` daily close, `app.rep_check_out` | `/app` | slice 5 |
| 16 to 18 cash handover, manager confirms, variances | not built | | slice 6 |

J2 Salon acquisition: steps 1 to 6 have `app.create_salon` (initial stage prospect), `app.duplicate_phones`; step 7 `stage_event`; step 8 office history. Pages: slice 3. Map pin capture: slice 3.

J3 Agent purchase: nothing exists. Slice 7, after B-31 g and payments (slice 6).

J4 Manager's day: MFA sign-in built; stock review, routes, assignments, stock issues are RPCs without pages (slices 1, 5); cash handover not built (slice 6); approvals queue needs a read function for `control.approval_request`, which is not exposed (slice 5).

J5 Owner's view: MFA sign-in built; dashboard, receivables, digest not built (slice 7); audit history needs a read function (`control` not exposed) (slice 7); governance RPCs exist without pages (slice 1).

## §11 Offline PWA

Not started (P1-09). Slice 8, after slices 2 to 6 define the operations the outbox carries. Every write RPC already takes a client id, so the server side of idempotent sync exists.

## §12 Slices (order)

1. Office shell: layout and navigation, devices, users, territories and assignments; CI job with a real local Supabase stack and Playwright (G2).
2. Rep shell: check-in and check-out, territory, route and due list.
3. Salons: list, detail (notes, visits, stages, phone reveal), create with pin, edit.
4. Orders and delivery, invoice view; decide or fix `delivery_mode` (B-31 e).
5. Stock: bag, issue and confirm, daily close, office stock, low stock, adjustments and the approvals queue.
6. Payments, receipts, cash ledger, handover (P1-07): backend, then pages.
7. Control layer and digest (P1-08), vault (P1-05), dashboards (P1-10), agents (P1-15), offboarding.
8. Offline client (P1-09), Urdu strings throughout.
9. Security acceptance suite and restore drill (P1-12), then the pilot (MJ).

## §13 Required commands

Run and logged per slice. Latest: install, `db:test` (1847), typecheck, import tests (50), lint, build, e2e (4, page level), activity check, service-role scan: all pass (L-0187, L-0189, L-0191, L-0198).

## §14 Environments

| Environment | State |
|---|---|
| Local | embedded Postgres suite; no Docker, so no local Auth or PostgREST |
| Staging `iurvazdyxzlspegygldo` | 13 migrations, B-18 resolved, 0 users (L-0200) |
| Production | not touched; not created as far as this session knows |

## §16 and §17 Deliverables

| Deliverable | Built from | State |
|---|---|---|
| A. completion report | this map plus the README | after slice 9 |
| B. traceability matrix | the four requirement tables (add Frontend, E2E columns per slice) | skeleton exists |
| C. frontend report | route list per slice | after slice 1 starts |
| D. backend report | migration and RPC list (`supabase/migrations`, audit tables) | skeleton exists |
| E. security report | `crm-attacks.test.ts`, rls-matrix, advisors (L-0200) | partial |
| F. E2E report | Playwright journeys in CI (G2) | not started |
| G. deployment readiness | the §14 table | partial |
| H. human actions | the gates table plus ACTIVITY §14 | current |
| I. handoff | ACTIVITY HANDOFF entries | per session |
