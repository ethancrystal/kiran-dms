# 08 — Field Sales Team and Rep Controls

The whole point of Kiran DMS is to let the company put salespeople on the road who are **productive in days and trustworthy by design**. This document is the operating manual for that, and the list of what the system must do to support it.

## 1. Who to hire

A rep for this business walks or bikes a territory, talks to salon owners and head stylists, carries a bag of product worth a day or two of sales, handles cash, and uses a phone app all day. Hire for:

- Comfort with salons and parlors (both ladies' and men's) — many salon owners are women; a mixed team widens reach.
- Honesty signals: verifiable references, a CNIC copy, a guarantor, a local address in or near the territory.
- Basic smartphone fluency and Roman Urdu/Urdu literacy.
- Stamina and route discipline over sales flair; the system supplies the pitch and the schedule.

Pay structure (proposal, to be set by the owner): modest fixed salary + commission on **collected and banked** cash (not on invoiced sales) + a bonus per new salon that places a **second paid** order. This alignment is itself an anti-fraud control: fake orders, uncollected sales and churned "new" salons earn nothing.

## 2. Onboarding — from offer to first order in one working day

| Step | What happens | System support |
|---|---|---|
| 1. Profile | Owner creates the user (owner-only): name, phone, CNIC (encrypted), photo, emergency contact, guarantor, commission plan, start date | FLD-01 |
| 2. Device | Rep installs the PWA on their (approved) phone; first login via an email one-time code (ACTIVITY L-0101) registers the device; manager approves it | SEC-03 |
| 3. Territory | Manager assigns one territory and the route days | PIP-01, PIP-04 |
| 4. Training (half day) | The in-app checklist walks the rep through: check-in, map and pins, nearby discovery, visit outcomes, building an order, payment plans and credit limits, recording cash vs. transfer, receipts to WhatsApp, bag stock, evening handover and stock close, and the **rules** in §4 | FLD-04 |
| 5. Stock | Manager issues starter bag stock within the bag value limit; rep confirms count in-app | INV-03, CTL-05 |
| 6. First day shadowed | Manager rides along for the first route; the route is seeded with 5–8 existing active salons and 5+ prospects | PIP-03 |
| 7. Probation | 30 days: lower bag limit, no credit-plan orders above a small cap without approval, daily manager review of the scorecard | FLD-02 |

## 3. The rep's week

- **Mon–Sat:** one route per day from the territory's route days; the app builds a draft route from due reorders, collections, at-risk salons, deliveries, and a prospect quota (e.g., 4 new prospects/day). The rep can add pins from the map or nearby discovery and re-order the route.
- **Daily check-in** (bag count confirmed) → route → **daily handover + stock close** with the manager. No exceptions: an open handover blocks the next day.
- **Weekly:** scorecard review with the manager (visits, productive visits, new prospects, conversions, reorder rate, collection rate, variances). Random **spot check** of bag stock at least once a week, recorded in-app (CTL-05). Random **balance confirmation calls** by owner/manager to 3–5 of the rep's salons (CTL-11).
- **Monthly:** commission statement generated from banked collections; owner approves payout; territory and credit-limit reviews.

## 4. Rules every rep signs (and the app enforces)

1. **No paper receipts, ever.** Only the system's numbered receipt sent to the salon's registered WhatsApp/SMS is valid. Invoices say so in Urdu and English. A rep handing out any other receipt is dismissed.
2. **Record payment at the salon, immediately.** The app captures GPS and time; recording far from the salon or hours later is flagged (CTL-02).
3. **Cash is Kiran's from the moment it is received.** It is handed over the same day; the rep acknowledges the counted figure in their own app (CTL-03). Variance is the rep's responsibility.
4. **Stock in the bag is Kiran's.** Daily close must match. Shortfalls are recovered from commission (policy) and investigated.
5. **Prices come from the app.** No verbal discounts; any price below list needs manager approval in the app before the invoice (CTL-07).
6. **Only official bank accounts.** Salons pay transfers to Kiran's accounts printed on the invoice; a rep never gives a personal account or wallet number. Transfers are matched to the bank statement; unmatched transfers earn no commission (CTL-13).
7. **Every visit is logged with an outcome**, including "not present" and "not interested". The app only credits a visit when "arrived" was tapped on site.
8. **Salon data stays in the app.** No copying lists, no sharing screenshots, no personal notebooks of salon phones. The app masks phone numbers and logs every reveal (SEC-06, MAP-12).
9. **One person, one device, one login.** No sharing of phones or OTPs (SEC-03).
10. **Returns and damages are reported, not handled.** Returned goods go into the bag's quarantine section and are handed to the warehouse with a photo (CTL-12).

## 5. Custody of cash — the chain

```
Salon ──cash──▶ Rep bag        payment (GPS, time, receipt to salon)       cash_ledger: rep +
Rep  ──cash──▶ Office          handover (manager counts, rep acknowledges)  cash_ledger: rep −, office +
Office ─cash─▶ Bank            bank_deposit (slip photo)                    cash_ledger: office −, bank +
Bank statement line ◀── match  reconciliation (owner/manager, within 3 working days)
```

Every arrow is a recorded event with two parties or an external document. The owner's dashboard shows the three balances (reps, office, unmatched deposits) at all times; any of them growing stale is an alert (CTL-04).

## 6. Custody of stock — the chain

```
Vault goods receipt ──▶ Warehouse ──issue──▶ Rep bag ──delivery──▶ Salon
                                 ◀─return──          ◀─return (quarantine)──
Daily: rep bag expected vs counted (stock close)   Weekly: random spot check   Monthly: warehouse stock-take
```

- **Bag value limit** per rep (probation lower) caps exposure (CTL-05).
- **Issue** and **return to warehouse** are two-party: manager records, rep confirms in-app.
- **Delivery** creates the movement at the moment of handing over, with the salon's acknowledgment (OTP to salon phone or signature) so a salon cannot later claim non-delivery and a rep cannot claim a delivery that did not happen.
- **Adjustments** never happen from a rep's phone; variances become `adjustment` movements only through approval (CTL-06).

## 7. Performance management

The scorecard (FLD-02, KPIs in doc 02) drives a simple ladder:

| Signal | Action |
|---|---|
| Visits/day below target for a week | Manager ride-along; route review |
| Conversion low but visits high | Pitch coaching; check prospect quality (are they real hair businesses?) |
| Collection rate < 85% | Review credit decisions on their salons; cap new credit-plan orders |
| Any cash variance | Investigation the same day; second variance in a month → probation; third → dismissal (policy) |
| Any stock variance | Same as cash |
| Anomaly flags (doc 13) | Case opened by owner; rep informed only after review |
| Strong results for 3 months | Bag limit up; discount request authority up to a small %; territory expansion; bonus |

## 8. Offboarding — the 10-minute runbook (SEC-08)

1. Owner opens the user → **Offboard**.
2. System: suspends login, revokes all sessions and devices (cached data unreadable on next contact, auto-wiped in 7 days).
3. System snapshots: cash in hand (should be 0 after last handover), bag stock expected, open installments on their salons, pending approvals.
4. Manager counts returned bag stock → return movement; any shortfall becomes a case and a payroll deduction record.
5. Owner reassigns territories; the system re-generates routes for the new rep.
6. The system sends the affected salons a message from Kiran introducing the new rep and restating that only system receipts are valid — so the old rep cannot keep collecting "on Kiran's behalf".
7. Final commission statement computed on banked collections to date, minus deductions; owner approves.
8. Honeytoken salons assigned to that rep are retired and replaced.

## 9. What the system must provide (summary of requirements this doc depends on)

FLD-01…05, PIP-01…11, MAP-01…13, PAY-04/05, INV-02…05, CTL-01…18, SEC-03/06/08, RPT-01/03.

## 10. Independent agents (D-15 to D-17)

Kiran runs two field channels side by side:

| | Salaried rep (sections 1 to 9) | Independent agent |
|---|---|---|
| Whose stock | Kiran's, until a salon buys it | The agent's, from the moment of purchase |
| Pays Kiran | Hands over what salons paid, every evening | Pays in full, cash or matched transfer, **before** stock leaves the warehouse (A-07) |
| Price | Salon list price | Agent price per SKU, set by the owner (AGT-02, OQ-17) |
| Reports back | Visits, orders, collections, handover, bag counts | **Nothing required**: no visits, handover, counts or salon list. Optionally a pre-order request (D-23) |
| Sees in the app | Own territory's salons (masked), own bag, routes | Own purchases, the agent catalogue with availability (quantities only). Never salons, other agents, cost or supplier |
| Earns | Salary + commission on banked cash (D-10) | Their own resale margin only |
| Risk to Kiran | Custody (cash, stock) | Almost none: paid before release, so there is no receivable and nothing to reconcile |

**Who can be an agent:** anyone who wants to (D-17), women included, for example someone running a home-based parlor or serving parlors in their own area. The owner creates every agent account (governance, H-15) with minimum identity data (OQ-20). Agents sign in like reps (email code, approved device).

**What makes an agent purchase safe:** it is a cash-and-carry sale at the warehouse counter. The office records the purchase, cash is counted (or the transfer is matched) before release, the stock movement is `sale_to_agent`, and the agent gets a numbered invoice and receipt on their phone. A shortfall (the agent wanted more than is available) is recorded as lost demand (DEM-02).

**Legal line (A-06):** Kiran pays agents nothing for recruiting other agents: no joining fee, no referral bonus, no override on another agent's purchases. SECP treats MLM, referral marketing and pyramid schemes as unlawful under section 301 of the Companies Act 2017, and its 2025 draft regulations exempt only direct selling where pay comes mainly from sales to end customers. An agent earns from reselling to salons, nothing else.

**Open questions for the owner:** agent price (OQ-17), whether agents may sell to Kiran's direct salons (OQ-18), who is served first when the supplier is short (OQ-19), identity data kept (OQ-20).

