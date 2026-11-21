-- =============================================================================
-- INV-12 (pulled into the current work by MJ, 2026-11-20, ruling 3): the salon
-- portal sees availability only, never a unit count.
--
-- app.salon_catalogue gains one column, in_stock (boolean): true while at least
-- one active warehouse holds on-hand units of the SKU, false otherwise. The
-- salon page labels it "In stock" or "Not available" and stops adding an
-- unavailable product to the basket. No quantity, location or movement is
-- returned; the office keeps the real numbers (app.warehouse_availability).
--
-- On-hand is derived, never stored (H-10): app.on_hand sums the append-only
-- stock_movement rows for the warehouse, the same arithmetic the office
-- availability read uses. Availability changes only when stock moves, and stock
-- moves only through the existing paths (a goods receipt in, a delivered order
-- out). A salon request still reserves nothing.
--
-- The return type changes, so the function is dropped and recreated; the drop
-- removes its execute grant, and the grant is restated below exactly as
-- migration 20261105150000 left it (authenticated only). Every column the salon
-- page already reads keeps its name, order and type; in_stock is appended last.
--
-- Forward-only. No table, column, policy or index changes; one function.
-- =============================================================================

drop function app.salon_catalogue();

create function app.salon_catalogue()
returns table (product_id uuid, brand_label text, product_name text, description text, image_path text,
               group_name text, sku_id uuid, code text, variant text, unit text, size_value numeric,
               price_paisa bigint, own_price boolean, in_stock boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_salon uuid := app.assert_salon_member();
begin
  return query
  select p.id, p.brand_label, p.name, p.description, p.image_path, g.name, k.id, k.code, k.variant, k.unit, k.size_value,
         coalesce(x.price, k.list_price_paisa), x.price is not null,
         exists (select 1 from public.stock_location l
                 where l.kind = 'warehouse' and l.active
                   and app.on_hand(l.id, k.id) > 0)
  from public.sku k
  join public.product p on p.id = k.product_id
  join public.product_group g on g.id = p.product_group_id
  cross join lateral (select app.salon_price(v_salon, k.id) as price) x
  where k.active and p.active and k.list_price_paisa is not null
  order by p.name, k.code, k.id
  limit 1000;
end $$;

revoke all on function app.salon_catalogue() from public, anon, authenticated, service_role;
grant execute on function app.salon_catalogue() to authenticated;

comment on function app.salon_catalogue() is
  'INV-12 (MJ ruling 3, 2026-11-20). The salon catalogue with its own price, else the list price, and availability only: in_stock is true while an active warehouse has on-hand units; no quantity, location or movement is returned.';
