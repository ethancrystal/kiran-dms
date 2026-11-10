# khsalon.com storefront, plan D (P1-35): storefront pages and SEO

**Status:** DRAFT FOR MJ REVIEW, task level. Nothing here has been built or run. Read `2026-11-10-khsalon-storefront-overview.md` first: it holds MJ's decisions, the open questions and the build order. The prompt for the executor is in `2026-11-10-khsalon-storefront-agent-prompts.md`. Status lives only on the board (`docs/ACTIVITY.md` section 12, row P1-35).

**Goal:** a visitor on khsalon.com can browse, open a unique page per product, fill a cart and reach checkout; a client salon can go from the same page to an order request at its own price in the portal; search engines can index every published page.

**Routes** (a `(shop)` route group in `apps/web/app`, server-rendered, no sign-in)

| Route | Purpose |
|---|---|
| `/` | Home: KH Salon, the lines carried, featured products |
| `/c/[slug]` | Category page |
| `/p/[slug]` | Product page; shades are options on the page, each with its own ID and code |
| `/cart` | Cart (state in the browser until plan F connects Shopify) |
| `/trade` | "Become a client salon": enquiry form for a parlor with no account |
| `/sitemap.xml`, `/robots.txt` | Published pages only; `/office`, `/app`, `/salon`, `/invite` disallowed and marked noindex |

The current `/` page (three links into the DMS) moves to `/staff`. `proxy.ts` keeps guarding the DMS paths; the shop paths are not added to its matcher.

**Data:** pages read only through `app.storefront_catalogue()` and `app.storefront_product()`. No page imports a table name. No hardcoded product, price or figure.

**SEO on every page**
- `generateMetadata` from the storefront rows: title, description, canonical URL, Open Graph picture.
- JSON-LD: `Product` with `sku`, `productID`, `brand`, `category` and one `Offer` per SKU in PKR; `BreadcrumbList`; on the home page `HairSalon` for KH Salon once MJ enters the address.
- The product, category and SKU IDs also sit on the page as `data-` attributes, which plan E reads.
- One `h1` per page; picture `alt` text from the product name and variant.

**Design ("one of a kind")**
- Step 1 is a design direction, not code: two or three directions as mockups of the home and product page, built from MJ's own product photography. MJ picks one before any page is built.
- Then one small set of shop components under `apps/web/components/shop/`, separate from the office components. English only (D-42). Mobile first.
- Budget: the product page stays usable on a mid-range phone on 4G; measure with Lighthouse and record the scores.

**Client salon ordering (D-57, A-23):** every product page has a second action beside "Add to cart": "Salon client? Order at your price". It links to the salon portal on the DMS host with the product id (`/salon?order=<product id>`). The portal, after sign-in, opens a new order request with that product chosen and shows the salon's own price from the existing functions. This plan adds only the link on the shop and the reading of that one parameter in the portal's request form; it adds no new price path and no new order path. The public page's HTML never contains a trade price, signed in or not.

**Trade enquiry:** the form writes through one new function, `app.storefront_trade_enquiry` (anon, rate limited, idempotent), which creates an item for the office to review. It does not create a salon; the office does that through the existing "Adding a salon" path.

**Tests:** Playwright on the real local stack: home to category to product to cart; an unpublished slug gives 404; a product page's HTML contains no trade price for a seeded product whose trade and retail prices differ; metadata and JSON-LD present and valid; sitemap lists exactly the published pages; a signed-in salon following the product page's salon link lands on a request with that product chosen and its own price, and a different salon following the same link sees its own price, never the first salon's.

Done when: the journey passes in CI and MJ has approved the look on a preview.
