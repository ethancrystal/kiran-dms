# Test traceability matrix

Generated on 2026-11-19 from `main` at `d4b47ca` by the documentation audit (scripts kept outside the repository; the method is in [01-findings-register.md](01-findings-register.md)). Status words: [docs/requirements/README.md](../../requirements/README.md#status-vocabulary).

Tests are organised by slice and attack, not by requirement (finding DA-044), so the link is made two ways: requirement IDs the file cites, and the board task the file belongs to. The task assignment was made by reading each file's header and describe blocks. Test counts are `it(` and `test(` calls in the file, not run results; this audit did not run the database suite (the embedded Postgres does not start on the audit machine; CI on `main` is the run evidence).

| Test file | Board tasks | Test cases | Requirement IDs cited | Requirements reached through the task |
|---|---|---|---|---|
| `supabase/tests/append-only-sweep.test.ts` | P1-12 | 12 | — | 3 |
| `supabase/tests/audit-fixes.test.ts` | P1-30 | 51 | CTL-08, CTL-17, SEC-11 | 15 |
| `supabase/tests/b33-decisions.test.ts` | P1-02, P1-30 | 5 | PIP-01, SAL-01, SEC-08 | 27 |
| `supabase/tests/catalogue-prices.test.ts` | P1-19 | 36 | — | 2 |
| `supabase/tests/commission.test.ts` | P1-22 | 36 | CTL-13, FLD-01, FLD-03, FLD-06 | 4 |
| `supabase/tests/create-salon-blanks.test.ts` | P1-02 | 3 | — | 13 |
| `supabase/tests/crm-attacks.test.ts` | P1-02, P1-06 | 48 | ADM-03, CTL-05, CTL-07, INV-03, INV-04, INV-05, INV-06, MAP-12, ORD-01, ORD-02, ORD-03, ORD-04, SAL-02, SAL-04, SEC-01, SEC-03, SEC-11 | 23 |
| `supabase/tests/deliveries.test.ts` | P1-06 | 14 | ADM-03, ORD-03, ORD-04 | 11 |
| `supabase/tests/delivery-approval.test.ts` | P1-21 | 42 | — | 1 |
| `supabase/tests/device-guard.test.ts` | P1-01 | 4 | — | 8 |
| `supabase/tests/foundation.test.ts` | P1-01 | 40 | ADM-01, ADM-03, SEC-03, SEC-04, SEC-05, SEC-11, SEC-12, VLT-06 | 8 |
| `supabase/tests/function-gates.test.ts` | P1-12 | 18 | — | 3 |
| `supabase/tests/handovers.test.ts` | P1-07 | 15 | CTL-03, PAY-05, PAY-10, SEC-02, SEC-03 | 13 |
| `supabase/tests/inventory.test.ts` | P1-04 | 25 | CTL-05, DEM-01, INV-01, INV-02, INV-03, INV-04, INV-05, INV-06 | 7 |
| `supabase/tests/investors.test.ts` | P1-20 | 33 | CAP-01, CAP-02, CAP-03 | 3 |
| `supabase/tests/invitations.test.ts` | P1-18 | 61 | SEC-03 | 6 |
| `supabase/tests/invoice-composer-signature.test.ts` | P1-31 | 32 | — | 3 |
| `supabase/tests/invoice-document.test.ts` | P1-06 | 12 | ORD-05 | 11 |
| `supabase/tests/issue-sku-names.test.ts` | P1-04 | 7 | — | 7 |
| `supabase/tests/launch-acceptance.test.ts` | P1-12 | 16 | — | 3 |
| `supabase/tests/log-check-rulings.test.ts` | P0-09 | 38 | — | 0 |
| `supabase/tests/office-approvals.test.ts` | P1-25 | 14 | — | 8 |
| `supabase/tests/office-cash.test.ts` | P1-07 | 6 | PAY-02 | 13 |
| `supabase/tests/office-order-access.test.ts` | P1-23 | 20 | — | 9 |
| `supabase/tests/office-orders.test.ts` | P1-23, P1-25 | 18 | — | 17 |
| `supabase/tests/order-cards.test.ts` | P1-23 | 27 | ORD-14 | 9 |
| `supabase/tests/order-steps-reminders.test.ts` | P1-38 | 10 | MSG-03, ORD-04 | 2 |
| `supabase/tests/orders.test.ts` | P1-06 | 30 | CTL-07, CTL-08, ORD-01, ORD-02, ORD-03, ORD-10, SAL-04, SEC-11 | 11 |
| `supabase/tests/overviews.test.ts` | P1-26 | 28 | CAP-02, FLD-06, RPT-01 | 3 |
| `supabase/tests/payments.test.ts` | P1-07 | 55 | CTL-01, CTL-02, ORD-05, PAY-01, PAY-02, PAY-03, PAY-04, PAY-10, PAY-11 | 13 |
| `supabase/tests/receivables-ageing.test.ts` | P1-07 | 10 | PAY-07, PAY-11, SEC-02 | 13 |
| `supabase/tests/rep-blind-stock-issues.test.ts` | P1-29 | 7 | CTL-05 | 8 |
| `supabase/tests/rep-detail-documents.test.ts` | P1-28 | 24 | CTL-01, FLD-06, ORD-05 | 3 |
| `supabase/tests/rep-readonly-timelines.test.ts` | P1-24 | 27 | — | 3 |
| `supabase/tests/requests-portal.test.ts` | P1-23 | 35 | ORD-11, ORD-12, ORD-13, ORD-14 | 9 |
| `supabase/tests/reverify-attacks.test.ts` | P1-01 | 19 | — | 8 |
| `supabase/tests/reverify-slices-1-3.test.ts` | P1-18, P1-19, P1-20 | 12 | PIP-01, SAL-01, SEC-08 | 11 |
| `supabase/tests/reverify10-attacks.test.ts` | P1-01 | 17 | — | 8 |
| `supabase/tests/reverify11-attacks.test.ts` | P1-01 | 10 | — | 8 |
| `supabase/tests/reverify2-attacks.test.ts` | P1-01 | 11 | — | 8 |
| `supabase/tests/reverify3-attacks.test.ts` | P1-01 | 11 | — | 8 |
| `supabase/tests/reverify4-attacks.test.ts` | P1-01 | 18 | — | 8 |
| `supabase/tests/reverify5-attacks.test.ts` | P1-01 | 18 | — | 8 |
| `supabase/tests/reverify6-attacks.test.ts` | P1-01 | 6 | — | 8 |
| `supabase/tests/reverify7-attacks.test.ts` | P1-01 | 5 | — | 8 |
| `supabase/tests/reverify8-attacks.test.ts` | P0-09 | 12 | — | 0 |
| `supabase/tests/reverify9-attacks.test.ts` | P1-01 | 8 | — | 8 |
| `supabase/tests/rls-matrix.test.ts` | P0-06 | 5 | CTL-03, NFR-12, PAY-05 | 1 |
| `supabase/tests/routes.test.ts` | P1-16, P1-29 | 23 | PIP-03, PIP-05, PIP-06 | 8 |
| `supabase/tests/salon-approval.test.ts` | P1-18, P1-24 | 30 | — | 8 |
| `supabase/tests/salon-self-signup.test.ts` | P1-18 | 35 | — | 6 |
| `supabase/tests/salons.test.ts` | P1-02 | 21 | CTL-09, CTL-18, MAP-03, PIP-01, SAL-01, SAL-02, SAL-03, SAL-09 | 13 |
| `supabase/tests/schema-hygiene.test.ts` | P0-06, P1-12 | 14 | — | 3 |
| `supabase/tests/service-role-scan.test.ts` | P0-09 | 4 | — | 0 |
| `supabase/tests/storefront-catalogue.test.ts` | P1-33 | 35 | — | 1 |
| `supabase/tests/verifier-attacks.test.ts` | P1-01 | 27 | CTL-03, PAY-02, PAY-05, PAY-07, SEC-03 | 8 |
| `supabase/tests/verify-slices-1-3.test.ts` | P1-18, P1-19, P1-20 | 26 | INV-05, PIP-02, PIP-09, SAL-03, SEC-03 | 11 |
| `supabase/tests/visits.test.ts` | P1-02 | 14 | INV-05, PIP-02, PIP-09 | 13 |
| `apps/web/e2e/list-cap-note.spec.ts` | P1-30 | 2 | — | 15 |
| `apps/web/e2e/outbox-classify.spec.ts` | P1-09 | 8 | NFR-01, PIP-09 | 4 |
| `apps/web/e2e/outbox-crypto.spec.ts` | P1-09 | 8 | — | 4 |
| `apps/web/e2e/outbox-drain.spec.ts` | P1-09 | 14 | NFR-01, PIP-09 | 4 |
| `apps/web/e2e/outbox-history.spec.ts` | P1-09 | 8 | NFR-01, PIP-09 | 4 |
| `apps/web/e2e/outbox-queue.spec.ts` | P1-09 | 10 | NFR-01 | 4 |
| `apps/web/e2e/rep-login.spec.ts` | P1-01 | 4 | NFR-01, NFR-02 | 8 |
| `apps/web/e2e/salon-login.spec.ts` | P1-23 | 1 | — | 9 |
| `apps/web/e2e/salon-signup.spec.ts` | P1-18 | 3 | — | 6 |
| `apps/web/e2e/time.spec.ts` | P1-30 | 3 | — | 15 |
| `apps/web/e2e-stack/office.spec.ts` | P1-25 | 31 | ADM-01, CTL-03, CTL-05, FLD-03, FLD-06, NFR-01, ORD-14, PAY-02, PAY-04, PAY-05, PAY-07, PIP-01, PIP-09, SAL-01, SEC-03, SEC-04 | 8 |
| `apps/web/e2e-stack/overviews.spec.ts` | P1-26 | 4 | — | 3 |
| `apps/web/e2e-stack/p130-screens.spec.ts` | P1-30 | 9 | — | 15 |
| `apps/web/e2e-stack/rep-detail-documents.spec.ts` | P1-28 | 6 | — | 3 |

## Phase 1 requirements with no test at all

MAP-01, MAP-02, AGT-01, AGT-02, AGT-03, AGT-04, AGT-06, INV-11, DEM-02, DEM-03, VLT-01, VLT-02, VLT-03, VLT-04, VLT-05, SEC-06, CTL-06, CTL-11, CTL-15, CTL-16, RPT-02, NFR-04, NFR-05, NFR-06, NFR-08, NFR-09, NFR-10, NFR-11

**Totals:** 72 test files; 70 requirements cited by at least one test; 28 Phase 1 or undeferred requirements with no direct or task-level test.
