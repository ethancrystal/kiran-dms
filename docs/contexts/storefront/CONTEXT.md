# Storefront — module document (context `storefront`, planned)

Derived reference written by the 2026-11-19 documentation audit; it never overrides the planning set or `docs/ACTIVITY.md`. MJ's 2026-11-19 brief names seven modules; the storefront is the eighth, planned context of CONTEXT-MAP.md, so this file records only its boundary and status and points to its plans. No storefront requirement has a doc 03 ID: its scope is decisions D-51 (2026-11-10) to D-61 and board rows P1-32 to P1-37.

## Purpose and boundaries

The public shop at khsalon.com: published categories, products and SKUs with a default price, visitor reads, tracking, the Shopify copy of the catalogue and a direct buyer's paid order on its way into the office review queue. It reads the catalogue from inventory and hands orders to orders-delivery; it owns no stock, no price and no order (CONTEXT-MAP.md).

## Owned entities

`storefront_category`, `storefront_product`, `storefront_sku`, `storefront_write` (migration `20261111010000_storefront_catalogue.sql`, merged in PR 109).

## Status and evidence

| Board task | Scope | Status |
|---|---|---|
| P1-32 | Plan A, decisions (docs) | docs merged in PR 105 |
| P1-33 | Plan B, catalogue data, office panel, two anonymous reads | merged in PR 109 at `d4b47ca`; not verified; B-62 decided (move the reads out of `app`, PR 115, not merged; docs not amended) |
| P1-34 to P1-37 | Seed, pages, tracking, Shopify | NOT STARTED (B-54 to B-59 pending; B-60 RESOLVED by D-61) |

Plans: [overview](../../plans/will-be-implemented/2026-11-10-khsalon-storefront-overview.md), [plan B](../../plans/in-progress/2026-11-10-khsalon-storefront-plan-b-catalogue-data.md). MJ, 2026-11-19: shop data is dummy for now.
