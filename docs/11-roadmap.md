# 11 — Roadmap

Principles: ship the ledger and the controls first, because they are what make hiring reps safe; grow the pipeline features once the first rep is on the road; never ship a phase without its security acceptance tests. Timelines assume one developer (MJ) with AI assistance, part-time alongside other work; compress if full-time.

## Phase 0 — Foundations (Weeks 1–2)

**Goal:** decisions settled, data understood, skeleton running.

- Confirm open questions in doc 12 (especially D-08 manager governance split (confirmed 2026-11-02), OQ-01 Excel data, OQ-04 packaging, OQ-16 product catalogue).
- Load and clean the Excel: salons, products, prices, outstanding balances → import mapping (SAL-10).
- Territory draft for Karachi with the manager; first territory chosen for the pilot.
- Repository, CI, Supabase projects (staging/prod), Next.js skeleton, auth with MFA for owner/manager, RLS policy test harness (empty but running).
- Choose and sign up: WhatsApp BSP, SMS gateway, maps/places provider; start WhatsApp template approvals (they take days).
- Define installment templates, credit rules, product groups and default cycles, visit outcome codes with the owner.
- **Activate the build protocol (P0-09):** copy `ACTIVITY.md` to `docs/ACTIVITY.md`, add `AGENTS.md` and `CLAUDE.md` at the repo root, and turn on the `activity-log-check` CI job (ACTIVITY.md, Appendix A and C). No build work starts before this is live.

**Exit criteria:** owner and manager can log in with MFA to an empty office app; Excel import dry-run shows clean data; decisions logged; ACTIVITY enforcement active in CI.

## Phase 1 — MVP: the Khata, the Bag, and the Controls (Weeks 3–10)

**Goal:** one rep can run a full day in one territory, and every rupee and unit is accounted for by evening. The owner sees everything from a phone.

| Area | Scope (requirement IDs) |
|---|---|
| Salons & map | SAL-01…05, 09, 10 · MAP-01, 02, 03, 12 · stage machine with manual override (PIP-02 visits, PIP-07 quick-add, PIP-09 check-in gating) |
| Routes | PIP-03 manual route building by manager; rep can reorder; PIP-05/06 thin due-list (D-19) |
| Orders & invoices | ORD-01…05, 10 (offline orders) |
| Payments | PAY-01, 02, 03 (generate), 04, 05, 07, 10, 11; manual overdue flags (PAY-08 manual) |
| Stock | INV-01…06 (manual reorder points); INV-11 route-linked bag load (D-19) |
| Lost demand | DEM-01, DEM-02, DEM-03 (report) (D-18) |
| Agents | AGT-01, 02, 03, 04, 06 (D-15 to D-17) |
| Vault | VLT-01…06 |
| Security | SEC-01…08, 10, 11, 12 |
| Controls | CTL-13 commission on delivered and invoiced value of assigned orders (D-31, brought into Phase 1 by ACTIVITY L-0385), CTL-01 (receipt via WhatsApp — template-dependent; SMS fallback first if templates lag), 02, 03, 04, 05, 06, 07, 08, 09, 11 (manual list), 15, 16, 17, 18 — the full doc 13 prevention layer; detectors (CTL-14) follow in Phase 2 |
| Field | FLD-01 |
| Reports | RPT-01, 02 |
| Messaging | MSG-03 in-app notifications; receipts out via SMS/WhatsApp as soon as templates are approved |
| Admin | ADM-01 (templates, credit rules, groups, outcome codes, territories), ADM-02, ADM-03 |

**Pilot (Weeks 9–12, overlapping):** the existing sales appointee runs the MVP in one territory for 4 weeks with the manager doing daily handovers in the app. Excel is frozen; the system is the record.

**Exit criteria (all must pass):**
1. Security acceptance list in doc 06 §10 passes.
2. 20 consecutive working days of pilot with handover variance Rs 0 and stock close variance 0 — or every variance explained in a case.
3. 100% of payments in the pilot have a delivered receipt (SMS or WhatsApp).
4. Owner answers "how much are we owed, by whom, who's collecting" from the phone in < 10 s.
5. Vault tests in doc 07 §5 pass.
6. Offline capture → sync works in a basement salon with no signal (tested in the field).
7. Backup restore drill done.

## Phase 2 — The Growth Engine (Weeks 11–20)

**Goal:** hire reps 2 and 3; the system generates the work; collections and restocking run on timers.

| Area | Scope |
|---|---|
| Map & discovery | MAP-04…09, 11, 13 (nearby discovery, convert, pins-to-route, timelines, manager live map) |
| Pipeline | PIP-04, 05, 06, 08, 10, 11 (route days, cycle engine, due tasks, sweep mode, geofence flags) |
| Collections | PAY-06 (bank reconciliation), PAY-08 timers, PAY-09 credit rules automation |
| Orders | ORD-06 returns, ORD-07 price lists & special pricing, ORD-09 suggestions |
| Salon portal and dual-channel ordering | SAL-11/12, ORD-11/13, SEC-13/15: secure salon membership, own-salon catalogue/price/stock/order/document reads, portal order submission through the common order engine (manager approval first, D-30) |
| Stock | INV-07 restock suggestions, INV-08 batches/expiry, INV-09 counts, INV-10 valuation (vault) |
| Vault | VLT-07 column encryption (if not already in Phase 1) |
| Controls | CTL-10 monthly statements + dispute, CTL-11 automated confirmations, CTL-12 quarantine returns, CTL-13 commission (moved to Phase 1 by D-31), CTL-14 anomaly jobs |
| Field | FLD-02 scorecard, FLD-03 commission statement and payouts only if approved (the earned-commission view is Phase 1, D-31), FLD-04 onboarding checklist, FLD-05 live map |
| Active location | PIP-12/13: open-rep-day location samples, office current/stale map and approved history; exact tracking policy follows OQ-32 |
| Messaging | MSG-01, 02, 04 |
| Reports | RPT-03 funnel, RPT-04 margin (vault), RPT-05 accountant pack |
| Hiring | Reps 2 and 3 onboarded with the doc 08 runbook; two more territories mapped via discovery + sweep |

**Exit criteria:** ≥ 3 reps live; daily routes generated by the system; ≥ 85% of due reorders produce an order or a logged reason; receivables ageing improving month on month; weekly restock suggestions accepted by the owner with edits < 20%; anomaly digest reviewed daily.

## Phase 3 — Scale and Polish (Months 6–9)

- Purchase orders and supplier claims fully in the vault UI; forecasting with seasonality.
- Multi-warehouse / van stock transfers; second city readiness (data model already allows).
- Promotions and bundles (ORD-08); approved WhatsApp notifications and opt-in reminders may complement the authenticated salon web portal. WhatsApp is not a substitute for the portal's account security or order ledger.
- Honeytoken salons (SEC-09); discovery refresh job (MAP-10); salon tags (SAL-08).
- Accounting connector if the accountant wants one; payroll export of commissions.
- Performance and cost review; security re-test; penetration test by a third party.

## Milestones at a glance

| When | Milestone |
|---|---|
| End W2 | Decisions locked; MFA login; data imported in staging |
| End W6 | Rep can complete a full day offline → sync; handover and stock close work |
| End W8 | Vault, audit chain, digest, receipts live; security tests green |
| W9–W12 | Pilot with the existing sales appointee, one territory |
| End W12 | Go/no-go for hiring rep 2 |
| End W16 | Nearby discovery, routes from pins, cycle engine live |
| End W20 | 3 reps, 3 territories, commissions (earned on delivered and invoiced value from Phase 1, D-31), bank reconciliation |
| Month 9 | Phase 3 complete; external security test |

## Effort estimate (developer weeks)

| Phase | Build | Test & hardening | Total |
|---|---|---|---|
| 0 | 1.5 | 0.5 | 2 |
| 1 | 6 | 2 | 8 |
| 2 | 7 | 2 | 9 |
| 3 | 8 | 2 | 10 |

Part-time (≈ 50%) roughly doubles the calendar time of each phase.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| WhatsApp template approval delays | Receipts not delivered via WhatsApp at pilot | Ship SMS receipts first; WhatsApp when approved |
| Excel data messier than expected | Pilot starts with wrong balances | Dry-run import; manager reconciles each salon balance before go-live; opening balances entered as "opening invoice" rows |
| Rep resists the app ("too slow") | Poor adoption, dirty data | Low-end phone testing; ≤ 60 s flows; ride-alongs; commission only through the system |
| Manager sees controls as distrust | Friction | Frame controls as protection for the manager too (two-party handover protects them from a rep's accusation) |
| Supplier identity leaks physically | Loss of the business's key secret | Receiving procedure in doc 07 §3; codename rule |
| Scope creep before the pilot | MVP slips | Phase 1 scope frozen at end of W2; new ideas go to doc 12 |
| Single developer | Bus factor | Docs in repo; CI-driven deploys; owner holds all credentials and recovery codes |
