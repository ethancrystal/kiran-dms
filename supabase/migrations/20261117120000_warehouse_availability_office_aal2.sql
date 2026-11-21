-- =============================================================================
-- Kiran DMS · migration 20261117120000 · Office TOTP on warehouse availability
-- Doc 06 section 10.3. Closes the open defect on app.warehouse_availability().
--
-- The original body (20261028050000_inventory.sql) is language sql and keeps
-- every row when app.self_ok() is true. self_ok is true for every active
-- owner or manager, including a session that has not done TOTP (AAL1). A rep
-- on an approved device must still see quantities only.
--
-- assert_office() raises, so it cannot sit in the same boolean as the rep
-- check: a raise would abort the query for a rep. The two callers are
-- separate branches. Grants from 20261028050000 are unchanged: create or
-- replace keeps them, and the signature is the same.
-- =============================================================================

create or replace function app.warehouse_availability()
returns table (sku_id uuid, code text, available bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app.user_role() = 'rep' then
    -- Same result as the old filter: an unapproved device sees no rows.
    if not app.self_ok() then
      return;
    end if;
  else
    -- Owner or manager at AAL2. AAL1, a salon login, and a session with no
    -- profile are refused (42501) by assert_office / assert_actor_ready.
    perform app.assert_office();
  end if;

  return query
    select s.id, s.code,
           greatest(0, sum(app.on_hand(l.id, s.id) - app.pending_out(l.id, s.id)))::bigint
    from public.sku s
    cross join public.stock_location l
    where s.active and l.kind = 'warehouse' and l.active
    group by s.id, s.code
    order by s.code;
end
$$;
