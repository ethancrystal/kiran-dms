# Business rules and constraints

Derived reference (see [README.md](README.md)). This is a register, not a second copy: each rule keeps its existing ID and its single source. No new rule IDs are created. Where a rule is stated in several places, the "Single source" column says which one to edit (finding DA-039); the others should point to it.

## 1. Rule families and their single source

| Family | IDs | Single source | Also stated in |
|---|---|---|---|
| Hard rules (supplier secrecy, integrity, access, secrets, scope) | H-01 to H-27 | `docs/ACTIVITY.md` §5 | AGENTS.md (summary), doc 06, doc 07 |
| Fixed decisions | D-01 to D-61 (D-44 unused, D-51 used twice: DA-005) | doc 12 decision log | doc 00 fixed decisions, docs 03, 06, 13 |
| Domain invariants | doc 04 invariants (append-only list in invariant 1) | doc 04 | H-06 |
| Permission matrix | — | doc 06 §2 | H-15, D-08, SEC-01, doc 15, SPEC.md |
| Maker-checker thresholds | — | doc 13 §9 | CTL-06, CTL-07, doc 06 §2 approval classes |
| Credit and installments | — | doc 09 | PAY-01, ORD-02, SAL-04 |
| Stock custody | — | doc 10 | INV-03, CTL-05 |
| Assumptions | A-01 to A-24 | ACTIVITY §15 | log ASSUMPTION entries |
| MJ's business specification | — | doc 16 (D-33) | doc 00, doc 03 header |

## 2. Rules every module applies

| Rule | Statement (short) | Source |
|---|---|---|
| Append-only | INSERT and SELECT only on the listed tables; corrections are reversing rows | H-06, doc 04 invariant 1 |
| No hard deletes | Nothing in `public`, `control` or the vault is deleted | H-07 |
| Mutations by function | Money, stock, stage, credit, approval and vault writes only through SECURITY DEFINER functions with pinned search path, role, device and rule checks and an idempotency key | H-08 |
| Server time | Server time is authoritative; client time kept as evidence | H-09 |
| Derived balances | Receivable, cash in hand and stock on hand are sums of rows | H-10 |
| Gapless numbers | Invoice and receipt numbers gapless per financial year from 1 July | H-11, ADM-03, D-06 |
| Maker is never checker | A database constraint on every approval | H-12, SEC-11 |
| Money in paisa | Integer `bigint` paisa, never floats | AGENTS.md conventions, doc 04 |
| Office-only orders | Only the office creates official orders; reps and salons submit requests | D-30, D-34 |
| Delivery approval and acknowledgement | A rep delivery is final only after office approval and the salon's signed acknowledgement | D-32, D-49 |
| Reachability | Direct assignment, else territory coverage, else no rep | D-36 |
| Supplier secrecy | Supplier identity and cost exist only in the vault; visible to owner and granted manager | H-01, H-05, D-03 |
| English-only UI | No Urdu labels, no i18n layer | D-42 |
| Dummy data | Product data is `[Dummy]` until the real catalogue arrives | H-04, B-10 |

## 3. Rules being changed or still open

| Topic | State | Where |
|---|---|---|
| Write-offs | MJ 2026-11-19: salon debt owner only; owner and manager approve other write-offs. Documents not yet amended | DA-013, PR 115 |
| Offline check window | MJ 2026-11-19: one hour. Not built | DA-029, PR 115 |
| Product groups | MJ 2026-11-19: managers may edit product groups (B-41, D-62 proposed in PR 115) | PR 115 |
| Refunds | MJ's policy stated; no requirement yet | DA-027 |
| Per-salon price below list | Open | OQ-33, DA-041 |
| Commission payout authority | Open | OQ-34, DA-019 |
| Config authority | Open | DA-014 |
