# Requirements — core documentation (index)

Written by the documentation audit of 2026-11-19 at MJ's request. These files organise and standardise what the planning set already says; they add no requirement, permission or rule. They are derived reference material: the numbered planning documents, doc 16 and `docs/ACTIVITY.md` win on any difference (ACTIVITY §1), and doc 03 stays the index of requirement IDs. A difference found later is a finding for MJ, never a silent fix.

## 1. Business objectives

From doc 01 and doc 16 (doc 16 is MJ's authoritative business specification, D-33):

1. Replace the Excel and paper process of Kiran Company, a Karachi hair-care distributor to salons and parlors, with one system for salons, orders, deliveries, stock and money (doc 01).
2. No cheating by design: nothing is edited or deleted, every rupee and unit has a custody chain, and the manager cannot both commit and conceal (doc 00 fixed decision 8, doc 13).
3. Keep the classified supplier secret: visible only to the owner and a granted manager (D-03, doc 07, H-01).
4. Reps sign up salons and record their needs; only the office creates official orders (D-30, D-34); salons use their own portal (D-41).
5. Onboard a rep in one working day and work offline in the field (doc 01 success criteria, NFR-01).

## 2. Scope

| In scope now | Source |
|---|---|
| Phase 1 (MVP) as listed on the ACTIVITY §12 board, P1-01 to P1-38, including the D-41 additions (salon portal, invitations, commission payments, investor ledger, pictures, per-salon prices) and the public shop rows P1-32 to P1-37 (D-51 of 2026-11-10) | doc 11, ACTIVITY §12 |
| Phase 2 and 3 requirements are recorded and DEFERRED — FUTURE PHASE | H-22 |

Out of scope at any phase unless MJ decides: automated investor profit engine (D-40), recruitment pay for agents (AGT-06), real supplier data in the repository (H-02).

## 3. The documents

| Topic | Document |
|---|---|
| Objectives and scope | this file |
| User roles and permissions | [roles-and-permissions.md](roles-and-permissions.md) |
| User journeys and workflows | [journeys-and-workflows.md](journeys-and-workflows.md) |
| Functional requirements | one module document per context (below) and [cross-cutting-requirements.md](cross-cutting-requirements.md) |
| Business rules and constraints | [business-rules.md](business-rules.md) |
| Non-functional requirements | [non-functional-requirements.md](non-functional-requirements.md) |
| Acceptance criteria | inside each requirement record; all of them in the [acceptance criteria matrix](../audit/2026-11-19/05-acceptance-criteria-matrix.md) |
| Edge cases and failure scenarios | [edge-cases-and-failures.md](edge-cases-and-failures.md) and section 10 of each module document |
| Dependencies and integrations | [dependencies-and-integrations.md](dependencies-and-integrations.md) |

Module documents (bounded contexts of CONTEXT-MAP.md): [salon-pipeline](../contexts/salon-pipeline/CONTEXT.md), [field-operations](../contexts/field-operations/CONTEXT.md), [orders-delivery](../contexts/orders-delivery/CONTEXT.md), [money-credit](../contexts/money-credit/CONTEXT.md), [inventory](../contexts/inventory/CONTEXT.md), [supplier-vault](../contexts/supplier-vault/CONTEXT.md), [control-governance](../contexts/control-governance/CONTEXT.md); planned: [storefront](../contexts/storefront/CONTEXT.md).

Audit records: [docs/audit/2026-11-19/](../audit/2026-11-19/01-findings-register.md) (findings, duplicates and conflicts, traceability, role coverage, acceptance criteria, tests, final report).

## 4. The requirement record

Every Phase 1 requirement has one record in the module that owns it, with these fields:

| Field | Meaning |
|---|---|
| ID | The doc 03 ID, unchanged. IDs are never renumbered or reused; a superseded ID stays with its pointer (ORD-10). |
| Statement | Doc 03's text, verbatim. |
| Actor | Who is authorised to perform it. |
| Preconditions | What must be true before. |
| Expected behaviour | What the system does. |
| Business rules | The rules that apply, by ID (H-, D-, doc 13 §9). |
| Permissions | Who may and who may not, enforced in the database. |
| Failure and exceptions | What happens when it goes wrong. |
| Acceptance criteria | `AC-<requirement>-<n>`: an action and an observable result that a test or a person can check. |
| Tests | Test files citing the ID, and test files of its board task. |
| Implementation evidence | Board tasks and their status, plus functions, screens and migrations. |
| Known gap | What is missing, with the finding ID where there is one. |

Later-phase requirements keep their statement and status only; the full record is written when the phase is planned (H-22).

## Status vocabulary

Two vocabularies exist (finding DA-022, a decision for MJ). Until MJ decides, these documents use them as follows and never mix them:

- **Tasks** (the ACTIVITY §12 board): `NOT STARTED → IN PROGRESS → DONE (self-reported) → VERIFIED → ACCEPTED` (ACTIVITY §7).
- **Requirements** (these documents): the master-prompt words of AGENTS.md: NOT STARTED, PARTIALLY IMPLEMENTED, IMPLEMENTED — NOT VERIFIED, VERIFIED, BLOCKED, DEFERRED — FUTURE PHASE; plus SUPERSEDED for ORD-10 and "UNVERIFIED (no board task)" for an NFR no task claims.

A requirement's status is derived, never asserted: VERIFIED only when every board task citing it is VERIFIED and no gap is known; IMPLEMENTED — NOT VERIFIED when a citing task is merged or verified and no gap is known; PARTIALLY IMPLEMENTED when a gap is known or the task is only partly built; NOT STARTED when the citing tasks are not started or the record says "Not built". Merged work "awaiting an independent check" is never VERIFIED.

## 5. Precedence reminders

- Doc 16 (D-33) outranks everything except MJ's later explicit instruction.
- Permissions: doc 06 §2 is the matrix of record; thresholds: doc 13 §9. Changing either needs MJ's DECISION (H-26).
- Phase 1 started before Gate 0 by D-20, an exception to ACTIVITY §8.
- MJ's decisions of 2026-11-19 are recorded in open pull request 115 (`docs/decisions/2026-11-19-mj-answers.md`). These documents cite them as "PR 115, not merged" and change no normative text because of them.
