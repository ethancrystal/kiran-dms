# 09 — Payments, Credit and Installments

Installments are Kiran's competitive weapon with salons — and the biggest place money leaks. This document makes them precise.

## 1. Payment plans

Plans are templates the owner edits (ADM-01). Proposed defaults:

| Code | Name | Schedule (day 0 = delivery) | Who qualifies |
|---|---|---|---|
| `CASH` | Cash on delivery | 100% day 0 | Everyone |
| `INST2` | Two installments | 50% day 0 · 50% day 15 | Verified salons with limit ≥ order value |
| `INST4` | Four installments | 25% day 0 · 25% day 10 · 25% day 20 · 25% day 30 | Verified salons with ≥ 3 on-time cycles, limit ≥ order value |

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

The only way to record a payment is `app.record_payment()` from the rep (or manager/owner) app, which:

1. Requires an open `rep_day` and an approved device (reps).
2. Captures server time, client time, GPS, distance from the salon pin.
3. Requires `method`: `cash` or `bank_transfer` (bank name + reference mandatory; slip photo recommended; the app can OCR the reference later).
4. Allocates oldest-due-first unless the rep selects specific installments.
5. Writes `payment`, `payment_allocation`, `cash_ledger_entry` (for cash), and queues a **receipt** with a gapless number to the salon's registered phone (CTL-01).
6. Flags: distance > 300 m, time > 2 h after "arrived", round amounts repeated, amount ≠ any installment and ≠ total due (CTL-02, doc 13).

Payments cannot be edited or deleted. A mistake is corrected by a **reversal** (negative payment referencing the original) that needs an approval from someone other than the maker, and the salon receives a corrected receipt.

## 4. Receipts and statements — the salon as auditor

- **Receipt** per payment: number, date, salon, amount, method, remaining schedule, "This is your only valid proof of payment. Verify any receipt by sending its number to Kiran's WhatsApp". Sent within 60 s of recording (or on sync).
- **Monthly statement** to every salon with a balance: opening balance, invoices, payments, closing balance, upcoming installments, with a one-tap "Yeh ghalat hai / This is wrong" reply that opens a dispute visible to the owner (CTL-10).
- **Balance check on demand**: a salon can send "BALANCE" to Kiran's WhatsApp number and receive its current balance automatically.
- Why this matters: the salon has the opposite interest to a dishonest rep. If a rep pockets Rs 2,000 of a Rs 4,800 collection and records Rs 2,800, the salon's receipt says Rs 2,800 — and the salon objects. Collusion between rep and salon is then the only remaining route, and §7 of doc 13 covers it.

## 5. Cash handling and handover

- Rep cash position = Σ cash payments recorded − Σ handovers (visible to rep, manager, owner).
- **Handover** (CTL-03): manager enters counted cash; the system shows expected; the rep **acknowledges** on their own device. Variance requires a reason and is final only after acknowledgment. If the rep disputes, the handover locks as `disputed` for the owner.
- **Office cash** = Σ handovers − Σ bank deposits. Must be deposited within 2 working days (CTL-04). Deposits carry a slip photo and are matched to bank statement lines.
- Petty expenses out of office cash are recorded as `expense` ledger entries with receipts; owner approval above a threshold.

## 6. Bank transfers and reconciliation

- Salons transfer only to **Kiran's company accounts** shown on the invoice (owner-only to change; CTL-16). Personal accounts and wallets are prohibited and salons are told so on every document.
- Each transfer payment must be **matched** to a bank statement line (CSV import, PAY-06) by amount + date window + reference. Matching is manager/owner work, assisted by auto-suggestions.
- Unmatched after 3 working days → exception in the digest; commission is not paid on unmatched transfers (CTL-13).
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

- Receivables ageing by salon / rep / territory (current, 1–7, 8–15, 16–30, 30+).
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
