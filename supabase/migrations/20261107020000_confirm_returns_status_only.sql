-- REP-05 follow-up: the blind stock count still leaked the office's quantities through the confirm call.
--
-- app.rep_confirm_stock_issue returned the whole public.stock_issue row, lines included, so a rep calling it
-- directly with a wrong count (one dispute) read every quantity the office had proposed. It now returns only
-- id, status and decided_at as jsonb. The body is the one from 20261028050000_inventory.sql; only the return
-- type and the two return statements change. The return type changes, so the function is dropped and
-- recreated and its execute grant is given again (authenticated only, as before).
--
-- Forward-only. No table, column or policy changes.

drop function app.rep_confirm_stock_issue(uuid, jsonb);

create function app.rep_confirm_stock_issue(p_issue_id uuid, p_counted jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role    public.app_role := app.assert_actor_ready();
  v         public.stock_issue;
  v_counted jsonb;
  e         jsonb;
  v_match   boolean;
begin
  if v_role <> 'rep' then perform app.raise_denied('only the receiving rep confirms a stock issue'); end if;
  select * into v from public.stock_issue where id = p_issue_id for update;
  if v.id is null or v.bag_id is distinct from app.my_bag_id() then
    perform app.raise_denied('this stock issue is not for your bag');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('sku_id', x.sku_id, 'qty', x.qty) order by x.sku_id), '[]'::jsonb)
    into v_counted
    from app.parse_lines(p_counted, true) x where x.qty > 0;
  if v.status <> 'pending' then
    if v.counted_lines = v_counted then return jsonb_build_object('id', v.id, 'status', v.status, 'decided_at', v.decided_at); end if;                   -- replay
    perform app.raise_denied('stock issue already decided');
  end if;
  v_match := v_counted = v.lines;
  perform app.set_purpose(case when v_match then 'stock issue confirmed by rep' else 'stock issue disputed by rep' end);
  if v_match then
    for e in select * from jsonb_array_elements(v.lines) loop
      insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind,
                                         source_type, source_id, actor_id)
      values (gen_random_uuid(), (e ->> 'sku_id')::uuid, (e ->> 'qty')::integer,
              case when v.direction = 'to_rep' then v.warehouse_id else v.bag_id end,
              case when v.direction = 'to_rep' then v.bag_id else v.warehouse_id end,
              case when v.direction = 'to_rep' then 'issue_to_rep'::public.stock_movement_kind
                   else 'return_to_warehouse'::public.stock_movement_kind end,
              'stock_issue', v.id, auth.uid());
    end loop;
  end if;
  update public.stock_issue
     set status = case when v_match then 'confirmed'::public.stock_issue_status else 'disputed'::public.stock_issue_status end,
         counted_lines = v_counted, decided_by = auth.uid(), decided_at = now()
   where id = v.id returning * into v;
  return jsonb_build_object('id', v.id, 'status', v.status, 'decided_at', v.decided_at);
end $$;

revoke all on function app.rep_confirm_stock_issue(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function app.rep_confirm_stock_issue(uuid, jsonb) to authenticated;
