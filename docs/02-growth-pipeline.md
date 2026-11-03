# 02 — The Growth Pipeline

This document defines the pipeline Kiran DMS exists to run. It is written as an operating model first and a software spec second: the software enforces the model, it does not replace it.

## The shape of the pipeline

Kiran has two pipelines that feed each other:

```
ACQUISITION  (new salons)                     RETENTION  (existing salons)
─────────────────────────────                  ──────────────────────────────────
Territory mapped                               Active salon with known cycles
   ↓                                              ↓
Prospect identified                            Cycle due → visit/WhatsApp task generated
   ↓                                              ↓
Visited (intro + sample)                       Order taken → delivered → installment plan
   ↓                                              ↓
Quoted / trial pack offered                    Installments collected on schedule
   ↓                                              ↓
FIRST ORDER  ──────────────────────────────►   Repeat order (cycle confirmed)
                                                  ↓
                                               At-risk (missed cycle) → win-back task
                                                  ↓
                                               Dormant / Lost
```

Every salon in the system is in exactly one **stage** at any time. Stage changes are driven by events (an order, a payment, a missed cycle), not by a rep's opinion.

## Stages, definitions, and what moves a salon forward

| Stage | Definition | Enters when | Exits when | Owner of the next action |
|---|---|---|---|---|
| **Prospect** | A real salon in a mapped territory that has never bought | Added by rep in the field, or imported from a mapping sweep | First visit logged | Rep |
| **Visited** | At least one visit logged; intro done, contact captured | A visit logged with any outcome except "not present" (a sample or quote goes straight to Trial) | Sample/trial given or quote recorded | Rep |
| **Trial** | Sample given or a small trial pack offered/quoted | Visit outcome "sample" or "quote" | First order, or 3 visits without order → **Parked** | Rep |
| **Active – New** | First order placed (any size) | First order confirmed | 3 orders completed → **Active – Regular**; or 60 days with no second order → **At Risk** | Rep |
| **Active – Regular** | ≥3 orders; cycle known | Third order | Missed cycle by >50% of cycle length → **At Risk** | System generates tasks; rep executes |
| **At Risk** | Missed an expected re-order | Cycle overdue | Order placed → back to Active; 2 cycles missed → **Dormant** | Rep (visit), Manager (call if rep fails) |
| **Dormant** | No order for 2+ cycles or 90 days | Automatic | Order placed → **Active – New** (restart) | Manager assigns win-back |
| **Parked** | Not interested now / not a fit | Rep marks with reason | Manual reactivation after 90 days | System reminds after 90 days |
| **Blocked** | Credit problem: overdue >30 days or default | Automatic on ageing | Manager clears after settlement | Manager |

A salon in **Blocked** can still be visited and can buy **cash only**. It cannot be put on an installment plan until unblocked.

## Territories and routes

Karachi is divided into **territories**, each a group of areas a rep can realistically cover by bike in a day: e.g., *Gulshan-e-Iqbal / Gulistan-e-Johar*, *North Nazimabad / Nazimabad / FB Area*, *Tariq Road / PECHS / Bahadurabad*, *Clifton / DHA*, *Saddar / Garden / Lines Area*, *Malir / Shah Faisal / Korangi*, *Orangi / SITE / Baldia*, *Landhi / Quaidabad*. Exact boundaries are set in the system by the manager and can be redrawn.

- Each rep is assigned **one or more territories**. A rep sees only salons in their territories (enforced by RLS — see doc 06).
- Each territory is divided into **route days**: the manager (or later, the system) decides which salons fall on Monday, Tuesday, etc., so that every active salon is visited at least once per cycle and prospects are interleaved.
- A **route** is the ordered list for one rep for one day: typically 12–18 stops — a mix of due-for-reorder actives, at-risk salons, collection stops, and new prospects.

### Territory mapping (one-time sweep, then continuous)

Before a rep starts a territory, it gets **mapped**: every business in the area that offers hair care, hair treatment or hair beauty to end users — ladies' parlors, men's salons, unisex salons, barbers, hair studios, bridal studios, spas with hair services, home-based parlors listed online, beauty academies — is recorded as a Prospect with name, location pin, type, size, a frontage photo and a first note. The sweep is itself a rep task in the system, and its output is the prospect list that fuels acquisition for months.

The map is the tool for this (requirements MAP-01…13):

1. **Find near me (one tap).** Standing anywhere in the territory, the rep taps *Find salons near me*. The app queries online listings for every relevant business within ~3 km (configurable up to ~6 km / 4 miles) of the rep's live GPS position and drops them as grey "discovered" pins — name, address, phone if listed, distance. Most salons and parlors are online today, so this captures the bulk of a block in seconds.
2. **Walk and pin.** What is not online — the basement parlor, the two-chair barber — the rep adds by long-pressing the map and dropping a pin with a photo and a short note ("chit"). Each pin keeps a dated note history.
3. **Convert and route.** Discovered pins become prospects with one tap (duplicates are caught). The rep selects the pins to cover today and the app orders them into an efficient route from where they stand; that becomes today's route stops.
4. **Timeline.** Every pin the rep creates, visits or converts shows up on their coverage timeline, and the owner/manager see a territory heat view of covered vs. uncovered blocks.

Sources therefore are: live online discovery, walking the market, Facebook/Instagram salon pages, referrals from salon owners, and the owner's existing Excel. Pins dropped or discovered outside the rep's own territory are still saved — assigned to that territory's rep, with the discovering rep credited.

## The rep's daily loop

This is what the app enforces, hour by hour.

| Time | Step | What the app does | Control it provides |
|---|---|---|---|
| Morning | **Check-in** | Rep opens app, confirms stock in bag matches system's "van stock" for them | Stock custody starts the day reconciled |
| Morning | **Today's route** | Shows ordered stops with, per stop: stage, last order, cycle status, amount due today, suggested pitch | No "who should I visit?"; no salon forgotten |
| Each stop | **Visit** | Rep taps "arrived" (GPS + time captured), picks outcome: order / collection / sample / intro / no decision / closed-not-interested; notes | Proof of presence; outcome data feeds stages |
| Each stop | **Order** | Rep builds order from price list; app checks stock in bag vs warehouse; chooses payment plan (cash / 2 / 4 instalments) within the salon's credit limit | Credit limit enforced at the point of sale |
| Each stop | **Deliver** | If stock is in bag: deliver now, invoice generated. If not: order goes to "to deliver" for tomorrow or warehouse dispatch | Stock movement recorded at the moment it happens |
| Each stop | **Collect** | Rep records cash received or bank transfer (bank, reference). Receipt sent to salon's WhatsApp instantly with a receipt number | Salon has independent proof; rep cannot under-report without the salon noticing |
| Each stop | **Prospect** | New salon found: long-press the map to drop a pin with photo and note in 60 seconds; or tap *Find salons near me* to pull every online-listed salon within ~3 km and convert the ones worth visiting | Pipeline top grows every day; discovery uses live GPS so it is also proof of presence |
| Evening | **Handover** | App shows "cash you should have: Rs X". Manager counts, enters amount, variance (if any) is logged against the rep | Daily cash reconciliation, zero tolerance |
| Evening | **Stock close** | App shows expected bag stock; rep confirms; variance logged | Daily stock reconciliation |

A rep who skips check-in cannot take orders. A rep with an unreconciled handover from yesterday sees a red banner and the manager is notified.

### Two order channels

A salon may receive orders through either an in-person representative visit or its authenticated customer portal. The rep opens the salon record and takes an order on the salon's behalf; the salon may also sign in and independently submit an order. Both create the same canonical order and pass through the same server-side price, stock, credit, fulfilment and payment rules. The order records its channel, actual creator and (only for a genuine field order) the order-taking representative and visit. A portal order is not a rep visit and must not inflate visit, productive-visit or rep-taken-order metrics. Reorder/retention metrics may count orders from either channel.

## The repeat-cycle engine (retention)

For each **salon × product group** (e.g., Glamour Salon × hair color), the system tracks the interval between purchases. After two or three purchases it has a cycle estimate. From that:

- **Due date** = last purchase + cycle.
- At **due − 3 days**: task appears on the rep's route for the next visit day in that territory: *"reorder due — color, last qty 6"*.
- At **due − 1 day**: optional WhatsApp to the salon: *"Aapka color stock khatam hone wala hoga — [rep name] kal aa raha hai. Kuch aur chahiye?"* (configurable; off by default until the salon opts in).
- At **due + 50% of cycle**, no order: salon → **At Risk**; task escalates.

The cycle estimate improves with every order. The owner can also set a default cycle per product group as a starting point (e.g., color 21 days, shampoo 30 days, styling 45 days).

## The collections loop

Collections run on the same route logic so that **the rep who sold is the rep who collects**, and every due installment is a route stop.

| Trigger | Action | Actor |
|---|---|---|
| Installment due in 2 days | WhatsApp reminder to salon (amount, date, rep name) | System |
| Due today | Appears as a collection stop on rep's route | Rep |
| 3 days overdue | Red flag on route; rep must record an outcome (paid / promised date / not available) | Rep |
| 7 days overdue | Manager call task; salon flagged on dashboard | Manager |
| 15 days overdue | New installment orders blocked for this salon; cash only | System |
| 30 days overdue | Salon → **Blocked**; owner notified; recovery plan recorded | Manager/Owner |

Full detail on plans, credit limits and reconciliation is in doc 09.

## KPIs — what gets measured

### Per rep (daily / weekly)

| KPI | Definition | Healthy range (initial, to be calibrated) |
|---|---|---|
| Visits per day | Visits with GPS + outcome | 12–18 |
| Productive visits | Visits with an order or a collection | ≥ 50% of visits |
| New prospects added | Prospects created per week | ≥ 10 |
| Conversion | Prospects → first order within 30 days | ≥ 15% |
| Active salons | Salons in Active stages in rep's territories | growing month on month |
| Reorder rate | Active – Regular salons that ordered within cycle | ≥ 85% |
| Collection rate | Installments collected within 7 days of due | ≥ 90% |
| Handover variance | Cash counted vs. system expected | Rs 0 |
| Stock variance | Bag stock counted vs. system expected | 0 units |

### Business (weekly / monthly)

- Sales value and units, by territory, product group, salon type
- Active salon count and movement between stages (the pipeline funnel)
- Receivables ageing: current / 1–7 / 8–15 / 16–30 / 30+ days
- Days sales outstanding (DSO)
- Stock-out lines, stock cover (days of sales on hand) per SKU
- Orders and order value by source channel (rep visit / salon portal) and state (submitted / confirmed / delivered / invoiced / paid / outstanding)
- Salon portal repeat-order activity, reported separately from rep physical visits and rep-taken orders
- Gross margin (owner/manager only — requires cost prices from the vault)

## Management rhythm the system supports

- **Daily (manager, 15 min):** handover reconciliation, stock close, overdue flags, any rep without check-in.
- **Weekly (owner + manager, 30 min):** funnel movement, rep scorecard, receivables ageing, restock suggestions (doc 10), territory decisions.
- **Monthly:** margin by product and territory, cycle calibration, credit-limit review, commission run.

## How the pipeline produces growth — the causal chain

1. Mapping sweeps put **every salon in a territory** into the funnel. The top of the funnel is no longer limited by memory.
2. Daily routes with a visit quota guarantee **prospects get visited** and **actives get seen on cycle**.
3. Cycle-based tasks mean **re-orders happen on time**, which both lifts revenue and prevents the salon from trying a competitor when it runs out.
4. Instant WhatsApp receipts and pre-due reminders make **installments a service**, not a chase — which lets Kiran offer credit more confidently, which wins salons that competitors make pay cash.
5. Credit limits that grow with on-time history **reward good salons with bigger orders**.
6. Daily reconciliation makes it **safe to hire reps**, and more reps means more territories mapped — back to step 1.

## What the software must do to make this real (summary — details in doc 03)

- Stage machine with event-driven transitions and manual overrides (manager only, with reason).
- Territory map with stage-coloured pins, drop-a-pin prospect capture with notes, one-tap nearby discovery from live GPS, pins-to-route ordering, and a coverage timeline (MAP module).
- Territories, route days, and generated daily routes.
- Visit logging with GPS/time and outcome codes; visits are append-only.
- Cycle estimation per salon × product group; due-date tasks.
- Collection tasks tied to installments; escalation timers.
- Rep scorecard and business dashboards.
- WhatsApp receipts and reminders (provider-agnostic; see doc 05).
