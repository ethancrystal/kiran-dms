# 2026-11-21 22:47 PKT · AutoClaw (MJ's session agent) · AutoClaw runtime · branch docs/railway-deploy-record-pr · TASK

**Task:** — (Railway deployment readiness, continued from the entry 2026-11-21-railway-deploy-record: which hosted projects the app should use, and one working Railway configuration; areas: Dockerfile, .dockerignore, .github/workflows/ci.yml, docs/deploy/railway-kiran-dms.md, this entry)

**What / why:** MJ asked which hosted projects the app should use and that the Railway deployment be fully set up ("please check which ones should we work with and this app will be deployed on railway make sure that everythhing is set for that"), then to keep exactly one Railway configuration ("keep just one for railway"). The probes answered the project question; the deployment question found the build broken, and this entry records the fix, which travels in the same pull request as the deployment record so Railway has one record, one configuration (the Dockerfile) and one PR.

Findings:

- Schema probes with each project's own key, read-only, against public.salon and public.user_profile: nwxidylbfeciungrqdkm and iurvazdyxzlspegygldo both answer 42501 (permission denied, the RLS refusal), so both carry the Kiran schema; ffccrpejbkmmjgtekaql and rcwoiwtcjyikqvtdjulq answer PGRST205 (table absent), so they do not carry it. The portal pair the app actually reads points at nwxidylbfeciungrqdkm; that is the project to work with. The iurvaz secret key in the operator's local .env.local is rejected as "Invalid API key", consistent with MJ's 2026-11-20 rotation; no consumer reads it today.
- Deployments: seven consecutive builds failed on 2026-11-21 between 21:28 and 22:26 PKT, the last being 19fbf879-ce6d-45a9-af0a-25c466867a8f, triggered by the PR 130 merge. The service still runs the 2026-11-19 deployment 02705712-6e13-4851-a8ff-b0dc01ff0b53 (commit 2e85b3d), built by Railpack with a dashboard build command. Once the Dockerfile reached main, Railway switched to it and every build after that failed.
- Root cause from the failed build log: the base stage ran pnpm install --frozen-lockfile with only the root manifests copied, so the workspace packages had no node_modules; the builder then died in pnpm --filter @kiran/web run build with "cross-env: not found" (ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL, spawn ENOENT). Three further defects sat behind it: the runner copied .next from the repo root although the build output lives in apps/web/.next; the runner stage had no pnpm, so its CMD would not resolve; and NEXT_PUBLIC_* were never declared as build ARG, so the bundle would have been built unconfigured whatever the service variables said.
- One production action was taken on MJ's instruction that everything be set: the service public domain was created (kiran-production-9c5c8fac.up.railway.app, id f96ce21a-0215-4962-8387-d70d37ae9f66). It currently routes to the stale 2026-11-19 deployment and is removable from the dashboard. No deploy, migration or variable write was made.
- Because the earlier entry was merged to main by the PR 130 merge before this work landed, the append-only rule forbids extending it; this separate entry carries the continuation and cites it instead.

**Evidence:**

- railway logs --build 19fbf879-ce6d-45a9-af0a-25c466867a8f: the log quoted above, ending "Build Failed: ... exit code: 1". railway logs --build with no id showed the 11-19 Railpack build (its image tag carries deployment 02705712).
- railway status --json and railway deployment list: the seven FAILED entries and the one RUNNING 2026-11-19 deployment.
- curl probes against the four refs as described; docker --version is absent on this host, so the image itself is verified by the new CI job on this pull request, not locally.
- Changes in this pull request, on top of the merged deployment record: Dockerfile rewritten (all workspace manifests before the frozen install, ARG NEXT_PUBLIC_* in the builder stage, runner from the same base so pnpm and node_modules exist, .next copied from apps/web); .dockerignore added (git, node_modules, .next, worktrees and every .env file, H-20); a docker-image job added to .github/workflows/ci.yml (build with the two public build args, run the container, require / to render and /office/login to answer 200); docs/deploy/railway-kiran-dms.md gains sections 7 and 8 with these findings; railway.toml removed again, since main carried it back.
- pnpm agent:preflight exit 0 in the PR worktree; the activity log check rerun after this entry, its result in the pull request check.
- Not run: docker build locally (no Docker on this host); the new CI job is the verification that matters, and the Railway build after merge is the end-to-end proof.

**Next / needs:** MJ reviews and merges this pull request; the first green Railway build is the proof, and then the domain serves the current main. Still MJ's: confirm the hosted project for the split field/office surfaces (deployment record section 4). Nothing depends on the retiring humorous-reprieve project, which Railway deletes on 2026-11-22.

Security checklist (tick honestly):
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20) — .dockerignore excludes every .env file so none can be baked into an image; only placeholder public values appear in the CI job
[ ] RLS enabled+forced; policies + role×table tests added/updated (H-13) — n/a, no table or policy touched
[ ] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) — n/a
[ ] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — n/a
[ ] Audit trigger present; hash chain verifies (H-17) — n/a
[ ] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) — n/a
[ ] Governance powers still owner-only + AAL2 (H-15) — n/a
[x] No control weakened, skipped or "temporarily" disabled (H-16) — the image now receives only the two public keys as build arguments; no secret or service-role material is passed to a build
[x] Docs match code; deviations logged (H-25) — the deployment record now states the Dockerfile is the builder and why the earlier builds failed
[x] Tests actually run; real results recorded (H-23, H-24) — preflight and the log check above; the image build is named as not run locally with the reason, and CI covers it
