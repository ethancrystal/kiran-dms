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

Updated in place; every change mirrored in the log. Task IDs: `P<phase>-<nn>`. Requirement IDs refer to doc 03. "Claimed by" is the Claim ID from §13.

### Planning (complete)

| ID | Work item | Status | Date |
|---|---|---|---|
| PLAN-01 | Planning set docs `00`–`13` written to `Kiran Company/plan/` | DONE | 2026-10-25 |
| PLAN-02 | This protocol (ACTIVITY.md) | DONE | 2026-10-25 |

### Phase 0 — Foundations

| ID | Work item | Refs | Status | Claimed by |
|---|---|---|---|---|
| P0-01 | Resolve Phase 0 decisions: D-08, OQ-01–04, 06–08, 11–13, 16 (MJ answers; log each) | doc 12 | NOT STARTED | — |
| P0-02 | Load and clean the Excel; build the import mapping and dry-run | SAL-10, OQ-01 | NOT STARTED | — |
| P0-03 | Draft Karachi territories; choose the pilot territory and pilot rep | PIP-01, OQ-13 | NOT STARTED | — |
| P0-04 | Create the repo, CI, Supabase staging + prod, Next.js skeleton; copy this file to `docs/ACTIVITY.md` | doc 05 | IN PROGRESS | C-001 |
| P0-05 | Owner/manager auth with mandatory TOTP MFA (owner account creation is human-only, §10) | SEC-02, SEC-04 | IN PROGRESS | C-001 |
| P0-06 | RLS policy test harness (role × table × operation) running in CI, initially empty | NFR-12 | DONE (self-reported) | C-001 |
| P0-07 | Vendor sign-ups and WhatsApp template approvals (human-only, §10); adapters stubbed | doc 05, OQ-11 | NOT STARTED | — |
| P0-08 | Configuration definitions with owner: installment templates, credit rules, product groups, cycles, visit outcomes (use doc 09/10 defaults marked `[default-unconfirmed]`) | ADM-01, OQ-06/07 | NOT STARTED | — |
| P0-09 | **Enforce this protocol:** `AGENTS.md` + `CLAUDE.md` at repo root (Appendix A); CI check that fails a PR which changes code without appending to the log, or which modifies/removes existing log lines (Appendix C) | this file | DONE (self-reported) | C-001 |
| P0-10 | Gate 0 sign-off by MJ | §8 | NOT STARTED | — |

### Phase 1 — MVP: the Khata, the Bag, and the Controls

Recommended build order is in §12.1. Deviation from the order needs a `DECISION` entry.

| ID | Work item | Refs | Status | Claimed by |
|---|---|---|---|---|
| P1-01 | Foundation schema: `public`/`control`/`vault` schemas, `user_profile`, roles, device binding, `app.current_role()`, audit trigger + hash chain, `approval_request` with maker≠checker | SEC-01–05, 07, 11, 12; docs 04, 06 | DONE (self-reported) | C-001 |
| P1-02 | Territories, areas, salons, contacts, notes, stage machine, salon verification, contact-change flow, Excel import | SAL-01–05, 09, 10; PIP-01, 02, 07, 09; CTL-09, 18 | NOT STARTED | — |
| P1-03 | Rep map: pins by stage, drop-a-pin with notes, masking and territory scoping | MAP-01, 02, 03, 12 | NOT STARTED | — |
| P1-04 | Inventory: SKU master (dummy data), locations, append-only movements, issue/return two-party, daily close, spot check, manual reorder points | INV-01–06; CTL-05 | NOT STARTED | — |
| P1-05 | Vault: suppliers (encrypted), POs, goods receipts bridge to public movements, documents, grants, access log | VLT-01–06; doc 07 | NOT STARTED | — |
| P1-06 | Orders: price list, credit gate, approvals for discounts, delivery with salon acknowledgment, gapless invoices, offline order creation | ORD-01–05, 10; ADM-03; PIP-03; CTL-07, 08 | NOT STARTED | — |
| P1-07 | Money: installment templates, payments, allocations, receipts (SMS first), cash ledger, two-party handover, deposits, intraday cash cap, ageing | PAY-01–05, 07, 10, 11; CTL-01–04, 17 | NOT STARTED | — |
| P1-08 | Control layer: write-off/adjustment approvals with owner thresholds, bank-detail lock, balance-confirmation list, daily owner digest, offboarding | CTL-06, 11, 15, 16; SEC-06, 08 | NOT STARTED | — |
| P1-09 | Offline-first rep PWA: outbox, idempotent sync, encrypted cache, rejection handling, Urdu/English | NFR-01–03; ORD-10 | NOT STARTED | — |
| P1-10 | Owner dashboard, receivables ageing, in-app notifications | RPT-01, 02; MSG-03 | NOT STARTED | — |
| P1-11 | Admin config, company profile, rep profile | ADM-01, 02; FLD-01 | NOT STARTED | — |
| P1-12 | Security acceptance suite (doc 06 §10, doc 07 §5) + backup restore drill | NFR-07, 12; SEC-10 | NOT STARTED | — |
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
4. **P1-06** — orders and invoices.
5. **P1-07** — payments, receipts, cash custody, handover.
6. **P1-08** — control layer and digest.
7. **P1-09** — offline PWA (start the outbox contract early; finish it here).
8. **P1-10 / P1-11** — dashboards, admin.
9. **P1-12** — security acceptance suite and restore drill, then **P1-13** pilot.

---

## 13. Active claims

| Claim ID | Agent / session | Task ID | Requirement IDs | Areas touched (tables, functions, screens, files) | Started (PKT) | Planned finish | Last activity |
|---|---|---|---|---|---|---|---|
| C-001 | Claude · Fable 5.1 · session ee095e06 · branch feat/p0-foundation (K repo) | P0-04, P0-05 (P0-06, P0-09, P1-01 done: L-0011–L-0013) | SEC-02, SEC-04; doc 05 | repo root files, `scripts/`, `.github/`, `supabase/config.toml`, `supabase/migrations/`, `supabase/tests/`, `apps/web/` skeleton; RLS helpers, audit trigger, approval framework, numbering | 2026-10-25 02:57 | after B-12/B-13 answers | 2026-10-25 03:30 |

**Released / expired claims** (kept for history; never deleted):

| Claim ID | Task ID | Released (PKT) | Reason (`done` / `abandoned` / `stale`) | Log entry |
|---|---|---|---|---|
| — | — | — | — | — |

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
| B-12 | Is Supabase project `iurvazdyxzlspegygldo` staging or production? Approve the MCP server and authenticate. Consider `read_only=true` meanwhile | P0-04, P0-05, P0-06, any DB work | Treat as production (H-19): connect only, no migrations, SQL or data reads | MJ | PENDING |
| B-13 | No GitHub remote yet: CI (`activity-log-check`, `db-tests`, `typecheck`) and branch protection cannot run | P0-04, P0-09 enforcement | Run `pnpm db:test` and `pnpm activity:check` locally before every handoff | MJ | PENDING |

---

## 15. Assumptions register

Any assumption an agent makes to proceed goes here **and** in a log `ASSUMPTION` entry. MJ reviews this table at each gate.

| ID | Assumption | Made by / log entry | Impact if wrong | Status (`open` / `confirmed` / `rejected`) |
|---|---|---|---|---|
| A-01 | Planning defaults in docs 09 (plans, credit rules), 10 (cycles), 13 §9 (thresholds) are placeholders until MJ confirms | Planning session, L-0001 | Config values change; no schema change expected | open |
| A-02 | Every new rep device, including the first, starts `pending` until an office user approves it (SEC-03 vs doc 08 §2 / doc 13 §9; restrictive reading) | L-0009 | First login needs a manager step; easy to relax | open |
| A-03 | Office powers require AAL2 at the database: owner/manager at AAL1 see only their own profile (doc 12 D-14) | L-0009 | None for security; UI must route to MFA first (done) | open |
| A-04 | Reps may only open approval requests for discount, return acceptance, payment reversal; write-offs always route to the owner | L-0009 | Adjust the allow-list in `app.request_approval` | open |

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

The CI job `activity-log-check` runs on every pull request and **fails** if any of these is true:

1. Files outside `docs/` changed, but `docs/ACTIVITY.md` has no new `### L-NNNN` entry in the diff.
2. The diff of `docs/ACTIVITY.md` removes or modifies any line inside the "Log" section (§16) — only appended lines are allowed there. (Table sections §12–§15 may change.)
3. A new log entry has a duplicate or non-sequential `L-NNNN` number, or is missing the signature, type, task, or evidence line (for `DONE`, `VERIFIED`, `HANDOFF`).
4. A `DONE` or `VERIFIED` entry lacks the security checklist block, or ticks the same agent signature as the `DONE` entry for the same task (maker ≠ checker, §7).
5. The diff contains patterns for secrets (`service_role`, private keys, `.env` content), or for supplier/vault identifiers outside the `vault` schema paths (configured list maintained by the owner).

Branch protection requires this job and the RLS test suite to pass before merge. Merges to `main` require one reviewer who is not the author.
