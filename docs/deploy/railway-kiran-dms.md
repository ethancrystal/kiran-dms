# Railway — Kiran DMS deployment record

Current source of truth for Railway deployment, consolidated 2026-11-21 by the
`docs/railway-deploy-record` task. The frozen historical entries stay untouched:
`docs/log/2026-11-20-railway-kiran-dms.md` (deploy-config commit record) and the
superseded "Connection state (verified 2026-11-20)" section of this file's earlier
revision (CLI unauthorised, MCP-connector wording). This revision replaces both.

## 1. Topology — what runs where

- Repo `ethancrystal/kiran-dms` (`main`) is connected to the Railway project
  **alluring-contentment** (MJ, 2026-11-21). Deploy = push to `main`; Railway's
  GitHub integration builds and redeploys the service. No `railway up` needed.
- Project `alluring-contentment` (`d6f05ff8-69d3-4455-9d3a-dd717cd86431`),
  environment `production` (`7507bd15-3df7-4c84-8ded-2c0bb04c1587`), service
  `kiran` (`1118f93a-679b-4fa2-bdfd-83427a74a031`), workspace
  "Sergio R.'s Projects" (`f12505f4-fd33-4327-9742-8af426092946`).
- App surface: `NEXT_PUBLIC_APP_SURFACE=portal` — the Shop and Salon Portal
  build of `apps/web` (@kiran/web, Next.js 16).
- **The root `Dockerfile` is the single source of deploy truth:** node:22-slim,
  corepack pnpm@10.33.4, `pnpm install --frozen-lockfile` over the whole
  workspace, `pnpm --filter @kiran/web run build`, runner stage copies `.next`
  and `public`, `CMD pnpm --filter @kiran/web start` honouring `$PORT`
  (Dockerfile default 8080; Railway injects its own at runtime).
- **`railway.toml` is retired** (removed in the same PR as this record):
  Railway config-as-code (`railway.json` / `railway.toml`) is deprecated and
  keeps working only until 2026-12-01, and its build command
  (`pnpm install --frozen-lockfile` in `/app`) and deploy command
  (`pnpm --filter @kiran/web start` in `/app`) duplicate the Dockerfile exactly.
  Rollback is reverting the commit that removed it. Two historical records still
  name `railway.toml` — `docs/integration/2026-11-19-single-repository-consolidation.md`
  and the frozen log entry of 2026-11-20 — they describe their own time and are
  not current instructions.
- **CLI access:** Railway CLI 5.75.0, authenticated 2026-11-21 by OAuth browser
  login as Sergio R. (`sergiocrafito@gmail.com`). The former blocker (an
  unauthorised 36-character `RAILWAY_API_TOKEN` in the environment, recorded
  2026-11-20) is closed. Inspection without linking:

```
railway list
railway vars --project d6f05ff8-69d3-4455-9d3a-dd717cd86431 --service kiran --environment production --kv
```

## 2. Env contract — what the application demands

- **Runtime consumption (verified 2026-11-21 by grep over `apps/web` and
  `packages` source, build output and tests excluded):** the application reads
  exactly two variables — `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`apps/web/lib/env.ts`). No other
  `NEXT_PUBLIC_*` key appears in app source; `DATABASE_URL` and the server-side
  Supabase variables are part of the deployment contract but have no consumer in
  the current build.
- **Deployment contract (`/.env.example`):** twelve variables —

| Variable | Group |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | portal public pair (the pair the code reads) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | portal public pair |
| `NEXT_PUBLIC_FIELD_SUPABASE_URL` | split-surface pairs (future field/office services) |
| `NEXT_PUBLIC_FIELD_SUPABASE_ANON_KEY` | split-surface pairs |
| `NEXT_PUBLIC_OFFICE_SUPABASE_URL` | split-surface pairs |
| `NEXT_PUBLIC_OFFICE_SUPABASE_ANON_KEY` | split-surface pairs |
| `NEXT_PUBLIC_FIELD_APP_URL` | cross-origin links |
| `NEXT_PUBLIC_OFFICE_CONSOLE_URL` | cross-origin links |
| `NEXT_PUBLIC_PORTAL_URL` | cross-origin links |
| `NEXT_PUBLIC_APP_SURFACE` | surface selector: all / field / office / portal |
| `DATABASE_URL` | server-side Supabase set |
| `SUPABASE_SECRET_KEY` | server-side Supabase set |

- `NEXT_PUBLIC_*` values are inlined **at build time**: Railway passes service
  variables into the build, so they must be set before the build, and any value
  change alone triggers a fresh build and deploy.
- `NODE_ENV` and `PORT` come from the Dockerfile; the `RAILWAY_*` variables
  (project, environment, service identity, domains) are injected by Railway and
  are not part of the contract.

## 3. Production variables, verified 2026-11-21

Verified with `railway vars --kv` against both projects' `production`
environments. Values are withheld here on purpose (H-18, H-20); the table maps
each variable to the Supabase project ref it points at.

**alluring-contentment, service `kiran` (live) — all twelve contract variables
are present; none was missing, so none was added.**

| Variable(s) | Points at |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `nwxidylbfeciungrqdkm` (the anon key is that ref's publishable key — the same value the other project carries as `SUPABASE_PUBLISHABLE_KEY` against the same ref) |
| `NEXT_PUBLIC_FIELD_SUPABASE_URL`, `NEXT_PUBLIC_FIELD_SUPABASE_ANON_KEY` | `ffccrpejbkmmjgtekaql` (publishable key pairs with that ref per the operator dump's per-service blocks) |
| `NEXT_PUBLIC_OFFICE_SUPABASE_URL`, `NEXT_PUBLIC_OFFICE_SUPABASE_ANON_KEY` | `rcwoiwtcjyikqvtdjulq` (the anon JWT payload carries ref `rcwoiwtcjyikqvtdjulq`) |
| `NEXT_PUBLIC_FIELD_APP_URL` | `https://field-production.up.railway.app` — **not served by this Railway account** (see below) |
| `NEXT_PUBLIC_OFFICE_CONSOLE_URL` | `https://office-production.up.railway.app` — not served by this Railway account |
| `NEXT_PUBLIC_PORTAL_URL` | `https://shop-production.up.railway.app` — not served by this Railway account |
| `NEXT_PUBLIC_APP_SURFACE` | `portal` |
| `DATABASE_URL`, `SUPABASE_SESSION_POOLER` | `iurvazdyxzlspegygldo` — direct `db.` host (port 5432) and session pooler (`aws-0-ap-southeast-1.pooler.supabase.com`) |
| `SUPABASE_URL`, `SUPABASE_JWKS_URL` | `iurvazdyxzlspegygldo` |
| `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE`, `SUPABASE_JWT_KEY` | `iurvazdyxzlspegygldo` (the service-role JWT payload carries that ref) |

Open points MJ decides before further work:

- **Public pair vs server-side set point at two different Supabase projects**
  (`nwxidylbfeciungrqdkm` vs `iurvazdyxzlspegygldo`). The current build reads
  only the public pair, so the deployed portal is consistent today; the intended
  server-side project needs MJ's confirmation before any server-side consumer
  ships.
- **The three cross-origin hosts (`field-production`, `office-production`,
  `shop-production.up.railway.app`) are not services of this Railway account**
  (`railway list` on 2026-11-21 shows only the two projects of §1 and §5). They
  are external references MJ maintains; whichever account owns them must exist
  before the split surfaces ship.
- **The live `kiran` service has no public domain** (no `RAILWAY_PUBLIC_DOMAIN`
  was injected in alluring-contentment). The portal is not reachable from
  outside until MJ assigns a domain in the Railway dashboard.

**humorous-reprieve, service `kiran` (retiring) — no variables were changed.**
Created 2026-11-12; Railway schedules its deletion 2026-11-22T13:54:06Z. It is
the older deploy era: its variables use the `VITE_*` prefix, which the Next.js
app never reads, and it carries one cross-project mismatch (`VITE_SUPABASE_URL`
names `nwxidylbfeciungrqdkm` while `VITE_SUPABASE_ANON_KEY` is the anon JWT of
`iurvazdyxzlspegygldo`). Nothing in this repo depends on it; its public domain
`kiran-production-23bcf6a4.up.railway.app` disappears with it.

## 4. Surface map and the unresolved assignment conflict

Two repository records disagree about which hosted Supabase project backs the
two split surfaces; the dump itself also assigns the same ref to two surfaces in
different blocks. The **portal pair is unaffected** by the conflict.

| Record | Field App | Office Console |
|---|---|---|
| `/.env.example` header comment and frozen log entry `2026-11-20-railway-kiran-dms.md` | `rcwoiwtcjyikqvtdjulq` | `ffccrpejbkmmjgtekaql` |
| Operator dump's per-service blocks (the per-service env sets the current Railway variables follow) | `ffccrpejbkmmjgtekaql` | `rcwoiwtcjyikqvtdjulq` |

In production the two split-surface pairs are each internally consistent (each
URL is paired with that ref's own publishable/anon key), so no value is broken —
only the surface-to-project naming is disputed. `/.env.example` now carries a
NOTE pointing here. MJ confirms the assignment before any field or office
service goes live; until then this record keeps both readings.

## 5. Supabase instance map (operator dump + 2026-11-21 additions)

Project refs and URLs are public identifiers. Every key seen in the dump was an
anon/publishable key — no service-role key appeared in it — and no key value is
copied into this repository (H-18, H-20). Keys live in Railway Variables only.

| Project ref | Named as / notes |
|---|---|
| `gurhodiindpufrdzxcdm` | Unified app; an earlier read-only probe found no business tables in its public schema |
| `rcwoiwtcjyikqvtdjulq` | Field App URL in one dump block, Office Supabase URL in another (conflicting; §4) |
| `ffccrpejbkmmjgtekaql` | Office Console URL in one dump block, Field Supabase URL in another (conflicting; §4) |
| `nwxidylbfeciungrqdkm` | Portal/unified in the env blocks; 67 public tables and 283 app RPCs verified 2026-11-18; the live portal pair points here |
| `iurvazdyxzlspegygldo` | **Added 2026-11-21:** the server-side set in Railway production variables and in the operator's local `.env.local`; not named in the 2026-11-20/21 dump; the earliest key issued for it dates to 2026-11-18 |
| `qcdbzsnwjrunfhjqizvr` | Field App URL entry (MCP project-4) |
| `mbtrgtacikkqfyffbgbb` | MCP project-1 target |
| `sszrjunyjrivhpguanjn` | Public app surface entry |

The dump also carries Supabase MCP endpoint URLs of the form
`https://mcp.supabase.com/mcp?project_ref=<ref>` for five of the refs above.
Note `scripts/apply-kiran-fresh.sh` refuses every ref listed here: it is guarded
to a different project (`jlanskjgpuyycarwjafn`), so applying the full migration
set to any instance above is a deliberate, separately approved act (H-19), not a
side effect of that script.

## 6. Deployment checklist (current)

1. **Deploy:** push to `main`. The GitHub integration builds the Dockerfile and
   redeploys service `kiran` in alluring-contentment. Verify the build in the
   Railway dashboard or `railway logs` (link the repo first:
   `railway link --project d6f05ff8-69d3-4455-9d3a-dd717cd86431
   --environment production --service kiran`).
2. **Variables:** complete per §3; the contract is §2. Every variable write
   (dashboard or CLI) redeploys production — make variable writes only with MJ's
   approval for that exact change (H-19), and never write a value that is not
   part of this contract.
3. **Reachability:** assign a public domain to the service (§3 open points)
   before expecting the portal to answer from outside.
4. **After deploy:** the portal page renders, reads the `nwxidylbfeciungrqdkm`
   catalogue through the anon key, and errors surface in `railway logs`; the
   database remains the security boundary (docs 06).
5. **Secrets:** real values live only in Railway Variables and the operator's
   git-ignored `.env.local`; never in git, never in `NEXT_PUBLIC_*` for
   service-role material (H-18, H-20). A leaked secret is rotated first, logged
   second.

## 7. Build reality and the 2026-11-21 fix

Railway builds the root `Dockerfile` — confirmed from the build log of deployment
`19fbf879-ce6d-45a9-af0a-25c466867a8f` (2026-11-21), whose stages read `base`,
`builder`, `runner`. The older deployment still running today
(`02705712-6e13-4851-a8ff-b0dc01ff0b53`, commit `2e85b3d`, 2026-11-19) was built by
Railpack with a dashboard build command; once the Dockerfile reached `main`, seven
consecutive builds failed between 21:28 and 22:26 PKT.

Root cause from that build log: the base stage copied only the root manifests before
`pnpm install --frozen-lockfile`, so the workspace packages never got `node_modules`,
and `pnpm --filter @kiran/web run build` died with `cross-env: not found`
(`ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`, `spawn ENOENT`). Three further defects sat
behind it: the runner copied `.next` from the repo root although the build output
lives in `apps/web/.next`; the runner stage had no `pnpm`, so its `CMD` would not
resolve; and `NEXT_PUBLIC_*` were never declared as build arguments, so the client
bundle would have been built unconfigured whatever the service variables said.

Fixed in this pull request: every workspace manifest is copied before the frozen
install; the `NEXT_PUBLIC_*` pair is declared as `ARG` and promoted to `ENV` in the
builder stage (Railway passes service variables to the build as build arguments);
the runner stage starts from the same base, so `pnpm` and the workspace
`node_modules` exist, and it copies `apps/web/.next` to its real path. A new CI job,
`docker-image`, builds the image and smoke-runs it (`/` must render, `/office/login`
must return 200), so this class of failure is caught before Railway sees it.

Public domain: created 2026-11-21 on MJ's instruction that the deployment be fully
set up — `https://kiran-production-9c5c8fac.up.railway.app` (domain id
`f96ce21a-0215-4962-8387-d70d37ae9f66`). Until the first green build it routes to
the stale 2026-11-19 deployment; it is removable from the Railway dashboard.

## 8. Which hosted projects to work with (probed 2026-11-21)

Each project was probed read-only with its own key against `public.salon` and
`public.user_profile`. `42501` (permission denied — the RLS refusal) means the table
exists; `PGRST205` means the table is absent from the schema cache.

| Project ref | Probe result | Verdict |
|---|---|---|
| `nwxidylbfeciungrqdkm` | `42501` on both tables; auth health 200 with its publishable key | **The portal database the app reads — work with this one** |
| `iurvazdyxzlspegygldo` | `42501` on both tables | Carries the schema too; its secret key in the local `.env.local` is rejected as "Invalid API key" (consistent with MJ's 2026-11-20 rotation); no consumer reads it today |
| `ffccrpejbkmmjgtekaql` | `PGRST205` on both tables | Does not carry the Kiran schema — not usable as a surface database yet |
| `rcwoiwtcjyikqvtdjulq` | `PGRST205` on both tables | Does not carry the Kiran schema — not usable as a surface database yet |

No production action (deploy, migration, variable write) was taken while
consolidating this record (H-19); the verification in §3, §7 and §8 was read-only
(`railway list`, `railway vars`, `railway logs`, and public HTTP probes), except the
one domain creation recorded in §7, made on MJ's explicit instruction.
