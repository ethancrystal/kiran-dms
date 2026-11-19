# 2026-11-17 13:15 PKT · Grok · grok-4.7 · branch claude/p1-12-acceptance-guards · TASK
**Task:** P1-12 Task 2 (NFR-07, NFR-12, SEC-10; doc 06 section 10.8). Areas: .gitleaks.toml, .github/workflows/ci.yml job secret-scan, supabase/tests/helpers/launch-acceptance.ts, supabase/tests/launch-acceptance.test.ts, docs/runbooks/launch-security-acceptance.md
**What / why:** Criterion 06.10.8 requires a secret scan of the tree as well as the dependency gate already on this branch. Job secret-scan installs gitleaks 8.30.1, proves the scanner on a token generated at run time in the runner temp directory, then runs gitleaks detect over this repository. The allowlist is only the public local-stack values already written in ci.yml, matched by value. The acceptance index cites job secret-scan and no longer lists the secret scan as blocked. Not committed: the plan says commit only when MJ asks.
**Evidence:** pnpm agent:preflight: PREFLIGHT OK, worktree was clean. Gitleaks pin: release v8.30.1, confirmed by gitleaks version printing 8.30.1. Canary in a temp git repo with a generated ghp_ token: exit 1, leaks found 1, secret redacted. Repository scan with .gitleaks.toml: exit 1, 419 commits, 72 leaks, all rule generic-api-key, all an eight-letter uppercase token on historical fixture lines (SMS_API_KEY, DOC_COUNTER_KEY, api_key) in the attack tests, docs/log/archive.md and an old ACTIVITY row, plus the same lines under .worktrees copies. No finding was allowlisted. Criterion 06.10.8 stays partial for that reason. pnpm db:test supabase/tests/launch-acceptance.test.ts: 14 passed, 11 todo. The todo lines are the pinned blocked criteria and the open 06.10.3 defect, and they are not counted as proof. pnpm activity:check: OK. Biome check on the two TypeScript files: no fixes. Not run: the full pnpm lint, and the GitHub Actions job (not pushed). The job will fail on the same history until MJ rules.
**Next / needs:** MJ's say-so to commit and push. The office TOTP gap on app.warehouse_availability is closed in 2026-11-17-grok-p1-12-warehouse-aal2. Criterion 06.10.8 stays partial until MJ rules on the fixture findings. Backup and restore stay unbuilt.

**Self-verification:** the builder is the author of this entry. This is not an independent verification.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (n/a: no table or policy)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (n/a)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (n/a: no mutation)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) (n/a)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24) (the scan result is filled in after the command)
