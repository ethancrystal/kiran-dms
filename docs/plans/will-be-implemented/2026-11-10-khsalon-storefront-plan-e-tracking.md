# khsalon.com storefront, plan E (P1-36): meaningful tracking

**Status:** DRAFT FOR MJ REVIEW, task level. Nothing here has been built or run. Read `2026-11-10-khsalon-storefront-overview.md` first: it holds MJ's decisions, the open questions and the build order. The prompt for the executor is in `2026-11-10-khsalon-storefront-agent-prompts.md`. Status lives only on the board (`docs/ACTIVITY.md` section 12, row P1-36).

**Goal:** every interaction on the shop is recorded with a name and a plain-language meaning, tied to the product, category and SKU IDs, in a form a person or an AI can read directly.

**The idea:** nothing is tracked by position or CSS selector. Every interactive element is given a registered element ID in code, and every event type is a row in a registry with a sentence that says what it means. A recorded event is then already a readable statement: "Visitor selected shade 7/77 of Musk Hair Colour on the product page."

**Tables** (RLS enabled and forced; office read only; no role may update or delete)

| Table | Columns |
|---|---|
| `storefront_event_type` | `key` (PK, for example `product.add_to_cart`), `meaning` (one sentence), `funnel_step` (null or 1 to 5), `active` |
| `storefront_event` (append-only) | `id`, `event_key` (FK), `occurred_at` (server), `occurred_at_client`, `visitor_id`, `visit_id`, `page_type`, `path`, `product_group_id`, `product_id`, `sku_id`, `element_id`, `position`, `qty`, `value_paisa`, `props` jsonb (whitelisted keys, 2 KB cap), `referrer_host`, `utm_source`, `utm_medium`, `utm_campaign`, `device_class`, `is_bot`, `client_id` unique |
| `storefront_daily` | Totals per day, event, product and SKU, filled by a function; kept after raw events age out |

**Starting registry**

| Key | Meaning |
|---|---|
| `page.view` | Visitor opened a page |
| `page.scroll_depth` | Visitor scrolled past 25, 50, 75 or 100 percent of the page |
| `section.view` | A named section stayed on screen for at least one second (with seconds on screen) |
| `nav.click` | Visitor used a menu, breadcrumb or footer link |
| `category.view` | Visitor opened a category |
| `product.impression` | A product card was shown in a list (with its position) |
| `product.click` | Visitor opened a product from a list |
| `product.view` | Visitor opened a product page |
| `product.image_view` | Visitor opened or swiped a product picture |
| `product.variant_select` | Visitor chose a shade or size |
| `product.add_to_cart` | Visitor added a SKU to the cart |
| `cart.view` | Visitor opened the cart |
| `cart.quantity_change` | Visitor changed a quantity in the cart |
| `cart.remove` | Visitor removed a SKU from the cart |
| `checkout.start` | Visitor pressed checkout and was sent to Shopify |
| `checkout.completed` | Shopify confirmed a paid order (written by plan F) |
| `search.submit` | Visitor searched (term cut to 80 characters) |
| `salon.order_link_click` | A visitor pressed "Salon client? Order at your price" on a product |
| `trade.enquiry_start` / `trade.enquiry_submit` | A parlor began or sent the "Become a client salon" form |
| `outbound.click` | Visitor followed a link off the site (WhatsApp, maps, social) |

**In the app**
- `apps/web/lib/track/elements.ts`: the list of every element ID (for example `pdp.add_to_cart`, `home.hero.shop_now`) with the event it fires.
- A `<Track>` wrapper and a `useTrack()` hook; sections register with one `<Section id>` component that uses IntersectionObserver for views and time on screen.
- Events queue in memory and are sent in batches with `sendBeacon` to one route handler, `/api/t`, which rate-limits and calls `app.storefront_track(p_events jsonb)`.
- `app.storefront_track`: anon may call; rejects unknown keys and oversized `props`; caps a batch at 50; idempotent on each event's `client_id`; stamps server time.

**Privacy and safety**
- `visitor_id` and `visit_id` are random values in a first-party cookie (12 months and 30 minutes idle). No IP address, no full user agent, no name, phone, email or address is stored. Form field contents are never tracked.
- No outside analytics, pixel or session replay (H-21, D-56).
- Tracking stops at the shop. Nothing a signed-in salon does inside the portal is recorded by this plan.
- A short notice in the footer says what is recorded (B-58).

**Reading it (for a person and for an AI)**
- `/office/shop-insights`: funnel (view, add to cart, cart, checkout start, paid), top products and shades, where visitors stop scrolling on a product page, which buttons are pressed and which are ignored.
- `app.office_storefront_visit_story(p_visit_id)`: the visit as ordered plain sentences built from each event's `meaning` and the product names.
- Export from the office: JSON Lines for a date range, with the data dictionary (the registry) as the first record, so the file explains itself to whatever reads it.

**Tests**
- A Playwright test walks every shop page and fails if any `button`, `a` or form control lacks a registered `data-track` ID, or uses an ID missing from `elements.ts`. This is what keeps "every single button" true as the site grows.
- Anon cannot read any tracking table. Unknown key refused. Replay writes once. A batch of 51 refused. No column or `props` key holds an IP, email or phone.
- The journey test from plan D asserts the exact ordered event list it produced.

Done when: the checks pass in CI and the insights page shows the journey test's visit.
