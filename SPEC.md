# Kiran DMS — Spec (index)

This file is the **entry point**, not a second source of truth. The planning set in [`docs/`](docs/00-README.md) (docs 00–15) decides *what* is built, and [`docs/ACTIVITY.md`](docs/ACTIVITY.md) decides *how* it is built. If this file and a doc disagree, the doc wins and this file is wrong. Fix it in the same pull request (H-25). This file never adds a requirement; new ideas go to [doc 12](docs/12-decisions-and-open-questions.md) first.

Decisions D-15 to D-20 (independent agents, lost demand, due-list and bag load in Phase 1) are recorded in [ACTIVITY L-0128](docs/ACTIVITY.md). This spec includes them.

---

## 1. Objective

**Who it is for.** Kiran Company's **sales agents** in Karachi, plus the owner and manager who run them:

| User | What the system does for them | Doc |
|---|---|---|
| **Salaried rep** (door to door, Kiran's stock and cash) | Shows which salons to visit, what is due, and what to carry. Takes orders on salon visits and records field activity/location; approved rep workflows work offline | [02](docs/02-growth-pipeline.md), [08](docs/08-field-sales-and-rep-controls.md) |
| **Salon customer** (direct business customer) | Uses a secure salon account to view its own catalogue, assigned prices, safe stock quantities, orders and documents, and can independently submit orders | [03](docs/03-requirements.md), [06](docs/06-security-plan.md), [15](docs/15-field-sales-distribution-engineering-plan.md) |
| **Independent agent** (buys stock outright, resells, reports nothing) | Buys cash-and-carry at an agent price and sees their own purchases and the agent catalogue | [08 §10](docs/08-field-sales-and-rep-controls.md), D-15 to D-17 |
| **Owner** | Sees everything from a phone. Holds the governance powers and the supplier secret | [06 §2](docs/06-security-plan.md), [07](docs/07-supplier-confidentiality.md) |
| **Manager** | Full day-to-day operations: stock, cash, territories, approvals below the owner's thresholds | [06 §2](docs/06-security-plan.md), [13 §9](docs/13-anti-fraud-controls.md) |

**The job.** Operate a controlled Karachi salon-distribution network through field representatives and a salon customer portal ([doc 15](docs/15-field-sales-distribution-engineering-plan.md)) by tracking four connected areas:

- **Customers and coverage:** salon records, locations, territories, assignments and visits.
- **Sales:** representative-placed and salon-placed orders through one canonical order engine.
- **Supply:** shared products, salon-specific selling prices, stock custody, availability and fulfilment.
- **Money:** invoices, installments, collections, receivables and the daily handover.

**Success in 12 months** ([doc 01](docs/01-business-context.md)):
- 3× active salons;
- +50% order frequency;
- stock-outs under 2% of lines;
- over 90% of installments collected on time;
- Rs 0 unexplained handover variance;
- every new rep productive within 2 weeks;
- monthly sales through independent agents, in rupees (D-21; target to be set by the owner, OQ-21).

**Scope and order.** Phase 0 is foundations, and Phase 1 is the existing MVP: the khata, the bag and the controls. The salon portal and dual-channel order requirements are specified in docs 03, 06 and 15 and sequenced in doc 11, subject to the existing phase gates. ACTIVITY §12 remains the live implementation status; requirement IDs are in doc 03.

**Non-goals for now:** accounting, payroll, consumer e-commerce and multi-city features ([doc 01](docs/01-business-context.md)).

## 2. Where we are (2026-10-29)

The live record is the ACTIVITY status board (§12); this is a snapshot and the board wins.

| Phase | Item | State |
|---|---|---|
| 0 | Repo, CI, auth with MFA, RLS test harness, config defaults, protocol enforcement (P0-04 to P0-09) | Built; P0-04, P0-05 wait on human steps (owner account, B-18 exposed schemas); P0-06 reopened by C-001 |
| 0 | Decisions, territories and pilot rep, vendor sign-ups, Excel real-file run, Gate 0 (P0-01, 02, 03, 07, 10) | **Waiting on MJ** (§11) |
| 1 | P1-01 foundation (roles, devices, audit chain, approvals) | VERIFIED |
| 1 | P1-04 inventory + lost-demand capture | DONE (self-reported), [PR 5](https://github.com/ethancrystal/kiran-dms/pull/5), CI green |
| 1 | P1-02 parts a and b: territories, salons, masked phones, stage events; rep days, visits, check-in gating | DONE (self-reported, L-0147, L-0153) |
| 1 | P1-16 due-list and manual routes | DONE (self-reported, L-0159) |
| 1 | P1-06 parts a and b: credit profile, orders, discount approvals, deliveries, gapless invoices | DONE (self-reported, L-0165, L-0170); part c, the invoice document's data, DONE (self-reported, L-0199) |
| 1 | P1-02 c–d, P1-03, P1-05, P1-07 to P1-15, P1-17 | Not started; order in ACTIVITY §12.1 |

Phase 1 started before Gate 0 by MJ's decision (D-20).

## 3. Sales-agent journeys and how we know they work

Each journey is accepted only when every line under it is shown by a test or, where marked, by the pilot. The IDs point to the requirement; the requirement is the authority.

**J1 — A salaried rep's day** ([doc 02](docs/02-growth-pipeline.md), [doc 08 §3](docs/08-field-sales-and-rep-controls.md))
1. Morning check-in confirms the bag count; no order is possible without it (PIP-09, CTL-05).
2. The route lists the day's stops with a reason each: re-order due, collection due, at risk, prospect, delivery (PIP-03, PIP-06 thin, D-19).
3. At a salon the rep logs the visit, takes an order or a collection, or taps "asked for, could not sell" in **≤ 60 s each, with no signal** (PIP-02, ORD-10, DEM-01, NFR-01).
4. Everything captured offline syncs **within 60 s of reconnecting**; a replay never doubles an effect; a server rejection is shown to the rep (NFR-01, H-08).
5. The salon receives a numbered system receipt on its phone for every payment (CTL-01, D-09).
6. Evening: bag close and a two-party cash handover with the manager (the rep acknowledges the counted figure in their own app); variance is **Rs 0 and 0 units**, or a case is opened the same day (INV-05, PAY-05, CTL-03, doc 11 exit criterion 2).
7. The rep only ever sees their own territories' salons, phones masked, ≤ 50 per page, no export (SAL-09, SEC-06, H-14).

**J2 — A rep adds a prospect** ([doc 02](docs/02-growth-pipeline.md))
1. Drop a pin or quick-add with type, photo, optional phone and a note in **≤ 60 s, offline** (MAP-02, PIP-07).
2. The salon starts as Prospect; every later stage change is a recorded event with a reason when manual (SAL-03).
3. A phone already on another salon is flagged to the office (CTL-18).

**J3 — An independent agent buys stock** ([doc 08 §10](docs/08-field-sales-and-rep-controls.md), D-15)
1. The agent sees the agent catalogue with agent prices and warehouse availability, quantities only; never salons, other agents, cost or supplier (AGT-04, H-01, H-05).
2. Stock leaves the warehouse **only after full payment** (cash counted or transfer matched); never on credit (AGT-03, A-07).
3. The agent gets a numbered invoice and receipt on their phone; the movement is `sale_to_agent` (AGT-03).
4. If they wanted more than is available, the shortfall is recorded as lost demand (DEM-02).
5. The only thing an agent may send back is an **optional pre-order request**; nothing else is asked of them (AGT-04, D-23).
6. Every agent purchase appears in the owner's morning digest, with a flag on unusually large ones (CTL-15, D-22).
7. Kiran pays nothing for recruiting other agents (AGT-06, A-06).

**J4 — The manager loads tomorrow's bags** ([doc 10 §7a](docs/10-inventory-and-restocking.md))
1. The system suggests each rep's load from tomorrow's route: open deliveries, due re-orders × last quantity, a prospect allowance, minus what is already in the bag (INV-11).
2. The suggestion never exceeds warehouse availability or the bag value limit; every shortfall is recorded as lost demand (INV-11, DEM-02, CTL-05).
3. Stock moves only when the rep confirms the same count; a different count moves nothing (CTL-05). *Built in P1-04.*

**J5 — The owner's morning** ([doc 01](docs/01-business-context.md), [doc 13](docs/13-anti-fraud-controls.md))
1. "How much are we owed, by whom, and who is collecting it?" is answered from the phone in **under 10 s** (doc 01 system goal 2, doc 11 exit criterion 4).
2. The daily digest lists every override, adjustment, variance, write-off, phone change, vault read and agent purchase (doc 00 fixed decision 8e, CTL-15, doc 13 §8, D-22).
3. Monthly sales through agents are reported in rupees (D-21).
4. Lost demand by SKU and reason shows what the supplier shortage cost (DEM-03, D-18).
5. A new rep can be onboarded and taking orders within **one working day**; offboarding takes under 10 minutes from one screen (doc 01 system goal 1, SEC-08).

**J6 — A salon places a repeat order** ([doc 15](docs/15-field-sales-distribution-engineering-plan.md))
1. The salon user signs in; the server resolves the salon from active membership, not a client-supplied ID (SAL-11, SEC-13/14).
2. The portal shows the shared active catalogue, that salon's assigned prices and safe aggregate stock only (SAL-12, INV-12).
3. The salon submits its basket; the common server-side order engine validates price, stock, credit and idempotency (ORD-11/12).
4. The salon sees only its own order state and permitted documents (ORD-13).
5. The order is not counted as a rep visit or rep-taken order. The office processes it through the shared order-to-cash workflow; confirmation follows OQ-31.

## 4. Phase 1 feature map

| Feature | Requirements | Proven by | Status |
|---|---|---|---|
| Foundation: roles, MFA at the database, devices, audit chain, approvals | SEC-01 to 05, 07, 11, 12 | RLS matrix, verifier attack suites | VERIFIED (P1-01) |
| Inventory, two-party bag custody, counts, adjustments, lost-demand tap | INV-01 to 06, CTL-05, DEM-01 | `inventory.test.ts`, RLS matrix | DONE self-reported (P1-04) |
| Territories, salons, masked phones, notes, stage events | SAL-01 to 03, 09, PIP-01, MAP-03 | `salons.test.ts`, RLS matrix | DONE self-reported (P1-02a, L-0147) |
| Visits and check-in gating | PIP-02, PIP-09 | `visits.test.ts`, RLS matrix (Playwright J1 not written yet) | DONE self-reported (P1-02b, L-0153) |
| Salon OTP verification, phone-change OTP | CTL-09, CTL-18 | DB tests (SMS adapter stubbed) | Not started (P1-02c) |
| Excel import write path, timeline | SAL-10, SAL-05 | DB tests, import tests | Not started (P1-02d); the credit profile (SAL-04) moved to P1-06a |
| Rep map | MAP-01, 02, 12 | Playwright | Not started (P1-03) |
| Vault: suppliers, POs, goods receipts, fill rate | VLT-01 to 06, D-18 | Vault leakage tests (doc 07 §5) | Not started (P1-05) |
| Credit profile, orders, discount approvals, deliveries, gapless invoices | SAL-04 (eligibility, limit, block; overdue status waits for P1-07), ORD-01 to 04, 10; CTL-07, CTL-08 (digest listing in P1-08) | `orders.test.ts`, `deliveries.test.ts`, RLS matrix | DONE self-reported (P1-06a L-0165, P1-06b L-0170) |
| Invoice document | ORD-05 | `invoice-document.test.ts` | Data DONE self-reported (P1-06c, L-0199); the PDF renderer and receipt numbers (P1-07) are not built |
| Money: payments, receipts, cash ledger, handover | PAY-01 to 05, 07, 10, 11; CTL-01 to 04, 17 | DB tests | Not started (P1-07) |
| Control layer and owner digest | CTL-06, 11, 15, 16; SEC-06, 08 | DB tests | Not started (P1-08) |
| Offline PWA: outbox, idempotent sync, rejections, Urdu | NFR-01 to 03, ORD-10 | **Playwright** + field test | Not started (P1-09) |
| Dashboards, admin | RPT-01, 02; MSG-03; ADM-01, 02; FLD-01 | Playwright | Not started (P1-10, P1-11) |
| Independent agents | AGT-01 to 04, 06 | DB tests + Playwright J3 | Not started (P1-15) |
| Due-list and manual routes | PIP-03, PIP-05/06 thin | `routes.test.ts`, RLS matrix | DONE self-reported (P1-16, L-0159) |
| Route-linked bag load, lost-demand report | INV-11, DEM-02, DEM-03 | DB tests + Playwright J4 | Not started (P1-17) |
| Security acceptance suite + restore drill | doc 06 §10, doc 07 §5, NFR-10 | launch security checklist below | Not started (P1-12) |

**Launch security checklist** ([doc 06 §10](docs/06-security-plan.md)), all required before the pilot:
1. RLS matrix passes for every table × role, including a rep in territory A failing to read territory B.
2. No application role can UPDATE or DELETE an append-only table.
3. No office login without TOTP; no rep action from an unapproved device.
4. Vault columns unreadable through the API with any user token; vault reads logged and in the digest.
5. Audit hash chain verifies; the mirror receives rows nightly.
6. Full offboarding from one screen in under 10 minutes (rehearsed).
7. Backup restore drill done and documented.
8. Dependency and secret scans clean; no service-role key in any client bundle.

## 5. Field constraints every screen must meet

| Constraint | Target | Source |
|---|---|---|
| Offline | Capture visits, orders, payments, prospects and lost demand with no signal; sync ≤ 60 s after reconnecting | NFR-01 |
| Cheap phone | First load ≤ 3 s on 3G after install; interactions ≤ 200 ms; rep app shell ≤ 300 KB gzipped; 3–4 year old Android, 2–3 GB RAM | NFR-02, doc 01 |
| Language | English and Urdu (Nastaliq-safe font); Roman Urdu accepted in free text | NFR-03 |
| Speed of a field action | ≤ 60 s for quick add, a visit, an order or a tap | PIP-07, MAP-02 |
| Cost | ≤ USD 60 a month at launch scale (≤ 10 reps, ≤ 3,000 salons) | NFR-09 |
| Recovery | RPO ≤ 24 h, RTO ≤ 4 h | NFR-10 |

## 6. Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck                      # every package
pnpm db:test                        # all migrations on a throwaway Postgres + RLS/invariant suite
pnpm db:test -- -t "name"           # one test
pnpm -r --if-present test           # package unit tests (packages/import)
pnpm activity:check                 # the ACTIVITY.md check CI runs
pnpm -C apps/web dev                # web app on :3000 (/app rep PWA, /office)
pnpm -C apps/web build              # production build (CI also scans the bundle, H-18)
pnpm lint                           # Biome lint + format check (CI job `lint`, §8)
pnpm format                         # write Biome fixes
pnpm -C apps/web test:e2e           # Playwright rep PWA tests; builds the app first (CI job `e2e`, §9)
```

- **Test database URL:** set `KIRAN_TEST_DATABASE_URL`, never the generic `DATABASE_URL`, to use a real database. For example, `supabase start` gives `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- **Running as root:** embedded Postgres cannot start as root, so point the URL at a fresh local database and recreate it before every run.
- **Collation:** create that database with the en_US.UTF-8 collation, as Supabase does (`create database kiran_test template template0 locale 'en_US.UTF-8'`). The embedded Postgres uses the C locale, which hides ordering differences (ACTIVITY L-0150).
- **Test order:** test files share one database and run in file-name order (`supabase/tests/vitest.config.ts`); a file that commits territory assignments ends them in `afterAll`.
- **Staging:** nothing is applied to staging or production by hand (H-19). Migrations reach them through CI only.

## 7. Project structure

| Path | What |
|---|---|
| `docs/` | Planning set 00–15, `ACTIVITY.md` (protocol + live log), `diagrams/`, `runbooks/` |
| `supabase/migrations/` | Forward-only SQL: schemas, tables, RLS, `app.*` functions, guards. One file per task, never edited after merge |
| `supabase/tests/` | Vitest + `pg`: the RLS matrix (every table × 10 personas), invariant and attack tests, schema hygiene |
| `apps/web/` | Next.js 16 + React 19. `app/app/` is the rep PWA, `app/salon/` is the salon customer portal, `app/office/` the owner/manager app, `lib/supabase/` the clients |
| `packages/import/` | Excel/CSV salon import dry-run (P0-02); writes to no database |
| `packages/shared/` | Planned: DB-generated types, validation schemas, i18n strings (en, ur) |
| `scripts/` | CI helpers: activity-log check, service-role scan, staging smoke |

The data model is in [doc 04](docs/04-domain-model.md), the architecture in [doc 05](docs/05-architecture.md), the cross-domain integration brief in [doc 14](docs/14-unified-business-domain-prompt.md), and the module-level field-sales/distribution directive in [doc 15](docs/15-field-sales-distribution-engineering-plan.md).

## 8. Code style

**Formatting and lint: Biome** (MJ, L-0136).
- One `biome.jsonc` at the root, `pnpm lint` and a CI `lint` job that fails the pull request.
- Run `biome check --write` before committing.
- *Status: in place* (`biome.jsonc`, Biome 2.3.15). Files that existed before Biome and do not yet pass it are listed as **legacy** in `biome.jsonc` and excused from formatting and import order until cleaned up; every other file, and every new one, must pass.

**TypeScript**
- `strict` on.
- No `any` without a comment saying why.
- No non-null `!` on data from the network or database.
- Name things with domain words from [doc 00's vocabulary](docs/00-README.md) (salon, khata, bag, handover).
- Money is integer **paisa** (`bigint` / `number` within the safe range), never floats. Format it only at the edge.

**React / Next.js**
- Server components by default; client components only where state or offline needs them.
- No secrets in client code or `NEXT_PUBLIC_*` (H-18).
- All writes go through `app.*` RPCs, never a direct table write.

**SQL** (the full rules are the database conventions in [`CLAUDE.md`](CLAUDE.md)):
- **RLS:** enabled and forced on every table, in the same migration that creates it.
- **Write functions:** writes go only through `security definer` functions with `set search_path = ''`, an idempotency `client_id`, and role and device checks.
- **Append-only tables:** guarded by triggers against every role.
- **Audit:** every table has an audit trigger.
- **Time:** server time is authoritative; client times are kept in `*_client` columns.
- **Data:** no free text that could hold supplier identity (H-27). Fixtures are `[Dummy]` / `[Test]` only, and phone numbers look like `+920000001234` (H-02 to H-04).

**UI copy:** rep screens are in English with Urdu labels where reps need them. They must work on a 3–4 year old Android phone with patchy data ([doc 01](docs/01-business-context.md)).

## 9. Testing strategy

| Layer | What it proves | Where | Status |
|---|---|---|---|
| **RLS matrix** | Each persona can read exactly the rows the matrix predicts in every table, and no app role can write directly | `supabase/tests/rls-matrix.test.ts` | Running in CI |
| **Invariant and attack tests** | Controls hold under attack: append-only, maker ≠ checker, no negative stock, single-use approvals, territory isolation, replays | `supabase/tests/*.test.ts` | Running in CI |
| **Schema hygiene** | Every table has RLS and an audit trigger; every SECURITY DEFINER function pins `search_path`; anon can execute nothing | `supabase/tests/schema-hygiene.test.ts` | Running in CI |
| **Package unit tests** | Import mapping and normalisers | `packages/import/tests/` | Running in CI |
| **Rep PWA browser tests** (Playwright, MJ L-0136) | The offline order, payment and lost-demand tap are queued in the outbox and synced idempotently; a server rejection after sync is shown to the rep (NFR-01); throttled network and a low-end mobile viewport | `apps/web/e2e/` | **Running in CI** (job `e2e`): sign-in on a 360 px Android screen with Urdu labels, a refused request shown to the rep, ≤ 300 KB gzipped JavaScript (199.9 KB on 2026-10-28), security headers. Offline order, payment and lost-demand flows are added with P1-09 |
| **Field test** | Offline capture in a basement salon with no signal (Phase 1 exit criterion 6) | Pilot, [doc 11](docs/11-roadmap.md) | Phase 1 pilot |

**Rules for tests:**
- **No test is ever skipped or loosened** to get green (H-23).
- **Verifier-authored tests** change only with MJ's approval. Three kinds of change for a new module are pre-approved (MJ, 2026-10-28, ACTIVITY L-0144): adding its functions to the allowlist, adding `*_client` or planned-date parameters to the client-time list, and turning a "does not exist yet" check into a "rep sees 0 rows" check. Each is logged.
- **Each control gets a test that tries to break it**, not only one that uses it.
- **The Definition of Done** is in ACTIVITY §6.
- **A different agent or MJ marks work VERIFIED**, never its builder (§7).

## 10. Boundaries

The full list is the hard rules H-01 to H-27 (ACTIVITY §5), "stop and ask MJ" (§9) and the human-only actions (§10). In short:

**Always**
- Read `docs/ACTIVITY.md`, then log a SESSION-START, a claim and a HANDOFF.
- Work on a feature branch.
- Record real evidence: commands, counts, SHAs (H-23, H-24).
- Enforce controls in the database, not only in the UI.
- Keep docs and code in step in the same pull request (H-25).

**Ask MJ first**
- Any change to a fixed decision, the permission matrix, custody chains or the doc 13 §9 thresholds (H-26).
- Anything touching production (H-19).
- A new third-party service or any spend (H-21).
- A control that cannot be built as specified, or two docs that conflict.
- Changing a verifier-authored test, beyond the three pre-approved kinds (§9).

**Never**
- Put supplier identity, cost or real personal data anywhere outside the vault: not in the repo, CI, logs or prompts (H-01 to H-05).
- Edit or delete history; corrections are reversing rows (H-06, H-07).
- Weaken, bypass or "temporarily skip" RLS, MFA, device binding, approvals or audit (H-16).
- Put a service-role key in client code (H-18).
- Mark your own work VERIFIED (§7).
- Pay agents for recruiting other agents (A-06; SECP, Companies Act 2017 s.301).

## 11. Decisions waiting on MJ

Work that needs them is blocked or runs on the stated default (ACTIVITY §14, doc 12).

| Item | Blocks | Default meanwhile |
|---|---|---|
| B-18: expose schemas `app` and `vault_api` on staging (Supabase dashboard) | Login and device registration on staging; Gate 0 | Nothing works against staging |
| Owner account creation and MFA (human-only, ACTIVITY §10) | P0-05, Gate 0 | — |
| OQ-01: the real Excel file | P0-02 real run, opening balances | Synthetic data |
| OQ-13: pilot territory and pilot rep | P0-03, P1-13 pilot | — |
| OQ-16: real product catalogue | Real SKUs and prices | `[Dummy]` products |
| OQ-17: agent price (% below list, or per SKU) | First agent sale | No SKU sold to agents until priced |
| OQ-18: may agents sell to Kiran's direct salons? | Agent 2 | No rule in the system |
| OQ-19: who is served first when the supplier is short | Allocation (AGT-07) | Direct salons' orders first |
| OQ-20: agent identity data | Agent 1 | Name and phone only |
| OQ-21: monthly target for sales through agents (Rs) | Agent channel goal | No target; the figure is reported monthly |
| OQ-22: what counts as an unusually large agent purchase | Digest flag | No flag; every agent purchase is listed anyway |
| D-08: manager vs owner governance split | Permission matrix | Owner-only governance (doc 06 §2) |
| A-08: rep bag limits owner-only (may be relaxed to the manager) | — | Owner only |
| Renumbering of branch `claude/architecture-rfc` | Merging it | Not merged |
| B-13: branch protection on `main` with the five CI check names (ACTIVITY L-0175) | Binding CI | A pull request merges whatever its checks say |
| B-28: may reps park a salon (doc 02) against the doc 06 matrix (rep: no manual stage change) | Matrix wording | Rep parking stays, as doc 02 says |
| A-09, A-10: opening last purchase; exposure as confirmed installment orders | P1-07 | As stated in ACTIVITY §15 |
| Pin required for a map-created salon? (ACTIVITY L-0182) | A database check | Not required (offline quick add may lack GPS) |
| Phone-reveal cap; automatic day close; geofence threshold (ACTIVITY L-0146, L-0152) | New thresholds (H-26) | No cap; office force-close only; distance recorded, not enforced |
