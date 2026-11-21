# 2026-11-21 23:00 PKT · AutoClaw (MJ's session agent) · AutoClaw runtime · zwork session k, branch docs/fe-alignment-mandate · TASK
**Task:** P1-40 (DECISION 2026-11-21-fe-alignment-decision; master prompt section 12A; areas: docs/audit-2026-10-31/master-prompt-2026-11-01.md, docs/log, docs/plans, docs/coverage/evidence, docs/ACTIVITY.md board)
**What / why:** MJ supplied the Complete Frontend, Backend Alignment and Data Presentation requirement on 2026-11-21, asked for it to be added to the existing master execution prompt rather than replacing it, and said "implement it". This docs-only pull request records the DECISION; inserts master prompt section 12A between sections 12 and 13 without renumbering and notes the amendment in the file header; commits the approved alignment plan (third revision) and the execution handoff at docs/plans/in-progress/; commits the six evidence reports under docs/coverage/evidence/ (frontend inventory, corrected office-route supplement, backend inventory, scope and governance, verification infrastructure, and MJ's external review verbatim); adds board row P1-40; and moves the two storefront plan files whose recorded state had outgrown their folder per docs/plans/README.md (plan A to implemented, plan G to in-progress).
**Evidence:** branch docs/fe-alignment-mandate created from origin/main 0dad9f7 in worktree .worktrees/fe-mandate; node scripts/agent-preflight.mjs exit 0; node scripts/activity-log-check.mjs exit 0, run in the worktree after all edits; read the commit SHA with git log -1 --format=%H, the SHA is not written here because this entry travels inside that same commit. Not run: lint, typecheck, tests, builds (no code in the diff); the e2e and db suites run in CI. The office browser job is red on main (roles-coverage.spec.ts line 264, run 44930031088) until C0a lands (docs/plans/in-progress/2026-11-21-execution-handoff.md section 2), so this pull request is expected to show that one job red until it merges origin/main after C0a.
**Next / needs:** MJ approves the merge in chat for this pull request (ACTIVITY section 10). PR 132 is superseded by this pull request and can be closed, or merged first and this branch merges main. C0a (P1-42), Phase B (P1-41) and C0 (P1-43) proceed per the execution handoff section 2.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role x table tests added/updated (H-13) (n/a: markdown only)
[x] Append-only respected; UPDATE and DELETE denied for all app roles (H-06, H-07) (n/a)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (n/a)
[x] Audit trigger present; hash chain verifies (H-17) (n/a)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) (n/a; no supplier or cost data anywhere in the diff)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20) (paths, commit shas, [Test] and [Dummy] names only; no keys, addresses or people)
[x] Governance powers still owner-only + AAL2 (H-15) (n/a; the amendment adds no permission)
[x] No control weakened, skipped or "temporarily" disabled (H-16) (n/a)
[x] Docs match code; deviations logged (H-25) (docs-only; the plan and handoff record the red CI baseline they inherit and the C0a repair)
[x] Tests actually run; real results recorded (H-23, H-24) (preflight and activity-log-check above; nothing else applies to a markdown-only diff)

Continuation 2026-11-21 23:10 PKT

**What / why:** The first push silently omitted the evidence set: .gitignore line 6 was a bare `coverage/` pattern, which ignores every directory named coverage anywhere, including the new docs/coverage/. Narrowed it to the root-anchored `/coverage/` so any root coverage output stays ignored and docs/coverage/ becomes trackable — master prompt section 12A.7 makes docs/coverage/ the home of the coverage matrix, so the pattern had to change. This second commit adds .gitignore and the six evidence files; pull request 134 updated in place.
**Evidence:** gh pr view 134 before the fix listed 8 files and no docs/coverage path; after the fix it lists 15 files including docs/coverage/evidence with the six reports; node scripts/activity-log-check.mjs exit 0 after this log change.
