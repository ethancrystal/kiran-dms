# Phase 1 completion audit, 2026-11-01 (main at 13ebec7)

Independent, read-only audit of every requirement in `docs/03-requirements.md` (142 IDs in 16 groups) against the code on `main`, plus a section 7 attack pass on the built modules. Written by a session that did not build them (ACTIVITY C-011, C-012, L-0186 onward). The four per-requirement tables sit beside this file; each row cites a migration function, a test title and a frontend path, or says none found. Test evidence in those tables is by title; the runs below are what actually passed.

## What was run (local, embedded Postgres 17, ambient DATABASE_URL unset)

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm db:test` (whole suite, with the new attack file) | 24 files, 1843 passed, 0 failed, 1446 s |
| `supabase/tests/crm-attacks.test.ts` alone | 54 passed |
| `pnpm lint`, `pnpm typecheck`, `pnpm activity:check`, `pnpm service-role:scan` | all exit 0 |
| `pnpm -r --if-present test` (packages/import) | 50 passed |
| `pnpm -C apps/web build` | exit 0, 7 routes |
| `pnpm -C apps/web test:e2e` | 4 passed (rep login page only) |

Not run: anything against staging or production; a real GoTrue MFA login; an offline test (there is no offline client).

## Where Phase 1 stands, by requirement group

Counts are the auditing agents' own, checked against the code for a sample. No row is VERIFIED; no row has a user interface.

| Group | IDs | Not started | Partial | Backend only / not integrated | Phase 2 or 3 |
|---|---|---|---|---|---|
| Salons, map, routes, demand (SAL, MAP, PIP, DEM) | 37 | 2 | 7 | 12 | 16 |
| Stock, orders, agents (INV, ORD, AGT) | 28 | 6 | 4 | 8 | 10 |
| Money, controls, reports, vault (PAY, CTL, RPT, MSG, FLD, ADM, VLT) | 53 | 24 | 10 | 2 | 17 |
| Security and non-functional (SEC, NFR) | 24 | 6 | 7 | 3 (plus 1 untested end to end) | 1 |

In one sentence: the database half of salons, visits, routes, inventory, orders, deliveries and invoices exists and is well tested; the whole payments domain, the vault tables, the control layer beyond approvals, the offline engine, every screen, and the agent role do not.

## The five business journeys, today

None can be performed through the application. The web app is the login and MFA pages and an empty home page for each role (`apps/web/app`, 8 files, no design system, no service worker, no Urdu strings, no calls to any salon, stock or order function).

| Journey | Backend today | Blocking gaps |
|---|---|---|
| J1 rep's day | check-in, route, visit, order, delivery, invoice, bag count exist | payment, receipt, cash handover and manager confirmation have no tables; no screens; no offline |
| J2 salon acquisition | `create_salon`, stage history, duplicate-phone list exist | no screens, no map, no photo storage |
| J3 agent purchase | none | no agent role, price, or pay-before-release; needs a decision on how an agent is represented |
| J4 manager's day | routes, stock issue proposal and confirmation, approvals exist | no screens; no cash handover; no device approval screen |
| J5 owner's view | audit chain, approvals, `low_stock`, `duplicate_phones` exist | no dashboard, digest, ageing, receivables or reports |

## Findings of this pass

The attack pass found no way through any control it tried (cross-territory reads, list-dump, direct writes to money, stock, stage and history tables, update or delete of append-only rows, replay, backdating, over-ordering and over-delivery, delivering another rep's order, self-approval, discount tampering, plan above eligibility). 19 of its first-run failures were mistakes in the new tests, fixed without loosening any check.

Confirmed by reading the SQL (file and function named; none has a failing test today):

1. `app.update_salon` (`20261028060000_salons.sql`) overwrites address, lat, lng and chairs with null when they are not passed, because the parameters default to null and the update sets them unconditionally. A rep who edits only a salon's name erases its pin. This is a code defect.
2. The same function lets a rep move a salon's pin to any point in their territory, with no flag. The visit and delivery distance checks measure against that pin, so moving it defeats them. Whether reps may move pins is a policy question for MJ.
3. `app.rep_deliver` always takes stock from the bag, and `office_deliver` always from a warehouse; the order's `delivery_mode` is stored but ignored.
4. `app.salon_exposure` counts the full total of every confirmed or delivered installment order and nothing releases it (A-10, a stopgap until payments exist), so a salon's headroom only shrinks.
5. `app.reveal_phone` is logged but has no volume limit: a rep can reveal every phone in their territory, one call each.
6. `app.office_post_adjustment` accepts only approvals of kind `adjustment`, so an approved write-off cannot be posted.
7. `app.create_order` replay and `app.create_salon` replay return the stored row when the same client id arrives with different content (partly), while `add_salon_note` refuses; behaviour is inconsistent.
8. `app.low_stock` pools warehouse and bag stock; an empty warehouse with stock in bags is not flagged.
9. A part-delivered order gets one invoice per delivery.
10. A rep still working after midnight Karachi time cannot log visits, orders or deliveries, and cannot check out, until the office closes the day.

Reported by the agents with file and line in the four tables, not re-checked by me: `discovered_by` is set for every source; `due_list` stops at 50 rows with no paging; `office_set_blocked` does not move the stage; trial-to-parked after three visits is not implemented; `app.deliver` rolls back on a stock shortfall instead of recording lost demand; nothing runs the time-driven stage transitions.

## Recommended build order (full-stack slices)

Each slice is a task of its own with a branch and a pull request. Backend-first items are marked.

1. Office shell and setup: sign-in to a role-aware layout, `/office/devices` (approve and revoke), users, territories, areas, assignments. Needs B-18 (the owner exposes `app` and `vault_api` on staging) before it can run against staging; works locally now.
2. Rep shell: check-in and check-out, today's route, `my_day`.
3. Salons: list, detail with notes, visits and stage history, create, edit (fix defect 1 first).
4. Orders and delivery with invoice view; fix defect 3 first or decide it.
5. Stock screens: bag, issue confirmation, daily close, office stock and low stock.
6. Payments, receipts, cash ledger and handover (P1-07), backend then screens. This is the largest missing piece and gates exposure, ageing and J1.
7. Control layer and digest (P1-08), vault (P1-05), offline client (P1-09), dashboards (P1-10), agents (P1-15, needs a decision).

## Human actions this pass needs from MJ

B-18 (expose schemas on staging), B-13 (branch protection), B-02 and B-10 (real salon file and catalogue), B-28 to B-30, and the new B-31 questions in ACTIVITY.
