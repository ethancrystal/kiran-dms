-- Slice 8 (P1-25): the office's approvals queue needs to read control.approval_request, and the browser
-- cannot: the control schema is not exposed through the Data API (B-18). One read function, nothing
-- else. Writes stay app.request_approval, app.decide_approval, app.recheck_order and
-- app.office_post_adjustment, unchanged.
--
-- app.office_pending_approvals(): owner or manager at AAL2 (app.assert_office). Returns, newest first,
-- at most 200 rows:
--   * every pending request of kind discount or adjustment (the two kinds the Phase 1 code creates and
--     the office decides), and
--   * every approved adjustment request on a warehouse or rep bag that no stock movement has used yet,
--     so the Stock page can post it (app.office_post_adjustment); approved adjustments on a pending
--     delivery location are settled on Delivery approvals and are not listed here.
-- Allow-listed fields only, never the raw payload: for a discount the order's id, status, salon name,
-- subtotal, discount and total (from the order row, not the payload); for an adjustment the location's
-- name and kind, the SKU's code and the signed quantity. The maker's name, the required checker role,
-- the request reason (typed by the office or fixed by the order engine) and whether the caller made it
-- (maker = checker is refused by app.decide_approval, H-12; the flag only lets the page hide the buttons).

create function app.office_pending_approvals()
returns table (request_id uuid, kind public.approval_kind, status public.approval_status, subject_type text,
               subject_id uuid, made_by_me boolean, maker_name text, checker_role_required public.app_role,
               reason text, created_at timestamptz,
               order_status public.order_status, salon_id uuid, salon_name text,
               subtotal_paisa bigint, discount_paisa bigint, total_paisa bigint,
               location_name text, location_kind public.stock_location_kind, sku_id uuid, sku_code text,
               qty_delta bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
  select a.id, a.kind, a.status, a.subject_type, a.subject_id, a.maker_id = auth.uid(), mk.full_name,
         a.checker_role_required, a.reason, a.created_at,
         o.status, o.salon_id, s.name, o.subtotal_paisa, o.discount_paisa, o.total_paisa,
         l.name, l.kind, k.id, k.code,
         case when a.kind = 'adjustment' and jsonb_typeof(a.payload -> 'qty_delta') = 'number'
              then (a.payload ->> 'qty_delta')::numeric::bigint end
  from control.approval_request a
  join public.user_profile mk on mk.id = a.maker_id
  left join public.sales_order o on a.kind = 'discount' and a.subject_type = 'sales_order' and o.id = a.subject_id
  left join public.salon s on s.id = o.salon_id
  left join public.stock_location l on a.kind = 'adjustment' and a.subject_type = 'stock_location' and l.id = a.subject_id
  left join public.sku k on a.kind = 'adjustment' and coalesce(a.payload ->> 'sku_id', '') ~ '^[0-9a-fA-F-]{36}$'
                         and k.id = (a.payload ->> 'sku_id')::uuid
  where a.kind in ('discount', 'adjustment')
    and (a.status = 'pending'
         or (a.status = 'approved' and a.kind = 'adjustment' and l.kind in ('warehouse', 'rep_bag')
             and not exists (select 1 from public.stock_movement m where m.approval_id = a.id)))
  order by a.created_at desc, a.id
  limit 200;
end $$;

revoke all on function app.office_pending_approvals() from public, anon, authenticated, service_role;
grant execute on function app.office_pending_approvals() to authenticated;

comment on function app.office_pending_approvals() is
  'P1-25: the office approvals queue (pending discount and adjustment requests, and approved unused adjustments on a warehouse or bag). Owner or manager at AAL2. Allow-listed fields; never the raw payload.';
