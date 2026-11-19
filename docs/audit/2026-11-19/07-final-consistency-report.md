# Final documentation consistency report (Phase 4)

**Date:** 2026-11-19 (PKT). **Branch:** `dev/docs-audit-2026-11-19`, cut from `main` at `d4b47ca`. Docs only: no application code, migration, test, script or production data changed; `docs/16-project-completion-goal.md`, `docs/ACTIVITY.md` and every existing log file are untouched. Supabase was not queried.

## 1. Results of the checks

| Check | Method | Result |
|---|---|---|
| Requirement ID uniqueness | Every `| XXX-nn |` row of doc 03 | 164 IDs, no duplicate, no numbering gap |
| Requirement ID integrity | Every requirement ID cited anywhere resolves to doc 03 | Pass, except the invoice-number pattern `INV-27-…` read as INV-27 (false positive, DA-008) |
| One record per requirement | `#### ID` headings across the module documents, cross-cutting and NFR files | 164 records, 0 duplicates, 0 missing, 0 unknown |
| Decision and blocker IDs | doc 12 and ACTIVITY §14, §15 | D-51 used twice (DA-005, open for MJ); D-44, B-43, B-44 unused (DA-006, DA-007); A-01 to A-24, OQ-01 to OQ-34, H-01 to H-27 unique |
| Blocker sweep (added after review) | Every blocker not RESOLVED in ACTIVITY §15 on `main`, with its status in PR 115, mapped to the requirements it bears on | 46 blockers listed in the [traceability matrix](03-requirement-traceability-matrix.md#blocker-sweep); 40 bear on 58 requirements, each of which names them in the matrix and in its record; 6 bear on no doc 03 requirement (process or storefront copy, reason given). B-60 is RESOLVED (D-61), so DA-042 was corrected |
| Acceptance criteria completeness | Every Phase 1 and undeferred record has at least one `AC-…` criterion | 206 criteria over 118 requirements; 0 Phase 1 requirement without criteria; 0 duplicate AC IDs |
| Record completeness | Each Phase 1 record has actor, preconditions, behaviour, rules, permissions, failure, criteria, tests, evidence | 0 missing fields |
| Internal links and anchors | Every relative Markdown link in tracked and new files (log files excluded), including `#anchor` targets | 0 broken after this branch (9 broken before: DA-001, DA-002) |
| Cross-document consistency | Conflicts register | 16 conflicts recorded (C-01 to C-16); 3 settled by a recorded decision (C-11 by D-61, C-12 by D-20, C-15 by MJ pending PR 115); 13 open for MJ |
| Business-rule consistency | Business-rules register names one source per rule family | Done; write-off, config authority, payout authority, per-salon price and refunds stay open |
| Role and permission coverage | 33 capability rows by actor in the coverage matrix | Every row names its database enforcement or says none; 5 rows NOT STARTED (bank deposit, receivable write-off, bank account details, vault, exports) and 3 PARTIALLY IMPLEMENTED (stock adjustment and write-off approval, full audit log viewer, reminder job) |
| RLS coverage | Migrations on `main`: `enable` and `force row level security` per created table | 77 of 77 tables enabled and forced |
| Server-side authorisation | Gap audit of the same commit: every client-callable function and its grants replayed | 197 client-callable functions; the UI calls none that is missing; no API routes or server actions; anon executes exactly two `app` functions (B-62) |
| Audit-trail coverage | `control.audit_row` triggers in migrations | 71 of 71 `public` tables have the trigger; 4 of 6 `control` tables (the audit log and its chain head are the trail itself); nightly mirror missing (DA-026); full-row images open (DA-033, DA-036) |
| Test-to-requirement traceability | Test files mapped to tasks and requirements | 72 test files (58 database, 10 browser, 4 full-stack browser), all mapped to a board task; 70 requirements cited directly by a test; 28 Phase 1 or undeferred requirements have no direct or task-level test (listed in the test matrix) |
| Docs against implementation | Requirement status derived from the board and evidence | VERIFIED 0, IMPLEMENTED — NOT VERIFIED 42, PARTIALLY IMPLEMENTED 40, NOT STARTED 31, UNVERIFIED (no board task) 5, DEFERRED — FUTURE PHASE 45, SUPERSEDED 1. SEC-03 was VERIFIED in the first version; after review it is IMPLEMENTED — NOT VERIFIED, because only its e-mail code and device binding are verified (P1-01) and its invitation step (SEC-16, P1-18) is not. Four board rows are behind `main` (DA-023, fixed by open PR 113) |
| AGENTS.md against CLAUDE.md | Byte comparison and `pnpm agent:preflight` | Identical after the shared one-line correction (DA-021); preflight OK |
| Supplier secrecy in the new documents | Reading the diff | No supplier identity, cost, real person, phone or CNIC in any new or changed file (H-01 to H-03) |

## 2. Disposition of every finding

Kinds: **Fixed** (changed on this branch), **For MJ** (decision recorded, nothing chosen), **After PR 113** or **After PR 115** (left to avoid a conflict with an open pull request), **Recorded** (accepted as is, with the reason), **Out of scope** (needs a code change, which this task may not make).

| Finding | Disposition | What was done or what is needed |
|---|---|---|
| DA-001 | Fixed | Eight module documents created under `docs/contexts/` |
| DA-002 | Fixed | Link repointed to `docs/plans/implemented/` |
| DA-003 | Fixed | Correction note added in the plan; historical text kept |
| DA-004 | Fixed | Same correction note |
| DA-005 | For MJ | Options (a) to (c) in the register; doc 12 unchanged |
| DA-006 | Recorded | D-44 is reserved by the plans; no doc 12 row invented |
| DA-007 | Recorded | B-43 and B-44 intentionally unused; blocker table not edited |
| DA-008 | Recorded | Tooling note only |
| DA-009 | Fixed | 118 standard records with 206 criteria; 45 later-phase requirements keep statement and status (H-22) |
| DA-010 | Fixed in part, For MJ | Measurement method and criteria added for all 12 NFRs; which NFRs are Gate 1 requirements is MJ's |
| DA-011 | For MJ | Doc 03 unchanged |
| DA-012 | Fixed in part | Status now derived in the traceability matrix and a note at the top of doc 03 says the embedded build notes are not the status of record; the notes themselves are kept |
| DA-013 | For MJ, After PR 115 | Amend doc 06 §2, doc 13 §9, CTL-06 and H-15 under a DECISION once PR 115 merges and the threshold question is answered |
| DA-014 | For MJ | |
| DA-015 | For MJ | |
| DA-016 | For MJ | |
| DA-017 | For MJ | |
| DA-018 | For MJ | |
| DA-019 | For MJ | OQ-34 |
| DA-020 | Fixed | Five doc 13 §9 annotations now say built, with task and pull request, not verified; no checker or threshold changed |
| DA-021 | Fixed | AGENTS.md and CLAUDE.md now say six CI jobs plus `agent-policy-files` |
| DA-022 | For MJ | The two vocabularies are kept apart and mapped in `docs/requirements/README.md`; MJ confirms or picks one |
| DA-023 | After PR 113 | PR 113 updates the four rows |
| DA-024 | After PR 113 | For the board-sync owner |
| DA-025 | Fixed | CONTEXT-MAP.md says PR 109 merged the catalogue data |
| DA-026 | For MJ | SEC-07 and SEC-12 shown as PARTIALLY IMPLEMENTED in the matrix; reopening P1-01 needs a CORRECTION by MJ or a verifier |
| DA-027 | For MJ | |
| DA-028 | For MJ | |
| DA-029 | After PR 115 | PIP-09's note changes once the decision is on `main` |
| DA-030 | Fixed | Actor catalogue in `docs/requirements/roles-and-permissions.md` |
| DA-031 | For MJ | Doc 06 §2 unchanged (H-26) |
| DA-032 | For MJ | B-61; the job is in the actor catalogue |
| DA-033 | For MJ | Must be settled before P1-05 is built |
| DA-034 | After PR 115 | Build the schema move in its own pull request |
| DA-035 | For MJ | |
| DA-036 | For MJ | |
| DA-037 | For MJ | |
| DA-038 | Fixed | One derived status matrix; other files point to it |
| DA-039 | Fixed | `docs/requirements/business-rules.md` names one source per rule family |
| DA-040 | Fixed | Glossary entry in the orders-delivery module |
| DA-041 | For MJ | OQ-33 |
| DA-042 | Recorded (corrected after review) | B-60 is RESOLVED on `main` by D-61, an exception D-49's own text does not mention; doc 12 not edited |
| DA-043 | For MJ | Interim home: `docs/requirements/cross-cutting-requirements.md`; CONTEXT-MAP.md says so |
| DA-044 | Fixed | Test traceability matrix; tagging tests with IDs is a later code change |
| DA-045 | Fixed | CONTEXT-MAP.md and `docs/agents/domain.md` say `docs/00` to `docs/16` |
| DA-046 | Fixed | CONTEXT-MAP.md records MJ's instruction |
| DA-047 | Recorded | Cross-referenced in `docs/requirements/README.md`; ACTIVITY.md not edited |
| DA-048 | For MJ | Already open blockers; shown per requirement in the matrix |
| DA-049 | Fixed | SEC-10 and NFR-10 shown as NOT STARTED |
| DA-050 | Out of scope | Retiring `app.owner_set_sku_price` is a code change |
| DA-051 | Recorded | Consistency pass, no issue |
| DA-052 | For MJ | B-48 (PENDING on `main` and in PR 115); conflict C-16; listed in the role matrix, roles-and-permissions §3, business rules and the PAY-10, CTL-04 and PAY-04 records |
| DA-053 | Fixed | Blocker sweep in the traceability matrix; each record names its open blockers; doc 03 unchanged |

## 3. Open pull requests and rebase order

- **PR 113** (`dev/board-sync-2026-11-19`) edits ACTIVITY.md board rows. This branch does not touch ACTIVITY.md: no textual conflict. DA-023 and DA-024 are left to it.
- **PR 114** (`dev/office-gap-screens`) adds office screens. No file overlap. Two records name its work as a gap on `main` (PIP-05 opening baseline, CTL-18 duplicate-phone list); after it merges, those gaps close and the matrix should be regenerated.
- **PR 115** (`dev/mj-decisions-2026-11-19`) adds `docs/decisions/2026-11-19-mj-answers.md` and ACTIVITY.md blocker rows. No file overlap. This branch cites its decisions as "PR 115, not merged" and makes no normative change because of them. Merge order does not matter for conflicts; if PR 115 merges first, the follow-up amendments in DA-013 and DA-029 can start.
- **PR 112** (`feat/rep-day-no-bag-count`) may change SPEC.md J1 step 1 ("check-in confirms the bag count"); the journeys file reads SPEC.md and would need regenerating.
- **PR 111** (`claude/p1-09-outbox-wiring`, titled "delete") was not inspected beyond its title.

## 4. Not done, and why

- The 45 later-phase requirements have no full record: H-22 keeps them out of scope until their phase is planned.
- Normative text in docs 03, 06, 12 and 13 was not rewritten where a business decision is open: ACTIVITY §1 forbids picking a reading, and H-26 reserves the permission matrix and thresholds to MJ.
- The database suite was not run by this audit (the embedded Postgres does not start on the audit machine); test counts are static counts of test cases, and CI on `main` is the run evidence.
- Criterion-level verification: no criterion is marked verified on its own; that needs a VERIFIED log entry naming the assertion.

## 5. Review fixes (after the review of PR 116 at `7ba5a69`)

- **F1:** every blocker not RESOLVED on `main` is now listed with its requirements (blocker sweep in the traceability matrix, an "Open blocker" line in each record, the open-decisions column). B-48 (PAY-10), B-49 (PAY-05), B-51 (CTL-17), B-45 (ORD-03), B-50 (CTL-06, CTL-07), B-28 (SAL-03) and B-30 (SAL-01, MAP-02, PIP-07) were the ones named by the reviewer. The role matrix's payment reversal row carries the B-48 and doc 13 §9 Rs 10,000 note; D-48 against doc 13 §9 is conflict C-16 and finding DA-052; the reversal limit and the other money questions are in roles-and-permissions §3.
- **Caveat:** every citation of MJ's 2026-11-19 answers now says "PR 115, not merged; docs not amended".
- **Write-offs:** roles-and-permissions says who approves is partly decided (PR 115) and the threshold is open, in both places.
- **Lazy creation:** `docs/agents/domain.md` now agrees with CONTEXT-MAP.md.
- **SEC-03:** narrowed, as above.
- **Correction:** DA-042 (B-60 is RESOLVED by D-61).
