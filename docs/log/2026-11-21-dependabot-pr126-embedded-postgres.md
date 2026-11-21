# 2026-11-21 21:10 PKT · AutoClaw (MJ's session agent) · AutoClaw runtime · dependabot pull request 126 · TASK

**Task:** - (dependency housekeeping: merge Dependabot pull request 126, embedded-postgres 17.9.0-beta.16 to 17.9.0-beta.17; areas: package.json, pnpm-lock.yaml)

**What / why:** Dependabot opened pull request 126 bumping embedded-postgres, the throwaway Postgres the db:test suite starts, from 17.9.0-beta.16 to 17.9.0-beta.17. MJ ordered in chat on 2026-11-21 to process the open pull requests sequentially. A bot cannot write the log entry that the repo's activity-log-check (a required check) demands for every code change, so this entry is the evidence the pull request needs before it can merge.

**Evidence:**
- Pull request 126 head ec190feb2041045fcdc4a8c5d5cb8304379d54c3: package.json and pnpm-lock.yaml only, a clean version bump with lockfile regeneration; the diff was read through the GitHub API.
- activity-log-check on that head failed with exactly one line, "1 file(s) changed but no entry was added or updated in docs/log/", reproduced locally with node scripts/activity-log-check.mjs against main e7e028b; this entry resolves that failure and nothing else.
- The other five required checks on that head were green, including migrations + RLS matrix (run 44921089873), which starts this exact embedded Postgres against the full migration set, so the bumped version is exercised end to end by the required job itself.
- Not required and not gating: the secret scan still fails on the historical false positive pinned in .gitleaksignore on pull request 120, and the office browser job was still running at snapshot time with the same pre-existing role-isolation mismatch seen on main-based heads.
- This commit changes the head, so CI re-runs on it; the merge goes ahead only with the six required checks green on the final head, as a merge commit pinned to that head (ACTIVITY.md section 10).
- Not run locally: the full db:test against the beta bump; the migrations + RLS matrix job in CI is the evidence for it.

**Next / needs:** merge pull request 126 when its required checks are green on the head this entry creates; report the merge commit SHA.

Security checklist:
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20) (a dependency version bump and this entry)
[x] No control weakened, skipped or temporarily disabled (H-16) (the test database version changes; every control and check still runs)
[x] Docs match code; deviations logged (H-25) (this entry documents the bump and the merge gate)
[x] Tests actually run; real results recorded (H-23, H-24) (CI results above; nothing claimed without a run)
[n/a] RLS, append-only, SECURITY DEFINER functions, audit trigger, vault and governance rules: no database, auth or vault object of the product is touched
