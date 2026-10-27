# 10 — Inventory and Restocking

Goal: no salon ever hears "it's finished", no cash sits in slow stock, and no unit leaves the business without a record.

## 1. Product structure

> **PLACEHOLDER DATA.** Every product name, size, weight and shade below is dummy text to show the *shape* of the catalogue. MJ will supply the real product names, sizes, weights and pack details (OQ-16 in doc 12); the structure (group → product → SKU) stays, the values get replaced.

Hair care catalogues are wide but shallow: a few product groups, many variants (shades, sizes, weights).

```
Product group   →  Product (Kiran label)        →  SKU (variant: size / weight / shade)
Color              [Dummy] Permanent Color          [shade A] 100 ml · [shade B] 100 ml · [shade C] 100 ml …
Developer          [Dummy] Developer                [strength X] 1 L · [strength Y] 1 L · [strength X] 5 L
Shampoo            [Dummy] Shampoo                  [variant 1] 1 L · [variant 2] 1 L · [variant 1] 5 L
Treatment          [Dummy] Mask / Treatment         500 ml · 1 kg
Styling            [Dummy] Styling                  Gel 500 ml · Wax 150 g · Spray 300 ml
Consumables        [Dummy] Foils, caps, gloves      per pack
```

Each SKU will carry: Kiran label, variant name, **size (ml/L or g/kg)**, **net weight**, pack type, units per carton, barcode if present, and shelf life — fields exist for all of these; the values come from MJ.

- `product_group.default_cycle_days` seeds the repeat-cycle engine (doc 02) — e.g., Color 21, Developer 21, Shampoo 30, Treatment 30, Styling 45.
- `product.brand_label` is Kiran's public name; the supplier never appears (doc 07).
- SKUs carry a barcode if the pack has one; the rep app can scan to add lines and to count stock.

## 2. Stock locations

| Location kind | Examples | Notes |
|---|---|---|
| `warehouse` | Main store/office | Receives from vault goods receipts; issues to reps |
| `rep_bag` | One per rep | Virtual location; `bag_value_limit` caps what can be issued (probation lower) |
| `quarantine` | Returns awaiting inspection | Entered by return requests; leaves by acceptance (→ warehouse) or write-off |
| `damaged` | Damaged/expired | Only via approved write-off movements |

Stock on hand anywhere = Σ `stock_movement` for that location and SKU. Nothing is stored as an editable quantity.

## 3. Movements and who can make them

| Movement | From → To | Who initiates | Second party / evidence |
|---|---|---|---|
| `receipt` | (vault) → warehouse | Vault grantee posting a goods receipt | Vault record; "labels removed" confirmation |
| `issue_to_rep` | warehouse → rep_bag | Manager/owner | Rep confirms count in-app |
| `sale` | rep_bag or warehouse → (salon) | Delivery by rep | Salon acknowledgment (OTP/signature), invoice |
| `return_in` | (salon) → quarantine | Rep requests with photo | Manager accepts at warehouse (CTL-12) |
| `return_to_warehouse` | rep_bag → warehouse | Manager/owner | Rep confirms |
| `transfer` | warehouse ↔ warehouse (later, multi-site) | Manager/owner | Receiving side confirms |
| `write_off` | any → damaged | Request with photo + reason | Approval; owner above threshold (CTL-06) |
| `adjustment` | ± at a location | Never from a rep; from a count variance | Approval; owner above threshold; always in digest |

All movements are append-only (doc 04). "Negative stock" at any location is a hard integrity error that the nightly job and the sync path both refuse.

## 4. Counting rhythm

| Count | Who | When | Tolerance |
|---|---|---|---|
| Rep bag **daily close** | Rep (expected vs counted), manager sees result | Every evening with handover | 0 units; variance → reason + case |
| Rep bag **spot check** | Manager, unannounced | ≥ 1 per rep per week; the system picks the day | 0 units |
| Warehouse **cycle count** | Manager | Weekly, rotating product groups | 0 units; variance → adjustment via approval |
| Full **stock-take** | Owner + manager together | Monthly, and at every manager/owner handover of duty | 0 units |

Counts are recorded in-app (`stock_count`) with the lines expected vs counted; the system never lets a count silently "fix" the figure — the gap becomes an approval-gated adjustment and an entry in the owner's digest.

## 5. Batches and expiry

- Each goods receipt creates `batch` rows with Kiran's own batch code and the expiry date; supplier lot numbers stay in the vault.
- Issue to reps follows **FEFO** (first-expiry-first-out) suggestions.
- Expiry alerts: 90 / 60 / 30 days; "sell-down" flags on reps' routes for salons that use that product.
- Expired stock → write-off path with photo; never sold.

## 6. Reorder logic

Phase 1: manual reorder points per SKU set by the owner from experience.
Phase 2: computed.

For each SKU:

```
avg_daily_demand   = units delivered in last 56 days ÷ 56   (seasonality-adjusted later)
demand_std         = std dev of weekly demand
lead_time_days     = from vault (supplier lead time) — exposed to public as a number only
safety_stock       = z × demand_std × sqrt(lead_time_days / 7)     (z = 1.65 for ~95% service level)
reorder_point      = avg_daily_demand × lead_time_days + safety_stock
target_stock       = reorder_point + avg_daily_demand × review_period_days (7)
suggested_order    = max(0, target_stock − on_hand_all_locations − on_order + committed_open_orders)
cover_days         = on_hand_all_locations ÷ avg_daily_demand
```

- A **weekly restock suggestion** (Saturday night) lists SKUs below reorder point with suggested quantities, cover days, open salon orders waiting, and expiring batches — in **units**, no cost (INV-07). The vault UI turns the suggestion into a purchase order with costs and the supplier (doc 07).
- New SKUs with no history use the product group's demand per active salon × active salons as a proxy.
- Seasonality: bridal season (Nov–Feb, plus Eid periods) lifts color/treatment demand; the model keeps a per-month index after the first year of data.

### Worked example (dummy product)

"[Dummy] Permanent Color, shade B, 100 ml": delivered 168 units in the last 56 days → 3.0/day. Weekly demand std 6. Lead time 10 days.
Safety stock = 1.65 × 6 × √(10/7) ≈ 11.8 → 12. Reorder point = 3.0 × 10 + 12 = **42**. Target = 42 + 21 = 63.
On hand: warehouse 20 + rep bags 14 = 34; on order 0; committed in undelivered orders 6 → suggested order = 63 − 34 − 0 + 6 = **35 units**. Cover = 34 ÷ 3 ≈ 11 days.

## 7. Restock cycle (end to end)

1. Saturday: restock suggestion generated → owner/manager review (public screen, units).
2. Vault: grantee drafts the PO with costs and the supplier; owner approves POs above a threshold (maker ≠ checker).
3. PO sent to the supplier by the grantee outside the system or via vault-held contact details.
4. Goods arrive → received by a grantee only; labels removed; `goods_receipt` posted → public `receipt` movements and batches appear.
5. Warehouse count confirms received quantities (variance → vault-side claim with the supplier).
6. Monday: reps' bag issues reflect the new stock; routes flag salons that were waiting.

## 8. Reports

- Stock on hand by location × SKU, with cover days and expiry status.
- Sell-through by SKU, product group, territory, salon type (units).
- Stock-out lines (order lines not deliverable), fill rate.
- Variance log: counts vs expected by rep and by warehouse, trend.
- Slow movers (cover > 90 days) and dead stock.
- Stock valuation at cost — **vault-gated** (INV-10).

## 9. Controls summary (ties to doc 13)

- Append-only movements; derived balances; nightly integrity check.
- Two-party confirmation on every issue/return between manager and rep; salon acknowledgment on delivery.
- Bag value limits; daily close; random spot checks; monthly joint stock-take.
- Adjustments and write-offs only via approval, with photo and reason, always in the digest; owner above threshold.
- Returns through quarantine, accepted at the warehouse, never straight back into a rep's sellable bag.
- No cost or supplier data on any public inventory screen.
