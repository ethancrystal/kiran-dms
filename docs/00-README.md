# Kiran DMS — Planning Set

**Kiran Company** distributes hair styling and hair care products to salons and beauty parlors across Karachi. Today the business runs on Excel, cash and memory. This planning set defines **Kiran DMS** — a Distribution Management System that combines a salon CRM, a field-sales pipeline, order-to-cash with installments, and inventory/restocking — built so that the company can hire door-to-door sales reps and grow without losing control of cash, stock, the salon list, or the identity of its supplier.

Status: **Planning v2 — 2026-11-03.** This revision incorporates salon customer portal ordering, representative-placed orders, manual salon location capture, salon-specific prices, customer-safe stock quantities and active-day representative location tracking. This is a planning update only; it does not mark implementation or any phase gate complete. The live implementation status remains the board in [ACTIVITY.md](ACTIVITY.md) §12. These documents are the planning source of truth; [SPEC.md](../SPEC.md) is the short index.

**Amended 2026-11-05:** [doc 16](16-project-completion-goal.md) is the authoritative business specification (D-33). Representatives no longer place orders (D-30): reps and salons submit order requests and only the office creates official orders (D-34). Where anything here disagrees with doc 16, doc 16 wins.

> ## Building this system? Read [ACTIVITY.md](ACTIVITY.md) first — it is mandatory.
> It is the build protocol (hard rules, definition of done, phase gates) and the live record (status board, claims, blockers, append-only log) that every agent, AI or human, must follow and update. Work without a log entry there is treated as not done.

## What we are building, in one paragraph

A coordinated web application with three workspaces over one PostgreSQL database with row-level security: a mobile-first representative PWA, an authenticated salon customer portal, and an office workspace for Owner/Manager. Representatives visit salons, capture GPS-stamped visits, submit order requests, deliver stock and collect payments. Salon users, invited by the office, submit order requests and track their own orders through the portal. The office reviews both in one queue and creates the official orders, which use the same catalogue, salon-specific price resolver, stock availability, order state machine, fulfilment, invoice and payment records. Office users manage salons, assignments, representatives, stock, pricing, orders and exceptions under the D-08 permission split as amended by D-39; a basic investor ledger stays separate from Rep commissions (D-40). Supplier identity and cost data remain restricted.

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
| 14 | [Unified business domains and agent execution brief](14-unified-business-domain-prompt.md) | How supplier, salon portal, rep, agent, investor and office domains connect; boundaries, security and execution rules |
| 15 | [Field sales and distribution engineering plan](15-field-sales-distribution-engineering-plan.md) | Target modules, three workspaces, dual-channel orders, data ownership, location tracking, inventory, security, delivery sequence and acceptance criteria |
| 16 | [**Project completion goal (authoritative business specification)**](16-project-completion-goal.md) | MJ's goal and master task, verbatim; wins over any older document or decision (D-33) |
| — | [**ACTIVITY (mandatory for builders)**](ACTIVITY.md) | Build protocol, hard rules, definition of done, phase gates, status board, blockers; the append-only log is in `log/` |

## Fixed decisions (do not re-open without updating doc 12)

1. **Niche:** hair styling and hair care products for salons/parlors. Not general cosmetics.
2. **Internal staff roles:** Owner, Manager and Sales Rep. The Manager has the documented operational access; governance powers remain Owner-only under D-08 (doc 06). The **Agent** role is a separate independent resale channel under D-15. **Salon customer portal membership is a separate external-customer identity**, linked to a specific salon; it is not a staff role and does not inherit staff, agent or investor permissions. The salon user can view its own customer data and submit its own order requests, which the office turns into official orders in the shared order system (D-34).
3. **Supplier is classified:** supplier identity, pricing and terms are visible to Owner and Manager only. Enforced in the database, not just the UI.
4. **Payments:** cash, local bank transfer, and installment plans of 2 or 4 instalments.
5. **Stack:** Next.js + Supabase (Postgres with RLS, Auth, Storage, Edge Functions), PWA for reps, hosted on Vercel + Supabase. See doc 05 for why.
6. **Locale:** Pakistan, PKR, financial year ends 30 June. UI in English only (D-42).
7. **Security is a launch requirement, not a phase.** The MVP ships with RLS, MFA for owner/manager, device binding for reps, an append-only audit log, and the supplier compartment.
8. **No cheating by design.** Five principles run through every module (doc 13): (a) nothing is ever edited or deleted — only reversed with a new, attributed entry; (b) every unit of stock and every rupee has a custody chain with a two-party acknowledgment at each handoff; (c) the party with the opposite interest confirms independently — the salon gets a system receipt, the bank statement confirms deposits; (d) high-risk actions are maker-checker, and the maker can never be the checker; (e) the owner receives a daily exception digest of every override, adjustment, variance, write-off and vault read.

## Vocabulary

- **Salon** — any customer: any business anywhere in Karachi that offers hair care, hair treatment or hair beauty to end users — ladies' beauty parlors, men's salons, unisex salons, bridal studios, barber shops, hair studios, spas with hair services, home-based parlors, beauty academies. One word in the system.
- **Pin** — a salon's location on the rep's map. Reps prospect by dropping pins with a note, or by one-tap online discovery of every listed salon within a few kilometres of where they stand.
- **Rep** — a field salesperson (the "sales appointee"). Visits salons, submits order requests, delivers, collects.
- **Order request** — what a rep or salon submits (`order_intake_card`, the "New Order Details" card). It is not an official order; only the office creates those (D-34).
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
