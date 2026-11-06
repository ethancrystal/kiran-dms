# Plans: one place, three folders

Gathered on 2026-11-06 (log entry `2026-11-06-claude-hermes-handoff`). Every implementation plan of the
project lives here, sorted by where it stands. Status of a task still lives only on the board
(`docs/ACTIVITY.md` section 12); this folder says where a plan is, not whether a task is verified.

| Folder | Meaning |
|---|---|
| `implemented/` | The plan's work is merged to `main`. Kept as the record of how it was built. |
| `in-progress/` | Part of the plan is merged and part is still to build, or it is being worked now. |
| `will-be-implemented/` | Nothing built yet. Includes work that has no step-level plan or waits for MJ. |

Moving a plan between folders is a `git mv` in the pull request that changes its state, with the paths
in `docs/ACTIVITY.md` and `SPEC.md` updated in the same pull request.

## What moved, and from where

All six came from `docs/superpowers/plans/`; `hermes.md` came from the repository root.

| File | Now in | Was |
|---|---|---|
| `2026-11-03-office-orders-and-cards.md` | `implemented/` | `docs/superpowers/plans/` |
| `2026-11-04-delivery-submission-approval.md` | `implemented/` | `docs/superpowers/plans/` |
| `2026-11-05-project-completion.md` | `implemented/` | `docs/superpowers/plans/` |
| `2026-11-05-final-review-checklist.md` | `implemented/` | `docs/superpowers/plans/` |
| `2026-11-05-frontend-structure.md` | `in-progress/` | `docs/superpowers/plans/` |
| `2026-11-05-remaining-implementation.md` | `in-progress/` | `docs/superpowers/plans/` |
| `hermes.md` | `in-progress/` | repository root |
| `2026-11-06-not-yet-planned.md` | `will-be-implemented/` | new |

Old paths still appear where they cannot be changed: merged log entries in `docs/log/` (append-only),
comments in merged migrations, and comments in three test files. Read them through the table above.

## Planning documents that stay where they are

These are not moved, because `CLAUDE.md`, `AGENTS.md` and the rulebook name them by path, or because
they are specifications and not work plans.

| Document | What it is |
|---|---|
| `docs/16-project-completion-goal.md` | The business goal. Authoritative. |
| `docs/11-roadmap.md` | Phases and gate criteria. |
| `docs/15-field-sales-distribution-engineering-plan.md` | The engineering plan for the whole product (modules, workflows, acceptance matrix). |
| `docs/audit-2026-10-31/execution-map.md` | Work order and slices of the master prompt. |
| `docs/gate-0-checklist.md` | MJ's own actions before Gate 0. |
| `docs/superpowers/specs/2026-11-03-orders-delivery-commission-design.md` | Design behind the two order and delivery plans. |
| `docs/superpowers/specs/2026-11-05-reps-salons-catalogue-investors-design.md` | Design behind the completion slices. |
| `docs/specs/approval-lifecycle/` | Formal model of the approval registry (RFC issue 4); input to P1-08. |

## Assessment of every plan (2026-11-06, against `main` at `c2348fb`)

Read from the plans, the board, the log and the merged pull requests. Nothing here was re-tested.

### implemented/

| Plan | Assessment |
|---|---|
| `2026-11-03-office-orders-and-cards.md` (PR A) | Built and merged. Its Status block is from 2026-11-04 and still says the branch is not pushed: that is stale. Its "open for MJ" points live on as A-18 and B-14 in the rulebook. The plan itself is step-level and complete; nothing in it is left to build. |
| `2026-11-04-delivery-submission-approval.md` (PR B) | Built and merged as slice 4 (P1-21), with the invoice signature rule added on top by P1-31. Its Status line still reads NOT STARTED: stale. Step-level and complete. One follow-up it names, extending the timelines to its tables, is task H2 in `in-progress/hermes.md`. |
| `2026-11-05-project-completion.md` (slices 1 to 7) | All seven slices merged (pull requests 53 to 65). It is a checklist per slice, not step-level, and it was enough because each slice had its own builder session. Nothing left. |
| `2026-11-05-final-review-checklist.md` | The end-to-end journey was built in slice 8 (its section 5), in a changed form the file records. One open line: the timeline maps, same as H2. |

Common weakness: none of the work under these four plans has an independent verification entry. The
board rows P1-18 to P1-31 still read "awaiting CI" although their pull requests merged with green
checks. That is a board clean-up for a later pull request (C8 of the remaining-implementation plan).

### in-progress/

| Plan | Assessment |
|---|---|
| `2026-11-05-remaining-implementation.md` | The master list of what is left. Accurate as a list, but one line an item: not enough for an agent that only implements. Several lines are out of date: C1 is done (pull requests 71 and 73); REP-20, AUTH-08, AUTH-15 and AUTH-16 are done (74 to 77); M7 is open as pull request 78; REP-07 was already built before the plan was written; the AUTH-05 residual looks closed in code; REP-05 describes the wrong screen. The audit that defines its item ids is not in the repository, so each item's meaning had to be read from the code. |
| `hermes.md` | The step-level work order for ten unblocked items of the list above (H1 to H10). Complete enough to follow literally: branch, migration version, code, test, checks, commit message and stop conditions for each. Not executed: none of its SQL or test code has been run. Its Part 3 names what must not be started. |
| `2026-11-05-frontend-structure.md` | The page map and the shared frontend foundation. Its work packages S-A (stock), S-C (routes), the office shell, Rep detail and the invoice views are built. Still open: the foundation F1 to F4 and F8 (generated types, typed RPC client, one component set, one table pattern, test helpers), S-B leftovers (receipt views, statement, deposits), S-D2 (digest, offboarding screen), S-F (offline). Its header still says DRAFT FOR REVIEW and its screen catalogue keeps older status words. It is a roadmap, not step-level: F1 to F4 and F8 need their own plan before anyone builds them. |

### will-be-implemented/

| Plan | Assessment |
|---|---|
| `2026-11-06-not-yet-planned.md` | A register, not a plan. It lists every remaining item that has no step-level plan, with what blocks it. Nothing in it may be built until MJ answers the question beside it or a plan is written. |

## Verdict

- Plans ready for an implement-only agent: one, `in-progress/hermes.md` (ten tasks).
- Everything else that remains is either waiting for a decision of MJ's or has no step-level plan yet;
  both kinds are listed in `will-be-implemented/2026-11-06-not-yet-planned.md`.
- The largest unplanned pieces before a field pilot are the offline rep app (P1-09), the control layer
  (P1-08) and the security acceptance suite (P1-12).
