-- INV-03 gap (office stock receipt) and INV-07 (weekly restock suggestion, as an estimate).
--
-- 1. app.office_receive_stock: before this migration nothing in the app could put stock
--    into a warehouse. The 'receipt' movement kind existed (doc 04) but only seeds and
--    psql ever wrote one, so the office had no goods-in path at all. The office (owner or
--    manager at AAL2) now records a receipt batch: one client id for the whole batch, each
--    movement row keeping its own generated client_id, and the batch id stored in
--    source_type = 'stock_receipt' / source_id. A partial unique index makes the batch id
--    single-use, so a replayed or concurrent call cannot double-receive (H-08): the second
--    call hits the index and is reported as a replay, changing nothing.
--
-- 2. app.office_restock_suggestions: the weekly restock suggestion of doc 03 (INV-07),
--    derived only from recorded history: outward units leaving warehouses
--    (sale, sale_to_agent, issue_to_rep), open confirmed demand
--    (sales_order_line minus delivered), and the manual reorder point (INV-06).
--    The suggested quantity is an ESTIMATE for the office to judge, never a purchase
--    order and never stored; the cover-days target is a parameter (assumption A-26,
--    [default-unconfirmed] until MJ confirms).
--
-- Forward-only. No table, column or policy changes; one partial index; two functions.

-- One receipt batch per client id, for replay safety (H-08).
create unique index stock_movement_one_batch_per_receipt
  on public.stock_movement (source_id) where source_type = 'stock_receipt';

create function app.office_receive_stock(
  p_client_id uuid, p_location_id uuid, p_lines jsonb, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role  public.app_role := app.assert_office();
  v_loc   public.stock_location;
  v_line  record;
  v_units bigint := 0;
  v_lines integer := 0;
begin
  if p_client_id is null then
    perform app.raise_denied('a client id is required for a receipt batch');
  end if;
  if p_reason is null or length(btrim(p_reason)) < 4 or length(p_reason) > 300 then
    perform app.raise_denied('a receipt needs a reason of 4 to 300 characters');
  end if;
  select * into v_loc from public.stock_location where id = p_location_id;
  if v_loc.id is null or not v_loc.active or v_loc.kind <> 'warehouse' then
    perform app.raise_denied('stock is received into an active warehouse');
  end if;
  if exists (select 1 from public.stock_movement m
             where m.source_type = 'stock_receipt' and m.source_id = p_client_id) then
    return jsonb_build_object('replay', true, 'client_id', p_client_id);
  end if;
  for v_line in select sku_id, qty from app.parse_lines(p_lines, false) loop
    insert into public.stock_movement
      (client_id, sku_id, qty, to_location_id, kind, source_type, source_id, reason, actor_id)
    values
      (gen_random_uuid(), v_line.sku_id, v_line.qty, p_location_id, 'receipt',
       'stock_receipt', p_client_id, p_reason, auth.uid());
    v_units := v_units + v_line.qty;
    v_lines := v_lines + 1;
  end loop;
  perform app.set_purpose('office stock receipt ' || p_client_id::text);
  return jsonb_build_object('replay', false, 'lines', v_lines, 'units', v_units);
exception
  when unique_violation then
    -- A replayed or concurrent call recorded this batch first (H-08): report, change nothing.
    return jsonb_build_object('replay', true, 'client_id', p_client_id);
end $$;

create function app.office_restock_suggestions(
  p_cover_days integer default 14, p_history_days integer default 28)
returns table (sku_id uuid, code text, on_hand bigint, weekly_avg numeric, open_demand bigint,
               reorder_point integer, suggested_qty bigint, reasoning text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  if p_cover_days is null or p_cover_days < 1 or p_cover_days > 180
     or p_history_days is null or p_history_days < 7 or p_history_days > 365 then
    perform app.raise_denied('cover days must be 1 to 180 and history days 7 to 365');
  end if;
  return query
  with wh as (
    select l.id from public.stock_location l where l.kind = 'warehouse' and l.active
  ),
  outward as (
    select m.sku_id, sum(m.qty)::numeric as n
    from public.stock_movement m
    join wh on wh.id = m.from_location_id
    where m.kind in ('sale', 'sale_to_agent', 'issue_to_rep')
      and m.created_at > now() - make_interval(days => p_history_days)
    group by m.sku_id
  ),
  open_demand as (
    select sol.sku_id,
           sum(sol.qty - coalesce(d.delivered, 0))::bigint as n
    from public.sales_order so
    join public.sales_order_line sol on sol.order_id = so.id
    left join (select order_line_id, sum(qty) as delivered
               from public.delivery_line group by order_line_id) d
      on d.order_line_id = sol.id
    where so.status in ('confirmed', 'partially_delivered')
    group by sol.sku_id
  ),
  rule as (
    select r.sku_id, r.reorder_point from public.reorder_rule r
  ),
  candidate as (
    select s.id as sku_id from public.sku s
    where s.active
      and (exists (select 1 from rule where rule.sku_id = s.id)
        or exists (select 1 from outward where outward.sku_id = s.id)
        or exists (select 1 from open_demand where open_demand.sku_id = s.id))
  ),
  avail as (
    select c.sku_id,
           greatest(0, sum(app.on_hand(w.id, c.sku_id) - app.pending_out(w.id, c.sku_id)))::bigint as n
    from candidate c cross join wh w
    group by c.sku_id
  )
  select c.sku_id,
         s.code,
         coalesce(av.n, 0),
         round(coalesce(o.n, 0) * 7.0 / p_history_days, 2),
         coalesce(od.n, 0),
         coalesce(r.reorder_point, 0),
         greatest(0, ceil(coalesce(o.n, 0) * p_cover_days / p_history_days)
                     + coalesce(od.n, 0) + coalesce(r.reorder_point, 0)
                     - coalesce(av.n, 0))::bigint,
         format('estimate: on hand %s; outward %s/wk over %s days; open orders %s; reorder point %s; covers %s days — judge before purchasing',
                coalesce(av.n, 0), round(coalesce(o.n, 0) * 7.0 / p_history_days, 2), p_history_days,
                coalesce(od.n, 0), coalesce(r.reorder_point, 0), p_cover_days)
  from candidate c
  join public.sku s on s.id = c.sku_id
  left join avail av on av.sku_id = c.sku_id
  left join outward o on o.sku_id = c.sku_id
  left join open_demand od on od.sku_id = c.sku_id
  left join rule r on r.sku_id = c.sku_id
  order by 7 desc, s.code;
end $$;

revoke all on function app.office_receive_stock(uuid, uuid, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function app.office_restock_suggestions(integer, integer) from public, anon, authenticated, service_role;
grant execute on function app.office_receive_stock(uuid, uuid, jsonb, text) to authenticated;
grant execute on function app.office_restock_suggestions(integer, integer) to authenticated;

comment on function app.office_receive_stock(uuid, uuid, jsonb, text) is
  'INV-03. The office records goods received into a warehouse (H-08: one batch per client id; replay reported, never doubled).';
comment on function app.office_restock_suggestions(integer, integer) is
  'INV-07 estimate built from recorded history only: outward movement, open confirmed demand and the manual reorder point. An estimate for the office, never a stored figure or a purchase order.';
