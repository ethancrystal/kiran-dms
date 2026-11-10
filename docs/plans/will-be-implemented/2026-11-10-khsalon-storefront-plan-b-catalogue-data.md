# khsalon.com storefront, plan B (P1-33): public catalogue data

**Status:** DRAFT FOR MJ REVIEW, task level. Nothing here has been built or run. Read `2026-11-10-khsalon-storefront-overview.md` first: it holds MJ's decisions, the open questions and the build order. The prompt for the executor is in `2026-11-10-khsalon-storefront-agent-prompts.md`. Status lives only on the board (`docs/ACTIVITY.md` section 12, row P1-33).

**Goal:** the office can give every category, product and SKU its public fields, and a visitor can read published rows and nothing else.

**What exists (reuse, do not rebuild):** `public.product_group`, `public.product` (brand_label, name, description, image_path), `public.sku` (code, variant, unit, size, `list_price_paisa` which is the trade price), `app.office_upsert_product_group`, `app.office_upsert_product`, `app.office_upsert_sku`, `app.office_set_sku_price`, the private bucket `product-images`. No table or function is granted to `anon` today.

**New tables (all in `public`, RLS enabled and forced, deny by default)**

| Table | Key | Columns |
|---|---|---|
| `storefront_category` | `product_group_id` (PK, FK) | `slug`, `meta_title`, `meta_description`, `body`, `published`, `published_at`, audit columns |
| `storefront_product` | `product_id` (PK, FK) | `slug`, `meta_title`, `meta_description`, `body`, `how_to_use`, `image_path`, `published`, `published_at`, audit columns |
| `storefront_sku` | `sku_id` (PK, FK) | `retail_price_paisa`, `compare_at_paisa`, `published`, audit columns |
| `retail_price_change` | `id` | `sku_id`, `old_paisa`, `new_paisa`, `changed_by`, `changed_at`, `client_id` unique. Append-only: INSERT and SELECT only, trigger raises on UPDATE and DELETE |

Constraints
- `slug` matches `^[a-z0-9]+(-[a-z0-9]+)*$`, 3 to 80 characters, unique per table, and cannot change once `published_at` is set (a published URL never moves).
- `meta_title` 10 to 60 characters; `meta_description` 50 to 160; both unique per table so no two pages share them.
- `retail_price_paisa > 0`; `compare_at_paisa` null or greater than the retail price.
- A product cannot be published unless it is active, has a picture, has its meta fields and has at least one published SKU with a retail price. A SKU cannot be published without a retail price. Enforced in the functions.

**IDs:** the existing uuid of the group, product and SKU is the ID of record and is what the pages and Shopify carry. The SKU `code` is the human-readable ID and becomes the Shopify SKU.

**Write functions** (`app` schema, `security definer`, `set search_path = ''`, idempotent on `p_client_id`, owner or manager at AAL2, audited by the existing trigger)
- `app.office_upsert_storefront_category`
- `app.office_upsert_storefront_product`
- `app.office_set_retail_price` (writes `storefront_sku` and one `retail_price_change` row in one transaction)
- `app.office_set_storefront_published` (category, product or SKU; runs the publish checks)

**Read functions for visitors** (granted to `anon` and `authenticated`, `stable`, return fixed column lists)
- `app.storefront_catalogue()`: published categories with their published products: ids, slugs, names, brand, meta fields, picture path, lowest retail price.
- `app.storefront_product(p_slug)`: one published product with its published SKUs: ids, code, variant, size, retail price, compare-at price, and `available` as true or false only.

No policy grants `anon` a SELECT on any table. `available` is a yes or no computed inside the function; no quantity leaves the database.

**Pictures:** a new public-read bucket `storefront-images`; only owner and manager may write. The private bucket is not opened.

**Office screen:** an "Online shop" panel on the existing product page in `/office/products`: slug, meta title and description with live character counts, page text, retail price per SKU, a publish switch and the reason it is refused when checks fail.

**Tests (negative first)**
- Role by table by operation rows for the four new tables: anon, rep, salon, manager without AAL2, manager, owner.
- Anon cannot select from `sku`, `salon_sku_price`, `sku_price_change`, any stock table, or the four new tables directly.
- A test reads the result columns of the two read functions and fails if any column name contains `list_price`, `cost`, `margin`, `supplier`, `qty` or `stock`.
- Unpublished product returns nothing by slug. Replay of the same `client_id` writes once. Slug change after publish is refused. Publish without a retail price is refused.
- `retail_price_change` refuses UPDATE and DELETE for every role.

Done when: migration, functions, office panel and tests are merged green, with the security checklist in the log entry. Applying the migration to the hosted project waits for MJ (H-19).
