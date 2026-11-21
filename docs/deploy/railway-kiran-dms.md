# Railway — Kiran DMS deployment notes

Commit up: `feat/rep-day-no-bag-count` (apps/web, Next.js 16). Production config:

- `Dockerfile`        — builds `apps/web` (@kiran/web) via pnpm, starts on $PORT.
- `railway.toml`      — Railway build + deploy commands.
- `.env.example`      — template; real values live only in Railway Variables.

## Env surface map (from operator's env dump)

| Railway surface | App path | Supabase project |
|---|---|---|
| Unified app (single served app, `NEXT_PUBLIC_APP_SURFACE=all`) | apps/web | `gurhodiindpufrdzxcdm` → gurhodiindpufrdzxcdm.supabase.co |
| Field App | apps/web (`/app`) | `rcwoiwtcjyikqvtdjulq` ← NEXT_PUBLIC_FIELD_SUPABASE_URL |
| Office Console | apps/web (`/office`) | `ffccrpejbkmmjgtekaql` ← NEXT_PUBLIC_OFFICE_SUPABASE_URL |
| Shop/Portal | apps/web (`/portal`) | `nwxidylbfeciungrqdkm` ← NEXT_PUBLIC_SUPABASE_URL |

Secrets (service role key, publishable, anon, JWT) are set in Railway Variables —
they stay out of git (H-18/H-20) and out of the repo. `.env.example` holds
placeholders only.

## Connection state (verified 2026-11-20, merged from the two earlier Railway notes)

The append-only log entry `docs/log/2026-11-20-railway-kiran-dms.md` stays as the
frozen historical record; this file is the current source of truth.

- **Railway MCP connector: connected.** `whoami` → Sergio R.
  (`sergiocrafito@gmail.com`), 2 projects visible: `alluring-contentment`
  (`d6f05ff8-69d3-4455-9d3a-dd717cd86431`, created 2026-11-18) and
  `humorous-reprieve` (`919f2f66-f4b7-4e21-b175-16898cc78aaa`, created 2026-11-12),
  both in workspace "Sergio R.'s Projects".
- **Railway CLI token: still not authorised.** The `RAILWAY_API_TOKEN` in the
  environment gives `railway whoami` → "Unauthorized" (36-char key). This blocked
  the CLI-driven deploy steps in the earlier note; it does not affect the MCP connector.

## Deployment checklist

1. Deploy via the connected Railway MCP connector, or re-authenticate the CLI
   (`railway login`) if CLI commands are needed.
2. Link this repo: `railway link` → ethancrystal/kiran-dms.
3. Add Variables (from `.env.example`, real values) in the Railway dashboard.
4. Push `feat/rep-day-no-bag-count` → Railway auto-deploys.

No production action (deploy, migration, variable write, redeploy) was taken while
consolidating these notes (H-19).

## Supabase instances and MCP endpoints (operator dump, recorded 2026-11-21)

The operator's env dump (2026-11-20/21) names these hosted Supabase projects.
Project refs and URLs are public identifiers; every key seen in the dump was an
anon/publishable key — no service-role key appeared — and no key value is copied
into this repository (H-18, H-20). Keys live in Railway Variables only.

| Project ref | Named as in the dump |
|---|---|
| `gurhodiindpufrdzxcdm` | Unified app; earlier read-only probe found no business tables in its public schema |
| `rcwoiwtcjyikqvtdjulq` | Field App URL in one block, Office Supabase URL in another (conflicting) |
| `ffccrpejbkmmjgtekaql` | Office Console URL in one block, Field Supabase URL in another (conflicting) |
| `nwxidylbfeciungrqdkm` | Unified/portal in the `.env` block; 67 public tables and 283 app RPCs verified 2026-11-18 |
| `qcdbzsnwjrunfhjqizvr` | Field App URL entry (MCP project-4) |
| `mbtrgtacikkqfyffbgbb` | MCP project-1 target |
| `sszrjunyjrivhpguanjn` | Public app surface entry |

The dump also carries Supabase MCP endpoint URLs of the form
`https://mcp.supabase.com/mcp?project_ref=<ref>` for `gurhodiindpufrdzxcdm`,
`rcwoiwtcjyikqvtdjulq` (listed as `mbtrgtacikkqfyffbgbb` too), `nwxidylbfeciungrqdkm`,
`ffccrpejbkmmjgtekaql` and `qcdbzsnwjrunfhjqizvr`. The dump's own blocks assign the
same project to two different surfaces in places, so before any deploy points at one
of these, MJ confirms which project backs which surface (B-53 steps b-d also remain
MJ's dashboard actions). Note `scripts/apply-kiran-fresh.sh` refuses every ref above:
it is guarded to a different project (`jlanskjgpuyycarwjafn`), so applying the full
migration set to any instance listed here is a deliberate, separately approved act (H-19),
not a side effect of that script.
