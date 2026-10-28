# Kiran DMS — Spec (index)

This file is the **entry point**, not a second source of truth. The planning set in [`docs/`](docs/00-README.md) (docs 00–13) decides *what* is built, and [`docs/ACTIVITY.md`](docs/ACTIVITY.md) decides *how* it is built. If this file and a doc disagree, the doc wins and this file is wrong. Fix it in the same pull request (H-25). This file never adds a requirement; new ideas go to [doc 12](docs/12-decisions-and-open-questions.md) first.

Decisions D-15 to D-20 (independent agents, lost demand, due-list and bag load in Phase 1) are recorded in [ACTIVITY L-0128](docs/ACTIVITY.md). This spec includes them.

---

## 1. Objective

**Who it is for.** Kiran Company's **sales agents** in Karachi, plus the owner and manager who run them:

| User | What the system does for them | Doc |
|---|---|---|
| **Salaried rep** (door to door, Kiran's stock and cash) | Shows which salons to visit, what is due, and what to carry. Takes orders and collections offline on a cheap Android phone, and proves the rep did the job honestly | [02](docs/02-growth-pipeline.md), [08](docs/08-field-sales-and-rep-controls.md) |
| **Independent agent** (buys stock outright, resells, reports nothing) | Buys cash-and-carry at an agent price and sees their own purchases and the agent catalogue | [08 §10](docs/08-field-sales-and-rep-controls.md), D-15 to D-17 |
| **Owner** | Sees everything from a phone. Holds the governance powers and the supplier secret | [06 §2](docs/06-security-plan.md), [07](docs/07-supplier-confidentiality.md) |
| **Manager** | Full day-to-day operations: stock, cash, territories, approvals below the owner's thresholds | [06 §2](docs/06-security-plan.md), [13 §9](docs/13-anti-fraud-controls.md) |

**The job.** Make it **safe and fast to put more sales agents on the road** ([doc 01](docs/01-business-context.md)) by tracking three things:

- **Salons:** a mapped pipeline with due re-orders.
- **Supply:** stock custody, lost demand and restocking.
- **Money:** the khata, installments and the daily handover.

**Success in 12 months** ([doc 01](docs/01-business-context.md)):
- 3× active salons;
- +50% order frequency;
- stock-outs under 2% of lines;
- over 90% of installments collected on time;
- Rs 0 unexplained handover variance;
- every new rep productive within 2 weeks.

**Scope and order.** Phase 0 is foundations, and Phase 1 is the MVP: the khata, the bag and the controls. Their exit gates and build order are in [doc 11](docs/11-roadmap.md) and ACTIVITY §12. Requirement IDs are in [doc 03](docs/03-requirements.md).

**Non-goals for now:** accounting, payroll, consumer e-commerce and multi-city features ([doc 01](docs/01-business-context.md)).

## 2. Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck                      # every package
pnpm db:test                        # all migrations on a throwaway Postgres + RLS/invariant suite
pnpm db:test -- -t "name"           # one test
pnpm -r --if-present test           # package unit tests (packages/import)
pnpm activity:check                 # the ACTIVITY.md check CI runs
pnpm -C apps/web dev                # web app on :3000 (/app rep PWA, /office)
pnpm -C apps/web build              # production build (CI also scans the bundle, H-18)
pnpm lint                           # Biome lint + format check            (planned, §4)
pnpm -C apps/web test:e2e           # Playwright rep PWA tests             (planned, §5)
```

- **Test database URL:** set `KIRAN_TEST_DATABASE_URL`, never the generic `DATABASE_URL`, to use a real database. For example, `supabase start` gives `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- **Running as root:** embedded Postgres cannot start as root, so point the URL at a fresh local database and recreate it before every run.
- **Staging:** nothing is applied to staging or production by hand (H-19). Migrations reach them through CI only.

## 3. Project structure

| Path | What |
|---|---|
| `docs/` | Planning set 00–13, `ACTIVITY.md` (protocol + live log), `runbooks/` |
| `supabase/migrations/` | Forward-only SQL: schemas, tables, RLS, `app.*` functions, guards. One file per task, never edited after merge |
| `supabase/tests/` | Vitest + `pg`: the RLS matrix (every table × 10 personas), invariant and attack tests, schema hygiene |
| `apps/web/` | Next.js 16 + React 19. `app/app/` is the rep PWA, `app/office/` the owner and manager app, `lib/supabase/` the clients |
| `packages/import/` | Excel/CSV salon import dry-run (P0-02); writes to no database |
| `packages/shared/` | Planned: DB-generated types, validation schemas, i18n strings (en, ur) |
| `scripts/` | CI helpers: activity-log check, service-role scan, staging smoke |

The data model is in [doc 04](docs/04-domain-model.md) and the architecture in [doc 05](docs/05-architecture.md).

## 4. Code style

**Formatting and lint: Biome** (MJ, L-0136).
- One `biome.json` at the root, `pnpm lint` and a CI `lint` job that fails the pull request.
- Run `biome check --write` before committing.
- *Status: planned; added as the next step under C-005.*

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

## 5. Testing strategy

| Layer | What it proves | Where | Status |
|---|---|---|---|
| **RLS matrix** | Each persona can read exactly the rows the matrix predicts in every table, and no app role can write directly | `supabase/tests/rls-matrix.test.ts` | Running in CI |
| **Invariant and attack tests** | Controls hold under attack: append-only, maker ≠ checker, no negative stock, single-use approvals, territory isolation, replays | `supabase/tests/*.test.ts` | Running in CI |
| **Schema hygiene** | Every table has RLS and an audit trigger; every SECURITY DEFINER function pins `search_path`; anon can execute nothing | `supabase/tests/schema-hygiene.test.ts` | Running in CI |
| **Package unit tests** | Import mapping and normalisers | `packages/import/tests/` | Running in CI |
| **Rep PWA browser tests** (Playwright, MJ L-0136) | The offline order, payment and lost-demand tap are queued in the outbox and synced idempotently; a server rejection after sync is shown to the rep (NFR-01); throttled network and a low-end mobile viewport | `apps/web/e2e/` | **Planned**: harness under C-005; flows grow with P1-09 |
| **Field test** | Offline capture in a basement salon with no signal (Phase 1 exit criterion 6) | Pilot, [doc 11](docs/11-roadmap.md) | Phase 1 pilot |

**Rules for tests:**
- **No test is ever skipped or loosened** to get green (H-23).
- **Verifier-authored tests** change only with MJ's approval. Three kinds of change for a new module are pre-approved (MJ, 2026-10-28): adding its functions to the allowlist, adding `*_client` or planned-date parameters to the client-time list, and turning a "does not exist yet" check into a "rep sees 0 rows" check. Each is logged.
- **Each control gets a test that tries to break it**, not only one that uses it.
- **The Definition of Done** is in ACTIVITY §6.
- **A different agent or MJ marks work VERIFIED**, never its builder (§7).

## 6. Boundaries

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
- Changing a verifier-authored test, beyond the three pre-approved kinds (§5).

**Never**
- Put supplier identity, cost or real personal data anywhere outside the vault: not in the repo, CI, logs or prompts (H-01 to H-05).
- Edit or delete history; corrections are reversing rows (H-06, H-07).
- Weaken, bypass or "temporarily skip" RLS, MFA, device binding, approvals or audit (H-16).
- Put a service-role key in client code (H-18).
- Mark your own work VERIFIED (§7).
- Pay agents for recruiting other agents (A-06; SECP, Companies Act 2017 s.301).
