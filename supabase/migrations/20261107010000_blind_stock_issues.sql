-- REP-05: the blind stock count sent the office's quantities to the rep's browser.
--
-- CTL-05 two-party custody: the office proposes a stock issue (or return) and the rep confirms it with
-- their own count, which only posts when it equals the office's figure. The count is meant to be blind, but
-- the rep's page read public.stock_issue directly under RLS, so the office's quantities (lines) reached the
-- browser and the second count could be copied.
--
-- 1. app.my_pending_issues(): the pending issues of the caller's own bag with the SKU ids to count and
--    nothing else: no quantity, no suggestion, no issuer. A rep on an approved phone only (self_ok and
--    the caller's own bag), like app.my_issue_skus.
-- 2. The rep's select policy on public.stock_issue is dropped: reps read issues only through the function.
--    The office keeps full select. app.rep_confirm_stock_issue is security definer and is unchanged.
--
-- Forward-only. No table or column changes.

create function app.my_pending_issues()
returns table (id uuid, direction public.stock_issue_direction, decision_note text, created_at timestamptz, sku_ids uuid[])
language sql stable security definer set search_path = '' as $$
  select i.id, i.direction, i.decision_note, i.created_at,
         array(select (e ->> 'sku_id')::uuid
                 from jsonb_array_elements(i.lines) with ordinality as t(e, n)
                order by n)
    from public.stock_issue i
   where i.status = 'pending'
     and app.self_ok()
     and i.bag_id = app.my_bag_id()
   order by i.created_at
$$;

revoke all on function app.my_pending_issues() from public, anon, authenticated, service_role;
grant execute on function app.my_pending_issues() to authenticated;

comment on function app.my_pending_issues() is
  'REP-05 (CTL-05). The pending stock issues and returns of the rep''s own bag: id, direction, the office''s note, time and the SKU ids to count; never a quantity. A rep on an approved phone.';

drop policy stock_issue_select on public.stock_issue;
create policy stock_issue_select on public.stock_issue for select to authenticated
  using ((select app.is_office()));

-- 3. app.rep_confirm_stock_issue: mask lines so the return value never reveals the office's
--    quantities to the rep on confirmation or dispute. The database row in public.stock_issue
--    retains lines and counted_lines; only the return composite is sanitized.
create or replace function app.rep_confirm_stock_issue(p_issue_id uuid, p_counted jsonb)
returns public.stock_issue
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
    if v.counted_lines = v_counted then
      v.lines := '[]'::jsonb;
      return v;
    end if;                   -- replay
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
  -- REP-05: Never leak the office's quantities to the rep in the return composite
  v.lines := '[]'::jsonb;
  return v;
end $$;
