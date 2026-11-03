-- =============================================================================
-- Kiran DMS · migration 0022 · Receivables ageing (task P1-07)
-- Requirements: PAY-07 (receivables ageing report per salon, per rep, per territory).
-- Docs: 09 section 9 (buckets current, 1-7, 8-15, 16-30, 30+ days), 04 (v_receivables_ageing,
--       derived views), 06 section 2 (the office sees all salons; reps see their own territories),
--       ACTIVITY A-14 (who a salon's receivable is counted under when grouped by rep).
--
-- What is built: one read, app.office_receivables_ageing(p_group), for the owner or manager with an
-- MFA session. It derives what each installment still owes from the part a rows (installment minus
-- payment_allocation, H-10) and buckets it by days past its due date on today's Karachi date. Nothing
-- is stored and nothing is written. It is a function rather than the doc 04 view because a view would
-- need base-table grants and its own role check; the function checks the caller like every other
-- office read.
--
-- What is not built: a rep's own ageing (reps read one salon at a time through app.salon_installments
-- and app.salon_balance), ageing as of a past date, the overdue escalation ladder (PAY-08, doc 09
-- section 7) and the owner dashboard figures (RPT-01).
-- =============================================================================

-- PAY-07. One row per salon, territory or rep that is owed something, largest overdue first.
-- Buckets by days past due on Karachi's date: on or before the due date is current; then 1-7, 8-15,
-- 16-30 and 31 or more (doc 09's "30+"). overdue_paisa is the sum of the four late buckets.
-- Grouped by rep (A-14), a salon counts under every rep currently assigned to its territory
-- (rep_territory with no end date), so the rep rows can add up to more than the total; a salon whose
-- territory has no current rep is counted in one row with a null group_id.
create function app.office_receivables_ageing(p_group text)
returns table (group_id uuid, group_name text, salons integer, current_paisa bigint, d1_7_paisa bigint,
               d8_15_paisa bigint, d16_30_paisa bigint, d31_plus_paisa bigint, overdue_paisa bigint,
               total_paisa bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := app.karachi_today();
begin
  perform app.assert_office();
  if p_group is null or p_group not in ('salon', 'territory', 'rep') then
    raise exception using errcode = '22023', message = 'group must be salon, territory or rep';
  end if;

  return query
  with owed as (
    select i.salon_id, (i.amount_due_paisa - coalesce(a.paid, 0))::bigint as remaining, v_today - i.due_on as late
    from public.installment i
    left join lateral (select sum(x.amount_paisa) as paid from public.payment_allocation x where x.installment_id = i.id) a on true
    where i.amount_due_paisa - coalesce(a.paid, 0) > 0
  ),
  per_salon as (
    select o.salon_id,
           coalesce(sum(o.remaining) filter (where o.late <= 0), 0)::bigint as cur,
           coalesce(sum(o.remaining) filter (where o.late between 1 and 7), 0)::bigint as d1,
           coalesce(sum(o.remaining) filter (where o.late between 8 and 15), 0)::bigint as d8,
           coalesce(sum(o.remaining) filter (where o.late between 16 and 30), 0)::bigint as d16,
           coalesce(sum(o.remaining) filter (where o.late > 30), 0)::bigint as d31
    from owed o
    group by o.salon_id
  ),
  keyed as (
    select ps.*, s.id as k, s.name as label
    from per_salon ps join public.salon s on s.id = ps.salon_id
    where p_group = 'salon'
    union all
    select ps.*, t.id, t.name
    from per_salon ps
    join public.salon s on s.id = ps.salon_id
    join public.area ar on ar.id = s.area_id
    join public.territory t on t.id = ar.territory_id
    where p_group = 'territory'
    union all
    select ps.*, rt.rep_id, u.full_name
    from per_salon ps
    join public.salon s on s.id = ps.salon_id
    join public.area ar on ar.id = s.area_id
    left join public.rep_territory rt on rt.territory_id = ar.territory_id and rt.to_date is null
    left join public.user_profile u on u.id = rt.rep_id
    where p_group = 'rep'
  )
  select kd.k, min(kd.label), count(distinct kd.salon_id)::integer,
         sum(kd.cur)::bigint, sum(kd.d1)::bigint, sum(kd.d8)::bigint, sum(kd.d16)::bigint, sum(kd.d31)::bigint,
         sum(kd.d1 + kd.d8 + kd.d16 + kd.d31)::bigint,
         sum(kd.cur + kd.d1 + kd.d8 + kd.d16 + kd.d31)::bigint
  from keyed kd
  group by kd.k
  order by sum(kd.d1 + kd.d8 + kd.d16 + kd.d31) desc, sum(kd.cur + kd.d1 + kd.d8 + kd.d16 + kd.d31) desc, min(kd.label), kd.k;
end $$;

comment on function app.office_receivables_ageing(text) is
  'PAY-07, doc 09 section 9. Owner or manager (AAL2). Buckets derived from installment and payment_allocation on Karachi''s date; grouped by salon, territory or rep (A-14). Read only.';

revoke execute on function app.office_receivables_ageing(text) from public, anon, authenticated, service_role;
grant execute on function app.office_receivables_ageing(text) to authenticated;
