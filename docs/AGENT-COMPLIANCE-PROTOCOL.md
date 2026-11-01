# KIRAN DMS — MANDATORY AGENT COMPLIANCE PROTOCOL

**Status:** Repository policy, installed at MJ's instruction (`docs/ACTIVITY.md` L-0188)  
**Scope:** Every AI coding agent, human contributor, subagent, verifier, and automated implementation workflow working in `ethancrystal/kiran-dms`.

This document supplements the existing repository rulebook. It does not replace it and does not grant authority to change business decisions, security controls, permissions, thresholds, production systems, or phase gates.

## 1. Authority and precedence

The existing authority hierarchy in `docs/ACTIVITY.md` §1 remains controlling. In particular, an agent must not use this file to override an explicit MJ decision, a fixed decision, the requirements/specification documents, or the existing hard rules.

If this protocol conflicts with `docs/ACTIVITY.md`, `docs/00-README.md`, the numbered planning documents, `SPEC.md`, or a current explicit MJ instruction:

1. Stop the affected work.
2. Do not choose the more convenient interpretation.
3. Record a `BLOCKER` in `docs/ACTIVITY.md` with the conflicting references.
4. Continue only on unrelated, unblocked work.

No instruction in this file authorizes production access, staging changes, a new third party, spend, real data entry, or a change to an owner-controlled decision.

## 2. Required startup sequence — every new task/session

Before reading, writing, testing, migrating, deploying, or running commands that could change repository or external state, the agent MUST:

1. Read `AGENTS.md` and/or `CLAUDE.md` as applicable to the tool being used.
2. Read this complete file: `docs/AGENT-COMPLIANCE-PROTOCOL.md`.
3. Read `docs/ACTIVITY.md` in full, including rules, status board, active and released claims, blockers, pending decisions, assumptions, and the last 20 log entries.
4. Read `docs/00-README.md`, `SPEC.md`, and every source document referenced by the requirement IDs in the proposed task.
5. Run `pnpm agent:preflight` from the repository root. A failure is a stop condition until understood and resolved. Do not bypass it.
6. Inspect `git status`, the current branch, recent commits, existing diffs, untracked files, and any existing user work. Do not overwrite, reset, clean, stash, or discard work that you did not create.
7. Check the status board, active claims, blockers, assumptions, pending decisions, and any in-flight pull request that overlaps the proposed files, database objects, UI, or business workflow.
8. Establish the required baseline on a feature branch, following `docs/ACTIVITY.md` §2. Record each command and its actual result.
9. Append a correctly signed `SESSION-START` entry and create a non-overlapping claim before making changes.

A `SessionStart` hook reminds Claude Code of this file and reports the branch and worktree state (section 10). That injection does **not** waive the requirement to read `docs/ACTIVITY.md` and task-specific source documents, inspect the worktree, record a session, or claim the task.

If the task cannot be claimed without overlap, do not edit the overlapping area. Log or report the blocker and select an unrelated task only if authorized by the project workflow.

## 3. Before implementation — written preflight report

Before changing code, report in the working session:

- Repository and current branch.
- Base commit and working-tree state.
- Existing uncommitted/untracked changes and how they will be preserved.
- Session-start log entry and claim ID.
- Requirement IDs and source documents being implemented.
- Exact files, database objects, RPCs, screens, and tests expected to change.
- Existing implementation and reusable components discovered.
- Active claims and overlapping pull requests checked.
- Relevant blockers, pending MJ decisions, and approved assumptions.
- Baseline commands and pass/fail results.
- Explicit exclusions and expected handoff criteria.

Do not invent requirement IDs, business behavior, user permissions, product catalogue data, pricing, acceptance thresholds, or test evidence.

## 4. Implementation rules

The repository's existing rules remain mandatory. In addition:

- Work only on an authorized feature branch; never develop directly on `main`.
- Implement the smallest complete vertical slice that satisfies its documented requirements.
- Trace each user action through UI, server action/API/RPC, database function/table, authorization, persistence, audit event, and user-visible result.
- Do not mark a UI feature complete because a page renders, a button exists, a mock responds, or a build succeeds.
- Do not replace a real backend operation with a mock, hard-coded success, local-only state, or placeholder unless the requirement explicitly calls for a prototype.
- Do not invent endpoint names, schema columns, business rules, permissions, or expected data shapes. Inspect the source of truth first.
- Keep migrations forward-only. Never silently edit a migration already applied to a shared environment.
- Do not weaken RLS, forced RLS, MFA, device approval, maker-checker, idempotency, audit, append-only behavior, masking, rate limits, or security tests to make a feature pass.
- Never delete, skip, quarantine, mute, loosen, or rewrite a failing test merely to obtain green CI. Fix the defect or document a genuine test defect with evidence and independent review.
- Use synthetic data only. Respect H-01 through H-27 and all other current hard rules.
- Keep documentation, code, tests, status board, and activity log synchronized.
- Do not start work from a later phase while the current phase gate is not accepted by MJ.

## 5. Mandatory feature verification

For every feature, test the actual workflow at the appropriate layers. The applicable acceptance evidence must include:

1. **UI:** reachable route, correct role-specific navigation, working controls, validation, loading state, success state, failure state, and empty state.
2. **Integration:** real frontend-to-backend invocation with the actual authenticated role/device/session context; no success-only mocks.
3. **Database:** persisted state, constraints, triggers, audit event, and transaction/rollback behavior.
4. **Authorization:** allowed and denied cases for relevant roles, own-territory and other-territory access, unauthenticated access, and AAL2/device requirements where applicable.
5. **Integrity:** idempotency/replay, duplicate submissions, concurrency, append-only behavior, maker-checker, server-time rules, and financial arithmetic where applicable.
6. **Negative paths:** invalid input, insufficient stock/credit, stale state, network failure, permission denial, replay, and other documented rejection cases.
7. **End-to-end:** the complete business journey in the real local stack where available, not only an isolated component test.
8. **Regression:** existing tests for adjacent workflows and security controls remain passing.

Record exact commands, environment type (unit, embedded database, local Supabase, staging), exit status, pass/fail counts, and relevant output. Never describe a local test as staging evidence or a build as end-to-end verification.

## 6. Status discipline — builder is not verifier

Preserve the existing status lifecycle and maker/checker rule in `docs/ACTIVITY.md` §7:

- Builder: may report `DONE (self-reported)` only after the relevant Definition of Done is met and evidence is recorded.
- Independent verifier: a different agent/person, or MJ, attempts to break the controls and records the verification evidence.
- MJ: alone accepts phase gates and owner-controlled decisions.

The builder MUST NOT mark its own work `VERIFIED`, claim independent verification, or mark a phase `ACCEPTED`. A second agent that merely repeats the builder's summary is not sufficient. The verifier must inspect the actual diff and attempt relevant negative/security tests.

## 7. CI and merge discipline

A pull request is not merge-ready merely because the author says it is complete. Before requesting merge:

- All required GitHub Actions checks must pass on the exact PR head commit.
- `activity-log-check` must pass.
- Database migrations and RLS matrix tests must pass against the configured local Supabase stack.
- Typecheck, service-role scan, workspace tests, production build, lint, and applicable browser tests must pass.
- No unresolved security finding or owner decision may be hidden in the PR description.
- The PR must include requirement traceability, evidence, risks, known limitations, and rollback considerations.
- A reviewer other than the author must review the changes.

Do not claim branch protection is active unless the GitHub repository settings have been inspected. A CI workflow existing in the repository does not make its check required; MJ must select the exact check in branch protection/rulesets.

## 8. Stop conditions

Stop the affected task and log a `BLOCKER` or `SECURITY-INCIDENT` as appropriate if:

- A required decision is pending or two authoritative documents conflict.
- An active claim or PR owns the same files, table, function, screen, migration sequence, or workflow.
- A change would affect production, staging, real business data, real supplier data, or real personal data without explicit authorization.
- A request would expose supplier identity, costs, margins, secrets, or personal information outside the approved boundary.
- A required test cannot run or a security test fails.
- A migration is already applied to a shared environment and a proposed edit would rewrite history.
- A third-party processor, paid service, external quota, or spend is introduced without MJ approval.
- The agent cannot establish the factual state of the repository or required evidence.

Do not ask an agent to guess an owner decision. Continue only with independent, unblocked work that the existing project rules permit.

## 9. Handoff requirements

Before ending a session, the agent MUST:

1. Inspect the complete diff, including untracked files.
2. Run all applicable checks and report failures honestly.
3. Confirm no user work was overwritten and no secrets/real data entered the diff.
4. Update only the relevant status/claim tables according to the append-only and activity-log rules.
5. Release its claim when complete or abandoned.
6. Append a `HANDOFF` entry with branch, commit, PR, files changed, test commands/results, incomplete work, blockers, and precise next actions.
7. State clearly whether the result is self-reported `DONE`, independently `VERIFIED`, or owner `ACCEPTED`.

A handoff must distinguish:

- Implemented and tested.
- Implemented but not tested.
- Tested and failed.
- Not implemented.
- Blocked on MJ.
- Awaiting independent verification.

No evidence means no completion claim.

## 10. What the automation does — and does not — prove

The repository preflight and CI checks are tripwires, not proof of comprehension or correct business behavior.

- `pnpm agent:preflight` checks that required policy files exist, root agent instructions reference them, the root instructions remain synchronized, `docs/ACTIVITY.md` Appendix A references this file, local Claude Code state (`.claude/settings.local.json`, `.claude/worktrees/`) is git-ignored, and the local branch is suitable for work. It reports working-tree changes without modifying them.
- The Claude Code `SessionStart` hook runs `node ${CLAUDE_PROJECT_DIR}/scripts/agent-preflight.mjs --hook` (exec form, so it works from any starting directory and under Git Bash or PowerShell) on startup, `/clear` and compaction, but not on resume, where the conversation already holds its output. It prints about 600 characters: branch, a capped worktree summary, the preflight result and a pointer to the two files to read. It deliberately does not paste this protocol or `CLAUDE.md`: both are read in full anyway, so pasting them would load the same text twice. It always exits 0 (a failing SessionStart hook only shows a notice, which would hide the warning) and writes nothing to the repository.
- The `agent-compliance` GitHub Actions workflow validates that the policy files, instructions, hook configuration, and preflight tests remain installed.
- The existing `activity-log-check` remains the authority for its documented append-only/activity-log checks.
- CI cannot prove that an agent understood every requirement, that every visible control is functionally correct, or that all security properties are safe. Those require source review, negative tests, independent verification, and MJ's approvals.

Never bypass a failed check. Fix the cause, or record the limitation and obtain the required human decision.

---

**Non-negotiable completion rule:** A feature is complete only when implementation, business behavior, security, tests, documentation, activity evidence, independent verification, and required owner acceptance agree. A green build alone is not completion.
