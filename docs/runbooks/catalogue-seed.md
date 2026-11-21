# [Dummy] catalogue seed (P1-34, plan C)

Loads the products MJ showed on 2026-11-10 into a **local** database as a rerunnable seed: four
product groups, six products, nineteen SKUs (fourteen invented shades of the one colour product)
and one invented placeholder price per SKU. Every name, brand, shade and price is `[Dummy]`
(H-04, B-10, B-54, B-55). No real supplier, salon or price data is in the seed.

## Preconditions

- A local Postgres with every migration applied: the embedded test database, or `supabase start`
  (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`).
- One active owner in `public.user_profile`, or the apply run bootstraps `[Dummy] Catalogue Seed
  Owner` on a stack that has none. `--owner=<uuid>` makes it act as a named existing owner instead.
  A dry run on a stack with no owner stops and asks for one apply run first: a dry run writes nothing,
  not even that setup row.

## Run

PowerShell:

```powershell
$env:KIRAN_STACK_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
node scripts/dummy-catalogue-seed.mjs --dry-run   # list what would change, write nothing
node scripts/dummy-catalogue-seed.mjs             # apply
```

The script refuses any host other than `127.0.0.1` or `localhost` before connecting (H-19), and
never reads `DATABASE_URL` or a service-role key. There is no option to point it at a hosted project.

## What it writes

- `app.office_upsert_product_group`, `app.office_upsert_product` and `app.office_upsert_sku`, with
  deterministic ids, so a second run updates the same rows. The plan-C SKU rule applies: codes are
  `DUMMY-MUSK-HC-100-01` to `-14` for the shades and `DUMMY-...` for the five single-variant items;
  the printed-style shade number stays out of the repository until MJ confirms it (B-55).
- `app.office_set_sku_price` once per SKU, at the single invented price 11111 paisa (Rs 111.11), with
  the reason `[Dummy] catalogue seed placeholder price (P1-34)`.

Nothing is published. Storefront rows, slugs, page copy and publishing belong to plans B and D; the
owner or manager publishes in `/office/products`.

## Idempotency and safety

A rerun reports every row as `unchanged`, adds no SKU and no price-history row, and leaves the row
counts identical. If a seeded SKU carries a price the seed did not write (for example a real price
MJ entered in the office), the seed **refuses and stops** instead of overwriting it (B-54).

## Test

```bash
pnpm exec vitest run --config supabase/tests/vitest.config.ts supabase/tests/catalogue-seed.test.ts --testTimeout=300000 --hookTimeout=300000
```

`supabase/tests/catalogue-seed.test.ts` runs the shared module in `scripts/lib/dummy-catalogue.mjs`
twice against the embedded database and proves the counts, the `[Dummy]` labels, the price rule and
the non-local refusal.
