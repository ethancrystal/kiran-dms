# 2026-11-10 23:55 PKT · Claude · Fable 5.2 · branch claude/log-reading-rule · TASK
**Task:** — (build process text; areas: docs/ACTIVITY.md sections 0, 2, 4, 16 and Appendix A, AGENTS.md, CLAUDE.md, SPEC.md section 7 line, the reminder string in scripts/agent-preflight.mjs)
**What / why:** Applies the DECISION 2026-11-10-mj-log-reading-rule. Every statement of "the 20 newest entries in docs/log" now reads "the 5 newest entries in docs/log for your task's area", and ACTIVITY section 4 gains one bullet that says how to find them: by file name and by searching for the task id, requirement IDs and the tables, functions or screens touched; the newest entry about the control when the task touches security, money, stock or approvals; the DECISION or BLOCKER entry itself when the task rests on one; say so when the area has fewer than 5. The section 3 overlap check is unchanged. AGENTS.md and CLAUDE.md stay identical. One line of code changed: the reminder text the preflight prints. No rule about evidence, append-only, the archive, entry kinds or CI changed, and no top-level heading in ACTIVITY.md changed.
**Left as they are:** three plan files under docs/plans (hermes.md, the P1-09 plan and the storefront agent prompts) still tell their executor to read 20 entries. They belong to other tasks, and reading more than the rule asks is harmless.
**Evidence:** base f94547f, worktree clean, pnpm agent:preflight before the edit: PREFLIGHT OK. No open pull request (gh pr list empty). After the edit: cmp AGENTS.md CLAUDE.md: identical. git grep "20 newest" outside docs/log: only the three plan files above. The results of node --test scripts/agent-preflight.test.mjs, pnpm agent:preflight and pnpm activity:check origin/main HEAD after the edit are in the addendum below. Not run: pnpm db:test, typecheck, lint, the Playwright suites (no migration, app code or test changed; CI runs them).
**Next / needs:** MJ's OK to merge.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (n/a: no table or policy)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (n/a; the log's own append-only rule is unchanged)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (n/a)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) (n/a)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16) (the reading duty is narrowed by MJ's decision; no check, test or log rule is removed)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24) (see the addendum)

Addendum 2026-11-11 00:10 PKT, same task, after the edit:
**Evidence:** node --test scripts/agent-preflight.test.mjs: 12 tests, 12 pass, 0 fail. pnpm agent:preflight: PREFLIGHT OK. pnpm activity:check origin/main HEAD on the commit: OK, 2 new log entries, 7 changed files.
