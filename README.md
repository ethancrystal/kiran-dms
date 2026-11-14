# Kiran DMS

A Distribution Management System for **Kiran Company**, a Karachi hair-styling and hair-care distributor. It replaces Excel, cash and memory with a coordinated web app over one PostgreSQL database (row-level security throughout): a mobile-first representative PWA, an authenticated salon customer portal, and an office workspace for the owner/manager.

Representatives visit salons, capture GPS-stamped visits, submit order requests, deliver stock and collect payments. Salons submit their own order requests and track them through the portal. The office reviews both in one queue and creates the official orders. Supplier identity and cost data stay in a sealed "vault" compartment, invisible outside the owner/manager.

## Start here — before touching anything

This repository runs under a mandatory build protocol. **Read it first:**

1. [`AGENTS.md`](AGENTS.md) / [`CLAUDE.md`](CLAUDE.md) — the entry point every agent (AI or human) must read first.
2. [`docs/ACTIVITY.md`](docs/ACTIVITY.md) — the actual rulebook: hard rules, status board, blockers, definition of done, phase gates.
3. The 20 newest entries in [`docs/log/`](docs/log/) — the append-only record of what's in progress (`docs/log/archive.md` is the frozen old log; search it only for an old `L-nnnn` citation).

Work done without a log entry in `docs/log/` is treated as not done and may be reverted.

## What's in this repo

| Path | What |
|---|---|
| [`docs/`](docs/) | The planning set (`00`–`16`; doc 16 is the authoritative business spec), `ACTIVITY.md` (build protocol + live status), `log/` (append-only task log), `diagrams/`. Source of truth. |
| [`SPEC.md`](SPEC.md) | Short entry-point index: objective, journeys, feature map, code style, boundaries. The docs win on any disagreement. |
| [`supabase/migrations/`](supabase/migrations/) | Forward-only SQL migrations: schemas, tables, RLS, `SECURITY DEFINER` functions, triggers. |
| [`supabase/tests/`](supabase/tests/) | RLS matrix and invariant tests (Vitest + `pg`), run against a throwaway Postgres. |
| [`apps/web/`](apps/web/) | Next.js app: `/app` (rep PWA), `/office` (owner/manager), `/salon` (salon account page), `/invite/[token]` (the only page that creates a login). |
| [`packages/import/`](packages/import/) | Excel/CSV salon import dry-run; writes nothing to any database. |
| [`packages/shared/`](packages/shared/) | Planned, not built yet — types generated from the DB, validation schemas. |
| [`CONTEXT-MAP.md`](CONTEXT-MAP.md) | The seven business contexts plus the shared kernel, each with its own `docs/contexts/<name>/CONTEXT.md`. |
| [`biome.jsonc`](biome.jsonc), [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Lint/format config and the CI jobs. |
| [`scripts/`](scripts/) | CI helpers, including the activity-log check that enforces the protocol above. |

## Commands

```bash
pnpm install
pnpm agent:preflight   # mandatory before any implementation work on a feature branch
pnpm db:test            # applies all migrations to a fresh embedded Postgres, runs the RLS/invariant suite
pnpm activity:check     # the same check CI runs on docs/ACTIVITY.md and docs/log/
pnpm -C apps/web dev    # Next.js dev server
pnpm typecheck
pnpm lint               # Biome lint + format check (same as CI); `pnpm format` writes fixes
pnpm -C apps/web test:e2e   # Playwright rep PWA tests
```

This is a pnpm workspace — never use npm, yarn or bun here, and never commit `package-lock.json`, `yarn.lock` or `bun.lock`.

## Status

Live build status, the phase-gate record, and every open blocker live in [`docs/ACTIVITY.md`](docs/ACTIVITY.md) §12–§15 — that board is the only place that states a task's status. This README does not restate it, since that would just go stale.
