# 09 — Payments, Credit and Installments

Installments are Kiran's competitive weapon with salons — and the biggest place money leaks. This document makes them precise.

## 1. Payment plans

Plans are templates the owner edits (ADM-01). Proposed defaults:

| Code | Name | Schedule (day 0 = delivery) | Who qualifies |
|---|---|---|---|
| `CASH` | Cash on delivery | 100% day 0 | Everyone |
| `INST2` | Two installments | 50% day 0 · 50% day 15 | Verified salons with limit ≥ order value (interim: until verification is built, salons the owner has made eligible by hand, MJ ACTIVITY L-0163) |
| `INST4` | Four installments | 25% day 0 · 25% day 10 · 25% day 20 · 25% day 30 | Verified salons with ≥ 3 on-time cycles, limit ≥ order value (interim: as for `INST2`) |

Notes:
- The owner may choose a variant with 0% at delivery (e.g., 4 × 25% at days 7/14/21/28). The template drives everything; no code change.
- Partial payments and early settlement are allowed; the schedule's remaining amounts recalculate oldest-first (PAY-11).
- An order's plan is chosen at order time and validated against the salon's `plan_eligibility` and `credit_limit` (ORD-02). The rep cannot change eligibility or limits.

### Worked example

Glamour Salon (Gulshan), eligibility `INST4`, limit Rs 60,000, exposure Rs 12,500.
Order on 3 Nov: 6 × color Rs 1,200, 2 × developer 1L Rs 1,800, 4 × treatment Rs 2,100 = Rs 7,200 + 3,600 + 8,400 = **Rs 19,200**. Exposure after order Rs 31,700 ≤ 60,000 → allowed. (All product names and prices here are dummy figures.)

| Installment | Due | Amount |
|---|---|---|
| 1 of 4 | 3 Nov (delivery) | Rs 4,800 — collected cash on the spot, receipt #R-26-00412 sent to 0300-xxx-7781 |
| 2 of 4 | 13 Nov | Rs 4,800 — reminder WhatsApp 11 Nov; appears on the rep's route 13 Nov |
| 3 of 4 | 23 Nov | Rs 4,800 |
| 4 of 4 | 3 Dec | Rs 4,800 |

On 13 Nov the salon pays Rs 7,000 by bank transfer (Meezan, ref 8841…). Allocation: Rs 4,800 to installment 2, Rs 2,200 to installment 3 (now partial, Rs 2,600 remaining). Receipt issued for Rs 7,000 showing the new schedule.

## 2. Credit rules

Credit is a privilege the system grants and withdraws from data, not a favour a rep hands out.

| Rule | Default (owner-configurable) |
|---|---|
| New salon (unverified) | Cash only |
| Verified salon, first order | `INST2` up to Rs 15,000 (ladies'/bridal), Rs 8,000 (men's/barber) — type-based starting limits |
| Graduation to `INST4` | After 3 consecutive on-time cycles (every installment paid within 3 days of due) |
| Automatic limit increase | +25% after each 3 on-time cycles, up to a type-based ceiling |
| Automatic limit decrease | −30% after any installment > 7 days late; eligibility drops one level after 2 late installments in 60 days |
| Blocked | Any installment > 30 days overdue → `Blocked`: cash only until settled and manually unblocked |
| Manager override | May raise a limit by ≤ 50% or unblock, with reason; max 2 overrides per salon per month; all in the owner digest (CTL-08) |
| Owner override | Any, with reason, logged |

Every change is a `credit_event`; the salon card shows the history.

## 3. Recording a payment

The write path is `app.record_payment()` (internal, never called by an app role) behind the wrapper RPCs `app.rep_record_payment` and `app.office_record_payment` (see the note below the list), which:

1. Requires an open `rep_day` and an approved device (reps).
2. Captures server time, client time, GPS, distance from the salon pin.
3. Requires `method`: `cash` or `bank_transfer` (bank name + reference mandatory; slip photo recommended; the app can OCR the reference later).
4. Allocates oldest-due-first. The rep choosing specific installments is the target; only oldest-first is built so far (see the note below the list).
5. Writes `payment`, `payment_allocation`, `cash_ledger_entry` (for cash), and creates a **receipt** row with a gapless number, to be sent to the salon's registered phone (CTL-01; the sending is not built yet).
6. Flags: distance > 300 m, time > 2 h after "arrived", round amounts repeated, amount ≠ any installment and ≠ total due (CTL-02, doc 13).

*Built in P1-07 part a (migration 0021, ACTIVITY L-0325/L-0327 and the payment reconciliation handoff):* the write path is two public wrapper RPCs, `app.rep_record_payment` (a rep: open day, approved device, own territories, GPS; cash or bank transfer) and `app.office_record_payment` (owner or manager: a bank transfer on behalf, always flagged `on_behalf`, never cash). Both call the internal `app.record_payment`, which no application role can execute; it is idempotent on `client_id` (one call per key at a time; an exact replay returns the same receipt, any changed persisted fact is refused) and does steps 4 and 5 of the list above. Step 5 creates the receipt row only (number, payment, salon, primary contact); **sending it is not built**: SMS and WhatsApp delivery wait for the adapter (B-08), so CTL-01 (delivery within 60 s) is still pending and a payment has no delivery record yet. Step 6: the distance and lateness flags are built (plus `no_visit`, `distance_unknown`, `mock_location`, `on_behalf`). *Office cash (migration 0024, MJ L-0362, B-37 resolved):* the owner or manager records cash collected from a salon with `app.office_record_cash`; it is allocated and receipted the same way, flagged `office_collected`, and the cash goes into the office pool, never a rep's ledger. The office salon page has the same Account section as the rep's, in office mode. Not built yet: the rep choosing specific installments, the round-amount flag (a detector, doc 13 D-04), the slip photo, advances above what is owed (section 10) and collection outside the rep's territory.

*Rep screen:* the rep's salon page (`/app/salons/[id]`) has an Account section that shows `app.salon_balance` and `app.salon_installments` and, when something is owed, records a cash or bank-transfer payment through `app.rep_record_payment` with the phone's GPS and one idempotency key per attempt, then shows the receipt number the database returns. Not offline yet (P1-09); no office payment screen.

Payments cannot be edited or deleted. The intended correction is a **reversal** that needs an approval from someone other than the maker, with a corrected receipt to the salon. **It is not built** (P1-07 part a): no reversal column or negative row exists, and the use-time rules for approvals are still open (KIR-14, D-25), so a mistaken payment can only be raised with the owner for now.

*Built in P1-30 (migration 20261105230000, D-48, MJ 2026-11-05; amends the paragraph above):* the owner or the manager reverses a recorded payment with a reason (`app.office_reverse_payment`, idempotent on `client_id`); a manager cannot reverse a payment they recorded, the owner can (also a database trigger), and there is no separate approval step. The payment and its receipt stay; an append-only `payment_reversal` row records who, when and why. From then on its allocations no longer count as paid anywhere a balance is derived (installment state, the allocation guard, ageing, credit exposure, the receipt and invoice documents, the salon portal), so the installments can be paid again. Cash leaves the ledger that holds it: the office pool for cash the office collected; for a rep's collection, the rep's ledger while the rep still holds it, the office's once a final handover was counted after the payment or the rep's ledger no longer covers it. The office salon page lists the salon's payments (receipt, method, recorder, the CTL-02 flags in words) with Reverse. Not built: a corrected receipt sent to the salon (B-08).

## 4. Receipts and statements — the salon as auditor

- **Receipt** per payment: number, date, salon, amount, method, remaining schedule, "This is your only valid proof of payment. Verify any receipt by sending its number to Kiran's WhatsApp". Sent within 60 s of recording (or on sync): the target; the sending is not built (B-08).
- **Monthly statement** to every salon with a balance: opening balance, invoices, payments, closing balance, upcoming installments, with a one-tap "Yeh ghalat hai / This is wrong" reply that opens a dispute visible to the owner (CTL-10).
- **Balance check on demand**: a salon can send "BALANCE" to Kiran's WhatsApp number and receive its current balance automatically.
- Why this matters: the salon has the opposite interest to a dishonest rep. If a rep pockets Rs 2,000 of a Rs 4,800 collection and records Rs 2,800, the salon's receipt says Rs 2,800 — and the salon objects. Collusion between rep and salon is then the only remaining route, and §7 of doc 13 covers it.

## 5. Cash handling and handover

- Rep cash position = Σ cash payments recorded − Σ handovers (visible to rep, manager, owner).
- **Handover** (CTL-03): manager enters counted cash; the system shows expected; the rep **acknowledges** on their own device. Variance requires a reason and is final only after acknowledgment. If the rep disputes, the handover locks as `disputed` for the owner.
- **Office cash** = Σ handovers − Σ bank deposits. Must be deposited within 2 working days (CTL-04). Deposits carry a slip photo and are matched to bank statement lines.

*Built (migration 0023, PAY-05, CTL-03; MJ L-0356):* `app.office_count_handover` (owner or manager with MFA) records the counted cash; the expected figure is the rep's ledger balance at that moment, computed by the database; a different count needs a reason. `app.rep_respond_handover` lets the rep, on the approved phone, acknowledge (final: the rep's ledger `out` of the expected amount, the office's `in` of the counted amount; the variance stays on the handover, A-15) or dispute with a reason (nothing moves; locked for the owner). While a rep has a pending or disputed handover, it cannot be counted again. Reads: `app.my_handovers`, `app.office_handovers`, `app.office_cash_position`. Screens: `/office/handovers` and `/app/handovers`. Not built: an open handover blocking the next day (doc 08) and the red banner (doc 02), bank deposits (CTL-04), petty expenses. *Built in P1-30 (migration 20261105230000):* the owner settles a disputed handover with a reason (`app.owner_settle_handover`, D-46): accept the counted amount (the difference stays recorded against the rep, as on an acknowledged handover) or the rep's amount (the difference is recorded as the office's); either way the cash moves as on an acknowledgment (A-15) and the rep can be counted again. The owner or the manager withdraws a count the rep has not answered (`app.office_withdraw_handover`; nothing moves). The intraday cash cap (CTL-17, D-47): `app.rep_record_payment` refuses a cash collection that would take the rep's cash in hand over `cash.intraday_cap_paisa` until a handover, and the office home lists reps at or over it.
- Petty expenses out of office cash are recorded as `expense` ledger entries with receipts; owner approval above a threshold.

## 6. Bank transfers and reconciliation

- Salons transfer only to **Kiran's company accounts** shown on the invoice (owner-only to change; CTL-16). Personal accounts and wallets are prohibited and salons are told so on every document.
- Each transfer payment must be **matched** to a bank statement line (CSV import, PAY-06) by amount + date window + reference. Matching is manager/owner work, assisted by auto-suggestions.
- Unmatched after 3 working days → exception in the digest; commission is not paid on unmatched transfers (CTL-13; the commission base is now delivered and invoiced value, D-31, so this control needs its own review).
- Statement lines with no recorded payment → "unknown receipt" task: find the salon, record the payment properly.
- Supplier payments are made from a separate account that is never imported (doc 07).

## 7. Overdue escalation ladder

| Days vs. due | System action | Human action |
|---|---|---|
| −2 | WhatsApp reminder to salon (opt-in) | — |
| 0 | Collection stop on rep's route | Rep collects |
| +3 | Red flag; rep must record an outcome (paid / promised date / not available) | Rep |
| +7 | Task for manager; salon flagged on dashboard | Manager calls salon |
| +15 | New installment orders blocked (cash only) | Rep informed; manager may negotiate a revised schedule (approval) |
| +30 | Salon → `Blocked`; owner digest | Owner/manager recovery plan; visit by manager |
| +60 | Receivable flagged for write-off review | **Owner-only** write-off decision; commission clawback |

Revised schedules (restructuring) are new installment rows referencing the old ones, approved by manager (not the selling rep) and visible to the owner.

## 8. Numbering and documents

- Invoices `INV-<FY>-<seq>` and receipts `R-<FY>-<seq>`, gapless per financial year starting 1 July (ADM-03). FY 2026-27 → `INV-27-000001`.
- Documents render only from `public` data (doc 07 §3). They show Kiran's company details, the official bank accounts, the schedule, and the receipt-verification line.
- Credit notes `CN-<FY>-<seq>` reference the invoice; write-offs `WO-<FY>-<seq>` are owner-only.

## 9. Reports

- Receivables ageing by salon / rep / territory (current, 1–7, 8–15, 16–30, 30+). *Built (migration 0022, PAY-07):* `app.office_receivables_ageing(p_group)` with `p_group` `salon`, `territory` or `rep`, for the owner or manager with MFA; reps are refused. Each installment's unpaid remainder is bucketed by days past its due date on Karachi's date: on or before the due date is current, then 1–7, 8–15, 16–30 and 31 or more. Grouped by rep, a salon counts under every rep currently assigned to its territory, and under a null rep when its territory has none (ACTIVITY A-14). The office page `/office/receivables` shows it with a salon / territory / rep switch. Not built: ageing as of a past date, and a rep's own ageing.
- Collection efficiency: collected within 7 days of due ÷ due.
- DSO; installment plan mix; default rate by salon type and territory.
- Cash position: reps, office, unmatched deposits; handover variance log.
- Credit events and overrides per manager (owner view).

## 10. Edge cases the design must handle

- Salon pays a lump sum covering several invoices → allocation across installments oldest-first, one receipt.
- Salon pays before delivery (advance) → `payment` with `unallocated` balance; auto-allocates when the invoice issues.
- Rep collects for a salon outside their territory (covering a colleague) → allowed with manager pre-approval; flagged otherwise.
- Returned goods on an installment order → credit note reduces outstanding installments latest-first; refund of cash already paid is a manager-approved `expense`-type ledger entry with the salon's acknowledgment.
- Salon closes down with balance → write-off review path; the owner decides.
- Bank transfer reference illegible → payment stays `unmatched`; task to manager; salon asked for the slip.
