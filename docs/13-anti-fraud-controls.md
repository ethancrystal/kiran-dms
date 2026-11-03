# 13 — Anti-Fraud and Control Framework

**Standard:** nobody — rep, manager, salon, or outsider — can take money or stock out of Kiran, hide a debt, grant an unearned discount or credit, or leak the salon list or the supplier, without it being **prevented** by the system or **surfaced to the owner within 24 hours** with enough evidence to act. Where prevention is impossible (people can always lie), the design makes the lie expensive: it needs two or more parties with opposite interests to agree, and it leaves a trail.

This document goes actor by actor and scheme by scheme. Each scheme lists how it works, what **prevents** it, what **detects** it if prevention fails, and how Kiran **responds**. Requirement IDs refer to doc 03 (`CTL-*`, `SEC-*`, etc.).

## 1. Five principles

1. **Nothing is edited or deleted.** Money, stock, visits, stage changes, approvals and audit rows are append-only. A mistake is corrected by a new, attributed, approved reversing entry. There is no "fix the number" anywhere in the system, for anyone.
2. **Every unit and every rupee has a custody chain**, and every handoff needs **two parties** (or an external document): salon ↔ rep (receipt), rep ↔ manager (handover acknowledged on the rep's own device), office ↔ bank (deposit slip matched to the statement), warehouse ↔ rep (issue confirmed by the rep).
3. **The party with the opposite interest confirms.** The salon receives a system receipt and a monthly statement; the bank statement confirms deposits and transfers; the rep confirms what the manager counted. Nobody confirms their own work.
4. **Maker ≠ checker.** High-risk actions need approval, the approver can never be the initiator, and the owner is the final checker for anything that destroys value (write-offs, adjustments above threshold, price lists, bank details, users).
5. **The owner sees exceptions every morning.** A digest lists every override, adjustment, variance, discount, credit note, unblock, contact change, new device, failed sync, vault read and anomaly flag from the last 24 h. Controls that nobody looks at are decoration; the digest is designed to be read in 15 minutes.

## 2. Why the manager must be below the owner for this to work

MJ's starting position was "manager has the same privileges as the owner". With identical privileges, the manager can commit *and* conceal: adjust stock to cover theft, write off a friend's debt, change the bank account on invoices, read the audit log, create a user. No control can stop a person who can also switch the controls off. The fix is small and surgical (decision D-08, pending confirmation): the manager keeps **everything needed to run the business day to day**, and the owner alone holds **governance** — user accounts, company bank details, write-offs, price lists, commission plans, vault grants, system configuration, and read access to the full audit log and anomaly flags. The manager's operational actions are all logged into a trail the manager cannot touch, and the risky ones appear in the owner's digest the next morning.

If the owner is unavailable for days at a time, approvals queue; cash-only sales continue; nothing is lost but speed. A second owner account (disabled by default) exists for continuity (OQ-03).

## 3. The three custody chains

```
MONEY   Salon ─payment+receipt─▶ Rep ─handover (2-party)─▶ Office ─deposit+slip─▶ Bank ◀─statement match
STOCK   Vault receipt ─▶ Warehouse ─issue (2-party)─▶ Rep bag ─delivery (salon OTP)─▶ Salon
                                  ◀─return (2-party)─        ◀─return via quarantine─
DATA    Salon list / phones: territory-scoped, masked, reveal-logged, no export, honeytokens
        Supplier: vault schema, encrypted, grant-only, access-logged, physical receiving rules
```

Every link is a recorded event. Balances are derived by summing the links, never stored as editable numbers. A nightly integrity job re-derives everything and flags drift.

## 4. Scheme catalogue — reps

| # | Scheme | How it works | Prevent | Detect | Respond |
|---|---|---|---|---|---|
| R1 | **Skim a collection** | Collect Rs 4,800, record Rs 2,800, pocket Rs 2,000 | System receipt to the salon's phone shows Rs 2,800 (CTL-01); salon objects. Paper receipts banned and salons told only system receipts count | Monthly statement to salon (CTL-10); random balance-confirmation calls (CTL-11); salon "BALANCE" query; installment ageing | Case; recover from pay; dismissal policy |
| R2 | **Collect and don't record at all** | Take cash, give nothing, tell the salon "I'll record it later" | Payment must be recorded at the salon with GPS/time (CTL-02); salons know no receipt = not paid | Installment becomes overdue → escalation ladder reaches manager at +7 and owner at +30 (doc 09 §7); balance confirmations; statement disputes | Case; recovery; dismissal |
| R3 | **Lapping** (use salon B's cash to cover salon A's earlier skim) | Rotating shortfalls so no single salon shows a gap for long | Each payment is tied to a salon, GPS, time and receipt; cash position reconciled daily to zero (CTL-03) — there is no float to rotate | Detector: payments recorded far from the salon or in evening bursts; receipts delivered to phones that don't match the paying salon's pattern | Case |
| R4 | **Record cash as "bank transfer"** with a fake reference, keep the cash | Payment looks complete; no cash expected at handover | Transfer payments must match a statement line within 3 working days (PAY-06); until matched, no commission (CTL-13; the base changed under D-31 to delivered and invoiced value, so this control is to be re-reviewed); receipt tells the salon the method recorded | Unmatched-transfer rate per rep (detector D-07); salon reads "bank transfer" on receipt for cash they paid | Case; deduction |
| R5 | **Off-book sale from bag stock** | Deliver product, take cash, record nothing | Bag stock is counted at daily close against expected (CTL-05); any unit missing is a variance charged to the rep | Daily close variance; weekly random spot check; sell-through anomalies (salon buying less than its cycle while rep's bag empties) | Case; deduction; dismissal |
| R6 | **Under-deliver** | Invoice 6 tubes, hand over 5, keep 1 | Delivery acknowledgment by the salon (OTP to salon phone or signature; Phase 1: the receiver's name with GPS and server time (MJ, ACTIVITY L-0163); the OTP comes with the SMS adapter) listing quantities (ORD-04/doc 08 §6) | Bag stock surplus at close; salon disputes | Case |
| R7 | **Fake salons / fake orders** to earn commission or bonus | Create non-existent salons, book orders | Commission on **banked** cash only, not invoices (CTL-13; the base changed under D-31 to delivered and invoiced value, so delivery approval D-32 and the second-paid-order bonus rule carry this control); new-salon bonus only after the salon's **second paid order**; salon verification by OTP + manager call before any credit (CTL-09); photo + GPS on creation | Salons with no visits after creation; salons created in clusters at one GPS; identical phones across salons | Remove; case |
| R8 | **Fake visits / GPS spoofing** | Tap "arrived" from home with a mock-location app | Mock-location detection flag (PIP-11/doc 06 §8); photo at visit; outcomes must be consistent with orders/collections; nearby discovery requires a live fix (MAP-11) | Detector: visits with identical coordinates, visits with no order/collection for weeks, speed between stops impossible, device reports mock location | Ride-along; probation |
| R9 | **Unauthorised discounts** to friends; pocket the difference or win favours | Sell below list | Rep discount authority 0% by default (CTL-07); any lower price needs manager approval before the invoice; prices come from the server | Discount frequency per rep; same salons repeatedly discounted | Review; revoke any discount authority |
| R10 | **Grant credit to risky salons** (friends, relatives) | Put a new salon on 4 installments | Credit check is a hard stop (ORD-02); eligibility and limits are data the rep cannot change; unverified salons are cash-only | Default rate by rep; salons created by rep X defaulting | Review limits; case |
| R11 | **Take the salon list to a competitor** | Export or photograph lists; keep a notebook of phones | RLS: own territories only (SAL-09); phones masked in lists, revealed one at a time with a log (SEC-06); no export; page caps; map pins outside territory shown as counts (MAP-12) | Reveal-phone volume per rep; honeytoken salons (fake records only that rep can see) receiving contact (SEC-09); sudden churn of a rep's salons after they leave | Legal/disciplinary; territory re-contact campaign from the system |
| R12 | **Fake returns** (with or without salon) | Record a return, keep the goods, salon's debt drops | Returns go to quarantine and must be physically accepted by the manager at the warehouse (CTL-12); credit note only after acceptance | Return rate per rep/salon; quarantine ageing | Case |
| R13 | **Claim robbery / loss of cash** | "I was mugged" | Intraday cash cap: when cash in hand exceeds a threshold (e.g., Rs 50,000) the rep must hand over or deposit before continuing (CTL-17); route design keeps collections spread | Frequency; pattern vs. collections | Police report required; case; insurance if any |
| R14 | **Share login / second device** | Someone else works the account | Device binding; one approved device; OTP to a company SIM where possible (SEC-03) | Concurrent sessions from different fingerprints | Revoke; case |
| R15 | **Backdate or edit after the fact** | Change yesterday's record to fit today's story | Append-only; server time authoritative; client time stored for forensics (doc 04 invariants) | Large client-vs-server time gaps; offline entries that sync days late | Case |
| R16 | **Collect from a salon after leaving Kiran** | Ex-rep keeps visiting "on behalf of Kiran" | Offboarding sends every affected salon a system message naming the new rep and restating the receipt rule (SEC-08); salons can send "WHO" to get their assigned rep's name and photo | Salon reports; balance confirmations | Legal |

## 5. Scheme catalogue — manager

| # | Scheme | How it works | Prevent | Detect | Respond |
|---|---|---|---|---|---|
| M1 | **Fake the handover count** | Record Rs 20,000 when the rep gave Rs 25,000; pocket Rs 5,000 (variance pinned on the rep) | Handover is two-party: the rep must **acknowledge** the counted figure on their own device before it is final; disagreement locks it for the owner (CTL-03) | Disputed handovers; office cash vs deposits | Owner reviews; case |
| M2 | **Pocket office cash** | Hold cash, deposit less or later | Office cash is a tracked balance; deposits need a slip photo and must match the bank statement (CTL-04); cash older than 2 working days alerts the owner | Owner's dashboard shows office cash and unmatched deposits daily; monthly owner check against the real bank portal | Case |
| M3 | **Adjust stock to cover theft** | Post an `adjustment` to make the count match | Adjustments need reason + photo; above a threshold they need **owner approval**; the maker cannot approve (CTL-06); every adjustment is in the digest | Adjustment frequency and value per month (detector D-09); monthly joint stock-take with the owner | Case |
| M4 | **Write off a debt** for a friend or in exchange for a kickback | Credit note or receivable write-off erases the balance | **Write-offs are owner-only**; credit notes above threshold need owner approval (CTL-06); all in the digest | Credit notes per manager; salons written off that keep ordering | Owner review |
| M5 | **Divert salon bank transfers** | Change the bank account printed on invoices to one the manager controls | Company bank details are **owner-only** with MFA re-auth and notification (CTL-16) | Statement import shows no inflows; salons report paying | Owner |
| M6 | **Change a salon's phone number** to one the manager (or a colluding rep) controls, so receipts and statements never reach the real salon | Then R1/R2 become possible | Contact changes require OTP to the **new** number **and** a notice to the **old** number ("your Kiran contact number was changed — reply NO if this wasn't you"); changes appear in the digest (CTL-18); the same phone on multiple salons is an anomaly | Detector D-11; balance-confirmation calls made to the number on the frontage photo/Google listing, not only the stored one | Case |
| M7 | **Override credit for friends; unblock defaulters** | Raise limits, unblock, restructure | Overrides capped (≤ 50%, ≤ 2 per salon per month), reason required, all in digest (CTL-08); restructures need approval from someone other than the selling rep | Override counts; default rate on overridden salons | Owner review; revoke override capability (owner can lower manager's caps) |
| M8 | **Price manipulation** | Lower list prices or create "special pricing" for a salon they are connected to | **Price lists are owner-only**; special pricing requires owner approval | Price-list change log in digest | Owner |
| M9 | **Create a fake rep or a second account** to receive stock or cash | Divert issues to a ghost | **User creation is owner-only**; stock issues require the receiving rep to confirm on an approved device | Users with no device, no visits | Owner |
| M10 | **Hide salons** (park them, then sell to them privately) | Mark active salons as "Parked / not interested" | Manual stage changes need a reason and are logged; parked salons resurface after 90 days automatically | Stage overrides per manager; salons parked with recent orders | Owner review |
| M11 | **Approve own requests** | Request a discount/adjustment and approve it | Database constraint `checker ≠ maker` on every approval (SEC-11) | — | — |
| M12 | **Tamper with records or the audit log** | Edit history | No application role can write the audit log; hash-chained; mirrored nightly to owner-controlled write-only storage (SEC-12); append-only everywhere | Chain verification failure | Incident |
| M13 | **Leak the supplier** | Read vault data and pass it on | Vault access is a revocable grant; every read logged with purpose; documents watermarked; physical receiving rules (doc 07) | Vault reads in digest; unusual read patterns (detector D-12) | Revoke grant; legal |
| M14 | **Record payments "on behalf of" reps** to manufacture or hide collections | Manager enters payments for salons they never visited | Allowed but **flagged** and in the digest; receipts still go to the salon | Volume of on-behalf payments | Owner review |
| M15 | **Fake bank statement import** | Upload a doctored CSV to "match" fake transfers | Import files are hashed and kept; the owner reconciles monthly against the live bank portal (policy); matched totals must equal the bank's closing balance movement | Mismatch in monthly owner check | Case |
| M16 | **Neglect the controls** (skip handovers, spot checks, deposits) | Not theft, but it opens the door | The digest shows "controls not run": handovers pending, spot checks overdue, deposits late | Digest | Owner conversation |

## 6. Collusion and counterparties

| # | Scheme | Why it mostly fails | Residual and backstop |
|---|---|---|---|
| C1 | **Rep + salon:** rep skims, salon agrees to say "we paid" | The salon's own balance stays unpaid in the system; without a receipt the salon owes the money. The salon loses, so the salon has no reason to collude unless the rep refunds them — which costs the rep the skim | A salon could accept a kickback to accept "lost" receipts for goods it never paid for; detector: salon paid-late pattern tied to one rep; balance confirmations by owner (not the rep) |
| C2 | **Rep + salon:** fake return, salon keeps goods | Goods must physically reach quarantine and be accepted by the manager; the rep's bag would be short | Manager colludes too → C4 |
| C3 | **Rep + manager:** manager approves adjustments/discounts/overrides for the rep | Above thresholds the owner approves; below thresholds everything is in the digest; monthly joint stock-take by the owner | The owner must read the digest and do the stock-take (OQ-14) |
| C4 | **Rep + manager:** skim and never record | Salon receives no receipt → installment goes overdue → owner digest at +30 days latest; monthly statements show the salon an unpaid balance; balance-confirmation sample is drawn by the system, not chosen by the manager | This is the hardest case. Backstops: owner-run balance confirmations, salon statements with dispute button, honest salons complaining. The design shortens the window to ≤ 30 days and bounds the loss to a few installments |
| C5 | **Manager + salon:** manager changes salon phone to divert receipts, then C4 | CTL-18 notifies the old number; change is in the digest | Owner calls the salon using the number on the frontage photo/listing |
| C6 | **Salon alone:** "we paid, no receipt" or "goods never arrived" | Receipt rule is printed on every document; delivery acknowledgment by OTP/signature (Phase 1: receiver's name, GPS and server time) | Commercial dispute; the system's evidence is complete |
| C7 | **Outsider impersonating a Kiran collector** | Salons can send "WHO" to get the assigned rep's name/photo; receipts only come from Kiran's number | Education of salons via statements |

## 7. Anomaly detectors (nightly job, CTL-14)

| ID | Signal | Default threshold | Severity |
|---|---|---|---|
| D-01 | Payment recorded > 300 m from salon pin | any | Medium |
| D-02 | Payment recorded > 2 h after "arrived" or without a visit | any | Medium |
| D-03 | ≥ 3 payments recorded within 10 minutes (burst recording) | per rep per day | Medium |
| D-04 | Round-number payments not equal to any installment or total due | > 30% of a rep's payments in a week | Low |
| D-05 | Handover or stock-close variance | 2nd in 30 days | High |
| D-06 | Visits with identical GPS; impossible speed between stops; mock-location flag | any | Medium/High |
| D-07 | Unmatched bank-transfer payments | > 3 working days, or > 2 per rep open | Medium |
| D-08 | Salon created and never visited within 14 days; salons sharing a phone number | any | Medium |
| D-09 | Stock adjustments / write-offs by value and count per manager | > 1% of stock value per month | High |
| D-10 | Credit overrides, unblocks, stage overrides per manager | above caps or > 5 per week | Medium |
| D-11 | Salon contact phone changed; same phone on > 1 salon; receipts failing delivery to a salon repeatedly | any | High |
| D-12 | Vault reads outside working hours; bulk reads; document downloads > 5/day | any | High |
| D-13 | Reorder rate collapse: a salon's orders stop after a rep change (list taken?) | ≥ 3 salons of one ex-rep | High |
| D-14 | Receipt not delivered within 60 min of a payment (sync or messaging failure) | any | Medium |
| D-15 | Office cash > 2 working days old; deposits unmatched > 3 days | any | High |
| D-16 | Discount approvals concentrated on a few salons or one rep | top-decile | Low |
| D-17 | Controls not run: handover pending, spot checks overdue, stock-take overdue | any | Medium |
| D-18 | Honeytoken salon contacted (call/WhatsApp to its number) | any | Critical |

Flags land in the digest; High/Critical also push a notification to the owner immediately.

## 8. The owner's 15-minute morning routine

The digest arrives at 07:00 and is designed to be read top-down:

1. **Money:** yesterday's collections vs expected; handovers (all acknowledged? any disputed?); office cash and its age; deposits matched/unmatched; overdue movement.
2. **Stock:** daily closes done; variances; adjustments and write-offs; spot checks done/missed.
3. **Approvals waiting for me:** write-offs, adjustments over threshold, credit notes, price changes, new devices.
4. **Exceptions:** discounts, overrides, unblocks, stage overrides, on-behalf payments, contact changes.
5. **Anomaly flags** by severity.
6. **Vault reads** (who, what, purpose).
7. **Reps:** checked in / not; visits and productive visits per rep; new prospects.
8. **Agents:** every agent purchase (agent, items, amount, paid by cash or transfer) and a flag on any unusually large one (D-22, OQ-22); pre-orders waiting.

Plus weekly: the random balance-confirmation list (call 3–5 salons per rep yourself — it takes 20 minutes and is the single most effective control in this document), and monthly: joint stock-take and a bank-portal check against the system's deposits.

## 9. Maker-checker matrix (defaults; owner-configurable)

| Action | Maker | Checker | Threshold for owner |
|---|---|---|---|
| Discount below list | Rep | Manager or Owner | > 10% or > Rs 5,000 per order |
| Credit limit override / unblock | Manager | Logged, no checker below caps | > 50% increase, or 3rd override on a salon in a month |
| Order cancellation after confirmation | Manager | Owner if delivered goods involved | — |
| Payment reversal | Rep/Manager (request) | Manager (not maker) ≤ Rs 10,000; Owner above | > Rs 10,000 |
| Stock adjustment | Manager (request) | Owner | > Rs 10,000 at list value, or any adjustment > 10 units |
| Write-off (stock) | Manager (request) | Owner | always |
| Credit note (return/price correction) | Manager | Manager (not maker) ≤ Rs 10,000; Owner above | > Rs 10,000 |
| Receivable write-off | Owner | Owner (second owner account if exists) | always |
| Return acceptance | Rep (request) | Manager at warehouse | — |
| Restructure installment schedule | Manager | Manager (not the selling rep's requester) | > Rs 50,000 outstanding |
| Device approval | Rep (implicit) | Manager/Owner | — |
| Price list change | Owner | — (MFA re-auth) | always owner |
| Bank account change | Owner | — (MFA re-auth + notification) | always owner |
| User create/role/offboard | Owner | — | always owner |
| Vault grant | Owner | — | always owner |
| Purchase order | Vault grantee | Owner | > Rs 200,000 |
| Petty expense from office cash | Manager | Owner | > Rs 5,000 |

## 10. Investigation playbook

1. **Freeze** what is at risk: suspend the user's ability to take orders/record payments (not the whole account — their history must stay readable).
2. **Pull the trail:** the salon timelines, the rep's day (visits, GPS, payments, receipts delivered), handovers, stock closes, approvals, audit events.
3. **Confirm with the counterparty:** call the salons involved using the phone on the frontage photo/listing, not only the stored number; ask for their balance and last payments.
4. **Reconcile physically:** count the bag and the warehouse; check office cash and the bank portal.
5. **Record a case** with the narrative, evidence links and decision; the case is append-only too.
6. **Act:** recovery, deduction, dismissal, police — per the signed rules (doc 08 §4).
7. **Fix the gap:** if a control failed, log it in doc 12 and change the system.

## 11. Residual risks — what this framework cannot fully stop

- **A patient rep + manager + salon triangle** that keeps everything consistent for one salon for one cycle. Loss is bounded to that salon's balance and surfaces within 30 days via ageing, statements and owner confirmations.
- **Physical warehouse theft** between counts, if the manager also controls the adjustment narrative. Bounded by thresholds, owner approvals and the monthly joint stock-take; CCTV is outside this plan but recommended.
- **An owner who does not read the digest.** Every manager-side control ends at the owner. If OQ-14 is answered "no", the framework's manager layer is weakened and the owner should keep more operations personal.
- **Determined GPS spoofing** with advanced tooling. Mitigated by photos, discovery-run fixes, speed checks and ride-alongs — not eliminated.
- **Owner account compromise.** Mitigated by MFA, recovery codes, a second owner account and the audit mirror.

## 12. Requirement additions from this document

Added to doc 03: **CTL-17** intraday cash cap (hand over or deposit when cash in hand exceeds a configurable threshold, default Rs 50,000; orders blocked until done) and **CTL-18** salon contact-change verification (OTP to the new number, notice to the old number, change listed in the digest; same phone on multiple salons flagged).
