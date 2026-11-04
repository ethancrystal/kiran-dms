# 2026-11-05 03:06 PKT · Claude · Opus 5.5 · branch claude/ci-reserve-supabase-ports · TASK
**Task:** CI reliability; no requirement changed
**What / why:** The office browser tests on PR 53 (docs only) failed before running: the Supabase mail container could not bind port 54324, address already in use, on the GitHub runner. Ports 54320 to 54329 sit inside the Linux ephemeral range, so an outbound connection can take one. Added a step that reserves that range before each supabase start in .github/workflows/ci.yml. Job names unchanged.
**Evidence:** Failed run 41920836559 attempt 1, step Start Supabase (db, auth, rest, gateway, mail): failed to bind host port 0.0.0.0:54324/tcp: address already in use. Commands run: node scripts/activity-log-check.mjs origin/main; pnpm agent:preflight. Not run locally: the workflow itself, which only CI can run. The bind failure is intermittent, so one green run does not prove it.
**Next / needs:** MJ: merge decision.

Security checklist: n/a, CI step only; no RLS, data, secrets or functions changed.
