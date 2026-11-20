# 2026-11-14 00:17 PKT · Claude · Sonnet 5 · branch claude/root-readme · TASK
**Task:** none from the status board; docs-only, no requirement IDs (area touched: new root README.md)
**What / why:** The repository had no root-level README.md — only AGENTS.md, CLAUDE.md, SPEC.md and docs/00-README.md, so a visitor landing on the GitHub repo page saw nothing. Added a root README.md that states what Kiran DMS is in a few sentences, points to AGENTS.md/CLAUDE.md and docs/ACTIVITY.md as the mandatory reading before any repo work, lists the repo map and the commands already documented in CLAUDE.md, and explicitly defers live status to docs/ACTIVITY.md §12-§15 instead of restating it (so it cannot go stale). No code, schema, policy, or business-rule content changed.
**Evidence:** Branched claude/root-readme from origin/main (727ebb3) since the previously checked-out branch (claude/blind-stock-issues) carries its own unrelated, unmerged, already-committed work (blind stock confirmation security) and should not take unrelated commits. `git branch -r` and `gh pr list --state open` checked first: no open pull requests, no overlap. `pnpm agent:preflight`: PREFLIGHT OK. `pnpm activity:check` with no args failed closed (`docs/log/archive.md is new but the base holds no log to compare it with`) because the default base resolution did not land on origin/main in this environment; `node scripts/activity-log-check.mjs origin/main HEAD` run explicitly instead: "activity-log-check OK (0 new log entries, 0 changed files)" before this commit (the change was still unstaged at that point). Biome's `includes` only covers TS/JS files (checked biome.jsonc), so `pnpm lint` was not run against a markdown-only diff. Not run: pnpm db:test, pnpm typecheck, full pnpm lint, Playwright e2e — none apply to a documentation-only addition with no code/schema/policy change.
**Next / needs:** none. This is a self-contained docs addition; no blocker raised.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — n/a, no table touched
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) — n/a, no table touched
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — n/a, no function touched
[x] Audit trigger present; hash chain verifies (H-17) — n/a, unchanged
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) — n/a, README names no supplier or product data
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20) — checked by reading the diff
[x] Governance powers still owner-only + AAL2 (H-15) — n/a, unchanged
[x] No control weakened, skipped or "temporarily" disabled (H-16) — n/a, no control touched
[x] Docs match code; deviations logged (H-25) — README defers to docs/ACTIVITY.md for status rather than duplicating it, to avoid future drift
[x] Tests actually run; real results recorded (H-23, H-24) — preflight and activity:check results recorded above; no test suite applies to this diff

**Self-verification:** builder-verified only; no independent second agent reviewed this entry.
