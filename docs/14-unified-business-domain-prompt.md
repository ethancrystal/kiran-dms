# 14 — Unified Business Domains and Agent Execution Brief

**Status:** Architecture brief and task-specific agent instruction.  
**Authority:** Supplements docs 00–13, SPEC.md and docs/ACTIVITY.md. It does not override them, change a fixed decision, approve a permission change, move a roadmap gate, or authorise production work.  
**Owner:** MJ (Moiz Jamil).  
**Business:** Kiran Company, Karachi.  
**System:** Kiran DMS.

> **Agent instruction:** Read this entire document before planning or changing any supplier/procurement, salon/customer, salaried-rep, independent-agent, investor/capital, office/admin, or cross-domain workflow. Follow AGENTS.md, CLAUDE.md, docs/AGENT-COMPLIANCE-PROTOCOL.md and docs/ACTIVITY.md first. This brief describes the desired joined-up business model; it is not permission to implement features whose scope, phase, commercial terms or permissions remain unapproved.

---

## 1. Mission

Kiran DMS must become one integrated operating system for the business, not several disconnected modules that happen to share a login.

The business has distinct but connected areas:

1. **Supplier and procurement** — supplier relationship, purchase orders, goods receipts and replenishment.
2. **Salons and customers** — salon CRM, prospect pipeline, contacts, visits, orders, deliveries, invoices, receivables, collections and customer communications.
3. **Salaried sales representatives** — internal field staff who work assigned territories, carry Kiran-owned stock, visit salons, sell, deliver and collect.
4. **Independent agents** — separate resellers who purchase from Kiran, pay in full before stock release and then resell independently.
5. **Investors / capital partners** — people who contribute funds to an approved product or batch funding arrangement and receive only the accounting and return defined by their agreement.
6. **Owner and Manager / office administration** — governance, day-to-day operations, approvals, reconciliation, monitoring and business reporting.

The central design rule is:

**One business event should be recorded once, create its valid stock and money effects once, and appear in every authorised business view without being re-entered or manually reconciled in multiple places.**

Do not solve this by making one giant generic customer table or one unrestricted admin role. Preserve domain identities, transaction ownership, role separation and the controls that make records trustworthy.

## 2. What is confirmed, what is current, and what is proposed

Use these labels in every audit, plan, status report and implementation handoff:

- **Confirmed:** directly supported by MJ's instructions or an existing fixed decision in docs 00 or 12.
- **Currently specified:** described in docs 01–13 or SPEC.md, but not necessarily implemented.
- **Implemented:** proved by the current code and tests, not merely present in a planning document.
- **Proposed / not yet approved:** a design option or extension that requires an owner decision.
- **Blocked:** cannot safely be implemented until a named decision, dependency or phase gate is satisfied.

Do not describe the whole CRM as complete because one section or page exists. Map every journey to its current database tables, RPCs, frontend routes, tests and status-board evidence.

### Current repository scope that must be preserved

The existing planning set already defines the salon CRM, field sales, inventory, supplier confidentiality, payments, credit, anti-fraud controls and independent-agent channel. In particular:

- Owner and Manager are existing office roles with a documented governance split; D-08 was confirmed by MJ on 2026-11-02 (doc 12).
- Salaried Rep and Independent Agent are distinct operating models.
- Independent Agent rules D-15 to D-23 must remain intact.
- Supplier identity and purchasing details remain in the restricted supplier compartment. The implementation schema is named `supplier_vault`, not Supabase's reserved `vault`.
- Product names, variants, prices and costs remain dummy until MJ supplies the real catalogue (OQ-16).
- The roadmap and phase gates in docs 11 and docs/ACTIVITY.md remain controlling. P1-05, P1-07, P1-10, P1-11 and P1-15 have distinct dependencies and must not be silently treated as complete.
- Investor/capital management is an additional business domain to specify. It is not currently an approved change to the production permission matrix or a reason to bypass existing phases.
- MJ confirmed on 2026-11-03 that salon customers may have authenticated portal accounts and can submit their own orders alongside representative-placed orders. Doc 15 defines the module-level target and access model.

## 3. Business-domain diagram

The editable Mermaid source is maintained at [diagrams/business-domain.mmd](diagrams/business-domain.mmd).

The diagram deliberately distinguishes:
- people and organisations from application roles;
- a user-facing workspace from a database permission role;
- salaried representatives from independent agents;
- investors from agents;
- the external supplier from Kiran's restricted internal procurement workflow;
- the salon customer portal from internal staff workspaces and the internal staff role model;
- the two salon order channels from the representative visit and acquisition-attribution records;
- the restricted supplier/cost compartment from ordinary stock and sales records.

The Investor Workspace remains labelled proposed. An authenticated salon customer portal is required: salons can submit their own orders and view only their own permitted customer data. No supplier portal is assumed. The office console is a workspace for Owner and Manager, not a new unrestricted admin role.

## 4. Actors and domain boundaries

### 4.1 Owner

The Owner is the highest-authority business user. The owner dashboard should consolidate business performance and exceptions across domains. Governance powers remain owner-only as documented in docs 06 and 13, subject to MJ's resolution of D-08.

The owner needs a consolidated view of:
- salon sales, receivables, collections and pipeline;
- warehouse inventory, rep bag custody and stock discrepancies;
- supplier purchasing and restricted cost information where the owner has vault access;
- independent-agent purchases and channel performance;
- investor contributions, product-batch allocations and settlement status once those workflows are approved;
- approvals, anomalies, audit events, financial reconciliation and outstanding decisions.

A consolidated dashboard must not flatten separate ledgers into one ambiguous balance.

### 4.2 Manager

The Manager performs daily business operations within the permission matrix already defined in docs 06 and 13. The Manager is not automatically a second Owner. Do not grant owner-only governance powers for convenience.

Every office screen and RPC must enforce the existing authority split in the database, not only in navigation or client-side checks.

### 4.3 Salaried Sales Rep

A salaried Rep is Kiran's internal field employee or appointee.

The Rep:
- works assigned territories and routes;
- sees only authorised salon data for those territories;
- uses an approved, bound device;
- checks in and confirms the bag count;
- visits salons and records outcomes;
- creates permitted orders and deliveries;
- collects cash or records bank transfers;
- closes the day with a stock count and two-party cash handover.

Kiran retains ownership and custody responsibility for stock until the customer transaction and delivery rules say otherwise. Rep access remains territory-scoped, page-limited and protected from bulk export.

### 4.4 Independent Agent

An Independent Agent is a separate resale channel, not a salaried Rep and not an Investor.

The currently confirmed channel model is:
- the owner creates the agent account;
- the agent sees only their own agent catalogue, approved agent prices, availability quantities, purchases and receipts;
- the agent pays in full by counted cash or matched transfer before stock leaves the warehouse;
- the transaction is a cash-and-carry sale and stock movement uses the existing `sale_to_agent` concept;
- title passes to the agent on the completed sale;
- the agent resells independently and does not report downstream salon identities, sales, visits, cash or inventory to Kiran;
- an optional pre-order request is the only agent-originated workflow currently specified;
- Kiran pays no joining, recruitment, referral, override or multi-level reward. The agent's earnings come from the margin on the agent's own resale activity.

Never attach investor profit distributions to agent pricing, agent purchases, agent commissions or recruitment.

### 4.5 Investor / Capital Partner

An Investor contributes capital under a separate, explicit funding agreement. Investor is not a synonym for Agent, Affiliate, Reseller, Rep, Supplier, Salon or Admin.

The system must be able to answer, for an approved agreement:
- who contributed funds and when;
- how much principal was received and reconciled;
- what amount remains unallocated;
- how much was allocated to each approved product pool or batch;
- what purchases and stock are attributable to that batch;
- what quantities were sold, returned, damaged or remain unsold;
- what cash was collected;
- what cost of goods sold and approved expenses were attributed;
- what profit or loss is realised or still provisional;
- what amount is due to the Investor under the agreement;
- what principal was returned and what profit was distributed, separately;
- what company/operator fee or company share was approved, if any.

The rights of an Investor depend on the signed arrangement. An Investor does not automatically own specific inventory, get a guaranteed return, get a fixed percentage, get access to supplier identity or see other investors' accounts.

### 4.6 Salon / Customer

A Salon is a direct business customer in the CRM and order-to-cash workflow. It has pipeline stages, territory, contacts, visit history, credit profile, orders, deliveries, invoices, installments, payments, receipts and customer communication. It may have a separately authenticated customer portal membership linked to its own salon record; a salon contact is not automatically a login.

The salon portal must let an authorized salon user view the shared active product catalogue, that salon's assigned prices, customer-safe aggregate stock quantities, its own orders/status/history and its own authorized invoices/receipts/statements, and independently submit orders for that salon. Portal users cannot see other salons, internal CRM notes, rep GPS, supplier identity, costs/margins or stock custody details. Representative-placed orders remain a separate channel captured during a genuine visit. Both channels use one canonical order engine. Independent Agents do not report the salons they serve, so do not infer or import those downstream customers into Kiran's salon CRM.

### 4.7 Supplier

A Supplier is an upstream vendor whose information is held by authorised Kiran staff. The repository's supplier confidentiality model remains in force.

A supplier login or self-service portal is not implied. Do not create supplier accounts or external supplier access unless MJ explicitly approves it as a separate scope.

Supplier identity, contacts, terms, purchasing documents, supplier references, purchase costs and landed costs stay in the restricted `supplier_vault` compartment and its approved vault API. Ordinary inventory, rep, agent and customer surfaces must never expose those values.

## 5. How the domains connect

### 5.1 Supplier to available stock

Authorised office user records supplier and purchase data in the restricted procurement workflow. A goods receipt validates received quantities and creates the minimum public inventory receipt needed for operations. The public stock record carries only permitted SKU, quantity, Kiran-owned batch reference, date and opaque linkage. It must not reveal supplier identity, supplier terms, lot reference or purchase cost.

### 5.2 Products and catalogue to every sales channel

The product/SKU catalogue is shared, but channel pricing and access are not:
- salon selling prices use the approved salon price list;
- agent prices use the separate owner-managed agent-price mechanism;
- cost and supplier data are restricted;
- Rep screens show only the selling and operational data they need;
- agent screens show their agent price and available quantity, not Kiran's cost or margin.

A shared product identity must not mean every role can read every price column.

### 5.3 Salon CRM to sales and collections

The salon is the source record for customer identity, territory and CRM history. The order system accepts two channels: an office order created by the owner or manager (often from a rep's order-intake card, D-30), or a salon_portal order created by an authenticated member of that salon. Both create the same canonical sales order and lines, with server-resolved prices and immutable order-time snapshots. The record distinguishes original acquisition rep, current assigned rep, actual order-taking rep, authenticated creator and channel. A portal order does not fabricate a visit or rep attribution. Delivery creates stock movements and invoices. Installments and payments update receivables and cash ledgers through documented write paths. Receipts are independently delivered to the salon. Re-order/retention tasks can use orders from either channel; physical-visit and rep productivity metrics use genuine rep visits only.

### 5.4 Independent Agent to stock and money

Agent order, payment and stock release form one auditable cash-and-carry process. Payment must be fully received and verified before stock release. The sale and receipt appear in the office reports and owner digest. The agent sees only their own completed purchases and permitted catalogue data. There is no downstream agent resale ledger in the current model.

### 5.5 Investor capital to a product batch

Investor records must connect to an agreement, capital contribution, allocation, batch and settlement records. The purchase and stock ledgers remain authoritative for procurement and quantity. Sales, collection, COGS, inventory and expenses provide the batch performance inputs. The investor ledger records the contractual allocation and settlement outputs. Do not duplicate the inventory ledger or create an independent stock balance for each investor unless the signed agreement and approved accounting design require it.

### 5.6 Office administration and reporting

The Owner and Manager operate from a common office console with permission-specific actions. Dashboards aggregate from the canonical domain records. Reports must retain lineage to those records and identify provisional versus settled financial measures. High-risk changes remain approval-gated and audited.

## 6. Investor accounting rules that the system must not violate

These are engineering guardrails, not a chosen investment contract or accounting policy.

1. Keep **capital contribution**, **capital allocation**, **purchase spending**, **inventory value**, **sales revenue**, **cash collected**, **cost of goods sold**, **gross profit**, **net profit/loss**, **principal returned** and **profit distributed** as distinct measures and transaction types.
2. Receiving investor money does not make it business revenue or realised profit.
3. Capital not allocated to an approved batch remains unallocated. Do not count it as deployed capital, inventory or profit.
4. Allocating capital to a batch is not the same as spending it with a supplier. Preserve the allocation and actual purchase transaction separately.
5. Purchasing stock does not automatically expense all units. Unsold units remain inventory assets; COGS is recognised for units sold under the accounting-approved costing method.
6. Attribute sales and expenses to the correct batch, including partial sales, payment fees, shipping, packaging, discounts, refunds and returns where the agreed policy says they belong.
7. Do not distribute provisional profit while required sales collections, returns, inventory counts, expenses or settlement conditions remain unresolved.
8. Principal returned is not profit paid. Profit paid is not principal returned. Neither may overwrite the original contribution.
9. Every allocation and distribution must reconcile to the signed agreement and source transactions.
10. All money calculations use the repository's integer-paisa / safe numeric conventions. No floating-point money.
11. Financial events are append-only or corrected with attributed reversing/adjustment rows. Never silently rewrite a historical contribution, purchase, payment or payout.
12. Do not create a default 80:20 investor/company split, fixed ROI, promised return, principal guarantee, or loss allocation from earlier examples. Those values were illustrative only and are not approved business rules.

### 6.1 Decisions required before real settlement

The following remain owner decisions and are recorded in doc 12:
- the legal and commercial nature of each arrangement (for example, loan, partnership, profit share, revenue share or another arrangement);
- batch-specific versus pooled investment, or support for both;
- the formula used to allocate capital and calculate each investor's contractual share;
- the definition of distributable profit and the allowed direct/indirect expenses;
- inventory costing method, returns, unsold stock, damaged goods, taxes, fees and bad-debt treatment;
- who bears losses and whether/how losses reduce principal or carry forward;
- when principal may be returned and when profit becomes distributable;
- any company/operator management fee or capital share;
- what product, financial and statement information an Investor may see;
- who may create agreements, receive capital, allocate funds, close a batch, approve settlements and release payments.

Do not implement live payout or guaranteed-return behavior until these decisions are documented and approved. Legal, tax and accounting treatment must be reviewed by appropriately qualified advisers in Pakistan before live use.

## 7. Security and privacy model

The existing security plan remains binding. New domain access must be designed into RLS, RPCs and tests before UI work.

| Persona | Default scope | Must not receive |
|---|---|---|
| Owner | Full authorised business view and owner-only governance | No bypass of audit, approvals or append-only history |
| Manager | Existing operational access and explicit vault grant only | Owner-only governance unless D-08 is resolved otherwise |
| Salaried Rep | Own approved device, assigned territories, route, permitted salons, own bag and work records | Supplier data, costs, Investor data, other Rep data, unrestricted exports |
| Independent Agent | Own account, agent catalogue, permitted quantity availability, own purchases and receipts | Salons, other Agents, supplier identity, Kiran cost/margin, Investor data |
| Investor | Own contributions, allocations, batch statement and contractual settlement records only, if portal is approved | Other Investors, supplier identity, raw supplier documents, other channels' personal data |
| Salon / Customer | Its own profile, shared catalogue, own assigned prices, safe aggregate stock, own orders/status/history and authorized invoices/receipts/statements; may submit own orders | Other salons, internal CRM notes, Rep GPS/field data, supplier data, cost/margin, stock locations/custody and company administration |
| Supplier | No Kiran DMS login by default | Internal CRM, other suppliers, investor information and company-wide data |

Mandatory controls:
- deny by default; RLS enabled and forced on every new table in the same migration;
- approved writes through narrow `SECURITY DEFINER` RPCs with pinned `search_path`, role/device/business checks and idempotency;
- append-only ledger rows and reversal-based corrections;
- audit triggers and verifiable hash chain;
- AAL2 for office governance and existing device controls for Reps;
- maker/checker where required; maker cannot approve own request;
- server-side enforcement. UI hiding is not security;
- no supplier identity or restricted costs in public tables, generic views, client bundles, prompts, errors, logs, screenshots or investor statements;
- no cross-investor reads; Investor A must not be able to infer Investor B's identity, contribution, allocation or settlement;
- synthetic records only in tests and staging. Never copy real supplier, salon, bank or investor personal data into this repo.

## 8. Required end-to-end business journeys

Map each journey to current code and tests before declaring it built.

### J1 — Procurement to inventory

Authorised internal user → restricted supplier record → purchase order → goods receipt and reconciliation → opaque inventory receipt → warehouse availability → exception and audit review.

### J2 — Salon acquisition to repeat order

Prospect → territory assignment → visit → trial/quote → first order → delivery → invoice → payment/installment → receipt → due-list → repeat order or win-back.

### J3 — Salaried Rep's daily operations

Approved device → check-in and bag count → assigned route → salon visit → order/delivery/collection → offline sync and replay protection → stock close → two-party cash handover → Manager review and Owner exceptions.

### J4 — Independent Agent cash-and-carry

Owner-created Agent → agent catalogue → agent price and available quantity → purchase → full payment verification → stock release and `sale_to_agent` → numbered invoice/receipt → owner digest. Agent downstream resale remains outside Kiran's required reporting.

### J5 — Investor contribution and batch settlement (proposed until decisions are approved)

Agreement → contribution received/reconciled → capital allocation → approved product batch and purchases → inventory receipt → sales and collections → COGS/expenses/returns reconciled → provisional result → agreement-based calculation → required approvals → principal repayment and profit distribution as separate entries → Investor's own statement.

### J6 — Owner / Manager business control

Office dashboard → operational queues → approvals and exceptions → stock/cash/receivables reconciliation → Agent channel monitoring → authorised supplier review → Investor exposure and settlement review if approved → audit trail and management reporting.

## 9. Data-model and implementation instructions for coding agents

First inspect actual schema, migrations, RPCs, RLS matrix, front-end routes, server actions, generated types and tests. The domain model below is conceptual, not an instruction to create duplicate tables.

Reuse existing canonical records where possible. Do not create parallel salon, product, order, payment, stock or supplier ledgers without documenting why the existing model cannot represent the required event.

For every new or modified entity, document:
- record grain, owner and lifecycle;
- primary/foreign keys and integrity constraints;
- who can read and write each field;
- sensitivity classification and whether any field belongs in `supplier_vault`;
- whether the table is immutable/append-only or mutable configuration;
- the only approved write RPC and its role/device/idempotency checks;
- audit trigger, reversal behaviour and RLS test matrix rows;
- links to source records used in derived financial measures.

Expected logical domains to map to the real schema:
- identity, role, MFA, device and permissions;
- salon CRM, territory, contacts, visits, stage history and route;
- product, SKU and selling-price catalogue;
- restricted supplier vault, purchase orders and goods receipts;
- inventory locations, batches and stock movements;
- salon orders, deliveries, invoices, installments, payments, receipts and cash ledger;
- Independent Agent catalogue, agent price and cash-and-carry purchase records;
- proposed Investor agreement, capital contribution, allocation, batch participation, settlement and distributions;
- approvals, audit, digest, reconciliation and reporting.

Do not put supplier_id or supplier name into public product/SKU entities. Do not add unrestricted cost columns to the public schema. The public inventory bridge from the vault must carry only the allowed opaque reference and stock facts.

## 10. Required verification

Every implementation slice needs both positive and negative tests. At minimum, the complete architecture must eventually prove:

- Rep A cannot read Rep B's salons, routes, cash, bag, orders or contact data.
- Rep cannot access supplier vault, cost, Investor or Agent-private records.
- Agent A cannot read Agent B's purchases, any salon CRM data, supplier data, costs, margins or Investor data.
- Agent cannot release stock before full payment is confirmed.
- Investor A cannot read Investor B's contributions, agreements, allocations, settlement or statement rows.
- Investor cannot read supplier identity, supplier documents or internal procurement cost by default.
- Salon/customer cannot read another salon's account or internal CRM data.
- Manager-only and Owner-only governance permissions follow the current decision record.
- Direct table writes fail; only the authorised RPCs work.
- Append-only history resists UPDATE/DELETE and reversals remain attributed.
- Replayed contribution, allocation, stock movement, sale, payment or distribution does not create a duplicate effect.
- Investor allocations cannot exceed reconciled available capital or the approved batch funding limit.
- Sold quantity plus remaining quantity reconciles to goods received; sold COGS plus remaining stock value reconciles under the approved cost method.
- Principal repayment is never counted as profit distribution, and no provisional profit can be marked paid.
- All statements reconcile to transaction sources and agreement versions.
- Supplier information does not leak through API, views, RPCs, exports, PDFs, logs or frontend code.

Run applicable lint, typecheck, unit tests, database/RLS suite, build and E2E tests. Record exact results. A test that was not run is not a passing test. A new page is not proof of an end-to-end journey.

## 11. Mandatory agent execution sequence

When MJ asks for work involving these domains, follow this sequence.

### Stage A — Repository compliance and current-state audit

1. Follow repository startup protocol, preflight, session log and claim.
2. Read this document, docs 00–13, SPEC.md and the relevant implementation sources.
3. Map **implemented**, **partially implemented**, **missing**, **broken**, **blocked** and **not approved** separately.
4. Identify the canonical tables/RPCs/routes/tests for every existing domain. Include exact file paths and evidence.
5. Check current branch and full worktree, preserve all unrelated changes and never work on main.

### Stage B — Domain and decision alignment

1. Draw the current domain relationship diagram and the intended target diagram.
2. Reconcile the access/persona matrix with docs 06 and 13.
3. Add unresolved business choices to doc 12 as open questions before treating them as requirements.
4. Add new functional requirement IDs to doc 03 only after the owner has approved the scope and testable acceptance criteria.
5. Update docs 04, 05, 06, 07, 09 and 10 where the approved model changes domain relationships, security, architecture or financial invariants.
6. Update doc 11 roadmap only after the phase and dependency sequence is agreed.
7. Update SPEC.md as an index; numbered planning documents and ACTIVITY remain authoritative.

### Stage C — Dependency-ordered implementation plan

The agent must produce a dependency graph, not a feature shopping list. It should show:
- existing work that can be reused;
- unbuilt foundations that block later journeys;
- which migration, RPC, RLS tests, UI route and E2E test each slice needs;
- which owner decisions block implementation;
- which phase/gate permits the work;
- rollback/reversal and data-import considerations.

Do not silently reorder the current roadmap. Follow the current ACTIVITY phase gate and stop rules.

### Stage D — Incremental build

After approval and when the roadmap permits, build one verifiable slice at a time. A reasonable dependency pattern is:
1. complete existing foundation and inventory/security prerequisites;
2. implement and verify restricted procurement and goods-receipt bridge;
3. complete sales, invoices, payment, cash and stock reconciliation;
4. implement and verify existing independent-agent cash-and-carry scope;
5. implement Investor capital records after agreement and permission decisions are approved;
6. implement batch profit calculation and investor statements only after accounting and settlement rules are approved;
7. complete owner/manager reporting, approvals and any separately approved portals;
8. run cross-domain attack, reconciliation and end-to-end tests.

This list does not override the existing numbered roadmap. If the actual task dependencies differ, document and obtain approval for the deviation.

### Stage E — Independent verification and handoff

- Builder may report DONE (self-reported), never VERIFIED.
- Independent verifier or MJ attempts the negative access and reconciliation tests.
- Re-run from a clean checkout where practical.
- Record branch, commit, PR, commands, pass/fail counts, unverified items, blockers, assumptions and handoff in docs/ACTIVITY.md.
- Do not claim the entire CRM or all domains are complete unless every required journey is proven end to end.

## 12. Stop conditions

Stop the affected task, add a blocker and ask MJ when:
- an Investor contract, allocation formula, profit definition, loss treatment, capital repayment, distribution time or operator fee is undecided;
- an implementation needs a new role, privilege, portal, data export or access to another persona's records;
- a screen or report could expose supplier identity, restricted costs, salon personal data or another investor's data;
- the current phase or gate does not permit the work;
- requirements and implementation disagree;
- a production system, real business data or third-party spend is required.

**Definition of success:** Kiran enters each real transaction once; stock, cash, receivables, investor exposure and business reports derive from auditable domain records; each actor sees only their authorised data; and every financial result can be reconciled to its source transactions and approved agreement.
