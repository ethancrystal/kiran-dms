# ACTIVITY — Mandatory Build Protocol and Live Progress Log (Kiran DMS)

> ## MANDATORY FOR EVERY AGENT, AI OR HUMAN
> You may not read, write, migrate, deploy, or test anything for Kiran DMS until you have read this file in full and logged a `SESSION-START` entry (§16). You may not stop working without a `HANDOFF` entry. Work with no log entry is treated as **not done** and may be reverted by MJ or a reviewing agent.
>
> This file is both the **rulebook** (§1–§11) and the **live record** (§12–§16: status board, claims, blockers, assumptions, log). The log is **append-only**. The system you are building is append-only for the same reason: history that can be edited cannot be trusted.

**Location:** while planning, `Kiran Company/plan/ACTIVITY.md`. When the repository is created (task P0-04), copy it to `docs/ACTIVITY.md` **once**; from that moment the repo copy is the only canonical one and this file gets a one-line pointer at the top. Never keep two live copies.

**Owner of the project:** MJ (Moiz Jamil). **Business:** Kiran Company, Karachi — hair styling and hair care distribution to salons and parlors. **System:** Kiran DMS (docs `00`–`13` in this folder).

---

## 0. The 60-second version

1. Read this file, then `00-README.md`, then the docs your task touches.
2. Claim your work in §13 **before** touching anything.
3. Obey the hard rules in §5. They are not preferences.
4. Log intent before, evidence after (§16). Evidence means commands run and real results.
5. Finish only when the Definition of Done (§6) is met. You never mark your own work *Verified* (§7).
6. If anything is unclear, conflicting, or needs a decision MJ hasn't made: **stop that task, log a BLOCKER, pick another task.** Never guess in a way that weakens security.
7. End every session with a HANDOFF entry and a green repo (§11).

---

## 1. Authority and precedence

When sources disagree, the higher one wins:

1. **MJ's current explicit instruction** (quoted or linked in a log `DECISION` entry).
2. **Fixed decisions** in `00-README.md` and the decision log in `12-decisions-and-open-questions.md`.
3. **Docs `01`–`13`** (requirements `03`, domain model `04`, security `06`/`07`/`13` are the strictest).
4. **This file.**
5. **Your own judgment** — last, and never to loosen a control.

Rules for gaps and conflicts:

- If a doc is silent on a security-relevant point, take the **more restrictive** option, record an assumption (§15), and tell MJ via a BLOCKER if other work depends on it.
- If two docs conflict, stop that task, log the conflict, and wait. Do not pick the convenient reading.
- **D-08 (manager vs. owner governance split) is pending MJ's confirmation.** Until MJ rejects it, build the split as documented in `06-security-plan.md` §2: manager = full operational access; governance powers (users, bank details, write-offs, price lists, commission plans, vault grants, configuration, audit log) are owner-only.

---

## 2. Session-start checklist (all steps required)

Log a `SESSION-START` entry that confirms each item.

1. Read this file in full: rules, status board, active claims, blockers, assumptions, and the last 20 log entries.
2. Read `00-README.md` and every doc referenced by the requirement IDs you intend to work on (doc 03 is the ID index).
3. Check **Active Claims** (§13): no one else holds your area. If a claim is stale (see §3), follow the stale-claim rule.
4. Check **Blockers and Pending Decisions** (§14) for anything touching your task.
5. Repo health, on a feature branch (never `main`): `git status`, install, run **lint, type-check, unit tests, and the RLS policy test suite**. Record the baseline. If the baseline is red, fixing it comes first or it is logged as a BLOCKER — you do not build on red.
6. Confirm your environment: you are on **local or staging**. You do not have, and must not request, production credentials unless MJ has approved it in a `DECISION` entry (H-19).

---

## 3. Claiming work

- Add a row to **Active Claims** (§13) *before* making any change. No claim, no code.
- A claim names: claim ID, agent, task ID from the status board, requirement IDs, the files/tables/areas you will touch, start time, planned finish.
- **One claim per area.** Two agents never work on the same table, function, or screen at once. Areas that always conflict (so claim carefully): the RLS helper functions, the audit trigger, the approval framework, the offline outbox, migrations numbering.
- Keep claims small — one requirement group, finishable in a session.
- **Stale claims:** a claim with no log activity for 24 hours is stale. Another agent may take over only after logging `CLAIM-RELEASED` (reason: stale) on the old claim, reading its last log entries, and checking the branch for uncommitted or half-applied work. Never delete a claim row — move it to "Released" with a note.
- Release your claim (`CLAIM-RELEASED`) when you finish or abandon the work.

---

## 4. The log — how it works

- Section 16 is **append-only**. New entries go at the **bottom**, numbered `L-0001`, `L-0002`, …
- **Never edit, reorder, or delete** an existing entry. To fix a mistake, append a `CORRECTION` entry that cites the entry ID it corrects.
- Timestamps are **Asia/Karachi (PKT, UTC+5)**, format `YYYY-MM-DD HH:MM`.
- Sign every entry with: agent name, model, and session/branch identifier. Humans sign with name.
- Entry types: `SESSION-START`, `CLAIM`, `PROGRESS`, `DECISION`, `ASSUMPTION`, `BLOCKER`, `DEVIATION`, `DONE`, `VERIFIED`, `HANDOFF`, `CLAIM-RELEASED`, `CORRECTION`, `SECURITY-INCIDENT`.
- **Log before and after.** Before: what you intend and why. After: what actually happened, with evidence.
- **Evidence** means: the exact commands you ran, the real outcome (pass/fail counts, error text), the commit SHA, and the PR/branch. Not "should work", not "looks fine". See H-23, H-24.
- The status board (§12), claims (§13), blockers (§14) and assumptions (§15) are *tables you update in place*, and every change to them must be mirrored by a log entry saying what changed and why. The log is the source of truth if they disagree.

---

## 5. Hard rules (non-negotiable)

These come straight from the planning docs. An agent that breaks one has failed the task regardless of whether the feature works. Rule IDs are referenced in log entries and reviews.

### Supplier and data secrecy

| ID | Rule |
|---|---|
| H-01 | Supplier identity, contacts, costs, lot numbers, POs and terms exist **only in the `vault` schema** (doc 07). Never in `public` tables, views, enums, column comments, seed data, fixtures, test snapshots, logs, error messages, commit messages, PR text, screenshots, docs, or this file. |
| H-02 | **Real supplier data never enters the repo, CI, staging, prompts, logs, or issue trackers.** Use obviously fake fixtures ("Dummy Supplier", "Source A"). MJ or the owner enters real supplier data into production by hand. |
| H-03 | Real salon phone numbers, CNIC numbers, bank account numbers and real people's names never go into the repo, fixtures, logs or prompts. Use synthetic data. |
| H-04 | All product names, sizes, weights and prices are **dummy until MJ delivers the catalogue (OQ-16)**. Mark dummy rows `[Dummy]`. Never invent real-looking branded products. |
| H-05 | Never expose cost, margin, or supplier columns through any view, report, export, PDF template, API response, or error that a non-grantee could reach. Vault data is returned only by `vault_api` functions that check the vault grant and AAL2. |

### Integrity of money, stock and history

| ID | Rule |
|---|---|
| H-06 | **Append-only tables** (doc 04, invariant 1: `visit`, `salon_note`, `discovery_run`, `stage_event`, `credit_event`, `payment`, `payment_allocation`, `cash_ledger_entry`, `stock_movement`, `audit_event`, `invoice`, `receipt`) get `INSERT` + `SELECT` only. No `UPDATE`/`DELETE` grant or policy to any application role. No ORM `update()`/`delete()` against them. Corrections are reversing rows. |
| H-07 | **No hard deletes** anywhere in `public`, `control`, `vault`. Soft-delete flags exist only on configuration entities (price lists, templates, territories). |
| H-08 | Every mutation of money, stock, stage, credit, approval or vault data goes through a `SECURITY DEFINER` function with a **pinned `search_path`**, explicit role + device + business-rule checks, and an **idempotency key**. No direct client `INSERT`/`UPDATE` on those tables. |
| H-09 | **Server time is authoritative.** `created_at`/`recorded_at` come from the database. Client timestamps are stored in separate columns as evidence only. |
| H-10 | **Balances are derived** (receivable, cash in hand, stock on hand = sums of ledger/movement rows). Never store an editable running balance. Any cached figure has a nightly integrity check. |
| H-11 | Invoice and receipt numbers are **gapless per financial year** (1 July–30 June), allocated inside the issuing transaction. |
| H-12 | **Maker ≠ checker** is a database constraint (`checker_id <> maker_id`) on every approval, not a UI rule. |

### Access control

| ID | Rule |
|---|---|
| H-13 | **RLS is enabled and forced on every table in the same migration that creates it.** Deny by default. A new table ships with its policies **and** its row in the RLS test matrix (role × table × operation) in the same PR. A table without both is not done. |
| H-14 | Reps read through **views** with masked phones and page caps (≤ 50 rows); they have no base-table access, no list export, no bulk download. Territory scoping is enforced by RLS, not by the UI. |
| H-15 | **Governance powers are owner-only and AAL2**: users, bank details, write-offs, price lists, commission plans, vault grants, configuration, audit log. Never grant these to the manager "for convenience" or for a demo. |
| H-16 | **Never weaken, bypass, disable or "temporarily skip" a control** — RLS, MFA, device binding, approvals, audit triggers, rate limits — to make a feature work or a test pass. If a control blocks the task, the design needs a decision: log a BLOCKER. |
| H-17 | Every table in `public` and `vault` has the audit trigger. `control.audit_event` is writable by triggers only; the hash chain (`prev_hash`) must verify. |

### Secrets and environments

| ID | Rule |
|---|---|
| H-18 | The Supabase **service-role key** lives only in Edge Function secrets and CI secrets. Never in client code, never in `NEXT_PUBLIC_*`, never in logs. CI scans bundles for it. |
| H-19 | **No production access** — no migrations, SQL, deploys, data reads — without MJ's explicit approval recorded in a `DECISION` entry that quotes the approval. Production changes go through CI, forward-only migrations, never by hand outside the break-glass procedure (doc 06 §8). |
| H-20 | No secrets in git. `.env*` files are git-ignored. A leaked secret is a `SECURITY-INCIDENT`: rotate first, log second. |
| H-21 | Third-party services (maps/places, WhatsApp BSP, SMS, email, error tracking) are reached **only through adapters**. No new processor of salon or supplier data, and no analytics/session-replay/error payload that can capture vault screens or phone numbers, without MJ's approval. |

### Scope and honesty

| ID | Rule |
|---|---|
| H-22 | Build only what is in the **current phase** (doc 11). New ideas become an open question or proposed decision in doc 12 — not code. |
| H-23 | **Never claim done, passing, or working without running it.** Report failures plainly. A failing test is never deleted, skipped, `.only`'d around, or loosened to pass; fix the cause or log a BLOCKER. |
| H-24 | **No fabricated evidence**: no invented test output, commit SHAs, URLs, benchmark numbers, or data. If you could not run something, say so. |
| H-25 | **Docs and code never silently diverge.** If the implementation must differ from a doc, change the doc in the same PR and log a `DEVIATION`. If the change affects a fixed decision or the permission matrix, it needs MJ's approval first (H-26). |
| H-26 | You may not change **fixed decisions**, the **permission matrix**, **custody chains**, or **thresholds** in doc 13 §9 without MJ's approval logged as a `DECISION`. |
| H-27 | Collect the minimum personal data. No new column that can hold supplier identity or free-text secrets in `public`. |

---

## 6. Definition of Done (every task)

A task may be logged `DONE` only if **all** of these are true. Paste this checklist into the `DONE` entry and tick it honestly.

- [ ] The requirement IDs claimed are implemented as written in doc 03 — or every difference is logged as a `DEVIATION` with the doc updated.
- [ ] Migration included, forward-only, applies cleanly to a fresh database **and** to the previous migration state.
- [ ] Every new/changed table has RLS enabled and forced, policies written, and **policy tests for rep (own territory), rep (other territory), manager, owner, and unauthenticated** (H-13).
- [ ] If the table is append-only: a test proves `UPDATE` and `DELETE` fail for every application role (H-06).
- [ ] Mutations go through `SECURITY DEFINER` functions with pinned `search_path` and idempotency; a test replays the same call twice and proves one effect (H-08).
- [ ] The audit event is produced and the hash chain still verifies (H-17).
- [ ] No vault leakage: tests prove a rep token and a non-granted manager token get nothing from vault functions, and that customer-facing document templates render no vault field (H-01, H-05).
- [ ] Rep-facing features work **offline** and sync idempotently, and server-side rejection after sync is handled and shown to the rep (NFR-01).
- [ ] Money arithmetic uses integer paisa (or `numeric`), never floats; rounding is tested.
- [ ] Lint, type-check, unit tests, RLS suite all pass locally **and** in CI. Numbers recorded in the log.
- [ ] The relevant doc(s) are accurate; the status board row is updated; no TODO/FIXME left that hides a missing control.
- [ ] No secrets, real personal data, or supplier data in the diff (H-01–H-04, H-20) — checked by reading the diff, not assumed.
- [ ] A `DONE` entry is logged with evidence (commands, results, commit SHA, branch/PR).

---

## 7. Maker ≠ checker applies to the build too

Status values on the board: `NOT STARTED` → `IN PROGRESS` → `DONE (self-reported)` → `VERIFIED` → `ACCEPTED`.

- The agent that built a task may set it to `DONE (self-reported)` and **no further**.
- `VERIFIED` is set only by **a different agent or by MJ**, and only after a `VERIFIED` log entry that records an *attempt to break the control*, not just a green test run. At minimum, the verifier, from a clean checkout:
  1. Runs the full suite and the RLS matrix.
  2. Tries to read vault data with a rep token and with an un-granted manager token.
  3. Tries `UPDATE`/`DELETE` on an append-only table as each application role.
  4. Tries to read another territory's salons as a rep, and to export/list-dump salons.
  5. Tries to edit or reverse a record without a second approver, and to approve one's own request.
  6. Tries to replay an offline mutation and to submit a backdated client timestamp.
  7. Inspects the diff for secrets, real data, and weakened controls.
- `ACCEPTED` (phase gate) is set **only by MJ** (§8).
- An agent that discovers a defect in work marked `VERIFIED` reopens it with a `CORRECTION` and sets it back to `IN PROGRESS`.

---

## 8. Phase gates

Phases and exit criteria are in `11-roadmap.md`. **No agent starts a task in Phase N+1 until Gate N is `ACCEPTED` by MJ**, except Phase 0 prerequisites that Phase 1 needs. Gate sign-off is recorded in §12 and logged.

| Gate | Condition (see doc 11) | Status | Signed by | Date |
|---|---|---|---|---|
| Gate 0 | Owner and manager log in with MFA to an empty office app; Excel import dry-run clean; Phase 0 decisions logged; ACTIVITY enforcement active | NOT PASSED | — | — |
| Gate 1 | Doc 06 §10 security acceptance list; 20 pilot working days with zero unexplained variance; 100% of pilot payments with a delivered receipt; vault tests (doc 07 §5); offline field test; backup restore drill | NOT PASSED | — | — |
| Gate 2 | ≥ 3 reps live; system-generated routes; reorder follow-through ≥ 85%; receivables ageing improving; anomaly digest reviewed daily | NOT PASSED | — | — |
| Gate 3 | Phase 3 scope complete; external security test done | NOT PASSED | — | — |

---

## 9. Stop and ask MJ (do not proceed on your own)

Log a `BLOCKER` and wait for MJ's answer in these cases:

1. Any change to a fixed decision, the permission matrix, the custody chains, or doc 13 thresholds.
2. D-08 outcome, or any other decision still marked *Pending* in doc 12.
3. Anything that touches **production** (data, config, migrations, deploys, DNS, keys).
4. A new third-party service, a new data processor, or any spend (BSP, maps/places quota, SMS sender registration, domains, paid tiers).
5. Deleting, anonymising, or exporting real data.
6. Anything that would show supplier identity or cost to anyone other than the owner (or an explicitly granted manager).
7. A control that cannot be built as specified, or two documents that conflict.
8. A security finding in existing work (also log `SECURITY-INCIDENT` if exploitable or if data may have been exposed).
9. A requirement whose acceptance depends on an unanswered open question and has no safe documented default.

If MJ is not available, keep working on unblocked tasks. **Silence is not approval.**

---

## 10. Human-only actions (agents never do these)

- Creating the real **owner** account, setting its MFA, and holding recovery codes.
- Entering **real supplier data** and uploading real supplier documents.
- Registering WhatsApp Business / SMS sender IDs and accepting vendor terms; entering payment methods.
- Provisioning, rotating or sharing **master keys**, service-role keys, and encryption keys; creating the off-site backup account and key.
- Approving the first real rep's device, issuing real stock, and running real handovers.
- Signing phase gates (§8) and approving production releases (H-19).
- Calling real salons for balance confirmations.

An agent may *prepare* checklists, scripts and runbooks for these, but must not perform them or ask for the secrets to perform them.

---

## 11. Handoff protocol

Before ending a session:

1. Commit or stash all work on your branch with a clear message; no half-applied migrations, no failing tests you introduced, no stray debug code, no secrets.
2. Run the full suite once more and record the result.
3. Update the status board row and release or renew your claim.
4. Append a `HANDOFF` entry:
   - **State:** what works, what doesn't, branch/PR.
   - **Next steps:** the exact next action, ordered.
   - **Gotchas:** anything surprising, flaky tests, hidden dependencies, assumptions made.
   - **Open blockers** you raised and who must answer.
5. If you stopped mid-task for any reason (tool failure, context limit, timeout), say so plainly in the entry and list what is unverified. Do not leave work looking finished when it is not.

The next agent starts from your `HANDOFF` entry. A missing handoff is a defect; the next agent logs it as one.

---

## 12. Status board

Updated in place; every change mirrored in the log. Task IDs: `P{phase}-{nn}`. Requirement IDs refer to doc 03. "Claimed by" is the Claim ID from §13.

### Planning (complete)

| ID | Work item | Status | Date |
|---|---|---|---|
| PLAN-01 | Planning set docs `00`–`13` written to `Kiran Company/plan/` | DONE | 2026-10-25 |
| PLAN-02 | This protocol (ACTIVITY.md) | DONE | 2026-10-25 |

### Phase 0 — Foundations

| ID | Work item | Refs | Status | Claimed by |
|---|---|---|---|---|
| P0-01 | Resolve Phase 0 decisions: D-08, OQ-01–04, 06–08, 11–13, 16 (MJ answers; log each) | doc 12 | NOT STARTED | — |
| P0-02 | Load and clean the Excel; build the import mapping and dry-run | SAL-10, OQ-01 | IN PROGRESS (tool DONE, self-reported, redone in L-0088, L-0098, L-0106 and L-0120 after L-0085 and L-0116; real-file run is MJ, gate-0-checklist action 7) | C-001 |
| P0-03 | Draft Karachi territories; choose the pilot territory and pilot rep | PIP-01, OQ-13 | NOT STARTED | — |
| P0-04 | Create the repo, CI, Supabase staging + prod, Next.js skeleton; copy this file to `docs/ACTIVITY.md` | doc 05 | IN PROGRESS | C-001 |
| P0-05 | Owner/manager auth with mandatory TOTP MFA (owner account creation is human-only, §10) | SEC-02, SEC-04 | IN PROGRESS | C-001 |
| P0-06 | RLS policy test harness (role × table × operation) running in CI, initially empty | NFR-12 | IN PROGRESS (reopened L-0111 for B-26; redone L-0119 after L-0116; was VERIFIED L-0030) | C-001 |
| P0-07 | Vendor sign-ups and WhatsApp template approvals (human-only, §10); adapters stubbed | doc 05, OQ-11 | NOT STARTED | — |
| P0-08 | Configuration definitions with owner: installment templates, credit rules, product groups, cycles, visit outcomes (use doc 09/10 defaults marked `[default-unconfirmed]`) | ADM-01, OQ-06/07 | VERIFIED (L-0030) | C-001 |
| P0-09 | **Enforce this protocol:** `AGENTS.md` + `CLAUDE.md` at repo root (Appendix A); CI check that fails a PR which changes code without appending to the log, or which modifies/removes existing log lines (Appendix C) | this file | DONE (self-reported; redone in L-0089, L-0093, L-0097, L-0105 and L-0121 after L-0085 and L-0116) | C-001 |
| P0-10 | Gate 0 sign-off by MJ | §8 | NOT STARTED | — |

### Phase 1 — MVP: the Khata, the Bag, and the Controls

Recommended build order is in §12.1. Deviation from the order needs a `DECISION` entry.

| ID | Work item | Refs | Status | Claimed by |
|---|---|---|---|---|
| P1-01 | Foundation schema: `public`/`control`/`vault` schemas, `user_profile`, roles, device binding, `app.current_role()`, audit trigger + hash chain, `approval_request` with maker≠checker | SEC-01–05, 07, 11, 12; docs 04, 06 | VERIFIED (L-0116) | C-001 |
| P1-02 | Territories, areas, salons, contacts, notes, stage machine, salon verification, contact-change flow, Excel import | SAL-01–05, 09, 10; PIP-01, 02, 07, 09; CTL-09, 18 | IN PROGRESS (part a DONE self-reported, L-0147; part b DONE self-reported, L-0153; parts c, d not started; SAL-04 credit profile was built in P1-06 part a, L-0165) | — |
| P1-03 | Rep map: pins by stage, drop-a-pin with notes, masking and territory scoping | MAP-01, 02, 03, 12 | NOT STARTED | — |
| P1-04 | Inventory: SKU master (dummy data), locations, append-only movements, issue/return two-party, daily close, spot check, manual reorder points | INV-01–06; CTL-05 | DONE (self-reported, L-0133) | C-003 (released) |
| P1-05 | Vault: suppliers (encrypted), POs, goods receipts bridge to public movements, documents, grants, access log | VLT-01–06; doc 07 | NOT STARTED | — |
| P1-06 | Orders: price list, credit gate, approvals for discounts, delivery with salon acknowledgment, gapless invoices, offline order creation | SAL-04; ORD-01–05, 10; ADM-03; PIP-03; CTL-07, 08 | IN PROGRESS (parts a and b DONE self-reported, L-0165, L-0170; part c not started; still open from this row: dated price lists (ORD-07, Phase 2), the OTP acknowledgment (with SMS), offline order creation (P1-09); L-0183) | — |
| P1-07 | Money: installment templates, payments, allocations, receipts (SMS first), cash ledger, two-party handover, deposits, intraday cash cap, ageing | PAY-01–05, 07, 10, 11; CTL-01–04, 17 | NOT STARTED | — |
| P1-08 | Control layer: write-off/adjustment approvals with owner thresholds, bank-detail lock, balance-confirmation list, daily owner digest, offboarding | CTL-06, 11, 15, 16; SEC-06, 08 | NOT STARTED | — |
| P1-09 | Offline-first rep PWA: outbox, idempotent sync, encrypted cache, rejection handling, Urdu/English | NFR-01–03; ORD-10 | NOT STARTED | — |
| P1-10 | Owner dashboard, receivables ageing, in-app notifications | RPT-01, 02; MSG-03 | NOT STARTED | — |
| P1-11 | Admin config, company profile, rep profile | ADM-01, 02; FLD-01 | NOT STARTED | — |
| P1-12 | Security acceptance suite (doc 06 §10, doc 07 §5) + backup restore drill | NFR-07, 12; SEC-10 | NOT STARTED | — |
| P1-15 | Independent agents: agent role, agent price per SKU, cash-and-carry agent purchase (paid before release, `sale_to_agent`), agent app, no recruitment pay (D-15 to D-17) | AGT-01–04, 06; A-06, A-07 | NOT STARTED | — |
| P1-16 | Thin due-list and route building: default cycle per product group + last purchase, due tasks, manual route with stop reasons (D-19) | PIP-03, PIP-05/06 (thin) | DONE (self-reported, L-0159) | — |
| P1-17 | Route-linked bag load suggestion and automatic lost-demand capture from orders, deliveries and agent purchases; lost-demand report (D-18, D-19) | INV-11; DEM-02, DEM-03 | NOT STARTED | — |
| P1-13 | Pilot: existing sales appointee, one territory, 4 weeks, Excel frozen | doc 11 | NOT STARTED | — |
| P1-14 | Gate 1 sign-off by MJ | §8 | NOT STARTED | — |

### Phase 2 — The Growth Engine

| ID | Work item | Refs | Status | Claimed by |
|---|---|---|---|---|
| P2-01 | Nearby discovery, convert, pins→route, timelines, manager live map | MAP-04–11, 13 | NOT STARTED | — |
| P2-02 | Route days, cycle engine, due tasks, sweep mode, geofence flags, outcome taxonomy | PIP-04, 05, 06, 08, 10, 11 | NOT STARTED | — |
| P2-03 | Bank reconciliation, overdue timers, automatic credit rules | PAY-06, 08, 09 | NOT STARTED | — |
| P2-04 | Returns + quarantine, special pricing, order suggestions | ORD-06, 07, 09; CTL-12 | NOT STARTED | — |
| P2-05 | Restock suggestions, batches/expiry, counts, valuation | INV-07–10 | NOT STARTED | — |
| P2-06 | Statements + disputes, automated confirmations, commission on banked cash, anomaly detectors | CTL-10, 11, 13, 14 | NOT STARTED | — |
| P2-07 | Scorecard, commissions, onboarding checklist, funnel, margin, accountant pack | FLD-02–05; RPT-03–05 | NOT STARTED | — |
| P2-08 | WhatsApp receipts, reminders, message log; vault column encryption | MSG-01, 02, 04; VLT-07 | NOT STARTED | — |
| P2-09 | Hire reps 2 and 3 using the doc 08 runbook | doc 08 | NOT STARTED | — |
| P2-10 | Gate 2 sign-off by MJ | §8 | NOT STARTED | — |

### Phase 3 — Scale and Polish

| ID | Work item | Refs | Status | Claimed by |
|---|---|---|---|---|
| P3-01 | POs/claims in vault UI; seasonality forecasting; multi-warehouse | doc 10, 11 | NOT STARTED | — |
| P3-02 | Promotions/bundles; salon self-service via WhatsApp; honeytokens; discovery refresh; tags | ORD-08; SEC-09; MAP-10; SAL-08 | NOT STARTED | — |
| P3-03 | Accounting/payroll exports; performance and cost review; external penetration test | RPT-05; OQ-15 | NOT STARTED | — |
| P3-04 | Gate 3 sign-off by MJ | §8 | NOT STARTED | — |

### 12.1 Recommended Phase 1 build order

Each step is only started when the previous one is at least `DONE (self-reported)`, because later steps depend on its guarantees.

1. **P1-01 Foundation** — roles, devices, audit chain, approvals, RLS helpers. Everything else relies on these.
2. **P1-02 / P1-03** — territories, salons, stage machine, map basics (can run in parallel on separate claims).
3. **P1-04 / P1-05** — inventory and vault (parallel; the goods-receipt bridge connects them last).
4. **P1-06** — orders and invoices. **P1-16** (due-list, routes) needs P1-02 and can run beside it; **P1-15** (agents) and **P1-17** (bag load, automatic lost demand) follow P1-06 and P1-04 (D-19, L-0128).
5. **P1-07** — payments, receipts, cash custody, handover.
6. **P1-08** — control layer and digest.
7. **P1-09** — offline PWA (start the outbox contract early; finish it here).
8. **P1-10 / P1-11** — dashboards, admin.
9. **P1-12** — security acceptance suite and restore drill, then **P1-13** pilot.

---

## 13. Active claims

| Claim ID | Agent / session | Task ID | Requirement IDs | Areas touched (tables, functions, screens, files) | Started (PKT) | Planned finish | Last activity |
|---|---|---|---|---|---|---|---|
| C-001 | Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) (started as Fable 5.1) | P0-02, P0-04, P0-05 (open); P0-09 (DONE self-reported, awaiting re-verification); P1-01 VERIFIED (L-0061) | SEC-02, SEC-03, SEC-04; NFR-12; doc 05 | `scripts/` (activity-log-check, staging-smoke), `supabase/migrations/`, `supabase/tests/` (own files only; reverify5 anchor per L-0110 and L-0118; reverify10 graphql_public case per L-0125), `apps/web/`, `docs/gate-0-checklist.md`, `docs/test-report-2026-10-25.md`, `packages/import/`, `docs/runbooks/`, `.github/workflows/ci.yml`, `.gitignore` | 2026-10-25 02:57 | after B-18 and the owner account exist | 2026-10-28 21:15 (L-0126) |

**Released / expired claims** (kept for history; never deleted):

| Claim ID | Task ID | Released (PKT) | Reason (`done` / `abandoned` / `stale`) | Log entry |
|---|---|---|---|---|
| C-003 | P1-04 | 2026-10-28 10:25 | done | L-0134 |
| C-004 | P1-02 (part a) | 2026-10-28 20:30 | done | L-0148 |
| C-006 | P1-02 (part b) | 2026-10-28 20:55 | done | L-0154 |
| C-007 | P1-16 | 2026-10-28 21:27 | done | L-0160 |
| C-008 | P1-06 (part a) | 2026-10-28 22:00 | done | L-0166 |
| C-009 | P1-06 (part b) | 2026-10-28 22:39 | done | L-0171 |
| C-005 | — (SPEC.md, Biome lint, Playwright tests, CI jobs lint and e2e) | 2026-10-29 07:34 | done | L-0177 |
| C-010 | — (documentation follows the merged code, L-0176) | 2026-10-29 12:21 | done | L-0184 |

---

## 14. Blockers and pending decisions

Agents add rows here; **MJ** (or whoever MJ names) resolves them and the resolver logs a `DECISION`. Until answered, use the stated default and mark it in the code/data as `[default-unconfirmed]`.

| ID | Item | Blocks | Default agents must use meanwhile | Owner of answer | Status |
|---|---|---|---|---|---|
| B-01 | **D-08** manager vs. owner governance split | P1-01 permission matrix | Build the split as in doc 06 §2 (owner-only governance) | MJ | PENDING |
| B-02 | **OQ-01** contents of the Excel (salons, balances, prices) | P0-02 | None — cannot import without the file; use synthetic data for development | MJ | PENDING |
| B-03 | **OQ-03** who is the owner account; second owner for continuity | P0-05 | Single owner account placeholder; human-only creation | MJ | PENDING |
| B-04 | **OQ-04** packaging shows supplier name? private label? | Doc 07 physical controls (not code) | Treat the supplier as secret; no code impact | MJ | PENDING |
| B-05 | **OQ-06/07** installment schedule shape; starting credit limits | P0-08, P1-07 | Doc 09 defaults, flagged `[default-unconfirmed]` | MJ | PENDING |
| B-06 | **OQ-08** company bank accounts; separate supplier-payment account | Invoice template; bank import | Placeholder accounts, clearly fake | MJ | PENDING |
| B-07 | **OQ-10** company phones/SIMs vs. personal devices | Device binding policy | Device binding enforced either way | MJ | PENDING |
| B-08 | **OQ-11** WhatsApp Business ownership and number; SMS sender ID | P0-07, receipts over WhatsApp | SMS-first receipts behind the adapter; WhatsApp adapter stubbed | MJ | PENDING |
| B-09 | **OQ-13** pilot territory and pilot rep | P0-03, P1-13 | None — cannot pilot without it | MJ | PENDING |
| B-10 | **OQ-16** real product catalogue (names, sizes, weights, packs) | P1-04 data load | `[Dummy]` products only (H-04) | MJ | PENDING |
| B-11 | **OQ-14** owner's willingness to run the daily digest/handover routine | Effectiveness of the control layer | Build all controls regardless | MJ | PENDING |
| B-12 | Is Supabase project `iurvazdyxzlspegygldo` staging or production? Approve the MCP server and authenticate. Consider `read_only=true` meanwhile | P0-04, P0-05, P0-06, any DB work | Treat as production (H-19): connect only, no migrations, SQL or data reads | MJ | RESOLVED (L-0019: staging) |
| B-13 | Remote created (`ethancrystal/kiran-dms`, L-0018); branch protection on `main` requiring the five check names given verbatim in L-0175 (the earlier names `activity-log-check`, `db-tests`, `typecheck` do not match GitHub's check names) is still to be turned on | P0-09 enforcement | Run `pnpm db:test` and `pnpm activity:check` locally before every handoff | MJ | PENDING |
| B-14 | How do reps get the plan list and taxonomies (visit outcomes, product groups, salon types)? Doc 06 §2 gives reps no access to "installment templates, credit rules, config" (verifier Q1) | P1-02 rep visit logging, P1-06 ordering | Reps see no config; Phase 1 RPCs return only what a given screen needs (e.g. allowed plans for one salon) | MJ | PENDING |
| B-15 | (a) Add GitHub Actions secret `KIRAN_SENSITIVE_TERMS` (newline-separated supplier identifiers) so rule 5 can block them. (b) Rule on whether a fresh subagent launched from the builder's session counts as "a different agent" for §7 (L-0025, L-0026) | P0-09 completeness; any VERIFIED status | Rule 5 runs without the owner list; no task is marked VERIFIED | MJ | PART RESOLVED (b: L-0029); (a) PENDING |
| B-16 | (a) Three verifier tests encode behaviour the fixes removed (L-0039): the L-0030 audit-erasure test, the L-0035 revive-then-approve test, and the L-0030 Q6 revive-to-pending test. Approve updating them to assert the secure end state, or choose another approach. (b) L-0030 Q5: cap pending devices per user? (L-0035 Q2: a cap would not bound audit growth). (c) Q6 answered the restrictive way under §1 (L-0036, migration 0006): a revoked device id is dead for good; MJ may overrule. | CI `db-tests` red until (a); P1-01 VERIFIED | Tests left failing (H-23); revoked ids dead for good; no pending cap | MJ | (a) RESOLVED L-0040; (b) PENDING |
| B-17 | L-0042 Q1: add TRUNCATE guards on approval_request, device, user_profile, app_config, doc_counter (and update the verifier observation test)? Q2: refuse decisions on pending requests whose maker is suspended? (L-0047) | — (not exploitable by app roles) | Leave as is | MJ | PENDING |
| B-18 | F-2: hosted staging does not expose schemas `app` and `vault_api` (406 "Invalid schema: app"), so login and device registration cannot work. Project Settings → Data API → Exposed schemas → add `app`, `vault_api`; keep `control`, `supplier_vault` unexposed; then `pnpm staging:smoke` must pass (L-0051) | P0-05 end to end; Gate 0 criterion 1 | Nothing works against staging until done | MJ | PENDING |
| B-19 | F-3: should a rep see its own revoked/pending device rows (today yes) or only the approved one? Should tests stop sharing committed rows across files? Changing the re-verifier-3 test needs explicit approval (L-0052) | — (not a leak) | Leave as is | MJ | PENDING |
| B-20 | L-0061 client observations: O1 cross-tab rotation not atomic (Web Lock), O2 a 30 s claim blocks re-registration after a crash, O3 blocked storage leaves the page on "Loading…". Fix now (reopens P1-01) or defer to P1-09? (L-0065) | — (P1-01 VERIFIED; fails closed) | Defer to P1-09 | MJ | PENDING |
| B-21 | L-0075 FP3: also allow supplier wording under any `vault/` path segment (P1-05 vault UI) and in i18n, locale or translations directories? Owner terms still apply everywhere. (L-0079) | rv8 FP3 test red until decided | Approve | MJ | RESOLVED (L-0080: approved) |
| B-22 | L-0075 O1: scan commit messages for owner terms and secret patterns (H-01)? Look-alike letters in owner terms stay an accepted limit. (L-0079) | — | Scan commit messages | MJ | PENDING |
| B-23 | L-0085 O3: exclude any `public/` directory from the B-21 vault exemption (Next.js serves it without sign-in)? (L-0090) | — | Approve (narrows B-21) | MJ | RESOLVED (L-0091: approved) |
| B-24 | L-0085 O4: also decode added files with a UTF-32 byte-order mark when scanning for secrets? (L-0090) | — | Approve | MJ | RESOLVED (L-0091: approved) |
| B-25 | Which Supabase project did the Vercel Supabase integration connect to `kiran-dms`? Rotate the service-role and secret keys and the database password if it is staging (the values sat in Vercel env for a while). (L-0100) | P0-04 staging deploy | Treat as staging; rotate | MJ | PENDING |
| B-26 | Council findings 4 to 6 reopen verified P0-06 and P1-01 (view-aware guards, device revocation trigger as migration 0007 applied to staging, audit-trigger guard); finding 7 in full (fail on an empty owner-term list in CI) right after B-15a. (L-0108) | P0-06, P1-01, P0-09 | Approve both | MJ | PART RESOLVED (4 to 6: L-0110); finding 7 after B-15a |
| B-27 | A board row may cite a CORRECTION that rejects the task (L-0116 O1): require a checkable per-task verdict line in the cited entry, or allow only VERIFIED-type entries? (L-0124) | P0-09 | Per-task verdict line | MJ | PENDING |
| B-28 | Reps park salons (doc 02, `app.rep_park_salon`) while the doc 06 section 2 matrix says reps cannot change a stage manually (L-0175) | — (P1-02 part a built) | Keep rep parking as doc 02 says | MJ | PENDING |
| B-29 | Rulebook wording behind the built code (L-0182): H-14 says reps read through views with no base-table access, but reps read salon data through `app.*` functions and read their own rows of a few operational tables; H-06 lists fewer append-only tables than are built; H-07 allows soft-delete flags only on configuration entities, but `salon_contact.active` retires phones | — (rule text only) | Code as built; doc 04 and doc 06 describe it | MJ | PENDING |
| B-30 | Must a salon created from the map have a pin (lat and lng)? Doc 04 said so; the database does not enforce it, and the offline quick add (PIP-07) may lack GPS (L-0182) | A database check | Not required | MJ | PENDING |

---

## 15. Assumptions register

Any assumption an agent makes to proceed goes here **and** in a log `ASSUMPTION` entry. MJ reviews this table at each gate.

| ID | Assumption | Made by / log entry | Impact if wrong | Status (`open` / `confirmed` / `rejected`) |
|---|---|---|---|---|
| A-01 | Planning defaults in docs 09 (plans, credit rules), 10 (cycles), 13 §9 (thresholds) are placeholders until MJ confirms | Planning session, L-0001 | Config values change; no schema change expected | open |
| A-02 | Every new rep device, including the first, starts `pending` until an office user approves it (SEC-03 vs doc 08 §2 / doc 13 §9; restrictive reading) | L-0009 | First login needs a manager step; easy to relax | open |
| A-03 | Office powers require AAL2 at the database: owner/manager at AAL1 see only their own profile (doc 12 D-14) | L-0009 | None for security; UI must route to MFA first (done) | open |
| A-04 | Reps may only open approval requests for discount, return acceptance, payment reversal; write-offs always route to the owner | L-0009 | Adjust the allow-list in `app.request_approval` | open |
| A-05 | Credit starting limits for types doc 09 does not name; consumables cycle 30 days; "quote" visit outcome; credit ceiling unset (OQ-07) | L-0023 | Owner edits config; no schema change | open |
| A-06 | Kiran pays agents nothing for recruiting other agents (no joining fee, referral bonus or override); agent earnings come only from their own resale margin. SECP treats MLM and referral marketing as unlawful (Companies Act 2017 s.301) | L-0128 | Legal exposure for the company | open |
| A-07 | Agent purchases are paid in full (cash counted or transfer matched) before stock leaves the warehouse; agents never buy on credit | L-0128 | Receivables and custody risk the agent model is meant to avoid | open |
| A-08 | Rep bags and their value limits are set by the owner only (docs silent; restrictive reading, section 1): a raised limit is the exposure a colluding manager and rep would need | L-0131 | Owner does one more onboarding step | open |
| A-09 | Until orders exist (P1-06), the due-list's last purchase per salon and product group is an office-entered opening baseline (date only, no quantity or price); since P1-06 part b (L-0170) deliveries replace it. The cycle is the product group's default (D-19) | L-0156, L-0174 | Office keys in a starting date per salon; a wrong date only moves a reminder | open |
| A-10 | Until invoices and payments exist (P1-06 part b, P1-07), a salon's credit exposure is the total of its confirmed, not yet cancelled installment orders; cash orders do not count (MJ L-0163). P1-07 replaces it with invoiced minus paid (part b did not, L-0174) | L-0162 | Exposure is overstated until payments exist, so the check errs towards refusing credit | open |

---

## 16. Activity log (append-only)

### Entry template — copy, fill, append at the bottom

```
### L-NNNN · YYYY-MM-DD HH:MM PKT · <agent name · model · session/branch> · <TYPE>
**Task:** <P-id> (<requirement IDs>)    **Claim:** <claim id or —>
**What / why:** <intent before, or result after>
**Evidence:** <commands run, real results (counts/errors), commit SHA, branch/PR>   (required for DONE/VERIFIED/PROGRESS-after)
**Rules touched:** <H-nn that applied, or —>
**Next / needs:** <next action, blocker, who must answer>
```

### Security checklist block — paste into every `DONE` and `VERIFIED` entry

```
Security checklist (tick honestly):
[ ] RLS enabled+forced; policies + role×table tests added/updated (H-13)
[ ] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[ ] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[ ] Audit trigger present; hash chain verifies (H-17)
[ ] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[ ] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[ ] Governance powers still owner-only + AAL2 (H-15)
[ ] No control weakened, skipped or "temporarily" disabled (H-16)
[ ] Docs match code; deviations logged (H-25)
[ ] Tests actually run; real results recorded (H-23, H-24)
```

### Log

### L-0001 · 2026-10-25 01:55 PKT · Claude · Fable 5.1 / Sonnet 5.5 · planning session · DECISION
**Task:** PLAN-01 (all)    **Claim:** —
**What / why:** Planning set `00`–`13` written to `Kiran Company/plan/` at MJ's request. Fixed decisions recorded in `00-README.md`; decision log and open questions in doc 12. D-08 (manager vs. owner governance split) is recommended but **pending MJ's confirmation**. Product data in doc 10 is dummy by MJ's instruction (OQ-16). Planning defaults for installment plans, credit limits, cycles and control thresholds are placeholders (assumption A-01).
**Evidence:** Files present in `Kiran Company/plan/`: `00-README.md`, `01`–`13` (14 files).
**Rules touched:** —
**Next / needs:** MJ to answer Phase 0 items in §14. Then P0-04 (repo bootstrap) and P0-09 (enforcement) unlock all build work.

### L-0002 · 2026-10-25 02:00 PKT · Claude · Sonnet 5.5 · planning session · DECISION
**Task:** PLAN-02    **Claim:** —
**What / why:** This file created at MJ's request as the mandatory protocol and progress record for any agent building Kiran DMS. Effective immediately for all work on the system. The protocol applies the system's own principles (append-only history, maker ≠ checker, two-party confirmation, owner-visible exceptions) to the build process itself.
**Evidence:** `Kiran Company/plan/ACTIVITY.md` created; `00-README.md` and `11-roadmap.md` updated to reference it.
**Rules touched:** H-22, H-25
**Next / needs:** First builder agent: start at §2, then claim P0-04 and P0-09.

### L-0003 · 2026-10-25 02:30 PKT · Claude · Sonnet 5.5 · session cd8fef08 (no branch, no repo yet) · SESSION-START
**Task:** none claimed (config change only; P0-04 is still NOT STARTED)    **Claim:** —
**What / why:** Read this file in full, then `00-README.md`, docs `03` (NFR, VLT, SEC, ADM), `04`, `05`, `06`, `07`, `11`, `12`. No claim made because no task work was done: the only change is the MCP config below, made on MJ's direct instruction. Checklist items 3 and 4: no active claims; blockers B-01 to B-11 read, none touch this change. Item 5 (repo health) is not applicable: no repository exists yet. Item 6: environment is local only; I hold no production credentials.
**Evidence:** Local toolchain checked: node v22.23.2, pnpm 9.15.9, Postgres 18.4 binaries (a throwaway local server started and stopped cleanly, then deleted), no Docker, Supabase CLI binary broken on this Linux install.
**Rules touched:** —
**Next / needs:** MJ to confirm the environment of the Supabase project (see L-0004).

### L-0004 · 2026-10-25 02:30 PKT · Claude · Sonnet 5.5 · session cd8fef08 (no branch, no repo yet) · DECISION
**Task:** P0-04 (doc 05)    **Claim:** —
**What / why:** MJ instructed: "usre this supabase" and supplied `claude mcp add --scope project --transport http supabase "https://mcp.supabase.com/mcp?project_ref=iurvazdyxzlspegygldo&features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment%2Cfunctions%2Cbranching%2Cstorage"`. I ran that command unchanged from `Kiran Company/`. It created `.mcp.json` containing only the server URL and project ref, which are identifiers, not secrets. The server shows "Pending approval" until MJ approves it on the next `claude` launch, then needs Supabase login (OAuth) through `/mcp`. I did not and cannot do either step. The instruction does not say whether this project is staging or production, and doc 05 plans two separate projects. Until MJ states it is staging or local-equivalent, I treat it as production under H-19: no migrations, no SQL, no data reads, no deploys. Connecting is approved; changing anything is not. The URL has no `read_only=true`, so once connected the tools can write. Recommended: add `&read_only=true` until the environment is confirmed. Blocker B-12 added to section 14.
**Evidence:** `claude mcp add ...` exit 0, "Added HTTP MCP server supabase ... File modified: .mcp.json". `claude mcp get supabase` reports "Pending approval". ToolSearch for Supabase tools found none in this session.
**Rules touched:** H-19, H-16, H-20
**Next / needs:** MJ: approve the server, authenticate, state which environment the project is, and say whether to add `read_only=true`.

### L-0005 · 2026-10-25 02:30 PKT · Claude · Sonnet 5.5 · session cd8fef08 (no branch, no repo yet) · SECURITY-INCIDENT
**Task:** P0-04    **Claim:** —
**What / why:** MJ pasted a database password for the Supabase project above into the chat session. The value is deliberately not recorded here or in any project file. It is not needed for the MCP connection, which uses OAuth. Under H-18 and H-20 and section 10, database credentials are held and entered by a human only, and an agent must not be handed them. The password now exists in the session transcript on this machine and in the model provider's request path. Treat it as exposed: rotate it, then update wherever it is stored. Exposure is limited to the chat; I wrote it to no file, no memory entry, and no config.
**Evidence:** Searched the project folder, the session memory folder and the `.remember` buffers for the password prefix: see result in the HANDOFF when the session ends. `.mcp.json` contains no credential.
**Rules touched:** H-18, H-20, section 10
**Next / needs:** MJ: rotate the database password in Supabase (Project Settings, Database). Rotate first, then confirm here.

### L-0006 · 2026-10-25 02:57 PKT · Claude · Fable 5.1 · session ee095e06 · branch main (K repo) · SESSION-START
**Task:** P0-04, P0-06, P0-09, P1-01    **Claim:** C-001 (L-0008)
**What / why:** Read this file in full (rules, board, claims, blockers B-01–B-12, assumptions, log L-0001–L-0005), `00-README.md`, and docs 01–13. Checklist: (1) done; (2) done, doc 03 IDs for SEC/NFR/ADM/VLT read; (3) no active claims; (4) blockers read: B-01 D-08 default applied (owner-only governance), B-05 doc 09 defaults used and flagged `[default-unconfirmed]`, B-10 `[Dummy]` products only, B-12 see L-0007; (5) no repository existed before this session, so there was no baseline to run: the repo is created in this session at `C:/Users/moizjmj/K` and the baseline is whatever this session leaves green; (6) environment: local only, no production credentials held. Per the location note at the top of this file, the planning copy in `Kiran Company/plan/` is superseded by `docs/ACTIVITY.md` in the repo from this entry on.
**Evidence:** Planning docs copied byte-identical from `Kiran Company/plan/` into `docs/` (`cmp` reported "same" for all 15 files). Toolchain: node v24.16.0, pnpm 10.33.4, git 2.54.0, Supabase CLI 2.113.0; no Docker, no running Postgres.
**Rules touched:** H-19, H-22
**Next / needs:** L-0007, L-0008.

### L-0007 · 2026-10-25 02:57 PKT · Claude · Fable 5.1 · session ee095e06 · branch main (K repo) · DECISION
**Task:** P0-04 (doc 05)    **Claim:** C-001
**What / why:** MJ's instructions in this session: "Continue implementation from this planning choose what you will setu girst", then "Supabase Kiran is the database", then "its now attached". (1) Build order chosen: P0-04 repo + P0-09 enforcement + P0-06 RLS harness first, then the P1-01 foundation schema, then the Next.js skeleton with MFA login (P0-05). §12.1 makes P1-01 the base for every later step, and §0 forbids build work before P0-09. (2) The Supabase project MJ calls "Supabase Kiran" is the database for this build. It is a different connector from the unrelated project bound to this session as "Supabase Crystal Royal Apartments"; no SQL or migration was or will be run against that one. When checked, the "Supabase Kiran" connector had status `pending`, so its tools were not available. (3) Migrations are verified first against a throwaway local Postgres 17 (npm `embedded-postgres`, no system install) because Docker is not installed. They go to "Supabase Kiran" only after the local suite is green and only while that project holds no real data. Whether it is staging or production is still unstated, so B-12 stays open for that question; no real data may enter it until MJ answers.
**Evidence:** `session_connectors_status` listed "Supabase Kiran" with status `pending`. The bound connector's project is `bakjmdhpnbflvjgjpuku` (Crystal Royal, unrelated); only read-only listing calls were made against it, to identify it.
**Rules touched:** H-19, H-22
**Next / needs:** MJ: confirm whether "Supabase Kiran" is staging or production (B-12).

### L-0008 · 2026-10-25 02:57 PKT · Claude · Fable 5.1 · session ee095e06 · branch main (K repo) · CLAIM
**Task:** P0-04, P0-06, P0-09, P1-01 (NFR-12; SEC-01–05, 07, 11, 12)    **Claim:** C-001
**What / why:** Claiming the repo bootstrap, the CI enforcement job, the RLS test harness, and the P1-01 foundation migration: schemas, `user_profile`, `device`, role helpers, audit trigger with hash chain, `approval_request` with maker ≠ checker, append-only guard, gapless numbering. Status board rows set to IN PROGRESS.
**Rules touched:** H-13, H-17
**Next / needs:** Build, test, log DONE with evidence.

### L-0009 · 2026-10-25 03:20 PKT · Claude · Fable 5.1 · session ee095e06 · branch main (K repo) · ASSUMPTION
**Task:** P1-01 (SEC-02, SEC-03)    **Claim:** C-001
**What / why:** Three assumptions, added to §15 as A-02 to A-04. A-02: every new rep device, including the first, starts `pending` and needs an office approval. SEC-03 says the first device is "auto-registered", while doc 08 §2 and doc 13 §9 say the manager approves it. §1 says take the more restrictive reading. A-03: office powers need AAL2 at the database (`app.is_office()`/`app.is_owner()` false at AAL1), recorded as proposed decision D-14 in doc 12. A-04: a rep may only open approval requests of kind discount, return_accept or payment_reversal (doc 13 §9 maker column); write-offs always route to the owner.
**Rules touched:** H-15, H-16
**Next / needs:** MJ to confirm or reject A-02 to A-04 at Gate 0.

### L-0010 · 2026-10-25 03:20 PKT · Claude · Fable 5.1 · session ee095e06 · branch main (K repo) · DEVIATION
**Task:** P1-01 (doc 04, 06, 07)    **Claim:** C-001
**What / why:** (1) The supplier schema is `supplier_vault`, not `vault`, because Supabase's `supabase_vault` extension already owns `vault` (seen in the extension list of a Supabase project). Doc 12 D-13 added; docs 04 and 07 annotated. (2) `app.current_role()` is implemented as `app.user_role()` because `CURRENT_ROLE` is a reserved SQL keyword; doc 06 §4 annotated. (3) `control` is not exposed through PostgREST; office reads of approvals will go through `app.*` RPCs. Schemas `app` and `vault_api` are exposed for RPC only (`supabase/config.toml`). No change to who can see or do what.
**Rules touched:** H-25
**Next / needs:** —

### L-0011 · 2026-10-25 03:25 PKT · Claude · Fable 5.1 · session ee095e06 · branch main (K repo) · DONE
**Task:** P1-01 (SEC-01, 03, 04, 05, 07, 11, 12; ADM-01 config table; ADM-03)    **Claim:** C-001
**What / why:** Migration `supabase/migrations/20261025100000_foundation.sql`: schemas `app`, `control`, `vault_api`, `supplier_vault`; `user_profile`, `device` (one approved device per user), `app_config` (owner-only, doc 13 §9 defaults flagged `[default-unconfirmed]`), `control.approval_request` (CHECK `checker_id <> maker_id`, decide-once guard), `control.audit_event` + chain head (sha256 chain, serialised by row lock), `control.doc_counter` (gapless per FY from 1 July); helpers `app.user_role/is_office/is_owner/is_rep/is_aal2/has_vault_grant/rep_device_ok`; owner-only AAL2 functions for users, roles, status, vault grant, config; device register/approve/revoke; generic request/decide/cancel approval; `app.bootstrap_owner` callable by `postgres` only. Not in scope and not built: CNIC encryption (P1-11), salons, stock, money.
**Evidence:** `pnpm db:test` → "Test Files 3 passed (3), Tests 291 passed (291)" on a fresh embedded Postgres 17.9 with the Supabase shim. Includes: 253 RLS matrix cases (7 tables × 9 personas × SELECT/INSERT/UPDATE/DELETE), audit chain verifies and detects a tampered row, append-only refusal for `postgres`, maker = checker refused by function and by constraint (SQLSTATE 23514), owner AAL1 refused, rolled-back numbering leaves no gap, schema-hygiene checks (RLS forced everywhere, audit trigger everywhere, no anon-executable function, every SECURITY DEFINER pins search_path, `supplier_vault` unreachable). `pnpm typecheck` exit 0. Not yet applied to any Supabase project (L-0014). No commit made: MJ has not asked for one, so there is no SHA.
**Rules touched:** H-06, H-07, H-08, H-11, H-12, H-13, H-15, H-17
**Next / needs:** A different agent or MJ to verify (§7).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — idempotent: owner_create_user, register_device, approve/revoke_device, request/decide/cancel_approval
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) — no vault tables exist yet; hygiene tests guard column names and schema access
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20) — fixtures are `[Test]` names, +920000000xxx numbers, example.test emails
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25) — L-0010
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0012 · 2026-10-25 03:25 PKT · Claude · Fable 5.1 · session ee095e06 · branch main (K repo) · DONE
**Task:** P0-06 (NFR-12)    **Claim:** C-001
**What / why:** RLS test harness in `supabase/tests/`: Vitest global setup starts an embedded Postgres 17 (no Docker) or uses `KIRAN_TEST_DATABASE_URL`, applies a Supabase shim only when `auth.users` is missing, applies every migration in order, and builds personas through the real RPCs. `helpers/db.ts` runs SQL as anon, service_role, owner/manager at AAL1 or AAL2, reps with the right or a wrong device header, and a suspended rep, each in a rolled-back transaction. The matrix test fails if any table in `public`, `control` or `supplier_vault` is missing from it. CI job `db-tests` runs the same suite against `supabase/postgres:17.6.1.054`.
**Evidence:** `pnpm db:test` → 291 passed. The CI job has not run yet: there is no GitHub remote (B-13).
**Rules touched:** H-13, H-23
**Next / needs:** First CI run once the repo is pushed.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0013 · 2026-10-25 03:25 PKT · Claude · Fable 5.1 · session ee095e06 · branch main (K repo) · DONE
**Task:** P0-09 (ACTIVITY Appendix A, C)    **Claim:** C-001
**What / why:** `AGENTS.md` and `CLAUDE.md` at the repo root carry the Appendix A text plus a repo map and commands. `scripts/activity-log-check.mjs` implements Appendix C rules 1 to 5; `.github/workflows/ci.yml` runs it as job `activity-log-check` on every PR, next to `db-tests` and `typecheck`. Maker ≠ checker compares the full signature (agent · model · session), so another session or a human can verify. Branch protection needs a GitHub remote and is a human action (B-13).
**Evidence:** On this tree: `node scripts/activity-log-check.mjs` → "activity-log-check OK". Negative tests in a throwaway repo, each exit 1 with the expected message: code changed with no log entry; an existing log line edited; VERIFIED by the same signature as DONE; a service-role key in the diff.
**Rules touched:** H-23, H-25
**Next / needs:** MJ: create the GitHub repo, push, and require `activity-log-check`, `db-tests` and `typecheck` in branch protection.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — n/a for this task, no tables
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) — the log itself is append-only, enforced by rule 2
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — n/a
[x] Audit trigger present; hash chain verifies (H-17) — n/a
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) — n/a
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) — n/a
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0014 · 2026-10-25 03:30 PKT · Claude · Fable 5.1 · session ee095e06 · branch main (K repo) · BLOCKER
**Task:** P0-04, P0-05    **Claim:** C-001
**What / why:** (1) The "Supabase Kiran" connector stayed `pending` through the whole session, so the foundation migration is not applied to it and the office MFA login is not tested against real Supabase Auth. Per L-0007 it is applied only after MJ's environment answer or explicit go-ahead, and only while the project is empty. (2) B-13 added: no GitHub remote, so CI and branch protection cannot run. (3) Gotcha found: this machine has a global `DATABASE_URL` pointing at an unrelated remote Supabase host, and a global `NODE_ENV=development`. The harness reads only `KIRAN_TEST_DATABASE_URL`, and the web build pins `NODE_ENV=production` through `cross-env`. The first test run read the ambient variable and failed DNS lookup before connecting, so nothing reached that host.
**Rules touched:** H-19, H-20
**Next / needs:** MJ: finish connecting "Supabase Kiran" (approve and sign in), say staging or production (B-12), create the GitHub repo (B-13).

### L-0015 · 2026-10-25 03:30 PKT · Claude · Fable 5.1 · session ee095e06 · branch main (K repo) · HANDOFF
**Task:** P0-04, P0-05 (open); P0-06, P0-09, P1-01 (DONE self-reported)    **Claim:** C-001 (renewed for P0-04, P0-05)
**What / why:** State: repo at `C:/Users/moizjmj/K`, branch `main`, nothing committed (MJ has not asked for a commit). Working: foundation migration, 291-test RLS/invariant suite, activity-log check, CI workflow, Next.js 16 skeleton with `/office/login` → `/office/mfa` (TOTP enrol/verify) → `/office`, and `/app/login` (phone OTP) → `/app` (registers the phone, shows approval state). `proxy.ts` gates `/office` to AAL2; the database enforces it again. Not working or not verified: nothing applied to Supabase; office and rep logins never run against real Auth; CI never run. Next steps, in order: (1) once "Supabase Kiran" is connected and MJ confirms, check it is empty, apply the migration, run `get_advisors`; (2) MJ bootstraps the owner (`docs/runbooks/owner-bootstrap.md`) and tests MFA sign-in end to end, which closes P0-05; (3) push to GitHub and turn on branch protection; (4) a different agent verifies P1-01, P0-06 and P0-09 per §7; (5) next claim per §12.1: P1-02 territories/salons and P1-03 map. Gotchas: see L-0014 (ambient `DATABASE_URL`, `NODE_ENV`); `app.approve_device` revokes the user's previous device; the vault grant test relies on the manager fixture having the grant. Open blockers raised: B-13 (MJ); B-12 still open.
**Evidence:** `pnpm db:test` → 291 passed; `pnpm typecheck` exit 0; `pnpm -C apps/web build` → compiled, 7 routes plus proxy; `node scripts/activity-log-check.mjs` → OK.
**Rules touched:** H-19, H-23, H-24
**Next / needs:** MJ: B-12, B-13, connector sign-in, A-02 to A-04.

### L-0016 · 2026-10-25 03:40 PKT · Claude · Fable 5.1 · session ee095e06 · branch feat/p0-foundation (K repo) · CORRECTION
**Task:** P0-04, P0-05, P1-01    **Claim:** C-001
**What / why:** Corrects L-0006 to L-0015. (1) Their signatures say "branch main"; §2.5 forbids working on `main`. Nothing was committed, so the unborn branch was renamed to `feat/p0-foundation`; all work in those entries is on this branch. (2) L-0011 ticked "no control weakened", but `supabase/config.toml` still allowed self-signup (`[auth]`, `[auth.email]`, and `[auth.sms]` which I had turned on). All three are now `false`: the owner creates every account (H-15). (3) Additions to the L-0015 handoff: hosted-project settings (exposed schemas `app` and `vault_api`, signup off, TOTP on, SMS provider) are not carried by `config.toml` and are now listed in `docs/runbooks/owner-bootstrap.md`; after applying the migration, the first check is one authenticated PostgREST call to an `app.*` RPC, which the local suite cannot cover; the CI image tag `supabase/postgres:17.6.1.054` and its `postgres`/`postgres` credentials are unverified until the first CI run; this machine's clock reports PST although entries are labelled PKT, so future entries should take the time with `TZ=Asia/Karachi`.
**Evidence:** `git symbolic-ref --short HEAD` → `feat/p0-foundation`. `grep -n "^enable_signup" supabase/config.toml` → three lines, all `false`. `pnpm db:test` re-run after the change: see L-0017.
**Rules touched:** H-15, H-16, H-25
**Next / needs:** —

### L-0017 · 2026-10-25 03:42 PKT · Claude · Fable 5.1 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P1-01, P0-06    **Claim:** C-001
**What / why:** Re-ran the suite after the L-0016 config change, which touches only the CLI auth settings.
**Evidence:** `pnpm db:test` → "Tests  291 passed (291)"; `node scripts/activity-log-check.mjs` → OK (run after appending this entry).
**Rules touched:** H-23
**Next / needs:** As in L-0015 and L-0016.

### L-0018 · 2026-10-25 03:55 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P0-04, P0-09    **Claim:** C-001
**What / why:** MJ instructed: "Commit the work on feat/p0-foundation." and "create new repo". Committed, created the private GitHub repo `ethancrystal/kiran-dms` (the only account signed in to `gh` on this machine), created `main` as an empty root commit, and replayed the work onto it so pull requests into `main` carry the full diff and run CI. The commit author is set per repo to MJ (`git config user.*`), not the machine's global identity. B-13 partly resolved: the remote exists; branch protection is still MJ's action.
**Evidence:** `gh repo create kiran-dms --private --source . --push` → https://github.com/ethancrystal/kiran-dms. `main` = c95cee5 "Initial commit"; work commit 1eb92ae on `feat/p0-foundation`. Pre-commit scan of the staged diff: no keys or connection strings; the only matches were the detection regexes in `scripts/activity-log-check.mjs`.
**Rules touched:** H-20, H-23
**Next / needs:** MJ: in GitHub Settings → Branches, protect `main` and require `activity-log-check`, `db-tests`, `typecheck`, plus one reviewer who is not the author.

### L-0019 · 2026-10-25 04:05 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DECISION
**Task:** P0-04, P1-01    **Claim:** C-001
**What / why:** MJ instructed: "Supabase Kiran is staging. Check it's empty, then apply the foundation migration and run the advisors." B-12 resolved: project `iurvazdyxzlspegygldo` ("Supabase Kiran") is **staging**. Before applying I checked it was empty. I applied migration 0001 verbatim from the committed file. The advisors then raised one WARN, `auth_rls_initplan` on three read policies, plus six unindexed foreign keys. I wrote migration 0002 (`foundation_perf`): policies wrap `auth.uid()` and the `app.*` helpers in scalar subqueries, and the six foreign keys get indexes. It passed the full local suite unchanged and was then applied. Local migration files were renamed to the versions Supabase recorded (`20261024223304_foundation.sql`, `20261024223425_foundation_perf.sql`), so `supabase db push` will not re-apply them; L-0011's filename `20261025100000_foundation.sql` refers to the first of these. Also fixed CI's first-run failure: `pnpm/action-setup` refused a pnpm version given both in the workflow and in `package.json`.
**Evidence:** Pre-check on staging: Postgres 17.11, 0 migrations, 0 relations or functions in our schemas, 0 auth users, 0 buckets, `postgres` has BYPASSRLS. Post-apply: 7 tables all RLS enabled + forced; 34 functions in `app`/`control`; 0 functions executable by anon; 14 config rows; `control.verify_audit_chain()` → ok, 14 rows checked; authenticated has no usage on `supplier_vault` and no INSERT on `user_profile`; service_role has no INSERT on `audit_event`. Advisors after 0002: security, 1 INFO (`rls_enabled_no_policy` on `control.audit_chain_head` and `control.doc_counter`, intentional deny-all); performance, 1 INFO (7 indexes unused, expected on an empty database); no WARN or ERROR. Local `pnpm db:test` with 0002: 291 passed. `pnpm install --frozen-lockfile`: up to date. CI run 40138782261 failed only at the pnpm setup step of `db-tests` and `typecheck`; `activity-log-check` passed.
**Rules touched:** H-19, H-23, H-25
**Next / needs:** CI re-run on this push. Then MJ: hosted-project settings (exposed schemas `app`, `vault_api`; signup off; TOTP on), owner bootstrap (`docs/runbooks/owner-bootstrap.md`), and one authenticated `app.*` RPC call to close P0-05.

### L-0020 · 2026-10-25 04:20 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P0-06 (NFR-12)    **Claim:** C-001
**What / why:** MJ: "CI is failing on the PR. Find out why, fix it, and push." Cause, from CI run 40139243705 (job `db-tests`, step `pnpm db:test`): "migration 20261024223304_foundation.sql failed: function auth.jwt() does not exist". The bare `supabase/postgres` image ships `auth.users` but not `auth.jwt()`, which GoTrue's own migrations create. The harness skipped its shim whenever `auth.users` existed. Fix: (1) CI now runs `supabase start` with only Postgres and GoTrue (CLI 2.113.0, same as local), so tests run against the real auth schema, and the CLI applies `supabase/migrations` the same way `supabase db push` reaches a hosted project; (2) the harness skips migrations already recorded in `supabase_migrations.schema_migrations` and applies only newer ones; (3) the shim now keys on `auth.jwt()` being absent. `activity-log-check` and `typecheck` were already green on that run.
**Evidence:** Staging catalog checks for the non-superuser CI path: `control.audit_event` is owned by `postgres` (tamper test can disable its trigger); `postgres` is a member of `anon`, `authenticated`, `service_role`; `auth.users` NOT NULL columns without defaults: only `id`, so fixture inserts work. Local: `pnpm db:test` → "Tests  291 passed (291)"; `pnpm typecheck` ok. The CI result is pending this push.
**Rules touched:** H-16, H-23
**Next / needs:** Confirm the CI run on this push is green.

### L-0021 · 2026-10-25 04:35 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P0-06, P0-09    **Claim:** C-001
**What / why:** First fully green CI on PR #1 after the L-0020 fix: the RLS suite ran against a real local Supabase stack (Postgres + GoTrue), with migrations applied by the CLI.
**Evidence:** CI run 40139592201 on c8c4b5a: `migrations + RLS matrix (local Supabase stack)` ✓ 3m22s ("Test Files 3 passed (3)"); `activity-log-check` ✓; `typecheck + service-role scan` ✓.
**Rules touched:** H-23
**Next / needs:** —

### L-0022 · 2026-10-25 04:35 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · CLAIM
**Task:** P0-08 (ADM-01; OQ-06, OQ-07)    **Claim:** C-001 (extended)
**What / why:** Claiming P0-08: write the planning defaults (installment templates, credit rules, escalation ladder, product groups and cycles, visit outcomes, salon types, pipeline timers, discovery radius) as owner-editable config, flagged `[default-unconfirmed]`. Phase 1 tasks after P1-01 wait for Gate 0 (§8), so this is the next Phase 0 task an agent can do.
**Rules touched:** H-22
**Next / needs:** —

### L-0023 · 2026-10-25 04:40 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · ASSUMPTION
**Task:** P0-08    **Claim:** C-001
**What / why:** A-05: (1) doc 09 §2 gives starting credit limits only for ladies/bridal (Rs 15,000) and men's/barber (Rs 8,000); I assumed Rs 15,000 for unisex, hair studio, spa and academy, and Rs 8,000 for home parlor and other. (2) Doc 10 gives no cycle for consumables; I assumed 30 days. (3) Doc 02 has a "quote" visit outcome that doc 04 lacks; I included it. (4) The credit ceiling stays null until OQ-07. All are config values the owner can change, not schema.
**Rules touched:** —
**Next / needs:** MJ / owner to confirm or edit at Gate 0.

### L-0024 · 2026-10-25 04:45 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-08 (ADM-01)    **Claim:** C-001
**What / why:** Migration `supabase/migrations/20261024225236_config_defaults.sql` adds 8 config keys: `plan.templates`, `credit.rules`, `collections.escalation_days`, `catalogue.product_groups`, `visit.outcomes` (English and Urdu labels), `salon.types`, `pipeline.timers`, `map.discovery_radius_m`. Each is noted `[default-unconfirmed]`; `on conflict do nothing` never overwrites an owner's value. Reps can read the five operational lists, but not credit rules, the escalation ladder, timers or thresholds. Applied to staging.
**Evidence:** `pnpm db:test` → 294 passed (3 new: keys present and flagged, plan schedules each sum to 100%, the exact set of keys a rep can see). The RLS matrix flagged that owner/manager at AAL1 now see the 5 rep-visible rows; I updated the expectation to `rep_visible` (same rows as any rep, no governance values). Staging: 22 config rows, 5 rep-visible; `verify_audit_chain()` ok over 22 rows; migrations recorded `20261024223304_foundation`, `20261024223425_foundation_perf`, `20261024225236_config_defaults`; security advisors: only the intentional INFO on `control.audit_chain_head` / `control.doc_counter`.
**Rules touched:** H-04, H-13, H-15, H-19
**Next / needs:** Owner confirms values (A-01, A-05, B-05).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no new tables; matrix updated
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — owner edits via app.owner_set_config
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) — no cost data; product names not added
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0025 · 2026-10-25 05:00 PKT · Claude · Opus 5.5 · verifier subagent · branch feat/p0-foundation (K repo) · CORRECTION
**Task:** P1-01, P0-06, P0-08, P0-09    **Claim:** —
**What / why:** Independent §7 verification of L-0011 (P1-01), L-0012 (P0-06), L-0013 (P0-09) and L-0024 (P0-08). Result: **not VERIFIED**. Two defects, below; they correct L-0011 and L-0013, and L-0012's matrix let defect 1 through. Disclosure: this verifier is a fresh-context subagent launched from session ee095e06, which is the builder's session. MJ should decide whether that counts as "a different agent" (§7). The attack tests are in `supabase/tests/verifier-attacks.test.ts` (new, uncommitted). Its 3 failing tests are left in place on purpose (H-23).
Defect 1 (corrects L-0011; SEC-03, doc 04 invariant 7): anyone holding a rep's session can bypass device binding. The only proof of device is the `x-kiran-device` header, which is a `web-<uuid>` kept in localStorage (`apps/web/lib/supabase/browser.ts`). Policy `device_select` (`user_id = auth.uid() or app.is_office()`) lets the rep read the approved device's `device_fingerprint` from any phone, including an unapproved one. The session can copy that value into the header, and every write then passes `app.rep_device_ok()`. Separately, no read policy checks the device at all: a rep session on an unapproved phone still reads its own profile, its devices, its approval requests and the 5 rep-visible config rows, while invariant 7 says such sessions are rejected. The RLS matrix (L-0012) has no wrong-device persona and compares only row counts, so the suite could not catch this. Reproduce: `pnpm vitest run --config supabase/tests/vitest.config.ts verifier-attacks -t "device"`. Real output: (a) "AssertionError: expected [ Array(1) ] to not include 'dev-d6d43eab-…'": `select device_fingerprint from public.device where status = 'approved'` as REP_A_WRONG_DEVICE returns rep A's approved fingerprint. (b) "expected 'SUCCEEDED: request_approval accepted with the leaked fingerprint' to match /device is not approved/": `app.request_approval` succeeded once the header carried the leaked value. (c) "expected { user_profile: 1, device: 1, app_config: 5 } to deeply equal { user_profile: 0, device: 0, app_config: 0 }".
Defect 2 (corrects L-0013; Appendix C rules 2, 4, 5). Reproduced in a throwaway clone under the scratchpad with `node scripts/activity-log-check.mjs 34a1df7 HEAD`. (B) Inserting a new line inside L-0011 ("**Evidence (amended):** CI green on first push; VERIFIED by MJ.") → "activity-log-check OK (0 new log entries, 1 changed files)", exit 0. The same insertion together with a code change and a valid new entry is also OK. Rule 2 only checks that old lines survive in order, so an existing entry can be extended after the fact. (F2) A VERIFIED entry signed exactly like L-0024's builder, with `**Task:** P1-01, P0-08` → OK, exit 0. The same entry with `**Task:** P0-08` alone fails as it should. Rule 4 reads only the first task ID. (G3) `DATABASE_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres` and `SUPABASE_JWT_SECRET=…` added to `apps/web/.env.example` → OK, exit 0. (G2) "-- supplier: Dummy Supplier Ltd, cost 120" added to a migration → OK, exit 0. Rule 5 has no `.env` or connection-string pattern and no supplier identifier list, although L-0013 says rules 1 to 5 are implemented. These cases held: editing an existing L-0011 line → FAILED "line removed or modified", exit 1; a code change with no new entry → FAILED, exit 1; the builder self-VERIFYING P0-08 alone → FAILED, exit 1; a `SUPABASE_SERVICE_ROLE_KEY=` value in the diff → FAILED, exit 1.
Questions for MJ, not counted as defects. (Q1, L-0024) `plan.templates` is `rep_visible = true`, but doc 06 §2's row "Installment templates, credit rules, config" gives Rep "—". Reps may need to see plans to take orders, but no DEVIATION or ASSUMPTION was logged (H-25, H-26). L-0024 also changed the matrix expectation for owner/manager at AAL1 to `rep_visible` after that test flagged it; those rows hold no governance values. (Q2) `control.audit_row` stores the first value of `split_part(x-forwarded-for, ',', 1)`, which a client can set. This is from reading the code; I did not test it against a hosted stack. (Q3) Suspended reps can still SELECT their own profile, devices and approval requests, and the matrix expects this. Doc 06 §3 says revocation takes effect on the next request. (Q4) After `owner_set_status` returns a user to active, a device with the same fingerprint stays `revoked` for good: `register_device` hits `on conflict` and `approve_device` refuses revoked rows. This is an availability gap only.
**Evidence:** §7 checks, all run locally on embedded Postgres 17 (no remote database touched):
1. Suite: `pnpm db:test` before my file → "Test Files 3 passed (3) / Tests 294 passed (294)". With my file → "Test Files 1 failed | 3 passed (4) / Tests 3 failed | 327 passed (330)"; the 3 failures are defect 1. `tsc -p supabase/tests/tsconfig.json --noEmit` → exit 0. I did not check CI (no GitHub access, by instruction).
2. Vault: `select count(*) from supplier_vault.anything` → 42501 for all 10 personas (anon, service_role, rep A, rep B, rep A on the wrong device, manager at AAL2 and AAL1, owner at AAL2 and AAL1, suspended rep). `vault_api` has 0 functions, so no vault data path exists to attack yet. `app.has_vault_grant()` is false for a rep, AAL1 office users, a suspended rep, and the manager right after an owner revoke in the same transaction. Manager self-grant or self-promote → "owner only"; owner at AAL1 → "AAL2". Held.
3. Append-only and direct writes: UPDATE, DELETE and TRUNCATE on all 7 tables × 10 personas → 42501. service_role INSERT into `control.audit_event` and UPDATE of `control.audit_chain_head` → 42501. Direct INSERT into `control.approval_request` → 42501 for every persona. Held.
4. Territory and list-dump: no salon or territory tables exist yet (P1-02), so this cannot be tested. Rep B reading rep A's approval request → 0 rows; reps see only their own rows. Held for the tables that exist.
5. Approvals: self-approve and self-reject refused for the manager; self-approve refused for the owner. Office at AAL1 → "AAL2". A rep deciding → "owner or manager only". A manager deciding an owner-made write_off → "needs the owner's decision". Checker role 'rep' is lifted to 'manager'. As postgres: lowering `checker_role_required` from owner to manager, or changing `maker_id` → "identity is immutable"; flipping a decided row → "already decided". The maker cannot cancel a decided request; nobody else can cancel. Held.
6. Replay: the same client_id from the same rep → one row; from rep B or the manager → 23505. A replayed `decide_approval` adds exactly 1 audit row in total; the opposite decision on replay → "already decided". `created_at` is server time (within 120 s). Backdated client timestamp: N/A, no function accepts one yet. Held.
7. Diff and history: grep over `git log --all -p` found 0 hits for `eyJ…`, `BEGIN … PRIVATE KEY`, `AKIA…`, `+92 3xx`, `03xx-xxxxxxx`, CNIC `xxxxx-xxxxxxx-x`, or IBAN `PKxx…`. `sb_secret_` appears only in the check script's regex. The only `postgres://…:…@` value is the local CLI default `postgres:postgres@127.0.0.1:54322`, in `ci.yml`, `AGENTS.md` and `CLAUDE.md`. The only tracked env file is `apps/web/.env.example`, with placeholders. No supplier names appear outside the vault rules, and no weakened control is in the diff apart from the Q1 note. Also held: internal functions (`next_doc_number`, `bootstrap_owner`, `set_purpose`, `assert_*`, `raise_denied`, `fiscal_year`, `control.verify_audit_chain`, `control.audit_canonical`) → 42501 for all 10 personas. Every function in `app`, `control` and `vault_api` pins `search_path`. authenticated can execute exactly 19 documented helpers and RPCs; service_role can execute none. An `aal2` value in the request headers does not make an AAL1 owner pass `app.is_owner()`. An audit row forged and appended by postgres, with the head moved to match → `verify_audit_chain()` ok = false. The chain still verifies after all the attacks.
**Rules touched:** H-12, H-13, H-15, H-16, H-17, H-23, H-24, H-25; SEC-03; Appendix C
**Next / needs:** Builder, defect 1: stop returning `device_fingerprint` to rep sessions, or bind a server-issued device secret and store only its hash; add the device gate to rep read policies; add a wrong-device persona to the RLS matrix. Builder, defect 2: rule 2 must require the base log to be an exact prefix of the head log; rule 4 must check every task ID; rule 5 needs `.env` and connection-string patterns plus the supplier list. Set P1-01 and P0-09 back to IN PROGRESS on the board (I did not edit the board). Then a verifier from a session other than ee095e06 re-verifies. MJ: Q1 to Q4 and the disclosure above.

### L-0026 · 2026-10-25 05:20 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P1-01, P0-09    **Claim:** C-001
**What / why:** Accepting L-0025. P1-01 and P0-09 are set back to IN PROGRESS while I fix both defects. Before changing anything I reproduced defect 1 with the verifier's own tests: 3 failures, as reported. Q1–Q4 are handled as follows: Q2, Q3 and Q4 are fixed in migration 0004; Q1 is fixed the restrictive way (reps see no config) and raised to MJ as B-14. On the verifier's independence note: the verifier was a fresh subagent of this session, with no access to my reasoning, and it signed differently. Whether that meets §7's "different agent" is MJ's call (B-15); until MJ rules, P1-01 and P0-09 stay DONE (self-reported) at most, never VERIFIED.
**Evidence:** `pnpm db:test` before fixing: "Tests 3 failed | 327 passed (330)". The failures were the three DEFECT CHECK tests in `supabase/tests/verifier-attacks.test.ts`.
**Rules touched:** H-16, H-23
**Next / needs:** L-0027, L-0028.

### L-0027 · 2026-10-25 05:40 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P1-01 (SEC-03, doc 04 invariant 7)    **Claim:** C-001
**What / why:** Fixes defect 1 of L-0025 with migration `supabase/migrations/20261024232225_device_hardening.sql`. (1) `device_fingerprint` stores sha256 hex (CHECK `device_fingerprint_is_hash`); `app.rep_device_ok()` hashes the `x-kiran-device` header, so a value read from the database cannot be replayed. (2) New `app.self_ok()`: an active profile and, for reps, the approved device. Every self-read policy (`user_profile`, `device`, `app_config`, `approval_request`) now requires it. A rep on an unapproved phone, and any suspended user, read zero rows (verifier Q3). (3) New `app.my_session()` (definer): name, role, account status and this device's status, so the rep app can show "waiting for approval" or "suspended" without table reads. `apps/web/app/app/page.tsx` uses it. (4) A revoked device that registers again returns to `pending` and needs a new office approval (Q4). (5) Audit `ip` comes from `cf-connecting-ip`, else the last `x-forwarded-for` hop; the audit `device_id` stores the hash, never the raw id (Q2). (6) All config is hidden from reps (Q1, B-14). The RLS matrix gains a wrong-device persona and stricter expectations for suspended users. The verifier's allow-list test gains exactly the two new functions, `my_session` and `self_ok`; nothing was removed from it.
**Evidence:** `pnpm db:test` → "Tests  363 passed (363)", including the verifier's 3 DEFECT CHECK tests, which now pass unchanged, and 5 new tests: hashed storage, stored-hash replay refused, `my_session` for wrong-device / approved / suspended / anon, revoked → pending on re-register, hashed device id in the audit row. `pnpm typecheck` ok; `pnpm -C apps/web build` compiled. Staging: migration recorded as `20261024232225_device_hardening`; rep-visible config rows 0; `verify_audit_chain()` ok over 27 rows; `authenticated` cannot execute `app.fingerprint_hash`, can execute `app.my_session`; `anon` cannot. Security advisors: only the intentional INFO; performance: only "unused index" INFO.
**Rules touched:** H-08, H-13, H-16, H-17
**Next / needs:** Re-verification by a different agent (§7), and MJ's ruling on verifier independence (B-15).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0028 · 2026-10-25 05:45 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Fixes defect 2 of L-0025 in `scripts/activity-log-check.mjs`. Rule 2: the old log must be an exact prefix of the new one (blank and `---` lines ignored), so inserting a line inside an old entry now fails. Rule 4: every task id on a VERIFIED entry's Task line is checked against every DONE entry for that task. Rule 5 now scans only added lines and also catches:
- any JWT;
- connection strings with a password to a non-local host (`<…>` and `…` placeholders allowed);
- KEY=value secrets (SECRET, PASSWORD, API_KEY, TOKEN, SERVICE_ROLE_KEY, PRIVATE_KEY) unless the value is a `<placeholder>`;
- supplier or cost wording (`supplier:`, `supplier_id`, `unit_cost`, `cost price`, `landed cost`, `manufacturer`) outside vault paths and docs;
- terms from the owner-maintained `KIRAN_SENSITIVE_TERMS` GitHub secret, which CI now passes to the job.

The two detector files that contain these patterns are exempt.
**Evidence:** In a throwaway clone (since deleted), every case exits 1 with the matching message:
- (A) a line inserted inside L-0011 → "not append-only at existing line 87";
- (B) a VERIFIED entry for P1-01 and P0-08 signed like L-0024 → "VERIFIED by the same agent … that logged DONE (L-0024) for P0-08";
- (C) a password connection string and `SUPABASE_JWT_SECRET=` in `.env.example` → both secret patterns;
- (D) `-- supplier: Dummy Supplier Ltd, cost 120` in a migration → H-01 message;
- (E) an owner-listed term via `KIRAN_SENSITIVE_TERMS` → "owner-listed sensitive term".

A `<placeholder>` value passes rule 5. On this branch: `node scripts/activity-log-check.mjs main` → OK.
**Rules touched:** H-01, H-20, H-23
**Next / needs:** MJ adds the `KIRAN_SENSITIVE_TERMS` repository secret (B-15). Re-verification by a different agent.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0029 · 2026-10-25 06:00 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DECISION
**Task:** P1-01, P0-06, P0-08, P0-09 (§7)    **Claim:** C-001
**What / why:** MJ ruled: "A fresh subagent counts as a different agent for §7. Run the re-verification." B-15 part (b) resolved: a fresh subagent with no access to the builder's reasoning, signing with its own signature, may log VERIFIED. Part (a), the `KIRAN_SENSITIVE_TERMS` secret, is still open. A new verifier subagent is being started now. It is not the one that wrote L-0025. The builder does not touch the repository while it runs.
**Rules touched:** §7
**Next / needs:** Verifier's entry (L-0030).

### L-0030 · 2026-10-25 06:30 PKT · Claude · Opus 5.5 · re-verifier subagent · branch feat/p0-foundation (K repo) · CORRECTION
**Task:** P1-01, P0-06, P0-08, P0-09    **Claim:** —
**What / why:** Independent §7 re-verification after L-0026 to L-0028, under MJ's ruling in L-0029. I am a fresh subagent and did not write L-0025. Result: **P0-06 and P0-08 are VERIFIED. P1-01 and P0-09 are not VERIFIED.** This entry corrects L-0027 (P1-01) and L-0028 (P0-09), and through them L-0011 and L-0013. I added one file, `supabase/tests/reverify-attacks.test.ts`, which is not committed. Its one failing test is defect 1 and is left in place on purpose (H-23). I did not edit the status board. The builder should set P1-01 and P0-09 back to IN PROGRESS.
Defect 1 (corrects L-0027; SEC-03, doc 04 invariant 7; low severity). L-0027 says a fingerprint "read from the database cannot be replayed" and that the audit `device_id` "stores the hash, never the raw id". That is false for any database that had devices before migration 0004. 0004 rewrites `public.device` to hashes but leaves the raw ids in `control.audit_event`, which is append-only, so they can never be removed. The raw ids are in the `after` image of the device INSERT, the `device_id` of every audited rep write, and the `before` image of the UPDATE that 0004 itself performs. The raw id is the bearer value the gate checks. The owner (AAL2), and anyone who reads the database, a backup or the planned audit mirror, can pair it with a stolen rep session and pass `app.rep_device_ok()`. The chain still verifies across the upgrade. Reproduce: `pnpm vitest run --config supabase/tests/vitest.config.ts reverify-attacks -t "upgrade path"`. The test builds a separate throwaway database on the embedded server, applies 0001 to 0003, creates a rep with an approved device and makes one audited write, then applies 0004. Real output: "AssertionError: expected [ { seq: '25', …(5) }, …(3) ] to deeply equal []". The four rows are seq 25 (INSERT public.device, raw id in after and device_id), 26 (UPDATE public.device by approve_device, raw id in before and after), 27 (INSERT control.approval_request, raw id in device_id), and 28 (UPDATE public.device written by migration 0004, raw id in before). Staging went through 0004, but by the builder's own counts it had no devices. L-0024 recorded 22 audit rows after 0003 (14 + 8 config inserts). L-0027 recorded 27 rows after 0004, which is exactly the 5 `rep_visible` updates 0004 makes. Any device row would have added more. So there is no live exposure on staging. I did not query staging myself (local only). Fix options: state in the migration that it is safe only on a database with no pre-0004 devices, or record a DEVIATION. 0004 should also not write raw values into its own before-image.
Defect 2 (corrects L-0028; Appendix C rules 1 to 5). I tested in a throwaway clone of this repo under the scratchpad, deleted afterwards. Each case was one commit on top of dc506eb, checked with `node scripts/activity-log-check.mjs dc506eb HEAD`. Every case below exits 0 with "activity-log-check OK".
- (a) Rule 4: a VERIFIED entry signed exactly like L-0027 passes when its Task line writes `P1‑01, P0‑09` with U+2011 hyphens, and also when it has no task id at all ("foundation schema and log check"). L-0028 says every task id is checked; ids the regex cannot see are not checked, and no rule requires a parseable id.
- (b) Rules 3 and 4: a header that does not match the entry pattern is not treated as an entry, so nothing about it is checked. Examples: the builder's signature with type `VERIFIED.` in a docs-only commit, or `VERIFIED (by MJ)` placed after a valid PROGRESS entry plus a code change.
- (c) Rule 2: the old log is required only to be a prefix. A line appended to the last existing entry (`**Evidence (amended):** …` under L-0029) passes, which edits L-0029 after the fact.
- (d) Rule 2: the check reads the first `## 16. Activity log` heading. An unchanged copy of the old §16 placed inside an HTML comment above the real §16 passes, with L-0011's Evidence line in the real section rewritten to "VERIFIED by MJ, CI green." Rendered markdown shows only the tampered copy.
- (e) Rule 1: `git diff --name-only` lists only the new path of a rename. `git mv supabase/tests/verifier-attacks.test.ts docs/…` deletes a test file with no log entry and passes ("0 new log entries, 1 changed files").
- (f) Rule 5, diff parsing: an added line whose content is `++ b/scripts/activity-log-check.mjs` appears in the diff as a file header. The checker then treats the rest of that hunk as the exempt detector file, and a JWT plus a service-role key line after it pass.
- (g) Rule 5, exemptions: a JWT added to `supabase/tests/schema-hygiene.test.ts` passes (the whole file is exempt). Any path containing "vault" is exempt from the supplier check, so `supabase/migrations/…_public_vaultless_catalog.sql` creating a public table with supplier-name and unit-cost columns passes.
- (h) Rule 5, unscanned content: binary diffs are never scanned. A `.gitattributes` line with `-diff` hid a password connection string and a JWT; so did a NUL byte in the file. Every `*.png` path is already binary in this repo.
- (i) Rule 5, patterns: a force-added `apps/web/.env.local` passes, although the spec names ".env content", when its variables are named like `SUPABASE_DB_PASS` or `SUPABASE_KEY`. Also passing: a lowercase TOML `jwt_secret = "…"`, YAML `DB_PASSWORD: "…"`, and an `ENCRYPTED PRIVATE KEY` PEM block.

Controls on the same harness that held, each exiting 1: a code change with no entry; an edited L-0011 line ("not append-only at existing line 86"); a VERIFIED entry for P1-01 signed as the builder ("same agent … L-0027"); `-- supplier: Dummy Supplier Ltd, cost 120` in a migration.
Questions for MJ, not counted as defects:
- (Q1) maker ≠ checker compares self-asserted signature strings, so the builder's signature plus " re-verify" passes, exactly as the spec is written.
- (Q2) supplier wording such as "vendor: …, buy price" passes. The owner list (B-15a) is the real control and is still unset.
- (Q3) a docs-only change to the doc 06 §2 permission matrix needs no log entry (spec: "outside docs/"), although H-26 needs MJ's approval for it.
- (Q4) a bare `---` line inserted inside an old entry passes (harmless).
- (Q5) a session on an unapproved phone can create unlimited pending devices (50 in one transaction); there is no cap or rate limit.
- (Q6) because of the L-0025 Q4 fix, a device the office revoked as stolen re-enters the approval queue when it registers again, and one manager click re-approves it (revoked, pending, approved, tested).
- (Q7) `supabase/config.toml` has `minimum_password_length = 6` and `max_rows = 1000`, while doc 06 §3 says 12 and H-14 says 50 for reps. This affects the local CLI only; P0-05 is outside this verification.
**Evidence:** All runs were local, with `DATABASE_URL` and `KIRAN_TEST_DATABASE_URL` unset, on embedded Postgres 17. No remote database, Supabase project or GitHub was touched.
1. Suite: baseline `pnpm db:test` gave "Test Files 4 passed (4) / Tests 363 passed (363)". With my file: "Test Files 1 failed | 4 passed (5) / Tests 1 failed | 379 passed (380)"; the one failure is defect 1. `pnpm typecheck` exit 0. I did not check CI.
2. Vault: `supplier_vault` has no usage for anon, authenticated or service_role; vault_api has no functions; `app.fingerprint_hash` gives 42501 for all 10 personas. Held. The L-0025 vault tests still pass.
3. Append-only and direct writes: UPDATE, DELETE and TRUNCATE are refused for every persona (verifier and matrix tests pass). `audit_chain_head` and `doc_counter` give 42501 for all 10 personas. `audit_event` returns 0 rows for reps, wrong-device, suspended, manager (AAL1 and AAL2) and owner AAL1, and 42501 for anon and service_role. Held.
4. Territory and list-dump: there are no salon tables yet. A wrong-device rep, a suspended rep, and a rep with no header read 0 rows of every table. A rep claiming aal2 is not office and sees 1 profile. Malformed, array-valued or wrong-case device headers fail closed without an error. A config row the owner makes rep-visible reaches rep A on the approved device (1) and not wrong-device, suspended or headerless sessions (0). Held.
5. Approvals: an idempotent replay of rep A's committed request from the unapproved phone is refused ("device is not approved"), not answered with the stored row. Cancel from that phone is refused. The thief cannot revoke the approved device. Self-approval and checker-role tests pass. Held.
6. Replay and time: the L-0025 replay and server-time tests pass. `register_device` from the wrong phone, given rep B's raw id, creates a pending row for A only; B's approved row is untouched and B still passes the gate. A device registered before a suspension stays revoked after reactivation, and approve_device refuses it. Backdated client timestamps: no function takes one yet (N/A). Held.
7. Leaks and history: `my_session` returns exactly the keys aal, device_status, full_name, role, status, user_id. Presented with rep B's raw id under rep A's session it returns device_status null. anon and service_role get 42501. Device-gate errors contain neither the raw id nor the hash. A rep write's audit `device_id` is the sha256 of the header; an office write without a header records null. No raw fixture id appears anywhere in the test database. After 0004, rep_device_ok, register_device, audit_row and my_session are SECURITY DEFINER with `search_path=""`. None of the replaced or new functions is executable by anon, service_role or PUBLIC. No RLS policy uses rep_device_ok() alone. The chain verifies after all attacks. History: `git log --all -p` (8 commits, all authored as MJ per L-0018) has 0 hits for JWTs, PEM private keys, AWS keys, `sb_secret_`/`sb_publishable_` values, +92/03xx phone numbers, CNIC, or PK IBAN. The only connection strings are the local `postgres:postgres@127.0.0.1` defaults and the `<password>`/`…` placeholders in L-0025 and L-0028. The only env file ever tracked is `apps/web/.env.example`, with placeholders. No `.mcp.json` is tracked. Project refs appear only as identifiers (L-0004). Emails: only example.test fixtures, the commented `admin@email.com` CLI template, and commit metadata. No supplier names were found.
P0-06 VERIFIED: the matrix covers every table × 10 personas × 4 operations, including the wrong-device persona, and fails on an uncovered table. Gap noted: it cannot test migrations applied to populated data, which is why defect 1 slipped through.
P0-08 VERIFIED: the 8 keys are present and flagged `[default-unconfirmed]`; values match doc 09 §1, §2 and §7 and doc 10 §1; plan schedules sum to 100%; edits go through owner-only, AAL2, audited `app.owner_set_config`; reps see no config (B-14).

Security checklist for P0-06 and P0-08 only (tick honestly; P1-01 and P0-09 are not verified):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)
**Rules touched:** H-01, H-16, H-17, H-20, H-23, H-24, H-25; SEC-03; doc 04 invariant 7; Appendix C
**Next / needs:** Builder, defect 1: fix or log a DEVIATION (staging is unaffected by the counts above). Builder, defect 2: (a) refuse a VERIFIED entry with no parseable task id; (b) fail on any `### L-` line that does not parse; (c) and (d) compare the whole old §16 by exact position and refuse a duplicate §16 heading, and decide whether the last entry may be extended; (e) use `--no-renames` or `--name-status`; (f) parse file names from `diff --git` headers, not from `+++` lines; (g) exempt only the pattern lines and match vault paths exactly; (h) refuse binary or `-diff` files outside an allow-list; (i) flag `.env*` paths and colon or lowercase secret forms. Then a different agent re-verifies P1-01 and P0-09. MJ: Q1 to Q7.

### L-0031 · 2026-10-25 06:45 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P1-01, P0-09    **Claim:** C-001
**What / why:** Accepting L-0030. I committed the re-verifier's entry and `supabase/tests/reverify-attacks.test.ts` unedited (commit a48c384) before changing anything. P0-06 and P0-08 are now VERIFIED on the board on the strength of L-0030. P1-01 and P0-09 are set back to IN PROGRESS for the two defects.
**Evidence:** Staging check for defect 1 exposure: 0 devices and 0 audit rows with device data (`device_id`, or `device_fingerprint` in before/after). `postgres` has CREATEDB on Supabase, so the upgrade-path tests can run in CI.
**Rules touched:** §7, H-23
**Next / needs:** L-0032, L-0033, L-0034.

### L-0032 · 2026-10-25 07:10 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P1-01 (SEC-03, doc 04 invariant 7)    **Claim:** C-001
**What / why:** Fixes L-0030 defect 1 with migration `supabase/migrations/20261025001514_device_retire.sql`. The append-only audit log cannot be rewritten, so the leaked raw ids are made worthless instead: every device whose raw id appears anywhere in audit history (`device_id`, or `device_fingerprint` in before/after) is revoked. Rows written after 0004 hold hashes and never match. Once revoked, a leaked id gives no advantage: re-registering it only queues it for a fresh office approval, exactly like a made-up id. I left L-0030 Q5 (pending cap) and Q6 (revoked id dead for good) unchanged and raised them as B-16. The fix does not depend on either, and either change would break the re-verifier's tests that record today's behaviour.
**Evidence:** New test "upgrade path: device ids leaked into audit history before 0004": it builds a separate database, applies 0001–0003, creates an approved device and an audited write, then applies all later migrations. Result: chain verifies, device revoked, the raw id used as the header with the rep's session is refused ("device is not approved"), and re-registering yields `pending`. `pnpm db:test` → "Tests 1 failed | 380 passed (381)". The one failure is the re-verifier's test that requires the raw id to be absent from `audit_event`; see L-0034. Staging: migration recorded as `20261025001514_device_retire`; 0 rows changed (0 devices); `verify_audit_chain()` ok over 27 rows; security advisors show only the intentional INFO.
**Rules touched:** H-06, H-16, H-17, H-23
**Next / needs:** Re-verification (§7); MJ on B-16.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24) — one verifier test still fails by design, see L-0034

### L-0033 · 2026-10-25 07:20 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Fixes L-0030 defect 2 and Q1, Q3 and Q4 in `scripts/activity-log-check.mjs`.
- **Log structure:**
  - Exactly one §16 heading, and no HTML comments inside §16.
  - Every `### L-` line must parse as a header.
  - New text after the old log must open with a new entry header, so the last entry can't be extended.
  - `---` is allowed only as the final line.
- **Log entry required:** for any change to any file other than ACTIVITY.md, including docs (Q3). Renames count as a delete plus an add.
- **Task ids:** look-alike dashes are normalised. A VERIFIED entry must name at least one task id, and signatures that contain one another count as the same agent (Q1).
- **Diff scanning:**
  - The diff is parsed by `diff --git` headers, so an added line that looks like a header can't switch files.
  - `--text` scans binary files and ignores `-diff` attributes.
  - Detector files get no blanket exemption: only lines marked `activity-log-check:allow-supplier-pattern` in those two files may hold supplier patterns.
  - The vault exemption is limited to `supabase/migrations/<timestamp>_vault*.sql`.
- **Secret patterns:**
  - any PEM private key, including ENCRYPTED;
  - committed `.env*` files other than `.env.example`;
  - secret-looking assignments in any case or syntax (env, TOML, YAML, JSON, code), skipping references (`<…>`, `${ }`, `$VAR`, `env(...)`, `process.env`, dotted property paths) and flagging only values of 8+ characters with a digit, or 20+ characters.
- **Config:** `supabase/config.toml` minimum password length set to 12 (doc 06 §3, L-0030 Q7), and the runbook now lists the hosted password settings. `max_rows` stays 1000, because it covers every role; the 50-row rep cap (H-14) belongs in the Phase 1 rep views.
**Evidence:** Script `evasions.sh`, run in a throwaway clone (deleted afterwards). Result: "20 as expected, 0 wrong". A legitimate code change with a valid entry passed. Each of these failed with a specific message:
- (1a) U+2011 task id under the builder's signature;
- (1b) VERIFIED naming no task;
- (2a) malformed `VERIFIED.` header;
- (2b) malformed `VERIFIED (by MJ)` after a valid entry;
- (3) line appended under the last entry;
- (4) decoy commented log copy plus tampered L-0011;
- (5) `git mv` of a test into docs/;
- (6) fake `+++` header hiding a JWT and a key;
- (7a) JWT in a detector file;
- (7b) supplier columns in a `*_public_vaultless_*` migration;
- (8) `-diff` attribute plus NUL byte;
- (9a) force-added `.env.local`;
- (9b) TOML `jwt_secret`;
- (9c) YAML `DB_PASSWORD`;
- (9d) ENCRYPTED PRIVATE KEY;
- (Q1) builder signature plus " re-verify";
- (Q3) docs-only permission-matrix edit;
- (Q4) `---` inside an old entry;
- (E) supplier wording in a migration.

On this branch: `node scripts/activity-log-check.mjs main` → OK. `pnpm typecheck` ok.
**Rules touched:** H-01, H-20, H-23, H-25
**Next / needs:** Re-verification (§7). The `KIRAN_SENSITIVE_TERMS` secret (B-15a) is still the real control for supplier names; the built-in wording check is a backstop (L-0030 Q2).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24) — one verifier test still fails by design, see L-0034

### L-0034 · 2026-10-25 07:25 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · BLOCKER
**Task:** P1-01    **Claim:** C-001
**What / why:** The re-verifier's test "DEFECT CHECK: after 0004 no raw device id (a bearer credential) remains readable in the audit log" (`supabase/tests/reverify-attacks.test.ts`) cannot pass without rewriting `control.audit_event`. That table is append-only and hash-chained by design (H-06, H-17, doc 06 §6). Making it pass would mean disabling the append-only trigger and breaking the chain, which H-16 forbids. Under H-23 I have not edited, skipped or loosened the test, so it stays red, and CI's `db-tests` job will fail until MJ decides. The underlying risk is fixed (L-0032), and staging was never exposed (L-0031). B-16 added.
**Evidence:** `pnpm db:test` → "Tests 1 failed | 380 passed (381)"; the only failure is that test, with "expected [ {…}, … ] to deeply equal []" listing audit rows from before 0004.
**Rules touched:** H-06, H-16, H-17, H-23
**Next / needs:** MJ: approve replacing that test's audit-log assertion with "a raw id from pre-0004 history cannot pass the device gate after all migrations", or name another approach (B-16).

### L-0035 · 2026-10-25 08:00 PKT · Claude · Opus 5.5 · re-verifier-2 subagent · branch feat/p0-foundation (K repo) · CORRECTION
**Task:** P1-01, P0-09    **Claim:** —
**What / why:** Independent §7 re-verification of L-0032 (P1-01) and L-0033 (P0-09), after L-0031 and L-0034, under MJ's ruling in L-0029. I am a fresh subagent and wrote neither L-0025 nor L-0030. Result: **neither P1-01 nor P0-09 is VERIFIED.** This entry corrects L-0032 and L-0033, and through them L-0027, L-0028, L-0011 and L-0013. I added one file, `supabase/tests/reverify2-attacks.test.ts`, which is not committed. Its one failing test is defect 1 and is left in place on purpose (H-23). I did not edit the status board or any other file. The builder should set P1-01 and P0-09 back to IN PROGRESS. The known B-16a test in `reverify-attacks.test.ts` still fails and is not counted here.
Defect 1 (corrects L-0032; SEC-03, doc 04 invariant 7; low severity: pre-0004 data only, and staging had none per L-0031). L-0032 says that once revoked "a leaked id gives no advantage: re-registering it only queues it for a fresh office approval, exactly like a made-up id", and that the fix does not depend on Q5 or Q6. Both claims are false.
- (a) Re-registering a leaked raw id does not create a new device. `app.register_device` finds the revoked row by its hash and flips that same row to `pending`. The row keeps the rep's original id, platform, label and created_at, so the office queue shows the rep's known phone, not a new device. A made-up id creates a new row that carries the caller's platform.
- (b) The real phone still holds the same raw id. `apps/web/lib/supabase/browser.ts` lines 12–15 generate it once and never rotate it. The only way to restore the real rep, short of clearing site data (which nothing tells anyone to do), is to approve that same row. That approval re-enables the id that stays readable in `control.audit_event` (owner at AAL2, backups, the planned audit mirror). So the retirement holds only if B-16c is answered "dead for good" and the client rotates its id.
- (c) Related: after 0005 a revoked phone that opens `/app` gets `device_status = 'revoked'` and skips registration, because `apps/web/app/app/page.tsx` line 36 registers only when the status is null. Line 62 then tells the rep the phone is "waiting for your manager's approval", although nothing is queued.
Reproduce: `pnpm vitest run --config supabase/tests/vitest.config.ts reverify2 -t "DEFECT CHECK"`. The test builds a separate throwaway database, applies 0001–0003, approves a rep's phone and makes one audited write, then applies 0004 and 0005. It confirms the device is revoked and that the raw id is readable as `audit_event.device_id`. Then the rep's session on a different phone re-registers the raw id: same row id, platform `android`, label `rep phone`, original created_at, status pending. For comparison, a made-up id gets a new row with the caller's platform. The owner approves that row, and the raw id is presented as the header. Real output: "AssertionError: expected 'SUCCEEDED: request_approval accepted …' to match /device is not approved/". Fix options: make a revoked fingerprint permanently unusable (B-16c) and have the client generate a new id when its status is revoked, or have 0005 mark retired rows so that `register_device` refuses them.
Defect 2 (corrects L-0033; Appendix C rules 1 to 5). I tested in a throwaway clone under the scratchpad, deleted afterwards, with `KIRAN_SENSITIVE_TERMS` unset. Each case was one commit on top of 5f452fc, checked with `node scripts/activity-log-check.mjs 5f452fc HEAD`. Every case below exited 0 with "activity-log-check OK".
- (a) Rules 3 and 4, header look-alikes. After a valid PROGRESS entry, a VERIFIED entry for P1-01 and P0-09, signed exactly as the builder, passes when its header is written "###" plus two spaces before "L-0036", or as "####", or with U+2011 in place of the hyphen in "L-0036". Each renders as an entry heading. The parser inspects only lines that start exactly with "### L-".
- (b) Rules 3 and 4, fence desync. The same builder-signed VERIFIED entry passes when it sits between two lines made of three backticks, "x" and one backtick. The parser toggles its fence state on any line that starts with three backticks. CommonMark does not open a fence when a backtick info string contains a backtick, so the entry renders as a normal heading.
- (c) Rule 2, decoy log. An ACTIVITY.md-only commit puts a copy of §16 above the real one, under the heading "16. Activity" plus two spaces plus "log", which the heading regex does not match. In the copy, L-0011's Evidence line reads "VERIFIED by MJ on 2026-10-25; CI green." An HTML comment opener goes just before the real §16 heading, and the closer just after the Appendix A heading, which is re-added below it. Both markers sit outside the parsed §16, so the no-comments rule never sees them. Rendered markdown shows only the tampered copy. Output: "0 new log entries, 1 changed files".
- (d) Rule 1 and §4: ACTIVITY.md changes outside §16 need no entry. Setting P1-01's board status to "VERIFIED (L-0034)" with no log entry passes. So does rewriting hard rule H-16 to "Avoid weakening a control where practical" together with Appendix C rule 1 ("or `scripts/`"). L-0033 says a change to any file needs an entry, but ACTIVITY.md itself is exempt everywhere outside §16.
- (e) Rule 4, a VERIFIED entry with no DONE to compare against. The builder's exact signature can log VERIFIED for P0-04 and P0-05; it logged only CLAIM, PROGRESS and DECISION entries for them. Its current signature can also VERIFY P0-06, which the same session ee095e06 built but logged DONE under the Fable 5.1 signature (L-0012).
- (f) Rule 4, task ids the regex cannot read. A Task line naming P1-01 and P0-06 passes under the builder's signature when P1-01 has a zero-width space after the hyphen, or a Cyrillic "Р" in place of the P. Only P0-06 is checked. L-0033 normalises dashes only.
- (g) Fail-open. The checker treats git errors as "no changes". A commit that edits L-0011's Evidence line and adds code with no new entry fails against 5f452fc (the control). The same commit passes with base 0000000000000000000000000000000000000000 or an unknown sha: "34 new log entries, 0 changed files". For pushes, CI passes `github.event.before`, which is all zeros on a branch's first push and may not be fetched after a force push. I did not test that in CI.
- (h) Rule 5 misses:
  - a password-named constant holding a template literal (backticks), and the same value wrapped in `String(...)`;
  - a 19-letter, digit-free value for `DB_PASSWORD` in `.env.example`;
  - a Postgres URL carrying a password to a Supabase host, with an empty user part or a `+driver` suffix on the scheme;
  - a gzip file containing a service-role-shaped JWT (`--text` does not decompress);
  - a JWT split across three string-concatenation lines.
  L-0033 says secret assignments are caught "in any case or syntax".
False positives that block legitimate work, each exiting 1:
- (i) a new test `supabase/tests/vault-leak.test.ts` that asserts a column list does not contain `unit_cost` is refused with "looks like supplier identity or cost data outside the vault". The doc 07 §5 vault tests that §6 requires cannot be written outside the two detector files;
- (j) a test fixture whose `idempotency_key` is a UUID, and a JSX `data-key` attribute holding a row id, are refused with "assigns a secret-looking value". H-08 makes idempotency keys mandatory;
- (k) a log entry that quotes an HTML comment inside backticks is refused with "HTML comments are not allowed inside the §16 log".
Controls on the same harness that held, each exiting 1: a code change with no entry; a builder-signed VERIFIED for P1-01 and P0-09 ("same agent as DONE L-0027"); a JWT on one line; `DB_PASSWORD` with a value containing digits. A legitimate change with a valid entry passed (exit 0). A bridge migration not named `_vault*` that uses `p_supplier_id` also passed, because `\b` does not match inside `p_supplier_id`, so that case is not a false positive.
Questions for MJ, not counted as defects:
- (Q1) A pre-0004 raw id that is already 64 lowercase hex is skipped by 0004's rehash and is not revoked by 0005. Observed: the row stays `approved`, the raw value stays in `public.device`, and the phone is locked out ("this device is not approved for this rep"). This is not exploitable without a sha256 preimage.
- (Q2) A consequence of B-16b: 25 `register_device` calls with one pending id from an unapproved phone wrote 25 audit rows (1 INSERT, 24 `last_seen_at` UPDATEs). A cap on pending devices alone does not bound audit growth.
- (Q3) 0005's revocations record no revoking user: `revoked_by` is null and the audit `actor_id` is null. Only the purpose string identifies them.
- (Q4) An untracked `apps/web/AGENTS.md` appeared in the working tree during this session (06:27 machine time). By its own text, `next dev` wrote it. I did not create, edit, commit or act on it. It contains instructions addressed to agents.
**Evidence:** All runs were local, with `DATABASE_URL` and `KIRAN_TEST_DATABASE_URL` unset, on embedded Postgres 17. No remote database, Supabase project or GitHub was touched.
1. Suite: the baseline `pnpm db:test` at 5f452fc gave "Test Files 1 failed | 4 passed (5) / Tests 1 failed | 380 passed (381)"; the one failure is the B-16a test, matching L-0034. With my file: "Test Files 2 failed | 4 passed (6) / Tests 2 failed | 389 passed (391)"; the new failure is defect 1. `pnpm typecheck` exit 0. I did not check CI.
2. Vault: `supplier_vault` usage is false for anon, authenticated and service_role, and `vault_api` has 0 functions. `app.has_vault_grant()` gives 42501 for anon and service_role. It is false for rep A, rep B, rep A on the wrong device, manager at AAL1, owner at AAL1 and the suspended rep, and true only for manager and owner at AAL2. Held.
3. Append-only: UPDATE and DELETE on `control.audit_event`, `control.approval_request` and `public.device` give 42501 for all 10 personas (60 attempts). Held.
4. Territory and list-dump: there are no salon tables yet (N/A). On the upgraded database, five headers were tried with the rep's session: the leaked raw id, its stored hash, the hash of that hash, a leading-space variant and an upper-case variant. Each read 0 profiles, 0 devices and 0 approval requests and was refused on write; `my_session` reports `revoked`. Held, before the re-approval in defect 1.
5. Approvals: a manager approving its own request → "maker cannot approve"; a rep deciding → "owner or manager only"; a wrong-device rep requesting → "device is not approved". Held.
6. Replay and time: the same client_id sent twice by rep A gives one row, the same id and one audit INSERT, with created_at within 5 s of server time. No function takes a client timestamp yet (N/A). Re-running 0005 on the post-0004 fixture database revokes nothing: the count of non-revoked devices is unchanged. Held.
7. Diff and history: `git log --all -p` covers 10 commits, all authored as MJ. It has 0 hits for JWTs, PEM private keys, AWS keys, `sb_secret_` or `sb_publishable_` values, GitHub, Slack or OpenAI-style tokens, +92 3xx or 03xx phones, CNIC, or PK IBAN. Connection strings: only the local `postgres:postgres@127.0.0.1` defaults and the `<password>` and `…` placeholders in L-0025 and L-0030. Phones: only the `+920000000001` to `004` fixtures. Emails: example.test fixtures, the CLI template `admin@email.com`, and commit metadata. The only tracked env file is `apps/web/.env.example`. No supplier names; "Dummy Supplier Ltd" appears only as test text inside log entries. Apart from the gaps above, the 5f452fc diff weakens no control.
**Rules touched:** H-01, H-06, H-16, H-17, H-20, H-23, H-24, H-25; SEC-03; doc 04 invariant 7; §4, §7; Appendix C
**Next / needs:** Builder, defect 1: settle B-16c with MJ, then make a retired or revoked fingerprint unusable, rotate the client id when the status is `revoked`, and fix the `/app` message for a revoked phone. Builder, defect 2:
- (a) parse any §16 line that renders as a heading and contains "L-" plus digits;
- (b) track fences the CommonMark way, or forbid fences in new entries;
- (c) refuse HTML comment markers anywhere in ACTIVITY.md, or any second "16." heading in any spelling;
- (d) require a new entry for any ACTIVITY.md change outside §16;
- (e) refuse a VERIFIED entry whose signer has any entry for the task, or require a DONE under a different signature, and compare the session part of the signature;
- (f) refuse non-ASCII characters in Task lines;
- (g) exit 1 when a git command fails or the base is not an ancestor of HEAD;
- (h) decide which rule 5 misses matter, and refuse compressed files;
- (i) to (k): give vault tests and idempotency keys a way through.
Then a different agent re-verifies P1-01 and P0-09. MJ: Q1 to Q4 and B-16.

### L-0036 · 2026-10-25 17:30 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P1-01, P0-09    **Claim:** C-001
**What / why:** Accepting L-0035. I committed the re-verifier-2 entry and `supabase/tests/reverify2-attacks.test.ts` unedited (commit cb9157a). P1-01 and P0-09 go back to IN PROGRESS. L-0035 was right that my L-0032 claim was false: the leaked-id fix does depend on Q6, because the real phone keeps the same id, so restoring it re-approves the leaked id. Per §1, with the docs silent on this security point, I am taking the more restrictive answer to B-16c (Q6): a revoked device id is dead for good. B-16b (pending cap) stays with MJ, since L-0035 Q2 shows a cap would not bound audit growth anyway. L-0035 Q1 (a pre-0004 raw id that was already 64-hex) and Q3 (null `revoked_by` on 0005's revocations) are noted and left as is: Q1 is not exploitable without a preimage and only locks that phone out; for Q3, the purpose string records the reason.
**Evidence:** `pnpm vitest run … reverify2 -t "DEFECT CHECK"` reproduced the defect before any change.
**Rules touched:** §1, §7, H-23
**Next / needs:** L-0037, L-0038, L-0039.

### L-0037 · 2026-10-25 17:40 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P1-01 (SEC-03, doc 04 invariant 7)    **Claim:** C-001
**What / why:** Migration `supabase/migrations/20261025123056_device_revoked_final.sql` makes `app.register_device` refuse a revoked device id ("device id revoked; generate a new one"); revoked rows never return to pending or approved. `apps/web` now rotates its device id when the session reports `revoked` (`rotateDeviceId()` in `lib/supabase/browser.ts`, used by `app/app/page.tsx`) and queues the fresh id for approval. A leaked raw id can therefore never pass the device gate again, whatever the office does. Also: `apps/web/next.config.ts` sets `agentRules: false`, so `next dev` no longer writes its own `apps/web/AGENTS.md` (L-0035 Q4); I deleted the generated file. My earlier test of revive-to-pending is replaced by "a revoked device id is dead for good", and the upgrade-path test now expects re-registration of the leaked id to be refused.
**Evidence:** `pnpm db:test` → "Tests 3 failed | 388 passed (391)". The 3 failures are verifier tests that encode the removed behaviour (L-0039). Both device-related ones now stop at the registration step with "device id revoked; generate a new one", so the attack is blocked before any approval. `pnpm typecheck` exit 0; `pnpm -C apps/web build` exit 0 ("Compiled successfully"), and no `apps/web/AGENTS.md` afterwards. Staging: migration recorded as `20261025123056_device_revoked_final`; `verify_audit_chain()` ok over 27 rows; authenticated can execute `app.register_device`, anon cannot; security advisors: only the intentional INFO.
**Rules touched:** H-08, H-16, H-17, H-23
**Next / needs:** Re-verification (§7) after MJ rules on B-16a.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24) — three verifier tests still fail by design, see L-0039

### L-0038 · 2026-10-25 17:50 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Rewrote `scripts/activity-log-check.mjs` against every L-0035 finding. The header now says plainly that it is a tripwire, not a proof; branch protection and a non-author reviewer remain the real control.
- **Base handling:** an unresolvable base fails closed; an all-zero base falls back to HEAD~1. Revisions are quoted, because `cmd.exe` treats `^` as an escape.
- **Markdown parsing:** CommonMark-style fence parsing, and look-alike headers are rejected (spacing, `####`, U+2011, zero-width).
- **Decoys:** one §16 heading per file, loosely matched; no HTML comments anywhere in ACTIVITY.md outside code, with inline code spans ignored.
- **Edits outside the log:** any change to ACTIVITY.md outside §16 needs a new entry.
- **VERIFIED entries:** each needs a DONE entry for every task it names, and a VERIFIED signature sharing a `session <id>` with the DONE counts as the same agent.
- **Task lines:** zero-width or Greek/Cyrillic look-alike characters are rejected.
- **Secrets:** quoted values of any kind, `String(...)`-style wrappers, password-like names at 12+ characters, and postgres URLs with an empty user or a `+driver` scheme.
- **False positives fixed:** supplier wording is allowed in `supabase/tests/`; code identifiers like `idempotency_key` and `data-key` no longer trip the check (env-style `*_KEY` stays upper-case only).

Not covered, by design: compressed or line-split secrets.
**Evidence:** Script `evasions2.sh`, run in a throwaway clone (deleted): "23 as expected, 0 wrong".
- **Fail as they should:** (a) the three look-alike headers; (b) the fence trick; (c) a decoy log plus a comment-hidden real log; (d1) a board edit and (d2) an H-16 rewrite with no entry; (e1) VERIFIED for tasks with no DONE; (e2) same-session VERIFIED of P0-06; (f1) zero-width and (f2) Cyrillic task ids; (g) tampering with an all-zero base or an unknown base; (h1–h5) a template literal, a `String()` wrapper, a 19-letter `DB_PASSWORD`, an empty-user URL, a `+driver` URL.
- **Pass as they should:** (i) a vault-leak test naming `unit_cost`; (j1) an `idempotency_key` fixture; (j2) a JSX `data-key`; (k) a log entry quoting an HTML comment in backticks; a legitimate change.
- **Earlier set:** `evasions.sh` from L-0033 still blocks all 19 attack cases. Its "legitimate" case now reuses the existing number L-0031, so it is correctly not counted as new.

On this branch: `node scripts/activity-log-check.mjs main` → OK.
**Rules touched:** H-01, H-20, H-23, H-25
**Next / needs:** Re-verification (§7).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24) — three verifier tests still fail by design, see L-0039

### L-0039 · 2026-10-25 17:55 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · BLOCKER
**Task:** P1-01    **Claim:** C-001
**What / why:** Three verifier tests now fail because they encode behaviour that the fixes deliberately removed. Under H-23 I have not edited them.
1. "DEFECT CHECK: after 0004 no raw device id … remains readable in the audit log" (L-0030): it requires rewriting the append-only, hash-chained audit log (L-0034).
2. "DEFECT CHECK: a raw id leaked into pre-0004 audit history never passes the device gate again …" (L-0035): it asserts, as intermediate steps, that re-registering the leaked id revives the original row as `pending` and that the owner's approval succeeds. With 0006 the attack is refused at the registration step. Its own secure goal holds, but it never reaches that assertion.
3. "QUESTION (not a defect): a device the office revoked can re-enter the queue …" (L-0030): it records the old revive-to-pending behaviour.

CI `db-tests` stays red until MJ rules. B-16 is updated.
**Evidence:** `pnpm db:test` → exactly these 3 failures. Tests 2 and 3 fail with "device id revoked; generate a new one" thrown at the re-register step.
**Rules touched:** H-06, H-17, H-23
**Next / needs:** MJ: approve updating these three tests so they assert the secure end state (the leaked or revoked id never passes the gate; re-registration is refused), or choose another approach.

### L-0040 · 2026-10-25 18:10 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DECISION
**Task:** P1-01 (B-16a)    **Claim:** C-001
**What / why:** MJ approved: "Approved: update the three verifier tests in B-16a to assert the secure end state (leaked or revoked ids never pass the gate; re-registering them is refused; audit history stays append-only)." B-16(a) is resolved. B-16(b), the pending-device cap, stays open. B-16(c) stands as implemented in L-0037, and MJ has not overruled it.
**Rules touched:** H-23 (test change made under explicit MJ approval)
**Next / needs:** L-0041.

### L-0041 · 2026-10-25 18:20 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P1-01    **Claim:** C-001
**What / why:** Updated the three B-16a tests under L-0040. Each keeps its setup, attack steps and goal; only the assertions that described removed behaviour changed.
1. `reverify-attacks.test.ts`, upgrade path:
   - it now applies every migration from 0004 on, not just 0004;
   - it accepts that append-only history keeps the raw id, and asserts that editing that row fails ("append-only");
   - it asserts the device is revoked, the raw id is refused at the gate, re-registering it is refused, and the chain verifies.
2. `reverify2-attacks.test.ts`, L-0035 test: re-registering the leaked id is refused and the original row stays revoked; a made-up id still makes a new row; the office cannot re-approve the old row; the final assertion (the leaked id never passes the gate) is unchanged.
3. `reverify-attacks.test.ts`, the former Q6 test: a device the office revoked can neither re-register nor be approved, and stays revoked.

Titles now cite B-16a / L-0040.
**Evidence:** `pnpm db:test` → "Test Files 6 passed (6), Tests 391 passed (391)". Mutation check: a temporary migration restoring the old revive-to-pending and unconditional-approve behaviour made all three updated tests fail, plus one existing test ("Tests 4 failed | 23 passed (27)" on the reverify files). The temporary file was deleted, and `git status` shows only the two test files changed.
**Rules touched:** H-23
**Next / needs:** CI on this push; re-verification of P1-01 and P0-09 (§7).

### L-0042 · 2026-10-25 19:00 PKT · Claude · Opus 5.5 · re-verifier-3 subagent · branch feat/p0-foundation (K repo) · CORRECTION
**Task:** P1-01, P0-09    **Claim:** —
**What / why:** Independent §7 re-verification of L-0037 (P1-01) and L-0038 (P0-09), after L-0039 to L-0041, under MJ's ruling in L-0029. I am a fresh subagent and wrote none of L-0025, L-0030 or L-0035. Result: **neither P1-01 nor P0-09 is VERIFIED.** Every database control held under every attack below; the P1-01 defect is in the client half of L-0037 only. This entry corrects L-0037 and L-0038, and through them L-0011 and L-0013. I added one file, `supabase/tests/reverify3-attacks.test.ts`, which is not committed. Its one failing test is defect 1 and is left in place on purpose (H-23). I edited no other file and did not touch the status board. The builder should set P1-01 and P0-09 back to IN PROGRESS.
Defect 1 (corrects L-0037, client half; low severity, not exploitable). `lib/supabase/browser.ts` says `rotateDeviceId()` will "rebuild the client so the new header is sent". It does not. In the installed `@supabase/ssr` 0.12.7, `createBrowserClient` returns a cached module-level client whenever `window` exists and the options carry no `isSingleton`; `supabaseBrowser()` passes none, so after the rotation it gets back the same client, which still sends the revoked id. In the `app/app/page.tsx` sequence, `register_device` carries the new id only as `p_fingerprint` while `x-kiran-device` is still the revoked id, and the follow-up `my_session` reads the revoked row. Until the page reloads every call sends the revoked id, so approving the new phone has no effect in that page. The database still refuses the revoked id, so nothing is bypassed. L-0037's evidence for the client was a build, not a run. Reproduce: `pnpm vitest run --config supabase/tests/vitest.config.ts reverify3 -t "DEFECT CHECK"`. The test transpiles the real `browser.ts` with the repo's TypeScript and runs it in a separate node process against the installed `@supabase/ssr`, with a browser stub and a fetch stub that records requests (nothing leaves the machine), then replays the page sequence. Real output: same client object before and after the rotation; both `rpc/register_device` and `rpc/my_session` carried the old id in `x-kiran-device`; "AssertionError: expected [ …(2) ] to deeply equal [ …(2) ]".
Defect 2 (corrects L-0038; Appendix C rules 2 to 5). I tested in a throwaway clone under the scratchpad, deleted afterwards, with `KIRAN_SENSITIVE_TERMS` empty. Each case was one commit on top of c9d830e, checked with `node scripts/activity-log-check.mjs c9d830e HEAD`. Every case below exited 0 with "activity-log-check OK". In E1 to E5 the forged entry is a VERIFIED entry for P1-01 and P0-09 signed exactly as the builder (L-0037's signature), with Task, Evidence and checklist lines, placed after one valid PROGRESS entry.
- (E1) The header written as an HTML heading, `<h3>L-0043 · … · VERIFIED</h3>`.
- (E2) An ATX header with the entity `&#76;` in place of the L.
- (E3) An ATX header with the id in bold, `**L-0043**`.
- (E4) A setext heading: the header text, then a line of `===`; also with a line of four hyphens (E4b).
- (E5) A line `## 16.1 Activity log (continued)` before the forged entry. It matches the end-of-§16 pattern, so everything after it is outside the parsed log and is never checked.
  By the CommonMark spec, E1 to E4 render as headings that read like an entry header; I did not render the file. `headerLike` only inspects lines that start with `#` followed by an L. L-0038 says look-alike headers are rejected.
- (E6) Decoy log, as in L-0035 (c) but without comments. A full copy of §16 goes above the real one under the heading `## 16\. Activity log (append-only)`; the backslash escape renders as the same heading text and is not matched by the loose §16 pattern. In the copy, L-0011's Evidence line gains "(VERIFIED by MJ, CI green)". The real §16 plus one valid entry is wrapped in `<details><summary>Archive</summary>` … `</details>`. Browsers show `<details>` content collapsed until it is opened; I did not view a rendered page. L-0038 says decoys are caught by "one §16 heading per file, loosely matched".
- (E7) Rule 4: a VERIFIED entry by another signer whose Task line names P0-04, written with U+02D7 (modifier letter minus) for the hyphen, and P0-06. Only P0-06 is checked, so P0-04, which has no DONE entry, passes. With an ASCII hyphen the same entry fails ("P0-04 has no DONE entry to verify"). The look-alike filter covers only Greek, Cyrillic, Glagolitic and fullwidth letters.
- (E8 to E10) Rule 5: a password-named constant whose quoted value is letters, digits and one dot (the same value without the dot fails); a password-named variable in `apps/web/.env.example` whose value starts with a dollar sign; a password-named constant holding a quoted passphrase with spaces (only the first word is measured). `isReference` treats any dotted word value, and any value starting with a dollar sign, as a reference.
- (E11, E12) Rule 5, env files: a force-added `apps/wéb/.env.local` passes, while the same file at `apps/web/.env.local` fails ("environment files must never be committed"). Git C-quotes non-ASCII paths, and the `diff --git` regex never matches the quoted form. A committed `apps/web/.env-backup` also passes: the regex needs `.env` followed by a dot or the end, and `.gitignore`'s `.env.*` does not cover it either.
- (E13) Fail-open: three 90 MB text files, each under GitHub's 100 MB per-file limit, plus a one-line JWT in `apps/web/lib` gives OK ("1 new log entry, 5 changed files"). The same JWT without the big files fails. The rule 5 `git diff` output exceeds the 256 MB `maxBuffer`, the exception is swallowed, and nothing is scanned. L-0038 says base handling fails closed; this git failure still fails open.
False positives that block legitimate work, each exit 1:
- (FP1) a new entry with a fenced YAML example containing a line of three hyphens is refused with "A `---` separator may appear only as the last line of the log"; that rule ignores fences;
- (FP2) a test file with a password literal of 12 or more characters for local GoTrue tests (`supabase/config.toml` sets the minimum length to 12) is refused with "assigns a secret-looking value". A computed value works around it.
Controls on the same harness that held, each exit 1: a code change with no entry; an edited L-0011 line ("not append-only at existing line 86"); the builder-signed VERIFIED with a canonical header ("VERIFIED by the same agent as DONE L-0011 for P1-01"); a one-line JWT; a force-added `apps/web/.env.local`. A legitimate code change with a valid entry passed (exit 0).
Doc drift (H-25, not counted as a defect): Appendix C rule 1 still says "Files outside `docs/`" and rule 2 still says the table sections may change, but since L-0033 and L-0038 the script needs a new entry for a change to any file and for any ACTIVITY.md change outside §16. No DEVIATION was logged.
The three tests MJ approved changing (L-0040, L-0041) still test something real. I checked this with temporary migrations `supabase/migrations/20261026000000_rv3_mutant.sql`, one at a time, each deleted afterwards (`git status --short` empty after each):
- (A1) `register_device` restored to 0004's revive-to-pending: "Tests 5 failed | 386 passed (391)", namely all three L-0041 tests plus the builder's two tests for 0006;
- (A2) `approve_device` accepting revoked rows: 3 failed, including the former Q6 test and the L-0035 test;
- (B) the gate also accepting revoked devices: 4 failed, including the upgrade-path test and the L-0035 test;
- (C) `audit_row` storing the raw device id again: 4 failed, but not the upgrade-path test;
- (D) `audit_event` without its append-only trigger: 3 failed, including the upgrade-path test.
So each changed test fails when the control it asserts is removed. The upgrade-path test now asserts that pre-0004 raw ids remain (append-only), so it no longer detects raw ids written after 0004 (mutant C). Four other tests catch that, so there is no net loss. Nothing asserts 0004 in isolation any more, which L-0040 covers. The former Q6 test accepts any 42501 refusal rather than a specific message, which is still a refusal. I found no weakening beyond L-0040.
Questions for MJ, not counted as defects:
- (Q1) The table owner (`postgres`) can TRUNCATE `control.approval_request` and `public.device`. In a rolled-back test both emptied, no audit row was written, and the chain still verified. The owner can also disable triggers on its own tables, so this adds no new power; detection rests on the off-site audit mirror (doc 06 §6).
- (Q2) A rep's pending discount request stays decidable after the rep is suspended: a manager approved it.
**Evidence:** All runs were local, with `DATABASE_URL` and `KIRAN_TEST_DATABASE_URL` unset, on embedded Postgres 17. No remote database, Supabase project or GitHub was touched.
1. Suite: baseline `pnpm db:test` at c9d830e gave "Test Files 6 passed (6) / Tests 391 passed (391)". With my file, two full runs, identical: "Test Files 1 failed | 6 passed (7) / Tests 1 failed | 401 passed (402)"; the one failure is defect 1. `pnpm typecheck` exit 0. I did not check CI.
2. Vault: `select count(*) from supplier_vault.supplier` gives 42501 for all 10 personas (anon, service_role, rep A, rep B, rep A on the wrong device, manager and owner at AAL2 and AAL1, suspended rep). `app.has_vault_grant()` gives 42501 for anon and service_role, is true only for manager and owner at AAL2, and is false for the manager right after the owner revokes the grant in the same transaction. Held.
3. Append-only: UPDATE, DELETE and TRUNCATE on all 7 tables give 42501 for all 10 personas (210 attempts). Held. Owner-level TRUNCATE: Q1.
4. Territory and list-dump: there are no salon tables yet (`to_regclass('public.salon')` is null), so N/A. Rep A on the approved phone reads 1 profile and 0 rows of other users' profiles, devices or approval requests, and 0 config rows. Held.
5. Approvals: manager and owner approving their own request gives "maker cannot approve"; a rep deciding gives "owner or manager only"; a manager deciding an owner's write_off requested with checker 'manager' gives "needs the owner's decision". Held.
6. Replay and time: `register_device` twice with one id gives the same row; `request_approval` twice with one client_id and a changed payload gives the same id and 1 row. Backdating: the only function in `app`, `control` or `vault_api` that authenticated may execute with a date or time argument is `app.owner_create_user` (an HR start date), so N/A. Device lifecycle after 0006: suspend then reactivate leaves the old id refused at the gate and at registration ("device id revoked"); a fresh id registers as pending, a manager approves it, the gate passes for it and still refuses the old id. A rep, manager, rep role round trip does not revive a revoked id (registration refused, 0 live devices). Held.
7. Diff and history: I read the diffs of 76a1f33, cb9157a and c9d830e. `git log --all -p` (13 commits) has 0 hits for JWTs, PEM private keys, AWS keys, `sb_secret_` or `sb_publishable_` values, GitHub, Slack or OpenAI-style tokens, +92 3xx or 03xx phones, CNIC, or PK IBAN. Connection strings: only the local `postgres:postgres@127.0.0.1` defaults and the `<password>` and `…` placeholders. Phones: only the `+920000000001` to `004` fixtures. Emails: commit metadata, example.test fixtures and the CLI template `admin@email.com`. The only env file ever tracked is `apps/web/.env.example`. No supplier names. Apart from the findings above, no weakened control.
**Rules touched:** H-16, H-20, H-23, H-24, H-25; SEC-03; doc 04 invariant 7; §7; Appendix C
**Next / needs:** Builder, defect 1: create the browser client with `isSingleton: false` and rebuild it after rotation, or keep one client and set `x-kiran-device` per request; the DEFECT CHECK should then pass. Builder, defect 2:
- (a) treat every heading form in new §16 text as a header candidate (ATX, setext, HTML h1 to h6), after decoding entities and stripping emphasis, or refuse raw HTML, entities and setext underlines in new log text;
- (b) refuse any heading in new log text other than a canonical entry header, so nothing can end the parsed log early;
- (c) detect a second log by content (for example a copy of the L-0001 header line outside §16), not only by its heading;
- (d) refuse every non-ASCII character in Task lines;
- (e) exit 1 when any git command fails, including on `maxBuffer`;
- (f) decide which rule 5 misses matter; read paths with `-c core.quotePath=false` or `-z`, and cover `.env-*` names;
- (g) fix FP1 by ignoring fenced lines in the `---` rule, and decide FP2;
- (h) update Appendix C rules 1 and 2 or log a DEVIATION (H-25).
Then a different agent re-verifies P1-01 and P0-09. MJ: Q1 and Q2.

### L-0043 · 2026-10-25 21:00 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P1-01, P0-09    **Claim:** C-001
**What / why:** Accepting L-0042. I committed the re-verifier-3 entry and `supabase/tests/reverify3-attacks.test.ts` unedited (commit 0373bdd). Every database control held, and the three tests MJ approved changing (L-0040) were mutation-checked and still bite. The defects are in the rep app's client handling (P1-01) and in the log check (P0-09). P1-01 and P0-09 go back to IN PROGRESS. For the log check I stopped chasing individual Markdown tricks and switched to a narrow structure that ACTIVITY.md must follow (L-0046).
**Evidence:** Before any change, `pnpm vitest run … reverify3` reproduced defect 1 ("sameClient: true"; both RPCs carried the old `x-kiran-device`).
**Rules touched:** §7, H-23
**Next / needs:** L-0044 to L-0047.

### L-0044 · 2026-10-25 21:05 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DEVIATION
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Appendix C rewritten to match the script (H-25, L-0042 doc drift). The rules are stricter than the original text:
- rule 0: fail closed;
- rule 1: any change, including docs and ACTIVITY.md outside §16, needs an entry;
- rule 2: a narrow structure for ACTIVITY.md;
- rule 3: a character allowlist for Task lines;
- rule 4: VERIFIED needs a DONE entry and a different session;
- rule 5: wider secret patterns, `.env*` files, and the owner term list.

Nothing is loosened. Appendix C is the CI spec, not a fixed decision, permission matrix or threshold (H-26).
**Rules touched:** H-25, H-26
**Next / needs:** —

### L-0045 · 2026-10-25 21:10 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P1-01 (SEC-03; rep app client)    **Claim:** C-001
**What / why:** Fixes L-0042 defect 1 in `apps/web/lib/supabase/browser.ts`. `@supabase/ssr` 0.12.7 returns its own module-level cached client in a browser unless `isSingleton: false` is passed, so a rotated device id never reached the `x-kiran-device` header. `supabaseBrowser()` now passes `isSingleton: false`, remembers which device id its client was built for, and rebuilds when the id changes. `rotateDeviceId()` clears both. The database side of P1-01 is unchanged; it held every L-0042 attack.
**Evidence:** The verifier's test `reverify3-attacks.test.ts` "DEFECT CHECK" passes unchanged: it transpiles the real `browser.ts` against the installed library and replays the page sequence. `pnpm vitest run … reverify3` → "Tests 11 passed (11)"; `pnpm db:test` → "Test Files 7 passed (7), Tests 402 passed (402)"; `pnpm typecheck` exit 0; `pnpm -C apps/web build` exit 0 ("Compiled successfully").
**Rules touched:** H-23
**Next / needs:** Re-verification (§7).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0046 · 2026-10-25 21:20 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Rewrote `scripts/activity-log-check.mjs` against every L-0042 finding. The check now holds ACTIVITY.md to a narrow structure instead of trying to recognise every Markdown trick.
- **Whole file, outside code:** no raw HTML, entities, comments or setext headings, and any line shaped like an entry (`… PKT · …`) must be a canonical header.
- **§16 boundaries and new text:** §16 ends only at `## Appendix`; new log text may contain no other headings. The §16 heading match ignores backslashes.
- **Task lines:** non-ASCII characters are refused outside a small allowlist.
- **Git handling:** git runs without a shell, with raw UTF-8 paths, NUL-separated file lists and a 512 MB buffer. Any git error fails closed, and quoted diff headers are unescaped.
- **Secrets:** any file named `.env*` other than `.env.example` is refused; quoted values are measured in full; a quoted dotted value is no longer treated as a reference; only `$UPPER_CASE` or `${…}` count as env references, and `"env(NAME)"` stays allowed for `config.toml`.
- **False positives:** `---` inside code blocks is allowed, and secret-named assignments are not checked in `supabase/tests/`.
**Evidence:** In throwaway clones (deleted): `evasions3.sh` → 19 of 20 as expected. The one miss is case E7, a shell artifact: Git Bash writes `\u02d7` literally, so no look-alike character was present. `evasions3b.sh` writes the real characters with Python → "6 as expected, 0 wrong".
- **Fail as they should:** E1 `<h3>`; E2 `&#76;`; E3 bold id; E4/E4b setext; E5 `## 16.1`; E6 escaped-dot decoy plus `<details>`; E7 U+02D7, U+200B, U+0420 and U+2011 in task ids; E8 quoted value with a dot; E9 `$`-prefixed value; E10 passphrase with spaces; E11 `apps/wéb/.env.local`; E12 `.env-backup`; E13 2 × 90 MB files plus a JWT (JWT found); S1 code change with no entry; S2 edited log line; S3 builder self-verify.
- **Pass as they should:** FP1 fenced YAML with `---`; FP2 a 12+ character test password in tests; an allowed en dash and §; a legitimate change.

On this branch: `node scripts/activity-log-check.mjs main` → OK; `node scripts/activity-log-check.mjs nope123` → fails closed.
**Rules touched:** H-01, H-20, H-23, H-25
**Next / needs:** Re-verification (§7).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0047 · 2026-10-25 21:25 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · BLOCKER
**Task:** P1-01    **Claim:** C-001
**What / why:** Two verifier questions from L-0042 need MJ (B-17).
- **Q1:** the table owner can TRUNCATE `approval_request`, `device`, `user_profile`, `app_config` and `doc_counter` with no audit row. I built a guard (statement-level TRUNCATE triggers), then backed it out unapplied. The verifier's own test records today's TRUNCATE behaviour as an observation, and it would need MJ's approval to change. The verifier also noted that the table owner can disable triggers anyway, so the guard adds little.
- **Q2:** a manager can still approve a pending request whose maker has since been suspended.

Neither is exploitable by an application role.
**Evidence:** With the guard, `pnpm db:test` showed exactly the verifier's TRUNCATE observation test failing, plus a structural test I had added. After backing out, `git status` shows no migration or test change from this, and the suite is 402/402.
**Rules touched:** H-07, H-23
**Next / needs:** MJ: (Q1) add TRUNCATE guards and update that observation test, or leave as is? (Q2) should decisions on a suspended maker's pending requests be refused?

### L-0048 · 2026-10-25 22:00 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · SESSION-START
**Task:** P1-01, P0-09, P0-04, P0-05 (follow-up brief from MJ, folding in the independent end-to-end check)    **Claim:** C-001 (renewed in L-0049)
**What / why:** MJ pasted a follow-up brief written against an earlier snapshot (HEAD c9d830e, with `reverify3-attacks.test.ts` still untracked). §2 checklist:
1. Read this file in full, including all entries to L-0047, the blockers B-01 to B-17, the board and claims.
2. Read `00-README.md` and the docs behind P1-01/P0-09/P0-05, plus `docs/test-report-2026-10-25.md`.
3. Claims: only C-001, which is mine.
4. Blockers read: B-12 resolved, B-13 open, B-15a open, B-16b open, B-17 open.
5. Branch `feat/p0-foundation`; baseline `pnpm db:test` 402/402, typecheck exit 0.
6. Environment: local plus staging only; no production access.

Where the brief is already out of date:
- `reverify3-attacks.test.ts` was committed unedited in 0373bdd, with the re-verifier-3 entry L-0042.
- F-1 was corrected (L-0042/L-0043) and fixed (L-0045).
- The log is at L-0047, so the brief's "L-0042 next" no longer applies; numbering continues at L-0048.

I am doing the parts still open: a CORRECTION against L-0037, F-1 before/after evidence, F-2 (blocker plus staging smoke script), F-3 (investigation plus blocker), the Gate 0 human-only list, and a HANDOFF. No P1-02 work. I did not reinstall dependencies: everything ran in the Windows shell that installed them.
**Rules touched:** H-19, H-22, H-23
**Next / needs:** L-0049.

### L-0049 · 2026-10-25 22:00 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · CLAIM
**Task:** P0-04, P0-05, P1-01, P0-09    **Claim:** C-001 (renewed)
**What / why:** Areas: `scripts/staging-smoke.mjs` (new), `package.json` (script `staging:smoke`), `docs/gate-0-checklist.md`, `docs/test-report-2026-10-25.md` (copied from `Kiran Company/plan/`), and this file. No migration, no change to any test file. I wrote these entries after starting the work in this turn: the claim covers that work.
**Rules touched:** —
**Next / needs:** —

### L-0050 · 2026-10-25 22:05 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · CORRECTION
**Task:** P1-01 (corrects L-0037)    **Claim:** C-001
**What / why:** The independent check (`docs/test-report-2026-10-25.md`; separate Fable 5.1 session, read-only, run at c9d830e) found two claims in L-0037 that were not true end to end.
- **F-1:** L-0037 said the rep app "queues the fresh id for approval". It did not: `@supabase/ssr` returned its cached singleton client, so the old `x-kiran-device` header stayed after rotation. Re-verifier-3 found the same (L-0042). The fix is in L-0045 (`isSingleton: false`, and the client is rebuilt when the id changes).
- **F-2:** L-0037 said "authenticated can execute `app.register_device`". That was a database grant check, not an API check. On hosted staging the Data API exposes only `public` and `graphql_public`, so every `app.*` call returns 406 "Invalid schema: app"; login and device registration cannot complete against staging. `supabase/config.toml` sets this only for the local CLI stack. The fix is a dashboard setting, which only MJ can change: B-18, L-0051.
**Evidence:**
- **F-1, before:** with the pre-fix `browser.ts` (from 76a1f33) temporarily in place, `pnpm vitest run --config supabase/tests/vitest.config.ts reverify3 -t "DEFECT CHECK"` failed: "Tests 1 failed | 10 skipped (11)", probe `"sameClient":true`, and both `rpc/register_device` and `rpc/my_session` sent the old id.
- **F-1, after:** with the current file restored (checked with `cmp`), the same command gave "Tests 1 passed | 10 skipped (11)". `git status` was clean afterwards.
- **F-2:** `pnpm staging:smoke` (L-0053) gave "FAIL app.my_session reachable [406 PGRST106: Invalid schema: app]" and the same for `app.register_device`.
**Rules touched:** H-23, H-24, H-25
**Next / needs:** B-18 (MJ).

### L-0051 · 2026-10-25 22:10 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · BLOCKER
**Task:** P0-05 (SEC-02, SEC-03 end to end)    **Claim:** C-001
**What / why:** F-2. Hosted staging does not expose the `app` and `vault_api` schemas. Only MJ can change this, in the Supabase dashboard (the agent's Supabase tools cannot change API settings). Exact steps: **Project Settings → Data API → Exposed schemas → add `app` and `vault_api`. Keep `control` and `supplier_vault` UNEXPOSED.** Then run `pnpm staging:smoke`, which must print "All checks passed". The step is now the first item of `docs/gate-0-checklist.md`, with a standing note that every hosted project (production later) needs it, because `config.toml` does not apply to hosted projects. B-18 added.
**Evidence:** Smoke run on 2026-10-25: 2 FAIL (the two `app` probes, 406), 3 PASS (`control` 406, `supplier_vault` 406, anon read of `user_profile` 401/42501).
**Rules touched:** H-19
**Next / needs:** MJ: change the setting, then run the smoke check.

### L-0052 · 2026-10-25 22:15 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · BLOCKER
**Task:** P1-01    **Claim:** C-001
**What / why:** F-3 is a question for MJ, not a defect. The report saw re-verifier-3's test "suspend then reactivate: the old id stays dead…" fail with `visible: 4` against an expected 2. What I found:
1. The report ran while re-verifier-3 was still editing that file (the report notes the file was touched at 19:50). The committed version (0373bdd) no longer expects a literal 2. It asserts `visible` equals `total` (rep B, on its approved fresh device, sees exactly its own device rows) and `total >= 2`. It passes in every run here: 402/402 in the full suite, 11/11 for the file alone.
2. The count depends on file order. All test files share one database, and `foundation.test.ts` commits two extra devices for rep B (one in "a new device starts pending…" and one in "a revoked device id is dead for good…"). The fixture device, plus this test's fresh device, plus those two makes exactly 4, the number the report saw. When reverify3 runs first, the total is 2.
3. The four visible rows are all rep B's own: the approved fresh device, and its revoked or pending older ones. This is the own-rows device policy (`user_id = auth.uid() and app.self_ok()`); no other user's row is visible.

I have not edited the test.
**Evidence:** `git show 0373bdd:supabase/tests/reverify3-attacks.test.ts` contains `expect(visible).toBe(total)` and `expect(total).toBeGreaterThanOrEqual(2)`. Full `pnpm db:test` → "Test Files 7 passed (7), Tests 402 passed (402)".
**Rules touched:** H-23
**Next / needs:** MJ (B-19): should a rep see its own revoked and pending device rows (today: yes; harmless, and useful on a "my phones" screen), or only the approved one? Separately, should tests stop sharing committed rows between files, to remove order dependence? Any change to that test needs your explicit approval, as in L-0040.

### L-0053 · 2026-10-25 22:25 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P0-04, P0-05    **Claim:** C-001
**What / why:** Added `scripts/staging-smoke.mjs` (run with `pnpm staging:smoke`). It is read-only, uses only the anon/publishable key from `KIRAN_STAGING_URL` and `KIRAN_STAGING_ANON_KEY`, never prints the key, and refuses to run with a service-role or secret key. It checks:
- `app.my_session` and `app.register_device` are reachable (401/403 counts as reachable; 406 PGRST106 or 404 PGRST202 is a fail);
- `control` and `supplier_vault` answer 406 PGRST106;
- an anonymous read of `user_profile` is refused.

The `register_device` probe cannot write: anon has no EXECUTE grant on it, and the function also refuses callers without a profile. I rewrote `docs/gate-0-checklist.md` as one ordered list of MJ's human-only actions:
1. Expose `app`/`vault_api` (keep `control` and `supplier_vault` hidden).
2. Auth settings: sign-up off, TOTP on, password length 12.
3. Owner account and TOTP via `docs/runbooks/owner-bootstrap.md`.
4. Branch protection on `main` (B-13).
5. The `KIRAN_SENSITIVE_TERMS` secret (B-15a).
6. D-08/B-01 to B-11, B-14, B-16b, B-17, B-19.

It also carries a standing runbook note on exposed schemas and the smoke command. Copied the independent report to `docs/test-report-2026-10-25.md`; a grep found no keys or connection strings in it.
**Evidence:** Smoke run on staging: exit 1, with "FAIL app.my_session … [406 PGRST106]", "FAIL app.register_device … [406 PGRST106]", "PASS control schema NOT exposed (406)", "PASS supplier_vault schema NOT exposed (406)", "PASS anon cannot read public.user_profile [401 42501]". `pnpm db:test` → 402/402; `pnpm typecheck` exit 0; `pnpm -C apps/web build` exit 0 ("Compiled successfully"); service-role scan of `apps/web/{app,components,lib}` → none.
**Rules touched:** H-18, H-19, H-25
**Next / needs:** L-0054.

### L-0054 · 2026-10-25 22:30 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · HANDOFF
**Task:** P1-01, P0-09 (DONE, self-reported); P0-04, P0-05 (IN PROGRESS)    **Claim:** C-001 (stays open for P0-04/P0-05)
**What / why:** **State.** Branch `feat/p0-foundation`, PR https://github.com/ethancrystal/kiran-dms/pull/1.
- **Staging** has migrations 0001 to 0006; the audit chain verifies; the advisors show only the two intentional INFO notices.
- **Board:** P0-06 and P0-08 VERIFIED (L-0030). P1-01 and P0-09 DONE (self-reported; redone in L-0045/L-0046 after L-0042). Nothing is marked VERIFIED by me.
- **Not working:** login and device registration against staging (F-2, B-18); the office login has never run end to end (there is no owner account).
- **Not started:** P1-02 and everything after it (Gate 0 not accepted).

**Next steps, in order:**
1. MJ does `docs/gate-0-checklist.md` items 1 to 3, then runs `pnpm staging:smoke` until it prints "All checks passed".
2. Re-verification of P1-01 and P0-09 by a DIFFERENT agent (§7, L-0029): requested here, not started by me. Focus on the L-0045 client fix and the L-0046 log check; the database held all of L-0042.
3. MJ answers B-17, B-19, B-16b and items B-01 to B-11, then signs Gate 0.
4. Then P1-02 and P1-03 per §12.1.

**Gotchas:**
- This machine has a global `DATABASE_URL` (an unrelated remote host) and `NODE_ENV=development`. The harness reads only `KIRAN_TEST_DATABASE_URL`, and the web build pins production through `cross-env`.
- `node_modules` here is Windows-built; any Linux/WSL agent must reinstall (embedded-postgres is platform-specific).
- In Git Bash, `$'\u…'` does not produce the character, so look-alike tests must write characters with Python or Node.
- Test files share one database, so counts of committed rows depend on file order (L-0052); assert relative counts.
- Supabase records its own migration versions; rename local files to match after `apply_migration`.
- `apps/web/.env.local` points at staging with the publishable key and is git-ignored.

**Open blockers:** B-13, B-15a, B-16b, B-17, B-18, B-19, B-01 to B-11, B-14 (all MJ).

**Could not run:** the end-to-end office or rep login (needs B-18 and the owner account); CI on this commit (it runs after the push; the previous commit 4f6e71a was pushed before this check).
**Evidence:** Commits this session after the brief: 0373bdd (verifier files), 4f6e71a (L-0042 fixes), plus the commit carrying these entries. `pnpm db:test` 402/402; `pnpm typecheck` exit 0; web build exit 0; `pnpm activity:check` run before committing (result in the commit message); staging smoke 3 PASS / 2 FAIL (F-2).
**Rules touched:** §11, H-23, H-24
**Next / needs:** MJ: gate checklist items 1 to 6.

### L-0055 · 2026-10-25 23:30 PKT · Claude · Opus 5.5 · re-verifier-4 subagent · branch feat/p0-foundation (K repo) · CORRECTION
**Task:** P1-01, P0-09    **Claim:** —
**What / why:** Independent §7 re-verification of L-0045 (P1-01, rep app client) and L-0046 (P0-09, log check), under MJ's ruling in L-0029. I am a fresh subagent and wrote none of L-0025, L-0030, L-0035, L-0042 or L-0043 to L-0054. Result: **neither P1-01 nor P0-09 is VERIFIED.** The L-0042 rotation defect itself is fixed, and every database test still passes, but I found one new client defect (corrects L-0045) and three log-check defects plus false positives (corrects L-0046). I added one file, `supabase/tests/reverify4-attacks.test.ts`, not committed. Its six failing tests are the defects and false positives below, left in place on purpose (H-23). I edited no other file and did not touch the status board.
Defect C1 (corrects L-0045; low severity, not exploitable). After a revoke, `app/app/page.tsx` registers two phones when its effect runs twice, and keeps only one. Two runs happen in development under React strict mode (`next.config.ts` sets `reactStrictMode: true`), and in production when two tabs of the rep app are open. Each run reads the revoked id, calls `rotateDeviceId()` and registers its own fresh id. localStorage ends up with the second id, so the first is an orphan pending device. If the office approves the orphan, the phone stays pending after a reload, which is the same symptom as L-0042 defect 1. The database refuses the revoked id throughout, so nothing is bypassed. Reproduce with `pnpm vitest run --config supabase/tests/vitest.config.ts reverify4 -t "DEFECT CHECK"`; each probe runs the real `browser.ts` and the real `page.tsx`. Real output, strict mode: `my_session` was sent twice with the old id, then two `localStorage.removeItem`, then `register_device` with two different new ids, each with header equal to `p_fingerprint`; registered 2 ids, kept the second. The two-tab test gave the same output. Both fail with "expected [ …(2) ] to deeply equal [ Array(1) ]".
Defect L1 (corrects L-0046; Appendix C rule 2). A code fence opened inside a list item hides a forged entry. The new text is a valid entry, then a list item `- note` whose next line is two spaces and three backticks. Then come a forged header for L-0056, typed VERIFIED and signed "MJ · human · owner sign-off", a Task line, an Evidence line "VERIFIED by MJ, CI green.", a `<details>` line, and a second list item `- end` with an indented closing fence. Result: exit 0, "activity-log-check OK (1 new log entry, 1 changed files)". The script's fence scanner treats every line in between as code and skips all structural rules. CommonMark closes a fence when its list item ends. Rendering the same text with markdown-it-py 4.2.0 (`commonmark` preset) gave a real `<h3>` for the forged L-0056 header, a paragraph with its Task and Evidence lines, and the raw `<details>` block. I did not view GitHub's rendering.
Defect L2 (corrects L-0046; rule 4, the L-0042 E7 class is still open). A VERIFIED entry by another signer with Task line `P0–04, P0-06` passes (exit 0). The first id uses U+2013, which is on the allowlist. So does `PO-04, P0-06` with a letter O, which is pure ASCII. Only P0-06 is checked, so P0-04, which has no DONE entry, is never checked. Control: with an ASCII hyphen the same entry fails with "P0-04 has no DONE entry to verify". A character allowlist cannot close this. One fix is to refuse a VERIFIED Task line that holds any token other than an exact task id.
Defect L3 (corrects L-0046; rule 5, fails open). A UTF-16LE text file is not scanned. `apps/web/status.txt` with a BOM, a JWT-shaped value and an `sb_secret_` value passes (exit 0). The same file in UTF-8 fails on both patterns. With `git diff --text` every other byte is NUL, so no pattern matches. Windows PowerShell 5 writes UTF-16LE by default with `>`, and this repo is worked on in Windows shells.
Code defect behind false positive F3 (L-0046). On line 68 of `scripts/activity-log-check.mjs` a `//` comment swallows the reference regex for `env(`, `process.env`, `import.meta` and `secrets.`, so it never runs. The comment on line 64 still lists those as references (H-25). In practice a dotted path still counts as a reference, but reading `process.env["KIRAN_TOKEN"]` into a variable named `token` is refused.
False positives that block honest work, each exit 1 with "assigns a secret-looking value", each in `apps/web/lib`: (F1) `data?.session?.access_token` read into a variable named `token`; (F2) `formData.get("password")` read into a variable named `password`; (F3) above. The exact lines are in the test file. Each is the normal way to read a token or a form field in a Next.js app, so they will be hit in P1-02. (F4) A 23-character quoted test password assigned to a variable named `password` in `apps/web/e2e/` also fails. That matches Appendix C, which skips only `supabase/tests/`, but browser tests will need a decision. F5 held: a list-item fence that is closed properly passes.
Observations for MJ, not counted as defects:
- (O1) The replaced client is never disposed. With a visible tab and a short-lived token, the login page's client still had its auto-refresh timer after the rotation. It kept sending `/auth/v1/token?grant_type=refresh_token` with the revoked id in `x-kiran-device`: 16 requests in 1.2 s, with the 30 s tick cut to 150 ms in the probe. In real time that is at most about one request per token lifetime (an hour) per old client. auth-js also printed "Multiple GoTrueClient instances detected". GoTrue does not read the header and the database never sees these calls, so no control is affected. Calling `stopAutoRefresh()` on the old client would end it.
- (O2) Signature look-alikes. A VERIFIED entry signed exactly like the builder, with a Cyrillic е in "session", passes rule 4 (exit 0). Any different ASCII signature passes too, so this is inherent to a text check; Appendix C calls it a tripwire.
- (O3) Owner terms. With `KIRAN_SENSITIVE_TERMS=Zetavend`, a fake term, an added line holding the term passes when a U+200B splits it (exit 0); the plain term fails. A term that appears only in a file name, `docs/Zetavend-notes.md`, also passes, because paths are never scanned. The check is silently off whenever the secret is empty, which today means until B-15a is done; by GitHub's rules fork pull requests get no secrets either (not tested).
- (O4) `apps/web/.ENV.local` (upper case, force-added) passes, while `.env.local` fails. By reading the code, its lines are still scanned for secrets (not tested).
- (O5) Appendix C and the script agree rule by rule. The Task-line allowlist and the `.env*` rule match exactly. Small gaps: Appendix C does not say that §16 ends only at `## Appendix`. Rule 5's "tests" means only `supabase/tests/`. "Branch protection requires this job" describes the target state while B-13 is open.
**Evidence:** All runs were local, with `DATABASE_URL` and `KIRAN_TEST_DATABASE_URL` unset, on embedded Postgres. No remote database, Supabase project, GitHub or MCP Supabase tool was touched, and I did not run `scripts/staging-smoke.mjs`.
1. Suite: baseline `pnpm db:test` at d1bc185 gave "Test Files 7 passed (7) / Tests 402 passed (402)". With my file, two full runs, identical: "Test Files 1 failed | 7 passed (8) / Tests 2 failed | 407 passed (409)", before I added the log-check block. The two failures are C1. Final full run with the whole file: see item 6. `pnpm typecheck` exit 0.
2. Client controls that held (`reverify4`, passing tests). With one effect run, every request after the rotation carried the new id: `register_device` (header equal to `p_fingerprint`), `my_session`, then `auth.getUser()`, a second `my_session`, and the login page's `signInWithOtp` on the rebuilt client. There was exactly one registration, and the final state was ready and pending. A reload, simulated with fresh `browser.ts` and `page.tsx` module instances over the same localStorage and cookies, sent only the new id and did not register again. In strict mode no request after the first rotation carried the old id. Only `lib/supabase/browser.ts`, `lib/supabase/server.ts` and `proxy.ts` import Supabase. Only `browser.ts` calls `createBrowserClient`. The server clients send no device header, so they can only be refused by the gate, never let through. No page keeps a module-level client. No realtime or storage use exists in `apps/web`. The page cannot loop: the effect has an empty dependency list and every branch ends in one `setState`.
3. Log check, throwaway clone of d1bc185 under the scratchpad, one commit per case, `node scripts/activity-log-check.mjs d1bc185 HEAD`, `KIRAN_SENSITIVE_TERMS` empty unless stated. Controls that failed as they should, each exit 1:
   - S1, an edited L-0054 line ("not append-only at existing line 750");
   - S2, a `## 16.1` heading in new text;
   - S3, a builder-signed VERIFIED with an ASCII signature ("VERIFIED by the same agent as DONE L-0011");
   - S4, a JWT in `apps/web/lib`;
   - S5, U+02D7 in a task id;
   - S6, an `<h3>` header;
   - S7, `apps/web/.env.local`;
   - S8, an ASCII P0-04 with no DONE entry;
   - S9, a UTF-8 file with a JWT and an `sb_secret_` value;
   - S10, the plain term with `KIRAN_SENSITIVE_TERMS=Zetavend`;
   - S11, a code change with no entry.

   OK1, a legitimate change with an entry, passed (exit 0). Evasions E-A (L1), E-B and E-C (L2), E-D (O2), E-E (L3), E-F and E-G (O3) and E-H (O4) each exited 0. F1 to F4 each exited 1. Driver totals: "14 as expected, 11 wrong" before I fixed the E-A case, which needed a second list item to close the fence; on rerun E-A exited 0.
4. The `reverify4` log-check block repeats L1, L2, L3 and F1 to F3 in its own temporary clone. It commits the worktree script and log as the base, so a fix is seen before it is committed. Each defect test fails, and each control inside it passes.
5. Diff: my only change is the new test file and this entry. Neither contains secrets: the JWT-shaped strings are fake, unsigned and assembled in the test; the term "Zetavend" is invented; phones are the `+920000000001` fixture style.
6. Final, with the whole file and this entry in place: `pnpm db:test` gave "Test Files 1 failed | 7 passed (8) / Tests 6 failed | 408 passed (414)". The six failures are C1 (two tests), L1, L2, L3 and the false-positive test; all 402 earlier tests pass. `pnpm typecheck` exit 0. `node scripts/activity-log-check.mjs d1bc185` gave "activity-log-check OK (1 new log entry, 2 changed files)".
**Rules touched:** H-16, H-20, H-23, H-24, H-25; SEC-03; §7; Appendix C
**Next / needs:**
- Builder, C1: make the effect idempotent across runs and tabs. For example, rotate only when the stored id still equals the revoked one, or take a Web Lock around rotate-and-register, then stop the old client (O1). Both DEFECT CHECK client tests should then pass.
- Builder, L1: scan fences the CommonMark way, or refuse fences that are not at column 0 in new log text.
- Builder, L2: refuse a VERIFIED Task line that holds anything other than exact task ids.
- Builder, L3: refuse added text files that hold NUL bytes or a UTF-16 BOM, or decode them before scanning.
- Builder: fix line 68 and decide F1, F2 and F4.
- Then a different agent re-verifies P1-01 and P0-09.
- MJ: O3 (B-15a) and O1.

### L-0056 · 2026-10-26 00:30 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P1-01, P0-09    **Claim:** C-001
**What / why:** Accepting L-0055. I committed the re-verifier-4 entry and `supabase/tests/reverify4-attacks.test.ts` unedited (commit 5f5ba86). P1-01 and P0-09 go back to IN PROGRESS. Nothing in L-0055 gets past a database control; the defects are in the rep app's registration flow (C1) and in the log check (L1, L2, L3, the disabled env-reference rule, and false positives F1 to F4).
**Evidence:** Before any change, `pnpm db:test` gave "Tests 6 failed | 408 passed (414)", and the six failures were all re-verifier-4's tests.
**Rules touched:** §7, H-23
**Next / needs:** L-0057 to L-0060.

### L-0057 · 2026-10-26 00:35 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DEVIATION
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Appendix C updated to match the script (H-25):
- rule 2: only unindented fences count as code, and new log text may not contain indented fences;
- rule 3: signatures must be plain ASCII apart from the `·` separators;
- rule 4: dashes in task ids are normalised, and look-alike task-id text on a VERIFIED Task line is refused;
- rule 5: in source code only quoted literals count; the test-code exemption is widened to `tests/`, `e2e/`, `__tests__/`, `*.test.*` and `*.spec.*`; owner terms are matched ignoring case and invisible characters, and in file paths; UTF-16 files are decoded and scanned; `.env*` names are matched in any case.

Nothing is loosened except the false positives that blocked honest code.
**Rules touched:** H-25, H-26
**Next / needs:** —

### L-0058 · 2026-10-26 00:40 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P1-01 (SEC-03; rep app registration)    **Claim:** C-001
**What / why:** Fixes L-0055 C1 in `apps/web/lib/supabase/browser.ts` and `apps/web/app/app/page.tsx`:
- The new `ensureDeviceRegistered(status, idUsedForStatus)` registers exactly once, with one in-flight promise per page (React strict mode runs the effect twice).
- Rotation is compare-and-swap, `rotateDeviceId(revokedId)`: a second effect run or a second tab adopts the already-rotated id instead of minting another.
- A short-lived claim in localStorage (`kiran.device.registering`, 30 s) stops a second tab registering the same id; a failed registration clears it.
- `rotateDeviceId()` with no argument still rotates unconditionally, the API the reverify3 test uses.
- The page takes `supabaseBrowser()` fresh for every request instead of holding a client.
- The replaced client's token auto-refresh is stopped (`auth.stopAutoRefresh()`), so it cannot keep sending the revoked id (L-0055 observation).

No database change.
**Evidence:** `pnpm vitest run … reverify4` gave "Tests 12 passed (12)", including both C1 DEFECT CHECKs ("React strict mode …" and "two tabs …"). The reverify3 client DEFECT CHECK still passes. `pnpm db:test` gave "Test Files 8 passed (8), Tests 414 passed (414)"; `pnpm typecheck` exit 0; `pnpm -C apps/web build` exit 0 ("Compiled successfully").
**Rules touched:** H-23
**Next / needs:** Re-verification (§7).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0059 · 2026-10-26 00:45 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Fixes L-0055 L1, L2, L3, the env-reference bug and F1 to F4 in `scripts/activity-log-check.mjs`.
- **The bug:** a `//` comment had swallowed the rule that treats `env(`, `process.env`, `import.meta` and `secrets.` as references.
- **F1 to F3:** in source code, bare values are now expressions and only quoted literals are measured. Optional chaining, calls and indexing count as references.
- **F4:** the test-code exemption now covers browser tests.
- **New false positive:** for key-type names, a value made only of lowercase words (a storage key name) is not a secret.
- **L1:** only unindented fences count as code, and indented fences are refused in new log text.
- **L2:** dashes are normalised when reading task ids, so `P0–04` is read as P0-04 and checked; text shaped like a task id that is not one (`PO-04`) is refused on VERIFIED lines.
- **L3:** UTF-16 files, detected by BOM or NUL pattern, are decoded and scanned in full.
- **L-0055 observations:** signatures must be plain ASCII (closes the Cyrillic "е" impersonation); owner terms are matched after removing zero-width characters, and in file paths; `.ENV.local` is caught.
**Evidence:** `pnpm vitest run … reverify4` gave 12/12, including the L1, L2 and L3 DEFECT CHECKs and the FALSE POSITIVE CHECK.
- Replay of earlier rounds in throwaway clones (deleted): `evasions3.sh` 19 of 20 as expected. The one miss is again the known Git Bash `\u` artifact, where no look-alike character is actually written. `evasions3b.sh`, which writes the characters with Python, gave 6 of 6.
- `node scripts/activity-log-check.mjs main` → OK.
- `pnpm db:test` 414/414.
**Rules touched:** H-01, H-20, H-23, H-25
**Next / needs:** Re-verification (§7).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0060 · 2026-10-26 00:50 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · HANDOFF
**Task:** P1-01, P0-09 (DONE, self-reported); P0-04, P0-05 (IN PROGRESS)    **Claim:** C-001
**What / why:** **State.**
- P1-01 and P0-09 are redone after L-0055 (L-0058, L-0059) and await re-verification by a different agent (§7). P0-06 and P0-08 are VERIFIED.
- Staging is unchanged: migrations 0001 to 0006. B-18 (expose `app`/`vault_api`) is still open, so the end-to-end login is untested.
- No P1-02 work.

**Next steps:**
1. MJ: `docs/gate-0-checklist.md` items 1 to 6.
2. Re-verification round 5 of P1-01 and P0-09, if MJ wants it.
3. Gate 0 sign-off, then P1-02.

**Gotchas:** as in L-0054. In addition: `rotateDeviceId(revokedId)` is compare-and-swap, while `rotateDeviceId()` with no argument rotates unconditionally; and the page must always call `supabaseBrowser()` per request.

**Open blockers:** B-01 to B-11, B-13, B-14, B-15a, B-16b, B-17, B-18, B-19 (MJ).
**Evidence:** `pnpm db:test` 414/414; `pnpm typecheck` exit 0; web build exit 0; activity check OK. Commits: 5f5ba86 (verifier files), and the commit carrying these entries. CI result for that commit pending at the time of writing.
**Rules touched:** §11, H-24
**Next / needs:** MJ.

### L-0061 · 2026-10-26 02:00 PKT · Claude · Opus 5.5 · re-verifier-5 subagent · branch feat/p0-foundation (K repo) · CORRECTION
**Task:** P1-01, P0-09    **Claim:** —
**What / why:** Independent §7 re-verification, round 5, of L-0058 (P1-01, rep app registration) and L-0059 (P0-09, log check), under MJ's ruling in L-0029. I am a fresh subagent and wrote none of the earlier entries. Result: **P1-01 is VERIFIED** by this entry: the database and the client held every attempt (observations O1 to O3 below are not defects). **P0-09 is not VERIFIED** (corrects L-0059): the log check has two new ways to forge a rendered entry, five other gaps against Appendix C, and six false positives that block ordinary P1-02 and P1-09 work. I added one file, `supabase/tests/reverify5-attacks.test.ts`, not committed. Its eight failing tests are the P0-09 defects and false positives, left in place on purpose (H-23). I edited no other file and did not touch the status board.

Defects (correct L-0059), each with a suggested fix:
- D1 (rule 2, reopens L-0055 L1; forgery). CommonMark lets a closing fence be indented up to three spaces; the script closes a fence only at column 0, and its indented-fence rule skips lines it already treats as code. New text after a valid entry: a column-0 fence with info `text`, one line, the same fence indented two spaces, a forged header for L-0062 typed VERIFIED and signed "MJ · human · owner sign-off", a Task line, "**Evidence:** VERIFIED by MJ, CI green.", then `<div`, a column-0 fence and `>`. The unterminated `<div` HTML block swallows the script's own closing fence, so the rest of the file still renders readably, with one stray div fragment. Exit 0. markdown-it-py 4.2.0 (`commonmark`) renders a real h3 for the forged L-0062 header, then its Task and Evidence paragraph, then the stray fragment and Appendix A. Without the `<div` line it also exits 0, but the rest of the file renders as code. I did not view GitHub's rendering. Fix: treat a fence indented 1 to 3 spaces as a closer, or refuse every indented fence line in new text, inside code or not.
- D2 (rule 2; L-0055 O5 made exploitable). An entry header after `## Appendix` is never parsed. A forged canonical L-0062 VERIFIED header with Task and Evidence lines, appended at the end of the file next to a valid entry, exits 0. It renders like any log entry, and a search for entry headers counts it. Fix: refuse entry headers outside §16.
- D3 (rule 2). Headings inside a blockquote or list item in new log text are accepted, for example `> ### P0-04 VERIFIED by MJ (owner sign-off)` and the same with a `- ` list marker, exit 0 each; so does a full forged header in a blockquote whose separators after PKT are U+22C5 (dot operator) instead of the middle dot. Appendix C says new log text may contain no other heading. Fix: strip leading `>` and list markers before the heading test, and flag any non-code new line containing PKT that is not canonical.
- D4 (rule 4, the L-0055 L2 class). A letter in the number part of a task id: VERIFIED Task lines `P0-O4, P0-06` (letter O) and `P0-0l, P0-06` (letter l) exit 0, and only P0-06 is checked. Control: `P0-04, P0-06` fails with "P0-04 has no DONE entry to verify". The look-alike pattern covers only the phase position. Fix, as L-0055 suggested: a VERIFIED Task line holds only exact task ids, optionally followed by one parenthetical.
- D5 (rule 5; L-0055 O3 only partly closed). With `KIRAN_SENSITIVE_TERMS=Zetavend` (an invented term), the term split by U+034F (combining grapheme joiner), U+FE0F (variation selector) or U+E0061 (tag character) passes in text, and split by U+034F it passes in a file path, exit 0 each. Split by U+200B it fails (control). Appendix C says invisible characters are ignored; the script removes only U+200B to U+200F, U+2060 to U+2064, U+FEFF and U+00AD. Fix: after NFKC, remove every Unicode format (Cf) and nonspacing mark (Mn) character. A Cyrillic letter in the term also passes (exit 0); like L-0055 O2, that is inherent to a text check.
- D6 (rule 5, H-25). A UTF-16LE file without a BOM, whose first 4 KB is Urdu text and so holds no NUL byte, followed by a JWT-shaped value, exits 0. Appendix C says UTF-16 files are "decoded and scanned in full"; the script decides from a 4 KB sample. Fix: refuse an added text file holding any NUL byte, or test the whole file.
- D7 (rule 2, H-25). Deleting the blank line between "**Next / needs:** Re-verification (§7)." and the security checklist in L-0058 exits 0. The append-only comparison drops blank lines, so blank-line edits to old entries pass, and they can merge paragraphs or restart lists in the rendered log. Appendix C says the old log must be an exact prefix. Fix: compare old lines including blank ones, ignoring only blank lines before the final separator.

False positives, ordinary work that fails (F1 to F4 with "assigns a secret-looking value"):
- F1: a `password` key holding the label Enter your password, in `packages/shared/i18n/en.ts`, where the en/ur strings belong.
- F2: the same kind of label, Password (12+ characters), under a `password` key in `packages/shared/i18n/en.json`.
- F3: a constant `OUTBOX_KEY` holding the storage key name kiran.outbox.v1, in `apps/web/lib/`. The L-0059 storage-key exception fails as soon as a version number appears, and P1-09's outbox needs such keys.
- F4: a constant `authToken` set to a template literal that puts Bearer in front of `${session.access_token}`, in `apps/web/lib/`.
- F5 (rule 4): a VERIFIED Task line `P0-06 (re-run on PR 12)` fails with "text shaped like a task id that is not one (PR 12)".
- F6 (rule 5, prose in docs): the check refused two drafts of this entry. The first run named pass, password, OUTBOX_KEY and authToken: my first wordings of F1 to F4 and O5 quoted the code, and one line of D3 was an English sentence ending in the word pass, followed by a colon and an inline-code example. The second run named only pass, for that D3 sentence. In `docs/`, bare and backticked values count, so log prose cannot quote these cases.

Suggested: a quoted value containing a space is not a secret; allow digits after a separator in the lowercase-words exception; treat a template containing `${` as a reference. The D4 fix also closes F5.

Observations, not defects:
- O1 (P1-01). `rotateDeviceId(revokedId)` is a compare-and-swap on localStorage, and the HTML standard gives localStorage no locking across tabs. Two tabs that read the revoked id at the same moment could both rotate and register: the L-0055 C1 symptom, still refused by the database. My probes run in one realm over one synchronous map, so they cannot show this, and I did not test it in a browser. A Web Lock (`navigator.locks`) around rotate-and-register would make it hold by construction.
- O2 (P1-01). Page closed while `register_device` is in flight, then reopened within 30 s: the claim short-circuits, nothing is registered, and the page shows ready with `device_status` null, which it words as "waiting for your manager's approval" while the office has nothing to approve. Reopened after 30 s it registers. Probe: 0 registrations within 30 s, 1 after. By reading, not tested: the claim is not keyed by user, so a second rep signing in on the same browser within 30 s gets the same result. It heals on the next open.
- O3 (P1-01). If `window.localStorage` throws SecurityError (site data blocked), `deviceId()` throws before any request: the effect rejects unhandled, no state is set, and the page stays on "Loading…" with no message. By reading, the login handlers call `supabaseBrowser()` first and would stay busy the same way. It fails closed, and it predates L-0058: the page called `supabaseBrowser()` first before too.
- O4 (P0-09). A UTF-32 file with a BOM holding a JWT-shaped value exits 0; PowerShell can write UTF-32, but this is contrived. HTML blocks that start on one line and end on a later one, `<?` closed by `?>` and `<div` with no `>`, pass and hide their lines in the rendered view, exit 0 each. `<div` is the absorber D1 uses.
- O5 (P0-09). Spec-allowed, for MJ: with any valid new entry, the §12 board row for P1-01 can be changed to "VERIFIED (L-0058)" and the text of H-16 can be reworded, exit 0 each. Appendix C rule 1 allows edits outside §16 alongside an entry, so only review catches them. A source-code comment giving a 16-character password as a bare (unquoted) value exits 0, as rule 5 now documents.

**Evidence:** All runs were local, with `DATABASE_URL` and `KIRAN_TEST_DATABASE_URL` unset, on embedded Postgres. No remote database, Supabase project, GitHub or MCP Supabase tool was touched, and I did not run `scripts/staging-smoke.mjs`.
1. Baseline at a0409ff, clean tree: `pnpm db:test` gave "Test Files 8 passed (8) / Tests 414 passed (414)".
2. Client, P1-01: `reverify5` runs the real `browser.ts` and `page.tsx` against the installed `@supabase/ssr` and auth-js 2.118.0, with a database-like fetch stub. Every DEFECT CHECK here passes:
   - Fresh install in strict mode: the login page mints one id; one `register_device` follows, with header equal to `p_fingerprint`; states ready:pending twice. After the office approves, a strict-mode reload and a second tab give ready:approved three times, with no further `register_device` and the id never rotated.
   - An approved device, in strict mode plus a second tab: no rotation and no `register_device`, and every request carries the approved id.
   - A failed registration (503) shows "Could not register this phone." and clears the claim. The next open registers the same new id, giving pending, and the revoked id is never sent again.
   - After the rotation, with a visible tab, a 60 s token and a 150 ms tick: the replaced client sent 0 requests with the revoked id and its ticker is off. The current client sent 18 refreshes with the new id, and `signInWithOtp` on it succeeded with the new header.
   - The `reverify4` client tests (single run, reload, strict mode, two tabs) still pass.
   - By reading: there is no unbounded loop. The in-flight promise is shared and cleared in `finally`, and the effect has an empty dependency list. Rotation happens only after `my_session` reported revoked for the id actually sent, since the header and `idUsed` are read in the same tick. `register_device` leaves a known id unchanged (migration 0006), so the client cannot rotate or downgrade an approved device. `stopAutoRefresh()` touches only the replaced instance.
3. Database, P1-01: unchanged since L-0055 (migrations 0001 to 0006). The §7 sweeps in `reverify2` and `reverify3` pass in the final run: vault access with a rep token and an un-granted manager token; UPDATE, DELETE and TRUNCATE on append-only tables for every persona; a rep list-dump; self-approval and rep decisions; replay and server time.
4. Log check: a throwaway clone of a0409ff under the scratchpad, one commit per case, `node scripts/activity-log-check.mjs a0409ff HEAD`, terms empty unless stated, 41 cases.
   - Controls that held, exit 1 each: a code change with no entry; the L-0055 L1 replay ("may not contain indented code fences"); the L2 replays with an en dash ("P0-04 has no DONE entry") and `PO-04` ("shaped like a task id"); the L3 replay (UTF-16LE with a BOM); a builder-signed VERIFIED for P1-01 ("same agent as DONE L-0011"); an edited L-0060 line ("not append-only"); the plain owner term; the term split by U+200B.
   - Legitimate work that passed, exit 0 each: a code change with an entry; a VERIFIED `P1-01, P0-09` by another signer; a VERIFIED `P1-01 (SEC-03; PIP-01; doc 06 §2)`; an entry with a column-0 fenced output block and a backticked example header; nested lists.
   - D1 to D7, O4, O5 and F1 to F5 behaved as described above. Four of my cases (the plain-term control and three term-splitting cases) first failed for a reason of my own: a text line directly above the closing separator makes a setext heading, which the script rightly refuses. I fixed them and reran.
5. The `reverify5` log-check block repeats D1 to D7 and F1 to F5 in its own temporary clones, with the worktree script and log as the base. Each DEFECT CHECK and the FALSE POSITIVE CHECK fails, and every control inside them passes.
6. Appendix C and the script agree rule by rule except D6 ("in full"), D7 ("exact prefix") and D3 ("any other heading") (H-25).
7. Diff: my only changes are the new test file and this entry. The JWT-shaped strings are fake, unsigned and assembled at run time; "Zetavend" is invented; phones follow the fixture style.
8. Final, with the whole file and this entry in place: `pnpm db:test` gave "Test Files 1 failed | 8 passed (9) / Tests 8 failed | 423 passed (431)". The eight failures are the reverify5 log-check DEFECT CHECKs (D1 to D7) and the FALSE POSITIVE CHECK; all 414 earlier tests and the other nine reverify5 tests (client probes, log-check controls, observations) pass. `pnpm typecheck` exit 0. `node scripts/activity-log-check.mjs a0409ff` gave "activity-log-check OK (1 new log entry, 2 changed files)".
**Rules touched:** H-16, H-20, H-23, H-24, H-25; SEC-03; §7; Appendix C
**Next / needs:**
- Builder, P0-09: fix D1 to D7 and F1 to F6 in `scripts/activity-log-check.mjs` and Appendix C. Then a different agent re-verifies P0-09 only.
- MJ: if you accept this entry, set P1-01 to VERIFIED on the board; I did not edit it. Decide O1 (a Web Lock), O2 and O3 (rep app robustness) and O5 (rule edits are left to review).

Security checklist (tick honestly), for P1-01:
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change since L-0055; RLS matrix passes
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25) — for P1-01; P0-09 does not (D3, D6, D7)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0062 · 2026-10-26 03:00 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P1-01, P0-09    **Claim:** C-001
**What / why:** Accepting L-0061. I committed the re-verifier-5 entry and `supabase/tests/reverify5-attacks.test.ts` unedited (commit 81e613d).
- **P1-01:** L-0061 verifies it explicitly, with the ticked security checklist. It confirms the working rep flow end to end (first login, one registration, pending, approved, never rotated) and the L-0058 fixes, in strict mode, with a second tab, after a failed registration and across a token refresh. The board is set to VERIFIED (L-0061), the same way P0-06 and P0-08 were set from L-0030. L-0061 was written by a fresh subagent, which counts as a different agent under L-0029.
- **P0-09:** goes back to IN PROGRESS for D1 to D7 and false positives F1 to F6.
- **Client observations O1 to O3:** these are not defects. They go to MJ (L-0065). I am not changing client code now, which would void the fresh P1-01 verification.
**Evidence:** Before any change, `pnpm db:test` gave "Tests 8 failed | 423 passed (431)", and all eight failures were re-verifier-5's log-check tests.
**Rules touched:** §7, H-23
**Next / needs:** L-0063 to L-0065.

### L-0063 · 2026-10-26 03:05 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DEVIATION
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Appendix C updated to match the script (H-25).
- **Rule 2:**
  - only unindented fences open a code block, while a closing fence may be indented up to 3 spaces, as in CommonMark;
  - new text may not contain any indented fence marker, even inside code;
  - an entry header outside §16 is refused;
  - the prefix comparison includes blank lines;
  - blockquotes and headings inside list items are refused in new text.
- **Rule 4:** the look-alike task-id examples are extended.
- **Rule 5:** template literals and lowercase name-like values are not secrets; i18n/locale files and Markdown skip the password-name heuristic; owner terms ignore every default-ignorable character; every file is decoded as UTF-16 in both byte orders and scanned in full, and files over 64 MB fail.

Nothing is loosened except false positives on honest work.
**Rules touched:** H-25, H-26
**Next / needs:** —

### L-0064 · 2026-10-26 03:10 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Fixes L-0061 D1 to D7 and F1 to F6 in `scripts/activity-log-check.mjs`.
- **D1:** CommonMark-style closing of fences indented up to 3 spaces, and the indented-fence rule now also applies to code lines.
- **D2:** entry headers outside §16 are refused.
- **D3:** blockquotes and list-item headings are refused in new text, and any dot-like separator after "PKT" counts.
- **D4:** look-alike task ids `P\w-\w\w` and `P0 04` are refused, while "PR 12" is allowed.
- **D5:** owner terms are matched after `\p{Default_Ignorable_Code_Point}` is removed.
- **D6:** full UTF-16 decoding in both byte orders, BOM or not.
- **D7:** an exact prefix, including blank lines.
- **F1/F2:** i18n/locale files and Markdown skip the password-name heuristic.
- **F3:** the name-like value rule allows versioned keys.
- **F4:** a quoted template containing `${` is a reference.
- **F5:** the look-alike rule needs a dash.
- **F6:** Markdown prose skips the heuristic.
**Evidence:**
- `pnpm vitest run … reverify5 reverify4` gave "Tests 29 passed (29)", including every L-0061 DEFECT CHECK and the FALSE POSITIVE CHECK.
- Replays in throwaway clones (deleted): `evasions3.sh` gave 19 of 20 as expected; the one miss is the known Git Bash `\u` artifact, where no look-alike character is written. `evasions3b.sh` gave 6 of 6.
- `pnpm db:test` gave "Test Files 9 passed (9), Tests 431 passed (431)"; `pnpm typecheck` exit 0; `node scripts/activity-log-check.mjs main` → OK.
**Rules touched:** H-01, H-20, H-23, H-25
**Next / needs:** Re-verification of P0-09 (§7).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0065 · 2026-10-26 03:15 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · BLOCKER
**Task:** P1-01    **Claim:** C-001
**What / why:** L-0061 raised three client observations. P1-01 stays VERIFIED; these are improvements, and MJ should choose whether they are worth reopening P1-01 for (B-20).
- **O1:** the compare-and-swap rotation in localStorage is not atomic across tabs under the HTML standard. This is argued from the spec, not reproduced. A Web Lock (`navigator.locks`) around rotate-and-register would close it.
- **O2:** if the app is closed during registration and reopened within 30 s, nothing registers until the next open, because the claim is still live. The claim is not keyed by user.
- **O3:** with storage blocked (SecurityError), the page stays on "Loading…" with no message. It fails closed, and the problem predates L-0058.
**Evidence:** L-0061's probes (`reverify5-attacks.test.ts`).
**Rules touched:** H-22
**Next / needs:** MJ: fix O1 to O3 now (which reopens P1-01 for another verification), or defer them to P1-09 (offline-first PWA), where the client will be reworked anyway?

### L-0066 · 2026-10-26 05:00 PKT · Claude · Opus 5.5 · re-verifier-6 subagent · branch feat/p0-foundation (K repo) · CORRECTION
**Task:** P0-09    **Claim:** —
**What / why:** Independent §7 re-verification, round 6, of the log check after the L-0064 fix (D1–D7, F1–F6) and the L-0063 Appendix C update, under MJ's L-0029 ruling. I am a fresh subagent and wrote none of the earlier entries; P1-01 is already VERIFIED (L-0061) and I did not re-check it. Result: **P0-09 is not VERIFIED** (corrects L-0064). The L-0064 D1/D2/D4/D7 replays and the maker≠checker, append-only, numbering and hard-pattern controls all held under every probe I ran; but one rule-2 forgery gap survives the D3 fix, three false positives block ordinary P1-07/P1-09 work, and the recorded baseline is red. I added one file, `supabase/tests/reverify6-attacks.test.ts`, not committed; its four failing checks are these defects and false positives, left failing on purpose (H-23). I edited no existing file and did not touch the board.

Defect (corrects L-0064; with a fix):
- A1 (rule 2, H-25; the L-0061 D3 / L-0064 fix is incomplete). L-0064 refuses a top-level blockquote heading and a top-level list-item heading in new log text, but a heading nested one container deeper is neither refused nor caught: a list item holding a blockquote holding `### …`, a list item holding a list item holding `### …`, and an ordered list holding a blockquote holding `### …` all exit 0. CommonMark (markdown-it-py 4.2.0, `commonmark` preset) renders each as a real h3 inside the §16 log — I confirmed the HTML nests down to `<h3>…</h3>` in all three. A near-header using `|` instead of the middot also dodges the `PKT` separator check. Appendix C already says new log text may contain no "blockquote, or a heading inside a list item"; the script tests only the outermost marker. Fix: strip every leading blockquote and list marker before the heading and blockquote tests, or reject any line whose text, after those markers are stripped, begins with `#`.

False positives (ordinary honest work refused; F-B is the L-0061 F3 fix incomplete):
- F-B (rule 5, H-25; headline). The F3 name-like storage-key exemption disappears whenever the key name itself contains token/pass/pwd/secret, because `looksSecret` takes the password branch (length only) and never calls `isNameLike`. `const TOKEN_KEY = "kiran.auth.token.v1"` and `const SESSION_TOKEN_KEY = "kiran.session.v1"` are refused, while the identical value under a benign name (`AUTH_STATE_KEY`) passes. These are exactly the P1-09 encrypted-cache and outbox storage-slot names, and the value is the F3-allowed form. Appendix C names no name-based carve-out. Fix: apply the `!isNameLike(v)` guard in the password branch too.
- F-C (rule 5). `isNameLike` accepts only `. _ / -` separators and at most two trailing digits per segment, so two standard storage-key conventions are refused as secrets: the Redis `kiran:outbox:v1` form, and a fiscal-year or date segment such as `kiran.invoice.fy2026` or `kiran.invoice.2026` (H-11 numbers per financial year). Fix: allow `:` as a separator and a 3–4 digit or `fyNNNN` segment in `isNameLike`.
- F-D (rule 5, secondary). A constant whose name contains "token" holding a non-secret string — a CSS value or UI design token (`const colorToken = "oklch(0.7 0.1 240)"`, `const spacingToken = "0.25rem 0.5rem 1rem"`), a pagination cursor — is refused purely because the name matches "token" and the value is 12+ chars, with no value-shape check. Fix: treat a value that is plainly a CSS/number/function expression (parentheses, units, spaces) as a reference, or narrow the "token" name match.

Baseline is red (H-23/H-24):
- At the clean HEAD 7744422 the committed `reverify5-attacks.test.ts` OBSERVATION test fails: one of its `check()` cases edits the P1-01 board row using that row's old `DONE (self-reported; redone …)` cell as the anchor, but L-0062 had already changed that cell to `VERIFIED (L-0061)`, so the anchor is absent and `check()` throws `edit anchor missing`. `pnpm vitest run … reverify5` alone gives "1 failed | 16 passed (17)" on a clean tree, so L-0064's evidence line "431 passed (431)" is not reproducible at that commit. This is a stale test anchor, not an activity-log-check defect; I did not edit that file (hard limit), and I deliberately kept its exact anchor string out of this entry so that appending L-0066 does not itself supply the missing anchor and mask the failure.

Observations, not defects:
- O1 (rule 2). A non-canonical heading with no `PKT` middot appended to an appendix, for example an inline `### P0-09 VERIFIED by MJ`, exits 0 and renders as an h3. This is the L-0061 O5 class: rule 2 promises to catch only canonical headers outside §16, and edits outside §16 are left to review. Not a new defect.
- O2 (rule 5). The UTF-16 password-name heuristic is gated by a 4 KB NUL sample (the narrowed L-0061 D6), so a no-BOM UTF-16LE file whose first 4 KB is non-ASCII escapes it; a plain password assignment later in such a file is not flagged. The hard JWT/key patterns still run on the full decode, and a JWT-shaped value in the same file is caught. Minor; for MJ.
- A plaintext secret written as a bare (unquoted) value in a code-file comment, and a VERIFIED signed by a self-asserted "different agent", both pass; both are documented or inherent (Appendix C "in source code only quoted literals count"; a text check cannot authenticate a signer).

**Evidence:** All runs local, `DATABASE_URL` and `KIRAN_TEST_DATABASE_URL` unset in the child env, on embedded Postgres; no remote database, Supabase project, GitHub or MCP tool touched, and `scripts/staging-smoke.mjs` not run.
1. Throwaway clone of 7744422 under the scratchpad, one commit per case, `node scripts/activity-log-check.mjs 7744422 HEAD`, terms empty unless stated; deleted afterwards. Controls held, exit 1 each: the D1 indented-fence forgery, the D4 look-alike task id, the D7 deleted-blank-line edit, and the owner term split by U+200B and by U+034F. Legitimate work passed, exit 0: a code change with an entry; `OUTBOX_KEY = "kiran.outbox.v1"` (dotted, the L-0061 F3 form).
2. A1: the three nested-heading cases each exit 0; markdown-it-py 4.2.0 renders each as an h3 nested in list/blockquote, confirmed by reading the emitted HTML.
3. F-B: `TOKEN_KEY` and `SESSION_TOKEN_KEY` with a name-like value exit 1 ("assigns a secret-looking value"); the same value as `AUTH_STATE_KEY` exits 0. F-C: `kiran:outbox:v1`, `kiran.invoice.fy2026`, `kiran.invoice.2026` exit 1 each. F-D: `colorToken`, `spacingToken` exit 1 each.
4. `supabase/tests/reverify6-attacks.test.ts` repeats A1 and F-B/F-C/F-D in its own temporary clones: the DEFECT CHECK and three FALSE POSITIVE CHECKs fail (the defects and false positives), the controls and the observation pass. Run alone: "4 failed | 2 passed (6)".
5. Full suite with this file and entry in place: `pnpm db:test` gave "Test Files 2 failed | 8 passed (10) / Tests 5 failed | 432 passed (437)". The five failures are my four reverify6 checks plus the pre-existing reverify5 OBSERVATION anchor failure above; all other tests pass. `tsc -p supabase/tests/tsconfig.json --noEmit` (the tests half of `pnpm typecheck`) exits 0 with the new test file; the `pnpm -r` app typecheck was not re-run as no app code changed. `node scripts/activity-log-check.mjs 7744422` on this entry returned OK.
6. Appendix C vs the script: A1 (nested headings) and F-B (no name carve-out) are H-25 disagreements; the other items match the text.
7. Diff: my only changes are the new test file and this entry; the example strings are fake and assembled so this file passes the check.
**Rules touched:** H-16, H-20, H-23, H-24, H-25; §7; Appendix C
**Next / needs:**
- Builder, P0-09: fix A1 (nested blockquote/list headings), F-B (password-branch `isNameLike` guard), F-C (`:` separator and year segments), F-D (CSS/number values), and update Appendix C where it now disagrees; then a different agent re-verifies P0-09.
- MJ / builder: the committed reverify5 anchor is stale, so the baseline is red; decide whether to refresh that anchor (its file, not mine). O1 and O2 are for MJ.

### L-0067 · 2026-10-26 06:00 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DECISION
**Task:** P0-09 (H-23 test change)    **Claim:** C-001
**What / why:** MJ approved: "Approved: update the edit anchor in the reverify5 OBSERVATION test to the current P1-01 board text, nothing else, after round 6 finishes." The change is made only now that round 6 (L-0066) has finished and its output is committed unedited (commit 90dc288).
**Rules touched:** H-23
**Next / needs:** L-0068.

### L-0068 · 2026-10-26 06:05 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · CORRECTION
**Task:** P0-09 (corrects L-0064 evidence)    **Claim:** C-001
**What / why:** L-0064 reported "431 passed (431)". That was true when I ran it, but I ran it before L-0062 changed the P1-01 board row to VERIFIED (L-0061). The re-verifier-5 OBSERVATION test anchors an edit on that row's old text, so at commit 7744422 it threw "edit anchor missing", and CI run 40224891506 was red (430/431). L-0066 reported the same. Under L-0067 I changed only that test's anchor string (`supabase/tests/reverify5-attacks.test.ts`, one line) to the row's current text. The replacement text and everything else in the test are unchanged. From now on I re-run the suite after every ACTIVITY.md edit, not before.
**Evidence:** `git diff --stat` showed one file, "1 insertion(+), 1 deletion(-)"; the file still has LF endings (0 CR). `pnpm vitest run … reverify5` gave "Tests 17 passed (17)".
**Rules touched:** H-23, H-24
**Next / needs:** L-0069, L-0070.

### L-0069 · 2026-10-26 06:10 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DEVIATION
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Appendix C updated to match the script (H-25).
- **Rule 2:** blockquotes, and headings inside list items, are refused at any nesting depth.
- **Rule 5:** for names that are not password- or secret-like, multi-part lowercase name-like values (with `:` separators, year or `fy2026` segments, or a `v1` version) are not secrets; token-named values containing spaces or parentheses are data. Password- and secret-named values keep the strict rule.
**Rules touched:** H-25, H-26
**Next / needs:** —

### L-0070 · 2026-10-26 06:15 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Fixes L-0066 A1, F-B, F-C and F-D in `scripts/activity-log-check.mjs`.
- **A1:** every container marker (`>`, `-`, `*`, `+`, `1.`, `1)`) is peeled off before the blockquote and heading tests, so `- > ###`, `- - ###` and `1. > ###` are refused; `|` now counts as an entry-shaped separator after "PKT".
- **F-B:** the name-like exemption also covers token and key names (`TOKEN_KEY` set to `kiran.auth.token.v1`, `SESSION_TOKEN_KEY` set to `kiran.session.v1`), but never password or secret names, so `hunter2.hunter2` is still flagged.
- **F-C:** `isNameLike` accepts `:` separators, up to four trailing digits per segment, and 4-digit year segments, and requires at least two segments, so a single word such as `sunshine2024` is not exempt.
- **F-D:** token-named, non-password constants with whitespace or parentheses (design tokens) are not secrets.

L-0066 observations O1 (non-canonical headings outside §16 are review-only) and O2 (the name heuristic on BOM-less UTF-16 is gated by a sample; hard patterns run in full) are left as documented.
**Evidence:**
- `pnpm vitest run … reverify6 reverify5 reverify4` gave "Tests 35 passed (35)", including every L-0066 DEFECT and FALSE POSITIVE CHECK.
- Replays in throwaway clones (deleted): `evasions3.sh` gave 19 of 20 as expected, including E8 (the password with a dot is still caught); the one miss is the known Git Bash `\u` artifact. `evasions3b.sh` gave 6 of 6.
- `node scripts/activity-log-check.mjs main` → OK.
- The full suite was run after these entries were written; the counts are in the commit message.
**Rules touched:** H-01, H-20, H-23, H-25
**Next / needs:** Re-verification of P0-09 (§7).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0071 · 2026-10-26 08:00 PKT · Claude · Opus 5.5 · re-verifier-7 subagent · branch feat/p0-foundation (K repo) · CORRECTION
**Task:** P0-09    **Claim:** —
**What / why:** Independent §7 re-verification, round 7, of the log check after the L-0070 fix (A1, F-B, F-C, F-D) and the L-0069 Appendix C update, under MJ's L-0029 ruling. I am a fresh subagent and wrote none of the earlier entries; P1-01 is VERIFIED (L-0061) and I did not re-check it. Result: **P0-09 is not VERIFIED** (corrects L-0070). Every control I replayed held: a top-level heading, both L-0066 A1 marker-nested headings, a full header-shaped line that keeps the canonical middot separators (refused even when indented), and the name-like storage key. I did not re-run append-only, numbering, owner-term or hard-pattern cases this round. But one rule-2 forgery class survives the A1 fix and one rule-5 false positive blocks ordinary P1 work. I added one file, `supabase/tests/reverify7-attacks.test.ts`, not committed; its DEFECT CHECK and FALSE POSITIVE CHECK fail on purpose (H-23), while the controls, boundary and observation pass. I edited no existing file and did not touch the board.

Defect (corrects L-0070; with a fix):
- E (rule 2, H-25; the L-0066 A1 / L-0070 fix is incomplete). L-0070 peels explicit container markers (`>`, `-`, `*`, `+`, `1.`, `1)`) before the heading and blockquote tests, so a marker-nested heading such as list-in-list or list-in-blockquote is refused. But a construct reached by *indentation* into a preceding list item carries no marker on its own line: under a `- ` item (content column 2) a line indented four or five spaces is that item's own content, so `### …` there is a heading inside the list item, and the same holds under `1. ` at four spaces. The script's heading, blockquote and setext tests and its marker peeler all look only at up to three leading spaces, so none fire and the entry exits 0. markdown-it-py 4.2.0 (`commonmark` and `gfm-like` presets, linkify disabled) renders each of six cases as the forbidden construct nested inside the §16 log: a loose and a tight list-item heading, an ordered-list heading, a blockquote, a setext heading underlined with `===`, and a header-shaped line whose separators are hyphens (which also slips past the middot-lookalike rule). I did not view GitHub's own rendering. Appendix C already says new log text may contain no "heading inside a list item at any nesting depth" or "blockquote at any nesting depth"; the script enforces this only for marker-nested, not indentation-nested, constructs. This is the L-0066 A1 class (`### P0-09 VERIFIED by MJ` rendered as a real heading in the log) reached a different way. Fix: strip all leading whitespace, not only up to three spaces, before the heading, blockquote and setext tests in new log text, or treat any four-plus-space-indented non-fence line that follows a list item as list content and re-test it. Trade-off: an unfenced indented code block whose text begins with `#` would then be refused, which is acceptable — the log already forbids indented fences and uses column-0 fences.
- Contrast, not a defect: a standalone four-space-indented `### …` at the top level is an indented code block in CommonMark (renders as code, not a heading), so the script's exit 0 there is correct; the defect is that the same indentation becomes a heading once it follows a list item.

False positive (ordinary honest work refused; the L-0070 F-C name-like exemption is incomplete):
- F (rule 5, H-25). Appendix C exempts "multi-part lowercase name-like values". `isNameLike` accepts a segment only if it is lowercase letters with up to four trailing digits, a four-digit year, or `vN`; it rejects a segment that is one-to-three bare digits (`3`, `01`) or a letter followed by digits (`a5`). So an UPPER_SNAKE constant whose name ends `_KEY` (matched by `ENV_KEY_RE`, whose name is not password-like, so `looksSecret` takes the length branch) and holds an ordinary PDF-template, outbox or pagination key is refused as a secret: `RECEIPT_TEMPLATE_KEY = "receipt-a5-v2"`, `INVOICE_TEMPLATE_KEY = "invoice-a4"`, `OUTBOX_KEY = "kiran-outbox-2026-01"` and `SALONS_CACHE_KEY = "salons-page-3"` all exit 1. The identical value under a lowercase name (`salonsCacheKey`) or a non-`_KEY` uppercase name (`SALONS_CACHE`) exits 0, and a value whose numeric segments are both four-digit years (`invoice-2026-2027`) exits 0 — so this is a naming-convention artefact, not a secret. These are idiomatic P1-04 / P1-06 / P1-09 template and storage-key constants. Fix: accept one-to-three-digit and letter-plus-digit segments in `isNameLike` while requiring at least one segment of two or more letters, so a value such as `ab12-34` still earns no blanket exemption.

Observations, not defects:
- O1. A header-shaped line that keeps the canonical middot separators is refused by the lookalike rule even when indented inside a list item (exit 1), so the E forgery is limited to non-middot headings — the same limit the accepted L-0066 A1 defect carried.
- O2. I did not re-test the accepted classes (non-canonical headings outside §16; bare secrets in code comments); they remain review-only or documented (L-0066 O1; Appendix C "in source code only quoted literals count").

**Evidence:** All runs local, `DATABASE_URL` and `KIRAN_TEST_DATABASE_URL` unset in the child env, on embedded Postgres; no remote database, Supabase project, GitHub or MCP tool touched, and `scripts/staging-smoke.mjs` not run.
1. Throwaway clone of 4c6e765 under the scratchpad, one commit per case, `node scripts/activity-log-check.mjs 4c6e765 HEAD`, terms empty; deleted afterwards. Controls held, exit 1 each: a top-level heading; both A1 marker-nested headings; a middot header-shaped line, indented; a tab-indented heading; a blockquote with a lazy continuation line. Legitimate work passed, exit 0: a code change with an entry; `OUTBOX_KEY = "kiran.outbox.v1"`; lowercase `idempotency_key` with a hyphenated value.
2. E: the six indentation-nested cases each exit 0; markdown-it-py renders each as the forbidden construct nested in the log, confirmed by reading the emitted HTML.
3. F: the four `_KEY` cases exit 1 ("assigns a secret-looking value"); the lowercase name, the non-`_KEY` name and the four-year value exit 0.
4. `supabase/tests/reverify7-attacks.test.ts` repeats E and F in its own temporary clones over the worktree script: run alone, `pnpm vitest run … reverify7` gave "Tests 2 failed | 3 passed (5)" — the DEFECT CHECK and the FALSE POSITIVE CHECK fail (the defect and the false positive); the controls, boundary and observation pass.
5. Baseline at the clean HEAD 4c6e765, before adding anything: `pnpm db:test` gave "Test Files 10 passed (10) / Tests 437 passed (437)". Full suite with this file and entry in place: "Test Files 1 failed | 10 passed (11) / Tests 2 failed | 440 passed (442)". The two failures are my reverify7 DEFECT CHECK and FALSE POSITIVE CHECK; all 437 earlier tests and the other three reverify7 tests pass.
6. Appendix C vs the script: E (indentation-nested heading/blockquote) and F (no one-to-three-digit name-like segment) are H-25 disagreements; the other items match the text.
7. `node scripts/activity-log-check.mjs 4c6e765` on this entry returned OK. Diff: my only changes are the new test file and this entry; the example secret-shaped strings are fake and the honest-work values are not secrets.
**Rules touched:** H-16, H-20, H-23, H-24, H-25; §7; Appendix C
**Next / needs:**
- Builder, P0-09: fix E (strip all leading whitespace before the heading, blockquote and setext tests in new log text) and F (allow short digit segments in `isNameLike` behind a two-plus-letter-segment guard), and update Appendix C where it now disagrees; then a different agent re-verifies P0-09.
- MJ: O1 and O2 are for review.

### L-0072 · 2026-10-26 09:30 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P0-09    **Claim:** C-001
**What / why:** Accepting L-0071. I committed the re-verifier-7 entry and `supabase/tests/reverify7-attacks.test.ts` unedited (commit e590bba). L-0071 confirmed that the suite was green at 4c6e765 before it added anything (437/437). P0-09 goes back to IN PROGRESS for defect E (blocks nested in a list item by indentation alone) and false positive F (short number segments in `*_KEY` values).
**Evidence:** With L-0071 in place and before any fix, `pnpm db:test` gave "Tests 2 failed | 440 passed (442)", and both failures were re-verifier-7's checks.
**Rules touched:** §7, H-23
**Next / needs:** L-0073, L-0074.

### L-0073 · 2026-10-26 09:35 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DEVIATION
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Appendix C updated to match the script (H-25).
- **Rule 2:** in new log text, any indented heading, blockquote or setext underline is refused, whatever the indentation, and so is a non-canonical line naming both an `L-nnnn` id and PKT. Honest log entries use fenced code blocks for examples.
- **Rule 5:** name-like values may contain short number segments and letter-plus-digit segments, if at least one segment is a word.
**Rules touched:** H-25, H-26
**Next / needs:** —

### L-0074 · 2026-10-26 09:40 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Fixes L-0071 in `scripts/activity-log-check.mjs`.
- **E:** after peeling container markers, new log text is also tested with all leading whitespace removed. An indented `###`, `>` or setext underline is refused, as is a non-canonical line with an `L-nnnn` id and PKT, which covers hyphen-separated look-alikes. A top-level 4-space block that renders as code is now refused in new log text too; that is stricter, and fences remain available.
- **F:** `isNameLike` accepts segments that are 1 to 4 digits or a letter plus 1 to 3 digits, provided at least one segment is a word of 2 or more letters. So `receipt-a5-v2`, `invoice-a4`, `kiran-outbox-2026-01` and `salons-page-3` are names. Password and secret names still use the strict rule.
**Evidence:**
- `pnpm vitest run … reverify7 reverify6 reverify5 reverify4` gave "Tests 40 passed (40)", including the L-0071 DEFECT CHECK and FALSE POSITIVE CHECK.
- Replays in throwaway clones (deleted): `evasions3.sh` gave 19 of 20 as expected (the one miss is the known Git Bash `\u` artifact); `evasions3b.sh` gave 6 of 6.
- `node scripts/activity-log-check.mjs main` → OK.
- The full suite and typecheck were re-run after these entries were written; the counts are in the commit message.
**Rules touched:** H-01, H-20, H-23, H-25
**Next / needs:** Re-verification of P0-09 (§7).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0075 · 2026-10-26 11:00 PKT · Claude · Opus 5.5 · re-verifier-8 subagent · branch feat/p0-foundation (K repo) · CORRECTION
**Task:** P0-09    **Claim:** —
**What / why:** Independent §7 re-verification, round 8, of the log check after the L-0074 fix (E, F) and the L-0073 Appendix C update, under MJ's L-0029 ruling. I am a fresh subagent and wrote none of the earlier entries; P1-01 is VERIFIED (L-0061) and I did not re-check it. Result: **P0-09 is not VERIFIED** (corrects L-0074). The L-0071 E and F fixes hold, and so did every append-only, numbering, maker≠checker, hard-pattern and owner-term control I replayed. But five evasion classes and five false-positive classes remain. I added one file, `supabase/tests/reverify8-attacks.test.ts`, not committed; its five DEFECT CHECKs and five FALSE POSITIVE CHECKs fail on purpose (H-23), while the controls and the observation pass. I edited no existing file and did not touch the board.

Defects (corrects L-0074; each with a fix):
- D1 (rule 2). A lone carriage return (CR with no LF) ends a line in CommonMark but not in the script, which splits on LF and CRLF only; the `eol=lf` attribute normalises CRLF but leaves a lone CR. (a) An Evidence line made of "ok.", a lone CR and `### P0-09 VERIFIED by MJ (owner sign-off)` exits 0, and markdown-it-py renders a real h3. (b) Worse: inside a column-0 fenced block, a line made of "sample", a lone CR and three backticks closes the fence for the renderer but not for the script, which keeps reading the next lines as code. A full canonical header for a forged entry L-0099, typed VERIFIED and signed "MJ · human", then a Task line naming P0-09 and an Evidence line "VERIFIED by MJ, CI green.", then a fence line and "end", a lone CR and three backticks to resynchronise: exit 0. markdown-it-py renders the forged header as an h3 and its Task and Evidence lines as a paragraph. Because the script reads those lines as code, the forged entry escapes numbering, the entry-shape rule and the maker≠checker test. Fix: refuse any CR not followed by LF in `docs/ACTIVITY.md` (simplest), or split on CRLF, CR and LF everywhere lines are split.
- D2 (rule 2). `stripInlineCode` removes backtick spans before the raw-HTML, entity and comment tests, but it ignores backslash-escaped backticks and accepts a closing run that is part of a longer run (CommonMark needs an unescaped opening run and a closing run of exactly the same length). So text the script takes for code renders as live HTML. `<h3>P0-09 VERIFIED by MJ</h3>` between two escaped backticks, or after one backtick and closed by two, exits 0, and markdown-it-py passes the `<h3>` through as raw HTML. With entities for the hyphen and the K, a canonical-looking VERIFIED header signed MJ renders the same way and also dodges the entry-shape rule and the entry-id rule. The same trick hides text in an HTML comment. Fix: drop backslash-escaped backticks first, then match code spans by the CommonMark rule (an opening run not preceded by a backtick, a closing run of equal length not followed by one), so an honest backticked `<details>` still passes.
- D3 (rule 2). The raw-HTML test needs the closing `>` on the same line. A tag split over two lines (`<details`, then a line `title="x">`) exits 0 and renders as a raw `details` element; `<pre` or `<![CDATA[` alone on a line exits 0 and opens an HTML block that swallows the following text to the end of the document. Fix: refuse `<` followed by a letter, `/`, `!` or `?` in non-code text whether or not `>` follows, and exempt the autolink shapes (FP4).
- D4 (rules 0 and 5; fail-open). File names are decoded as UTF-8, so a path holding a byte that is not valid UTF-8 is mangled to U+FFFD. `git show HEAD:<path>` then fails, `readAdded` returns null and the loop moves on, so the full UTF-16 scan is skipped with no error. A UTF-16 file under such a path exits 0 when it holds a fake JWT, and exits 0 when it holds an invented owner term with that term set; the same JWT under an ordinary path exits 1. I staged the blob with `git update-index --index-info` and the raw byte. Appendix C rule 0 says a failing git command fails the check. Fix: fail when a listed, non-deleted file cannot be read; better, read the name list as bytes, or read blobs by object id from `git ls-tree -z`.
- D5 (rule 5, H-25). Appendix C promises to catch "connection strings with a password", but only the `user:password@host` form is matched. A Postgres URI carrying the password as a query parameter (`?user=…&password=…`), or a libpq keyword string (`host=… user=… password=…`), exits 0 inside a TypeScript string literal, because in code the name heuristic skips bare values; the same URI in a Markdown runbook under `docs/` exits 0, because Markdown skips the name heuristic. In YAML the name heuristic catches it (exit 1). Fix: add hard patterns for a password parameter in a `postgres(ql)://` URI and for a password keyword in a libpq-style string, with the same placeholder exception.

False positives (honest work refused):
- FP1 (rule 2; documented since L-0073). The entry-id-plus-timezone rule tests the raw line, inline code included, so it refuses prose of the kind already in the log: the builder's L-0016 (an entry id and "entries are labelled" plus the timezone word on one line) and re-verifier-6's L-0066 (an entry id beside the timezone word in backticks). Both shapes exit 1 in a fresh entry, and this entry had to keep every entry id off any line naming the timezone. Fix: apply the rule only to lines that are heading-shaped after peeling, or that also carry an `HH:MM` time, and run it with inline code removed.
- FP2 (rule 2, H-25). L-0070 added `|` to the separators accepted after the timezone word, but Appendix C still describes only the middot form. So a table cell holding a time and the timezone word, in a log entry or in the §12–§15 tables, is refused as a non-canonical entry header: an Evidence table row with such a time cell exits 1. Fix: drop `|` from the whole-file rule (new log text already refuses headings and entry-id lines), or document it.
- FP3 (rule 5; spec gap, not H-25). Supplier wording is allowed only in `_vault` migrations, tests and docs. Doc 07 plans a vault UI for P1-05, but an owner screen typing a row field `supplier_name` read from `vault_api`, or an i18n label keyed `supplier`, exits 1. Fix (MJ decides): an exemption for the vault UI route and its strings plus a DEVIATION, or a rule that P1-05 code avoids those identifiers.
- FP4 (rule 2, minor H-25). CommonMark autolinks are not raw HTML, but `<https://…>` in an Evidence line, and a quoted commit trailer ending in an e-mail address in angle brackets, each exit 1. Fix: exempt the autolink shapes (a URI with a scheme, or an e-mail address) from the tag test.
- FP5 (rule 5; same family as L-0071 F). `isNameLike` is lowercase-only, so `FONT_KEY = "NotoNastaliqUrdu-Regular"` (a Nastaliq font for Urdu PDFs, P1-06 and P1-07) exits 1 as a secret, while the kebab-case file key `noto-nastaliq-urdu-regular.ttf` passes; a PascalCase `STORAGE_KEY = "KiranOutboxEncryptedV1"` also exits 1. Fix: accept mixed-case word segments (split on case changes) behind the same at-least-one-word guard.

Observations, not defects:
- O1. A Cyrillic look-alike letter in an owner term passes (inherent, as recorded in L-0061 D5). An owner term that appears only in a commit message passes: Appendix C does not claim commit messages, though H-01 lists them. For MJ.
- O2. A device `manufacturer` field in app code is refused; doc 07 reserves that word, so this is by design (a device field can be called `make`).
- O3. A `.env.local.example` template never reaches the check: the root `.gitignore` ignores `.env.*` except `.env.example`.
- O4. Honest P1 work passed: a P1-02 salon migration (RLS enabled and forced, a SECURITY DEFINER function with an empty search_path and a client id), an outbox, payment and PDF module with `client_id`, `amount_paisa` and a `receipt-a5` template key, Urdu i18n strings, the L-0071 F keys, a VERIFIED for P0-08 by another signer, and an entry with nested lists and a column-0 fence holding header-shaped lines.

**Evidence:** All runs local, `DATABASE_URL` and `KIRAN_TEST_DATABASE_URL` unset in the child env, on embedded Postgres; no remote database, Supabase project, GitHub or MCP tool touched, and `scripts/staging-smoke.mjs` not run.
1. Baseline at the clean HEAD 8aeacff, before adding anything: `pnpm db:test` gave "Test Files 11 passed (11) / Tests 442 passed (442)".
2. Throwaway clone of 8aeacff under the scratchpad, one commit per case, `node scripts/activity-log-check.mjs 8aeacff HEAD`, terms empty unless stated; deleted afterwards. Controls held, exit 1 each: a top-level heading; an indented heading under a list item (the L-0071 E case); a hyphen-separated header under a list item; the builder's own VERIFIED of P0-09 (refused as the same agent as its DONE entries); an edit to an old line of L-0072; a skipped and a duplicate entry number; a code change with no entry; a JWT in TypeScript; the owner term plain and split by U+200B; a plain inline `<h3>`; an entity; a password-named literal; a UTF-16 JWT under an ordinary path; the query-parameter URI in YAML. Legitimate work passed, exit 0: a code change with an entry, and every O4 case.
3. Evasions, exit 0 each: D1 (a) and (b); the four D2 cases; the three D3 cases; the two D4 cases; the three D5 cases; the two O1 cases.
4. False positives, exit 1 each: the two FP1 cases, the FP2 table row, the two FP3 cases, the two FP4 cases, the two FP5 keys.
5. Rendering, markdown-it-py 4.2.0, `commonmark` and `gfm-like` presets, linkify off: a real h3 for D1 (a) and for the forged header in D1 (b); the `<h3>` and the comment passed through as raw HTML for D2; the split `details` tag and the swallowing `pre` and CDATA blocks emitted raw for D3; both FP4 inputs rendered as links. I did not view GitHub's own rendering.
6. `supabase/tests/reverify8-attacks.test.ts` repeats D1 to D5 and FP1 to FP5 in its own temporary clones over the worktree script: run alone, `pnpm vitest run --config supabase/tests/vitest.config.ts reverify8` gave "Tests 10 failed | 2 passed (12)"; the five DEFECT CHECKs and five FALSE POSITIVE CHECKs fail, and the controls and the observation pass. `tsc -p supabase/tests/tsconfig.json --noEmit` exits 0.
7. Full suite with this file and this entry in place: `pnpm db:test` gave "Test Files 1 failed | 11 passed (12) / Tests 10 failed | 444 passed (454)". The ten failures are my five DEFECT CHECKs and five FALSE POSITIVE CHECKs; all 442 earlier tests and my other two tests pass. I ran it again after writing these counts into this entry, with the same result.
8. Appendix C vs the script: D5, FP2 and FP4 are H-25 disagreements, and D1 to D4 break promises Appendix C already makes (no raw HTML, entities or comments outside code; a strict structure for new log text; fail closed). FP1, FP3 and FP5 agree with the text but refuse honest work.
9. `node scripts/activity-log-check.mjs 8aeacff` on this entry returned OK. Diff: my only changes are the new test file and this entry; the example secrets are fake and assembled at run time.
**Rules touched:** H-01, H-16, H-20, H-23, H-24, H-25; §7; Appendix C
**Next / needs:**
- Builder, P0-09: fix D1 to D5 and FP1, FP2, FP4 and FP5, and update Appendix C where it disagrees; then a different agent re-verifies P0-09.
- MJ: FP3 (a path exemption for the P1-05 vault UI, or not) and O1 are your decisions.

### L-0076 · 2026-10-26 20:00 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P0-09    **Claim:** C-001
**What / why:** Accepting L-0075. I committed the re-verifier-8 entry and `supabase/tests/reverify8-attacks.test.ts` unedited (commit e79b3a4). P0-09 goes back to IN PROGRESS for D1 to D5 and false positives FP1, FP2, FP4 and FP5. FP3 and O1 were assigned to MJ by L-0075, so I am not deciding them (L-0079).
**Evidence:** L-0075 recorded "Tests 10 failed | 444 passed (454)" with its file in place. My first run of reverify4 to reverify8 after the fixes gave "Tests 1 failed | 51 passed (52)": the FP4 autolink check still failed because the whole-file raw-HTML rule did not yet skip autolinks. Fixed in L-0078.
**Rules touched:** §7, H-23
**Next / needs:** L-0077 to L-0079.

### L-0077 · 2026-10-26 20:05 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DEVIATION
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Appendix C updated to match the script (H-25).
- **Rule 0:** an added file the script cannot read, or a changed path that is not valid UTF-8, fails the check.
- **Rule 2:** a carriage return not followed by a line feed is refused anywhere in this file. New log text may not contain the less-than, ampersand or backslash characters outside fenced code; CommonMark autolinks (a URL or e-mail address in angle brackets) are allowed there and in the whole-file raw-HTML rule. The rule refusing a line that names both an entry id and PKT is removed; the entry-shaped line rule counts only dot-like separators after PKT, not a table bar.
- **Rule 5:** connection strings include a password given as a URI query parameter or as a libpq keyword. Mixed-case values made only of whole words, such as a font or storage key, count as name-like.
**Rules touched:** H-25, H-26
**Next / needs:** —

### L-0078 · 2026-10-26 20:10 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Fixes L-0075 D1 to D5, FP1, FP2, FP4 and FP5 in `scripts/activity-log-check.mjs`. The approach this round closes classes of trick rather than single cases.
- **D1:** a lone carriage return anywhere in the file fails, so nothing can split a line for the renderer only.
- **D2, D3:** new log text outside fenced code may not contain the less-than, ampersand or backslash characters at all, whatever surrounds them, so no code-span, open-tag or escape trick reaches the renderer. Autolinks are removed before the test.
- **D4:** an added path that cannot be read now fails (it used to be skipped), and so does any path the script sees as not valid UTF-8.
- **D5:** two new hard patterns: a password as a URI query parameter, and a libpq keyword password. Placeholders and dollar or brace references are exempt. They apply in every file, docs included; the existing tree still passes.
- **FP1:** the rule pairing an entry id with PKT on a non-header line is removed. Fake headers are still caught by the entry-shaped line rule and by the heading rules.
- **FP2:** the table bar no longer counts as an entry separator after PKT.
- **FP4:** autolinks are skipped by both the whole-file raw-HTML rule and the new-text character rule.
- **FP5:** the name-like test also accepts values that split exactly into capitalised or lowercase words, short numbers or a V-version, with at least two words. Password and secret names keep the strict rule.
**Evidence:**
- `pnpm vitest run … reverify8 -t autolink` gave "Tests 1 passed | 11 skipped (12)" after the FP4 fix.
- `pnpm db:test` before writing these entries gave "Test Files 12 passed (12), Tests 454 passed (454)"; this was with the FP3 exemption, which I then removed (L-0079), so rv8 FP3 fails again on purpose.
- Replays in throwaway clones (deleted): `evasions3.sh` gave 20 of 20 as expected (the earlier Git Bash escape miss is now refused by the backslash rule); `evasions3b.sh` gave 6 of 6.
- `node scripts/activity-log-check.mjs main` → OK.
- The full suite, typecheck and the log check were re-run after these entries were written; the counts are in the commit message.
**Rules touched:** H-01, H-20, H-23, H-25
**Next / needs:** MJ: L-0079. Then re-verification of P0-09 (§7), or stopping criteria.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0079 · 2026-10-26 20:15 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · BLOCKER
**Task:** P0-09    **Claim:** C-001
**What / why:** Two L-0075 items are MJ's decisions, not fixes.
- **FP3 (B-21):** supplier wording is allowed only in vault migrations, tests and docs, so the owner's vault UI planned for P1-05 and an i18n label such as "Supplier" are refused. Proposed one-line change, ready to approve as written: also allow any path with a `vault/` directory segment, and i18n, locale or translations directories. Real supplier names stay caught everywhere by the owner-listed terms; this exempts only the generic word. Recommendation: approve. Until then the rule stays restrictive, and CI shows one red test (rv8 FP3) on purpose.
- **O1 (B-22):** owner terms in commit messages are not scanned (H-01 lists commit messages; Appendix C does not claim them), and look-alike letters in an owner term pass (inherent, L-0061 D5). Recommendation: scan commit messages in the range for owner terms and secret patterns; accept the look-alike limit.
**Evidence:** L-0075 items 4 and 8 and its Next / needs; `reverify8-attacks.test.ts` FP3 and OBSERVATION tests.
**Rules touched:** H-01, H-22
**Next / needs:** MJ: approve or refuse B-21 and B-22.

### L-0080 · 2026-10-26 20:25 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DECISION
**Task:** P0-09 (B-21)    **Claim:** C-001
**What / why:** MJ approved: "Approved: B-21. Allow supplier wording under any vault/ path segment and in i18n, locale or translations directories; owner terms still apply everywhere." B-21 is resolved. B-22 stays pending.
**Rules touched:** H-01, H-22
**Next / needs:** L-0081, L-0082.

### L-0081 · 2026-10-26 20:30 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DEVIATION
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Appendix C rule 5 updated to match the script under L-0080 (H-25): supplier or cost wording is also allowed in any path with a `vault/` directory segment and in i18n, locale or translations directories. Owner-listed terms still apply in every file and path.
**Rules touched:** H-25, H-26
**Next / needs:** —

### L-0082 · 2026-10-26 20:35 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Implements B-21 (L-0080) in `scripts/activity-log-check.mjs`: the supplier-wording allow-list adds any `vault/` directory segment (the owner's vault UI planned for P1-05) and i18n, locale or translations directories. This is the exact change proposed in L-0079, nothing else. With it, every L-0075 finding except O1 (B-22) is addressed.
**Evidence:**
- `pnpm vitest run … reverify8` gave "Tests 12 passed (12)".
- The full suite, typecheck and the log check were re-run after these entries were written; the counts are in the commit message.
**Rules touched:** H-01, H-23, H-25
**Next / needs:** Re-verification of P0-09 (§7) by a different agent, or MJ sets stopping criteria. MJ: B-22.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0083 · 2026-10-26 20:40 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P0-02    **Claim:** C-001
**What / why:** Claiming P0-02 (load and clean the Excel; import mapping and dry-run) toward Gate 0 criterion 2. MJ does not have the file in the repo and must never put it there (H-03); B-02's stated default is "use synthetic data for development", so I build the dry-run tool against synthetic data only, and MJ runs it locally on the real file.
- Scope: a dry-run only. It reads a file, validates it against the doc 04 salon fields, prints a masked report and writes nothing to any database. The real import is P1-02 (H-22).
- New paths added to C-001: `packages/import/`, `.github/workflows/ci.yml` (a step to run the package tests), `.gitignore` (a report directory), `docs/runbooks/`.
- Record: earlier in this session I offered MJ a Gate 0 waiver to start P1-02, and MJ answered "no continue on G0". No waiver was logged and nothing for P1-02 was built. Gate 0 stays NOT PASSED.
**Evidence:** Board row P0-02 set to IN PROGRESS under C-001. Commit 52a718b (B-21) is pushed; with it, `pnpm db:test` gave "Tests 454 passed (454)".
**Rules touched:** H-03, H-22, §8
**Next / needs:** Build, test, then DONE.

### L-0084 · 2026-10-26 20:55 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-02 (dry-run tool)    **Claim:** C-001
**What / why:** The Excel import dry-run for Gate 0 criterion 2, built and tested on synthetic data only (B-02 default). Running it on the owner's real file is MJ's step (gate-0-checklist action 7), so the board row stays IN PROGRESS until that run is logged.
- **New package `packages/import`:** a core with no I/O (column mapping, value normalisers, row validation, masked report) and a thin command-line wrapper, run as `pnpm -C packages/import dry-run` followed by the file path. It reads .xlsx (exceljs 4.4.0) or .csv (own parser); old .xls is refused with a Save As hint. It writes nothing to any database; the real import is P1-02 and will reuse the core.
- **Checks against doc 04:** salon name and area required; type mapped to the doc 04 enum, unknown words become other with a warning; phones normalised to +92, with Excel number damage an error and landlines a warning (no OTP, CTL-09); the same phone on two salons flagged (CTL-18); chairs 1 to 200; latitude and longitude both or neither, swapped or outside Karachi flagged; opening balance to integer paisa as bigint, negative balances flagged for the manager; same name in the same area flagged. Errors block, warnings import with a flag. The full list, and what CLEAN means, is in the new runbook `docs/runbooks/excel-import-dry-run.md`.
- **H-03 by construction:** the report never prints salon names, contact names, addresses or full phones (rows by number, phones masked); the optional JSON report has the same masked facts and goes only to `import-reports/`, now in `.gitignore`; the tool warns when the input file sits inside the repository.
- **Also:** CI runs workspace package tests in the typecheck job (`pnpm -r --if-present test`), so the required check name is unchanged. `docs/gate-0-checklist.md` updated: criterion 2 no longer waits for the P1-02 tables, a new action 7 for MJ, and a stale tasks line corrected (P1-01 is VERIFIED).
**Evidence:**
- `pnpm -r --if-present test` from the root gave "Tests 17 passed (17)": normalisers, mapping, the clean and messy synthetic CSVs (every error on its spreadsheet row), the area list, a generated .xlsx with numeric phone and formula cells, CLI exit codes 0, 1 and 2, the in-repo warning, the JSON report location, and a check that no report contains a name or a full phone.
- `pnpm typecheck` exit 0 (both workspace packages included).
- `pnpm audit --prod` reports one moderate advisory, in uuid through exceljs (GHSA-w5hq-g745-h8pq, a buffer bounds check in v3, v5 and v6 when a buffer is passed). exceljs uses only v4 without a buffer, so it is not reachable here; noted, not overridden.
- Fixtures are synthetic: Test Salon NN, Test Owner X, 0399-prefixed numbers, and public locality names from doc 02.
- The full suite and the log check were re-run after this entry was written; the counts are in the commit message.
**Rules touched:** H-03, H-22, H-23, H-25
**Next / needs:** MJ: gate-0-checklist action 7 (run it on the real file, outside the repo, and log the summary). A different agent may verify the tool (§7).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) — no database writes at all
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — not applicable, read-only tool
[x] Audit trigger present; hash chain verifies (H-17) — unchanged
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0085 · 2026-10-26 22:00 PKT · Claude · Opus 5.5 · re-verifier-9 subagent · branch feat/p0-foundation (K repo) · CORRECTION
**Task:** P0-02, P0-09    **Claim:** —
**What / why:** Independent §7 re-verification, round 9, of the P0-02 import dry-run (L-0084) and of the log check P0-09 after L-0078 and L-0082, under MJ's L-0029 ruling. I am a fresh subagent and wrote none of the earlier entries. Result: **P0-02 is not VERIFIED** (corrects L-0084) and **P0-09 is not VERIFIED** (corrects L-0078 and L-0082). For P0-09 the L-0075 fixes hold where they were applied (lone carriage return, the character ban in new log text, autolinks, fail-closed paths, the query-parameter pattern, the mixed-case exemption, B-21), but the L-0075 D1(b) fence desync is open again through other characters, and the D2 and D3 tricks still work everywhere outside new log text. I added two files, not committed: `supabase/tests/reverify9-attacks.test.ts` and `packages/import/tests/reverify9-import.test.ts`. Their DEFECT CHECKs and FALSE POSITIVE CHECKs fail on purpose (H-23); the controls and the observation pass. I edited no other file and did not touch the board.

P0-02 defects (corrects L-0084):
- D1 (H-03, H-25; blocking). When no row among the first 20 names a known column, `splitHeader` takes the first row with two non-empty cells as the header; and a data cell that happens to be an alias word (a type cell "Parlour" is a name alias) outranks a header written in Roman Urdu. The report then prints those header cells verbatim under "Column mapping" and "ignored columns", in the text report and in the JSON report. A synthetic sheet without a header row, run through the CLI, printed "Test Salon 01" and "0399-0000001" in full. The runbook promises the report never prints salon names or full phone numbers. Fix: never print header cells verbatim when they could be data (column letters instead), and refuse a sheet whose header row names no known column unless `--mapping` names its columns.
- D2 (wrong CLEAN; money). `cellText` turns a formula whose cached result is an Excel error into the 15-character text "[object Object]", which passes as a salon name or an area. An error cell (values pasted from a failed lookup) and a formula with no cached result become empty, so a balance reads as Rs 0 with no warning. Each of three one-row files was CLEAN. Fix: an error value or a missing formula result is a row error in that field.
- D3 (wrong CLEAN). Without `--sheet` the tool reads the first worksheet even when it is hidden, and the report does not name the sheet it read. A clean hidden sheet gave CLEAN while the visible sheet had a blank name and an Excel-damaged phone. Fix: read the first visible sheet and print its name, or refuse when hidden sheets exist and no sheet is named.
- D4 (wrong CLEAN). The prefix guess gives a "Contact Mobile" column to `contact_name`, and leaves "Owner Mobile" unmapped when "Owner Name" exists, so the phone column is never validated: "3.99E+09" passed with only a "no phone" warning. Fix: a header containing a phone word (mobile, phone, cell, whatsapp) maps to phone before any contact prefix, or the run stops when a phone-like column is left unmapped.
- D5 (phone; low). A mobile number missing one digit (0399-000000, or 92399000000) matches the landline rule and imports with only a landline warning. No landline area code starts with 3. Fix: a number starting 03 or 923 must be a full mobile number, else an error.
- D6 (money; low). "(-1,000)" is read as plus Rs 1,000, because the brackets and the minus cancel. Fix: refuse both marks together.

P0-02 false positives (honest files refused):
- FP1. Lakh grouping, as owners commonly write amounts (1,25,000; Rs 12,50,000/-), is refused as "not a rupee figure".
- FP2. A cached formula result with binary float noise (1650.0000000000002 for 1500 times 1.1, which Excel displays as 1,650) is refused. Fix: round a numeric cell to paisa when it is within a tiny tolerance of a whole paisa.
- FP3 (H-25). A title line starting with "Salon" above headers in Roman Urdu becomes the header row, because only that line names an alias. The runbook's remedy, `--mapping`, is applied after the header row is chosen, so every mapped column is reported missing and the file never passes (exit 1). Fix: let the explicit mapping choose the header row.

P0-09 defects (corrects L-0078 and L-0082):
- D1 (rule 2; blocking; the L-0075 D1(b) class reopened, contrary to L-0078's claim that it closes classes of trick). `scan` closes a fence when the fence characters are followed by any JavaScript whitespace, while CommonMark allows only spaces or tabs after a closing fence. A closing fence followed by U+00A0 (no-break space) or U+000B (vertical tab) therefore closes the block for the script only; the next bare fence closes it for the renderer and opens one for the script. The shape below exits 0 for both characters. markdown-it-py renders the forged header as an h3 and its Task and Evidence lines as a paragraph, while the script reads them as code, so they escape numbering, the entry-shape rule and maker ≠ checker.

~~~text
```text
sample
``` followed by U+00A0 (or U+000B)
```
(here a full canonical entry header for L-0099, typed VERIFIED and signed "MJ · human")
**Task:** P0-09    **Claim:** —
**Evidence:** VERIFIED by MJ, CI green.
```
end
``` followed by U+00A0 (or U+000B)
```
~~~

Fix (P0-09 D1): every fence test accepts only spaces and tabs, for example the closing test

```
/^ {0,3}(`{3,}|~{3,})[ \t]*$/
```

- D2 (rule 2, H-25). Two gaps. (a) L-0078 closed L-0075 D2 and D3 only in new log text, by the character ban. The whole-file rule that Appendix C states for every line outside code still uses the old code-span stripping and still needs the closing angle bracket on the same line, so any change outside §16 that comes with an entry can carry those tricks: an HTML comment opened and closed between escaped backticks in §14, and a bare pre or details tag opener in §15 (the pre one swallows the rest of the document for the renderer) each exit 0. (b) A level-two Appendix heading placed in the new text below the new entry becomes the end of §16, so it escapes the "no other headings" rule, and everything below it escapes the new-text rules. Under such a heading, an h3 tag between escaped backticks, with HTML entities for the hyphen and the letter K, rendered a canonical-looking VERIFIED header for L-0099 signed MJ; exit 0. Fix: apply the character ban (or the CommonMark code-span rule) to every changed line outside code in the whole file, and end §16 only where the base file ends it, or refuse a new Appendix heading.
- D3 (rule 5). The L-0075 D5 libpq fix is partial: libpq also accepts spaces around the equals sign and single-quoted values. A keyword string with "password = value" in a TypeScript literal, and the spaced or the single-quoted form in a Markdown runbook, each exit 0. Fix: optional spaces around the equals sign and an optional single quote in the keyword pattern.
- D4 (rule 5, H-25; low). The mixed-case name-like branch splits digit runs into 4-digit chunks, so two words plus a digit run of any length pass; the same branch also lets lowercase multi-part values with long digit runs through, which the lowercase rule (up to 4 digits) refused before L-0078. `SMS_API_KEY = "KiranSms903718264519"` and `SMS_API_KEY = "kiran-sms-90371826451937"` in TypeScript exit 0, while Appendix C says "made only of whole words" and "short numbers". Fix: cap digit runs at 4 in the mixed-case branch.
- D5 (rule 4, H-25; low). Task-line text shaped like a task id is not flagged when it has one digit or another separator: a VERIFIED entry by another signer with Task "P0-08, P0-9", "P0-08, P0_09" or "P0-08, P0.09" exits 0, and only P0-08 is checked. Fix: widen the look-alike pattern.

P0-09 false positive:
- FP1 (rule 5; the L-0075 FP5 family). An acronym breaks the mixed-case split: `FONT_KEY = "NotoNaskhArabicUI-Regular"` (an Urdu and Arabic UI font, for the P1-06 and P1-07 PDFs) is refused as a secret.

Observations (for MJ, not defects):
- O1 (P0-02). The report prints the area column verbatim, by design (P0-03 needs it). If an owner's area column holds street addresses, those are printed too.
- O2 (P0-02). The tool also reads .txt files as CSV, which the runbook does not mention; an Excel "Unicode Text" export is UTF-16 and fails safe as unreadable columns. A real file placed under `packages/import/tests/` gets no in-repo warning, and that folder is not git-ignored.
- O3 (P0-09, B-21 edge). The approved exemption also covers `apps/web/public/vault/`, which Next.js serves to anyone without a login; supplier wording in a static JSON file there exits 0. Suggest excluding `public/` from the exemption.
- O4 (P0-09). A JWT in a UTF-32 file exits 0; Appendix C claims UTF-16 only, so this is not a breach.

**Evidence:** All runs local, with `DATABASE_URL` unset in the child env, on embedded Postgres. No remote database, Supabase project, GitHub or MCP tool was touched, and `scripts/staging-smoke.mjs` was not run. Spreadsheets were generated in temp directories outside the repository and deleted.
1. `pnpm -C packages/import test` with my file: "Test Files 1 failed | 1 passed (2)" and "Tests 9 failed | 18 passed (27)". The builder's 17 tests and my control pass; my nine checks fail. Their logged values: "rv9 P0-02 D1 leaks: cliText true, typeWordText true, typeWordJson true"; "D2 clean: nameErr true, balErrCell true, balUncached true"; "D3 verdict: true"; "D4 clean: contactMobile true, ownerMobile true"; "D5 ok: local true, intl true"; "D6: ok true, value 100000"; FP2 "false" with an opening_balance error on row 2; FP3 exit status 1.
2. `pnpm vitest run --config supabase/tests/vitest.config.ts reverify9`: "Test Files 1 failed (1)" and "Tests 6 failed | 2 passed (8)". Logged statuses: "rv9 D1 (nbsp, vt): 0 0"; "rv9 D2 (appendixH3, comment, pre, split): 0 0 0 0"; "rv9 D3 (tsSpaced, mdQuoted, mdSpaced): 0 0 0"; "rv9 D4 (mixed, lower): 0 0"; "rv9 D5 (control, oneDigit, underscore, dot): 0 0 0 0"; "rv9 FP1 (font): 1".
3. Controls that held (exit 1 where refused): the L-0075 lone carriage return and escaped-backtick h3 in new log text; supplier wording in a look-alike `vaulted/` segment; an owner term inside a `vault/` path. Passed as they should (exit 0): an ordinary code change with an entry; a closing fence followed by an ordinary space; supplier wording under `apps/web/app/office/vault/`; the L-0075 FP5 storage key. The rv8 file still passes in full within the suite below.
4. Full suite with my two files and this entry in place: `pnpm db:test` gave "Test Files 1 failed | 12 passed (13)" and "Tests 6 failed | 456 passed (462)". The six failures are my P0-09 checks; all 454 earlier tests and my control and observation pass. I ran it again after writing these counts into this entry, with the same result. Gotchas: three background attempts stopped at "No test files found" before running anything (an intermittent harness flake; a retry ran normally), and a filtered run once hit the same flake; and a first full run gave "Tests 20 failed | 442 passed (462)", 17 of the failures in earlier verifiers' files, because my draft of this entry had a header-shaped line inside a code block, which the older harnesses (they find the last entry by a plain line match) read as L-0099. I replaced that line before the run quoted here. The observation statuses in O3 and O4 were measured by hand in a throwaway clone with the same steps.
5. `pnpm typecheck`: exit 0 (supabase tests, packages/import and apps/web).
6. Read, not only run: the JSON report directory is fixed (`import-reports/` at the repo root, git-ignored), the file name comes from the timestamp only, and no user input reaches the path; `--mapping` and `--areas` are read only; old .xls is refused; scientific-notation phones are refused; duplicate-phone warnings are masked; text amounts reach bigint paisa without float arithmetic; merged, rich-text and hyperlink cells read correctly and row numbers match the sheet with a title line, a blank row and merged cells (my control). Fixtures are synthetic (Test Salon NN, 0399 numbers). The CI step `pnpm -r --if-present test` and the `.gitignore` entry exist; gate-0-checklist criterion 2 and action 7 agree with the runbook.
7. Rendering, markdown-it-py 4.2.0, `commonmark` and `gfm-like` presets, linkify off: the P0-09 D1 forged header rendered as an h3 for both characters; the D2 h3 tag and comment were emitted as raw HTML. I did not view GitHub's own rendering.
8. Docs against code: P0-02 D1 and FP3 disagree with the runbook (H-25). P0-09 D2, D4 and D5 disagree with Appendix C (H-25); D1 and D3 break promises Appendix C already makes.
9. `node scripts/activity-log-check.mjs 99a97de` on this entry: "activity-log-check OK (1 new log entry, 3 changed files)." `git status --short`: M docs/ACTIVITY.md, ?? packages/import/tests/reverify9-import.test.ts, ?? supabase/tests/reverify9-attacks.test.ts.
**Rules touched:** H-03, H-16, H-20, H-23, H-24, H-25; §5 (money in paisa); §7; Appendix C
**Next / needs:**
- Builder, P0-02: fix D1 to D6 and FP1 to FP3 and update the runbook where it disagrees; then a different agent re-verifies. Until D1 is fixed, MJ should run action 7 only on a sheet whose header row the tool recognises, and should not share the report.
- Builder, P0-09: fix D1 to D5 and FP1 and update Appendix C; then a different agent re-verifies.
- MJ: O1 to O4 are your decisions; B-22 is still pending.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change in either task
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) — the dry-run writes to no database; the log prefix rule held
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — not applicable
[x] Audit trigger present; hash chain verifies (H-17) — unchanged
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) — see O3
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20) — none in either diff or in mine; but P0-02 D1 can print real names and phones in a report
[x] Governance powers still owner-only + AAL2 (H-15) — not applicable, no permission change
[ ] No control weakened, skipped or "temporarily" disabled (H-16) — P0-09 D1 and D2 reopen L-0075 classes; P0-02 D1 breaks the H-03 promise
[ ] Docs match code; deviations logged (H-25) — see item 8
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0086 · 2026-10-27 10:00 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P0-02, P0-09    **Claim:** C-001
**What / why:** Accepting L-0085. I committed the re-verifier-9 entry and its two test files unedited (commit a9f1887). P0-02 and P0-09 go back to IN PROGRESS for P0-02 D1 to D6 and FP1 to FP3, and P0-09 D1 to D5 and FP1. Observations O1 to O4 are handled in L-0088 (O1, O2, as documentation) and L-0090 (O3, O4, for MJ).
**Evidence:** L-0085 recorded "Tests 6 failed | 456 passed (462)" for the database suite and "Tests 9 failed | 18 passed (27)" for packages/import, every failure one of its checks.
**Rules touched:** §7, H-23
**Next / needs:** L-0087 to L-0090.

### L-0087 · 2026-10-27 10:05 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DEVIATION
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Appendix C updated to match the script (H-25).
- **Rule 2:** control characters other than tab and line breaks are refused anywhere; a closing fence may be followed only by spaces or tabs; outside the §16 log, a tag opener or an entity refuses the line even inside a code span and without a closing angle bracket (placeholders there are now written in braces, and the three existing ones in §12 and Appendix C were rewritten that way); the top-level section headings may not change. The rules added here bind the new version of the file only.
- **Rule 4:** look-alike task ids include a one-digit number and underscore or dot separators.
- **Rule 5:** the libpq password pattern allows spaces around the equals sign and single quotes, on a line with another libpq keyword; the mixed-case name-like rule takes digit runs whole and allows short acronyms.
**Rules touched:** H-25, H-26
**Next / needs:** —

### L-0088 · 2026-10-27 10:10 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-02 (dry-run tool)    **Claim:** C-001
**What / why:** Fixes L-0085 P0-02 D1 to D6 and FP1 to FP3 in `packages/import`.
- **D1:** the header row must name at least two known columns (counting the columns an explicit mapping names), else the first row with two filled cells is taken. Reports print a heading only when it is made of heading words, otherwise its column letter, so a data row read as the header can no longer leak a name or a phone.
- **D2:** a cell holding an Excel error, or a formula with no saved result, is an error on that field; it is never read as text, zero or blank.
- **D3:** without a sheet option, the first visible sheet is read; hidden sheets are skipped and the report says which sheet it read.
- **D4:** every column whose heading names a phone is a phone column and is checked; extra phone columns are checked too.
- **D5:** a short or long 03 number is an error, not a landline.
- **D6:** brackets plus a minus sign is an error.
- **FP1:** lakh grouping is read. **FP2:** stored formula results are rounded to 15 significant digits, as Excel shows them. **FP3:** follows from D1.
- **O1, O2:** the runbook now says the area column is printed as written (keep street addresses in the address column), and that a txt file is read as CSV. A fixture under the package tests folder gets no in-repo warning on purpose.
**Evidence:**
- `pnpm -C packages/import test` gave "Tests 27 passed (27)": the builder tests and every L-0085 P0-02 check pass.
- `pnpm typecheck` exit 0.
- The full suite and the log check were re-run after these entries were written; the counts are in the commit message.
**Rules touched:** H-03, H-23, H-25
**Next / needs:** Re-verification of P0-02 (§7). MJ: gate-0-checklist action 7.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — not applicable, no database writes
[x] Audit trigger present; hash chain verifies (H-17) — unchanged
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0089 · 2026-10-27 10:15 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Fixes L-0085 P0-09 D1 to D5 and FP1 in `scripts/activity-log-check.mjs`.
- **D1:** a closing fence may be followed only by spaces or tabs, as in CommonMark, and other control characters are refused in the file, so a no-break space or vertical tab can no longer split the fence state.
- **D2:** outside the §16 log the HTML test runs on the raw line, so escaped backticks and tags split over two lines are caught; the top-level section headings must match the base, so an extra Appendix heading cannot end §16 early.
- **D3:** a libpq password with spaces or single quotes is caught when the line holds another libpq keyword.
- **D4:** digit runs in mixed-case values are taken whole (at most 4 digits).
- **D5:** look-alike task ids with one digit or another separator are refused on VERIFIED Task lines.
- **FP1:** short acronyms are allowed inside mixed-case names.
**Evidence:**
- `pnpm vitest run … reverify9 reverify8 reverify7 reverify6 reverify5 reverify4` gave "Test Files 6 passed (6), Tests 60 passed (60)", including every L-0085 P0-09 check.
- The full suite, typecheck and the log check were re-run after these entries were written; the counts are in the commit message.
**Rules touched:** H-01, H-20, H-23, H-25
**Next / needs:** Re-verification of P0-09 (§7), or MJ sets stopping criteria.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — not applicable, no database writes
[x] Audit trigger present; hash chain verifies (H-17) — unchanged
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0090 · 2026-10-27 10:20 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · BLOCKER
**Task:** P0-09    **Claim:** C-001
**What / why:** Two L-0085 observations are MJ's decisions.
- **O3 (B-23):** the approved vault exemption (B-21) also covers `apps/web/public/vault/`, which the web app serves to anyone without signing in. Proposed change: the exemption does not apply under a `public/` directory. Recommendation: approve; it only narrows B-21.
- **O4 (B-24):** a secret hidden in a UTF-32 file passes; Appendix C promises UTF-16 only. Proposed change: also decode files with a UTF-32 byte-order mark. Recommendation: approve.
**Evidence:** `supabase/tests/reverify9-attacks.test.ts` OBSERVATION test.
**Rules touched:** H-01, H-20, H-22
**Next / needs:** MJ: approve or refuse B-23 and B-24.

### L-0091 · 2026-10-27 19:55 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DECISION
**Task:** P0-09 (B-23, B-24)    **Claim:** C-001
**What / why:** MJ approved: "Approved: B-23 (the vault exemption does not apply under any public/ directory) and B-24 (also decode added files with a UTF-32 byte-order mark when scanning for secrets)." B-23 and B-24 are resolved.
**Rules touched:** H-01, H-20, H-22
**Next / needs:** L-0092, L-0093.

### L-0092 · 2026-10-27 20:00 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DEVIATION
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Appendix C rule 5 updated to match the script under L-0091 (H-25): the vault exemption for supplier wording does not apply under any `public/` directory; files that start with a UTF-32 byte-order mark are also decoded as UTF-32 and scanned in full.
**Rules touched:** H-25, H-26
**Next / needs:** —

### L-0093 · 2026-10-27 20:05 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Implements B-23 and B-24 (L-0091) in `scripts/activity-log-check.mjs`, exactly as proposed in L-0090.
- **B-23:** a path with a `vault/` segment is exempt from the supplier-wording rule only if it has no `public/` segment, because the web app serves `public/` without sign-in.
- **B-24:** a file starting with a UTF-32 byte-order mark (either byte order) is decoded as UTF-32 and scanned with the hard patterns, the name heuristic and the owner terms.
- New builder test `supabase/tests/log-check-rulings.test.ts` covers B-21 with B-23 (vault UI passes; two public vault paths are refused) and B-24 (a fake JWT in UTF-32 in each byte order is refused; honest UTF-32 text passes). L-0085 had recorded both refused cases as passing before this change.
**Evidence:**
- `pnpm vitest run … log-check-rulings reverify9` gave "Tests 10 passed (10)".
- The full suite, typecheck and the log check were re-run after these entries were written; the counts are in the commit message.
**Rules touched:** H-01, H-20, H-23, H-25
**Next / needs:** Re-verification of P0-02 and P0-09 (§7), or MJ sets stopping criteria for P0-09.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — not applicable
[x] Audit trigger present; hash chain verifies (H-17) — unchanged
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16) — both changes only tighten the check
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0094 · 2026-10-28 09:20 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P0-02, P0-09    **Claim:** C-001
**What / why:** MJ ran a codebase council audit (11 domain auditors, one refuting verifier per finding, one synthesis; read-only, nothing in the repo changed): 89 findings raised, 77 survived verification, 3 major, none critical. The report is outside the repo. MJ asked for the top three fixes: "Yes, fix the top three audit findings: the service-role CI scan, rule 4 for entries that move a task to VERIFIED, and the duplicate-header drop in the Excel dry-run."
**Evidence:** Workflow run wf_264edd6a-183: 101 agents, 0 errors; scores 3 for database-design, security-fundamentals, testing-strategy and domain-modeling, 2 for the other seven; observability absent.
**Rules touched:** H-18, §7, H-03
**Next / needs:** L-0095 to L-0098.

### L-0095 · 2026-10-28 09:25 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DEVIATION
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Appendix C rule 4 updated to match the script (H-25): a §12 board row that moves to VERIFIED must cite the verifying entry, and that entry is held to rule 4 whatever its type. The CI paragraph now names the service-role scan. The dry-run runbook lists a repeated column heading as an error.
**Rules touched:** H-25, H-26
**Next / needs:** —

### L-0096 · 2026-10-28 09:30 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-09 (CI service-role scan, H-18)    **Claim:** C-001
**What / why:** Council finding 1: the CI grep for the service-role key dropped every line containing "server-only", never looked at `apps/web/proxy.ts`, `apps/web/next.config.ts` or `packages/`, hid read errors, and did not match secret-key names.
- New `scripts/service-role-scan.mjs` (also `pnpm service-role:scan`): key NAMES anywhere in `apps/` and `packages/` source fail; in the built client bundle (library code there mentions the names in its own comments) key VALUES fail: an sb_secret key, a JWT whose payload role is service_role, or the literal value of the key if it is set in the environment. An unreadable path, or nothing scanned, fails.
- CI typecheck job now builds the web app with placeholder public settings and scans the source and `apps/web/.next/static`. The job name is unchanged, so the required check name stays the same.
**Evidence:**
- New `supabase/tests/service-role-scan.test.ts`: "Tests 4 passed (4)": clean source passes; key names in a server-only line, `proxy.ts`, `next.config.ts` and `packages/` fail; a missing root fails; library comments and an anon JWT in the bundle pass; a service-role JWT, an sb_secret value and the configured key value fail.
- Local: `pnpm -C apps/web build` with placeholders in about 44 seconds, then `node scripts/service-role-scan.mjs --bundle apps/web/.next/static` gave "service-role scan OK: 46 files".
**Rules touched:** H-18, H-20, H-23
**Next / needs:** CI result on push.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — not applicable
[x] Audit trigger present; hash chain verifies (H-17) — unchanged
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16) — all three changes tighten a check
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0097 · 2026-10-28 09:35 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Council finding 2: rule 4 (maker differs from checker, checklist, named task) ran only on entries typed VERIFIED, but every verifier so far recorded its verdict as a CORRECTION entry, so none of the three board moves to VERIFIED was ever checked. `scripts/activity-log-check.mjs` now compares the §12 board with the base: a row that becomes VERIFIED must read "VERIFIED (L-nnnn)", and that entry must exist, be a VERIFIED or CORRECTION entry, name the task on its Task line, carry the security checklist, and not share a signature with any DONE entry for the task.
**Evidence:**
- `supabase/tests/log-check-rulings.test.ts` gained two tests ("Tests 4 passed (4)" for the file): an independent VERIFIED or CORRECTION verdict passes; no cited entry, citing the builder's own DONE (L-0084), a verdict signed by the builder session, or a missing entry each fail.
- `node scripts/activity-log-check.mjs main` OK: the three existing moves (P0-06 and P0-08 citing L-0030, P1-01 citing L-0061) satisfy the rule.
**Rules touched:** §7, H-12, H-23, H-25
**Next / needs:** —

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — not applicable
[x] Audit trigger present; hash chain verifies (H-17) — unchanged
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16) — all three changes tighten a check
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0098 · 2026-10-28 09:40 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-02 (dry-run tool)    **Claim:** C-001
**What / why:** Council finding 8: when two columns had the same heading, the mapping claimed one and the other was dropped unchecked (its phones left out of the CTL-18 duplicate check) while the run still said CLEAN. A repeated heading (case, spacing and punctuation ignored) is now a file problem naming the columns by letter; the heading text is printed only when it is heading vocabulary.
**Evidence:** `pnpm -C packages/import test` gave "Tests 28 passed (28)", including the new test.
**Rules touched:** H-03, H-23
**Next / needs:** —

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — not applicable
[x] Audit trigger present; hash chain verifies (H-17) — unchanged
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16) — all three changes tighten a check
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0099 · 2026-10-28 13:20 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P0-04 (staging web hosting)    **Claim:** C-001
**What / why:** MJ asked for a deployable staging web app. Railway was considered and approved for staging, then MJ withdrew it ("coudnt login to railway please use vercel"), so D-05 (Vercel) stands unchanged and no DECISION is logged. Nothing was created or deleted on Railway.
- Vercel team "laviezahgmailcom's projects", project `kiran-dms`: linked to `ethancrystal/kiran-dms`, root `apps/web`, Next.js, Node 22, Vercel Authentication on every deployment. Production builds of `main` are Ready.
- The Supabase integration had added ten server secrets to the project (the service-role and secret keys, the JWT secret, and the Postgres URLs, user and password). That breaks H-18, and MJ deleted all ten. Six public variables remain (the Supabase URL and the anon and publishable keys), set for Production only.
- My mistake, recorded per H-24: on MJ's second project `kiran-dms-tbbh`, a deployment I created through the API went to production instead of preview, with a build that did nothing (no install, no next build), so its production alias pointed at an empty site. The rollback was blocked by this session's permission check, and I asked MJ to roll it back; MJ then deleted a project. No data or secret was involved.
- I could not read or set environment values myself: reading the local env file to upload it, revealing a value (Vercel requires a passkey) and deleting a variable were each refused by the session's permission check, so MJ made those changes.
**Evidence:** Vercel API on `kiran-dms` lists exactly six environment keys, ssoProtection deploymentType all, link ethancrystal/kiran-dms, latest deployments READY on main.
**Rules touched:** H-18, H-19, H-24, D-05
**Next / needs:** MJ: B-25. Previews of `feat/p0-foundation` need the six public variables enabled for Preview. Login on any deployment still needs Gate 0 action 1 (expose `app` and `vault_api` on staging).

### L-0100 · 2026-10-28 13:25 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · BLOCKER
**Task:** P0-04    **Claim:** C-001
**What / why:** B-25: which Supabase project did the Vercel Supabase integration connect, and should its secrets be rotated? The ten deleted variables held server secrets that were stored in Vercel for a while. If they belong to the staging project `iurvazdyxzlspegygldo`, the service-role and secret keys and the database password should be rotated in Supabase. If the integration created a new Supabase project, that project is empty (no migrations were applied there) and the app must point at staging instead.
**Evidence:** The variable rows carry the Supabase integration mark; the project's Storage tab lists no connected database; revealing a value needs MJ's passkey.
**Rules touched:** H-18, H-20
**Next / needs:** MJ: confirm the integration's Supabase project; rotate if it is staging.

### L-0101 · 2026-10-28 13:30 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DECISION
**Task:** P0-05 (rep sign-in, SEC-03)    **Claim:** C-001
**What / why:** MJ asked "Why are we using number sigin? Is it necessary" and, offered the options, chose "Email code (Recommended)": reps sign in with their email and a 6-digit code sent by email, with no SMS provider; device binding stays exactly as is; phone sign-in can be added back later. This changes doc 06 section 3 (rep primary factor) and SEC-03, so it is logged here under H-26. Office sign-in (email, password, TOTP) is unchanged.
**Rules touched:** H-26, H-15, SEC-03
**Next / needs:** L-0102, L-0103.

### L-0102 · 2026-10-28 13:35 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DEVIATION
**Task:** P0-05    **Claim:** C-001
**What / why:** Docs updated to match L-0101 (H-25): SEC-03 in doc 03; the auth row in doc 05; the rep column of doc 06 section 3 (primary factor, lockout wording, company mailboxes instead of company SIMs); doc 08 device step; the owner-bootstrap runbook (the Magic Link email template must contain the code token, own SMTP before the pilot; the SMS provider is no longer needed for sign-in); the Gate 0 checklist action 2; `supabase/config.toml` comment; the repo map in CLAUDE.md and AGENTS.md. Phone OTPs for salons (CTL-09, CTL-18) are untouched.
**Rules touched:** H-25, H-26
**Next / needs:** —

### L-0103 · 2026-10-28 13:40 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-05 (rep sign-in)    **Claim:** C-001
**What / why:** `apps/web/app/app/login/page.tsx` now asks for an email, sends a one-time code with shouldCreateUser false (the owner still creates every account, H-15), and verifies the 6-digit code as an email OTP. A "use a different email" button and its style were added. Nothing else changes: the device gate, approval flow and session handling are the same.
**Evidence:**
- `pnpm -C apps/web typecheck` clean; `pnpm -C apps/web build` with placeholder public settings compiled, with the static page at the rep login route.
- `node scripts/service-role-scan.mjs --bundle apps/web/.next/static` OK (46 files).
- No automated test covers this page (apps/web has no tests yet, a known audit gap); verified by build only. The full suite and the log check were re-run after these entries were written; counts in the commit message.
- For the live app MJ must add the code token to the Supabase Magic Link email template (owner-bootstrap step 4); otherwise the email carries only a link.
**Rules touched:** SEC-03, H-15, H-23, H-25
**Next / needs:** MJ: the email template change; Gate 0 actions 1 to 3; rep accounts are created by the owner once signed in.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — not applicable
[x] Audit trigger present; hash chain verifies (H-17) — unchanged
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) — sign-in still cannot create accounts
[x] No control weakened, skipped or "temporarily" disabled (H-16) — device binding unchanged; the primary factor changes by MJ decision (L-0101)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0104 · 2026-10-28 14:05 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P0-02, P0-04, P0-09    **Claim:** C-001
**What / why:** MJ merged PR 2 and asked me to continue with the plan. Re-read the board: Gate 0 is NOT PASSED, so no Phase 1 work. Agent-side Phase 0 work left: the remaining top-ten council findings (3, 7, 9, 10 now; 4 to 6 touch verified tasks, see L-0108), a doc and code divergence (`packages/shared` listed as existing), and the Gate 0 checklist. P0-03 (territories) and P0-07 (vendors) wait on MJ; adapter stubs are not built because nothing calls them yet (H-22).
**Evidence:** Vercel production of `kiran-dms` now runs merge commit 8f789cd (build log shows the rep login route compiled), so the email sign-in is live behind the Vercel login. The PR 2 preview check failed only because the commits' git author is not a member of the Vercel team.
**Rules touched:** §8, H-22
**Next / needs:** L-0105 to L-0109.

### L-0105 · 2026-10-28 14:10 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Council findings 3 and 7 in `scripts/activity-log-check.mjs`.
- **Finding 3:** every commit in the range is now scanned, not only the net diff: a secret pattern or an owner term added in any commit fails (git history keeps it even if a later commit removes it), and so does an env file added in any commit. The structural rules and the supplier and name heuristics stay on the net diff, so a fixed false positive in an earlier commit cannot block a PR forever.
- **Finding 7 (minimum):** the OK output adds a line with the number of owner terms checked, and says plainly when the secret list is empty. Failing closed on an empty list would make every PR red until B-15a, so it is raised as B-26 instead.
**Evidence:**
- `supabase/tests/log-check-rulings.test.ts` gained the history tests ("Tests 6 passed (6)" for the file): a fake JWT added then removed, and an env file added then removed, both fail; an honest file added then removed passes.
- `node scripts/activity-log-check.mjs main` (full branch history since the old main) OK: no secret was ever committed.
- The full suite was re-run after these entries; counts in the commit message.
**Rules touched:** H-01, H-20, H-23, H-25
**Next / needs:** Re-verification of P0-09 (§7).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — not applicable
[x] Audit trigger present; hash chain verifies (H-17) — unchanged
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16) — each change tightens a check
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0106 · 2026-10-28 14:15 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-02 (dry-run tool)    **Claim:** C-001
**What / why:** Council findings 9 and 10 in `packages/import`.
- **Finding 9:** a CSV quote mark opened and never closed now refuses the file, naming the line, instead of swallowing every later row into one cell and still reporting CLEAN.
- **Finding 10:** a type label naming both ladies and gents is unisex (it was mens_salon, which would mean a lower starting credit limit); only "hair studio" maps to hair_studio, so another studio (a nail studio) is not recognised and gets a warning.
- Runbook updated to match.
**Evidence:** `pnpm -C packages/import test` gave "Tests 29 passed (29)", including new cases; the command line on an unterminated-quote file exits 2 with the line number.
**Rules touched:** H-23, H-25
**Next / needs:** Re-verification of P0-02 (§7).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — not applicable
[x] Audit trigger present; hash chain verifies (H-17) — unchanged
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16) — each change tightens a check
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0107 · 2026-10-28 14:20 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DEVIATION
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Docs updated to match code (H-25).
- Appendix C rule 5: the secret patterns, owner terms and the env-file rule apply to every commit in the range; the other heuristics to the net diff. The OK output reports the owner-term count.
- CLAUDE.md and AGENTS.md listed `packages/shared/` as an existing directory; it was never built (council finding). Both now mark it as planned for P1-02 and list `packages/import/`.
- Dry-run runbook (L-0106) and Gate 0 checklist (criterion 1: staging web app live on Vercel; tasks line refreshed).
**Rules touched:** H-25, H-26
**Next / needs:** —

### L-0108 · 2026-10-28 14:25 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · BLOCKER
**Task:** P0-06, P1-01, P0-09    **Claim:** C-001
**What / why:** B-26. Council findings 4 to 6 touch tasks that are VERIFIED, and finding 7 in full would turn CI red; both need MJ.
- **Finding 4:** the RLS matrix and schema-hygiene guards cannot see views, or tables in the exposed schemas other than public. Fixing it changes P0-06's verified harness.
- **Finding 5:** "a revoked device stays revoked" is enforced only inside two functions. A trigger on `public.device` would enforce it in the schema, but that is a seventh migration on P1-01 (verified), which also needs a staging apply.
- **Finding 6:** the audit-trigger guard checks only that a trigger named audit_row exists, not that it is enabled and fires on every operation. P0-06 harness again.
- **Finding 7 in full:** fail the log check when the owner-term list is empty in CI. Do this right after B-15a (the secret) exists, or it blocks every PR.
Recommendation: approve reopening P0-06 and P1-01 for findings 4 to 6, with one new migration applied to staging, followed by a fresh verification; approve finding 7 for right after B-15a.
**Evidence:** Council report (L-0094); `supabase/tests/rls-matrix.test.ts`, `supabase/tests/schema-hygiene.test.ts`, `supabase/migrations/20261024223304_foundation.sql` (device table).
**Rules touched:** §7, H-13, H-16, H-17
**Next / needs:** MJ: approve or refuse B-26.

### L-0109 · 2026-10-28 14:30 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · HANDOFF
**Task:** P0-02, P0-04, P0-05, P0-09    **Claim:** C-001
**What / why:** State at the end of this chunk.
- **Merged to main:** PR 1 (foundation, protocol, P1-01) and PR 2 (council top three, rep sign-in by email code). This chunk is on `feat/p0-foundation` for PR 3.
- **Staging:** Supabase `iurvazdyxzlspegygldo` has migrations 0001 to 0006. Vercel project `kiran-dms` deploys `main` behind the Vercel login, with six public Supabase variables (Production only).
- **Board:** P0-06, P0-08, P1-01 VERIFIED. P0-09 and the P0-02 tool DONE (self-reported), both waiting for a fresh verifier. P0-04 and P0-05 IN PROGRESS.
- **Waiting on MJ:** Gate 0 actions 1 to 7 (`docs/gate-0-checklist.md`), the Magic Link template change, and blockers B-01 to B-11, B-13, B-14, B-15a, B-16b, B-17, B-19, B-20, B-22, B-25, B-26. Also: the Vercel preview deployments are refused because this machine's git author is not a Vercel team member.
- **Open audit findings:** 59 minor findings and notes are below the line in the council report (outside the repo); the most important are the salon-type and phone-rule copies (fixed by building `packages/shared` in P1-02), concurrent replays returning a raw unique-violation, and the untested platform shims.
- **Gotchas:** re-run the suite after every ACTIVITY.md edit (verifier tests read the log); run `pnpm db:test` in three parts when a session may restart; a new DONE entry for a task that a verifier test assumes has none breaks that test (L-0096 was re-tagged for this reason).
**Evidence:** `git log origin/main` shows the PR 2 merge 8f789cd; board rows as listed.
**Rules touched:** §11
**Next / needs:** MJ decisions above; then round 10 verification of P0-02 and P0-09, or MJ sets stopping criteria.

### L-0110 · 2026-10-28 14:55 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DECISION
**Task:** P0-06, P1-01, P0-09 (B-26)    **Claim:** C-001
**What / why:** MJ approved: "Approved: B-26. Reopen P0-06 and P1-01 for council findings 4 to 6, including migration 0007 applied to staging, then a fresh verification; finding 7 in full right after B-15a." Reopening P1-01 changes its board row, which is the edit anchor of the reverify5 OBSERVATION test; MJ approved updating that anchor only, choosing "Approve anchor update" to the question "May I update just that anchor string to the new P1-01 board text, nothing else, as you approved once before (L-0067)?"
**Rules touched:** §7, H-23, H-26
**Next / needs:** L-0111 to L-0115.

### L-0111 · 2026-10-28 15:00 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P0-06, P1-01    **Claim:** C-001
**What / why:** P0-06 (VERIFIED L-0030) and P1-01 (VERIFIED L-0061) are reopened for council findings 4 to 6 under L-0110. Both board rows now read IN PROGRESS until a fresh verifier signs them off; the new board rule (L-0097) will require that verdict to be cited and independent. In `supabase/tests/reverify5-attacks.test.ts` only the anchor string of the OBSERVATION test changes, to the new P1-01 row text; nothing else in that file changes.
**Evidence:** `git diff` of the reverify5 file is one line.
**Rules touched:** §7, H-23
**Next / needs:** L-0112, L-0113.

### L-0112 · 2026-10-28 15:05 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P1-01 (device binding)    **Claim:** C-001
**What / why:** Council finding 5. Migration 0007 `20261027204046_device_state_guard.sql` adds `control.device_guard`, a BEFORE UPDATE trigger on `public.device`: a revoked row never changes again (status or last-seen), identity columns (id, user id, fingerprint, created at) never change, and status moves only pending to approved, pending to revoked, approved to revoked. It binds every role, the table owner included, so the rule that migration 0004 once broke (L-0035) is now held by the schema, not by two functions.
- Applied to staging under L-0110: Supabase recorded version 20261027204046 (the local file was renamed to match). The staging copy has a shorter header comment; the function, trigger and grant are identical.
**Evidence:**
- New `supabase/tests/device-guard.test.ts` (4 tests, as the table owner): the forward moves pass; every change to a revoked row, identity changes and approved to pending are refused with 42501.
- Earlier verifiers' device suites still pass: foundation, verifier-attacks, reverify, reverify2, reverify3 "Tests 114 passed (114)".
- Staging, read-only: the device table has the triggers audit (AFTER, enabled), device_guard (BEFORE UPDATE, enabled) and device_no_delete. Security advisors: only the two intentional INFO notes (control tables with RLS and no policies).
- The full suite was re-run after these entries; counts in the commit message.
**Rules touched:** H-06, H-07, H-13, H-23
**Next / needs:** Fresh verification of P1-01 (§7).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — matrix now covers views and the exposed schemas
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — new trigger function pins search_path
[x] Audit trigger present; hash chain verifies (H-17) — guard now checks it is enabled and fires on every operation
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16) — every change tightens a guard
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0113 · 2026-10-28 15:10 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-06 (RLS test harness)    **Claim:** C-001
**What / why:** Council findings 4 and 6.
- `rls-matrix.test.ts`: the exact-list coverage now includes views, materialized views and foreign tables, and the API-exposed schemas app and vault_api, so any new relation there must be added to the matrix.
- `schema-hygiene.test.ts`: every view in our five schemas must use security_invoker, and none may be materialized or foreign (they bypass RLS); no schema created by the migration role may exist outside the guarded list (platform schemas excluded by name); the audit-trigger guard now requires an enabled AFTER ROW trigger on insert, update and delete calling control.audit_row, not just a trigger with that name.
- The guards are tested: a planted disabled audit trigger, a planted trigger that skips delete, a planted view without security_invoker, a planted materialized view and a planted schema are each caught, and a planted security_invoker view and table are seen by the coverage query.
**Evidence:** `pnpm vitest run … schema-hygiene rls-matrix device-guard` gave "Test Files 3 passed (3), Tests 296 passed (296)". The schema guard's platform list cannot be checked locally against the Supabase CLI stack; CI on PR 3 will show it.
**Rules touched:** H-13, H-17, H-23
**Next / needs:** Fresh verification of P0-06 (§7).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — matrix now covers views and the exposed schemas
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — new trigger function pins search_path
[x] Audit trigger present; hash chain verifies (H-17) — guard now checks it is enabled and fires on every operation
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16) — every change tightens a guard
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0114 · 2026-10-28 15:15 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DEVIATION
**Task:** P1-01    **Claim:** C-001
**What / why:** Doc 04 device row updated to match migration 0007 (H-25): a revoked device is final and status only moves forward, enforced by a trigger. B-26 is resolved for findings 4 to 6; finding 7 in full stays open until B-15a.
**Rules touched:** H-25
**Next / needs:** —

### L-0115 · 2026-10-28 15:20 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P0-06, P1-01, P0-02, P0-09    **Claim:** C-001
**What / why:** Requesting the fresh verification MJ asked for: P0-06 and P1-01 (reopened), and the self-reported P0-02 tool and P0-09 log check. A different agent will verify; I do not mark anything VERIFIED (§7).
**Evidence:** Board rows as above.
**Rules touched:** §7
**Next / needs:** Independent verifier entry.

### L-0116 · 2026-10-28 16:30 PKT · Claude · Opus 5.5 · re-verifier-10 workflow · branch feat/p0-foundation (K repo) · CORRECTION
**Task:** P0-06, P1-01, P0-02, P0-09    **Claim:** —
**What / why:** Independent §7 re-verification, round 10, requested in L-0115 under MJ's L-0110 decision and the L-0029 ruling. I am a fresh agent recording the verdict of a workflow of independent attackers and refuting verifiers; none of us wrote the builder's entries or code. I re-ran every confirmed finding through the two test files I added (not committed): `supabase/tests/reverify10-attacks.test.ts` and `packages/import/tests/reverify10-import.test.ts`. Their DEFECT CHECKs and FALSE POSITIVE CHECKs fail on purpose (H-23); the controls and observations pass. The schema-hygiene guard queries and the matrix comparison are read from the worktree files at run time, so a builder fix flips those checks green with no edit to my file. I edited no other file and did not touch the board.

Verdicts:
- **P0-06: not VERIFIED** (corrects L-0113). D1 to D3 and FP1 below.
- **P1-01: VERIFIED by this entry** (migration 0007, L-0112, doc 04 per L-0114). Every attack on device_guard by the application roles, and by the table owner without DDL or TRUNCATE, failed (Evidence 6). Two attacks were refuted on review: a direct INSERT of a device that is already approved is possible only for the table owner and is outside 0007's stated scope (status moves), and doc 04's device row lists key fields, not every column (device_guard does not read revoked_at). O1 is evidence for B-17, not a defect. The builder may move the P1-01 row to VERIFIED citing this entry; a control test shows rule 4b accepts that move.
- **P0-02: not VERIFIED** (corrects L-0088 and L-0106). D1 to D4, FP1, O1 below.
- **P0-09: not VERIFIED** (corrects L-0089, L-0093, L-0097 and L-0105). D1 to D8, O1, O2 below.

P0-06 defects (corrects L-0113):
- D1 (H-17; latent). AUDIT_GAPS in `schema-hygiene.test.ts` checks only tgenabled and the tgtype bits. It ignores a WHEN clause (tgqual) and an UPDATE OF column list (tgattr), so an audit trigger that never fires, or fires only when one column changes, passes; L-0112 and L-0113 say the guard checks the trigger "fires on every operation". Repro, rolled back: replace the audit trigger on public.app_config with one declared WHEN (false), or with UPDATE OF note; AUDIT_GAPS returns no rows, and control.audit_event stayed at 40 after updating every app_config row. No real audit trigger has either shape today, so auditing works now. Fix: also require tgqual is null and an empty tgattr, and plant both shapes in the guard test.
- D2 (H-13; harness strength, not a live leak). `rls-matrix.test.ts` says "The persona must see exactly the rows the predicate selects" but compares only count(*). Repro, rolled back: alter device_select so repA's uid is swapped for repB's; the predicate count is 1 and repA's count is 1, so the cell passes, while repA sees 0 of its own rows. reverify3 §7.4 catches this exact mutation for repA, but same-count swaps for other personas and tables (managers or owners at AAL1, repB, app_config rep_visible) have only the count behind them. Fix: compare row identity, not counts.
- D3 (H-13; minor; reachability on hosted Supabase unverified). SCHEMA_GAPS skips graphql_public by name, and graphql_public (exposed in `supabase/config.toml`) is outside SCHEMAS and the matrix coverage, so a migration that puts a table there escapes every guard. The guard also filters on nspowner = current_user, so a schema the migration role creates with AUTHORIZATION service_role escapes it, though L-0113 says "no schema created by the migration role". Repro, rolled back: either plant, then SCHEMA_GAPS returns no rows. The extensions schema is a disclosed exclusion, not a defect.
- FP1 (note; fails closed). VIEW_GAPS accepts only the stored spellings security_invoker=true or =on. Postgres stores 1, yes, t and y as written, so a view declared with them, which does run with invoker rights, is flagged. No migration creates a view today.

P1-01 observation:
- O1 (B-17 evidence; no new power). device_guard is a BEFORE UPDATE row trigger, so the table owner can TRUNCATE public.device and insert a revoked user and fingerprint again as approved; the owner can equally disable the trigger. Every application role gets 42501 on TRUNCATE and on disabling the trigger. The migration 0007 header and doc 04 line 55 say the rule binds table owners, which holds for UPDATE only; MJ may want that wording narrowed when B-17 is answered.

P0-02 defects (corrects L-0088 and L-0106):
- D1 (finding 9 reopened; wrong CLEAN). A quoted field closed by a stray quote on a later line (an inch mark, as in 12" mirror) swallows every row in between into one Notes cell, and text after a closing quote is kept, which RFC 4180 does not allow. Repro: a 6-row CSV whose row 3 Notes opens a quote and whose row 6 has the inch mark reports CLEAN, 3 rows read, exit 0; rows 4 and 5 each had an error, which vanish, and with a bad last row the error is reported at row 4, not row 7. Reachable only from a hand-edited CSV (Excel and Google Sheets double embedded quotes). Fix: refuse any character after a closing quote other than a delimiter or a line break.
- D2 (finding 8 reopened). keyOf turns an invisible format character (U+200B, U+200C, U+00AD) in the middle of a heading into a word break, so a second heading that renders as Phone or Mobile is neither a duplicate nor a phone column: it is ignored ("column D"), its bad number and its repeated phone are never checked, and the run says CLEAN. Repro: headings Salon Name, Area, Phone, and Phone with a zero-width space after Ph. A Cyrillic look-alike letter passes too; that sub-case falls under the known look-alike limit (L-0061, B-22). Fix: strip Cf (and Mn) characters in keyOf after NFKC.
- D3 (H-03, H-25; minor). The CLI prints every skipped hidden sheet's name and, for a `--sheet` that does not exist, every sheet name in the workbook (stderr, exit 2). A ledger with one tab per salon puts salon names on the console; the runbook promises the report never prints salon names and names only the sheet it read. Repro: a workbook with hidden tabs "Test Salon 01 khata" to "Test Salon 03 khata" and a visible List tab. The JSON report is not affected. Fix: print counts, or names only when made of heading words.
- D4 (H-03, H-25; wider than first reported). On a sheet with no header row, any row among the first 20 whose cells match two fields by prefix (a name starting Salon, Parlour or Shop; an area starting Block, Sector or Town) becomes the header: it and every row above it are dropped without a message, the phone column is left unmapped, and a name made only of heading words is printed in the mapping, text and JSON. Repro: rows "Salon Colour, Block 13, 0399-0000001" then two Test Salon rows give CLEAN, 2 rows read, and the mapping name from "Salon Colour". Fix: refuse a header found only by prefix matches unless `--mapping` names it, and say which row was taken as the header.
- FP1 (fails closed). A formula whose saved result is the empty string, such as IF(paid,"",due), is refused as "a formula with no saved result"; recalculating cannot fix it, and dragged-down trailing rows each add errors. exceljs drops an empty cached value, so a fix must read the raw cell. Not checked with a file saved by Excel itself.
- O1 (message only). In a file with CR-only line breaks, the never-closed-quote error always names line 1, because the line counter counts only LF. The file is still refused.

P0-09 defects (corrects L-0089, L-0093, L-0097 and L-0105):
- D1 (rule 4, board move; H-25). The move test is a case-sensitive, start-anchored match for VERIFIED on a Status cell that gets only an ASCII trim. A cell reading `verified`, `**VERIFIED**`, VERIFIED after a zero-width space, a check-mark emoji then VERIFIED, or fullwidth VERIFIED moves the row with no cited verdict (exit 0 each); plain VERIFIED exits 1. Fix: normalise the cell (NFKC, default-ignorable characters, Markdown emphasis, case), or refuse any status outside the §7 vocabulary.
- D2 (rule 4, board move; H-25). boardOf() recognises only a row written as pipe, space, task id, space, pipe at column 0, and reads Status as the third cell from the end. A row indented one space, with no space after the first pipe, with a bold task id, with an extra trailing cell, without the trailing pipe, or with an escaped pipe in the Claimed-by cell each move to VERIFIED with exit 0. Rendering as a table rests on the GFM spec; no renderer was run.
- D3 (rule 4, board move; minor). A duplicate board row overwrites the first in the map, so a first row reading VERIFIED followed by the original row exits 0. Fix: refuse duplicate task ids on the board.
- D4 (rule 4, board move; §7, MJ L-0110 "then a fresh verification"). The cited verdict may predate the task's latest DONE entry: P0-06 moved to VERIFIED (L-0030) and P1-01 to VERIFIED (L-0061), both reopened in L-0111 with newer DONE entries L-0113 and L-0112, exit 0; a builder-signed entry making the same moves also exits 0. Appendix C rule 4 as written has no ordering, so the gap is in spec and code. Fix: the cited entry must be newer than every DONE entry for the task.
- D5 (rule 5; H-25). Both history scans use --no-merges, so a JWT or an env file added only in a merge commit's resolution and removed by a later commit passes (exit 0); the same JWT in an ordinary commit exits 1. Fix: --diff-merges=first-parent (or -m) on both git log calls, and a merge test.
- D6 (rule 5; H-25; minor). The history parser skips every line starting with three plus signs and a space and keeps no header state, so an added content line starting "++ " that a later commit removes is never scanned for secrets or owner terms; kept, it exits 1 through the net diff.
- D7 (rule 5; H-25; minor). UTF-16 and UTF-32 decoding runs only on net-diff files, so a UTF-16 (BOM or not, either byte order) or UTF-32 file holding a secret in an intermediate commit and deleted later passes. Windows PowerShell 5 redirection writes UTF-16LE.
- D8 (rule 5; H-25; minor). Owner terms in file paths are checked only on the net diff, so a path holding an owner term that is added and later deleted, or renamed away, passes; content lines are still caught per commit.
- O1 (spec gap; minor). A board row may cite a CORRECTION that rejects the task: P0-09 moved to VERIFIED (L-0030), whose text says P0-09 is not VERIFIED, exits 0. The D4 freshness rule would also refuse that citation.
- O2 (duplicate of B-22). Commit messages are never scanned for secret patterns or owner terms, while H-01 names commit messages; already pending with MJ and recorded in reverify8.

Refuted on review (for the record): the P1-01 direct INSERT and doc 04 column-list claims above, and a VERIFIED-looking table placed under §13 (not a §12 board move; rule 1 allows the edit alongside an entry).

**Evidence:** All runs local on embedded Postgres, with `DATABASE_URL` removed from the environment. No staging, production, Supabase project, GitHub or network service was contacted. Spreadsheets and git clones were made in temp directories outside the repository and deleted.
1. `pnpm vitest run --config supabase/tests/vitest.config.ts reverify10`: "Test Files 1 failed (1)", "Tests 12 failed | 4 passed (16)"; the four passing are the database control, both observations and the control citing this entry. Logged values: P0-06 D1 "[] [] 40 40" (WHEN false gaps, UPDATE OF gaps, audit_event before and after); D2 demo want 1, got 1, gotOwn 0; D3 "[] []"; FP1 public.zz_rv10_v flagged for both spellings; P0-09 D1 all five shapes 0, D2 all six shapes 0, D3 0, D4 0 and 0, D5 JWT 0 and env 0, D6 0, D7 0 and 0, D8 0 and 0; P1-01 O1 "revived as approved"; P0-09 O1 exit 0; the control moving P1-01 to VERIFIED (L-0116) exits 0.
2. `pnpm -C packages/import test`: "Test Files 1 failed | 2 passed (3)", "Tests 5 failed | 31 passed (36)". The builder's tests, the reverify9 file, my control and my observation pass; my five checks fail. Logged: D1 a2 CLEAN with 3 rows read, the bad-last-row variant reports row 4; D2 clean true for all three headings; D3 first stdout line names the three khata tabs, and the missing-sheet error lists all four tabs; D4 CLEAN, 2 rows read, name mapped from "Salon Colour"; FP1 an opening_balance error on row 2; O1 "a quoted field opened on line 1 is never closed".
3. Full database suite in four parts with this entry in place: (a) foundation rls-matrix schema-hygiene verifier-attacks reverify-attacks reverify2 reverify3 device-guard: "Test Files 8 passed (8)", "Tests 410 passed (410)". (b) reverify4 reverify5 reverify6: "Test Files 3 passed (3)", "Tests 35 passed (35)". (c) reverify7 reverify8: "Test Files 2 passed (2)", "Tests 17 passed (17)". (d) reverify9 log-check-rulings service-role-scan reverify10: "Test Files 1 failed | 3 passed (4)", "Tests 12 failed | 22 passed (34)". In all, 17 files and 496 tests: 484 passed, 12 failed. The only failures are my twelve checks.
4. `pnpm typecheck`: exit 0 (supabase tests, packages/import, apps/web).
5. `node scripts/activity-log-check.mjs 7b3591e` on this entry: "activity-log-check OK (1 new log entry, 3 changed files)." and "owner terms checked: 0" (the owner-term list is empty locally). I re-ran it, part (d) and my file alone after writing these counts into this entry, with the same results.
6. Claims that held, measured by the workflow's attackers and refuters and accepted here on their recorded output: device_guard refuses a revoked row inserted directly then updated, a CTE-wrapped approved-to-pending update and an upsert onto a revoked row; for service_role, anon, repA and the manager, session_replication_role replica, disabling device_guard and TRUNCATE all give 42501; every legitimate register, approve, revoke and suspend path still works under the trigger. AUDIT_GAPS catches ENABLE REPLICA and a statement-level audit trigger; VIEW_GAPS flags every insecure option. The import holds for findings 8 to 10 on exact and NFKC-equivalent repeats, never-closed quotes and the type labels; the log check refuses uncited and PLAN-row moves, honest independent verdicts pass, and the history pass catches add-then-remove, rename-then-delete, binary and owner-term lines; `node scripts/activity-log-check.mjs main HEAD` exits 0 on the real history.
7. Not tested: the staging copy of migration 0007; platform schema ownership and session_replication_role on hosted Supabase; GitHub's own rendering of the reshaped board rows; a workbook saved by Excel; CI's range on GitHub; the real owner-term secret. One earlier whole-suite run by an attacker stalled for about 90 minutes, which is why the suite is run in parts.
8. `git status --short`: M docs/ACTIVITY.md, ?? packages/import/tests/reverify10-import.test.ts, ?? supabase/tests/reverify10-attacks.test.ts; no zz-probe file is left in supabase/tests.
**Rules touched:** H-01, H-03, H-13, H-16, H-17, H-20, H-23, H-24, H-25; §7; Appendix C
**Next / needs:**
- Builder, P0-06: fix D1 to D3 and FP1; then a different agent re-verifies.
- Builder, P1-01: move the board row to VERIFIED citing this entry, with its own log entry.
- Builder, P0-02: fix D1 to D4 and FP1 (O1 optional) and update the runbook for D3 and D4; then a different agent re-verifies.
- Builder, P0-09: fix D1 to D8 and update Appendix C (D4 and O1 need a spec change); then a different agent re-verifies.
- MJ: P1-01 O1 belongs with B-17; P0-09 O2 is B-22.

Security checklist (tick honestly):
[ ] RLS enabled+forced; policies + role×table tests added/updated (H-13) — policies hold, but the matrix and schema guard prove less than claimed (P0-06 D2, D3)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — unchanged; the secdef search_path guard passes
[ ] Audit trigger present; hash chain verifies (H-17) — present and firing today, but the guard does not check that it fires on every operation (P0-06 D1)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20) — none in the builder's diff or mine (fake values assembled at run time); but P0-02 D3 and D4 can print salon names
[x] Governance powers still owner-only + AAL2 (H-15)
[ ] No control weakened, skipped or "temporarily" disabled (H-16) — P0-09 D1 to D8 let a board move or a removed secret past the tripwire; P0-02 D1 and D2 reopen findings 9 and 8
[ ] Docs match code; deviations logged (H-25) — P0-02 D3, D4; P0-09 D1, D2, D5 to D8
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0117 · 2026-10-28 19:25 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P0-06, P1-01, P0-02, P0-09    **Claim:** C-001
**What / why:** Accepting L-0116 (round 10, a workflow of fresh agents: three attackers, refuting verifiers, one writer). I committed its entry and its two test files unedited (commit 99fd726). P1-01 is VERIFIED by L-0116. P0-06, P0-02 and P0-09 stay open for its findings: P0-06 D1 to D3 and FP1; P0-02 D1 to D4, FP1 and O1; P0-09 D1 to D8. P0-09 O1 and O2 are MJ's decisions (L-0124, B-22).
**Evidence:** L-0116 recorded "12 failed | 22 passed (34)" for its database part and "5 failed | 31 passed (36)" for packages/import, every failure one of its checks; CI on 99fd726 failed the same way.
**Rules touched:** §7, H-23
**Next / needs:** L-0118 to L-0124.

### L-0118 · 2026-10-28 19:30 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DECISION
**Task:** P1-01    **Claim:** C-001
**What / why:** MJ approved, choosing "Approve both" to the question "Round 10 verified P1-01 (L-0116). Setting its board row to VERIFIED (L-0116) breaks the reverify5 OBSERVATION test's anchor again. May I update that one anchor string to the new row text (only that line), and set the P1-01 row to VERIFIED (L-0116)?". Done in this change: the P1-01 row reads VERIFIED (L-0116), and only the anchor string of that reverify5 test changes.
**Rules touched:** §7, H-23
**Next / needs:** —

### L-0119 · 2026-10-28 19:35 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-06 (RLS test harness)    **Claim:** C-001
**What / why:** Fixes L-0116 P0-06 findings in `supabase/tests/schema-hygiene.test.ts` and `supabase/tests/rls-matrix.test.ts` (made by a fix-workflow agent, reviewed by a separate agent, integrated by me).
- **D1:** the audit-trigger guard also requires no WHEN qualifier and no UPDATE OF column list.
- **D2:** each RLS matrix SELECT cell now compares the sorted whole-row text a role sees with what the expected predicate selects, not the row count. A planted policy that shows the right number of wrong rows is caught.
- **D3:** the schema guard covers every schema whose owner the migration role is a member of (so a schema created with another role as owner is covered), and graphql_public is refused if it holds any table, view or sequence (functions stay allowed there, as the platform keeps its graphql function in it).
- **FP1:** a view passes the security_invoker check when Postgres itself reads the stored value as true (on, 1, yes and so on), and fails otherwise.
- Planted-violation tests added for D1 and D3 and every spelling.
**Evidence:** the fix agent ran "reverify10 schema-hygiene rls-matrix device-guard foundation: Test Files 5 passed (5), Tests 356 passed (356)"; the reviewer re-ran and found nothing loosened beyond FP1. The schema guard has not been run on the CI Supabase stack yet; CI on this push will show it. My own full-suite counts are in the commit message.
**Rules touched:** H-13, H-17, H-23
**Next / needs:** Re-verification of P0-06.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — matrix now compares row identity, not counts
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — no schema change
[x] Audit trigger present; hash chain verifies (H-17) — guard now also refuses WHEN clauses and column lists
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16) — two documented false-positive corrections only (security_invoker spellings; empty-string formula results)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0120 · 2026-10-28 19:40 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-02 (dry-run tool)    **Claim:** C-001
**What / why:** Fixes L-0116 P0-02 findings in `packages/import` (fix-workflow agent, separately reviewed).
- **D1:** a closing quote followed by anything other than a delimiter or a line break refuses the file, naming the lines.
- **D2:** headings are compared after removing invisible format characters and combining marks, so an invisible character cannot hide a second phone column. The same comparison now applies to area names in the duplicate and area-list warnings, so two areas differing only by an invisible character are treated as the same (warning level only).
- **D3:** sheet names are printed only when made of common tab words; otherwise by position, including the hidden sheets skipped and the wrong-sheet error.
- **D4:** a row matched only by heading prefixes never beats a row of plain headings, and is refused as the header unless a mapping confirms it.
- **FP1:** a formula whose saved result is the empty string reads as an empty cell, found by a small reader of the file's own sheet XML (new `src/xlsx-raw.ts`, no new dependency).
- **O1:** line numbers count CR-only line breaks.
- Runbook updated.
**Evidence:** the fix agent ran "pnpm -C packages/import test: Test Files 3 passed (3), Tests 50 passed (50)" and typecheck exit 0; the reviewer re-ran them. My counts are in the commit message.
**Rules touched:** H-03, H-23, H-25
**Next / needs:** Re-verification of P0-02.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — matrix now compares row identity, not counts
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — no schema change
[x] Audit trigger present; hash chain verifies (H-17) — guard now also refuses WHEN clauses and column lists
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16) — two documented false-positive corrections only (security_invoker spellings; empty-string formula results)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0121 · 2026-10-28 19:45 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Fixes L-0116 P0-09 findings in `scripts/activity-log-check.mjs` (fix-workflow agent, separately reviewed).
- **D1, D2, D3:** the §12 board is parsed the way GitHub renders tables (indented rows, missing outer pipes, escaped pipes, the Status column found by its header); a changed Status cell must be plain text, and any mention of verified in any spelling must be exactly the canonical citation form, except a reopen note of the form "was VERIFIED L-nnnn"; a task with more than one board row is refused.
- **D4:** the cited verdict must come after the task's latest DONE entry.
- **D5, D6:** the history pass reads merge commits as combined diffs, and only real file headers are skipped.
- **D7, D8:** every file version added or changed by any commit in the range gets the UTF-16 and UTF-32 decodings scanned, and its path checked for owner terms.
- Builder tests for each fix added to `supabase/tests/log-check-rulings.test.ts`.
- The reopen-note allowance is a builder choice that narrows the literal D1 wording; it accepts nothing the old code refused.
**Evidence:** the fix agent ran "log-check-rulings: Tests 18 passed (18)" and "reverify10: Tests 16 passed (16)"; the reviewer re-ran them. My counts are in the commit message.
**Rules touched:** H-01, H-20, H-23, H-25
**Next / needs:** Re-verification of P0-09.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — matrix now compares row identity, not counts
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — no schema change
[x] Audit trigger present; hash chain verifies (H-17) — guard now also refuses WHEN clauses and column lists
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16) — two documented false-positive corrections only (security_invoker spellings; empty-string formula results)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0122 · 2026-10-28 19:50 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DEVIATION
**Task:** P0-09 (ACTIVITY Appendix C)    **Claim:** C-001
**What / why:** Appendix C rules 4 and 5 updated to match L-0121, the verification list gains L-0116, and the dry-run runbook matches L-0120 (H-25).
**Rules touched:** H-25, H-26
**Next / needs:** —

### L-0123 · 2026-10-28 19:55 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · PROGRESS
**Task:** P1-01    **Claim:** C-001
**What / why:** Under L-0118, the P1-01 board row moves to VERIFIED (L-0116). The log check's board rule accepts it: L-0116 names P1-01, carries the checklist, is signed by the re-verifier-10 workflow (not the builder session), and comes after P1-01's latest DONE (L-0112).
**Evidence:** `node scripts/activity-log-check.mjs origin/main` OK with this change.
**Rules touched:** §7
**Next / needs:** —

### L-0124 · 2026-10-28 20:00 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · BLOCKER
**Task:** P0-09    **Claim:** C-001
**What / why:** B-27 (L-0116 P0-09 O1): a board row may cite a CORRECTION entry, and the check does not read whether that entry verified the task or rejected it. A recent CORRECTION that rejects a task could be cited as its verification. Options: (a) require the cited entry to state the verdict for each task in a fixed, checkable form, such as a line "P1-01: VERIFIED"; (b) allow only VERIFIED-type entries to be cited, so a verifier verifying one task and correcting another writes two entries. Recommendation: (a), because it keeps one verification entry per round.
**Evidence:** `supabase/tests/reverify10-attacks.test.ts` O1 case.
**Rules touched:** §7
**Next / needs:** MJ: choose (a) or (b), or leave as is.

### L-0125 · 2026-10-28 21:10 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DECISION
**Task:** P0-06 (H-23 test change)    **Claim:** C-001
**What / why:** CI on 2a4da30 failed three tests on the Supabase CLI stack. Two are builder tests (L-0126). The third is round 10's "DEFECT CHECK (H-13): a table in graphql_public..." in `supabase/tests/reverify10-attacks.test.ts`: there the migration role has no CREATE right on graphql_public, so planting a table errors with "permission denied" before anything is checked, whatever the code does. MJ approved, choosing "Approve the change" to the question "May I change that one verifier test so that, where the migration role has no CREATE right on graphql_public, it asserts that refusal instead (as my own test now does), leaving the rest of the test unchanged?". Done: that case checks the privilege first; where it is missing, it asserts the refusal (42501). The other-owner case and the rest of the file are unchanged, apart from importing sqlstate.
**Rules touched:** H-23
**Next / needs:** L-0126.

### L-0126 · 2026-10-28 21:15 PKT · Claude · Opus 5.5 · session ee095e06 · branch feat/p0-foundation (K repo) · DONE
**Task:** P0-06, P0-09    **Claim:** C-001
**What / why:** The two builder tests that failed only on CI.
- `schema-hygiene.test.ts` (P0-06): the graphql_public planted cases run only where the migration role can create objects in that schema (the local embedded Postgres runs as superuser). On the Supabase stack, where it cannot, the test asserts the refusal, which is what stops a migration putting a relation there.
- `log-check-rulings.test.ts` (P0-09): the merge-history test asked git for the current branch name, which in CI's detached checkout is the literal HEAD, so it never left the side branch and the merge had nothing to commit. It now names its case branch first.
- No change to the checker or the guards themselves.
**Evidence:** CI run on 2a4da30: "Tests 3 failed, 509 passed (512)", with "permission denied for schema graphql_public" and "git commit -q -m merge side" as the causes. Locally after the fix: "schema-hygiene log-check-rulings: Test Files 2 passed (2), Tests 31 passed (31)". The full suite was re-run after these entries; counts in the commit message. CI on this push will confirm the Supabase-stack branch.
**Rules touched:** H-23
**Next / needs:** —

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — no schema change
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — not applicable
[x] Audit trigger present; hash chain verifies (H-17) — unchanged
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16) — on the Supabase stack the graphql_public case now asserts the platform refusal instead of planting
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0127 · 2026-10-28 10:00 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-04-inventory · SESSION-START
**Task:** P1-04 (INV-01 to INV-06, CTL-05) plus the MJ additions in L-0128    **Claim:** C-003 (L-0129)
**What / why:** MJ asked this session to stop verification work and build. Read this file in full on branch feat/p0-foundation at b61494f (rules, board, claims, blockers, assumptions, the last 20 entries, L-0107 to L-0126); this branch starts from that commit. Phase 0 is not complete: P0-01, P0-03, P0-07 and P0-10 are not started and need MJ; P0-02 (real Excel run), P0-04 and P0-05 (B-18 exposed schemas, owner account) wait on human-only steps; P0-06 is reopened by C-001. Phase 1 has only P1-01 built. C-001 (session ee095e06) is active on P0-02, P0-04 to P0-06 and P0-09, not on P1-02 to P1-14, so P1-04 is free to claim; this session adds new migration and test files and touches C-001 files only to add rows (the RLS matrix, H-13). Numbering note: branch claude/architecture-rfc (unmerged) reuses L-0104 to L-0109, B-26 and C-002; this branch follows feat/p0-foundation, so entries start at L-0127 and the claim is C-003. Staging (iurvazdyxzlspegygldo, L-0019) was only read for its migration list (7 applied, the 7th is 0007 from this branch history); nothing is applied there by this session.
**Evidence:** Baseline on claude/p1-04-inventory at b61494f: `pnpm install --frozen-lockfile` OK; `pnpm typecheck` exit 0; `pnpm activity:check` OK; `pnpm db:test` against a fresh local Postgres 16 database (KIRAN_TEST_DATABASE_URL; embedded Postgres cannot initdb as root here): 17 files, 512 tests passed.
**Rules touched:** H-22, H-23, H-24, §2, §3
**Next / needs:** L-0128 (MJ decisions), L-0129 (claim), then docs and migration 0008.

### L-0128 · 2026-10-28 10:00 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-04-inventory · DECISION
**Task:** P1-04, P0-01 (decisions)    **Claim:** C-003
**What / why:** MJ instructions in this session, quoted. "Lets build that include model for independent agents." "Move on from verification to actually building things now." "Check if Phase 0 is fully completed then Phase 1 and onwards." "Is there a way to links tomorrow's route to the stock a rep carries and if we have standalon agents who pay cash to take the supply then dont need to report back can also continue." On lost sales: "Find a way to do this." Answers to this session's five questions: "1 both" (salaried reps and independent agents), "2 10" (about 10 agents in 12 months), "3 yes anyone who want to be" (an agent channel open to anyone, women included), "4 stockout as the supplier sometimes get short of product", "5 yes" (move a thin due-list and route ordering into Phase 1). Recorded as doc 12 D-15 to D-20. Effects: (a) fixed decision 2 (roles at launch) gains an Agent role, under H-26: an independent agent buys stock outright, paid in full by cash or transfer before it leaves the warehouse, at an agent price; title passes at sale, so there is no bag, handover, visit or count reporting for agents; agents see only their own purchases, the catalogue with agent prices and availability, never salons, other agents, cost or supplier. (b) Phase 1 starts before Gate 0 is signed (section 8 exception by MJ); Phase 0 human-only items continue in parallel; section 7 still holds (a builder never marks its own work VERIFIED) and no control is weakened (H-16). (c) Lost demand is recorded (doc 03 DEM-01 to DEM-03). (d) A route-linked bag-load suggestion (INV-11) and a thin due-list (PIP-05, PIP-06 thin) move into Phase 1. (e) Supplier shortage is the main stock-out cause, so supplier fill rate is tracked in the vault (P1-05). Not decided by MJ, recorded as assumptions with the restrictive default: A-06 (Kiran pays agents nothing for recruiting other agents, SECP Companies Act 2017 section 301), A-07 (agent purchases are cash or transfer before release, never credit). Open questions OQ-17 to OQ-20 added for MJ (agent price, channel conflict, allocation when the supplier is short, agent identity data).
**Rules touched:** H-26, H-22, section 8, H-16, H-27
**Next / needs:** MJ: OQ-17 to OQ-20.

### L-0129 · 2026-10-28 10:00 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-04-inventory · CLAIM
**Task:** P1-04 (INV-01 to INV-06, CTL-05; DEM-01 to DEM-03 capture; INV-11 groundwork)    **Claim:** C-003
**What / why:** C-003 added to section 13. Areas: a new migration `supabase/migrations/20261028050000_inventory.sql`; new test file `supabase/tests/inventory.test.ts`; rows added (nothing changed or removed) in `supabase/tests/rls-matrix.test.ts`; docs 03, 04, 08, 10, 11, 12 and this file for the L-0128 decisions. Agent role, orders, route and load-sheet functions are later claims (P1-02, P1-06, new rows P1-15 to P1-17).
**Rules touched:** section 3
**Next / needs:** docs, then migration 0008 and tests.

### L-0130 · 2026-10-28 10:25 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-04-inventory · DECISION
**Task:** P1-04 (H-23 test change)    **Claim:** C-003
**What / why:** Migration 0008 made three verifier-authored tests fail because they freeze the P1-01 surface. MJ was asked: "May I make these three updates, changing nothing else in those tests?" (1: add the new inventory functions to the allowlist of functions authenticated may execute; 2: allow the planned route date and the phone's count and tap times, stored only as evidence in *_client columns; 3: in the table-owner TRUNCATE observation, assert that approval_request can no longer be truncated, because stock_movement.approval_id now references it). MJ chose "Approve all 3 (Recommended)". Done exactly as described: `supabase/tests/verifier-attacks.test.ts` allowlist extended (and `owner_set_bag_limit` replaces `office_set_bag_limit`, L-0131); `supabase/tests/reverify3-attacks.test.ts` client-time list extended, and the TRUNCATE case no longer truncates approval_request and instead asserts 0A000 for it. Nothing else in those files changed.
**Rules touched:** H-23
**Next / needs:** L-0131.

### L-0131 · 2026-10-28 10:25 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-04-inventory · ASSUMPTION
**Task:** P1-04 (CTL-05)    **Claim:** C-003
**What / why:** A-08 added to section 15. The docs do not say who sets a rep bag's value limit. It caps the stock a rep is trusted with, so a colluding manager and rep would need to raise it; the restrictive reading applies (section 1): creating a rep bag and changing its limit are owner-only (`app.office_create_location` refuses kind rep_bag for anyone but the owner; `app.owner_set_bag_limit`). Warehouses and other locations stay office-level.
**Rules touched:** section 1, H-15, H-16
**Next / needs:** MJ may relax it to the manager if preferred.

### L-0132 · 2026-10-28 10:25 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-04-inventory · DEVIATION
**Task:** P1-04 (INV-03, INV-06, CTL-05)    **Claim:** C-003
**What / why:** Parts of the P1-04 requirements depend on modules not built yet, so they are not in migration 0008; docs unchanged because the docs already place them with those modules. (1) INV-03 movements: `receipt` comes with the vault goods receipt (P1-05); `sale` with deliveries (P1-06); `sale_to_agent` with agents (P1-15); `return_in`, `quarantine` and `write_off` with returns and write-off approvals (P2-04, P1-08). The movement kinds and their shape checks exist now. Opening stock and count corrections go in through approved `adjustment` requests. (2) INV-06 low-stock alerts: `app.low_stock()` lists them; pushing them as notifications is MSG-03 (P1-10). (3) CTL-05: the weekly spot check is recordable; the system choosing the day is part of the digest work (P1-08). (4) demand_signal.salon_id has no foreign key until salons exist (P1-02): that migration must add it NOT VALID or accept that older taps may name no real salon.
**Rules touched:** H-25
**Next / needs:** the tasks named above.

### L-0133 · 2026-10-28 10:25 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-04-inventory · DONE
**Task:** P1-04 (INV-01 to INV-06, CTL-05; DEM-01)    **Claim:** C-003
**What / why:** Migration 0008 `supabase/migrations/20261028050000_inventory.sql`. Catalogue (product_group, product, sku; prices owner-only; no cost columns). Locations (warehouse, rep_bag with value limit, quarantine, damaged). Append-only `stock_movement` with positive quantities, a kind-shape check and a trigger that refuses any movement leaving a location below zero for every role. Two-party `stock_issue` (to_rep and to_warehouse): the office proposes, pending units are reserved, the bag value limit is checked at list price, and stock moves only when the receiving rep confirms the same count from the approved device; a different count disputes it and moves nothing. Append-only `stock_count` (rep daily close of their own bag; office spot checks, cycle counts, stock-takes) recording expected, counted and variance without changing stock. Adjustments only through an approved `adjustment` request, used once (unique approval_id), with the doc 13 section 9 owner threshold re-checked at posting (a missing threshold or an unpriced SKU routes to the owner). Manual reorder points and `app.low_stock()`. Rep reads `app.my_bag()` and `app.warehouse_availability()` (quantities only). Lost demand: append-only `demand_signal` and `app.record_demand` (DEM-01): idempotent by client_id, an item Kiran does not carry recorded by product group (no free text, H-27), supply shortages recorded by the office only. Docs 00, 03, 04, 08, 10, 11, 12 updated for D-15 to D-20 (L-0128); board rows P1-15 to P1-17 and assumptions A-06 to A-08 added.
**Evidence:** On claude/p1-04-inventory from b61494f: `pnpm db:test` on a fresh local Postgres 16 database (KIRAN_TEST_DATABASE_URL): 18 files, 897 tests passed (baseline 17 files, 512). New: `supabase/tests/inventory.test.ts` (catalogue and price authority, adjustments single use and owner threshold, issue and confirmation, disputes, bag limit, availability, negative-stock trigger as postgres, append-only for postgres, counts, lost demand replay and privacy, audit chain verifies) and RLS matrix rows for all nine new tables across ten personas. `pnpm typecheck` exit 0. `pnpm activity:check` OK. The migration was also applied by itself to a fresh database (shim plus migrations 0001 to 0008 with psql ON_ERROR_STOP): clean. Not applied to staging. Commit SHA in the commit carrying this entry.
**Rules touched:** H-06, H-07, H-08, H-09, H-13, H-15, H-16, H-17, H-23, H-27
**Next / needs:** a different agent verifies P1-04 (section 7); then P1-02, P1-16, P1-06, P1-15, P1-17 (L-0135).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — nine tables, ten personas each
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) — stock_movement, stock_count, demand_signal also refuse UPDATE, DELETE, TRUNCATE for postgres; master rows never deleted
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — every RPC takes a client_id or a client-chosen id; replays tested
[x] Audit trigger present; hash chain verifies (H-17) — schema-hygiene guard passes; chain verified at the end of the inventory tests
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) — no cost column; the agent price is kept out of sku on purpose
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20) — [Dummy] and [Test] data only; diff read
[x] Governance powers still owner-only + AAL2 (H-15) — prices and rep bag limits owner-only
[x] No control weakened, skipped or "temporarily" disabled (H-16) — three verifier tests changed only as MJ approved (L-0130)
[x] Docs match code; deviations logged (H-25) — L-0132
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0134 · 2026-10-28 10:25 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-04-inventory · CLAIM-RELEASED
**Task:** P1-04    **Claim:** C-003
**What / why:** C-003 released (done): moved to the released table. P1-04 board row set to DONE (self-reported). The next tasks get their own claims.
**Rules touched:** section 3
**Next / needs:** L-0135.

### L-0135 · 2026-10-28 10:25 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-04-inventory · HANDOFF
**Task:** P1-04    **Claim:** — (C-003 released)
**What / why:** State: migration 0008 (inventory and lost-demand capture) and its tests are on branch claude/p1-04-inventory, cut from feat/p0-foundation b61494f; full suite green (897). No pull request yet; not applied to staging. Next steps, in order: (1) a different agent verifies P1-04 (section 7: try to break custody, the negative-stock trigger, adjustment single use and threshold, rep isolation); (2) P1-02 salons and territories (adds the demand_signal.salon_id foreign key, L-0132); (3) P1-16 thin due-list and manual routes (D-19); (4) P1-06 orders, with automatic shortfall capture (DEM-02); (5) P1-15 agents (agent role, agent_price table, cash-and-carry purchase); (6) P1-17 route-linked bag load (INV-11). Gotchas: on this container embedded Postgres cannot initdb as root, so run `pnpm db:test` with KIRAN_TEST_DATABASE_URL on a fresh local database (`service postgresql start`; drop and create kiran_test before each run, because the harness re-applies every migration on a plain Postgres). Every new module trips the verifier allowlist and client-time tests in verifier-attacks and reverify3; each change needs MJ approval (H-23), as L-0130. Branch claude/architecture-rfc still reuses L-0104 to L-0109, B-26 and C-002 and needs renumbering before it merges (MJ asked, no answer yet).
**Evidence:** `pnpm db:test` 18 files, 897 passed; `pnpm typecheck` exit 0; `pnpm activity:check` OK (this session, before commit).
**Rules touched:** section 11, H-23, H-24
**Next / needs:** MJ: OQ-17 to OQ-20; renumbering of claude/architecture-rfc; whether A-08 stays owner-only.

### L-0136 · 2026-10-28 13:14 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/spec · DECISION
**Task:** — (project spec; no requirement IDs)    **Claim:** C-005 (L-0137)
**What / why:** MJ ran the spec protocol ("check current and write new if needed"). Finding: there is no SPEC.md; docs 00 to 13, CLAUDE.md and this file cover objective, commands, structure and boundaries, but there is no code style for TypeScript or React, no lint in CI, and no test of the web app or the offline PWA. MJ's answers, quoted: shape "single" (SPEC.md is a short index; docs 00 to 13 stay the single source of truth, H-25); linter and formatter "yes"; Playwright browser tests for the rep PWA in Phase 1 "yes"; branch "top" (on a branch on top of PR 5); audience "not aai agents but sales agents of my company", read as: the people the system serves are Kiran's sales agents (salaried reps and independent agents, D-15), so the spec's objective is written around them. Biome is the chosen linter and formatter (one tool; this session's recommendation, not objected to). Numbering note: this branch is cut from PR 5's head (claude/p1-04-inventory, 8ba8d6b) like claude/p1-02-salons, which also uses L-0136 to L-0139 and C-004; whichever merges second renumbers its own entries (both are this session's).
**Rules touched:** H-25, H-22
**Next / needs:** L-0137.

### L-0137 · 2026-10-28 13:14 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/spec · CLAIM
**Task:** — (project spec)    **Claim:** C-005
**What / why:** C-005 added to section 13 for `SPEC.md` at the repo root and this file. The Biome setup, the CI lint job and the Playwright harness are later steps under this claim, after MJ confirms the spec.
**Rules touched:** section 3
**Next / needs:** write SPEC.md; MJ confirms it before tooling is added.

### L-0138 · 2026-10-28 13:15 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/spec · PROGRESS
**Task:** — (project spec)    **Claim:** C-005
**What / why:** `SPEC.md` added at the repo root: a short index over docs 00 to 13, CLAUDE.md and this file, in six parts (objective written around Kiran's salaried reps and independent agents; commands; project structure; code style; testing strategy; boundaries). It adds no requirement: where it and a doc disagree, the doc wins (H-25). New commitments, both from MJ in L-0136: Biome as linter and formatter with a CI lint job, and Playwright browser tests for the rep PWA; both marked planned. It also records MJ's standing pre-approval of three kinds of verifier-test change for new modules (given in this session; logged on branch claude/p1-02-salons).
**Evidence:** every relative link in SPEC.md resolves to a file on this branch (checked with a script); `pnpm activity:check` OK. No code changed.
**Rules touched:** H-25
**Next / needs:** MJ confirms SPEC.md; then Biome config, the CI lint job and the Playwright harness under C-005.

### L-0139 · 2026-10-28 13:19 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/spec · PROGRESS
**Task:** — (project spec)    **Claim:** C-005
**What / why:** MJ asked for more work on SPEC.md ("work more on it"). Added five sections, all drawn from the existing docs (no new requirement): 2 where we are (a status snapshot that defers to the board); 3 five sales-agent journeys (rep's day, prospecting, independent agent purchase, manager loading bags, owner's morning), each with acceptance lines tied to requirement IDs; 4 the Phase 1 feature map (feature, requirements, how it is proven, status) and the doc 06 section 10 launch security checklist; 5 field constraints (NFR-01 to 03, 09, 10; 60-second field actions); 11 decisions waiting on MJ. Sections renumbered and internal references updated.
**Evidence:** every relative link resolves (16 checked by script); all 50 requirement IDs cited in SPEC.md exist in doc 03 (checked by script; one wrong citation found and fixed: the handover is PAY-05 and CTL-03, not PAY-10); `pnpm activity:check` OK. No code changed.
**Rules touched:** H-25
**Next / needs:** MJ confirms SPEC.md; then Biome, the CI lint job and the Playwright harness under C-005.

### L-0140 · 2026-10-28 13:24 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/spec · DECISION
**Task:** — (project spec; P1-15 agent scope)    **Claim:** C-005
**What / why:** MJ answered three questions on the independent-agent channel, quoted: success measure "1 monthly sales"; agent purchases in the owner's morning digest "2 yes"; agents reporting back "3 optional pre-order only". Recorded as doc 12 D-21 (the channel is measured by monthly sales through agents, in rupees), D-22 (the digest lists every agent purchase and flags unusually large ones) and D-23 (an optional pre-order request is the only thing an agent sends back). Docs changed to match: doc 01 goals (new row), doc 03 CTL-15 and AGT-04, doc 08 section 10, doc 13 section 8 (new digest item 8, Agents), SPEC.md (objective, J3, J5, section 11). MJ gave no target figure and no "unusually large" threshold, so both are open questions with safe defaults rather than invented values: OQ-21 (target; default none, the figure is reported monthly) and OQ-22 (threshold; default no flag, every agent purchase is listed anyway). No doc 13 section 9 threshold changed (H-26).
**Rules touched:** H-25, H-26
**Next / needs:** MJ: OQ-21, OQ-22; MJ confirms SPEC.md.

### L-0141 · 2026-10-28 14:19 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/spec · PROGRESS
**Task:** — (lint and browser-test tooling, SPEC.md sections 8 and 9)    **Claim:** C-005
**What / why:** MJ confirmed SPEC.md ("Spec is okay proceed"). Added: Biome 2.3.15 (`biome.jsonc`; root scripts `pnpm lint` = `biome ci`, `pnpm format`); Playwright 1.63.0 in apps/web (`playwright.config.ts`, a low-end Android profile at 360 by 640 px, production build with placeholder public settings, no real project contacted) with a first spec `apps/web/e2e/rep-login.spec.ts`; CI jobs `lint` and `e2e`; `.gitignore` entries for Playwright output; SPEC.md, CLAUDE.md and AGENTS.md (kept identical, Appendix A) updated with the new commands and statuses. Legacy files: 30 existing files (C-001's areas, several verifier-authored, H-23) do not yet pass Biome; reformatting them here would change verifier tests and C-001's code, so `biome.jsonc` lists them as legacy (no formatting or import order, two rules warn). Every other file and every new file gets the full checks. Follow-up, not done here: clean up the legacy list with C-001, and MJ's approval for the verifier tests. One real finding left as a warning in legacy files: four buttons in apps/web login and MFA pages have no type attribute (lint/a11y/useButtonType). One permanent exception: noControlCharactersInRegex is off for scripts/activity-log-check.mjs, whose job is to find control characters. Formatting changed only this session's own file `supabase/tests/inventory.test.ts` (layout and import order).
**Evidence:** `pnpm lint` exit 0. `pnpm -C apps/web test:e2e`: 4 passed (sign-in page fits 360 px with Urdu labels; a refused code request shows the alert and stays retryable; 199.9 KB gzipped JavaScript transferred, budget 300 KB, NFR-02; security headers present). The first run failed one test: Next.js adds its own empty role=alert route announcer, so the locator matched two elements; the test now matches the alert by its message (a test fix; the page behaved correctly). `pnpm typecheck` exit 0. `inventory.test.ts` after formatting: 1 file, 25 passed on a fresh local Postgres 16. Full `pnpm db:test` not re-run (no other database file changed). `pnpm activity:check` OK.
**Rules touched:** H-23, H-25, H-18
**Next / needs:** pull request for claude/spec stacked on PR 5; CI confirms the new lint and e2e jobs.

### L-0142 · 2026-10-28 11:43 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-02-salons · PROGRESS
**Task:** P1-04    **Claim:** — (C-003 released)
**What / why:** MJ said "Yes" to opening a pull request for P1-04 and starting P1-02. Pull request https://github.com/ethancrystal/kiran-dms/pull/5 opened from claude/p1-04-inventory into feat/p0-foundation (the branch it was cut from; a pull request into main would carry all of C-001's unmerged work); this session watches its CI and reviews.
**Evidence:** PR 5 created; CI runs on every pull request (ci.yml `on: pull_request`).
**Rules touched:** section 11
**Next / needs:** CI result on PR 5; L-0143.

### L-0143 · 2026-10-28 11:43 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-02-salons · CLAIM
**Task:** P1-02 (part a: SAL-01 to SAL-03, SAL-09; PIP-01; CTL-18 duplicate-phone flag; MAP-03 notes)    **Claim:** C-004
**What / why:** P1-02 is split into four parts so each is a reviewable pull request (DEVIATION in the DONE entry): (a) territories, areas, rep territories, salons, contacts with masked phones and logged reveals, append-only notes, stage machine with stage_event as the truth, duplicate-phone flag, demand_signal.salon_id foreign key; (b) visits and rep check-in (PIP-02, PIP-09); (c) verification and contact-change OTPs (CTL-09, CTL-18), which need the SMS adapter; (d) the Excel import write path (SAL-10), credit profile (SAL-04) and timeline (SAL-05), which need orders and money. C-004 covers part (a): new migration `supabase/migrations/20261028060000_salons.sql`, new test file `supabase/tests/salons.test.ts`, rows added to `supabase/tests/rls-matrix.test.ts`, docs 04, 06 and this file. Branch claude/p1-02-salons is cut from claude/p1-04-inventory (it needs migration 0008 for the demand_signal foreign key), so its pull request stacks on PR 5.
**Rules touched:** section 3
**Next / needs:** migration 0009 and tests.

### L-0144 · 2026-10-28 13:00 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-02-salons · DECISION
**Task:** P1-02 (H-23 test change)    **Claim:** C-004
**What / why:** Migration 0009 tripped the same verifier lists as 0008 (L-0130), plus a re-verifier-3 check that "salons do not exist yet". MJ was asked whether to approve three changes (17 salon functions added to the allowlist; create_salon and add_salon_note added to the client-time list, their times stored only as *_client evidence; the list-dump check changed from "public.salon does not exist" to "a rep reads 0 rows from public.salon", the same H-14 intent) and whether the same three kinds of change are pre-approved for future modules. MJ chose "Approve, and pre-approve (Recommended)". Standing rule from now on: for each new module, adding its functions to the allowlist, adding *_client or planned-date parameters to the client-time list, and turning a "does not exist yet" check into a "rep sees 0 rows" check are approved, each logged citing L-0144; any other change to a verifier-authored test still needs MJ.
**Rules touched:** H-23
**Next / needs:** L-0145.

### L-0145 · 2026-10-28 13:00 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-02-salons · PROGRESS
**Task:** P1-02 (part a)    **Claim:** C-004
**What / why:** Work in progress, committed so nothing is lost (MJ's stop hook asks for every change to be committed and pushed). P1-02 part a is NOT done. In this commit: migration `supabase/migrations/20261028060000_salons.sql` (territories, areas, rep territories, salons, contacts, append-only notes and stage events, phone reveal log, stage-change guard, capped rep reads, demand_signal.salon_id foreign key), `supabase/tests/salons.test.ts`, RLS matrix rows for the eight new tables, and the three verifier-test edits approved in L-0144. Also on this branch's base: PR 5 was retargeted from feat/p0-foundation to main after MJ merged PR 3 (main 98fa114 has the same tree as b61494f, the commit PR 5 was cut from).
**Evidence:** Before the verifier-test edits: `pnpm db:test` on a fresh local Postgres 16 database, 19 files, 1234 passed and 3 failed, the 3 being exactly the verifier lists L-0144 covers; every salons and RLS matrix test passed. The migration applies cleanly by itself (shim plus 0001 to 0009, psql ON_ERROR_STOP). After the edits the full suite has NOT been run (MJ stopped that run); `pnpm activity:check` OK.
**Rules touched:** H-23, H-24
**Next / needs:** run the full suite; update doc 06 section 4 (rep salon reads are capped functions, not views); DONE entry for part a with the security checklist; pull request stacked on PR 5.

### L-0146 · 2026-10-28 20:30 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-02-salons · DEVIATION
**Task:** P1-02 (part a)    **Claim:** C-004
**What / why:** Differences from the documents, and what part a leaves for later parts. (1) Doc 06 section 4 described rep reads as views with the page cap in the API layer; they are built as `app.*` functions that check territory, mask phones and cap a page at 50 rows in the database, and the salon tables are office-only at the table. Doc 06 updated in this branch (H-25). (2) CTL-18: until the OTP flow (part c) exists, a primary phone change is office-only (`app.office_set_primary_contact`, reason required, audited, old contact kept inactive); there is no OTP to the new number and no notice to the old one yet. (3) CTL-09: `salon_guard` refuses any change to verification_status, so no salon can be marked verified until part c adds its sanctioned path. (4) SAL-01 frontage photo is not stored yet (no storage bucket); MAP-02 and PIP-07 (60 seconds, offline) are the PWA's job (P1-09); the database side is ready (client-generated ids, created_at_client). (5) Phone reveals are logged but not capped; a daily cap would be a new threshold for MJ (H-26).
**Rules touched:** H-25, H-26
**Next / needs:** parts b to d; MJ may ask for a reveal cap.

### L-0147 · 2026-10-28 20:30 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-02-salons · DONE
**Task:** P1-02 (part a: SAL-01 to SAL-03, SAL-09; PIP-01; MAP-03; CTL-18 duplicate phones)    **Claim:** C-004
**What / why:** Migration 0009 `supabase/migrations/20261028060000_salons.sql`: territories, areas and rep territories with history (an assignment changes once, by being ended); salons scoped to the rep's current territories; reps add salons only in their own areas and only from field sources, idempotent on the client-generated id; reps move a salon only between their own areas; contacts with phones masked in rep lists and `app.reveal_phone` logged to `control.phone_reveal` (owner-readable); append-only notes and stage events; a trigger that lets a salon's stage change only in the same transaction as a matching stage_event, for every role; rep park with reason, office override with reason; duplicate-phone list for the office (CTL-18 part); the demand_signal.salon_id foreign key deferred by L-0132, and `app.record_demand` now refuses a salon the rep cannot reach. Doc 06 section 4 updated (L-0146). Verifier lists changed as MJ approved and pre-approved (L-0144).
**Evidence:** On claude/p1-02-salons at baf39b5 (cut from PR 5's head 8ba8d6b): `pnpm db:test` on a fresh local Postgres 16 database (KIRAN_TEST_DATABASE_URL): 19 files, 1237 passed (before part a: 18 files, 897). New: `supabase/tests/salons.test.ts` (territory scoping, field-only sources, replay, 50-row page cap with keyset paging, masked phone and logged reveal, duplicate phones, office-only phone change keeping history, append-only notes, stage events and reveals for postgres too, stage guard, park and override with reasons, ending a territory removes access at once, lost demand foreign key and reach, audit chain verifies) and RLS matrix rows for the eight new tables across ten personas. The migration applies cleanly by itself (shim plus 0001 to 0009, psql ON_ERROR_STOP). `pnpm typecheck` exit 0. `salons.test.ts` passes Biome with the configuration from PR 6. `pnpm activity:check` OK. Not applied to staging.
**Rules touched:** H-06, H-07, H-08, H-09, H-13, H-14, H-16, H-17, H-23, H-27
**Next / needs:** a different agent verifies P1-02 part a (section 7: try to read another territory's salons and phones, dump the salon list, change a stage without an event, revive an ended assignment).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — eight tables, ten personas each; salon tables office-only at the table
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) — salon_note, stage_event, phone_reveal also refuse UPDATE, DELETE, TRUNCATE for postgres; salons, contacts and assignments are never deleted
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — client-generated ids and client_id; replays tested
[x] Audit trigger present; hash chain verifies (H-17) — schema-hygiene guard passes; chain verified at the end of the salons tests
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) — no such column; notes are the documented chit
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20) — [Test] data and +920000 phones only; one realistic example phone in a comment was replaced (a3dea3b)
[x] Governance powers still owner-only + AAL2 (H-15) — territory and stage overrides are office (manager) operations per doc 06 section 2
[x] No control weakened, skipped or "temporarily" disabled (H-16) — verifier tests changed only as MJ approved (L-0144)
[x] Docs match code; deviations logged (H-25) — L-0146
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0148 · 2026-10-28 20:30 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-02-salons · CLAIM-RELEASED
**Task:** P1-02 (part a)    **Claim:** C-004
**What / why:** C-004 released (done): moved to the released table. P1-02 board row records part a as DONE (self-reported); parts b to d get their own claims.
**Rules touched:** section 3
**Next / needs:** L-0149.

### L-0149 · 2026-10-28 20:30 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-02-salons · HANDOFF
**Task:** P1-02 (part a)    **Claim:** — (C-004 released)
**What / why:** State: part a is on branch claude/p1-02-salons, stacked on PR 5; suite green (1237); not applied to staging. Next steps, in order: (1) pull request for this branch, stacked on PR 5; (2) a different agent verifies P1-04 and P1-02 part a; (3) P1-02 part b (visits, check-in gating) and P1-16 (thin due-list and manual routes), which need part a; (4) part c once an SMS adapter exists; (5) P1-06 orders. Gotchas: branches claude/p1-02-salons and claude/spec are both cut from PR 5 and both used L-0136 onward (and C-004, C-005); whichever merges second renumbers its own entries; PR 6 adds Biome, after which every new file must pass `pnpm lint`. On this container start Postgres with `service postgresql start` and recreate the test database before each `pnpm db:test`.
**Evidence:** `pnpm db:test` 19 files, 1237 passed; `pnpm typecheck` exit 0; `pnpm activity:check` OK (this session, before commit).
**Rules touched:** section 11, H-23, H-24
**Next / needs:** MJ: review PR 5, PR 6 and this branch's pull request.

### L-0150 · 2026-10-28 20:40 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-02-salons · PROGRESS
**Task:** P1-02 (part a)    **Claim:** — (C-004 released; CI fix on PR 7)
**What / why:** CI on PR 7 (900ce0f) failed one test on the Supabase stack: "ending a rep's territory removes its salons from that rep at once" (1 failed, 1236 passed). Root cause, in the test: it checked that rep A could see salon S1 again with `app.my_salons() where id = S1`, but `app.my_salons` returns one 50-row page ordered by name, and by then rep A has more than 55 salons. Supabase's database uses the en_US collation, which sorts "[Test] Renamed" after the "[Test] bulk N" salons, so S1 fell past the cap; the local C-collated database sorted it first. The page cap behaved correctly. The test now checks reach through `app.salon_stages(S1)` (one salon, any page) before ending the territory, after ending it and after giving it back; nothing else changed. The local test database is now created with the en_US collation, as on Supabase, so this class of difference shows locally.
**Evidence:** reproduced first: salons tests on a fresh en_US.UTF-8 database, 1 failed, 19 passed, same assertion as CI. After the fix: `pnpm db:test` on a fresh en_US.UTF-8 database, 19 files, 1237 passed. `salons.test.ts` passes Biome. `pnpm activity:check` OK.
**Rules touched:** H-23 (own test; no test skipped or loosened), H-24
**Next / needs:** CI on PR 7.

### L-0151 · 2026-10-28 20:47 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-02b-visits · CLAIM
**Task:** P1-02 (part b: PIP-02 visits, PIP-09 check-in and check-out gating)    **Claim:** C-006
**What / why:** MJ: "start P1-02 part b visits and check-in". C-006 added to section 13. Areas: a new migration `supabase/migrations/20261028070000_visits.sql`, a new test file `supabase/tests/visits.test.ts`, rows added to `supabase/tests/rls-matrix.test.ts`, the verifier lists under MJ's standing approval (L-0144), and docs. Branch claude/p1-02b-visits is cut from claude/p1-02-salons (PR 7, green), so its pull request stacks on PR 7; entries continue that branch's numbering.
**Rules touched:** section 3
**Next / needs:** migration 0010 and tests.

### L-0152 · 2026-10-28 20:55 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-02b-visits · DEVIATION
**Task:** P1-02 (part b)    **Claim:** C-006
**What / why:** Differences from the documents, and what part b leaves for later tasks. (1) PIP-09 check-out needs the evening bag count (a daily_close stock_count since check-in, INV-05) but not yet a cash handover; that check joins when cash collection exists (P1-07). (2) Doc 08 rule 7, three visits without an order moving a salon to parked, is not automatic yet: it needs orders (P1-06). Reps can still park with a reason. (3) No visit photo yet (no storage bucket), as for the salon frontage in part a. (4) The distance from the salon pin and the phone's mock-location flag are recorded on every visit, but nothing warns or blocks on them yet; the geofence warning is Phase 2 (PIP-11, doc 13 R8). (5) GPS at check-in is optional (the bag count is the gate); every visit needs GPS. (6) An earlier day left open blocks check-in until the office force-closes it with a reason; there is no automatic midnight close.
**Rules touched:** H-25, H-26
**Next / needs:** the cash handover gate in P1-07; the automatic park rule in P1-06; MJ may want an automatic close or a geofence threshold (both new thresholds, H-26).

### L-0153 · 2026-10-28 20:55 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-02b-visits · DONE
**Task:** P1-02 (part b: PIP-02 visits, PIP-09 check-in and check-out gating)    **Claim:** C-006
**What / why:** Migration 0010 `supabase/migrations/20261028070000_visits.sql`: `public.rep_day` (one per rep per Karachi day; open, closed or force_closed; a guard lets a day change only by closing, and a closed day is final for every role) and append-only `public.visit` (server time, GPS required, distance from the salon pin, mock-location flag, outcome, short note). `app.rep_check_in` (rep on the approved device only; records the morning bag count and its variance against the system figure; a replay returns the same day; refused when today is already closed or an earlier day is still open), `app.rep_check_out` (needs the evening bag count since check-in), `app.office_force_close_rep_day` (office, reason required), `app.log_visit` (needs an open day and a salon in the rep's current territories; idempotent on client_id, and the same client_id with other content is refused; sample or quote moves a prospect or visited salon to trial, and any outcome except not_present moves a prospect to visited, each through a stage_event), and the reads `app.my_day` and `app.salon_visits` (territory-checked, 50 rows). Reps never read the visit table. Doc 04 rows and doc 06 section 4 updated; verifier lists changed under MJ's standing approval (L-0144: allowlist names and client-time parameters only).
**Evidence:** On claude/p1-02b-visits at 79bbbe3 plus this entry: `pnpm db:test` on a fresh en_US.UTF-8 local Postgres 16 database (KIRAN_TEST_DATABASE_URL), 20 files, 1331 passed (before part b: 19 files, 1237). New: `supabase/tests/visits.test.ts` (no visit before check-in; office, wrong device and suspended refused; bag variance; replay; stale earlier day blocks check-in until a force close with a reason, which the rep cannot do; distance 0 at the pin and 1112 m at 0.01 degrees; mock flag; stage moves; another territory refused; capped reads; check-out gated on the evening count; no visit or new check-in after close; visit and rep_day refuse UPDATE, DELETE and TRUNCATE for postgres; audit chain verifies) and RLS matrix rows for rep_day and visit across all personas. `pnpm typecheck` exit 0. `visits.test.ts` passes Biome with the PR 6 configuration. `pnpm activity:check` OK. Not applied to staging.
**Rules touched:** H-06, H-07, H-08, H-09, H-13, H-14, H-16, H-17, H-23, H-27
**Next / needs:** a different agent verifies P1-02 part b (section 7: log a visit without a day, reopen a closed day, visit another territory's salon, read the visit table as a rep, replay a client_id with other content).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — two tables, every persona; visit office-only at the table, rep_day office or own rows
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) — visit refuses UPDATE, DELETE, TRUNCATE for postgres too; rep_day is never deleted and a closed day is final
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — client_id on visits, one day per rep per date on check-in; replays tested
[x] Audit trigger present; hash chain verifies (H-17) — schema-hygiene guard passes; chain verified at the end of the visits tests
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) — no such column
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20) — [Test] data and synthetic coordinates only
[x] Governance powers still owner-only + AAL2 (H-15) — force close is an office (manager) operation with a reason, per doc 06 section 2
[x] No control weakened, skipped or "temporarily" disabled (H-16) — verifier tests changed only as MJ pre-approved (L-0144)
[x] Docs match code; deviations logged (H-25) — L-0152
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0154 · 2026-10-28 20:55 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-02b-visits · CLAIM-RELEASED
**Task:** P1-02 (part b)    **Claim:** C-006
**What / why:** C-006 released (done): moved to the released table. P1-02 board row records part b as DONE (self-reported); parts c and d get their own claims.
**Rules touched:** section 3
**Next / needs:** L-0155.

### L-0155 · 2026-10-28 20:55 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-02b-visits · HANDOFF
**Task:** P1-02 (part b)    **Claim:** — (C-006 released)
**What / why:** State: part b is on branch claude/p1-02b-visits, stacked on PR 7; suite green (1331); not applied to staging. Next steps, in order: (1) pull request for this branch, stacked on PR 7; (2) a different agent verifies P1-04 and P1-02 parts a and b; (3) P1-16 (thin due-list and manual routes), which can now use rep days and visits; (4) P1-06 orders, then the automatic park rule (L-0152); (5) part c once an SMS adapter exists. Gotchas: a rep has one day per Karachi date, so tests that check a rep in must own that rep's day for the run (visits.test.ts does); the test database must be created with the en_US collation (L-0150); this branch does not yet have PR 6's Biome file, so lint new files with that configuration until PR 6 merges.
**Evidence:** `pnpm db:test` 20 files, 1331 passed; `pnpm typecheck` exit 0; `pnpm activity:check` OK (this session, before commit).
**Rules touched:** section 11, H-23, H-24
**Next / needs:** MJ: review PR 5, PR 6, PR 7 and this branch's pull request.

### L-0156 · 2026-10-28 21:02 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-16-due-routes · CLAIM
**Task:** P1-16 (thin due-list and manual routes: PIP-03, PIP-05 and PIP-06 thin, D-19)    **Claim:** C-007
**What / why:** MJ: "start P1-16 due-list and routes". C-007 added to section 13. Areas: a new migration `supabase/migrations/20261028080000_routes.sql`, a new test file `supabase/tests/routes.test.ts`, rows added to `supabase/tests/rls-matrix.test.ts`, the verifier lists under MJ's standing approval (L-0144), and docs 04 and 06. Branch claude/p1-16-due-routes is cut from claude/p1-02b-visits (PR 8), because a route stop shows whether the rep has visited it that day; its pull request stacks on PR 8. Assumption A-09 (section 15): there are no orders yet (P1-06), so the last purchase per salon and product group comes from an office-entered opening baseline (for example from MJ's existing salon records), which deliveries will update once P1-06 exists.
**Rules touched:** section 3, section 15
**Next / needs:** migration 0011 and tests.

### L-0157 · 2026-10-28 21:15 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-16-due-routes · DECISION
**Task:** P1-16    **Claim:** C-007
**What / why:** MJ answered two questions in this session. (1) Where the due-list's last purchase comes from before orders exist: "Office enters it (Recommended)": the office keys in a last purchase date per salon and product group from existing records; deliveries replace it once P1-06 exists (A-09). (2) The verifier test that lists every function taking a date from outside (`reverify3-attacks.test.ts`, section 7.6) gains `app.office_set_last_purchase(p_last_order_on)`, which is outside the L-0144 standing approval: "Approve (Recommended)". The date may not be in the future.
**Rules touched:** H-23, H-26
**Next / needs:** migration 0011.

### L-0158 · 2026-10-28 21:27 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-16-due-routes · DEVIATION
**Task:** P1-16    **Claim:** C-007
**What / why:** Differences from the documents, and what P1-16 leaves for later tasks. (1) PIP-06 "due-for-reorder tasks": the due-list is computed on read by `app.due_list`, not written as task rows; doc 04's task table comes with P1-10 or Phase 2 timers. (2) PIP-06 "at-risk transition at due + 50% of the cycle": the due-list marks the salon at_risk, but no stage moves yet; the active stages exist only once orders do (P1-06). (3) PIP-05: the cycle is the product group's default; the per-salon estimate from order history is Phase 2 (cycle_days stays null until then). (4) Doc 04 route: start_geo and optimised are not built (route optimisation is MAP-08, Phase 2); route_stop has no expected_amount_due (collections, P1-07) and no outcome_visit_id: whether a stop was visited is read from that day's visits. (5) An office re-plan replaces all of the day's stops, including pins the rep added. (6) Reps cannot remove a stop, only reorder and add. (7) No route days per territory (PIP-04, Phase 2). Docs 04 and 06 updated in this branch (H-25). No free-text note column was added (H-27).
**Rules touched:** H-25, H-27
**Next / needs:** P1-17 (route-linked bag load) can now read routes and the due-list; P1-06 deliveries must update cycle_estimate (basis orders).

### L-0159 · 2026-10-28 21:27 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-16-due-routes · DONE
**Task:** P1-16 (PIP-03 manual route building; PIP-05 and PIP-06 thin, D-19)    **Claim:** C-007
**What / why:** Migration 0011 `supabase/migrations/20261028080000_routes.sql`: `public.cycle_estimate` (last purchase per salon and product group; office-entered opening date under A-09 and MJ L-0157, never in the future; refused once deliveries keep the row; never deleted), `public.route` (one per rep per day, append-only) and `public.route_stop` (ordered stops with a reason, at most 50, a salon once per route, every stop in the rep's current territories; changes only while the day is today or later, for every role; a reorder changes only the sequence). Functions: `app.office_set_last_purchase`, `app.due_list` (due from next due minus 3 days, overdue from next due, at risk from next due plus half the cycle; parked salons left out; the rep's territories or, for the office, all or one territory; 50 rows, most urgent first; computed on read, so a new default cycle applies at once), `app.office_set_route` (office, today or later, replaces the day's stops), `app.rep_add_stop` (a pin added to today's route, idempotent), `app.rep_reorder_route` (the list must name every stop exactly once) and `app.my_route` (in order, with the salon's nearest due date and whether the rep visited it that day; stops outside the rep's current territories hidden). Reps never read the three tables' salon data directly. Docs 04 and 06 updated; verifier lists changed under L-0144 and L-0157.
**Evidence:** On claude/p1-16-due-routes at 1c556b0 plus this entry: `pnpm db:test` on a fresh en_US.UTF-8 local Postgres 16 database (KIRAN_TEST_DATABASE_URL), 21 files, 1473 passed (before P1-16: 20 files, 1331). New: `supabase/tests/routes.test.ts`, 22 tests (opening date office-only, no future date, replace, refused once kept by deliveries; due, overdue and at-risk with both edges; territory scoping for reps, the office and one territory; planning ahead; a new default cycle applies at once; parked salons left out; office route with every bad input refused; rep pin added at the end and replayed; reorder needs every stop exactly once; visited flag from that day's visits; stops hidden when the territory ends; reps never read the stop or cycle tables; re-plan replaces the rep's pin; past routes final for postgres; stops change only their place; routes append-only; audit chain verifies) and RLS matrix rows for the three tables across all personas. A mutation check: widening the due window to 4 days fails the edge test. A first full run failed one salons test (rep A held a territory this file had committed); the fix ends this file's assignments when it finishes. `pnpm typecheck` exit 0. `routes.test.ts` passes Biome with the PR 6 configuration. `pnpm activity:check` OK. Not applied to staging.
**Rules touched:** H-06, H-07, H-08, H-13, H-14, H-16, H-17, H-23, H-27
**Next / needs:** a different agent verifies P1-16 (section 7: plan a route with another territory's salon, edit a past route, reorder another rep's route, read stops or cycles as a rep, enter a future purchase date).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — three tables, every persona; cycle_estimate and route_stop office-only at the table, route office or own rows
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) — route append-only for postgres too; past stops final for postgres; cycle estimates never deleted
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — set route and set last purchase replace; add stop replays; reorder is a permutation
[x] Audit trigger present; hash chain verifies (H-17) — on all three tables; chain verified at the end of the routes tests
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) — no such column; no free-text column (H-27)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20) — [Test] data only
[x] Governance powers still owner-only + AAL2 (H-15) — route planning and opening dates are office (manager) operations, per doc 06 section 2
[x] No control weakened, skipped or "temporarily" disabled (H-16) — verifier tests changed only as MJ approved (L-0144, L-0157); the salons test was not changed
[x] Docs match code; deviations logged (H-25) — L-0158
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0160 · 2026-10-28 21:27 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-16-due-routes · CLAIM-RELEASED
**Task:** P1-16    **Claim:** C-007
**What / why:** C-007 released (done): moved to the released table. The P1-16 board row records DONE (self-reported).
**Rules touched:** section 3
**Next / needs:** L-0161.

### L-0161 · 2026-10-28 21:27 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-16-due-routes · HANDOFF
**Task:** P1-16    **Claim:** — (C-007 released)
**What / why:** State: P1-16 is on branch claude/p1-16-due-routes, stacked on PR 8; suite green (1473); not applied to staging. Next steps, in order: (1) pull request for this branch, stacked on PR 8; (2) a different agent verifies P1-04, P1-02 parts a and b, and P1-16; (3) P1-06 orders and invoices, whose deliveries must update cycle_estimate (basis orders) and drive the active stages and the at-risk move; (4) P1-17 route-linked bag load, which reads routes and the due-list; (5) P1-15 agents. Gotchas: test files share one database and run in name order, so a file that commits a territory assignment must end it in afterAll (routes.test.ts does); personas cannot call app.karachi_today, so tests compute today in SQL; the test database must use the en_US collation (L-0150).
**Evidence:** `pnpm db:test` 21 files, 1473 passed; `pnpm typecheck` exit 0; `pnpm activity:check` OK (this session, before commit).
**Rules touched:** section 11, H-23, H-24
**Next / needs:** MJ: review PRs 5 to 8 and this branch's pull request.

### L-0162 · 2026-10-28 21:41 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-06a-orders · CLAIM
**Task:** P1-06 (part a: SAL-04 credit profile, ORD-01 to ORD-03, ORD-10, CTL-07, CTL-08)    **Claim:** C-008
**What / why:** MJ: "start P1-06 orders and invoices". P1-06 is split like P1-02: part a (this claim) is the salon credit profile and its change log, orders with lines at list price, the credit check, discount approvals, holds and rechecks for offline orders, and cancellation; part b is delivery (bag or warehouse), stock movements, gapless invoices, the salon's acknowledgment, stage and cycle updates; part c is the invoice document (ORD-05). C-008 added to section 13. Areas: a new migration `supabase/migrations/20261028090000_orders.sql`, a new test file `supabase/tests/orders.test.ts`, rows added to `supabase/tests/rls-matrix.test.ts`, the verifier lists (L-0144), docs 04 and 06. Branch claude/p1-06a-orders is cut from claude/p1-16-due-routes (PR 9); its pull request stacks on PR 9. Assumption A-10 (section 15).
**Rules touched:** section 3, section 15
**Next / needs:** L-0163, then migration 0012.

### L-0163 · 2026-10-28 21:41 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-06a-orders · DECISION
**Task:** P1-06    **Claim:** C-008
**What / why:** MJ answered three questions in this session. (1) Delivery acknowledgment in Phase 1: "Name + GPS now (Recommended)": the rep records the name of the person who received the goods, with GPS and server time; an OTP to the salon is added when an SMS adapter exists (part b). (2) Who gives installment terms and a credit limit while salon verification (P1-02 part c) is not built: "Owner sets by hand (Recommended)": the owner sets a salon's plan eligibility and limit with a reason, logged as a credit event; a manager may only raise a limit by at most 50% or unblock, at most 2 times per salon per month (doc 09 section 2, config keys credit.manager_override.*). (3) The conflict between doc 03 ORD-02 (a Blocked salon gets no order) and doc 09 section 2 (Blocked: cash only until settled): "Doc 09 (Recommended)": a blocked salon may still order cash on delivery; cash orders do not count against the credit limit; installment orders must fit within it. Doc 03 ORD-02 is updated in this branch to match (H-25).
**Rules touched:** H-25, H-26
**Next / needs:** migration 0012.

### L-0164 · 2026-10-28 22:00 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-06a-orders · DEVIATION
**Task:** P1-06 (part a)    **Claim:** C-008
**What / why:** Differences from the documents, and what part a leaves for later. (1) Only reps take orders; doc 06's "on behalf (flagged)" office orders come later. (2) Exposure is the total of confirmed installment orders until invoices and payments exist (A-10). (3) No automatic credit rules yet (doc 09 section 2: graduation, automatic raise and cut, automatic block on 30 days overdue): they need payments and ageing (P1-07); `credit.rules` in config is not read yet, and the owner sets terms by hand (MJ L-0163). (4) A credit block does not move the salon's stage; a salon whose stage is blocked also counts as blocked. (5) The price list is the SKU's current list price, copied onto each line; effective dates and per-salon prices are ORD-07 (Phase 2). (6) One discount approval covers the whole order, instead of doc 04's discount_approval_id per line. (7) An order needs an open day when it reaches the server, so the phone must sync before check-out (check-out needs the network too). (8) Listing overrides in the daily digest (CTL-08) is P1-08. (9) Cancelling after delivery, and at-risk salons returning to active regular, need deliveries (part b). Docs 03, 04 and 06 updated in this branch (H-25).
**Rules touched:** H-25, H-26
**Next / needs:** part b (delivery, stock, gapless invoices); P1-07 replaces A-10 and turns on the credit rules.

### L-0165 · 2026-10-28 22:00 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-06a-orders · DONE
**Task:** P1-06 (part a: SAL-04, ORD-01 to ORD-03, ORD-10, CTL-07, CTL-08)    **Claim:** C-008
**What / why:** Migration 0012 `supabase/migrations/20261028090000_orders.sql`: `public.salon_credit` (plan eligibility, limit, blocked; a guard lets it change only with a matching credit_event in the same transaction; never deleted), append-only `public.credit_event`, `public.sales_order` (parties and amounts immutable, status forward only, cancelled and closed final) and append-only `public.sales_order_line` (list price copied, unit price at most list). Functions: `app.owner_set_credit` (owner only, with reason), `app.office_raise_limit` (manager at most 50% over an existing limit, within 2 per salon per month; owner any), `app.office_set_blocked` (block by any office user; a manager's unblock counts toward the cap), `app.create_order` (rep, open day, own territory, active priced SKUs, idempotent on client_id; a discount requests one approval, from the owner above 10% or Rs 5,000 or when the threshold is missing; never refused for credit: a failed check leaves a draft with its holds), `app.recheck_order` (the order's rep or the office; ORD-10), `app.office_release_credit_hold` (manager only within 50% over the limit and never above the salon's eligibility, each check applied on its own; counts toward the cap; owner any), `app.cancel_order` (the rep its own draft, the office before delivery, reason required, pending discount request cancelled), and the reads `app.salon_credit_status` and `app.my_orders`. A confirmed order makes the salon active (doc 02). Config thresholds fail closed when missing.
**Evidence:** On claude/p1-06a-orders at de373c4 plus this entry: `pnpm db:test` on a fresh en_US.UTF-8 local Postgres 16 database (KIRAN_TEST_DATABASE_URL), 22 files, 1655 passed (before part a: 21 files, 1473). New: `supabase/tests/orders.test.ts`, 22 tests (owner-only terms; no profile change without an event, for postgres too; manager raise at most 50%, never from zero, owner any; cap of 2 per salon per month, owner not capped; unblock counts; reps read terms only through the function; open day needed; office takes no orders; cash order confirmed at once, salon active, replay, same client_id with other content refused; other territory and seven kinds of bad line refused; installments within limit confirmed, over limit and above eligibility held; blocked salon buys cash but gets no installments; recheck after a raise confirms; manager release within 50%, beyond refused, above eligibility refused, owner any; a blocked order asking for a higher plan cannot be released by a manager; release counts toward the cap; discount held until a manager approves, rejection shown, own approval impossible; owner decides above 10% or Rs 5,000; rep cancels its own draft and the discount request with it; only the office cancels a confirmed order; cancelled is final; amounts, lines and status history fixed for postgres; reps see only their own orders; audit chain verifies) and RLS matrix rows for the four tables across all personas. Every order test runs in one rolled-back transaction, so no rep day is left for the visits tests. One mutation check: removing the separate plan check from the manager release fails its test (this was a defect found in self-review before the first run, together with a race between two orders of one salon, now serialised by locking the salon; the lock has no concurrent test). A first full run failed one visits test: a plain TRUNCATE of visit is now refused by the new sales_order.visit_id foreign key (0A000) before the append-only trigger runs; the test now expects 0A000 for the plain form and 42501 for TRUNCATE CASCADE, which reaches the trigger (a stronger check, not a looser one). A second full run failed 15 tests in three files because vitest ran last run's failures first, so visits.test.ts committed rep A's closed day, the rep bags and territory assignments before the inventory, orders and salons tests: the suite now runs files in name order every time (`supabase/tests/vitest.config.ts`, a name-order sequencer) and the visits tests end their territory assignments when they finish; the green run was made with the stale vitest cache that caused the failure. `pnpm typecheck` exit 0. `orders.test.ts` passes Biome with the PR 6 configuration. `pnpm activity:check` OK. Not applied to staging.
**Rules touched:** H-06, H-07, H-08, H-09, H-10, H-12, H-13, H-14, H-16, H-17, H-23
**Next / needs:** a different agent verifies P1-06 part a (section 7: take an installment order over the limit, release it as a manager beyond the cap or above eligibility, approve one's own discount, change an order's amount, cancel another rep's order).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — four tables, every persona; credit office-only at the table, orders and lines office or own
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) — credit_event and order lines append-only for postgres too; orders never deleted, amounts fixed; credit profile only with an event
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — create_order on client_id; replays and conflicting replays tested
[x] Audit trigger present; hash chain verifies (H-17) — on all four tables; chain verified at the end of the orders tests
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) — list and unit prices only; no cost column
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20) — [Test] and [Dummy] data and dummy prices only
[x] Governance powers still owner-only + AAL2 (H-15) — plan eligibility and any limit set only by the owner; manager raises, unblocks and releases capped (doc 09 section 2); maker never checker (approval machinery, H-12)
[x] No control weakened, skipped or "temporarily" disabled (H-16) — config thresholds fail closed; verifier tests changed only as MJ pre-approved (L-0144)
[x] Docs match code; deviations logged (H-25) — L-0164
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0166 · 2026-10-28 22:00 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-06a-orders · CLAIM-RELEASED
**Task:** P1-06 (part a)    **Claim:** C-008
**What / why:** C-008 released (done): moved to the released table. The P1-06 board row records part a as DONE (self-reported); parts b and c get their own claims.
**Rules touched:** section 3
**Next / needs:** L-0167.

### L-0167 · 2026-10-28 22:00 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-06a-orders · HANDOFF
**Task:** P1-06 (part a)    **Claim:** — (C-008 released)
**What / why:** State: part a is on branch claude/p1-06a-orders, stacked on PR 9; suite green (1655); not applied to staging. Next steps, in order: (1) pull request for this branch, stacked on PR 9; (2) a different agent verifies P1-04, P1-02 parts a and b, P1-16 and P1-06 part a; (3) P1-06 part b: delivery from the bag or the warehouse (stock_movement kind sale), gapless invoices with app.next_doc_number, the name-and-GPS acknowledgment (MJ L-0163), partial delivery, cycle_estimate updates (basis orders) and at-risk salons back to active; (4) part c, the invoice document; (5) P1-07 money, which replaces A-10. Gotchas: test files run in name order (vitest.config.ts sequencer); tests that need a rep's day must not commit it (the visits tests own today's day): orders.test.ts opens it inside one rolled-back transaction and switches persona with set_config; files that commit a territory assignment end it in afterAll.
**Evidence:** `pnpm db:test` 22 files, 1655 passed; `pnpm typecheck` exit 0; `pnpm activity:check` OK (this session, before commit).
**Rules touched:** section 11, H-23, H-24
**Next / needs:** MJ: review PRs 5 to 9 and this branch's pull request.

### L-0168 · 2026-10-28 22:32 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-06b-deliveries · CLAIM
**Task:** P1-06 (part b: ORD-03 delivered states, ORD-04 delivery with stock movement and invoice, ADM-03 gapless numbering)    **Claim:** C-009
**What / why:** MJ: "start P1-06 part b delivery and invoices". C-009 added to section 13. Scope: deliveries of confirmed orders, full or partial, by the rep from its own bag or by the office from a warehouse, with the name of the person who received the goods and GPS (MJ L-0163); one `sale` stock movement per line, under the existing negative-stock guard; one immutable invoice per delivery numbered with `app.next_doc_number('INV')` inside the same transaction; the order moving to partially delivered or delivered; the salon's cycle estimate kept by deliveries (basis orders, P1-16 handoff); a salon with 3 delivered orders moving from active new to active regular (doc 02). Areas: a new migration `supabase/migrations/20261028100000_deliveries.sql`, a new test file `supabase/tests/deliveries.test.ts`, rows added to `supabase/tests/rls-matrix.test.ts`, the verifier lists (L-0144), docs 04 and 06. Branch claude/p1-06b-deliveries is cut from claude/p1-06a-orders (PR 10); its pull request stacks on PR 10.
**Rules touched:** section 3
**Next / needs:** migration 0013.

### L-0169 · 2026-10-28 22:39 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-06b-deliveries · DEVIATION
**Task:** P1-06 (part b)    **Claim:** C-009
**What / why:** Differences from the documents, and what part b leaves for later. (1) The salon's acknowledgment is the receiver's name with GPS and server time (MJ L-0163); no OTP and no signature image yet (doc 04 salon_ack). (2) A rep delivers only from its own bag; warehouse goods reach a rep's salon either through the two-party issue into the bag first (P1-17 suggests it from the route) or as an office delivery from the warehouse, whose GPS is optional and which has no rep day. (3) No installment schedule is generated from the invoice yet: PAY-01 is P1-07; the invoice carries the plan. Exposure is still A-10 (confirmed installment orders), not invoiced minus paid. (4) delivered → closed (fully paid) comes with payments (P1-07). (5) No returns or credit notes (ORD-06, Phase 2), so a part-delivered or delivered order cannot be cancelled or reversed. (6) Shortfalls at delivery are not yet recorded as lost demand (DEM-02 is P1-17). (7) The invoice document (ORD-05) is part c. (8) cycle_estimate.basis_orders counts deliveries per product group, not distinct orders. Docs 04 and 06 updated in this branch (H-25).
**Rules touched:** H-25
**Next / needs:** part c (invoice document), P1-07 (schedules, payments, exposure), P1-17 (bag load, delivery shortfall demand).

### L-0170 · 2026-10-28 22:39 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-06b-deliveries · DONE
**Task:** P1-06 (part b: ORD-03 delivered states, ORD-04, ADM-03)    **Claim:** C-009
**What / why:** Migration 0013 `supabase/migrations/20261028100000_deliveries.sql`: append-only `public.delivery` (receiver's name, GPS, distance from the salon pin, mock-location flag, server and phone time, the rep's day), append-only `public.delivery_line` (the order line's prices) and immutable `public.invoice` (number `INV-{FY}-{seq}` from `app.next_doc_number('INV')` in the same transaction; one per delivery). One internal path, `app.deliver`: what is left per line, given lines summed and capped at what is left, units promised to pending issues not available, one `sale` stock movement per line under the negative-stock guard, the invoice, the order to partially delivered or delivered, the cycle estimates kept by deliveries (basis orders), and a third delivered order moving an active new salon to active regular. Callers: `app.rep_deliver` (the order's rep, open day, own territory, own bag, GPS and receiver's name required, idempotent on client_id with the same invoice on replay) and `app.office_deliver` (office, active warehouse, GPS optional). Read: `app.order_remaining`. No temporary tables inside SECURITY DEFINER functions.
**Evidence:** On claude/p1-06b-deliveries at f45fdcc plus this entry: `pnpm db:test` on a fresh en_US.UTF-8 local Postgres 16 database (KIRAN_TEST_DATABASE_URL), 23 files, 1789 passed (before part b: 22 files, 1655). New: `supabase/tests/deliveries.test.ts`, 14 tests (full delivery moves stock, one numbered invoice, order delivered, distance recorded; replay returns the same invoice, same client_id on another order refused; part deliveries get consecutive numbers and the last completes the order; lines not on the order, more than left, missing name or GPS refused; held, cancelled and delivered orders refused; a short bag refuses and takes no number; only the order's rep, checked in, delivers; the office cannot use the rep path; office delivery from a warehouse only, by the office only; deliveries keep the cycle estimate and the opening date is then refused; a third delivered order makes the salon regular; part-delivered orders cannot be cancelled; reps read only their own deliveries and invoices; deliveries, lines and invoices immutable for postgres; audit chain verifies) and RLS matrix rows for the three tables across all personas. Every test runs in one rolled-back transaction that loads rep A's bag, so no bag or day is left for the inventory and visits tests. Opening warehouse stock in the test is a receipt row inserted as postgres (goods receipts are the vault, P1-05). One mutation check: allowing one unit more than is left fails its test. `pnpm typecheck` exit 0. `deliveries.test.ts` passes Biome with the PR 6 configuration. `pnpm activity:check` OK. Not applied to staging.
**Rules touched:** H-06, H-07, H-08, H-09, H-10, H-11, H-13, H-14, H-16, H-17, H-23
**Next / needs:** a different agent verifies P1-06 part b (section 7: deliver more than ordered or than the bag holds, deliver another rep's order, change an invoice, find a gap in the numbers after a refused delivery).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) — three tables, every persona; a rep reads those of its own orders
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) — delivery, delivery_line and invoice append-only for postgres too
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) — client_id per delivery; replay returns the same invoice; no temporary tables
[x] Audit trigger present; hash chain verifies (H-17) — on all three tables; chain verified at the end of the deliveries tests
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) — list and unit prices only
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20) — [Test] and [Dummy] data; the receiver's name in tests is a made-up first name
[x] Governance powers still owner-only + AAL2 (H-15) — none added
[x] No control weakened, skipped or "temporarily" disabled (H-16) — the negative-stock guard and pending-issue reservation apply to deliveries; verifier tests changed only as MJ pre-approved (L-0144)
[x] Docs match code; deviations logged (H-25) — L-0169
[x] Tests actually run; real results recorded (H-23, H-24)

### L-0171 · 2026-10-28 22:39 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-06b-deliveries · CLAIM-RELEASED
**Task:** P1-06 (part b)    **Claim:** C-009
**What / why:** C-009 released (done): moved to the released table. The P1-06 board row records part b as DONE (self-reported); part c gets its own claim.
**Rules touched:** section 3
**Next / needs:** L-0172.

### L-0172 · 2026-10-28 22:39 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-06b-deliveries · HANDOFF
**Task:** P1-06 (part b)    **Claim:** — (C-009 released)
**What / why:** State: part b is on branch claude/p1-06b-deliveries, stacked on PR 10; suite green (1789); not applied to staging. Next steps, in order: (1) pull request for this branch, stacked on PR 10; (2) a different agent verifies P1-04, P1-02 parts a and b, P1-16 and P1-06 parts a and b; (3) P1-06 part c, the invoice document (ORD-05: from public data only, never cost or supplier); (4) P1-07 money: installment schedules from invoices, payments, receipts, handover, and exposure as invoiced minus paid (replacing A-10); (5) P1-17 route-linked bag load and delivery-shortfall demand. Gotchas: deliveries.test.ts runs before inventory.test.ts in name order, so it must never commit a bag for rep A (inventory creates it); test opening stock is a receipt row inserted as postgres until goods receipts exist.
**Evidence:** `pnpm db:test` 23 files, 1789 passed; `pnpm typecheck` exit 0; `pnpm activity:check` OK (this session, before commit).
**Rules touched:** section 11, H-23, H-24
**Next / needs:** MJ: review PRs 5 to 10 and this branch's pull request.

### L-0173 · 2026-10-29 07:34 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-integrate-main · DECISION
**Task:** — (integration of the merged pull requests into main; no requirement IDs)    **Claim:** — (C-005 is released in L-0177)
**What / why:** MJ merged pull requests 5 to 11. Each was stacked on the branch below it, so only PR 5 (P1-04) reached main; PRs 6 to 11 landed in claude/p1-04-inventory, claude/p1-02-salons, claude/p1-02b-visits, claude/p1-16-due-routes and claude/p1-06a-orders. Asked how the work should reach main, MJ chose "One PR to main (Recommended)", described as: one branch from the top of the stack with spec and main merged in, the log entries lost in the merge restored, the stack's entries renumbered after spec's (L-0142 onward), the full suite run, one pull request to main. This branch, claude/p1-integrate-main, is that branch; it contains origin/main, so the pull request only adds. Repaired here: (1) the merge commit 57e5efe (claude/p1-04-inventory into claude/p1-02-salons, resolved by hand on GitHub) kept only spec's side of ACTIVITY.md and dropped P1-02 part a's nine entries, which made activity-log-check fail on PR 7; they are back as L-0142 to L-0150. (2) Spec's L-0136 to L-0141 and the stack's L-0136 to L-0166 used the same numbers, as announced in the part a HANDOFF (L-0149): the stack's entries are renumbered by adding 6, so old L-0136 to L-0166 are new L-0142 to L-0172, and every reference in docs, migration comments and test comments moved with them. The texts of PRs 7 to 11 and earlier chat messages quote the old numbers; read them with this mapping. Spec's entries keep L-0136 to L-0141. Nothing was added, dropped or reworded except one sentence in L-0149 (old L-0143): the collision it describes is now history, so it reads "both used L-0136 onward". Entries up to L-0135 are byte-identical to main. For the record: the numbering note inside spec's L-0136 (claude/p1-02-salons also uses L-0136 to L-0139) is historical, those entries are now L-0142 to L-0145; and L-0170 (old L-0164) was edited in place once, in commit ff9a080, to remove angle brackets the log checker rejects, before any base had accepted it. Side effects disclosed for H-23: comment text in two verifier-authored test files (reverify3-attacks.test.ts, verifier-attacks.test.ts) changed only in the cited entry number, on lines the stack added under MJ's approval (L-0144); three strings in migration 0013 (a table comment and two error messages) cite MJ L-0163 instead of L-0157; no environment has applied the earlier text (staging has 7 migrations) and no test asserts them. An independent read-only audit (six auditors; findings re-checked by skeptics) found no content lost: HEAD's tree equals the tree rebuilt from main, spec and the shifted stack, the log is L-0001 to L-0172 once each, and all 119 references point at the right entry. It also found two defects in the stack's own tests, fixed here: deliveries.test.ts compared the invoice number with a literal INV-27, which would fail from 1 July 2027 when the financial-year label becomes 28 (the label is now computed in SQL); and salons.test.ts, unlike the four other module tests, left its two territory assignments in place (it now ends them in afterAll). The audit's docs-drift lens also listed documentation that the merged code contradicts; its skeptic checks were cut off by a usage limit, so those findings are unverified and are handled in L-0176.
**Evidence:** `pnpm db:test` on a fresh en_US.UTF-8 Postgres 16 database before the two test fixes: 23 files, 1789 passed (b6f2a3a); after them: 23 files, 1789 passed. `pnpm lint` exit 0 (0 errors; 31 warnings and 42 infos, all in legacy-listed files). `pnpm typecheck` exit 0. `pnpm -C apps/web test:e2e`: 4 passed. `pnpm activity:check` OK. Not applied to staging.
**Rules touched:** H-23, H-24, H-25, section 4 (the renumbered entries exist only on unmerged branches; main has none of them)
**Next / needs:** MJ: review and merge the pull request. After the merge the stacked branches hold the same entries under the old numbers and must not be merged: claude/p1-04-inventory, claude/p1-02-salons, claude/p1-02b-visits, claude/p1-16-due-routes, claude/p1-06a-orders, claude/p1-06b-deliveries, claude/spec can be deleted. Never stack a pull request on a feature branch again: its merge lands in that branch, not in main.

### L-0174 · 2026-10-29 07:34 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-integrate-main · ASSUMPTION
**Task:** P1-16 and P1-06    **Claim:** —
**What / why:** Section 15 asks for a log ASSUMPTION entry per assumption; A-09 and A-10 were cited from CLAIM entries (L-0156, L-0162) and A-10 was never stated in the log. A-09: until orders existed, the due-list's last purchase per salon and product group was an office-entered opening date; since P1-06 part b (L-0170) deliveries replace it (basis orders) and the opening path then refuses. A-10: a salon's credit exposure is the total of its confirmed installment orders, cash orders do not count (MJ L-0163); P1-06 part b did not replace this with invoiced minus paid (L-0169, item 3), P1-07 will. The two rows in section 15 now say so.
**Rules touched:** section 15
**Next / needs:** P1-07.

### L-0175 · 2026-10-29 07:34 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-integrate-main · BLOCKER
**Task:** P1-02 (part a), found by the integration audit    **Claim:** —
**What / why:** Doc 02 (Parked: a rep marks it with a reason) and the built function app.rep_park_salon (migration 0009) let a rep move a prospect, visited or trial salon to parked. The permission matrix in doc 06 section 2 says "Change salon stage manually: Rep —". The matrix is under MJ's approval (H-26) and part a was built on doc 02's reading without a BLOCKER. Default meanwhile: keep rep parking, as doc 02 says (row B-28). Also recorded, not blocking: app.reveal_phone has no OTP step-up (doc 06 section 3) until the OTP work; and the matrix row "log visits, orders, deliveries, payments: manager on behalf" is built only for deliveries (office_deliver), visits and orders are rep-only. Branch protection (B-13) is still not on and the docs name the checks wrongly: GitHub matches the check name, so the five to require are, verbatim: activity-log-check (ACTIVITY.md Appendix C) | migrations + RLS matrix (local Supabase stack) | typecheck + service-role scan | lint + format (Biome) | rep PWA browser tests (Playwright). Without a rule on the branch a pull request merges whatever its checks say, as PR 7 did one second after its log check failed.
**Rules touched:** H-26
**Next / needs:** MJ: may reps park a salon (amend the doc 06 row) or should it be removed? And turn on branch protection with the five names.

### L-0176 · 2026-10-29 07:34 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-integrate-main · DEVIATION
**Task:** documentation of the merged work    **Claim:** —
**What / why:** The audit's docs-drift lens (23 findings, mostly unverified because its skeptics hit a usage limit) says documentation contradicts the merged code. Examples: doc 04 rows for territory, salon, salon_contact, salon_note and stage_event (columns, an enum), invariants 4 and 5 (cash orders are not credit-checked; one discount approval per order), the rep_day note (only the office closes an earlier day), views versus capped functions (docs 04 and 05); SPEC.md status snapshot and docs/00-README.md ("nothing is built yet"); ORD-03 (a rep cancels its own draft), DEM-01 (six reasons), ORD-01 (list price), doc 02 Visited (any outcome but not present); docs 08 and 10 on the delivery acknowledgment. H-25 requires the docs to follow the code. They are not changed in this pull request, which only lands the merged work; a follow-up pull request from main corrects them after re-checking each against the SQL.
**Rules touched:** H-25
**Next / needs:** follow-up documentation pull request from main.

### L-0177 · 2026-10-29 07:34 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-integrate-main · CLAIM-RELEASED
**Task:** — (SPEC.md, Biome, Playwright tests and CI jobs lint and e2e)    **Claim:** C-005
**What / why:** C-005 released (done): the work merged with PR 6; the row moved to the released table.
**Rules touched:** section 3
**Next / needs:** L-0178.

### L-0178 · 2026-10-29 07:34 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/p1-integrate-main · HANDOFF
**Task:** — (integration)    **Claim:** — (C-005 released)
**What / why:** State: claude/p1-integrate-main holds everything built so far (P1-04, P1-02 parts a and b, P1-16, P1-06 parts a and b, spec tooling) on top of main; suite green (1789); not applied to staging; nothing but P1-04 is on main until the pull request merges. Next steps, in order: (1) MJ reviews and merges the pull request; delete the stacked branches; (2) a different agent verifies P1-04, P1-02 parts a and b, P1-16 and P1-06 parts a and b (section 7); (3) the documentation pull request (L-0176); (4) P1-06 part c, P1-07, P1-17, P1-15, P1-05. Gotchas: test files run in name order and share one database, so a file that commits territory assignments must end them in afterAll; the test database needs the en_US collation; the local activity check pairs the worktree log with any ref you give it.
**Evidence:** see L-0173.
**Rules touched:** section 11, H-23, H-24
**Next / needs:** MJ: L-0175 questions; review the pull request.

### L-0179 · 2026-10-29 12:15 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/docs-drift-fix · SESSION-START
**Task:** — (documentation follow-up, L-0176)    **Claim:** —
**What / why:** Checklist: (1) read this file in full, including the rules, board, claims, blockers, assumptions and the last 20 entries; (2) read docs 00, 02 to 06, 08 to 10, 12, 13, SPEC.md, the runbooks and the gate-0 checklist, the documents this task edits; (3) no active claim touches docs (C-001 holds scripts, migrations, tests, apps and runbooks of its own; this task edits two runbook sentences only, both about later tasks); (4) blockers B-13 and B-28 touch this task and are not changed by it; (5) baseline on branch claude/docs-drift-fix cut from main at 331fee4 (PR 12 merged); (6) local only: a throwaway Postgres 16 on this machine, nothing applied to staging, no production access.
**Evidence:** `pnpm install --frozen-lockfile` exit 0; `pnpm lint` exit 0; `pnpm typecheck` exit 0; `pnpm db:test` on a fresh en_US.UTF-8 database: 23 files, 1789 passed; `pnpm -r --if-present test`: packages/import 50 passed.
**Rules touched:** section 2, H-19, H-23
**Next / needs:** L-0180.

### L-0180 · 2026-10-29 12:15 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/docs-drift-fix · CLAIM
**Task:** — (documentation follows the merged code, L-0176)    **Claim:** C-010
**What / why:** MJ merged PR 12 and said to go ahead with the documentation pull request (L-0176). Scope: text only, no SQL, test or app code. Areas: SPEC.md, CLAUDE.md and AGENTS.md (identical, repository map only, Appendix A text untouched), docs 00, 02, 03, 04, 05, 06, 08, 09, 10, 13, the gate-0 checklist, the two runbooks, and in this file the P1-06 board row, two new blocker rows and the claim tables. The audit's 23 docs-drift findings are re-checked one by one against the SQL on main before any edit; findings already handled in PR 12 (L-0173 to L-0177) are not repeated. Planned finish today.
**Rules touched:** section 3, H-25
**Next / needs:** L-0181.

### L-0181 · 2026-10-29 12:20 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/docs-drift-fix · CORRECTION
**Task:** P1-02 (parts a and b), P1-06 (part a), P1-16    **Claim:** —
**What / why:** Corrects L-0147: its checklist line Docs match code was ticked, but doc 04 was not updated for migration 0009. The territory row said status (the column is active), the salon row said geo, frontage_photo_url and is_honeytoken (the columns are lat and lng; the other two are not built), salon_note said photo_url and lacked client_id, salon_contact lacked active, and stage_event listed 5 of the 7 trigger values (created and visit were missing). Only the frontage photo had been logged (L-0146, item 4). Also corrects citations that cannot be edited where they stand (migrations are frozen once merged, entries are append-only): the routes migration 0011 cites doc 08 section 2 for adding pins and reordering the route, it is section 3; the visits migration 0010 cites doc 08 section 3 for rule 7, it is section 4, item 7; L-0152 item 2 calls three visits without an order moving a salon to parked doc 08 rule 7, it is doc 02, Trial row; the visits migration message and table comment saying a rep may close an earlier open day are wrong, only the office force-closes it (app.rep_check_out closes today only); the orders migration 0012 header says part b replaces exposure, it did not (A-10, L-0174). If the rep-facing message matters it changes in a later forward migration.
**Rules touched:** section 4, H-25
**Next / needs:** L-0182.

### L-0182 · 2026-10-29 12:20 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/docs-drift-fix · BLOCKER
**Task:** — (documentation follow-up)    **Claim:** C-010
**What / why:** Two questions for MJ, raised while re-checking the docs; neither blocks building, both keep the code as built meanwhile. B-29: the rulebook text behind three built behaviours. H-14 says reps read through views and have no base-table access; the build uses capped app functions for salon data (DEVIATION L-0146, item 1) and own-row policies on rep_day, route, sales_order and its lines, delivery, delivery_line, invoice and the bag's stock rows. H-06 lists fewer append-only tables than are built (missing stock_count, demand_signal, route, sales_order_line, delivery, delivery_line, phone_reveal; adding them only tightens the rule). H-07 allows soft-delete flags only on configuration entities, while salon_contact.active retires a phone and keeps its history. Rule text is MJ's to change, so it is unchanged here; doc 04 and doc 06 now describe the code. B-30: doc 04 said a salon created from the map must have a pin; the database only requires lat and lng to be both set or both null, and the offline quick add (PIP-07) may have no GPS fix. Doc 04 now says so; a check constraint waits for MJ.
**Rules touched:** section 9, H-25, H-26
**Next / needs:** MJ: B-29 (reword H-06, H-07, H-14?) and B-30 (require a pin?).

### L-0183 · 2026-10-29 12:21 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/docs-drift-fix · PROGRESS
**Task:** — (documentation follows the merged code, L-0176)    **Claim:** C-010
**What / why:** Each audit finding was re-checked against the SQL on main before editing; edits are text only. Fixed: SPEC.md section 2 and feature map (statuses, SAL-04 moved to P1-06a, DEM-02 left with P1-17, invoice document row, biome.jsonc, the en_US collation and file-name test order, L-0144 cited, open MJ items in section 11); docs/00-README.md (the build is under way, D-20; SPEC.md linked); doc 04 rows for territory, area, salon, salon_note, salon_contact, stage_event, cycle_estimate, salon_credit, rep_day, sku, stock_movement (a broken table cell), stock_count, reorder_rule, stock_issue, a new phone_reveal row, invariants 1, 4, 5 and 12, and the closing note on views; doc 05 read path and principle 7; doc 06 section 4 (the illustrative policy, which reads are capped, which tables reps read directly); doc 03 SAL-01, PIP-02, PIP-09, ORD-01, ORD-03, CTL-09, DEM-01 (supply_short, office only); doc 02 Visited; doc 09 eligibility interim; docs 08, 10, 13 delivery acknowledgment (receiver's name, GPS, server time in Phase 1); gate-0 checklist (after Gate 0, the five check names); Excel and owner runbooks; CLAUDE.md and AGENTS.md repository map (kept identical). The P1-06 board row now lists SAL-04 and names its leftovers. Not changed: the doc 06 section 2 matrix (B-28) and rulebook text (B-29), both MJ's.
**Evidence:** `git diff --stat origin/main` shows only Markdown files; `cmp CLAUDE.md AGENTS.md` exit 0; `pnpm lint` exit 0; `pnpm typecheck` exit 0; `pnpm activity:check` OK; no SQL, test or app file changed, so the 1789-test baseline (L-0179) stands.
**Rules touched:** H-25
**Next / needs:** L-0184.

### L-0184 · 2026-10-29 12:21 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/docs-drift-fix · CLAIM-RELEASED
**Task:** — (documentation follows the merged code)    **Claim:** C-010
**What / why:** C-010 released (done): the row moved to the released table.
**Rules touched:** section 3
**Next / needs:** L-0185.

### L-0185 · 2026-10-29 12:21 PKT · Claude · Claude Code · session 01Y3chVrxi5r · branch claude/docs-drift-fix · HANDOFF
**Task:** — (documentation follow-up)    **Claim:** — (C-010 released)
**What / why:** State: branch claude/docs-drift-fix, from main at 331fee4, text only; pull request to main. Next steps, in order: (1) MJ reviews and merges it; (2) MJ answers B-28, B-29, B-30 and turns on branch protection with the five check names (B-13); (3) a different agent verifies P1-04, P1-02 parts a and b, P1-16 and P1-06 parts a and b (section 7); (4) P1-06 part c, the invoice document (ORD-05). Gotchas: never stack a pull request on a feature branch (L-0173); the stacked branches from PRs 5 to 11 can be deleted.
**Evidence:** see L-0183.
**Rules touched:** section 11
**Next / needs:** MJ: review the pull request; B-28, B-29, B-30, B-13.

---

## Appendix A — Text for `AGENTS.md` and `CLAUDE.md` at the repo root (task P0-09)

Both files carry the same content so every agent tool picks it up:

```
# Kiran DMS — READ THIS FIRST

Before doing ANYTHING in this repository you MUST:
1. Read docs/ACTIVITY.md in full (rules, status board, claims, blockers, log).
2. Log a SESSION-START entry, claim your task, and follow every hard rule (H-01…H-27).
3. Never touch production, secrets, real supplier data, or real personal data.
4. Never weaken or skip a security control (RLS, MFA, approvals, audit, append-only).
5. Log your results with real evidence and end with a HANDOFF entry.

Work without a log entry is treated as not done and may be reverted.
Unclear, conflicting, or needs a decision? STOP that task and log a BLOCKER for MJ.
```

## Appendix B — Quick reference: who may do what in the build

| Action | Builder agent | Verifier (different agent) | MJ |
|---|---|---|---|
| Claim and implement a task | Yes | — | Yes |
| Mark `DONE (self-reported)` | Yes | — | Yes |
| Mark `VERIFIED` | **No** | Yes | Yes |
| Mark `ACCEPTED` / sign a gate | **No** | **No** | **Yes** |
| Change a fixed decision / permission matrix / thresholds | **No** | **No** | **Yes** |
| Touch production | **No** | **No** | Approves (H-19) |
| Enter real supplier/salon/bank data | **No** | **No** | Human-only (§10) |
| Add or modify an existing log entry | **No** (append `CORRECTION`) | **No** | Append only |

## Appendix C — CI enforcement spec (task P0-09)

The CI job `activity-log-check` (`scripts/activity-log-check.mjs`) runs on every pull request and **fails** if any of these is true. Rules 1 to 5 were tightened after independent verification (L-0025, L-0030, L-0035, L-0042, L-0055, L-0061, L-0066, L-0071, L-0075, L-0085, L-0116; council audit L-0094; DEVIATIONs L-0044, L-0057, L-0063, L-0069, L-0073, L-0077, L-0087, L-0092, L-0095, L-0107, L-0122). The check is a tripwire, not a proof: branch protection and a reviewer who is not the author remain the real control.

0. The base commit cannot be resolved, or any git command fails (for example a diff too large to read). The check fails closed. An all-zero base (a branch's first push) falls back to the parent commit. An added file that cannot be read for scanning, or a changed path that is not valid UTF-8, also fails.
1. Any file other than `docs/ACTIVITY.md` changed, or `docs/ACTIVITY.md` changed outside the §16 log (rules, board, claims, blockers, assumptions, appendices), and there is no new `### L-NNNN` entry. (Tables §12–§15 may still change, but only alongside a log entry.)
2. The log is not strictly append-only, or `docs/ACTIVITY.md` breaks its narrow structure:
   - not exactly one §16 heading;
   - a carriage return not followed by a line feed, or any other control character except tab, anywhere in the file;
   - only unindented code fences open a code block (a closing fence may be indented up to 3 spaces and followed only by spaces or tabs, as in CommonMark); an indented opening fence is checked as ordinary text, and new log text may not contain any indented fence marker, inside or outside code;
   - a canonical entry header anywhere outside the §16 log;
   - raw HTML, HTML entities, HTML comments or setext (underlined) headings outside code; outside the §16 log, a tag opener (`<` then a letter, `/`, `!` or `?`) or an entity refuses the line even inside a code span and without a closing bracket, so placeholders there are written `{name}`;
   - the top-level section headings (`#` and `##`, outside code) differ from the base version (added, removed, renamed or reordered);
   - any line shaped like an entry (`… PKT · …`) that is not a canonical entry header;
   - the old log, blank lines included, is not an exact prefix of the new one (only its closing `---` and trailing blank lines may move);
   - new log text does not start with a new entry header, or contains any other heading, a blockquote at any nesting depth, or a heading inside a list item at any nesting depth; in new log text any indented heading, blockquote or setext underline is refused whatever the indentation (a block can nest in a list item by indentation alone); new log text may not contain `<`, `&` or a backslash outside fenced code, except in CommonMark autolinks (a URL or e-mail address in angle brackets), which the raw-HTML rule also allows;
   - a `---` separator anywhere but as the final line (code blocks excepted).
3. A new entry has a duplicate or non-sequential `L-NNNN` number; is missing the signature, type or task line, or the evidence line (for `DONE`, `VERIFIED`, `HANDOFF`, `PROGRESS`); has a signature that is not plain ASCII apart from the `·` separators; or its task line contains non-ASCII characters outside a small allowlist (en/em dash, §, ≠, ·, ×, …).
4. A `DONE` or `VERIFIED` entry lacks the security checklist block. A `VERIFIED` entry names no task, names a task that has no `DONE` entry (dashes in task ids are normalised first), has text on its task line shaped like a task id that is not one (such as `PO-04`, `P0-O4`, `P0-0l`, `P0-9`, `P0_09`, `P0.09`), or shares a signature with the `DONE` entry for any task it names. The §12 board is read the way GitHub renders tables: a table opens at a header row followed by a delimiter row with the same number of cells and ends at a blank line or a heading; a row may be indented and may omit its outer pipes; cells split on unescaped pipes; the Status column is found by its header. Each task has exactly one board row. A Status cell whose text changed from the base is plain text (ASCII plus the Task-line allowlist, no Markdown emphasis, code or escape characters). If a changed Status cell mentions VERIFIED in any form (any case, after NFKC and removing default-ignorable characters and emphasis), it must read exactly `VERIFIED (L-nnnn)`; the only other allowed mention is a reopen note of the form `was VERIFIED L-nnnn`. A new or changed board line that mentions VERIFIED but is not a task row in a table with a Status column is refused. The cited entry, whatever its type, must be a `VERIFIED` or `CORRECTION` entry that names the task, carries the security checklist, shares no signature with any `DONE` entry for the task (L-0097), and comes after the task's latest `DONE` entry (L-0121). Signatures count as shared when they are equal, one contains the other, or both carry the same `session {id}` (maker ≠ checker, §7; MJ ruling L-0029).
5. An added line contains a secret-looking value or supplier identifiers:
   - private keys, JWTs, `sb_secret_` keys or AWS keys;
   - connection strings with a password, including a password given as a URI query parameter or as a libpq `password` keyword, with or without spaces around `=` and quoted or not, on a line with another libpq keyword such as `host=` or `user=` (placeholders and `${…}` or `$VAR` references excepted);
   - secret-named assignments with a real-looking value (in source code only quoted literals count; template literals built from `${…}` do not; nor, for names that are not password- or secret-like, multi-part lowercase name-like values (at least one word segment; others may be short numbers or a letter plus digits) such as `kiran.outbox.v1`, `kiran:outbox:v1`, `kiran.invoice.fy2026` or `receipt-a5-v2`, or mixed-case values made only of whole words of 3+ letters, short acronyms, numbers of up to 4 digits and short V-versions, such as `NotoNastaliqUrdu-Regular`, `NotoNaskhArabicUI-Regular` or `KiranOutboxEncryptedV1` (digit runs count whole, so `KiranSms903718264519` is not a name), or token-named values containing spaces or parentheses such as a design token; skipped in test code (`supabase/tests/`, any `tests/`, `e2e/` or `__tests__/` directory, `*.test.*`, `*.spec.*`), i18n/locale files and Markdown);
   - supplier or cost wording outside `{timestamp}_vault*.sql` migrations, tests, docs, any path with a `vault/` directory segment except under a `public/` directory (MJ, L-0080, L-0091), and i18n, locale or translations directories (MJ, L-0080);
   - any term in the owner-maintained `KIRAN_SENSITIVE_TERMS` GitHub secret, matched after NFKC, ignoring case and every Unicode default-ignorable character, in added lines and in file paths;
   - the secret patterns, owner terms (in added lines and in the path of every file added or changed) and the `.env` rule below also apply to every commit in the range, merge commits included: a merge is read as a combined diff, so only files and lines that differ from every parent count, and a clean merge adds nothing (L-0105, L-0121). The other heuristics apply to the net diff. The OK output reports how many owner terms were checked;
   - the same patterns in every added file decoded as UTF-16 in both byte orders, BOM or not, and as UTF-32 when it starts with a UTF-32 byte-order mark (MJ, L-0091), scanned in full (files over 64 MB fail); the secret patterns and owner terms also run on these decodings of every file version added or changed by any commit in the range (L-0121).

   A file whose name starts with `.env` (any case), other than `.env.example`, is added or changed.

Branch protection requires this job and the RLS test suite to pass before merge. The typecheck job also builds the web app and runs `scripts/service-role-scan.mjs` (H-18): key names in `apps/` and `packages/` source, key values in the client bundle (L-0096). Merges to `main` require one reviewer who is not the author.
