# 12 — Decisions and Open Questions

## Decision log

| ID | Date | Decision | Why | Status |
|---|---|---|---|---|
| D-01 | 2026-10-25 | The niche is **hair styling and hair care** for salons/parlors, not general cosmetics | MJ's correction; sharper product groups and cycles | Confirmed |
| D-02 | 2026-10-25 | "Salon" = any business in Karachi offering hair care, hair treatment or hair beauty to end users (parlors, men's salons, unisex, barbers, hair studios, bridal studios, spas with hair services, home-based parlors, academies) | Widens the prospect universe for map discovery | Confirmed |
| D-03 | 2026-10-25 | **Classified supplier** = identity, pricing, terms visible only to owner and vault grantees (manager by default); enforced in the database | MJ confirmed the reading | Confirmed |
| D-04 | 2026-10-25 | Payments: cash, local bank transfer, installment plans of 2 or 4 | Stated by MJ | Confirmed |
| D-05 | 2026-10-25 | Build, don't buy; stack = Next.js + Supabase + PWA on Vercel | Doc 05 rationale; MJ's existing CRM experience on the same stack | Confirmed (MJ had no stack preference; recommended default) |
| D-06 | 2026-10-25 | Locale PK / PKR / FY ends 30 June | Confirmed by MJ | Confirmed |
| D-07 | 2026-10-25 | Security and anti-fraud controls are **launch** scope, not a later phase | MJ: "no way of cheating… even manager and sales rep" | Confirmed |
| D-08 | 2026-10-25 | Manager has full **operational** access; a short list of **governance** powers is owner-only (users, bank details, write-offs, price lists, commission plans, vault grants, audit log, config) | Needed to make "manager can't do anything dubious" true; without someone above the manager the guarantee is impossible | **Pending MJ's confirmation** — MJ originally said "same privileges and access as owner" |
| D-09 | 2026-10-25 | No paper receipts; the only valid receipt is the system's numbered receipt delivered to the salon's phone | Core anti-skimming control (doc 13) | Proposed |
| D-10 | 2026-10-25 | Commission is paid on **collected and banked** cash, never on invoiced sales | Aligns incentives; defeats fake orders | Proposed |
| D-11 | 2026-10-25 | Map-first prospecting: drop-pin with notes + one-tap nearby discovery from live GPS; pins → routes | MJ's request | Confirmed |
| D-12 | 2026-10-25 | No check-in cadence from Claude; the system is the deliverable | MJ's instruction | Confirmed |
| D-13 | 2026-10-25 | The supplier compartment's database schema is named **`supplier_vault`**, not `vault`. Docs 04, 06 and 07 say `vault`; read it as `supplier_vault` | Supabase already owns a schema called `vault` (the `supabase_vault` extension, used for secrets). Sharing it would mix Kiran's classified tables with platform objects and break doc 07's "separate schema" rule | Implemented (ACTIVITY L-0010); naming only, no change to who can see what |
| D-14 | 2026-10-25 | Office powers need an MFA-verified (AAL2) session **at the database**: `app.is_office()` and `app.is_owner()` are false at AAL1, so RLS shows an un-verified owner or manager only their own profile | Doc 06 §3 makes TOTP mandatory for office logins; enforcing it in RLS means a stolen password alone opens nothing | Implemented (ACTIVITY A-03); stricter reading of doc 06 §3 |

## Open questions

| ID | Question | Why it matters | Who answers | Needed by |
|---|---|---|---|---|
| OQ-01 | What is in the Excel today — how many salons, how many with balances, product list and prices? | Baseline numbers for goals (doc 01), import mapping, opening balances | MJ / owner | Phase 0 |
| OQ-02 | Confirm D-08: is the owner comfortable holding governance powers that the manager does not have? | Everything in doc 13 about manager-side fraud depends on it | Owner | Phase 0 |
| OQ-03 | Who is "the owner" in the system — MJ, a family member, a business partner? Is there a second owner account for continuity? | Owner is the final checker and recovery path | MJ | Phase 0 |
| OQ-04 | Does the product packaging carry the supplier's/manufacturer's name? Is the supplier a manufacturer or a wholesaler/importer of a known brand? Is private-label packaging wanted? | Decides how far physical confidentiality can go (doc 07 §3) | Owner | Phase 0 |
| OQ-05 | Does the supplier have a lead time and MOQ we can treat as stable? | Reorder point formula inputs (doc 10) | Owner (vault) | Phase 1 |
| OQ-06 | Installment schedule details: is "2 installments" 50% at delivery + 50% later, or 0% at delivery? Same for 4 | Template defaults (doc 09) | Owner | Phase 0 |
| OQ-07 | Starting credit limits by salon type, and the ceiling | Credit rules (doc 09 §2) | Owner | Phase 0 |
| OQ-08 | Which banks/accounts will salons pay into? Can supplier payments use a separate account? | Invoice details; statement import; vault leakage control | Owner | Phase 0 |
| OQ-09 | Rep pay structure: fixed + commission %? New-salon bonus amount? Variance deduction policy? | Commission plans (doc 08) | Owner | Phase 2 |
| OQ-10 | Company phones/SIMs for reps, or personal devices? | Device binding, OTP continuity, offboarding | Owner | Phase 1 |
| OQ-11 | WhatsApp Business account ownership and phone number for Kiran; who registers with the BSP? | Receipts and reminders (doc 05) | Owner / MJ | Phase 0 |
| OQ-12 | Is there any existing salon data beyond Excel (phone contacts, WhatsApp groups) worth importing? | Prospect seeding | Owner | Phase 0 |
| OQ-13 | Territory boundaries for the pilot: which area first, and who is the pilot rep (the current sales appointee)? | Pilot planning (doc 11) | Owner / manager | Phase 0 |
| OQ-14 | Will the owner tolerate the extra daily minutes the controls cost (handover acknowledgment, deposit slips, digest review ≈ 15–20 min/day)? | Controls only work if they are actually run | Owner | Phase 0 |
| OQ-15 | Third-party penetration test budget in Phase 3? | Security assurance (doc 06) | Owner | Phase 3 |
| OQ-16 | **Real product catalogue**: product names, variants/shades, sizes (ml/L, g/kg), net weights, pack types, units per carton, barcodes, shelf life. All product data in doc 10 is dummy until this arrives | SKU master, price list, reorder points, cycle defaults | MJ | Phase 0 (import) |

## How to use this file

- New ideas during the build go here first, as an open question or a proposed decision. They enter a phase only through doc 11.
- When a decision changes, add a new row rather than editing the old one, and update the referencing doc.
