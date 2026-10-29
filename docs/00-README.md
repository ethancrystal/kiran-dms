# Kiran DMS — Planning Set

**Kiran Company** distributes hair styling and hair care products to salons and beauty parlors across Karachi. Today the business runs on Excel, cash and memory. This planning set defines **Kiran DMS** — a Distribution Management System that combines a salon CRM, a field-sales pipeline, order-to-cash with installments, and inventory/restocking — built so that the company can hire door-to-door sales reps and grow without losing control of cash, stock, the salon list, or the identity of its supplier.

Status: **Planning v1 — 2026-10-25.** The build is under way: Phase 1 started before Gate 0 on MJ's decision (D-20), and the live status is the board in [ACTIVITY.md](ACTIVITY.md) §12. These documents remain the brief and the source of truth for the build; [SPEC.md](../SPEC.md) at the repo root is a short index into them.

> ## Building this system? Read [ACTIVITY.md](ACTIVITY.md) first — it is mandatory.
> It is the build protocol (hard rules, definition of done, phase gates) and the live record (status board, claims, blockers, append-only log) that every agent, AI or human, must follow and update. Work without a log entry there is treated as not done.

## What we are building, in one paragraph

A mobile-first web app (installable PWA) for reps in the field and a back-office web app for the owner and manager, on one Postgres database with row-level security. Reps work a daily route of salons, take orders, deliver stock, collect cash or bank transfers against installment schedules, and hand cash over every evening. The owner and manager see every salon, every rupee due, every unit of stock, and every rep's day — and are the only people who can see who the supplier is or what anything costs. The system turns "sales depends on who remembers to call" into a repeatable pipeline: prospect → first order → repeat cycle → collection.

## Reading order

| # | Document | Read it for |
|---|----------|-------------|
| 01 | [Business context and goals](01-business-context.md) | Who Kiran is, the problem, what "boom" means in numbers |
| 02 | [Growth pipeline](02-growth-pipeline.md) | The sales pipeline the system enforces — stages, rep daily loop, KPIs |
| 03 | [Requirements](03-requirements.md) | Functional requirements by module, with priorities; non-functional requirements |
| 04 | [Domain model](04-domain-model.md) | Entities, relationships, invariants — the shape of the data |
| 05 | [Architecture](05-architecture.md) | Stack, app surfaces, offline strategy, integrations, environments |
| 06 | [Security plan](06-security-plan.md) | Threat model, roles and permissions, RLS, auth, audit, backups, incident response |
| 07 | [Supplier confidentiality](07-supplier-confidentiality.md) | The "classified supplier" compartment — how the supplier stays invisible |
| 08 | [Field sales and rep controls](08-field-sales-and-rep-controls.md) | Hiring, onboarding, territories, cash and stock custody, commissions, offboarding |
| 09 | [Payments, credit and installments](09-payments-credit-installments.md) | Cash, bank transfer, 2/4-installment plans, credit limits, overdue handling, reconciliation |
| 10 | [Inventory and restocking](10-inventory-and-restocking.md) | SKU master, stock locations, movements, reorder points, restock cycle |
| 11 | [Roadmap](11-roadmap.md) | Phases, MVP scope, milestones, acceptance criteria |
| 12 | [Decisions and open questions](12-decisions-and-open-questions.md) | Decision log and everything still to be settled |
| 13 | [Anti-fraud and control framework](13-anti-fraud-controls.md) | Every way a rep, manager, salon or outsider could cheat — and the control that stops or catches it |
| — | [**ACTIVITY (mandatory for builders)**](ACTIVITY.md) | Build protocol, hard rules, definition of done, phase gates, status board, claims, blockers, append-only activity log |

## Fixed decisions (do not re-open without updating doc 12)

1. **Niche:** hair styling and hair care products for salons/parlors. Not general cosmetics.
2. **Roles at launch:** Owner, Manager, Sales Rep. The Manager has the **same operational access** as the Owner (salons, orders, stock, cash, credit, reps' days). A short list of **governance powers is Owner-only** — user accounts, company bank details, write-offs and credit notes, price lists, commission plans, vault grants, the audit log, and system configuration — because "nobody, including the manager, can do anything dubious" is only achievable if someone sits above the manager (doc 13). *Pending MJ's confirmation — see doc 12, D-08.* **Agent** role added by D-15 (2026-10-28): independent agents buy stock outright with cash or transfer before it leaves the warehouse, resell it themselves and report nothing back; they see only their own purchases and the agent catalogue.
3. **Supplier is classified:** supplier identity, pricing and terms are visible to Owner and Manager only. Enforced in the database, not just the UI.
4. **Payments:** cash, local bank transfer, and installment plans of 2 or 4 instalments.
5. **Stack:** Next.js + Supabase (Postgres with RLS, Auth, Storage, Edge Functions), PWA for reps, hosted on Vercel + Supabase. See doc 05 for why.
6. **Locale:** Pakistan, PKR, financial year ends 30 June. UI in English with Urdu labels where reps need them.
7. **Security is a launch requirement, not a phase.** The MVP ships with RLS, MFA for owner/manager, device binding for reps, an append-only audit log, and the supplier compartment.
8. **No cheating by design.** Five principles run through every module (doc 13): (a) nothing is ever edited or deleted — only reversed with a new, attributed entry; (b) every unit of stock and every rupee has a custody chain with a two-party acknowledgment at each handoff; (c) the party with the opposite interest confirms independently — the salon gets a system receipt, the bank statement confirms deposits; (d) high-risk actions are maker-checker, and the maker can never be the checker; (e) the owner receives a daily exception digest of every override, adjustment, variance, write-off and vault read.

## Vocabulary

- **Salon** — any customer: any business anywhere in Karachi that offers hair care, hair treatment or hair beauty to end users — ladies' beauty parlors, men's salons, unisex salons, bridal studios, barber shops, hair studios, spas with hair services, home-based parlors, beauty academies. One word in the system.
- **Pin** — a salon's location on the rep's map. Reps prospect by dropping pins with a note, or by one-tap online discovery of every listed salon within a few kilometres of where they stand.
- **Rep** — a field salesperson (the "sales appointee"). Visits salons, takes orders, delivers, collects.
- **Route / beat** — the ordered list of salons a rep visits on a given day.
- **Khata** — the running ledger of what a salon owes. The system is a digital khata plus everything around it.
- **Van stock / bag stock** — stock issued to a rep and physically carried by them; still Kiran's stock until sold.
- **Handover** — the end-of-day transfer of collected cash from a rep to the manager/owner, reconciled against what the system says was collected.
- **Vault** — the sealed part of the database holding supplier and cost data.
- **Cycle** — the interval at which a salon re-buys a product (e.g., hair color every 3 weeks).

## How these docs will be used

- The build is phased (doc 11). Each phase's scope references requirement IDs from doc 03 (e.g., `REQ-ORD-03`).
- Any change to a fixed decision gets a dated entry in doc 12 first.
- When the build starts, this folder (`Kiran Company/plan/`) becomes `/docs` in the repository and stays the source of truth.
- Product names, sizes and weights in doc 10 are **dummy placeholders** until MJ supplies the real catalogue (OQ-16).
