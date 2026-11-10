# Context map

Kiran DMS has seven business contexts and a shared kernel, and an eighth, storefront, that is planned and not built (D-51). Contexts are business boundaries, not code packages: each spans migrations, functions and screens.

This map is reference material for the engineering skills (see `docs/agents/domain.md`). It never overrides the planning set (`docs/00` to `docs/13`) or `docs/ACTIVITY.md`. Where it disagrees with them, they win and the gap is flagged.

Each context gets its own `docs/contexts/<name>/CONTEXT.md` only when a term is actually resolved (via `/domain-modeling`). Until then this map is the only domain file.

## Contexts

| Context | Owns | Main sources |
|---|---|---|
| [salon-pipeline](docs/contexts/salon-pipeline/CONTEXT.md) | salon, contact, pipeline stage and stage events, discovery, reorder cycle estimate, due list, salon import (SAL-10, `packages/import`) | doc 02; doc 03 SAL, MAP, PIP-05 to PIP-07; doc 04 |
| [field-operations](docs/contexts/field-operations/CONTEXT.md) | rep day (check-in, check-out), route and route stops, visit, task, rep profile and scorecard | doc 08; doc 03 PIP-01 to PIP-03, PIP-09, FLD |
| [orders-delivery](docs/contexts/orders-delivery/CONTEXT.md) | sales order, credit and price gates at order time, delivery, invoice issue, return to quarantine, price lists, the agent (reseller) channel as a sub-section | doc 03 ORD, AGT; doc 04 |
| [money-credit](docs/contexts/money-credit/CONTEXT.md) | credit profile and credit events, installment plans, payments, receipts, cash ledger, cash handover, bank deposit, credit notes, write-offs, commission calculation | doc 09; doc 03 PAY |
| [inventory](docs/contexts/inventory/CONTEXT.md) | catalogue and product groups, stock movements, stock issue to reps, rep bag, daily close, cycle count, quarantine, lost demand | doc 10; doc 03 INV, DEM |
| [supplier-vault](docs/contexts/supplier-vault/CONTEXT.md) | vocabulary only: what a supplier record, goods receipt and cost are, and who may see them. Never supplier data (H-01, H-02) | doc 07 |
| [control-governance](docs/contexts/control-governance/CONTEXT.md) | the owner's surface: approvals inbox, anomaly flags, owner digest, cases, balance confirmations, honeytokens, users, devices, vault grants, offboarding, commission plans | doc 13; doc 06; doc 03 CTL-11, CTL-14, CTL-15, SEC |
| [storefront](docs/contexts/storefront/CONTEXT.md) | planned, not built (D-51 to D-58): the public shop at khsalon.com. Visitor, visit, published category, product and SKU, default price, storefront event and its registered meaning, the Shopify copy of the catalogue, the direct buyer's paid order on its way into the office review queue. It reads the catalogue from inventory and hands orders to orders-delivery; it owns no stock, no price and no order | docs/plans/will-be-implemented/2026-11-10-khsalon-storefront-overview.md; doc 12 D-51 to D-58 |

Most CTL- and SEC-numbered requirements are controls that live inside the operational context they guard (for example a cash cap lives in money-credit, a stock-close variance in inventory). control-governance holds only what the owner reads and decides.

Not yet placed: reporting (RPT), messaging (MSG), admin configuration (ADM), non-functional requirements (NFR). Place them when a decision needs them.

## Shared kernel

Concepts every context uses with one meaning. Sources: doc 04 invariants, doc 05, doc 06, ACTIVITY §5.

- **Append-only record**: INSERT and SELECT only; a trigger raises on UPDATE and DELETE (doc 04 invariant 1). Corrections are reversing entries, never edits.
- **Paisa**: money in integer paisa (`bigint`), column suffix `_paisa`, never floats.
- **Server time vs client time**: the server's `now()` is authoritative; client timestamps go in `*_client` columns.
- **Idempotency**: every write carries a `client_id`; a replay returns the same result.
- **Roles**: owner, manager, rep (`app.user_role()`).
- **Maker and checker**: an approval's checker is never its maker (`checker_id <> maker_id`).
- **Audit chain**: triggers write `control.audit_event` with a sha256 hash chain; no application role writes it.
- **Gapless document numbers**: `control.doc_counter` numbers invoices, receipts, credit notes and write-offs.
- **Territory scoping**: territory and area are the row-level security scope for what a rep sees (doc 06).
- **Proof of presence**: GPS position, distance from the salon pin, mock-location flag and server time, recorded the same way on visits, payments, deliveries, discovery and rep days.
- **Configuration ownership**: each `app_config` key belongs to exactly one context.

## Seams between contexts

- **Invoice** is the seam between orders-delivery and money-credit: orders-delivery issues it; money-credit owns what the salon owes against it (doc 04 invoice and installment; receivable formula).
- **Delivery** is one transaction that writes stock movements (inventory), the invoice (orders-delivery), the cycle estimate and a stage event (salon-pipeline) (doc 04).
- **Visit** (field-operations) produces stage events (salon-pipeline) and lost-demand records (inventory).
- **Rep day** (field-operations) gates order, payment and visit writes, and carries the bag variance (inventory) and the cash handover (money-credit).
- **Credit gate** at order time (orders-delivery) reads credit state (money-credit) and the salon stage (salon-pipeline).

## Words that mean different things in different contexts

Always say which context you mean. None of these is settled yet; each context's `CONTEXT.md` settles its own sense.

| Word | Senses |
|---|---|
| blocked | salon stage `Blocked`; `salon_credit.blocked`; an order held for credit; new installment orders stopped after +15 days overdue; cash-cap block; rep check-in blocked. The credit gate currently reads both the stage and `salon_credit.blocked` (doc 04:156): an open question, not a decision. |
| cycle | reorder cycle (salon-pipeline); on-time installment cycles for credit graduation (money-credit); cycle count of stock (inventory) |
| receipt | payment receipt (money-credit); stock received (inventory); goods receipt (supplier-vault) |
| due | reorder due (salon-pipeline); installment due date (money-credit); task due time (field-operations) |
| variance | cash handover variance (money-credit); stock close variance and bag variance (inventory) |
| plan | installment plan (money-credit); commission plan (control-governance); roadmap phase plan |
| issue | stock issue to a rep (inventory); invoice issued (orders-delivery); receipt issued (money-credit); a GitHub issue |
| close | rep day closed (field-operations); daily stock close (inventory); order closed (orders-delivery); visit outcome closed-not-interested (field-operations) |
| override | credit override (money-credit, approval kind); manual stage override (salon-pipeline); manager override of a blocked rep day (field-operations) |
| return | salon return to quarantine (orders-delivery); bag return to warehouse (inventory); offboarding bag return (control-governance) |
| verified | salon verification status; MFA-verified (AAL2) session; delivery acknowledged by OTP; audit chain verified; a VERIFIED task in ACTIVITY.md |
| statement | bank statement; salon monthly statement; commission statement |
| handover | cash handover (money-credit); stock-take on handover of duty (inventory) |
| agent | an independent reseller (orders-delivery, doc 08 §10); a coding agent (ACTIVITY.md, protocol). In domain docs "agent" means the reseller; say "coding agent" for the other. |
