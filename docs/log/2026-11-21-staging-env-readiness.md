# 2026-11-21 22:35 PKT · AutoClaw (MJ's session agent) · AutoClaw runtime · branch feat/staging-env-readiness · TASK

**Task:** — (integrate the AI Studio staging-and-Railway-readiness file set MJ supplied on 2026-11-21; areas: apps/web/lib/env.ts, apps/web/app/page.tsx, docs/integration record, this entry)

**What / why:** MJ supplied five files from a Google AI Studio session ("these are also some changes the ai studio did these are updated files"), following this session's instruction to preserve uncommitted work. AI Studio's own record states MJ's direction: AI Studio is the staging environment and Railway remains the GitHub-synced deploy target. This task verified each supplied file against the repository and applied what is sound, adapted what is nearly sound, and refused what would break the deploy or weaken a control. The pnpm deployment config (root Dockerfile) and the railway.toml retirement of PR 131 are untouched here.

Applied:

- apps/web/lib/env.ts: the AI Studio validation idea is adopted — isConfiguredUrl rejects non-URLs and the angle-bracketed .env.example placeholders that made supabase-js throw at client construction (the 500 their record describes), isConfiguredKey rejects empty and bracketed values, and supabaseConfigured gates the exports. Two deliberate adaptations: no minimum key length, because the mocked rep PWA e2e suite builds with a 15-character placeholder key and a length rule would flip the app to unconfigured and change proxy behaviour mid-suite; and the unconfigured fallback points at the guaranteed-non-resolvable not-configured.invalid domain instead of their placeholder-staging.supabase.co, so an unconfigured staging render neither crashes nor contacts a real host.
- apps/web/app/page.tsx: their connection-status landing card is adopted (the .card and .ok classes exist in app/globals.css), minus the hardcoded Environment: Staging label, which would read as false once the same page deploys to production.
- docs/integration/2026-11-21-ai-studio-staging-readiness.md: their TASK record committed verbatim as a foreign-session record.

Refused, with reasons, for MJ:

- The npm-workspace conversion (their railway.toml and Dockerfile.txt, plus the claimed root and apps/web package.json script edits that were not among the supplied files): the repository is a pnpm workspace with corepack-pinned pnpm 10.33.4 and MJ's standing rule forbids npm and a package-lock.json; npm install would run lockfile-less, and the npm workspace flags need a workspaces field the root package.json does not carry. Adopting them would break the Railway build that the pnpm Dockerfile defines.
- The claimed removal of X-Frame-Options DENY and the frame-ancestors none CSP from apps/web/next.config.ts: those are the documented doc 06 section 7 security headers and H-16 forbids weakening a control; the modified next.config.ts was not among the five supplied files, so nothing of the claim could be verified. If the AI Studio iframe preview needs framing, that is a deliberate, staging-only decision for MJ (a DECISION entry), not a repo-wide header removal.
- The railway.toml modernisation conflicts with PR 131, which retires the file (Railway config-as-code stops working 2026-12-01 and duplicates the Dockerfile); PR 131 remains the vehicle for that decision.

**Evidence:**

- Read before work: the current apps/web/app/page.tsx, apps/web/next.config.ts, apps/web/lib/supabase/browser.ts, apps/web/lib/supabase/server.ts, apps/web/playwright.config.ts, and a grep of every SUPABASE_URL, SUPABASE_ANON_KEY and supabaseConfigured consumer; ACTIVITY.md rules and the entry template from the earlier tasks of this session.
- origin/main moved during this session: PR 130 (the roles-coverage fix) merged; this branch is based on the new head 0dad9f7.
- Worktree: isolated .worktrees/ai-studio-updates; the shared worktree was not touched (another session had been running there when this task began).
- pnpm install --frozen-lockfile: Done in 27.5s with pnpm 10.33.4. pnpm typecheck: exit 0 (packages/import and apps/web). biome check --write on the two touched files: checked 2, fixed 1, formatting only. pnpm -C apps/web build: exit 0; the Next.js production build completes with the proxy listed.
- Not run: the mocked rep PWA e2e suite (compatibility is reasoned above: the placeholder key carries no brackets and no length rule now applies, so the suite stays configured; the placeholder URL passes isConfiguredUrl), the real-stack suites (no Docker on this host), and anything against a hosted project (H-19). No production action was taken.
- pnpm agent:preflight and the activity log check: run after this entry; their results are recorded in the pull request check.

**Next / needs:** MJ reviews and merges (merge only after MJ says so in chat for this pull request, section 10). MJ decides the AI Studio staging architecture: (a) whether staging may relax the frame headers conditionally by environment — that needs his DECISION entry and the production default stays DENY; (b) PR 131 stays the vehicle for the railway.toml retirement against AI Studio's modernised toml; (c) AI Studio should consume this repository through git rather than re-deriving deploy files, so the pnpm deploy path is not re-broken.

Security checklist (tick honestly):
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20) — the supplied env.ts carried placeholder values only; no key, token or person entered the diff
[ ] RLS enabled+forced; policies + role×table tests added/updated (H-13) — n/a, no table or policy touched
[ ] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) — n/a
[ ] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — n/a
[ ] Audit trigger present; hash chain verifies (H-17) — n/a
[ ] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) — n/a
[ ] Governance powers still owner-only + AAL2 (H-15) — n/a, no permission changed
[x] No control weakened, skipped or "temporarily" disabled (H-16) — the frame-header removal was refused, not applied; the env change adds a guard and keeps every consumer's behaviour
[x] Docs match code; deviations logged (H-25) — this entry records every difference between the supplied files and what landed
[x] Tests actually run; real results recorded (H-23, H-24) — install, typecheck, biome and the production build above; the not-run list is explicit
