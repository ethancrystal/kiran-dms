# User journeys and workflows

Derived reference (see [README.md](README.md)). The journeys themselves are written in [SPEC.md §3](../../SPEC.md) (J1 to J7) and are not copied here; this file gives each step's status, derived from the requirements it cites (the weakest one wins), and lists the workflows that no journey covers yet. Each module document lists its own journeys in section 7.

## J1 — A salaried rep's day

| Step | Requirements cited | Step status |
|---|---|---|
| J1.1 | CTL-05, PIP-09 | PARTIALLY IMPLEMENTED |
| J1.2 | PIP-03, PIP-06 | IMPLEMENTED — NOT VERIFIED |
| J1.3 | DEM-01, NFR-01, ORD-14, PIP-02 | PARTIALLY IMPLEMENTED |
| J1.4 | NFR-01 | PARTIALLY IMPLEMENTED |
| J1.5 | CTL-01 | PARTIALLY IMPLEMENTED |
| J1.6 | CTL-03, INV-05, PAY-05 | IMPLEMENTED — NOT VERIFIED |
| J1.7 | SAL-09, SAL-14, SEC-06 | NOT STARTED |
| J1.8 | FLD-03, FLD-06 | IMPLEMENTED — NOT VERIFIED |
| J1.9 | — | no requirement cited |

## J2 — A rep adds a prospect

| Step | Requirements cited | Step status |
|---|---|---|
| J2.1 | MAP-02, PIP-07 | NOT STARTED |
| J2.2 | SAL-03, SAL-13 | PARTIALLY IMPLEMENTED |
| J2.3 | CTL-18 | PARTIALLY IMPLEMENTED |

## J3 — An independent agent buys stock

| Step | Requirements cited | Step status |
|---|---|---|
| J3.1 | AGT-04 | NOT STARTED |
| J3.2 | AGT-03 | NOT STARTED |
| J3.3 | AGT-03 | NOT STARTED |
| J3.4 | DEM-02 | NOT STARTED |
| J3.5 | AGT-04 | NOT STARTED |
| J3.6 | CTL-15 | NOT STARTED |
| J3.7 | AGT-06 | NOT STARTED |

## J4 — The manager loads tomorrow's bags

| Step | Requirements cited | Step status |
|---|---|---|
| J4.1 | INV-11 | NOT STARTED |
| J4.2 | CTL-05, DEM-02, INV-11 | NOT STARTED |
| J4.3 | CTL-05 | IMPLEMENTED — NOT VERIFIED |

## J5 — The owner's morning

| Step | Requirements cited | Step status |
|---|---|---|
| J5.1 | — | no requirement cited |
| J5.2 | CTL-15 | NOT STARTED |
| J5.3 | — | no requirement cited |
| J5.4 | DEM-03 | NOT STARTED |
| J5.5 | ORD-14, SEC-08, SEC-16, SEC-17 | NOT STARTED |
| J5.6 | CAP-01 | IMPLEMENTED — NOT VERIFIED |
| J5.7 | — | no requirement cited |

## J6 — A salon sends a repeat order request

| Step | Requirements cited | Step status |
|---|---|---|
| J6.1 | SAL-11, SEC-13, SEC-16 | IMPLEMENTED — NOT VERIFIED |
| J6.2 | INV-13, ORD-07, SAL-12 | PARTIALLY IMPLEMENTED |
| J6.3 | ORD-12, ORD-14 | IMPLEMENTED — NOT VERIFIED |
| J6.4 | ORD-14 | IMPLEMENTED — NOT VERIFIED |
| J6.5 | ORD-11, ORD-15 | IMPLEMENTED — NOT VERIFIED |
| J6.6 | ORD-13, SAL-12, SEC-14 | PARTIALLY IMPLEMENTED |
| J6.7 | ORD-11 | IMPLEMENTED — NOT VERIFIED |

## J7 — A rep's order request becomes an order

| Step | Requirements cited | Step status |
|---|---|---|
| J7.1 | ORD-14, PIP-09, SAL-14 | PARTIALLY IMPLEMENTED |
| J7.2 | ORD-14 | IMPLEMENTED — NOT VERIFIED |
| J7.3 | ORD-15 | IMPLEMENTED — NOT VERIFIED |
| J7.4 | ORD-01, ORD-15 | IMPLEMENTED — NOT VERIFIED |
| J7.5 | ORD-15 | IMPLEMENTED — NOT VERIFIED |
| J7.6 | ORD-01, ORD-11 | IMPLEMENTED — NOT VERIFIED |
| J7.7 | CTL-13, ORD-04 | PARTIALLY IMPLEMENTED |


## Workflows with no complete journey (incomplete workflows and missing scenarios)

| Workflow | What is missing | Requirements | Finding | Decision needed |
|---|---|---|---|---|
| Refund to a salon | No requirement; MJ's policy: the salon requests, the owner approves, then the refund is paid | none | DA-027 | yes |
| Return of goods from a salon in Phase 1 | Movement kinds exist, the return workflow is Phase 2 | INV-03, ORD-06, CTL-12 | DA-028 | yes |
| Bank deposit of office cash | No backend and no screen | CTL-04 | — | no (build) |
| Write-off and adjustment approval, receivable write-off | No approval screen; authority being amended | CTL-06 | DA-013 | yes |
| Salon verification by OTP | No SMS provider | CTL-09 | DA-017 | yes |
| Contact-phone change with OTP | No SMS provider, no interim rule | CTL-18 | DA-017 | yes |
| Receipt to the salon's phone | No messaging channel | CTL-01, PAY-03 | DA-015 | yes |
| Owner daily digest | Not built; channel open | CTL-15, MSG-03 | DA-016 | yes |
| One-screen offboarding | Status change exists; snapshot and reassignment screen not built | SEC-08 | — | no (build) |
| Backup and restore drill | Not built | SEC-10, NFR-10 | DA-049 | no (build); off-site account is human-only |
| Offline capture in the rep app | Outbox built, no page uses it | NFR-01, PIP-07, DEM-01 | — | B-31(c) decided in PR 115 |
| Agent cash-and-carry purchase (J3) | Agent role not built | AGT-01 to AGT-06 | — | OQ-17, OQ-20 open |
| Storefront order to the office queue | Not built; Shopify questions open | D-53, D-59, D-61 | DA-042 | yes (B-56, B-57, B-60) |
| Contact deletion on request | Conflicts with no-hard-delete and audit images | NFR-08 | DA-036 | yes |
