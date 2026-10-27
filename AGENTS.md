# Kiran DMS — READ THIS FIRST

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
| `docs/` | The planning set (`00`–`13`) and `ACTIVITY.md` (build protocol + live log). Source of truth. |
| `supabase/migrations/` | Forward-only SQL migrations: schemas, tables, RLS, SECURITY DEFINER functions, triggers. |
| `supabase/tests/` | RLS matrix and invariant tests (Vitest + `pg`), run against a throwaway Postgres. |
| `supabase/config.toml` | Supabase CLI config (API schemas, auth: TOTP for office, email one-time code for reps). |
| `apps/web/` | Next.js app: `/app` (rep PWA) and `/office` (owner/manager). |
| `packages/shared/` | Types generated from the DB, validation schemas, i18n strings (en, ur). |
| `scripts/` | CI helpers, incl. `activity-log-check.mjs` (ACTIVITY.md Appendix C). |

## Commands

```bash
pnpm install
pnpm db:test          # applies all migrations to a fresh embedded Postgres and runs the RLS/invariant suite
pnpm db:test -- -t "name"   # single test
pnpm activity:check   # same check CI runs on docs/ACTIVITY.md
pnpm -C apps/web dev  # Next.js dev server
pnpm typecheck
```

`KIRAN_TEST_DATABASE_URL` (never the generic `DATABASE_URL`) overrides the embedded Postgres (e.g. `supabase start` → `postgresql://postgres:postgres@127.0.0.1:54322/postgres`).

## Database conventions (from docs 04, 06, 07, ACTIVITY §5)

- Schemas: `public` (RLS-scoped business data), `control` (approvals, audit, anomalies), `supplier_vault` (classified supplier data; **not** exposed via PostgREST), `vault_api` (grant-checked functions), `app` (RPC write path + helpers). Supabase's own `vault` schema (supabase_vault) is why the supplier schema is named `supplier_vault` — see doc 12, D-13.
- Every table: `enable row level security` + `force row level security` in the same migration; deny by default.
- Money/stock/stage/credit/approval writes only via `security definer` functions in `app.*` with `set search_path = ''`, idempotency `client_id`, role + device + rep_day checks.
- Append-only tables (doc 04 invariant 1): INSERT + SELECT only; a trigger also raises on UPDATE/DELETE.
- Audit: triggers write `control.audit_event` with a sha256 hash chain. No application role may write it.
- Money in integer paisa (`bigint`), never floats. Column suffix `_paisa`.
- Server time authoritative (`now()`); client timestamps in `*_client` columns.
