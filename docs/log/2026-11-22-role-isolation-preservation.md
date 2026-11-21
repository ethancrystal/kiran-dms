# 2026-11-22 02:05 PKT · AutoClaw · AutoClaw runtime · chore/preserve-role-isolation-2026-11-22 · TASK

**Task:** — (preserve the three role-isolation investigation reports and the three pull-request body drafts stranded on a merged branch; docs and research only)

**What / why:** The 2026-11-22 00:54 snapshot committed 17 files on fix/roles-coverage-salon-refusal at 86f3d83 and bd49118. That branch's pull request 130 was already merged into main at 0dad9f7, and the two commits were never pushed, so no pull request carried them. A read-only review found that the snapshot duplicated five files byte for byte with open pull request 132, duplicated the evidence set carried by pull request 134, and committed the second-revision plan marked DRAFT FOR MJ REVIEW while pull request 134 carries the approved third revision. This entry and its commit consolidate only the unique material on a fresh branch cut from origin/main at 0dad9f7: the three role-isolation reports and the three draft pull-request bodies. backend-inventory.md, derived/fe-plan/* and the alignment plan are deliberately not re-added; pull request 132 and pull request 134 already carry them, and the stale second-revision plan must not land beside the approved one. The original snapshot entry remains on the old branch as the record of that abandoned commit; this entry supersedes it as the landing record.

**Evidence:** The consolidated artifact blobs are identical to the snapshot commit: git checkout bd49118 with .internal/role-isolation-git-archaeology.md, .internal/role-isolation-office-shell-salon.md, .internal/role-isolation-salon-app-guard.md and the three .internal/pr-body-drafts files; git status showed exactly those six additions before this log entry. Branch checks in the new worktree: node scripts/agent-preflight.mjs returned PREFLIGHT OK; node scripts/activity-log-check.mjs returned activity-log-check OK; git diff --check returned no whitespace errors. A targeted pattern scan of the six source files for JWT, sk-, ghp_, connection-string and private-key shapes returned no matches. The review that produced this consolidation ran git rev-list --left-right --count origin/main...HEAD (1 2), compared blob hashes against origin/chore/preserve-uncommitted-2026-11-21 and origin/docs/fe-alignment-mandate, confirmed all 12 registered worktrees clean, and spot-checked the reports' code citations against apps/web/proxy.ts, apps/web/app/office/mfa/page.tsx and apps/web/lib/outbox/gate.ts. No lint, typecheck, unit tests, database tests or builds were run because this branch adds documentation and evidence files only. No production action or hosted-database operation was performed.

**Next / needs:** Open the pull request for this branch and report its URL and check status. Pull request 132 remains the carrier of the inventories, the redacted gitleaks report and the earlier evidence copies; pull request 134 remains the carrier of the approved plan and the canonical evidence set under docs/coverage/evidence. Do not merge this branch or either carrier without MJ's approval in chat for that specific pull request. If either carrier is closed, restore its files from 86f3d83 rather than re-committing them here.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13): n/a, no database object changed
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07): n/a, no database object changed
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08): n/a
[x] Audit trigger present; hash chain verifies (H-17): n/a
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05): reviewed reports contain schema and function inventory only, no supplier records or cost data
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20): pattern scan found no credential value; the service_role string appears only as the database role name in explanatory text
[x] Governance powers still owner-only + AAL2 (H-15): n/a, no permission changed
[x] No control weakened, skipped or "temporarily" disabled (H-16): n/a, no control changed
[x] Docs match code; deviations logged (H-25): this is a preservation snapshot; no implementation or business-rule claim changed
[x] Tests actually run; real results recorded (H-23, H-24): preflight and the activity check ran; application suites are not applicable to a docs-only branch and are explicitly not run

Continuation 2026-11-22 02:07 PKT

**What / why:** Pull request 138 opened from this branch against main at 0dad9f7, carrying the six artifacts and this entry. No merge performed.

**Evidence:** https://github.com/ethancrystal/kiran-dms/pull/138. The activity-log-check job passed on the first head; the remaining jobs were queued or in progress when this line was written. The diff is 7 files and 463 insertions, all documentation and evidence.

**Next / needs:** MJ's approval in chat is required before any merge (ACTIVITY section 10). Pull request 132 and pull request 134 remain the carriers of the inventories and the approved plan.
