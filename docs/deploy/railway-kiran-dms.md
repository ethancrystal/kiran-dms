# Railway — Kiran DMS deployment notes (solved-vs-blocker)

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

## Deployment checklist

1. `railway login` (re-authenticate — the RAILWAY_API_TOKEN currently in the
   environment is NOT authorised: `railway whoami` → "Unauthorized", 36-char key).
2. Link this repo: `railway link` → ethancrystal/kiran-dms.
3. Add Variables (from `.env.example`, real values) in Railway dashboard.
4. Push `feat/rep-day-no-bag-count` → Railway auto-deploys.

Blocked: step 1 (railway token not authorised in this environment).
