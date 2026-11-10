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
| `hermes.md` | `implemented/` | repository root |
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
| `2026-11-04-delivery-submission-approval.md` (PR B) | Built and merged as slice 4 (P1-21), with the invoice signature rule added on top by P1-31. Its Status line still reads NOT STARTED: stale. Step-level and complete. One follow-up it names, extending the timelines to its tables, is task H2 in `implemented/hermes.md`. |
| `2026-11-05-project-completion.md` (slices 1 to 7) | All seven slices merged (pull requests 53 to 65). It is a checklist per slice, not step-level, and it was enough because each slice had its own builder session. Nothing left. |
| `2026-11-05-final-review-checklist.md` | The end-to-end journey was built in slice 8 (its section 5), in a changed form the file records. One open line: the timeline maps, same as H2. |
| `hermes.md` | The fifteen-task work order. H1 to H15 are merged (pull requests 81, 82, 84 to 96, and 98 for H2 on main). Pull request 80 merged on 2026-11-07 and is the text of this file. Nothing in it is left to build. |

Common weakness: none of the work under these four plans has an independent verification entry. The
board rows P1-18 to P1-31 still read "awaiting CI" although their pull requests merged with green
checks. That is a board clean-up for a later pull request (C8 of the remaining-implementation plan).

### in-progress/

| Plan | Assessment |
|---|---|
| `2026-11-05-remaining-implementation.md` | The master list of what is left. Accurate as a list, but one line an item: not enough for an agent that only implements. Several lines are out of date: C1 is done (pull requests 71 and 73); REP-20, AUTH-08, AUTH-15 and AUTH-16 are done (74 to 77); M7 is merged (pull request 78); REP-07 was already built before the plan was written; the AUTH-05 residual looks closed in code; REP-05 describes the wrong screen. The audit that defines its item ids is not in the repository, so each item's meaning had to be read from the code. |
| `2026-11-05-frontend-structure.md` | The page map and the shared frontend foundation. Its work packages S-A (stock), S-C (routes), the office shell, Rep detail and the invoice views are built. Still open: the foundation F1 to F4 and F8 (generated types, typed RPC client, one component set, one table pattern, test helpers), S-B leftovers (receipt views, statement, deposits), S-D2 (digest, offboarding screen), S-F (offline). Its header still says DRAFT FOR REVIEW and its screen catalogue keeps older status words. It is a roadmap, not step-level: F1 to F4 and F8 need their own plan before anyone builds them. |
| `2026-11-08-p1-09-offline-rep-app.md` | Step-level draft plan for P1-09 (outbox, encrypted cache, offline shell, B-20, a whole offline day including check-in, check-out, deliveries and signatures), eleven tasks in five pull requests. Written 2026-11-08 against main at 4e0c690, revised 2026-11-09 with MJ's chat answers; not yet reviewed by MJ and none of it has been run. Its first pull request is a server migration that derives the rep's day from the captured time within 48 hours (a DEVIATION from "server time authoritative"; MJ must approve the window and apply the migration, H-19). Board row P1-09 is still NOT STARTED. |

### will-be-implemented/

| Plan | Assessment |
|---|---|
| `2026-11-06-not-yet-planned.md` | A register, not a plan. It lists every remaining item that has no step-level plan, with what blocks it. Nothing in it may be built until MJ answers the question beside it or a plan is written. |
| `2026-11-10-khsalon-storefront-overview.md` and its seven plan files and prompts file | Added 2026-11-10 (log entry `2026-11-10-claude-storefront-decisions`), not part of the 2026-11-06 assessment. The public shop at khsalon.com that MJ added to Phase 1 (D-51 to D-60): task-level plans A to G for board rows P1-32 to P1-38, with one prompt per plan. Draft for MJ's review; nothing built. Each executor must expand its plan to step level first. Plans C, D and F wait on blockers B-54 to B-59. |

## Verdict

- Plans ready for an implement-only agent: none. The Hermes work order (`implemented/hermes.md`) is done: H1 to H15 merged as pull requests 81, 82, 84 to 96, and 98. Pull request 80 merged on 2026-11-07 and supplied the fifteen-task text.
- Everything else that remains is either waiting for a decision of MJ's or has no step-level plan yet;
  both kinds are listed in `will-be-implemented/2026-11-06-not-yet-planned.md`.
- The largest unplanned pieces before a field pilot are the offline rep app (P1-09), the control layer
  (P1-08) and the security acceptance suite (P1-12).

## How many tasks until the system is ready for use (2026-11-06)

"Ready" means two different things. Task counts are given only where a step-level plan exists.

| Ready for | What it takes | Count |
|---|---|---|
| Office use with real data, reps online | MJ's go-live actions below, and a way to get the real salons in. The 15 tasks of `implemented/hermes.md` are merged | The Excel import, unless MJ enters every salon by hand |
| Field pilot and Gate 1 (doc 11) | The above, plus the work below, none of it planned yet | 4 work packages that cannot be counted in tasks until each is planned |

**The real salons.** `packages/import` is a dry run and writes nothing. The real import, P1-02 part d
(SAL-10), was never built and has no plan. Until it exists, each salon goes in one at a time through
Adding a salon from the office (`docs/runbooks/operator-guide.md`). Plan section A8 says "import salons
from Excel", which cannot be done today. Whether by-hand entry is acceptable depends on how many salons the
sheet holds (OQ-01, not delivered).

**MJ's go-live actions** are section A of `in-progress/2026-11-05-remaining-implementation.md`. A1, the
migrations, is done (decision file `2026-11-06-mj-apply-inactive-rep-cash`). The rest are still listed
there: owner account with TOTP, hosted sign-in settings, the web deployment variables and its protection,
rotating the service-role key, secret key and database password, the `KIRAN_SENSITIVE_TERMS` secret, the real
company details, products, prices and pictures, and adviser input on investor terms before any live payout.
Which of them are already done was not checked: the project is production, so even the read-only
`pnpm staging:smoke` needs MJ's OK. The app has never been exercised against the hosted project in this
review.

The four packages behind Gate 1, each tied to a criterion in doc 11:

| Package | Gate 1 criterion | Waits for |
|---|---|---|
| P1-09 offline rep app | 6, offline capture and sync in the field | A plan |
| P1-12 security acceptance suite and restore drill | 1 and 7 | A plan |
| Receipts delivered by SMS or WhatsApp | 3, every pilot payment has a delivered receipt | MJ's provider decision (OQ-11), then a plan |
| P1-05 supplier vault | 5, vault tests of doc 07 section 5 | A plan |

Gate 1 also needs 20 consecutive working days of pilot, which no task shortens. P1-08 (control layer) is
due before Gate 1 by the remaining-implementation plan's order, though no Gate 1 criterion names it.
