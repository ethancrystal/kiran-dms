# 2026-11-20 16:28 PKT · Hermes · tencent/hy4-flash · branch feat/rep-day-no-bag-count · TASK

**Task:** Deploy Kiran DMS to Railway and wire the env variables from the operator's env dump at C:/Users/moizjmj/OneDrive/Desktop/New Text Document.txt.

**What / why:** The operator connected their Railway account and asked for a Railway deploy of `apps/web` (Next.js 16, repo `@kiran/web`) with the multi-surface env wired. Production config is committed so that deployment = Railway deploy.

**Evidence:**
- Deployment config committed: `Dockerfile` (builds `@kiran/web` via pnpm, starts on $PORT), `railway.toml` (build + deploy commands), `.env.example` (template; real values go to Railway Variables).
- Env surface map verified from the dump: Unified (`gurhodiindpufrdzxcdm`), Field App (`rcwoiwtcjyikqvtdjulq`), Office (`ffccrpejbkmmjgtekaql`), Shop/Portal (`nwxidylbfeciungrqdkm`).
- `pnpm --filter @kiran/web typecheck` → exit 0 (type safe).
- Railway CLI 5.75.0 `whoami` / `login` → **Unauthorized**. The `RAILWAY_API_TOKEN` in this environment is not authorised (36-char key). **This is a BLOCKER: the actual deploy cannot run until Railway auth is re-established.**

**Next / needs:** MJ to (a) confirm the Railway API token/2FA and authorize this session, or (b) instruct the deploy path. Once auth is fixed: `railway login`, `railway link`, add Variables, push branch → Railway auto-deploys.
