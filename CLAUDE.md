# Kiran DMS — READ THIS FIRST

## Mandatory agent compliance protocol

Before ANY repository work, every agent MUST read `docs/AGENT-COMPLIANCE-PROTOCOL.md` in full and follow it, in addition to reading `docs/ACTIVITY.md` in full. Do not treat a session-start hook or preflight result as a substitute for the required source-document review, session log, or task claim.

Run `pnpm agent:preflight` before implementation. Do not work directly on `main`. Preserve all pre-existing changes. A failed preflight is a stop condition; do not bypass it.

The authoritative task lifecycle, hard rules, status board, claims, blockers, phase gates, evidence format, and handoff requirements remain in `docs/ACTIVITY.md`. If instructions conflict, follow its authority hierarchy and stop/log a blocker rather than guessing.

**Cross-domain brief:** For work involving supplier/procurement, salons/customers, salaried Reps, Independent Agents, Investors/capital, office administration, or workflows spanning these areas, read `docs/14-unified-business-domain-prompt.md` in full before planning or editing. It supplements the existing planning set; it does not authorise a new role, permission, portal, financial term, phase change or production action.

Before doing ANYTHING in this repository you MUST:
1. Read docs/ACTIVITY.md in full (rules, status board, claims, blockers, log).
2. Log a SESSION-START entry, claim your task, and follow every hard rule (H-01…H-27).
3. Never touch production, secrets, real supplier data, or real personal data.
4. Never weaken or skip a security control (RLS, MFA, approvals, audit, append-only).
5. Log your results with real evidence and end with a HANDOFF entry.

Work without a log entry is treated as not done and may be reverted.
Unclear, conflicting, or needs a decision? STOP that task and log a BLOCKER for MJ.

---

## Repository map

| Path | What |
|---|---|
| `docs/` | The planning set (`00`–`14`), `ACTIVITY.md` (build protocol + live log), `diagrams/`. Source of truth. |
| `supabase/migrations/` | Forward-only SQL migrations: schemas, tables, RLS, SECURITY DEFINER functions, triggers. |
| `supabase/tests/` | RLS matrix and invariant tests (Vitest + `pg`), run against a throwaway Postgres. |
| `supabase/config.toml` | Supabase CLI config (API schemas, auth: TOTP for office, email one-time code for reps). |
| `apps/web/` | Next.js app: `/app` (rep PWA) and `/office` (owner/manager). |
| `packages/shared/` | **Planned, not built yet** (first needed by the offline PWA, P1-09; P1-02 parts a and b shipped without it): types generated from the DB, validation schemas, i18n strings (en, ur). Today the import normalisers live in `packages/import/src/core/`. |
| `packages/import/` | Excel/CSV salon import dry-run (P0-02); writes nothing to any database. |
| `SPEC.md` | Entry-point index: objective, journeys, feature map, code style, boundaries. The docs win on any disagreement. |
| `biome.jsonc`, `.github/workflows/ci.yml` | Lint and format config (with the legacy list) and the five CI jobs. |
| `scripts/` | CI helpers, incl. `activity-log-check.mjs` (ACTIVITY.md Appendix C). |

## Commands

```bash
pnpm install
pnpm db:test          # applies all migrations to a fresh embedded Postgres and runs the RLS/invariant suite
pnpm db:test -- -t "name"   # single test
pnpm activity:check   # same check CI runs on docs/ACTIVITY.md
pnpm -C apps/web dev  # Next.js dev server
pnpm typecheck
pnpm lint             # Biome lint + format check (same as CI); `pnpm format` writes fixes
pnpm -C apps/web test:e2e   # Playwright rep PWA tests on a low-end phone profile (builds the app first)
```

`KIRAN_TEST_DATABASE_URL` (never the generic `DATABASE_URL`) overrides the embedded Postgres (e.g. `supabase start` → `postgresql://postgres:postgres@127.0.0.1:54322/postgres`). Create that database with the en_US.UTF-8 collation; test files share it and run in file-name order (SPEC.md §6).

## Database conventions (from docs 04, 06, 07, ACTIVITY §5)

- Schemas: `public` (RLS-scoped business data), `control` (approvals, audit, anomalies, phone-reveal log), `supplier_vault` (classified supplier data; **not** exposed via PostgREST), `vault_api` (grant-checked functions), `app` (RPC write path + helpers). Supabase's own `vault` schema (supabase_vault) is why the supplier schema is named `supplier_vault` — see doc 12, D-13.
- Every table: `enable row level security` + `force row level security` in the same migration; deny by default.
- Money/stock/stage/credit/approval writes only via `security definer` functions in `app.*` with `set search_path = ''`, idempotency `client_id`, role + device + rep_day checks.
- Append-only tables (doc 04 invariant 1): INSERT + SELECT only; a trigger also raises on UPDATE/DELETE.
- Audit: triggers write `control.audit_event` with a sha256 hash chain. No application role may write it.
- Money in integer paisa (`bigint`), never floats. Column suffix `_paisa`.
- Server time authoritative (`now()`); client timestamps in `*_client` columns.
