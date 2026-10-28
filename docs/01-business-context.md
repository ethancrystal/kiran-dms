# 01 — Business Context and Goals

## The business today

| | |
|---|---|
| **Company** | Kiran Company, Karachi |
| **What it sells** | Hair styling and hair care products — colors and developers, shampoos and conditioners, treatments and masks, serums and oils, styling products (gel, wax, spray, cream), salon consumables |
| **Who it sells to** | Any business in Karachi that offers hair care, hair treatment or hair beauty to end users — beauty parlors, men's salons, unisex salons, bridal studios, barber shops, hair studios, spas with hair services, home-based parlors, beauty academies — all sizes |
| **Where products come from** | One **confidential supplier**. Who they are, what Kiran pays, and on what terms is known to the owner and manager only |
| **How customers pay** | Mostly cash; some local bank transfers; many salons buy on 2- or 4-installment plans |
| **Team** | Owner · Manager (same day-to-day authority as owner; governance powers stay with the owner — doc 13) · 1 sales appointee. Intention: hire door-to-door reps |
| **Systems** | Excel. No CRM, no POS, no inventory system, no ledger software |

## The problem, stated plainly

Sales and restocking are poor **because nothing is tracked**. Specifically:

1. **Sales depend on memory.** There is no list of which salons exist in Karachi, which ones buy, which ones stopped, or when each is due to re-buy. New salons get added when someone happens to remember. Follow-up is ad hoc.
2. **Restocking is reactive.** Nobody knows the sell-through rate per product, so stock-outs are discovered when a salon asks and over-stock sits unnoticed.
3. **Cash and installments are invisible.** Who owes what, which installment is due this week, which salons are habitually late, and how much cash a rep is holding right now — all of it lives in heads and scattered Excel sheets.
4. **Reps cannot be hired safely.** Without a system, giving a new person stock, cash, and the salon list is an act of faith. That caps growth at what the owner and manager can personally handle.

The fourth point is the one that matters most. **The purpose of Kiran DMS is to make it safe and fast to put more salespeople on the road.** Everything else — the ledger, the stock module, the pipeline — exists to serve that.

## Why a system changes the outcome

Salon consumption is predictable. A busy ladies' parlor uses hair color and developer on a steady weekly rhythm; a men's salon re-buys styling product and shampoo every few weeks. Once the system knows each salon's cycle, it can tell a rep *"Glamour Salon, Gulshan Block 13 — due for color this week, last order 6 tubes, owes Rs 4,500 on installment 2 of 4"* before the salon even calls. That turns a rep from an order-taker into someone who shows up on the right day with the right stock and collects what is due. Multiply by every active salon and every rep, and sales rise from three directions at once:

- **More salons** — a mapped territory with a prospect list and a daily visit quota.
- **More frequent orders** — cycle-based reminders mean no missed re-buys.
- **Bigger baskets** — the rep sees what similar salons buy and what this salon has never tried.

Meanwhile the money leak closes: every rupee due has a date, a name and an owner, and every rupee collected is reconciled the same evening.

## Goals

### Business goals (12 months after launch)

These are proposals to be confirmed and quantified by the owner once the Excel data is loaded (see doc 12, OQ-01).

| Goal | Measure | Baseline | Target |
|---|---|---|---|
| Grow active salon base | Salons with ≥1 order in last 60 days | from Excel | 3× baseline |
| Increase order frequency | Avg orders per active salon per month | from Excel | +50% |
| Cut stock-outs | Order lines unfulfilled due to no stock | unknown | < 2% of lines |
| Collect what is owed | Installments paid within 7 days of due date | unknown | > 90% |
| Shrink overdue book | Overdue receivables as % of total receivables | unknown | < 10% |
| Zero cash leakage | Unexplained variance at daily handover | unknown | Rs 0, every day |
| Scale the field team | Reps productive (hitting visit quota) within 2 weeks of hire | n/a | 100% of hires |
| Grow the agent channel | Monthly sales through independent agents (Rs), D-21 | 0 | set by the owner (OQ-21) |

### System goals

1. A new rep can be onboarded, given a territory and a phone, and be taking orders **within one working day**.
2. The owner can answer *"how much are we owed, by whom, and who is collecting it?"* in **under 10 seconds**, from a phone.
3. The supplier's identity and Kiran's cost prices **never appear** on any screen, export, document, or API response available to a rep — enforced by the database.
4. The system works on a **low-end Android phone with patchy data** in a salon basement in Saddar.
5. Every order, payment, stock movement and access to sensitive data is **attributable to a person and a time**, and cannot be silently edited or deleted.
6. **Nobody — rep, manager, or salon — can take money or stock out of the business without it showing up the same day**, and nobody can hide a debt, a discount, or a loss without the owner seeing it in the next morning's digest (doc 13).

## Non-goals (for now)

- Full double-entry accounting, tax filing, payroll. The system exports to an accountant; it does not replace one.
- Selling to end consumers or running an e-commerce storefront.
- Multi-city operations. Karachi only; the data model must not block expansion, but no features are built for it.
- Manufacturing or private-label production tracking (see doc 12, OQ-04 on packaging).

## Constraints and realities

- **Cash is king.** Most salons pay cash; the system must make cash handling tight without making it slow.
- **Trust is low by default.** Reps are new hires carrying stock and cash. Controls must assume honest mistakes *and* dishonesty.
- **Connectivity is uneven.** Many salons are in basements or dense markets. Rep workflows must work offline and sync later.
- **Phones are cheap.** Assume a 3–4 year old Android phone with 2–3 GB RAM and a cracked screen.
- **Language.** Reps are comfortable with Urdu and Roman Urdu; the owner and manager use English. Key screens carry both.
- **Budget.** Running cost should stay in the tens of dollars per month at launch (Supabase + Vercel + a messaging provider).
- **Legal.** Pakistan's data-protection regime is still forming (PECA 2016; Personal Data Protection Bill drafts). Treat salon owners' names and phone numbers as personal data: collect only what is needed, protect it, delete on request.

## Stakeholders

| Who | Needs from the system |
|---|---|
| **Owner** | Total visibility; control over money, stock, people, and the supplier secret; ability to run the business from a phone |
| **Manager** | Same as owner day to day: approve credit, reconcile cash, assign territories, chase overdue, manage stock |
| **Sales rep** | A phone app that tells them where to go, what to sell, what to collect — and proves they did their job honestly |
| **Salon owner** (external) | Reliable delivery, a clear receipt, a fair installment schedule, a reminder before a payment is due — not after |
| **Supplier** (external) | Nothing. The supplier never touches the system and is never named in it outside the vault |
| **Accountant** (external, later) | Clean exports: sales, receipts, receivables ageing, stock valuation |
