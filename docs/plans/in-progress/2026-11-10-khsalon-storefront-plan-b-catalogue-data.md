# khsalon.com storefront, plan B (P1-33): public catalogue data

**Status:** IN PROGRESS, step level expanded 2026-11-11 on `claude/p1-33-catalogue` from `main` at `727ebb3`. Plan A is merged (pull request 105). D-52 is in `docs/12`. Read `2026-11-10-khsalon-storefront-overview.md` first. Status lives only on the board (`docs/ACTIVITY.md` section 12, row P1-33).

**Goal:** the office can give every category, product and SKU its public fields, and a visitor can read published rows and nothing else.

**What exists (reuse, do not rebuild):** `public.product_group`, `public.product` (brand_label, name, description, image_path), `public.sku` (code, variant, unit, size, `list_price_paisa` which is the default price, with its history in `sku_price_change`), `public.salon_sku_price` (a price set for one salon), `app.office_upsert_product_group`, `app.office_upsert_product`, `app.office_upsert_sku`, `app.office_set_sku_price`, the private bucket `product-images`. No table or function is granted to `anon` today.

**New tables (all in `public`, RLS enabled and forced, deny by default)**

| Table | Key | Columns |
|---|---|---|
| `storefront_category` | `product_group_id` (PK, FK) | `slug`, `meta_title`, `meta_description`, `body`, `published`, `published_at`, audit columns |
| `storefront_product` | `product_id` (PK, FK) | `slug`, `meta_title`, `meta_description`, `body`, `how_to_use`, `image_path`, `published`, `published_at`, audit columns |
| `storefront_sku` | `sku_id` (PK, FK) | `published`, audit columns |

No price column is added. The public price is the existing `sku.list_price_paisa` (D-58), set through the existing `app.office_set_sku_price` and recorded in the existing `sku_price_change`.

Constraints
- `slug` matches `^[a-z0-9]+(-[a-z0-9]+)*$`, 3 to 80 characters, unique per table, and cannot change once `published_at` is set (a published URL never moves).
- `meta_title` 10 to 60 characters; `meta_description` 50 to 160; both unique per table so no two pages share them.
- A product cannot be published unless it is active, has a picture, has its meta fields and has at least one published SKU with a default price. A SKU cannot be published without a default price. Enforced in the functions.

**IDs:** the existing uuid of the group, product and SKU is the ID of record and is what the pages and Shopify carry. The SKU `code` is the human-readable ID and becomes the Shopify SKU.

**Write functions** (`app` schema, `security definer`, `set search_path = ''`, idempotent on `p_client_id`, owner or manager at AAL2, audited by the existing trigger)
- `app.office_upsert_storefront_category`
- `app.office_upsert_storefront_product`
- `app.office_set_storefront_published` (category, product or SKU; runs the publish checks)

**Read functions for visitors** (granted to `anon` and `authenticated`, `stable`, return fixed column lists)
- `app.storefront_catalogue()`: published categories with their published products: ids, slugs, names, brand, meta fields, picture path, lowest default price.
- `app.storefront_product(p_slug)`: one published product with its published SKUs: ids, code, variant, size, default price, and `available` as true or false only.

No policy grants `anon` a SELECT on any table. The functions read `sku.list_price_paisa` and never `salon_sku_price`. `available` is a yes or no computed inside the function; no quantity leaves the database.

**Pictures:** a new public-read bucket `storefront-images`; only owner and manager may write. The private bucket is not opened.

**Office screen:** an "Online shop" panel on the existing product page in `/office/products`: slug, meta title and description with live character counts, page text, the default price per SKU shown read-only with a link to where it is set, a publish switch and the reason it is refused when checks fail.

**Tests (negative first)**
- Role by table by operation rows for the three new tables: anon, rep, salon, manager without AAL2, manager, owner.
- Anon cannot select from `sku`, `salon_sku_price`, `sku_price_change`, any stock table, or the three new tables directly.
- A test reads the result columns of the two read functions and fails if any column name contains `salon`, `cost`, `margin`, `supplier`, `qty` or `stock`.
- With a seeded salon price that differs from the default, both read functions return the default price, called as a visitor and called as that salon.
- Unpublished product returns nothing by slug. Replay of the same `client_id` writes once. Slug change after publish is refused. Publish without a default price is refused.

Done when: migration, functions, office panel and tests are merged green, with the security checklist in the log entry. Applying the migration to the hosted project waits for MJ (H-19).

## Step level (2026-11-11)

Migration `supabase/migrations/20261111010000_storefront_catalogue.sql`. No price column. The public price is `sku.list_price_paisa`.

Tables, all in `public`, RLS enabled and forced, no policy, privileges revoked from `anon`, `authenticated` and `service_role`. Audit trigger `control.audit_row` on each. Deletes refused.

- `storefront_category` (`product_group_id` primary key). `slug`, `meta_title`, `meta_description`, `body`, `published`, `published_at`, `created_by`, `created_at`, `updated_at`.
- `storefront_product` (`product_id` primary key). Same text fields plus `how_to_use` and `image_path`.
- `storefront_sku` (`sku_id` primary key). `published` and the audit columns.
- `storefront_write` (`client_id` primary key). Append-only record of each write: `kind`, `subject_id`, `payload_hash`, `actor_id`, `created_at`. This is how a replay of `p_client_id` writes once (H-08).

Checks: slug `^[a-z0-9]+(-[a-z0-9]+)*$`, length 3 to 80, unique per table. `meta_title` 10 to 60, `meta_description` 50 to 160, each unique per table. `body` at most 4000 characters, `how_to_use` at most 2000 (the task-level plan did not name a cap). `image_path` null or `storefront/{product id}/{uuid}.png|jpg|jpeg|webp`. A slug cannot change once `published_at` is set. `published_at` is stamped on first publish and never cleared.

Functions, `security definer`, `set search_path = ''`, owner or manager at AAL2 via `app.assert_office()`:

- `app.office_upsert_storefront_category(p_client_id uuid, p_product_group_id uuid, p_slug text, p_meta_title text, p_meta_description text, p_body text) returns public.storefront_category`
- `app.office_upsert_storefront_product(p_client_id uuid, p_product_id uuid, p_slug text, p_meta_title text, p_meta_description text, p_body text, p_how_to_use text, p_image_path text) returns public.storefront_product`
- `app.office_set_storefront_published(p_client_id uuid, p_kind text, p_subject_id uuid, p_published boolean) returns table (kind text, subject_id uuid, published boolean)`
- `app.office_storefront_sheet() returns table (...)` so the office panel can read what it wrote. The task-level plan named no office read. Direct table reads stay denied, so the panel needs this function. It is office-only.

Publish rules inside `office_set_storefront_published`: a SKU needs an active product and its own default price. A product needs to be active, to have `image_path`, and to have at least one published SKU with a default price. A category needs an active product group and a saved row. Unpublishing the only published SKU of a published product is refused. A catalogue listing includes a product only when its category is published. A product slug still resolves when the product itself is published.

Visitor reads, granted to `anon` and `authenticated`. This is the one exception to the hygiene rule that anon executes nothing, and the test names these two functions:

- `app.storefront_catalogue()` columns: `category_id`, `category_slug`, `category_name`, `category_meta_title`, `category_meta_description`, `product_id`, `product_slug`, `product_name`, `brand_label`, `meta_title`, `meta_description`, `image_path`, `lowest_default_price_paisa`.
- `app.storefront_product(p_slug text)` columns: `product_id`, `slug`, `name`, `brand_label`, `meta_title`, `meta_description`, `body`, `how_to_use`, `image_path`, `sku_id`, `code`, `variant`, `unit`, `size_value`, `default_price_paisa`, `available`.

`available` is true only when some active warehouse has on-hand minus pending issues above zero. The number stays inside the function. Neither function reads a per-salon price. An unpublished or unknown slug returns no row.

Bucket `storefront-images`, public read, created only where `storage.buckets` exists. Writes require `app.is_office()` and the same object-name shape. The private `product-images` bucket is unchanged.

Office panel: `apps/web/app/office/(shell)/products/online-shop.tsx`, rendered on each product in `products/page.tsx`. Slug, meta title, meta description with character counts, page text, how to use, picture upload, publish and unpublish, and each SKU's default price read-only with a link to `#price-{sku id}`.

Tests: `supabase/tests/storefront-catalogue.test.ts`, plus new rows in `rls-matrix.test.ts`, plus the anon-execute exception in `schema-hygiene.test.ts`.

Not in this migration: Plan C seed, pages, tracking, Shopify, reminders. Two rows are both numbered D-51. This plan means the public-shop row dated 2026-11-10. They are not renumbered here.

## Changes on 2026-11-14 (another agent finished the stale branch)

These replace the matching sentences of the step level above. The reasons and the evidence are in the log entry `2026-11-11-grok-p1-33-catalogue` (its addendum) and in `2026-11-14-claude-p1-33-catalogue-assumption`.

- A product page is public only while its category page is published and its category is active, the same gate the catalogue listing has. The step level above said a product address still resolves when the category is unpublished; it no longer does (assumption A-24, the more restrictive reading).
- Bucket `storefront-images`: a picture is served by its public URL. No storage policy names anon, so a visitor cannot list the bucket. The office (owner or manager at AAL2) lists and uploads under the name shape. There is no update policy. The office deletes only a picture that no published product page shows (`app.storefront_image_published`).
- The page tables refuse TRUNCATE as well as DELETE.
- A repeated address, meta title or meta description is refused with plain words (`app.storefront_duplicate`).
- Office panel: the category page form is shown once per category, in an "Online shop categories" section above the products, and no longer inside every product card. The shop details load on their own: if that read fails, only the Online shop panels say so, and the rest of the Products page works.
- Tests: the catalogue test file also covers the audit rows and chain, the write log as every role, publish replay, the office sheet, and the storage block run against a stand-in storage schema. `apps/web/e2e-stack/office.spec.ts` has one journey for the panel, which runs only in CI (this host has no Docker).
- Waiting on MJ: blocker B-62 (anon holds USAGE on schema `app`).
