# Crimson Salon pilot — controlled end-to-end test

MJ's mission (2026-11-21) names **Crimson Salon** as the identified test salon for the
controlled pilot. This runbook is the procedure to run the complete business lifecycle
against it — request, review, official order, stock, delivery, payment, commission and
reporting — without touching real customers, real money or production.

## Where Crimson Salon lives

- The local e2e-stack seed creates it: `scripts/e2e-stack-seed.mjs` seeds an approved
  salon `[Test] Crimson Salon <tag>` through `app.create_salon` (the office's own path)
  and writes its id to `apps/web/e2e-stack/.seed.json` as `pilotSalon`.
- The seed refuses any database that is not on `127.0.0.1`/`localhost`, so Crimson Salon
  can never be seeded onto a hosted project by accident (H-19). On staging, create the
  salon by hand in `/office/salons` with the same name convention.
- People in the pilot are the seed's synthetic `[Test]` accounts only (H-03): owner,
  manager, two reps, and a salon login. No real phone numbers, CNICs or bank details.

## What the pilot exercises, and where the rule lives

| Case | What must happen | Where the control is |
|---|---|---|
| Request, not order | A rep's card or a salon portal request never creates an official order by itself | `app.rep_create_card`, `app.salon_submit_request`; conversion is office-only (`app.build_order`) |
| Manager review | The request sits in the review queue; the manager approves, rejects or returns it for correction; self-approval is refused | maker ≠ checker on `control.approval_request` (H-12) |
| Duplicate conversion | A second conversion of the same request is refused; replaying the client id changes nothing | intake-card close + `build_order` client id (H-08) |
| Price at confirmation | The order keeps the list/salon price copied at conversion; later catalogue edits do not rewrite it | `sales_order_line.list_price_paisa` / `unit_price_paisa` |
| Stock shortage | Delivery refuses beyond available stock; the shortfall shows, nothing goes negative | movement guard; `warehouse_availability` |
| Deduct on delivery | Stock leaves the warehouse/bag only when the delivery is approved and marked delivered | delivery path (MJ's 2026-11-20 ruling) |
| Price change mid-pilot | The manager edits a SKU price; old orders keep their figures; new conversions take the new one | price list + immutable order lines |
| Returns | The office accepts a return; stock comes back as a movement with a reason; append-only history | `return_to_warehouse`, `return_in` |
| Partial payments | An installment order takes a part payment; the balance is derived, never stored | `payment`, `payment_allocation` |
| Duplicate request | The same request submitted twice produces one card (replay key), a visible queue row | intake-card `client_id` |
| Commission | The approved delivery stamps the rep's commission; the rep sees only their own | commission tables, rep read-only views |
| Forecast | The office reads `app.office_restock_suggestions` for Crimson Salon's SKUs and treats it as an estimate | INV-07 estimate (2026-11-21) |

## Import, reconcile, switch

1. Dry-run the real Excel through `packages/import` first — see
   `docs/runbooks/excel-import-dry-run.md`. Nothing is written to any database.
2. Load the catalogue in this order: territories and areas, salons, products and SKUs
   (`[Dummy]` until MJ delivers the real catalogue, H-04), prices (owner only), opening
   stock with `app.office_receive_stock` (one receipt batch per physical delivery, with a
   reason — the batch id makes a re-run a no-op).
3. Reconcile after each load: compare `app.stock_on_hand` against the sheet, receivables
   against the ledger, and run the audit chain check. Fix by a new forward record, never
   by editing history (H-07).
4. Switch Crimson Salon only: run its complete lifecycle on the pilot database, keep its
   records, and review the office dashboards for it. Real salons join one at a time after
   MJ accepts the pilot result; the paper/Excel process for them runs in parallel until
   each salon's opening balances reconcile.

## Data separation and rollback

- Pilot runs happen on the local stack (or a staging MJ names). Never on the hosted
  production database (H-19); `scripts/apply-kiran-fresh.sh` is for a fresh project with
  MJ's explicit approval only.
- Everything the pilot writes is append-only and stamped `[Test]`/synthetic, so the
  rollback is: drop/reseed the local stack, or on staging reverse with reversing rows and
  revoke the pilot logins. No migration is ever undone.
- The append-only log gets one TASK entry per pilot run: what was exercised, what failed,
  and the exact commands.
