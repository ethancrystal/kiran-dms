# Kiran DMS — moving pieces, and the different areas of the app

App name in the board: **k-dms**. Business: Kiran Company, Karachi — hair styling
and hair care distribution to salons and parlors. System: Kiran DMS, the
monorepo at the repo root.

This note is the map. It says what the app is, where every part lives, what
runs what, and how the areas fit together. Use it with
`docs/ACTIVITY.md` (rules, status board, blockers) and `docs/SPEC.md`
(entry point index).

---

## 1. What the app is

One product, three faces:

- **Rep app** (`apps/web/app/**` under `/app/*`): signed-in salespersons'
  offline-first phone UI — Today's list, bag, orders, outbox, account,
  inventory, settings.
- **Salon portal** (`/salon`, `/invite/[token]`): the salon's account page
  (slice 1) and the only page that creates the first login (D-39). Trade
  prices, catalogue, orders and documents behind the invitation-only portal.
- **Office app** (`/office/*`): owner and manager screens — accounts,
  orders, payments and cash, inventory, people (reps/salons/agents), vault,
  approvals, controls, admin.

Underneath: Supabase (PostgreSQL) with RLS, an encrypted vault, an audit
hash chain, an approval framework; Next.js 15 app router; Playwright
stack/journey tests; a local Supabase stack for `pnpm db:test`.

Roles: **owner** (one account, human, TOTP), **manager** (AAL2, own
profile), **rep** (company phone, approved device, TOTP). Governance
powers (users, bank details, write-offs, price lists, commission plans,
vault grants, configuration, audit log) are owner-only and AAL2; the
manager may also invite/suspend/revoke reps and salons and manage products
and prices (D-39). Nothing on that list may be granted to the manager for
convenience.

---

## 2. Repo layout — where every piece lives

| Path | Area | Runs / verified by |
|---|---|---|
| `apps/web/` | Next.js app: rep PWA (`/app/*`), office (`/office/*`), salon portal (`/salon`), invite (`/invite/[token]`), public shop plans A–F (`/khsalon.com`), e2e suites, outbox lib (P1-09) | pnpm dev / build; repo Playwright (`e2e`, `e2e-stack`); biome; tsc |
| `supabase/migrations/` | Forward-only SQL: schemas, tables, RLS, SECURITY DEFINER functions, triggers | `pnpm db:test` applies to fresh embedded Postgres |
| `supabase/templates/` | DB templates | `supabase start` / migrations |
| `supabase/tests/` | RLS matrix + invariant + launch acceptance + verifier tests (Vitest + `pg`) | `pnpm db:test` |
| `supabase/config.toml` | Supabase CLI: API schemas (`public`, `graphql_public`, `app`, `vault_api`); auth: TOTP for office, OTP for reps | `supabase start` |
| `packages/shared/` | Types generated from DB + validation schemas (planned; P1-02/P1-09 used parts) | typecheck |
| `packages/import/` | Excel/CSV salon import dry-run (P0-02), writes nothing | manual runs |
| `scripts/` | CI helpers: `activity-log-check.mjs`, `service-role-scan.mjs` | CI jobs |
| `docs/` | Planning set `00`–`16` (source of truth), `plans/` (current in-progress plans), `specs/` (documents under design), `runbooks/` (owner/agent runbooks), `diagrams/`, `gate-0-checklist.md`, `test-report-2026-10-25.md` | read-only reference |
| `docs/log/` | Append-only activity log, one file per entry (`YYYY-MM-DD-slug.md`); `archive.md` frozen | `pnpm activity:check` (CI) |
| `.github/workflows/ci.yml` | Five CI jobs (activity-log-check, db-tests, typecheck, lint, e2e) + `agent-compliance`/`agent-policy-files` gate | GitHub Actions |
| `intra/`/`docs/plans/` | In-progress plan files (task plans, not features) | — |
| `supabase (2).zip`, `supabase.zip`, `supabase/migrations.zip`, `.remember.zip`, `.worktrees/` | Archives/artifacts from previous agents | none in CI; ignored |

---

## 3. Backend — the Supabase app

### 3.1 Schemas (doc 06 §1 / config.toml)

- **`public`** — business data, RLS-scoped, deny by default; every table has
  `enable row level security` + `force row level security` in the same
  migration.
- **`control`** — approvals, audit, anomalies, phone-reveal log. Append-only;
  `audit_event` writable by triggers only; hash chain (`prev_hash`) must
  verify; no application role may write it.
- **`supplier_vault`** — classified supplier data (not exposed via
  PostgREST).
- **`vault_api`** — grant-checked functions (AAL2 + vault grant).
- **`app`** — RPC write path + helpers (all money/stock/stage/credit/
  approval/vault writes go through `SECURITY DEFINER` functions with
  `set search_path = ''`, idempotent `client_id`, role + device + rule
  checks).
- **`auth`** — owner/manager TOTP, rep OTP; device binding; revoked
  devices are dead for good (migration 0006); session/device approval
  flows.

### 3.2 Tables and controls (doc 06/07/13, hard rules H-01…H-27)

- **Append-only tables**: `visit`, `salon_note`, `discovery_run`, `stage_event`,
  `credit_event`, `payment`, `payment_allocation`, `cash_ledger_entry`,
  `stock_movement`, `audit_event`, `invoice`, `receipt`. `INSERT` + `SELECT`
  only; no UPDATE/DELETE grant or policy for any app role; a trigger raises
  on UPDATE/DELETE.
- **Money** in integer paisa (`bigint`, `_paisa` suffix), never floats.
- **Balances derived** (receivable, cash in hand, stock on hand) — sums of
  ledger/movement rows; never editable running balances.
- **Audits** (H-17): every `public`/`vault` table has the audit trigger;
  hash chain verifies.
- **Approvals** (doc 13 §9, H-12): `approval_request` with maker ≠ checker
  enforced as a database constraint; `app.request_approval` / `approval_use`
  registry.
- **RLS** tested live as signed-in roles (not as DB owner), own vs other
  territory, plus negative paths (anonymous, wrong role, bad input,
  replay).

### 3.3 Security controls (doc 06 §10 launch criteria — the eight acceptance checks)

1. RLS matrix tests pass for every table × role, incl. rep in territory A
   failing to read territory B.
2. No app role can UPDATE/DELETE any append-only table (tested).
3. Owner/manager cannot log in without TOTP; rep cannot operate from an
   unapproved device (tested).
4. Vault columns unreadable via REST with any user token (tested); vault
   reads appear in the access log and digest.
5. Audit hash chain verifies; mirror receives rows nightly.
6. Full offboarding completes from one screen in under 10 minutes (rehearsed).
7. Backup restore drill performed once before go-live, documented.
8. Dependency and secret scans clean; service-role key absent from all
   client bundles (checked in CI).

### 3.4 Data model by domain (doc 03 ids)

| Domain | Requirement ids | Notes |
|---|---|---|
| Territories, areas, salons, contacts, stages | SAL-01…10, PIP-01…09, MAP-01…12 | Reps read through views (masked phones, ≤50 rows); territory scoping by RLS, not UI |
| Inventory: SKU master, locations, movements, issue/return, close, spot check, reorder points | INV-01…11, DEM-01…03 | movements append-only; dummy data `[Dummy]` until catalogue (OQ-16) |
| Orders + invoices + approvals | ORD-01…11 | price list, credit gate, discount approvals, delivery + salon acknowledgment (D-49), gapless invoice numbering (1 Jul–30 Jun) |
| Payments + cash + installments + credit + ageing | PAY-01…11, CTL-01…04, 17 | integer paisa; two-party handover; deposits; intraday cash cap; receipts (SMS first, WhatsApp adapter stubbed) |
| Vault: suppliers (encrypted), POs, goods receipts → public movements, documents, grants, access log | VLT-01…07, doc 07 | H-01/H-02/H-05: no real supplier data in repo; dummy fixtures only |
| Users, devices, sessions, MFA, approvals, audit | SEC-01…17 | devices bound to rep; pending → approved; revoked = dead |
| Control layer: write-offs, bank-detail lock, balance confirmation, daily digest, offboarding | CTL-06, 11, 15, 16, SEC-06/08 | owner-only governance + AAL2 |
| Offline-first rep PWA: outbox, idempotent sync, encrypted cache, rejection handling | NFR-01…03, P1-09 | IndexedDB, AES-GCM sealing, drain/backoff, sync history |
| Salon portal + invitations + reachability + proposals | SAL-11…14, D-35…36, 39, 41 | one login per salon; office invites; reachability flags |
| Agents: agent role, agent price per SKU, agent purchase (cash-and-carry, paid before release) | AGT-01…06, D-15…17 | no recruitment pay (A-06) |
| Public shop (khsalon.com): plans A–F | D-51…61 | default price shown publicly; portal link to salon orders |
| Overviews and reports: receivables ageing, commissions, scorecard, funnel, margin | RPT-01…05, P1-26 | calculated on the page, not stored |
| Administration: company profile, rep profile, config (installment templates, credit rules, product groups, cycles, visit outcomes) | ADM-01…02, FLD-01 | owner-only config |

---

## 4. Frontend — apps/web

- **Rep PWA** (`/app/*`): Today (my salons → due lists), bag load, order
  creation/delivery, payments (collation + cash), inventory at bag, outbox
  (P1-09: queue, drain, backoff, history), close day, account, settings.
  Offline-first: encrypted IndexedDB cache, server-side rejection after
  sync shown to the rep (NFR-01).
- **Office** (`/office/*`): home (receivables ageing), orders+deliveries,
  payments (collections, handover, deposits, cash cap), inventory, people
  (reps/salons/agents), vault, approvals, controls, admin, invoices/
  receipts view.
- **Salon portal** (`/salon`): catalogue + trade prices, order requests,
  documents; one login per salon; invite/suspend/revoke (D-39).
- **Public shop** (`/khsalon.com`, plans A–F): catalogue data, visitor
  read functions, shopify link plan F, SEO, tracking registry.
- **Lib**: `proxy.ts` (auth + account check), `outbox/` (queue, store,
  drain, types), `e2e-stack/` (local stack helpers), Playwright specs
  (rep journeys, office journeys).

---

## 5. Tests and verification

- **`supabase/tests/`** — Vitest + `pg` against an embedded Postgres
  (env `KIRAN_TEST_DATABASE_URL` → `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, en_US.UTF-8). Files: schema-hygiene, rls-matrix, function-gates,
  append-only-sweep, audit-fixes, launch-acceptance, device-guard,
  foundation, reconciliations…, etc. Run in file-name order.
- **`apps/web/e2e` + `e2e-stack`** — Playwright rep/office journeys;
  real local stack, no mocks; stack tests are the first real run; e2e on
  low-end phone profile.
- **Docs**: `docs/plans/` in-progress plans; `docs/runbooks/` owner
  bootstrap, launch security acceptance, offboarding, restore drill…
- **CI**: five jobs + policy gate; `pnpm activity:check` enforces the log
  rules on `docs/log/` (Appendix C of ACTIVITY.md).

---

## 6. Where each area stands (status board, ACTIVITY.md §12 — the only place a task's status lives)

| Status | Area | Detail |
|---|---|---|
| VERIFIED | Foundation (P1-01) | roles, devices, audit chain, approvals, RLS helpers (L-0116) |
| VERIFIED | Inventory (P1-04), due-lists/routes (P1-16) | migrations + tests done |
| VERIFIED | Config (P0-08), protocol (P0-09) | doc 09/10/13 defaults + AGENTS/CLAUDE + preflight |
| VERIFIED | Invitations/salons slice 1 (P1-18) | PR 56, merged, awaiting independent check |
| VERIFIED | Catalogues slice 2 (P1-19) | PR 57 + PR 71 |
| VERIFIED | Investors ledger slice 3 (P1-20) | PR 58 |
| VERIFIED | Delivery approval slice 4 (P1-21) | PR 59 |
| VERIFIED | Commission slice 5 (P1-22) | PR 61 |
| VERIFIED | Salon portal slice 6 (P1-23) | PR 63 |
| VERIFIED | Rep read-only + timelines slice 7 (P1-24) | PR 64 |
| VERIFIED | Office ops slice 8 (P1-25) | PR 65 |
| VERIFIED | Overviews slice 9 (P1-26) | PR 66 |
| VERIFIED | Office shell + invoice/receipt views slice 10 (P1-28) | PR 68 |
| VERIFIED | Invoice composer (P1-31) | PR 68 |
| VERIFIED | Routes+stock leftovers slice 11 (P1-29) | PR 69 |
| VERIFIED | Audit fixes + screens package 2 (P1-30) | PR 70 |
| IN PROGRESS | Territories/salons/stages (P1-02) | part a, b, 3, 4 done self-reported; parts c, d pending; re-verification of L-0282 |
| IN PROGRESS | Orders/invoices (P1-06) | parts a, b, c done; ORD-07 dated price lists (P2), offline order creation (P1-09) open; sales-call rework PR A/B/C awaiting independent check |
| IN PROGRESS | Payments/cash (P1-07) | ageing, account/receivables screens, two-party handover, office cash collection done; deposits pending |
| IN PROGRESS | Offline outbox core (P1-09) | outbox core merged PR 103 (8b80918); store-idb/index untested; plan task 1 waits MJ's 48 h window |
| IN PROGRESS | Security acceptance suite (P1-12) | branch `claude/p1-12-acceptance-guards`: plan + launch acceptance tests + function gates + append-only sweep; awaiting independent check; missing: vault REST tests, audit-hash/ mirrored tests, offboarding rehearsal, restore-drill runbook + CI scan gate |
| NOT STARTED | Vault (P1-05), control layer (P1-08), owner dashboard (P1-10), admin (P1-11), security acceptance suite final (P1-12), pilot (P1-13), gate 1 (P1-14) | blockers B-01…B-61 (MJ decisions) apply |
| NOT STARTED (but gated) | Phase 2 (P2-01…10) | gate 1 must be ACCEPTED by MJ first |

---

## 7. The map of how it all connects

1. **Auth → devices/sessions** (SEC-03) decide what the rep can call.
2. **Rooms → salons → contacts → stages** (SAL/PIP/MAP) feed the **due
   list/route** (P1-16) and **bag** (INV + P1-29).
3. **Bag → orders** (ORD) → **price list + credit gate** → **deliveries**
   (with salon acknowledgment, D-49) → **invoices** (gapless, per delivery).
4. **Invoices → payments/cash** (PAY) → **ledger + ageing** → **credit
   events** → **digest** (CTL-17) and **ageing screen** (P1-10).
5. **Vault** (VLT) bridges to public **movements**; documents render from
   DB templates; no vault field reaches clients without grant+AAL2.
6. **Offline** (outbox NFR-01) is the phone's own queue over the same
   functions, AES-GCM sealed, synced idempotent; server rejects and client
   shows it.
7. **Approvals** (SEC-11, maker ≠ checker) gate discounts, returns,
   reversals, write-offs; owner-only for governance.
8. **Audit** (H-17) records every business write from the session; hash
   chain verifies; mirror nightly.
9. **CI** (ci.yml + activity-log-check + service-role-scan) gates every
   PR; `pnpm agent:preflight` is the local gate before implementation.

---

## 8. Continuing work — where the board stands and the immediate next step

Current branch: `claude/p1-12-acceptance-guards` (security acceptance
suite for doc 06 §10). The suite has the launch-acceptance + function-gates
+ append-only-sweep tests; it is missing the vault, audit-chain, offboarding
and backup-restore checks and the CI scan gate. Completion of P1-12 is the
immediate, unblocked piece of work on this branch; after that, the natural
next areas are the still-unstarted board rows: **vault (P1-05)**, **control
layer (P1-08)**, **owner dashboard (P1-10)**, **admin (P1-11)**, **pilot
(P1-13)** — all gated behind MJ decisions (B-01…B-61) or Gate 1.

Everything above is a map of docs, not a claim of work done. What is claimed
as done is recorded in `docs/log/` with commands, real results and commit
SHAs.
