# Money and Credit — module document (context `money-credit`)

This document is derived reference material written by the 2026-11-19 documentation audit. It never overrides the numbered planning documents, doc 16 or `docs/ACTIVITY.md` (ACTIVITY §1); doc 03 stays the index of requirement IDs and the source of every statement quoted here. Status is derived from the ACTIVITY §12 board and the evidence named, using the vocabulary in [docs/requirements/README.md](../../requirements/README.md#status-vocabulary).

## 1. Purpose and boundaries

Every rupee after an invoice: credit profile and events, installment plans, payments and allocations, receipts, the rep cash ledger, two-party handovers, office cash and deposits, reversals, the intraday cash cap, write-offs of receivables, and commission rates, calculation and payments.

**Outside this module:** Order creation and the credit check's caller (orders-delivery); investor money (cross-cutting CAP, kept separate by CAP-03); bank details (control-governance CTL-16).

## 2. Glossary

- **Exposure:** Unpaid installments of a salon; derived, never stored as an editable balance (H-10).
- **Handover:** The daily two-party count of a rep's cash: the manager counts, the rep acknowledges (CTL-03).
- **Receipt:** The system's numbered receipt; the only valid receipt (D-09).
- **Write-off (receivable):** Erasing a salon's debt; owner only (MJ 2026-11-19, PR 115).

## 3. Actors and permissions

Rep: records own collections at the salon, acknowledges handovers, reads own cash and commission. Manager: counts handovers, records office cash and transfers, reverses payments (never its own), raises limits within caps, sets commission rates. Owner: credit eligibility and limits, settles disputed handovers, receivable write-offs. Matrix: doc 06 §2 and doc 13 §9.

## 4. Owned entities and data

Tables owned (from the migrations on `main` at `d4b47ca`): `salon_credit`, `credit_event`, `installment`, `payment`, `payment_allocation`, `payment_reversal`, `receipt`, `cash_ledger_entry`, `handover`, `handover_response`, `handover_settlement`, `rep_commission_rate`, `commission_payment`. Ownership follows CONTEXT-MAP.md; no table is owned by two modules.

## 5. Functional requirements

21 requirements, in doc 03 order. Phase 1 requirements carry a full record; later-phase requirements carry their statement and status.

#### PAY-01

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Installment plan templates: CASH (100% on delivery), INST2, INST4 — percentages and day offsets configurable by O/Mg; each delivered order generates its installment schedule
- **Actor:** Owner (config, see DA-014); system
- **Preconditions:** Templates configured
- **Expected behaviour:** Templates CASH, INST2, INST4 with configurable percentages and offsets; each delivered order generates its schedule
- **Business rules:** B-05 defaults `[default-unconfirmed]`
- **Permissions:** Owner configures (as built)
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-PAY-01-1: Approving a delivery on INST4 creates four installments summing to the invoice total
- **Tests:** citing this ID: `payments.test.ts`; through its board task: `handovers.test.ts`, `office-cash.test.ts`, `payments.test.ts`, `receivables-ageing.test.ts`
- **Implementation evidence:** board: P1-07 (IN PROGRESS); `supabase/tests/payments.test.ts`
- **Open or related decisions:** B-05

#### PAY-02

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Record a payment against one or more installments: method (cash / bank transfer), amount, date; bank transfer requires bank name and reference; optional photo of slip
- **Actor:** Rep (at salon); owner or manager (on behalf)
- **Preconditions:** Open day for a rep; installment due
- **Expected behaviour:** A payment against one or more installments with method, amount, date; a transfer needs bank and reference
- **Business rules:** Integer paisa
- **Permissions:** Rep own; office on behalf
- **Failure and exceptions:** A transfer without a reference is refused; an overpayment is handled as per PAY-11
- **Acceptance criteria:**
  - AC-PAY-02-1: A bank transfer without a reference is refused
  - AC-PAY-02-2: A replay with the same client id records one payment
- **Tests:** citing this ID: `e2e-stack/office.spec.ts`, `office-cash.test.ts`, `payments.test.ts`, `verifier-attacks.test.ts`; through its board task: `handovers.test.ts`, `office-cash.test.ts`, `payments.test.ts`, `receivables-ageing.test.ts`
- **Implementation evidence:** board: P1-07 (IN PROGRESS); `components/money-section.tsx`; `supabase/tests/payments.test.ts`

#### PAY-03

**Priority:** M · **Phase:** 1 (generate) / S|2 (auto-send) · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Receipt with sequential number issued per payment; sent to salon on WhatsApp (and/or SMS)
- **Actor:** System
- **Preconditions:** Payment recorded
- **Expected behaviour:** A gapless numbered receipt per payment; sending by WhatsApp or SMS
- **Business rules:** Numbers per ADM-03
- **Permissions:** —
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-PAY-03-1: Each payment has exactly one receipt with the next number in its financial year
- **Tests:** citing this ID: `payments.test.ts`; through its board task: `audit-fixes.test.ts`, `b33-decisions.test.ts`, `e2e-stack/p130-screens.spec.ts`, `e2e/list-cap-note.spec.ts`, `e2e/time.spec.ts`, `handovers.test.ts`, `office-cash.test.ts`, `payments.test.ts`, `receivables-ageing.test.ts`
- **Implementation evidence:** board: P1-07 (IN PROGRESS); P1-30 (IN PROGRESS); `/app/receipts/[id]`; `supabase/tests/payments.test.ts`
- **Known gap:** Sending is not built (B-08; see DA-015)
- **Open or related decisions:** B-08

#### PAY-04

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Rep cash-in-hand ledger: increases on cash collected, decreases on handover; always visible to rep, Mg, O
- **Actor:** System; rep, office (read)
- **Preconditions:** —
- **Expected behaviour:** The rep's cash in hand rises on collection and falls on handover; visible to rep, manager and owner
- **Business rules:** Derived (H-10)
- **Permissions:** Rep own; office all
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-PAY-04-1: The balance equals the sum of the rep's `cash_ledger_entry` rows
- **Tests:** citing this ID: `e2e-stack/office.spec.ts`, `payments.test.ts`; through its board task: `handovers.test.ts`, `office-cash.test.ts`, `payments.test.ts`, `receivables-ageing.test.ts`
- **Implementation evidence:** board: P1-07 (IN PROGRESS); `supabase/tests/handovers.test.ts`

#### PAY-05

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Daily handover: Mg records counted cash; system computes variance; variance requires a reason and is logged to the rep's record; cannot be edited after save, only reversed with a new entry
- **Actor:** Manager (count); rep (acknowledge, CTL-03)
- **Preconditions:** Rep has cash
- **Expected behaviour:** The manager records counted cash; variance computed; a variance needs a reason; never edited, only reversed
- **Business rules:** —
- **Permissions:** Office counts
- **Failure and exceptions:** Variance without reason is refused
- **Acceptance criteria:**
  - AC-PAY-05-1: A count with a variance and no reason is refused
  - AC-PAY-05-2: UPDATE on a handover row fails
- **Tests:** citing this ID: `e2e-stack/office.spec.ts`, `handovers.test.ts`, `rls-matrix.test.ts`, `verifier-attacks.test.ts`; through its board task: `audit-fixes.test.ts`, `b33-decisions.test.ts`, `e2e-stack/p130-screens.spec.ts`, `e2e/list-cap-note.spec.ts`, `e2e/time.spec.ts`, `handovers.test.ts`, `office-cash.test.ts`, `payments.test.ts`, `receivables-ageing.test.ts`
- **Implementation evidence:** board: P1-07 (IN PROGRESS); P1-30 (IN PROGRESS); `supabase/tests/handovers.test.ts`

#### PAY-06

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Bank reconciliation: upload bank statement CSV; match transfers to recorded payments by amount/reference/date; flag unmatched
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### PAY-07

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Receivables ageing report (per salon, per rep, per territory)
- **Actor:** Owner or manager
- **Preconditions:** —
- **Expected behaviour:** Receivables ageing per salon, rep and territory
- **Business rules:** Derived
- **Permissions:** Office
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-PAY-07-1: The ageing total equals the sum of unpaid installments
- **Tests:** citing this ID: `e2e-stack/office.spec.ts`, `receivables-ageing.test.ts`, `verifier-attacks.test.ts`; through its board task: `handovers.test.ts`, `office-cash.test.ts`, `payments.test.ts`, `receivables-ageing.test.ts`
- **Implementation evidence:** board: P1-07 (IN PROGRESS); `/office/receivables`; `supabase/tests/receivables-ageing.test.ts`

#### PAY-08

**Priority:** S · **Phase:** 2 (timers) — M|1 (manual flags) · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Overdue escalation ladder (doc 02 / doc 09): reminders, route flags, Mg tasks, auto-block
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### PAY-09

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Credit limit rules: starting limits by salon type; automatic increase after N on-time cycles; automatic decrease on late payments; Mg/O manual override
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### PAY-10

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Payments and handovers are append-only; corrections are reversing entries
- **Actor:** System
- **Preconditions:** —
- **Expected behaviour:** Payments and handovers are append-only; corrections are reversing rows
- **Business rules:** H-06
- **Permissions:** —
- **Failure and exceptions:** UPDATE or DELETE fails
- **Acceptance criteria:**
  - AC-PAY-10-1: UPDATE or DELETE on `payment` and `handover` fails for every role
  - AC-PAY-10-2: A reversal adds a row and needs a reason
- **Tests:** citing this ID: `handovers.test.ts`, `payments.test.ts`; through its board task: `audit-fixes.test.ts`, `b33-decisions.test.ts`, `e2e-stack/p130-screens.spec.ts`, `e2e/list-cap-note.spec.ts`, `e2e/time.spec.ts`, `handovers.test.ts`, `office-cash.test.ts`, `payments.test.ts`, `receivables-ageing.test.ts`
- **Implementation evidence:** board: P1-07 (IN PROGRESS); P1-30 (IN PROGRESS); `supabase/tests/append-only-sweep.test.ts`

#### PAY-11

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Partial payments and early settlement supported; schedule recalculates
- **Actor:** Rep; office
- **Preconditions:** Installments exist
- **Expected behaviour:** Partial and early payments are allocated and the schedule recalculates
- **Business rules:** —
- **Permissions:** As PAY-02
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-PAY-11-1: A partial payment leaves the installment partly paid with the right remainder
- **Tests:** citing this ID: `payments.test.ts`, `receivables-ageing.test.ts`; through its board task: `handovers.test.ts`, `office-cash.test.ts`, `payments.test.ts`, `receivables-ageing.test.ts`
- **Implementation evidence:** board: P1-07 (IN PROGRESS); `supabase/tests/payments.test.ts`

#### CTL-01

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Every payment generates a system receipt delivered to the salon's registered phone (WhatsApp, SMS fallback) within 60 s of recording; paper receipts are not valid and invoices say so
- **Actor:** System
- **Preconditions:** Payment recorded; messaging provider (B-08)
- **Expected behaviour:** A receipt reaches the salon's registered phone within 60 s; paper receipts are invalid and invoices say so
- **Business rules:** D-09
- **Permissions:** —
- **Failure and exceptions:** Delivery failure is logged and retried
- **Acceptance criteria:**
  - AC-CTL-01-1: Receipt delivered to the registered phone within 60 s of recording
  - AC-CTL-01-2: The invoice states paper receipts are invalid
- **Tests:** citing this ID: `payments.test.ts`, `rep-detail-documents.test.ts`; through its board task: `e2e-stack/rep-detail-documents.spec.ts`, `handovers.test.ts`, `office-cash.test.ts`, `payments.test.ts`, `receivables-ageing.test.ts`, `rep-detail-documents.test.ts`
- **Implementation evidence:** board: P1-07 (IN PROGRESS); P1-28 (IN PROGRESS)
- **Known gap:** Phone delivery not built (B-08; DA-015)
- **Open or related decisions:** B-08

#### CTL-02

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Payments must be recorded at the salon: GPS and server time captured; a payment recorded > 300 m from the salon pin or > 2 h after the visit's "arrived" tap is flagged for manager review
- **Actor:** Rep
- **Preconditions:** Open visit
- **Expected behaviour:** Payment records GPS and server time; > 300 m from the pin or > 2 h after arrival is flagged
- **Business rules:** Flag, not block
- **Permissions:** —
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-CTL-02-1: A payment 400 m from the pin is flagged for review
- **Tests:** citing this ID: `payments.test.ts`; through its board task: `handovers.test.ts`, `office-cash.test.ts`, `payments.test.ts`, `receivables-ageing.test.ts`
- **Implementation evidence:** board: P1-07 (IN PROGRESS); `supabase/migrations/20261103154528_payments.sql` (`distance_from_pin_m`, flags); `supabase/tests/payments.test.ts` (CTL-02 flags)
- **Known gap:** Manager review screen for flagged payments not evidenced

#### CTL-03

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Daily handover is two-party: manager enters counted cash, rep acknowledges the figure in their own app before it is final; disagreement locks the handover for owner review
- **Actor:** Manager; rep
- **Preconditions:** Count entered
- **Expected behaviour:** The rep acknowledges the count in its own app before it is final; disagreement locks it for owner review
- **Business rules:** —
- **Permissions:** Office counts; rep answers
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-CTL-03-1: A handover is not final until the rep acknowledges
  - AC-CTL-03-2: A disagreement is settled only by the owner (`app.owner_settle_handover`)
- **Tests:** citing this ID: `e2e-stack/office.spec.ts`, `handovers.test.ts`, `rls-matrix.test.ts`, `verifier-attacks.test.ts`; through its board task: `audit-fixes.test.ts`, `b33-decisions.test.ts`, `e2e-stack/p130-screens.spec.ts`, `e2e/list-cap-note.spec.ts`, `e2e/time.spec.ts`, `handovers.test.ts`, `office-cash.test.ts`, `payments.test.ts`, `receivables-ageing.test.ts`
- **Implementation evidence:** board: P1-07 (IN PROGRESS); P1-30 (IN PROGRESS); `supabase/tests/handovers.test.ts`

#### CTL-04

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Cash in office is a tracked balance; every bank deposit is recorded with slip photo and matched to a bank statement line; cash in office older than 2 working days triggers an owner alert
- **Actor:** Owner or manager
- **Preconditions:** Cash in office
- **Expected behaviour:** Cash in office is a tracked balance; each bank deposit has a slip photo and is matched to a statement line; cash older than 2 working days alerts the owner
- **Business rules:** —
- **Permissions:** Office
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-CTL-04-1: A deposit reduces cash in office by its amount
  - AC-CTL-04-2: Cash older than 2 working days raises an owner alert
- **Tests:** citing this ID: none; through its board task: `handovers.test.ts`, `office-cash.test.ts`, `payments.test.ts`, `receivables-ageing.test.ts`
- **Implementation evidence:** board: P1-07 (IN PROGRESS)
- **Known gap:** Deposits not built (P1-07)

#### CTL-08

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Credit limit overrides and salon unblocking by the manager are logged with reason, capped per salon per month, and listed in the daily digest
- **Actor:** Owner or manager
- **Preconditions:** Salon blocked or at limit
- **Expected behaviour:** Overrides and unblocks are logged with a reason, capped per salon per month, listed in the digest
- **Business rules:** Caps per doc 13 §9
- **Permissions:** Office
- **Failure and exceptions:** Exceeding the cap is refused for the manager
- **Acceptance criteria:**
  - AC-CTL-08-1: An override without a reason is refused
  - AC-CTL-08-2: A manager's override beyond the monthly cap is refused
- **Tests:** citing this ID: `audit-fixes.test.ts`, `orders.test.ts`; through its board task: `audit-fixes.test.ts`, `b33-decisions.test.ts`, `crm-attacks.test.ts`, `deliveries.test.ts`, `e2e-stack/p130-screens.spec.ts`, `e2e/list-cap-note.spec.ts`, `e2e/time.spec.ts`, `invoice-document.test.ts`, `orders.test.ts`
- **Implementation evidence:** board: P1-06 (IN PROGRESS); P1-30 (IN PROGRESS); `components/salon-credit.tsx`; `supabase/tests/audit-fixes.test.ts` (CTL-08 cap)

#### CTL-10

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Monthly statement to every salon with a balance, from the system, with a one-tap "this is wrong" reply that creates an owner-visible dispute
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### CTL-13

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Commission is calculated on delivered and invoiced value of orders assigned to the rep (D-31; brought into Phase 1 by ACTIVITY L-0385); clawback on write-offs; new-salon bonus only after the salon's second paid order. The rate is per rep and salon with a rep default, stamped at delivery approval; commission payments are recorded separately (D-38, FLD-06). Built in slice 5 (migration 20261105140000, not verified): `invoice.commission_rate_bp` is stamped in `app.finalise_delivery`, the salon assignment's rate for the order's assigned rep, else the rep's default, else 0; the clawback on write-offs waits for write-offs (P1-08) and the new-salon bonus is Phase 2
- **Actor:** System; office (rates)
- **Preconditions:** Delivery approved
- **Expected behaviour:** Commission on delivered and invoiced value at the stamped rate; clawback on write-offs; new-salon bonus after the second paid order
- **Business rules:** D-31, D-38
- **Permissions:** Office sets rates
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-CTL-13-1: Commission for an invoice equals its value times the rate stamped at approval
- **Tests:** citing this ID: `commission.test.ts`; through its board task: `commission.test.ts`
- **Implementation evidence:** board: P1-22 (IN PROGRESS); `supabase/tests/commission.test.ts`
- **Known gap:** Clawback and bonus not built

#### CTL-17

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Intraday cash cap: when a rep's cash in hand exceeds a configurable threshold (default Rs 50,000), the rep's new cash collections are refused until a handover (or bank deposit) is recorded, and the manager is notified (reps no longer place orders, D-30; MJ, ACTIVITY L-0377)
- **Actor:** System
- **Preconditions:** Configured threshold (default Rs 50,000)
- **Expected behaviour:** Above the threshold a rep's new cash collections are refused until a handover or deposit; the manager is notified
- **Business rules:** —
- **Permissions:** —
- **Failure and exceptions:** Collection over the cap is refused
- **Acceptance criteria:**
  - AC-CTL-17-1: A cash payment that would exceed the cap is refused
- **Tests:** citing this ID: `audit-fixes.test.ts`; through its board task: `audit-fixes.test.ts`, `b33-decisions.test.ts`, `e2e-stack/p130-screens.spec.ts`, `e2e/list-cap-note.spec.ts`, `e2e/time.spec.ts`, `handovers.test.ts`, `office-cash.test.ts`, `payments.test.ts`, `receivables-ageing.test.ts`
- **Implementation evidence:** board: P1-07 (IN PROGRESS); P1-30 (IN PROGRESS); `supabase/tests/audit-fixes.test.ts`
- **Known gap:** Manager notification not built (MSG-03)

#### FLD-03

**Priority:** M/S · **Phase:** 1–2 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Commission plans: a rate per rep and salon with a rep default that pre-fills, set and changed by the owner or manager, for future invoices only, earned on delivered and invoiced value of assigned orders (D-31 as amended by D-38); the rep's own read-only view of earned, paid, owed and history for a date range is Phase 1; optional bonus for new salons and the monthly commission statement stay Phase 2. Built in slice 5 (not verified): the default rate in `rep_commission_rate` (`app.office_set_commission_rate`, with a reason), the salon rate on `salon_rep_assignment.rate_bp` (slice 1), `app.my_commission(from, to)` and `/app/commission`. Not built: the default does not pre-fill the salon rate fields on the office approval and salon pages; it applies at delivery approval when the salon's assignment has no rate for the rep
- **Actor:** Owner or manager (rates); rep (own read)
- **Preconditions:** Rep exists
- **Expected behaviour:** A commission rate per rep and salon with a rep default, for future invoices only; the rep reads its own earned, paid, owed and history
- **Business rules:** Rate stamped at delivery approval (CTL-13); bonus and statement Phase 2
- **Permissions:** Office sets; rep reads own
- **Failure and exceptions:** A rep reading another rep's commission is refused
- **Acceptance criteria:**
  - AC-FLD-03-1: A rate change affects only invoices issued after it
  - AC-FLD-03-2: `app.my_commission` returns only the caller's figures
- **Tests:** citing this ID: `e2e-stack/office.spec.ts`, `commission.test.ts`; through its board task: `commission.test.ts`
- **Implementation evidence:** board: P1-22 (IN PROGRESS); `/office/commission`, `/app/commission`; `supabase/tests/commission.test.ts`

#### FLD-06

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Commission payment history: the office (owner or manager) records append-only commission payments and reversals with reasons; earned stays derived from invoices; owed is earned minus paid; separate from investor money (D-38, OQ-34). Built in slice 5 (not verified): `commission_payment`, `app.office_record_commission_payment` (refused above what is earned and unpaid, 23514), `app.office_reverse_commission_payment` (full, once, reason 5 to 500), `app.office_commission`, `app.office_commission_reps`, `/office/commission`; no checker (OQ-34 default)
- **Actor:** Owner or manager
- **Preconditions:** Earned commission exists
- **Expected behaviour:** Commission payments and reversals are append-only with reasons; owed = earned − paid
- **Business rules:** No second person (OQ-34 open)
- **Permissions:** Office
- **Failure and exceptions:** A payment above earned and unpaid is refused
- **Acceptance criteria:**
  - AC-FLD-06-1: Recording more than earned minus paid is refused
  - AC-FLD-06-2: A reversal needs a reason and adds a row; nothing is edited
- **Tests:** citing this ID: `e2e-stack/office.spec.ts`, `commission.test.ts`, `overviews.test.ts`, `rep-detail-documents.test.ts`; through its board task: `commission.test.ts`, `e2e-stack/overviews.spec.ts`, `e2e-stack/rep-detail-documents.spec.ts`, `invoice-composer-signature.test.ts`, `overviews.test.ts`, `rep-detail-documents.test.ts`
- **Implementation evidence:** board: P1-22 (IN PROGRESS); P1-26 (IN PROGRESS); P1-28 (IN PROGRESS); P1-31 (IN PROGRESS); `supabase/tests/commission.test.ts`
- **Open or related decisions:** OQ-34

## 6. Business rules

Rules cited by this module's requirements: D-09, D-30, D-31, D-38, H-06, H-10, H-22. Their text and single source are in [business-rules.md](../../requirements/business-rules.md); thresholds are doc 13 §9, permissions are doc 06 §2.

## 7. User journeys

- J-MC-1 Collection at the salon (PAY-02, CTL-02): payment with GPS, receipt (PAY-03).
- J-MC-2 Daily handover (PAY-05, CTL-03): count, acknowledge or dispute, owner settles.
- J-MC-3 Office cash and bank deposit (CTL-04): deposits not built.
- J-MC-4 Commission (CTL-13, FLD-03, FLD-06): rate stamped at approval, payments recorded.

Full journeys with steps: [journeys-and-workflows.md](../../requirements/journeys-and-workflows.md).

## 8. Cross-module interactions

Installments are created by delivery approval (orders-delivery). Payments need an open rep day (field-operations). The digest and approvals live in control-governance.

## 9. Security requirements

Money in integer paisa; payments, handovers and the cash ledger append-only (H-06); reversals need a reason and never by the recorder (D-48); cash cap refuses new collections (CTL-17); commission and investor money never mixed (CAP-03).

## 10. Failure scenarios

- Payment over the cash cap: refused until handover or deposit.
- Handover disagreement: locked for owner review.
- Payment recorded far from the pin or late: flagged, not blocked (CTL-02).
- Refund request: no requirement exists (DA-027).
- Receipt cannot be sent to the phone: no channel yet (DA-015).

## 11. Acceptance criteria

26 criteria (IDs `AC-<requirement>-<n>`) are in the records above and in the [acceptance criteria matrix](../../audit/2026-11-19/05-acceptance-criteria-matrix.md).

## 12. Dependencies

Messaging provider (B-08); bank accounts (B-06); installment shapes and credit limits (B-05); commission payout authority (OQ-34).

## 13. Implementation status and evidence

| Requirement | Phase | Status | Board tasks | Tests citing the ID |
|---|---|---|---|---|
| PAY-01 | 1 | PARTIALLY IMPLEMENTED | P1-07 | 1 |
| PAY-02 | 1 | PARTIALLY IMPLEMENTED | P1-07 | 4 |
| PAY-03 | 1 (generate) / S|2 (auto-send) | PARTIALLY IMPLEMENTED | P1-07, P1-30 | 1 |
| PAY-04 | 1 | PARTIALLY IMPLEMENTED | P1-07 | 2 |
| PAY-05 | 1 | IMPLEMENTED — NOT VERIFIED | P1-07, P1-30 | 4 |
| PAY-06 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| PAY-07 | 1 | PARTIALLY IMPLEMENTED | P1-07 | 3 |
| PAY-08 | 2 (timers) — M|1 (manual flags) | DEFERRED — FUTURE PHASE | — | 0 |
| PAY-09 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| PAY-10 | 1 | IMPLEMENTED — NOT VERIFIED | P1-07, P1-30 | 2 |
| PAY-11 | 1 | PARTIALLY IMPLEMENTED | P1-07 | 2 |
| CTL-01 | 1 | PARTIALLY IMPLEMENTED | P1-07, P1-28 | 2 |
| CTL-02 | 1 | PARTIALLY IMPLEMENTED | P1-07 | 1 |
| CTL-03 | 1 | IMPLEMENTED — NOT VERIFIED | P1-07, P1-30 | 4 |
| CTL-04 | 1 | PARTIALLY IMPLEMENTED | P1-07 | 0 |
| CTL-08 | 1 | IMPLEMENTED — NOT VERIFIED | P1-06, P1-30 | 2 |
| CTL-10 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| CTL-13 | 1 | PARTIALLY IMPLEMENTED | P1-22 | 1 |
| CTL-17 | 1 | PARTIALLY IMPLEMENTED | P1-07, P1-30 | 1 |
| FLD-03 | 1–2 | IMPLEMENTED — NOT VERIFIED | P1-22 | 2 |
| FLD-06 | 1 | IMPLEMENTED — NOT VERIFIED | P1-22, P1-26, P1-28, P1-31 | 4 |
