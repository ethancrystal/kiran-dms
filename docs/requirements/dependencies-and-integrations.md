# Dependencies and integration requirements

Derived reference (see [README.md](README.md)). Every third-party service is reached only through an adapter, and no new processor of salon or supplier data is added without MJ's approval (H-21). Spend and vendor sign-ups are MJ's (ACTIVITY §9, §10).

## 1. Platform

| Dependency | Purpose | State | Evidence | Open |
|---|---|---|---|---|
| Supabase (Postgres, Auth, Storage) | Database, RLS, auth, buckets | Project `kiran` is staging (B-12); migrations applied there only with MJ's approval | ACTIVITY B-12; log 2026-11-10-mj-railway-deploy | Production project not created |
| Hosting | Next.js app | Running on Railway; the planning set still says Vercel | log 2026-11-10-mj-railway-deploy; D-05 | DA-018 |
| GitHub Actions | Seven required checks | Active; ruleset on `main` (B-13) | `.github/workflows/ci.yml`, `agent-compliance.yml` | — |
| Embedded Postgres and local Supabase stack | Database tests and browser tests in CI | Active | `pnpm db:test`; CI jobs | — |

## 2. Integrations (all behind adapters)

| Integration | Needed by | State | Blocker |
|---|---|---|---|
| SMS sender | CTL-01 receipts, CTL-09 verification, CTL-18 phone change, MSG-01 | Not chosen | B-08 |
| WhatsApp Business | CTL-01, CTL-15 digest, MSG-01, MSG-02 | Not chosen | B-08 |
| E-mail service | Reminders (P1-38), invitations (auth e-mail) | Reminder sender not chosen | B-61 |
| Maps and places | MAP-01 to MAP-13, P1-03 | Not chosen; H-21 approval needed | — |
| Shopify | Storefront checkout (P1-37) | Store existence and terms open | B-56, B-57 |
| Error tracking | NFR-11 | Not chosen; must not capture vault screens or phones (H-21) | — |
| Off-site backup storage | SEC-10, NFR-10 | Not created; human-only (ACTIVITY §10) | — |

## 3. Business inputs the build depends on

| Input | Needed by | Blocker |
|---|---|---|
| Real Excel of salons, balances, prices | SAL-10 import, pilot | B-02 |
| Owner account and continuity | P0-05, Gate 0 | B-03 |
| Installment shapes and credit limits | PAY-01, SAL-04 | B-05 |
| Company bank accounts | invoices, CTL-16 | B-06 |
| Pilot territory and rep | P1-13 | B-09 |
| Real product catalogue | INV-01, P1-34 | B-10 (dummy data meanwhile: MJ, 2026-11-19, PR 115, not merged; docs not amended) |
| Investor arrangements | CAP beyond the basic ledger | OQ-23 to OQ-30 |
