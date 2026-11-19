# Cross-cutting functional requirements (not yet placed in a context)

This document is derived reference material written by the 2026-11-19 documentation audit. It never overrides the numbered planning documents, doc 16 or `docs/ACTIVITY.md` (ACTIVITY §1); doc 03 stays the index of requirement IDs and the source of every statement quoted here. Status is derived from the ACTIVITY §12 board and the evidence named, using the vocabulary in [docs/requirements/README.md](README.md#status-vocabulary).

CONTEXT-MAP.md leaves reporting (RPT), messaging (MSG) and administration (ADM) unplaced, and does not place the investor ledger (CAP). They stay here until MJ places them (finding DA-043).

#### RPT-01

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Owner dashboard (mobile-first): today's sales, today's collections, cash in reps' hands, overdue total, low-stock count, reps checked in. A first part is built in slice 9 (P1-26, D-43, not verified): the office home with orders placed this week, waiting to be delivered, delivered and needs-your-attention, and Rep performance; the figures named here are not all on it yet
- **Actor:** Owner
- **Preconditions:** —
- **Expected behaviour:** Mobile-first dashboard of today's sales, collections, cash with reps, overdue, low stock, reps checked in
- **Business rules:** —
- **Permissions:** Office
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-RPT-01-1: Each figure equals its source query
- **Tests:** citing this ID: `overviews.test.ts`; through its board task: `audit-fixes.test.ts`, `b33-decisions.test.ts`, `e2e-stack/overviews.spec.ts`, `e2e-stack/p130-screens.spec.ts`, `e2e/list-cap-note.spec.ts`, `e2e/time.spec.ts`, `overviews.test.ts`
- **Implementation evidence:** board: P1-10 (NOT STARTED); P1-26 (IN PROGRESS); P1-30 (IN PROGRESS); `/office`; `supabase/tests/overviews.test.ts`
- **Known gap:** Only part of the figures are on the page (P1-26)

#### RPT-02

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Receivables ageing; sales by territory/product/salon type; stock by location
- **Actor:** Owner or manager
- **Preconditions:** —
- **Expected behaviour:** Receivables ageing; sales by territory, product and salon type; stock by location
- **Business rules:** —
- **Permissions:** Office
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-RPT-02-1: Report totals equal the ledger totals
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-10 (NOT STARTED); `/office/receivables`
- **Known gap:** Sales-by reports not built

#### RPT-03

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Pipeline funnel and stage movement
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### RPT-04

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Margin reports (vault-gated)
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### RPT-05

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Accountant export pack: sales register, receipts register, receivables, stock valuation (CSV/XLSX)
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### MSG-01

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Send receipt to salon on WhatsApp (template message) with SMS fallback
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none
- **Open blocker B-08:** WhatsApp number and SMS sender (OQ-11). On main: PENDING; in PR 115 (not merged): no change
- **Open or related decisions:** B-08

#### MSG-02

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Pre-due installment reminders and reorder nudges, opt-in per salon
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### MSG-03

**Priority:** M · **Phase:** 1 (in-app) / S|2 (push/WhatsApp) · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Internal notifications to Mg/O: variance, overdue thresholds, new-device requests, failed syncs
- **Actor:** System
- **Preconditions:** —
- **Expected behaviour:** In-app notifications to the office for variance, overdue, new devices, failed syncs
- **Business rules:** Push and WhatsApp Phase 2
- **Permissions:** Office
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-MSG-03-1: A new-device request creates an in-app notification for the office
- **Tests:** citing this ID: `order-steps-reminders.test.ts`; through its board task: `order-steps-reminders.test.ts`
- **Implementation evidence:** board: P1-10 (NOT STARTED); P1-38 (IN PROGRESS; merged in PR 110 at 7016fd9; no reminder runner)
- **Known gap:** Not built (P1-10)
- **Open blocker B-61:** Reminder e-mail service, sender and cadence. On main: PENDING; in PR 115 (not merged): interim placeholders; nothing sent
- **Open or related decisions:** B-61

#### MSG-04

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** All outbound messages logged on the salon timeline
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### ADM-01

**Priority:** M/S · **Phase:** 1–2 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Configure: installment templates, credit rules, product groups and default cycles, visit outcome codes, territories, commission plans (commission rates: owner or manager, D-31)
- **Actor:** Owner (config, see DA-014); owner or manager (commission rates)
- **Preconditions:** —
- **Expected behaviour:** Configure templates, credit rules, product groups and cycles, visit outcomes, territories, commission plans
- **Business rules:** —
- **Permissions:** See DA-014
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-ADM-01-1: A manager call to `app.owner_set_config` is refused
- **Tests:** citing this ID: `e2e-stack/office.spec.ts`, `foundation.test.ts`; through its board task: `audit-fixes.test.ts`, `b33-decisions.test.ts`, `e2e-stack/p130-screens.spec.ts`, `e2e/list-cap-note.spec.ts`, `e2e/time.spec.ts`
- **Implementation evidence:** board: P0-08 (VERIFIED); P1-11 (NOT STARTED); P1-30 (IN PROGRESS); `/office/settings`
- **Open blocker B-14:** How reps get plan lists and taxonomies. On main: PENDING (moot under D-30); in PR 115 (not merged): no change
- **Open blocker B-41:** Manager edits product groups and default cycles. On main: PENDING; in PR 115 (not merged): DECIDED (D-62, manager may)
- **Open or related decisions:** B-14, B-41

#### ADM-02

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Company profile for documents (name, logo, address, phone)
- **Actor:** Owner
- **Preconditions:** —
- **Expected behaviour:** Company profile for documents: name, logo, address, phone
- **Business rules:** —
- **Permissions:** Owner
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-ADM-02-1: Documents show the configured company profile
- **Tests:** citing this ID: none; through its board task: `audit-fixes.test.ts`, `b33-decisions.test.ts`, `e2e-stack/p130-screens.spec.ts`, `e2e/list-cap-note.spec.ts`, `e2e/time.spec.ts`
- **Implementation evidence:** board: P1-11 (NOT STARTED); P1-30 (IN PROGRESS)
- **Known gap:** Not built (P1-11)
- **Open blocker B-06:** Company bank accounts (OQ-08). On main: PENDING; in PR 115 (not merged): no change
- **Open or related decisions:** B-06

#### ADM-03

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Numbering sequences for invoices and receipts (gapless, per financial year starting 1 July)
- **Actor:** System
- **Preconditions:** —
- **Expected behaviour:** Gapless invoice and receipt numbers per financial year from 1 July
- **Business rules:** H-11
- **Permissions:** —
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-ADM-03-1: Numbers have no gap within a financial year and restart on 1 July
- **Tests:** citing this ID: `crm-attacks.test.ts`, `deliveries.test.ts`, `foundation.test.ts`; through its board task: `crm-attacks.test.ts`, `deliveries.test.ts`, `invoice-document.test.ts`, `orders.test.ts`
- **Implementation evidence:** board: P1-06 (IN PROGRESS); `control.doc_counter`; `supabase/tests/payments.test.ts`

#### CAP-01

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Owner or manager records investors and append-only investments, with money in paisa, office only; no investor login or portal
- **Actor:** Owner or manager
- **Preconditions:** AAL2
- **Expected behaviour:** Investors and append-only investments in paisa, office only; no investor login
- **Business rules:** D-40
- **Permissions:** Office
- **Failure and exceptions:** Reps read nothing
- **Acceptance criteria:**
  - AC-CAP-01-1: A rep call to an investor function is refused
- **Tests:** citing this ID: `investors.test.ts`; through its board task: `investors.test.ts`, `reverify-slices-1-3.test.ts`, `verify-slices-1-3.test.ts`
- **Implementation evidence:** board: P1-20 (IN PROGRESS); `/office/investors`; `supabase/tests/investors.test.ts`

#### CAP-02

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Owner or manager types each profit decision (no formula) and records append-only payouts and reversals with reasons; totals are derived
- **Actor:** Owner or manager
- **Preconditions:** Investment exists
- **Expected behaviour:** Typed profit decisions and append-only payouts and reversals with reasons; totals derived
- **Business rules:** No formula (D-40); OQ-34
- **Permissions:** Office
- **Failure and exceptions:** Reversal without reason refused
- **Acceptance criteria:**
  - AC-CAP-02-1: A payout reversal without a reason is refused
- **Tests:** citing this ID: `investors.test.ts`, `overviews.test.ts`; through its board task: `e2e-stack/overviews.spec.ts`, `investors.test.ts`, `overviews.test.ts`, `reverify-slices-1-3.test.ts`, `verify-slices-1-3.test.ts`
- **Implementation evidence:** board: P1-20 (IN PROGRESS); P1-26 (IN PROGRESS); `supabase/tests/investors.test.ts`
- **Open or related decisions:** OQ-34

#### CAP-03

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Investor money stays separate from commission and is not posted to the cash ledger; OQ-23, OQ-26, OQ-27 and OQ-28 stay open with MJ and MJ's advisers
- **Actor:** —
- **Preconditions:** —
- **Expected behaviour:** Investor money is separate from commission and not posted to the cash ledger
- **Business rules:** OQ-23, 26, 27, 28 open
- **Permissions:** —
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-CAP-03-1: No investor entry adds a `cash_ledger_entry` row
- **Tests:** citing this ID: `investors.test.ts`; through its board task: `investors.test.ts`, `reverify-slices-1-3.test.ts`, `verify-slices-1-3.test.ts`
- **Implementation evidence:** board: P1-20 (IN PROGRESS); `supabase/tests/investors.test.ts`
- **Open or related decisions:** OQ-23, OQ-26, OQ-27, OQ-28
