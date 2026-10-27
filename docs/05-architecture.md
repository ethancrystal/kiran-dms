# 05 — Architecture

## Build vs. buy, briefly

Off-the-shelf options exist (generic CRMs, open-source ERPs such as ERPNext/Odoo, FMCG "DMS" products). None of them gives, out of the box, the combination Kiran needs: a sealed supplier compartment enforced in the database, two-party cash custody with daily zero-variance reconciliation, installment plans with credit gating at the point of sale, an offline-first Urdu-friendly rep app, and a pipeline engine driven by salon re-order cycles. Bolting those onto a generic ERP costs more than building a focused system — and MJ is the developer. Decision: **build**, on a managed Postgres platform so that security primitives (auth, RLS, storage policies, backups) are inherited rather than hand-rolled. Accounting stays out of scope; exports feed an accountant or, later, an accounting package.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Database | **Supabase Postgres** (managed), region: closest low-latency option to Karachi (Mumbai `ap-south-1` or Singapore `ap-southeast-1`) | Row-level security, triggers, `pg_cron`, `pgsodium`/`vault` for secrets, PITR backups, Postgres everything |
| Auth | **Supabase Auth** — email+password+TOTP for owner/manager; email one-time code for reps (ACTIVITY L-0101; was phone OTP); custom claims for role via a `user_profile` lookup | Managed, supports MFA (AAL2) enforcement in RLS, session control |
| API | **PostgREST via Supabase client** for ordinary CRUD under RLS; **Postgres functions (RPC)** for every money/stock/stage mutation and all vault access; **Edge Functions** (Deno) for integrations (WhatsApp, SMS, PDF) and scheduled jobs | Business rules live in the database where RLS and triggers can enforce them; the client is never trusted |
| Web apps | **Next.js (App Router), TypeScript**, one codebase, two surfaces: `/app` (rep PWA) and `/office` (owner/manager) | Shared types, server components for the office, PWA for the field |
| Rep offline layer | **IndexedDB** (Dexie) + an **outbox** of mutations with idempotency keys; service worker for shell caching; background sync when online | Field reality: basements, dense markets, 3G |
| Storage | **Supabase Storage** buckets: `salon-media` (frontage photos, visit photos), `receipts` (PDF/images), `slips` (bank slips), `vault-docs` (private, owner/manager), `exports` (watermarked, short-lived) | Bucket policies mirror RLS |
| Messaging | WhatsApp Business Platform through a Business Solution Provider; SMS fallback via a Pakistani gateway (branded sender). Provider-agnostic adapter; templates pre-approved | Receipts and reminders are a control, not a nicety |
| Maps, geocoding, places | Map tiles + geocoding + **places/nearby search** behind one adapter. Google Maps Platform (Places API "Nearby Search" + "Text Search") is the default because its coverage of Karachi salons and parlors is the broadest; Mapbox/OSM remain an option for tiles | Territory map, drop-a-pin prospecting, one-tap nearby discovery, geofence distance, route ordering |
| PDF | Server-side HTML→PDF in an Edge Function or a small Node service | Invoices, receipts, statements, watermarked exports |
| Hosting | **Vercel** for Next.js; Supabase for everything else | Minimal ops |
| Observability | Sentry (errors), Supabase logs, a `sync_failure` table surfaced in the office app, uptime monitor | NFR-11 |
| CI/CD | GitHub → Vercel preview deployments; Supabase migrations via CLI in CI; RLS policy tests run on every PR against a shadow database | NFR-12 |

### What runs where

```
┌──────────────────────── Rep phone (PWA) ───────────────────────┐
│ Next.js client · IndexedDB cache + outbox · service worker     │
│ Reads: RLS-filtered views (own territories, masked phones)     │
│ Writes: RPC calls (create_visit, create_order, record_payment) │
└───────────────┬────────────────────────────────────────────────┘
                │ HTTPS (anon key + user JWT; AAL/device checked)
┌───────────────▼─────────────── Supabase ───────────────────────┐
│ Auth ─ Postgres (public / control / vault schemas) ─ Storage   │
│   RLS on every table · triggers → audit_event (hash chain)     │
│   RPC functions = the only write path for money/stock/stage    │
│   pg_cron: nightly integrity, anomalies, digest, cycle recompute│
│ Edge Functions: whatsapp-send · sms-send · pdf-render ·        │
│   bank-csv-import · export-watermark · digest-dispatch         │
└───────────────┬────────────────────────────────────────────────┘
                │
┌───────────────▼──────────── Office web (Vercel) ───────────────┐
│ Next.js server components · owner/manager dashboards · approvals│
│ vault screens (grantees only, AAL2 session required)           │
└────────────────────────────────────────────────────────────────┘
```

## Key design rules

1. **The client is never trusted.** Prices, credit checks, stock availability, stage transitions, numbering, timestamps — all computed in Postgres functions. The client sends intent (`record_payment(salon, amount, method, …)`), the database decides.
2. **RLS on every table, deny by default.** Policies are written per role per table and tested automatically (doc 06). Reps' policies are scoped by `rep_territory`. Service-role keys exist only in Edge Functions and CI, never in a browser.
3. **One write path for sensitive data.** Direct `INSERT`s on money, stock and stage tables are revoked from application roles; only `SECURITY DEFINER` functions (with explicit role checks and `search_path` pinned) insert. This is what makes "append-only" and "maker ≠ checker" real.
4. **Vault isolation** (doc 07): separate schema, not exposed via PostgREST, column encryption, function-only access, separate access log.
5. **Idempotent mutations.** Every offline-captured mutation carries a client-generated UUID; the RPC is idempotent on it, so retries after flaky sync never double-record a payment or an order.
6. **Server time is truth; client time is evidence.** Both stored. Large gaps are an anomaly signal.
7. **Everything a rep sees is a view**, not a base table: phones masked, page size capped (50), no `select *` on salons across territories, no export endpoints.

## Offline-first design for the rep app

| Concern | Approach |
|---|---|
| What is cached | Today's route, the rep's salons (own territories), SKU list and prices, own bag stock, own cash position, open installments for own salons. Refreshed on each sync; stale after 24 h → read-only banner |
| Capturing offline | Visits, orders, payments, prospects go into an **outbox** with `client_id`, `captured_at_client`, GPS fix, device id |
| Syncing | On connectivity: outbox replays in order; each RPC returns `accepted` / `rejected(reason)`; rejected items stay visible to the rep with the reason (e.g., credit check failed on reconnect) and create a manager task |
| Conflicts | Server rules win. Example: an offline order that breaches credit limit once synced becomes `draft` + approval request; the rep is told before delivering |
| Receipts offline | Receipt number is allocated **on sync**, not on device; the rep shows a "pending receipt — will be sent to salon's WhatsApp within minutes of signal" screen. Paper receipts are never issued. (Doc 13 explains why this is a control, not a limitation) |
| Stock offline | Deliveries from bag are allowed offline against cached bag stock; the server re-validates; negative stock on sync is a hard anomaly |
| Security offline | Cached data encrypted at rest with a key held in memory for the session; cache wiped on logout, device revocation (next contact), or 7 days without sync |

## Integrations

| Integration | Direction | Used for | Notes |
|---|---|---|---|
| WhatsApp Business Platform (via BSP) | Out (templates), In (replies) | Receipts, statements, pre-due reminders, reorder nudges, balance confirmations, owner digest | Template approval lead time ~ days; opt-in per salon recorded |
| SMS gateway (PK) | Out | Fallback for receipts/reminders when WhatsApp fails | Branded sender ID registration required |
| Bank statements | In (CSV upload) | Matching transfers and deposits | No live bank API assumed; manual CSV from internet banking |
| Maps / geocoding / places | Out | Salon pins, distances, territory drawing, route ordering, **nearby discovery** of salons/parlors/barbers/hair studios around the rep's live position | Adapter so the provider can change. Discovery runs server-side (Edge Function) so the API key never ships to the phone; results cached per area 30 days; query terms configurable (incl. "parlour/parlor/saloon/beauty/hair/bridal"). Keep provider terms of service in mind: store the fields they allow, show attribution |
| Email | Out | Owner digest copy, exports, MFA recovery | Resend or similar |
| Accounting export | Out (files) | Monthly pack for the accountant | CSV/XLSX; a direct ERPNext/QuickBooks connector is a later option |

### Nearby discovery — how it works

1. Rep taps *Find salons near me*. The app sends its current GPS fix (required; a typed address is refused) and the chosen radius (default 3 km, max 6 km).
2. An Edge Function calls the places provider with a set of category/keyword queries (beauty salon, hair salon, barber, beauty parlour, bridal studio, hair studio, spa, beauty academy, plus Urdu/Roman-Urdu spellings), merges and de-duplicates results, drops anything clearly irrelevant (nail-only, massage-only), and writes `discovered_place` rows plus one `discovery_run`.
3. Results come back as grey pins. The rep converts the useful ones to prospects; the dedupe check against existing salons runs on conversion.
4. Pins outside the rep's territories are assigned to the right territory automatically (point-in-polygon on area boundaries) and the manager is notified.

### Routing

Route ordering from the rep's position is a travelling-salesman-style problem on ≤ 20 stops; a nearest-neighbour pass with 2-opt improvement on straight-line distance is good enough and runs on the phone, offline. A road-distance matrix from the maps provider can be added later for bike routing; the adapter leaves room for it.

## Scheduled jobs (`pg_cron` + Edge Functions)

| Job | Schedule | Purpose |
|---|---|---|
| `recompute_cycles` | nightly 01:00 PKT | Cycle estimates and `next_due_at` per salon × product group |
| `generate_tasks` | nightly 01:30 | Reorder-due, collection-due, at-risk, win-back tasks for the coming day |
| `age_receivables` | nightly 02:00 | Installment statuses, overdue days, auto-block at thresholds, escalation tasks |
| `integrity_check` | nightly 02:30 | Recompute balances and stock from movements; compare with cached values; flag drift |
| `anomaly_scan` | nightly 03:00 | Doc 13 §7 detectors → `anomaly_flag` |
| `owner_digest` | daily 07:00 | Compose and send the exception digest |
| `balance_confirm_sample` | weekly Mon 07:00 | Pick salons per rep for confirmation calls |
| `restock_suggestion` | weekly Sat 20:00 | Doc 10 suggestions |
| `audit_mirror` | nightly 04:00 | Export new `audit_event` rows to owner-controlled write-only storage; verify hash chain |
| `cache_expiry` | continuous | Revoke stale device sessions, expire signed URLs |

## Environments

| Env | Purpose | Data |
|---|---|---|
| `local` | Development with Supabase CLI | Synthetic |
| `staging` | Preview deployments, RLS tests, UAT with the manager | Anonymised copy (vault tables replaced with dummies) |
| `production` | Live | Real; PITR on; MFA enforced |

Migrations are forward-only, reviewed, and applied by CI. No one runs SQL by hand in production except through a logged break-glass procedure (doc 06).

## Capacity and cost at launch

Assume ≤ 10 reps, ≤ 3,000 salons, ~300 visits/day, ~150 payments/day, ~50 orders/day. That is tiny for Postgres. Expected monthly cost: Supabase Pro (~$25) + Vercel Hobby/Pro ($0–20) + WhatsApp conversation fees (~$0.01–0.05 per message; a few dollars at this scale) + SMS fallback (a few dollars) + maps (free tier) ≈ **$40–60/month**. The cost that matters is the owner's and manager's time running controls, not infrastructure.

## Repository layout (proposed)

```
kiran-dms/
  apps/web/                 Next.js (routes: /app for reps, /office for owner/manager)
  packages/db/              SQL migrations, RLS policies, functions, seed, policy tests
  packages/shared/          Types (generated from DB), validation schemas, i18n strings (en, ur)
  supabase/functions/       Edge functions: whatsapp, sms, pdf, bank-import, digest, export
  docs/                     This planning set
```
