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

## Agent skills

These files configure the engineering skills (Matt Pocock's skills plugin). They are reference material: they never override this file, `docs/AGENT-COMPLIANCE-PROTOCOL.md` or `docs/ACTIVITY.md` (claims, status lifecycle, blockers, hard rules).

### Issue tracker

Linear, workspace `kiran`, team Kiran (`KIR`); GitHub holds code and pull requests only. No supplier, cost or personal data in tickets (H-01 to H-03). See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context: `CONTEXT-MAP.md` at the root (seven contexts plus the shared kernel), one `docs/contexts/<name>/CONTEXT.md` per context, created lazily. See `docs/agents/domain.md`.

## Database conventions (from docs 04, 06, 07, ACTIVITY §5)

- Schemas: `public` (RLS-scoped business data), `control` (approvals, audit, anomalies, phone-reveal log), `supplier_vault` (classified supplier data; **not** exposed via PostgREST), `vault_api` (grant-checked functions), `app` (RPC write path + helpers). Supabase's own `vault` schema (supabase_vault) is why the supplier schema is named `supplier_vault` — see doc 12, D-13.
- Every table: `enable row level security` + `force row level security` in the same migration; deny by default.
- Money/stock/stage/credit/approval writes only via `security definer` functions in `app.*` with `set search_path = ''`, idempotency `client_id`, role + device + rep_day checks.
- Append-only tables (doc 04 invariant 1): INSERT + SELECT only; a trigger also raises on UPDATE/DELETE.
- Audit: triggers write `control.audit_event` with a sha256 hash chain. No application role may write it.
- Money in integer paisa (`bigint`), never floats. Column suffix `_paisa`.
- Server time authoritative (`now()`); client timestamps in `*_client` columns.

## Master execution prompt: standing rules (MJ, 2026-11-01)

Full text: `docs/audit-2026-10-31/master-prompt-2026-11-01.md`. Work order and slices: `docs/audit-2026-10-31/execution-map.md`. These rules add to `docs/ACTIVITY.md`; where they seem to differ, ACTIVITY.md and its hard rules win, and the difference is logged as a BLOCKER for MJ.

- **Working beats looking finished.** A page, component, endpoint, table, migration, passing typecheck, build, test file, mocked test or a DONE line is not proof. A feature is done only when the business operation works end to end and meets its acceptance criteria.
- **Vertical slices, in dependency order.** Each slice connects frontend → backend → auth → authorization → validation → database → integrity → audit → visible result → automated tests. Settle the data model, permissions and RPC contract before the screen.
- **Status words, used exactly:** NOT STARTED, PARTIALLY IMPLEMENTED, IMPLEMENTED — NOT VERIFIED, VERIFIED, BLOCKED, DEFERRED — FUTURE PHASE. Builders never mark VERIFIED (ACTIVITY §7). Skipped tests and unavailable environments are blockers, not passes.
- **Evidence for every claim:** source paths, migration versions, functions, routes, policies, test names, the exact command, the real result, the commit SHA. Say plainly what was not run.
- **Scope:** Phase 1 only (H-22). Phase 2 and 3 work stays deferred unless a Phase 1 requirement truly depends on it; record the dependency, do not build the feature.
- **Change control:** check git status and the branch first; read a file right before editing it; leave other people's uncommitted work alone; never force-push, reset others' changes, or stage the whole tree blindly. One coherent commit per fix or slice.
- **Environments:** production is never touched. Destructive testing only on a local Supabase stack. Staging checks are read-only unless MJ approved the exact change (H-19); never guess the staging project from a variable name. A migration file in the repo does not mean it is applied anywhere.
- **Security in every slice, not at the end:** RLS for SELECT, INSERT, UPDATE and DELETE tested as real signed-in roles (not as the database owner); changing an id in a URL or payload must never widen access; the server validates everything; the actor in audit records comes from the session, never from the client. Negative tests for each major operation: anonymous, wrong role, other territory or office, bad input, missing reference, duplicate and replayed requests, no partial writes.
- **Real-backend CI:** full-stack checks run Playwright against a real local Supabase stack (migrations applied, database tests run, synthetic fixtures). They must fail loudly if the stack does not start; no silent fallback to mocks. A frontend-only pass does not count.
- **Frontend:** no hardcoded figures, static arrays, fake success messages or dead buttons in a delivered workflow. Show the database's real result and errors; data must survive a reload; hide what a role may not do, but the database is the security boundary.
- **Final report** after a run of work: summary, baseline, results per priority, CI, security, commits, remaining work, and exactly one of PHASE 1 VERIFIED COMPLETE, PARTIALLY COMPLETE, BLOCKED or NOT COMPLETE, with the reason.
