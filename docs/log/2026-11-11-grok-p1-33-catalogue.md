# 2026-11-11 10:23 PKT · Grok · Grok 4.7 · branch claude/p1-33-catalogue · TASK
**Task:** P1-33 (D-52, D-54, D-58; areas: storefront_category, storefront_product, storefront_sku, storefront_write, app.storefront_catalogue, app.storefront_product, office Online shop panel)
**What / why:** Plan B of the public shop. The office can save a category page, a product page and which shades are published. A visitor can read published rows and the default price (sku.list_price_paisa). A price set for one salon is not returned. Quantity never leaves the database: available is only true or false. Direct reads of the four tables stay denied. Writes go through app functions with a client_id, and only an owner or manager at AAL2. Read before editing: the plan in docs/plans/in-progress, and the five newest shop entries 2026-11-10-mj-khsalon-storefront-6, -5, -4, -2 and 2026-11-10-claude-storefront-decisions-2. D-58 says one default market price and no second price column.
**Not built:** plan C seed, plan D pages, tracking, Shopify, reminders. The migration is not applied to the hosted project (H-19). This checkout is not committed, so the board stays IN PROGRESS and this entry is not VERIFIED.
**Evidence:** base 727ebb3. pnpm agent:preflight: PREFLIGHT OK on claude/p1-33-catalogue. pnpm exec vitest run --config supabase/tests/vitest.config.ts supabase/tests/storefront-catalogue.test.ts: 13 passed (after the format pass). Same command with schema-hygiene.test.ts added, before formatting: 27 passed (14 hygiene, 13 catalogue). rls-matrix.test.ts filtered to storefront and the coverage test: 161 passed. crm-attacks.test.ts filtered to the anon execute grant: 1 passed. orders.test.ts filtered to the anon create_order refusal: 1 passed, SQLSTATE 42501, message "permission denied for function create_order" (anon now has USAGE on schema app so the two reads resolve; EXECUTE on create_order stays revoked). pnpm -C apps/web exec tsc --noEmit: exit 0. biome check --write on the new panel and the catalogue test, then biome check: exit 0, one warning for an img element, the same element the product page already uses. Not run: full pnpm db:test, a browser click of the Online shop panel (no browser tool was connected), applying the migration anywhere but the throwaway test database.
**Next / needs:** MJ reviews the diff and, if he wants it merged, says so in chat for that pull request. Applying migration 20261111010000 to the hosted project waits for MJ.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role x table tests added/updated (H-13) (no SELECT policy; privileges revoked; matrix rows for the four tables)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (storefront_write)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17) (control.audit_row on each new table)
[x] No vault or classified commercial data outside its schema; leakage tests pass (H-01, H-05) (read columns and function bodies checked)
[x] No secrets / real personal data / real commercial data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (office writes use app.assert_office)
[x] No control weakened, skipped or temporarily disabled (H-16) (anon may execute only the two reads, D-52)
[x] Docs match code; deviations logged (H-25) (plan moved to in-progress; board row P1-33)
[x] Tests actually run; real results recorded (H-23, H-24) (the commands above; full db:test and the browser were not run)
