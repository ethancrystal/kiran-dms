# 2026-11-18 14:06 PKT · Copilot · Copilot SDK · claude-p1-12-acceptance-guards · TASK
**Task:** — (standalone Kiran DMS product specification; no requirement IDs)
**What / why:** Consolidated the supplied business and platform requirements into docs/audit-2026-10-31/PLATFORM-SPEC.md. The deliverable is written as a portable product brief: roles, customer and field workflows, orders, delivery, payments, stock, commission, Investor and Agent boundaries, supplier confidentiality, acceptance scenarios, and unresolved business decisions. It contains no implementation stack, programming-language names, source-file citations, or work-log references. Added a product-principle rule requiring existing repository setup and implementations to be reused; only genuinely missing capabilities are to be designed and developed from scratch.
**Evidence:** Read docs/ACTIVITY.md, the five newest area entries in docs/log/, docs/00-README.md, SPEC.md, docs/14-unified-business-domain-prompt.md, docs/16-project-completion-goal.md, and all seven supplied specification files. Read the governing decision entries for order, delivery, catalogue, commission, Investor, and payment scope. Ran pnpm agent:preflight: PREFLIGHT OK; existing untracked .internal/ and scripts/backup/ were preserved. Ran pnpm typecheck: exit 0. Ran pnpm lint: exit 1; Biome checked 224 files and reported 2 errors, 39 warnings, and 43 infos before any task edits. Ran pnpm db:test; the process stopped before a test summary, so no database-test result is claimed. Ran pnpm activity:check: exit 1; it reported that .gitleaks.toml in the existing commit range adds a line matching its PostgreSQL-URL secret pattern. This is unrelated to the specification and this task entry; no secret value was inspected or included. Ran git diff --check: exit 0. Checked PLATFORM-SPEC.md for implementation-language, source-file, and work-log references: none found. Added and verified the repository-reuse rule in the Product principles section. Current branch is claude/p1-12-acceptance-guards; existing open PR #109 is unrelated catalogue work. No implementation code or unrelated work was changed.
**Next / needs:** The portable product specification is complete. The activity check remains blocked by the existing .gitleaks.toml commit-range finding; baseline lint is red and the database suite did not finish. Do not treat any of these as passing results or alter unrelated security configuration for this task.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role x table tests added/updated (H-13) (n/a: product specification only)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (n/a)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (n/a)
[x] Audit trigger present; hash chain verifies (H-17) (n/a)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) (n/a; no real supplier data)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (documented, not changed)
[x] No control weakened, skipped or temporarily disabled (H-16)
[x] Docs match code; deviations logged (H-25) (no implementation changed)
[x] Tests actually run; real results recorded (H-23, H-24) (lint and typecheck run; database suite stopped and is not claimed as passing)
