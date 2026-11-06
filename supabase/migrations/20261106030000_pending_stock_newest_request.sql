-- =============================================================================
-- Kiran DMS · migration 20261106030000 · H1: a superseded refusal no longer shows on rejected goods
-- Requirements: C2 (PLAN plan item "Stale refused request shown on pending stock"), SEC-13, H-08, H-13, H-17.
-- Decisions: none new — the C2 ruling is strengthened in the database: the function now returns at most one
--             adjustment request per pending-location + SKU, namely the newest one. No new decisions are made.
--
-- What changes, by audit finding:
--   C2  app.office_pending_stock() now returns only the newest approval_request for a stock_location,
--       shown only if it is pending, refused, or approved but not yet used (no stock_movement carries
--       its approval_id). Before, the newest request was chosen from among those already filtered to
--       pending or refused, so when a newer request was withdrawn or used, an older refused one came
--       back with its refusal reason. Now the newest is chosen first and filtered after: a withdrawn
--       (cancelled) or used newest request shows nothing. The refused-approvals queue and the rejection
--       counts are untouched.
--   H-08  app.office_pending_stock() is security definer with a pinned search_path; no change to that form.
--   H-13  RLS is already enabled and forced on the tables it reads; the policy scan does not touch this
--         function, and the change does not weaken any control.
--   H-17  The function is read-only; the audit trigger is untouched.
create or replace function app.office_pending_stock()
returns table (submission_id uuid, rep_id uuid, rep_name text, salon_name text, sku_id uuid, sku_code text, unsettled integer,
               pending_location_id uuid, reason text, decided_at timestamptz, request_id uuid,
               request_status public.approval_status, request_maker_id uuid, request_checker_role public.app_role,
               request_qty integer, request_decision_reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
  select q.submission_id, q.rep_id, q.rep_name, q.salon_name, q.sku_id, q.sku_code, q.unsettled, q.pending_location_id,
         q.reason, q.decided_at, req.id, req.status, req.maker_id, req.checker_role_required, req.qty, req.decision_reason
  from (
    select s.id submission_id, s.rep_id, u.full_name rep_name, sa.name salon_name, k.id sku_id, k.code sku_code,
           app.pending_unsettled(s.id, k.id) unsettled, app.pending_location_of(s.rep_id) pending_location_id,
           x.reason, x.decided_at
    from public.delivery_submission s
    join public.delivery_submission_decision x on x.submission_id = s.id and x.outcome = 'rejected'
    join public.user_profile u on u.id = s.rep_id
    join public.salon sa on sa.id = s.salon_id
    cross join lateral jsonb_array_elements(s.lines) e
    join public.sku k on k.id = (e ->> 'sku_id')::uuid) q
  left join lateral (
    select n.id, n.status, n.maker_id, n.checker_role_required, n.decision_reason, n.qty
    from (
      select a.id, a.status, a.maker_id, a.checker_role_required, a.decision_reason,
             case when jsonb_typeof(a.payload -> 'qty_delta') = 'number' and (a.payload ->> 'qty_delta') ~ '^-?[0-9]{1,6}$'
                  then -((a.payload ->> 'qty_delta')::integer) end qty
      from control.approval_request a
      where a.kind = 'adjustment' and a.subject_type = 'stock_location' and a.subject_id = q.pending_location_id
        and a.payload ->> 'submission_id' = q.submission_id::text and a.payload ->> 'sku_id' = q.sku_id::text
      order by a.created_at desc, a.id
      limit 1) n
    where n.status in ('pending', 'rejected')
       or (n.status = 'approved' and not exists (select 1 from public.stock_movement m where m.approval_id = n.id))
  ) req on true
  where q.unsettled > 0
  order by q.decided_at, q.submission_id, q.sku_code
  limit 500;
end $$;
