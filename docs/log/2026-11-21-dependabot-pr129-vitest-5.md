# 2026-11-21 21:10 PKT · AutoClaw (MJ's session agent) · AutoClaw runtime · dependabot pull request 129 · TASK

**Task:** - (dependency housekeeping: merge Dependabot pull request 129, vitest 4 to 5; areas: package.json, packages/import/package.json, pnpm-lock.yaml)

**What / why:** Dependabot opened pull request 129 bumping vitest, the test runner of the db suite and the import package, from 4 to 5.1.1. MJ ordered in chat on 2026-11-21 to process the open pull requests sequentially. A bot cannot write the log entry that the repo's activity-log-check (a required check) demands for every code change, so this entry is the evidence the pull request needs before it can merge.

**Evidence:**
- Pull request 129 head bbbd759e35561fc0fff0a2a7f164196caee063e3: package.json, packages/import/package.json and pnpm-lock.yaml only, a clean version bump with lockfile regeneration; the diff was read through the GitHub API and touches no test file or config.
- activity-log-check on that head failed with exactly one line, "1 file(s) changed but no entry was added or updated in docs/log/", reproduced locally with node scripts/activity-log-check.mjs against main e7e028b; this entry resolves that failure and nothing else.
- The other five required checks on that head were green: typecheck + service-role scan, lint + format (Biome), rep PWA browser tests, agent-policy-files and migrations + RLS matrix (run 44921138491). The migrations + RLS matrix job runs the whole RLS and invariant suite under this vitest, so the major bump is exercised by the required job itself, including the log-check rulings and attack probes.
- Not required and not gating: the secret scan still fails on the historical false positive pinned in .gitleaksignore on pull request 120, and the office browser job was still running at snapshot time with the same pre-existing role-isolation mismatch seen on main-based heads.
- This commit changes the head, so CI re-runs on it; the merge goes ahead only with the six required checks green on the final head, as a merge commit pinned to that head (ACTIVITY.md section 10).
- Not run locally: the full db:test under vitest 5; the migrations + RLS matrix job in CI is the evidence for it.

**Next / needs:** merge pull request 129 when its required checks are green on the head this entry creates; report the merge commit SHA.

Security checklist:
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20) (a test-runner bump and this entry)
[x] No control weakened, skipped or temporarily disabled (H-16) (no test skipped or loosened; the same suite runs under the new runner and passes)
[x] Docs match code; deviations logged (H-25) (this entry documents the bump and the merge gate)
[x] Tests actually run; real results recorded (H-23, H-24) (CI results above; nothing claimed without a run)
[n/a] RLS, append-only, SECURITY DEFINER functions, audit trigger, vault and governance rules: no database, auth or vault object is touched
