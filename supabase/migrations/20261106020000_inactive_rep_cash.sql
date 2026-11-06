-- =============================================================================
-- Kiran DMS · migration 20261106020000 · Cash held by a rep who is no longer active is visible (M7)
-- Requirements: CTL-03, PAY-05 (read side), H-08, H-13. Audit finding M7 (plan C2).
--
-- A suspended or offboarded rep can still hold cash on the rep cash ledger: a rep whose phone is switched
-- off never answers a count (A-15), and the count list shows only active reps, so that cash was invisible to
-- the office. This adds the read. It moves nothing and counts nothing: how the cash of a rep who can no longer
-- answer is brought in is a decision for MJ (it would be a new way for cash to move), so the office is told who
-- holds what and that reactivating the rep on People lets them be counted today.
-- =============================================================================

-- Reps whose status is suspended or offboarded and whose cash ledger holds a positive balance, largest
-- first (100). Owner or manager at AAL2 (app.assert_office). Allow-listed fields only.
create function app.office_inactive_rep_cash()
returns table (rep_id uuid, full_name text, status public.user_status, cash_paisa bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
  select u.id, u.full_name, u.status, app.rep_cash_balance(u.id)
  from public.user_profile u
  where u.role = 'rep' and u.status <> 'active' and app.rep_cash_balance(u.id) > 0
  order by app.rep_cash_balance(u.id) desc, u.full_name, u.id
  limit 100;
end $$;

revoke all on function app.office_inactive_rep_cash() from public, anon, authenticated, service_role;
grant execute on function app.office_inactive_rep_cash() to authenticated;

comment on function app.office_inactive_rep_cash() is
  'M7 (plan C2). Owner or manager (AAL2): reps who are suspended or offboarded and still hold cash on the rep ledger. A read only; nothing is counted or moved.';
