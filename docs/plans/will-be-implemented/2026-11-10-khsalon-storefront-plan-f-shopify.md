# khsalon.com storefront, plan F (P1-37): Shopify link

**Status:** DRAFT FOR MJ REVIEW, task level. Nothing here has been built or run. Read `2026-11-10-khsalon-storefront-overview.md` first: it holds MJ's decisions, the open questions and the build order. The prompt for the executor is in `2026-11-10-khsalon-storefront-agent-prompts.md`. Status lives only on the board (`docs/ACTIVITY.md` section 12, row P1-37).

**Goal:** published products appear in Shopify with our IDs and meta fields; the cart checks out on Shopify; a paid order returns to the office review queue; the visit that led to it is known.

**Before any code:** read Shopify's current developer documentation for product sync, the Storefront cart, webhooks and API versions. Do not rely on remembered API shapes. Wait for B-56 and B-57.

**Where secrets live:** check H-18 first. The web deployment was cleaned of server secrets on 10 Nov 2026. The Shopify admin token and webhook secret go where H-18 allows a server secret (expected: a Supabase Edge Function's secrets), set by MJ. They are never in git, in the browser bundle or in a log.

**Parts**

1. **Adapter.** One module is the only code that talks to Shopify (H-21).
2. **Link table** `shopify_link`: `entity_kind` (category, product, sku), `entity_id`, `shopify_id`, `synced_hash`, `synced_at`. Office read only.
3. **Catalogue out.** A sync queue table filled by triggers when a published storefront row or a default price changes. A worker pushes each change: product title, description, SEO title and description, variants with SKU code and default price, pictures, a collection per category, and metafields `kh.product_id`, `kh.category_id`, `kh.sku_id`. Unpublish in the DMS means unpublish in Shopify. An edit made in Shopify admin is overwritten on the next sync; the runbook says so.
4. **Availability out.** Only in stock yes or no per SKU. No quantity.
5. **Cart and checkout.** The shop's cart creates a Shopify cart and sends the visitor to Shopify's checkout URL. The cart carries `visit_id` and `visitor_id` as attributes.
6. **Order in.** A webhook receiver for paid orders: verifies the signature, is idempotent on the Shopify order ID, writes `checkout.completed` with the visit and the SKUs, and creates one request in the existing office review queue against the online-shop account (B-56), marked Regular User (D-59). The manager or owner turns it into an official order and releases the goods through the existing path. When it is dispatched with a rider, the manager or owner marks it delivered (D-61): one new office function, for Regular User orders only, that records who marked it, when and which rider, finalises the stock movement and completes the order without a signature. It refuses any Client Salon order. A wrong mark is reversed by a reversing record. The buyer's name, phone and address stay in Shopify.
7. **Queue kinds (D-59).** The review queue shows each item's kind, Regular User or Client Salon, and can be filtered by it. Client Salon items are the existing salon and rep requests, unchanged.
8. **Reconciliation.** An office list of Shopify paid orders against DMS requests, so a missed webhook is visible within a day.

**Tests:** adapter behind an interface with a fake in CI; signature check refuses a tampered body; replay of the same order creates one request, marked Regular User; a rep and a salon cannot see a Regular User item; the mark-delivered function completes a Regular User order with no signature, is refused for a Client Salon order, for a rep, for a salon and for a manager without MFA, and a replay writes once; a price set for one salon never appears in any payload sent to Shopify (assert on the fake's recorded calls); unpublish propagates.

Done when: the fake-backed suite is green, and one real order has been placed end to end on a Shopify test store by MJ, with the evidence in the log.
