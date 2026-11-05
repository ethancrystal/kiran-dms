# 2026-11-05 15:52 PKT · Claude · Opus 5.5 · branch claude/p1-29-routes-stock · TASK
**Task:** P1-29 (completion slice 11: routes and stock leftovers; PIP-03, PIP-05, PIP-06 thin; INV-04, INV-05, INV-06; CTL-05; DEM-01; areas: new screens /office/routes, /app/route, /office/stock/levels; additions to /office/stock, /app/stock, /app/salons/[id], /app; one line each in the office nav; apps/web/e2e-stack/office.spec.ts)
**What / why:** Session start and claim. Read first: CLAUDE.md, docs/ACTIVITY.md in full (docs/AGENT-COMPLIANCE-PROTOCOL.md does not exist on this tree), the frontend structure plan (rules in section 2, S-A and S-C in section 7, catalogue in section 8) and MJ's answers 2026-11-05-mj-frontend-structure, the slice 8 TASK entries, migrations 20261028050000_inventory, 20261028060000_salons (record_demand), 20261028080000_routes and 20261105100000 (R4 versions of rep_holds_salon, due_list, my_route). Branch claude/p1-29-routes-stock from origin/main at 50e7162. Baseline: pnpm agent:preflight OK, worktree clean. Open pull request 66 (slice 9, overview pages) touches no file of this slice except possibly the office nav; slice 10 is being built concurrently (grouped office sidebar, /office/reps/[id], invoice and receipt views) and its pages and the layout shell are left alone. Nothing is pushed; MJ approves pushes and merges.

The gap, checked by grep of apps/web: only rep-day.tsx calls app.my_route, app.due_list, app.rep_add_stop and app.rep_reorder_route; no page calls app.office_set_route, app.warehouse_availability, app.low_stock, app.office_set_reorder_point or app.record_demand; app.record_count is called only for the rep's daily close. Bag return has a function: app.office_propose_stock_issue takes direction to_warehouse and app.rep_confirm_stock_issue posts the return movement (doc 10 section on movements), so no blocker is needed; only the screens hard-code to_rep. The evening bag count exists (CloseDay in rep-day.tsx, B-35, stack tested) and is not rebuilt. Office counts exist in app.record_count (spot_check on a rep bag, cycle_count, stock_take) and stock_count is readable by the office under RLS.

Plan: no migration. The office reads route, route_stop, rep_territory, salon and salon_rep_assignment under their RLS policies, and everything else through the existing functions.
**Evidence:** Claim only; evidence follows in additions to this entry.
**Next / needs:** the build, then the checks named in the brief.

Addition, the build (2026-11-05 16:15 PKT). In the master prompt's words: IMPLEMENTED, NOT VERIFIED. No migration, no new function, table or D, A or B number: every operation below already had its function.
**What / why:** English only (D-42) in every new screen; the Urdu already on /app and /app/day is left as it is.
- /office/routes (owner or manager): pick a rep and a day; add, remove and reorder stops with a reason; Save calls app.office_set_route. The saved route is read from route and route_stop under RLS. Due salons: app.due_list once per territory the rep covers (one call is capped at 50, and the page says so when a call is full). The salon picker reads rep_territory, salon (approved, not parked) and salon_rep_assignment under RLS; this is a convenience, app.office_set_route decides (app.rep_holds_salon, R4). A past day is shown read-only. Karachi dates through karachiToday (lib/commission.ts), never the browser's date.
- /app/route (rep; link on /app; 360 px first, tap targets of at least 44 px in globals.css): app.my_route for a day, app.rep_reorder_route (today or later), app.rep_add_stop (today only) from the due list or the rep's own salons (app.my_salons). No open day is needed. A phone not yet approved reads no rows from the database, so the page shows a denied message rather than an empty route. /app/day is unchanged.
- /office/stock/levels: low stock (app.low_stock), availability (app.warehouse_availability), reorder points (reorder_rule read under RLS, app.office_set_reorder_point), office counts (app.record_count: spot check on a rep bag, cycle count, stock take; one client id per count; typed without the expected figure), the newest 50 counts with the database's variance_units, expected and counted (the rep's daily close included).
- Bag return: no function was missing, so B-44 was not raised. /office/stock proposes it (app.office_propose_stock_issue, direction to_warehouse; the form lists what the bag holds); /app/stock lists it apart from incoming stock and the rep confirms with a blind count (app.rep_confirm_stock_issue); a different count leaves it disputed with nothing moved, and the office cancels as for an issue. /app/stock also shows warehouse availability (INV-04, quantities only).
- Lost demand: components/lost-demand.tsx on the rep's salon page (app.record_demand with the salon; a SKU, or a product group for not_in_catalogue, no free text; one client id per intent; the rep's own recent rows for that salon). supply_short is not offered to a rep (the function refuses it).
- Evening bag count: already there (CloseDay in rep-day.tsx, B-35, stack tested); not rebuilt.
- Nav: Stock levels and Routes, one line each in the flat list of layout.tsx, for slice 10 to place in its groups (plan section 4: Inventory and Stock; Field Team).

Rulings (safe defaults; MJ may overrule):
- A stop the rep added (pin_selected) is re-sent as manual when the office saves the day, because app.office_set_route refuses pin_selected from the office; the page marks it "added by the rep", and the page warns that saving replaces the whole day. The alternative, refusing to save, would leave the office unable to edit a route a rep had touched. So the original reason of that stop is lost on an office save (the audit trigger keeps the old row).
- The picker offers approved, not parked salons only; app.office_set_route itself does not check approval.
- Frontend plan section 11 point 3 (a separate Route page for reps) is answered by this slice's brief: built, and the route handling on /app/day stays.
- Lost-demand tap: placed on the salon page, DEM-01's "during a visit"; the plan's catalogue lists it with the bag, so MJ may want it there too.

Stack tests (apps/web/e2e-stack/office.spec.ts, appended after the slice 8 journey on Rep One's kept phone, because the local stack sends at most 2 e-mails an hour): (1) the manager builds a route from a due salon and a picked salon, reorders and saves; it survives a reload; a salon outside the rep's territories is not offered; the rep's phone shows the same order, reorders (survives a reload) and adds a stop; the office sees the rep's order, removes a stop and saves; the database then holds [due, reorder_due] and [added, manual]; a salon the rep does not hold is 22023 for the manager; app.office_set_route is 42501 for the rep; the rep at /office/routes lands on /office/mfa with no office nav; signed out, /office/routes and /office/stock/levels go to sign-in. (2) a reorder point on a SKU with no stock lists it as low (0 against 5, after a reload too); stock above the point takes it off the list and availability shows it; a return proposed (nothing moves), confirmed by the rep's count, with the bag, warehouse and on-hand figures read back; a stock take one short shows variance 1, expected and counted, with availability unchanged; the lost-demand tap, after a reload and on the database; app.office_set_reorder_point, app.low_stock and app.stock_on_hand are 42501 for the rep. Locators were read against the existing journeys' labels; the labels and messages slice 8 uses on /office/stock and /app/stock are byte-identical.
**Evidence:** DATABASE_URL and KIRAN_TEST_DATABASE_URL unset; embedded Postgres; synthetic data only. Commits c9656b1 (routes, levels), 8ea824c (return, lost demand), 87813ef (stack tests, docs, board), and the commit carrying this addition.
- Combined, ONE command: pnpm vitest run --config supabase/tests/vitest.config.ts rls-matrix schema-hygiene verifier-attacks reverify3 inventory routes visits office-approvals: 8 files, 2632 passed, 0 failed. No database test was added, because no database object changed.
- pnpm typecheck: pass. pnpm exec biome format --write apps/web, then pnpm exec biome check --diagnostic-level=error: no errors (148 files). pnpm lint: pass, 36 warnings, 42 infos (the slice 8 counts).
- pnpm -C apps/web build with the CI placeholder public settings: pass; routes include /app/route, /office/routes, /office/stock/levels.
- CI=true pnpm -C apps/web test:e2e: 4 passed. pnpm service-role:scan: OK, 90 files; node scripts/service-role-scan.mjs --bundle apps/web/.next/static: OK, 144 files. node --check scripts/e2e-stack-seed.mjs: exit 0 (the seed is unchanged).
- node scripts/activity-log-check.mjs origin/main and pnpm agent:preflight: in the addition below.

Not run here: apps/web/e2e-stack (no Docker on this host; CI only), so the two new journeys and every new screen are unexercised in a browser, the 360 px layout of /app/route included (nothing checks it in a browser yet). The rest of the database suite. Nothing was pushed, merged or applied to any Supabase project.

Not built: a correcting adjustment from a count variance (a count only records; the Stock page's adjustment form is opening stock, positive only); an office view of lost demand (DEM-03, P1-17); offline for the rep's route and lost-demand tap (DEM-01 says it works offline: online until P1-09, F7).

Noted, existing behaviour, not changed: app.office_set_route replaces a day's stops by a hard delete of route_stop rows (P1-16, the audit trigger records them; the H-07 wording is not obviously met). Low stock counts warehouses and rep bags together (B-31 f, open).

DoD (section 6):
[x] Requirement IDs implemented as written for these screens; differences listed above
[ ] Migration: none (n/a)
[ ] No new table (n/a); the database's refusals are exercised by the stack journeys and the existing routes and inventory suites
[ ] Append-only: no new table (n/a); no screen edits a record
[x] Mutations through the existing security definer functions; each count, return and lost-demand tap keeps one client id; a route save and a reorder replace state, so a replay changes nothing further
[x] Writes are audited by the existing triggers
[x] No vault data
[ ] Offline: not done for the rep's route and lost-demand tap (P1-09), so not DONE
[x] No browser arithmetic on stock or money: every figure shown is the database's
[ ] Lint, typecheck, touched DB suites pass locally; CI not yet run (so not DONE)
[x] Docs (SPEC.md, doc 03, the frontend plan) and the board updated
[x] No secrets, real personal or supplier data in the diff (read)
[x] This entry holds the evidence

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no new table or policy)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)
**Next / needs:** CI on a pull request (MJ decides when to push), above all the e2e-stack job with the two new journeys. MJ: the rulings above. The office nav gets two flat lines here; slice 10's grouped sidebar should place them.

Addition, after merging main (2026-11-05 16:40 PKT): origin/main moved to 594479c during the build (pull request 67, P1-27, removes the Urdu from apps/web), so the first node scripts/activity-log-check.mjs origin/main failed, naming docs/log/2026-11-05-claude-english-only-code.md as deleted, because this branch did not have that file yet. Merged as f6c1f27, no conflict. This corrects the build addition's line about Urdu: with that merge no Urdu is left on /app, /app/day or the rep's salon page.
**Evidence:** on f6c1f27: pnpm typecheck: pass. pnpm exec biome check --diagnostic-level=error: no errors (148 files). pnpm lint: pass, 36 warnings, 42 infos. pnpm -C apps/web build: pass. CI=true pnpm -C apps/web test:e2e: the first run failed with exit code 1 while the build above was still running in the background on the same .next directory (its failure output was not kept, so the cause is inferred, not shown); rerun alone: 4 passed. node scripts/activity-log-check.mjs origin/main: OK (1 new log entry, 16 changed files; owner terms checked: 0, the secret is not set locally). pnpm agent:preflight: PREFLIGHT OK. The database suites were not rerun after the merge: it changed nothing under supabase or scripts (git diff --stat 50e7162 origin/main -- supabase scripts is empty).

Addition, corrections (2026-11-05 16:27 PKT, read from the clock). Two statements in the additions above were wrong. (1) The post-merge addition lists pnpm agent:preflight as run on f6c1f27; it had last run on f551ffa, before the merge. It is run after this correction: result on the line at the end of this addition. (2) The times 16:15 and 16:40 in the two additions above were estimates, not clock readings; 16:40 is later than this addition. Also changed here: the form on /app/route is now labelled Add a stop from my salons, so it no longer shares its name with the select inside it, and the stack test follows. After that rename: pnpm typecheck pass; pnpm exec biome check --diagnostic-level=error no errors (148 files); the build and test:e2e were not rerun for this one attribute.

The screen definitions (frontend plan section 2 rule 9, section 9 template). They are written after the build, not before it as the rule asks; recorded so the difference is plain.
```
Route: /office/routes
Roles: owner, manager at AAL2. Rep lands on /office/mfa with no office nav; anonymous goes to /office/login; a direct RPC is 42501.
Functions: app.office_set_route(p_rep_id, p_day, p_stops); app.due_list(p_on, p_territory_id).
Data: route, route_stop, rep_territory, salon, salon_rep_assignment, user_profile under RLS. No new read.
Fields: rep, day; stop salon (link), area, reason, added by the rep; due salon, area, product group, status, due date.
Filters and sort: stops by sequence; salons by name, approved and not parked, first 200 (says so); due per territory, 50 a call (says so).
Actions: Add stop, Add to route, Move up, Move down, Remove (local until saved); Save route, no confirmation, the page warns it replaces the day.
States: Loading...; No stops for this rep on this day; Nothing is due...; the database's words on refusal; Route saved for NAME on DAY: N stops; a past day read-only.
Money: none. Offline: n/a.
Acceptance: the saved order survives a reload and reaches the rep; a rep-added stop can be re-saved; a salon the rep does not hold is refused.
Test: office.spec.ts, "a manager builds a rep's route...": positive, wrong role, other territory (22023); replay: a save replaces state, not exercised twice.

Route: /app/route
Roles: rep on an approved phone. Pending phone or another role: denied message; anonymous: sign-in.
Functions: app.my_session; app.my_route(p_day); app.due_list(p_on, null); app.my_salons; app.rep_reorder_route(p_day, p_stop_ids); app.rep_add_stop(p_salon_id).
Data: those functions only. No new read.
Fields: salon (link), area, reason, next due, visited and outcome; due salon, product group, status, due date.
Actions: Move up, Move down (today or later); Add to route, Add stop (today only). No confirmation; no reason field.
States: Loading your route...; No stops on this day; Nothing is due...; denied; the database's words; Route reordered; Added NAME to today's route.
Money: none. Offline: not built, online until P1-09.
Acceptance: the rep sees only its own route in the office's order; a new order survives a reload; 360 px, tap targets of at least 44 px (not yet seen in a browser).
Test: office.spec.ts, same test: positive; other reps are covered by routes.test.ts, not here.

Route: /office/stock/levels
Roles: owner, manager at AAL2. Rep: /office/mfa; anonymous: /office/login; direct RPC 42501 for the office functions.
Functions: app.low_stock; app.warehouse_availability; app.office_set_reorder_point(p_sku_id, p_reorder_point); app.stock_on_hand(p_location_id); app.record_count(p_client_id, p_location_id, p_kind, p_counted, p_counted_at_client).
Data: sku, reorder_rule, stock_location, stock_count, user_profile under RLS. No new read.
Fields: SKU, on hand, reorder point; SKU, available, reorder point; count kind, location, who, variance, expected, counted.
Sort: low stock and SKUs by code, first 200 SKUs (says so); counts newest 50.
Actions: Save a reorder point; Save the count (location, kind, a blank field per SKU held, Also found here). No reason field in the functions.
States: Loading...; Nothing is at or below its reorder point; No active SKU yet; No count recorded yet; the database's words; Reorder point of CODE set to N; Count saved: variance N units.
Money: none. Offline: n/a.
Acceptance: a point at or above stock lists the SKU as low; stock above it takes it off; a count records variance and leaves stock unchanged.
Test: office.spec.ts, "reorder point and low stock...": positive, wrong role; replay of a count: covered by inventory.test.ts, not in the browser.

Route: /office/stock, Take stock back from a rep's bag; /app/stock, Going back to the warehouse
Roles: propose owner, manager at AAL2; confirm the rep whose bag it is.
Functions: app.office_propose_stock_issue(direction to_warehouse); app.rep_confirm_stock_issue(p_issue_id, p_counted); app.office_cancel_stock_issue; app.warehouse_availability on /app/stock.
Fields: bag, warehouse, units per SKU the bag holds; the rep types its count blind.
Actions: Propose the return, one client id per form; Confirm my count; Cancel issue with a reason of at least 3 characters.
States: This bag holds nothing; Return proposed...; Confirmed: the stock has gone back to the warehouse; the disputed message; the database's words.
Money: none. Offline: online only.
Acceptance: nothing moves until the same count; the bag and warehouse figures follow.
Test: office.spec.ts, same stock test: positive path; disputed path not exercised in the browser (inventory.test.ts).

Route: /app/salons/[id], Lost demand
Roles: rep who holds the salon; the function refuses other salons and supply_short from a rep.
Functions: app.record_demand(p_client_id, p_sku_id, p_product_group_id, p_qty, p_reason, p_salon_id, p_captured_at_client).
Data: sku, product_group, demand_signal (own rows) under RLS.
Fields: reason, SKU or product group, units; newest 5 of the rep's rows for this salon.
Actions: Record lost demand, one client id per intent, no free text.
States: Loading...; Lost demand recorded; the database's words.
Money: none. Offline: not built, though DEM-01 asks for it (P1-09).
Acceptance: the row survives a reload and is on the database with the salon and the rep.
Test: office.spec.ts, same stock test: positive path; replay and other salon: not in the browser.
```
**Evidence:** the commands named in this addition; final pnpm agent:preflight and activity-log-check are reported in the hand-back, after this commit.
