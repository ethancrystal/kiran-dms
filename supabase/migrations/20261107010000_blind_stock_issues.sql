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
