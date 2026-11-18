# 2026-11-18 14:53 PKT · Copilot · Copilot SDK · claude-p1-12-acceptance-guards · TASK
**Task:** — (system documentation inventory and safe deduplication; no requirement IDs)
**What / why:** Removed only the untracked docs/audit-2026-10-31/PLATFORM-SPEC.md. It repeated docs/14 and docs/16, had no references outside its own creation log, and contradicted the approved Phase 1 public-shop scope in docs/ACTIVITY.md. Kept the two referenced superpowers design specs and all seven remaining audit files because they contain unique plans, requirement matrices, or decision evidence. Kept all existing logs unchanged because the log is append-only.
**Evidence:** git status and branch inspection showed claude/p1-12-acceptance-guards, two pre-existing commits ahead, and unrelated untracked work preserved. pnpm agent:preflight: exit 0, PREFLIGHT OK. Inventory found 2 superpowers files and 8 audit files before cleanup; SHA-256 comparison found no exact duplicates. Cross-references in AGENTS.md, CLAUDE.md, SPEC.md, docs/04-domain-model.md, docs/11-roadmap.md, docs/12-decisions-and-open-questions.md, docs/16-project-completion-goal.md, and docs/ACTIVITY.md justified retaining the referenced material. After cleanup, PLATFORM-SPEC.md is absent; 2 superpowers files and 7 audit files remain. pnpm typecheck: exit 0. pnpm -r --if-present test: exit 0, 4 files passed, 59 tests passed, 5 expected failures. pnpm lint: exit 1, 224 files checked, 2 errors, 39 warnings, 43 infos. pnpm activity:check: exit 1; the filtered output did not expose a detailed finding. The preceding 2026-11-18-claude-platform-spec entry reports a commit-range gitleaks finding; this check is not claimed as passing. pnpm db:test ran for about 15 minutes without output beyond startup and was stopped; no test result is claimed. Cleanup log commit: ab5ae89. No code, migrations, status-board rows, existing logs, or unrelated untracked files were changed.
**Next / needs:** No further safe duplicate in the two folders was identified. P1-12 remains NOT STARTED on the board despite logged implementation on its branch; this review did not alter task status. Re-run activity:check after the existing commit-range finding is resolved.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role matrix tests added/updated (n/a)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (n/a)
[x] Mutations via SECURITY DEFINER function, pinned search_path, idempotent (n/a)
[x] Audit trigger present; hash chain verifies (n/a)
[x] No vault/supplier/cost data outside vault; leakage tests pass (n/a)
[x] No secrets / real personal data / real supplier data added (n/a)
[x] Governance powers still owner-only + AAL2 (unchanged)
[x] No control weakened, skipped or temporarily disabled
[x] Docs match code; deviations logged (no code changed)
[x] Tests actually run; real results recorded (typecheck and package tests passed; lint failed; database suite has no result yet)
