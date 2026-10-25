# Kiran DMS — Independent end-to-end check, 2026-10-25 19:40–19:55 PKT

**Tester:** Claude (Fable 5.1), a session separate from the builder session `ee095e06`. Read-only on the repo (`C:\Users\moizjmj\K`, branch `feat/p0-foundation`, HEAD `c9d830e`); all commands ran on a throwaway copy with Linux dependencies. **No log entry was appended to `docs/ACTIVITY.md`**: the builder session was actively editing `supabase/tests/reverify3-attacks.test.ts` during the check (file touched at 19:50 PKT) and its header reserves L-0042, so appending would have collided. MJ or the builder session should fold these findings into the log as the next entries.

## Where the build stands

| Layer | State |
|---|---|
| Planning docs `00`–`13`, ACTIVITY protocol | In repo (`docs/`), enforced by `AGENTS.md`/`CLAUDE.md` + CI `activity-log-check` |
| Database foundation (P1-01) | 6 migrations: schemas `public` / `control` / `supplier_vault` / `vault_api` / `app`; `user_profile`, `device`, `app_config`, `approval_request`, hash-chained `audit_event`, gapless `doc_counter`; RLS on all; `SECURITY DEFINER` write path. **DONE (self-reported), re-verification in progress** |
| Config defaults (P0-08), RLS harness (P0-06) | VERIFIED (L-0030) |
| Web app | Login shells only: `/office/login`, `/office/mfa`, `/app/login` (Urdu+English), redirects for unauthenticated users |
| Business features — salons, map, orders, payments, stock, vault UI (P1-02 … P1-11) | **Not started.** There is nothing yet to test as a CRM in the business sense |
| Gate 0 | Not passed. Owner account (human-only) not created: `user_profile` has 0 rows |

## What I ran, and results

| Check | Result |
|---|---|
| `pnpm db:test` — committed suite (6 files: foundation, rls-matrix 281 tests, schema-hygiene, verifier/reverify/reverify2 attack suites) | **391 / 391 passed** on a fresh embedded Postgres |
| `pnpm db:test` — plus the builder's untracked `reverify3-attacks.test.ts` | 395 passed, **2 failed** (see findings F-1, F-2) |
| `pnpm typecheck` (tests + apps/web) | Pass |
| `node scripts/activity-log-check.mjs main HEAD` | OK (41 new entries, 63 changed files) |
| Service-role key in client paths (H-18) | None found |
| `pnpm -C apps/web build` | Pass; 7 routes |
| App routes (production server): `/`→200, `/app`→307 `/app/login`, `/office`→307 `/office/login`, `/office/mfa`→307 `/office/login` | Correct gating |
| Security headers | `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, HSTS preload, `CSP frame-ancestors 'none'` present |
| Staging project `iurvazdyxzlspegygldo` | 6 migrations applied (matches repo); 7 tables, RLS enabled on all; 27 audit rows; security advisors: only the 2 intentional INFO items (`audit_chain_head`, `doc_counter` have no policies — deny-by-default internal tables) |
| Anon-key probe of staging REST (attacker with the public key) | `user_profile`, `device`, `app_config`: 401 permission denied (select and insert). `control.*`, `supplier_vault.*`: 406 schema not exposed. OpenAPI root lists **zero** paths. ✔ |

## Findings

### F-1 — DEFECT (client): after revocation the rep app keeps sending the dead device id
`apps/web/lib/supabase/browser.ts` → `rotateDeviceId()` clears the module-level `client` and localStorage, but `createBrowserClient` from `@supabase/ssr` returns a **cached singleton** (default `isSingleton: true`), so the rebuilt client still carries the old `x-kiran-device` header. The fresh id is never registered; the rep is locked out until a hard reload. The builder's own re-verifier-3 test (`DEFECT CHECK: after rotateDeviceId() the rep client sends the NEW id`) catches it and fails. This contradicts L-0037's claim that the client "queues the fresh id for approval". **Fix direction:** pass `isSingleton: false` to `createBrowserClient` (or build the headers via a `fetch` wrapper that reads `deviceId()` per request), then re-run reverify3. Rule: H-23 (L-0037's ticked checklist was not fully true).

### F-2 — DEFECT (integration): `app` and `vault_api` schemas are not exposed on the hosted staging API
`supabase/config.toml` lists `schemas = ["public", "graphql_public", "app", "vault_api"]`, but that setting only configures the **local** CLI stack. On the hosted project the Data API still exposes only `public, graphql_public`: `POST /rest/v1/rpc/my_session` and `/rpc/register_device` with `Content-Profile: app` return **406 "Invalid schema: app"**. The web app's login and device flow therefore cannot complete against staging, regardless of credentials. L-0037's "authenticated can execute app.register_device" was a database-grant check, not an API check. **Fix direction:** Dashboard → Project Settings → Data API → Exposed schemas: add `app` and `vault_api` (owner action; touches staging config — log it). Keep `control` and `supplier_vault` unexposed (confirmed correct today).

### F-3 — QUESTION: suspended→reactivated rep sees 4 device rows, test expected 2
Re-verifier-3 test "suspend then reactivate…" fails on `visible: 4` vs `2`. Everything security-relevant in that test passed (old id refused before and after; fresh id pending → approved → passes). The extra visible rows are probably the revoked/retired rows of the same rep (own-rows policy), which is not a leak, but the test author should confirm the intended visibility of a rep's own revoked devices.

### F-4 — OBSERVATION: Gate 0 prerequisites that only MJ can do
Owner account + TOTP (§10), branch protection on `main` (B-13), `KIRAN_SENSITIVE_TERMS` secret (B-15a), D-08 and the other Phase 0 answers (B-01…B-11). Until the owner account exists, the office login cannot be exercised end to end.

### F-5 — OBSERVATION: the `node_modules` in the repo folder is Windows-only
Expected (built on Windows); noted only because any Linux/WSL agent must reinstall before `pnpm db:test` (embedded-postgres is platform-specific). Not a defect.

## Bottom line

The foundation is solid where it has been built: every append-only, RLS, maker≠checker, audit-chain and anon-access check I could run holds, on both the local suite and the live staging project. Two defects stand between here and a working login on staging (F-1, F-2), both small. The CRM itself — salons, orders, cash, stock — has not been started; that is P1-02 onward and is correctly blocked behind Gate 0, which needs MJ's human-only steps.

**Suggested next entries for ACTIVITY.md** (by the builder session or MJ): a `CORRECTION` to L-0037 for F-1 and F-2, a `QUESTION` note for F-3, and the Gate 0 human-only checklist (`docs/gate-0-checklist.md`) scheduled with MJ.
