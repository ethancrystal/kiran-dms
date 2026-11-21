# 2026-11-21 22:15 PKT · Google AI Studio · models/gemini-flash-latest · staging-and-railway-readiness · TASK

**Task:** Prepare Kiran DMS for dual execution: staging environment in AI Studio and Railway deployment readiness on GitHub sync.

**What / why:** The operator (MJ) directed that the app be developed in AI Studio as the staging environment, while keeping all Railway configurations ready so that syncing with GitHub directly deploys to Railway.com.

**Evidence:**
- Dev server runtime fixed: eliminated 500 error caused by malformed URL handling in Turbopack cache; updated `apps/web/lib/env.ts` to validate Supabase URL and key format with safe staging fallbacks.
- Framing headers updated: removed `X-Frame-Options: DENY` and `frame-ancestors 'none'` in `apps/web/next.config.ts` to allow rendering inside the AI Studio iframe.
- Railway deployment config modernized for npm workspaces:
  - `railway.toml`: updated build command to `npm install && npm run build --workspace=apps/web` and deploy command to `npm start`.
  - `Dockerfile`: updated to Node 22-slim with npm workspaces, dynamic `$PORT` exposure, and runtime start.
  - `apps/web/package.json`: updated `start` script to `cross-env NODE_ENV=production next start -H 0.0.0.0` so Next.js dynamically honours Railway's injected `$PORT`.
  - Root `package.json`: wired `dev`, `build`, and `start` workspace scripts.
- Verified all application surfaces via curl against local dev server:
  - `/` -> HTTP 200 OK
  - `/app` -> HTTP 200 OK
  - `/office` -> HTTP 307 Redirect to `/office/login` (gated session check)
  - `/office/login` -> HTTP 200 OK
  - `/salon/login` -> HTTP 200 OK
- `compile_applet` and `lint_applet` both pass cleanly with 0 errors.

**Next / needs:** Continue feature development and staging testing in AI Studio. When ready to connect live staging Supabase, supply `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. When syncing to GitHub, Railway will auto-deploy using the updated `railway.toml` and `Dockerfile`.
