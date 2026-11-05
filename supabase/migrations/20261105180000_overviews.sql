-- =============================================================================
-- Kiran DMS · migration 20261105180000 · Overview reads that add up on their own
-- Completion slice 9 (P1-26). MJ, chat 2026-11-05: a system anyone can run, which shows who placed
-- orders, who needs delivery and who is delivered; for investors, who invested and what they get for
-- the month (typed amounts only, D-40); for reps, the orders they brought and the commission earned.
-- Requirements: doc 16; RPT-01 (thin); CAP-02; FLD-06; D-38, D-40.
--
-- Read functions only. No table, column, policy, trigger or grant on a table changes; nothing here
-- writes a row (not even an audit row). Every figure is derived from the existing rows at the moment
-- of the call (H-10): orders, invoices, delivery submissions, salons, request cards, the investor
-- ledger and the commission ledger. No formula is added: commission uses slice 5's internals
-- (app.commission_earned_paisa, app.commission_paid_paisa), investors use slice 3's typed amounts.
--
--   * app.office_overview_counts() and app.office_overview_rows(): the office home. Owner or manager at
--     AAL2 (app.assert_office). Counts come from the whole table, never from a capped list. Rows carry
--     only names, statuses, dates and order or invoice totals: no credit snapshot, no limit, no stock,
--     no price below the order total, nothing from supplier_vault.
--   * app.office_investor_month(p_month, p_investor_id): the investors' "This month" block. Office only.
--   * app.my_month_orders(p_month): the rep's own orders of the month. Rep only, on its approved phone;
--     no rep id is taken, the session decides.
--   * app.office_rep_month(p_month): every rep's orders and commission for the month. Office only.
--
-- Rulings (the safest reading; logged as A-20 in ACTIVITY section 15 for MJ):
--   * A month is a Karachi calendar month. A timestamp belongs to the month of its Karachi date
--     (app.karachi_month); a typed ledger date belongs to its own month. A month after the current
--     Karachi month, or before 2020, is refused (22023), as investor dates are never in the future.
--   * "Orders a rep brought" are the orders whose rep is that rep: assigned_rep_id, or rep_id for an
--     older rep_visit order. That is the rep commission is stamped to (D-38), so the order counts and
--     the commission on one screen describe the same orders. An order counts in the month it was
--     placed (created_at); its commission counts in the month its invoice was issued, so an October
--     order delivered in November earns November commission. Cancelled orders are counted apart.
--   * Investor month: an investor reversal row is dated by the server on the day it is made. It counts
--     in the month of the entry it reverses, so fixing an October mistake in November corrects October
--     and November never shows a negative decision. "Profit still owed" is the live figure over all
--     months (decided minus paid, as app.office_investors), not a month-end snapshot: a payout may be
--     dated before the decision it pays.
--   * "This week" on the office home is the Karachi week from Monday.
-- Errors: 42501 wrong role or session; 22023 bad input or an unknown reference.
-- =============================================================================

-- ------------------------------------------------------------------ helpers ----
-- Internal (no grant). The first day of the Karachi month that holds a moment.
create function app.karachi_month(p_at timestamptz) returns date
language sql immutable set search_path = '' as $$
  select date_trunc('month', p_at at time zone 'Asia/Karachi')::date
$$;

-- Internal (no grant). The first and last day of the month that holds p_month, checked.
create function app.overview_month(p_month date)
returns table (month_start date, month_end date)
language plpgsql stable set search_path = '' as $$
declare v_start date;
begin
  if p_month is null then
    raise exception using errcode = '22023', message = 'choose a month';
  end if;
  v_start := date_trunc('month', p_month::timestamp)::date;
  if v_start > date_trunc('month', app.karachi_today()::timestamp)::date then
    raise exception using errcode = '22023', message = 'that month has not started yet';
  end if;
  if v_start < date '2020-01-01' then
    raise exception using errcode = '22023', message = 'choose a month from January 2020 on';
  end if;
  return query select v_start, ((v_start + interval '1 month')::date - 1);
end $$;

-- Internal (no grant). Who placed an order, in plain kinds: salon (a salon's own request or a portal
-- order), rep (a rep's card, or an older rep_visit order) or office (made directly by the office).
create function app.order_placed_by(p_order_id uuid)
returns table (kind text, name text)
language sql stable security definer set search_path = '' as $$
  select case when o.source_channel = 'salon_portal' or k.submitter_kind = 'salon' then 'salon'
              when o.source_channel = 'rep_visit' or k.submitter_kind = 'rep' then 'rep'
              else 'office' end,
         case when o.source_channel = 'salon_portal' or k.submitter_kind = 'salon' then s.name
              when o.source_channel = 'rep_visit' then r.full_name
              when k.submitter_kind = 'rep' then kr.full_name
              else c.full_name end
  from public.sales_order o
  join public.salon s on s.id = o.salon_id
  left join public.order_intake_card k on k.id = o.intake_card_id
  left join public.user_profile kr on kr.id = k.rep_id
  left join public.user_profile r on r.id = o.rep_id
  left join public.user_profile c on c.id = o.created_by
  where o.id = p_order_id
$$;

-- Internal (no grant). One rep's orders placed in a month, by status.
create function app.rep_month_orders(p_rep_id uuid, p_start date, p_end date)
returns table (orders_count bigint, orders_value_paisa bigint, delivered_count bigint, delivered_value_paisa bigint,
               waiting_count bigint, waiting_value_paisa bigint, held_count bigint, cancelled_count bigint)
language sql stable security definer set search_path = '' as $$
  select count(*) filter (where o.status <> 'cancelled'),
         coalesce(sum(o.total_paisa) filter (where o.status <> 'cancelled'), 0)::bigint,
         count(*) filter (where o.status in ('delivered', 'closed')),
         coalesce(sum(o.total_paisa) filter (where o.status in ('delivered', 'closed')), 0)::bigint,
         count(*) filter (where o.status in ('confirmed', 'partially_delivered')),
         coalesce(sum(o.total_paisa) filter (where o.status in ('confirmed', 'partially_delivered')), 0)::bigint,
         count(*) filter (where o.status = 'draft'),
         count(*) filter (where o.status = 'cancelled')
  from public.sales_order o
  where coalesce(o.assigned_rep_id, o.rep_id) = p_rep_id
    and app.karachi_month(o.created_at) between p_start and p_end
$$;

-- ------------------------------------------------------------- office home ----
-- The counts at the top of the office home, each over the whole table.
create function app.office_overview_counts()
returns table (week_start date, placed_this_week bigint, to_deliver bigint, waiting_approval bigint, held_orders bigint,
               pending_salons bigint, pending_requests bigint, delivered_this_week bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_week date;
begin
  perform app.assert_office();
  v_week := date_trunc('week', app.karachi_today()::timestamp)::date;
  return query
  select v_week,
         (select count(*) from public.sales_order o where (o.created_at at time zone 'Asia/Karachi')::date >= v_week),
         (select count(*) from public.sales_order o where o.status in ('confirmed', 'partially_delivered')),
         (select count(*) from public.delivery_submission s
           where not exists (select 1 from public.delivery_submission_decision x where x.submission_id = s.id)),
         (select count(*) from public.sales_order o where o.status = 'draft'),
         (select count(*) from public.salon s where s.approval_status = 'pending'),
         (select count(*) from public.order_intake_card c
           where not exists (select 1 from public.order_intake_card_close x where x.card_id = c.id)),
         (select count(*) from public.invoice i where (i.issued_at at time zone 'Asia/Karachi')::date >= v_week);
end $$;

-- The office home's lists, one section per row:
--   placed     orders placed this Karachi week, newest first (50)
--   waiting    confirmed or part-delivered orders, longest waiting first (50)
--   held       draft orders and why they wait, oldest first (50)
--   delivered  the newest invoices, one per delivery, newest first (20)
create function app.office_overview_rows()
returns table (section text, order_id uuid, salon_id uuid, salon_name text, placed_by_kind text, placed_by_name text,
               status public.order_status, total_paisa bigint, placed_at timestamptz, confirmed_at timestamptz,
               waiting_days integer, deliverer_kind text, deliverer_name text, waiting_approval boolean, hold_reason text,
               invoice_id uuid, invoice_number text, invoice_total_paisa bigint, delivered_at timestamptz,
               delivered_by_name text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_today date := app.karachi_today();
  v_week  date := date_trunc('week', app.karachi_today()::timestamp)::date;
begin
  perform app.assert_office();
  return query
  with picked as (
    (select 'placed'::text sec, 1 rnk, x.id oid, row_number() over (order by x.created_at desc, x.id) n
     from public.sales_order x where (x.created_at at time zone 'Asia/Karachi')::date >= v_week
     order by x.created_at desc, x.id limit 50)
    union all
    (select 'waiting', 2, x.id, row_number() over (order by x.confirmed_at, x.id)
     from public.sales_order x where x.status in ('confirmed', 'partially_delivered')
     order by x.confirmed_at, x.id limit 50)
    union all
    (select 'held', 3, x.id, row_number() over (order by x.created_at, x.id)
     from public.sales_order x where x.status = 'draft'
     order by x.created_at, x.id limit 50)),
  order_rows as (
    select k.rnk, k.n, k.sec, o.id, o.salon_id, s.name salon, pb.kind pk, pb.name pn, o.status st, o.total_paisa tot,
           o.created_at ca, o.confirmed_at cf,
           case when o.confirmed_at is null then null
                else (v_today - (o.confirmed_at at time zone 'Asia/Karachi')::date)::integer end wd,
           case when coalesce(o.assigned_rep_id, o.rep_id) is null then 'office' else 'rep' end dk, u.full_name dn,
           exists (select 1 from public.delivery_submission d
                   where d.order_id = o.id
                     and not exists (select 1 from public.delivery_submission_decision y where y.submission_id = d.id)) pend,
           case when o.status <> 'draft' then null
                when o.hold_discount = 'pending' then 'discount_waiting'
                when o.hold_discount = 'rejected' then 'discount_refused'
                when o.hold_credit is not null then o.hold_credit
                else 'not_checked' end hr,
           null::uuid iid, null::text inum, null::bigint itot, null::timestamptz iat, null::text ibn
    from picked k
    join public.sales_order o on o.id = k.oid
    join public.salon s on s.id = o.salon_id
    cross join lateral app.order_placed_by(o.id) pb
    left join public.user_profile u on u.id = coalesce(o.assigned_rep_id, o.rep_id)),
  invoice_rows as (
    select 4 rnk, row_number() over (order by i.issued_at desc, i.number desc) n, 'delivered'::text sec, i.order_id id,
           i.salon_id, s.name salon, pb.kind pk, pb.name pn, so.status st, so.total_paisa tot, so.created_at ca,
           so.confirmed_at cf, null::integer wd, case when b.role = 'rep' then 'rep' else 'office' end dk, null::text dn,
           false pend, null::text hr, i.id iid, i.number inum, i.total_paisa itot, i.issued_at iat, b.full_name ibn
    from (select * from public.invoice x order by x.issued_at desc, x.number desc limit 20) i
    join public.sales_order so on so.id = i.order_id
    join public.salon s on s.id = i.salon_id
    cross join lateral app.order_placed_by(i.order_id) pb
    left join public.user_profile b on b.id = coalesce(i.delivered_by, i.issued_by)),
  all_rows as (select * from order_rows union all select * from invoice_rows)
  select a.sec, a.id, a.salon_id, a.salon, a.pk, a.pn, a.st, a.tot, a.ca, a.cf, a.wd, a.dk, a.dn, a.pend, a.hr,
         a.iid, a.inum, a.itot, a.iat, a.ibn
  from all_rows a
  order by a.rnk, a.n;
end $$;

-- ---------------------------------------------------------------- investors ----
-- The "This month" block: for each investor (or one, when p_investor_id is given), invested over all
-- time, the profit the office decided for the month, the profit and the principal paid in the month,
-- the profit still owed today over all months, and how many live decisions the month has (0 means
-- "nothing decided yet"). Without p_investor_id a totals row (is_total) follows the investors.
-- Typed amounts only (D-40): nothing is suggested or worked out from a rate.
create function app.office_investor_month(p_month date, p_investor_id uuid default null)
returns table (investor_id uuid, full_name text, status public.investor_status, is_total boolean, month_start date,
               month_end date, invested_paisa bigint, principal_outstanding_paisa bigint, profit_decided_month_paisa bigint,
               decisions_month bigint, profit_paid_month_paisa bigint, principal_paid_month_paisa bigint,
               profit_owed_paisa bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_start date;
  v_end   date;
begin
  perform app.assert_office();
  select m.month_start, m.month_end into v_start, v_end from app.overview_month(p_month) m;
  if p_investor_id is not null and not exists (select 1 from public.investor x where x.id = p_investor_id) then
    raise exception using errcode = '22023', message = 'unknown investor';
  end if;
  return query
  with f as (
    select g.investor_id iid, sum(g.invested_paisa) inv, sum(g.principal_returned_paisa) ret,
           sum(g.profit_decided_paisa) dcd, sum(g.profit_paid_paisa) paid
    from app.investment_figures(p_investor_id) g group by g.investor_id),
  -- Each decision and payout with the date it counts on: its own, or for a reversal its original's.
  d as (
    select i.investor_id iid, dd.amount_paisa amt, coalesce(od.decided_on, dd.decided_on) on_day,
           (dd.reverses_id is null
            and not exists (select 1 from public.investor_profit_decision z where z.reverses_id = dd.id)) live
    from public.investor_profit_decision dd
    join public.investment i on i.id = dd.investment_id
    left join public.investor_profit_decision od on od.id = dd.reverses_id
    where p_investor_id is null or i.investor_id = p_investor_id),
  p as (
    select i.investor_id iid, pp.kind, pp.amount_paisa amt, coalesce(op.paid_on, pp.paid_on) on_day
    from public.investor_payout pp
    join public.investment i on i.id = pp.investment_id
    left join public.investor_payout op on op.id = pp.reverses_id
    where p_investor_id is null or i.investor_id = p_investor_id),
  dm as (
    select d.iid, sum(d.amt) amt, count(*) filter (where d.live) n
    from d where d.on_day between v_start and v_end group by d.iid),
  pm as (
    select p.iid, sum(p.amt) filter (where p.kind = 'profit') prof, sum(p.amt) filter (where p.kind = 'principal') prin
    from p where p.on_day between v_start and v_end group by p.iid),
  r as (
    select x.id, x.full_name, x.status,
           coalesce(f.inv, 0)::bigint inv, coalesce(f.inv - f.ret, 0)::bigint outp,
           coalesce(dm.amt, 0)::bigint dmon, coalesce(dm.n, 0)::bigint nmon,
           coalesce(pm.prof, 0)::bigint pprof, coalesce(pm.prin, 0)::bigint pprin,
           coalesce(f.dcd - f.paid, 0)::bigint owed
    from public.investor x
    left join f on f.iid = x.id
    left join dm on dm.iid = x.id
    left join pm on pm.iid = x.id
    where p_investor_id is null or x.id = p_investor_id),
  u as (
    select r.id, r.full_name, r.status, false tot, r.inv, r.outp, r.dmon, r.nmon, r.pprof, r.pprin, r.owed from r
    union all
    select null, null, null, true, coalesce(sum(r.inv), 0)::bigint, coalesce(sum(r.outp), 0)::bigint,
           coalesce(sum(r.dmon), 0)::bigint, coalesce(sum(r.nmon), 0)::bigint, coalesce(sum(r.pprof), 0)::bigint,
           coalesce(sum(r.pprin), 0)::bigint, coalesce(sum(r.owed), 0)::bigint
    from r having p_investor_id is null)
  select u.id, u.full_name, u.status, u.tot, v_start, v_end, u.inv, u.outp, u.dmon, u.nmon, u.pprof, u.pprin, u.owed
  from u
  order by u.tot, lower(u.full_name), u.id;
end $$;

-- --------------------------------------------------------------------- reps ----
-- The calling rep's orders of the month (orders it brought, by status). Commission for the same month
-- is app.my_commission(month_start, month_end), which the page calls with these dates.
create function app.my_month_orders(p_month date)
returns table (month_start date, month_end date, orders_count bigint, orders_value_paisa bigint, delivered_count bigint,
               delivered_value_paisa bigint, waiting_count bigint, waiting_value_paisa bigint, held_count bigint,
               cancelled_count bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_role  public.app_role := app.assert_actor_ready();
  v_start date;
  v_end   date;
begin
  if v_role <> 'rep' or not app.self_ok() then
    perform app.raise_denied('reps read their own month, on their approved phone');
  end if;
  select m.month_start, m.month_end into v_start, v_end from app.overview_month(p_month) m;
  return query
  select v_start, v_end, x.orders_count, x.orders_value_paisa, x.delivered_count, x.delivered_value_paisa,
         x.waiting_count, x.waiting_value_paisa, x.held_count, x.cancelled_count
  from app.rep_month_orders(auth.uid(), v_start, v_end) x;
end $$;

-- Every rep (up to 200, by name) with its orders of the month and its commission: earned and paid in
-- the month, still owed over all time (earned minus paid, as app.office_commission_reps).
create function app.office_rep_month(p_month date)
returns table (rep_id uuid, full_name text, status public.user_status, month_start date, month_end date,
               orders_count bigint, orders_value_paisa bigint, delivered_count bigint, waiting_count bigint,
               held_count bigint, cancelled_count bigint, earned_month_paisa bigint, paid_month_paisa bigint,
               owed_paisa bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_start date;
  v_end   date;
begin
  perform app.assert_office();
  select m.month_start, m.month_end into v_start, v_end from app.overview_month(p_month) m;
  return query
  select u.id, u.full_name, u.status, v_start, v_end, x.orders_count, x.orders_value_paisa, x.delivered_count,
         x.waiting_count, x.held_count, x.cancelled_count,
         app.commission_earned_paisa(u.id, v_start, v_end), app.commission_paid_paisa(u.id, v_start, v_end),
         app.commission_earned_paisa(u.id, null, null) - app.commission_paid_paisa(u.id, null, null)
  from public.user_profile u
  cross join lateral app.rep_month_orders(u.id, v_start, v_end) x
  where u.role = 'rep'
  order by u.full_name, u.id
  limit 200;
end $$;

-- ----------------------------------------------------------------- function privileges ----
-- Internal helpers: no grant to any role.
revoke all on function
  app.karachi_month(timestamptz), app.overview_month(date), app.order_placed_by(uuid),
  app.rep_month_orders(uuid, date, date)
  from public, anon, authenticated, service_role;

revoke all on function
  app.office_overview_counts(), app.office_overview_rows(), app.office_investor_month(date, uuid),
  app.my_month_orders(date), app.office_rep_month(date)
  from public, anon, authenticated, service_role;
grant execute on function
  app.office_overview_counts(), app.office_overview_rows(), app.office_investor_month(date, uuid),
  app.my_month_orders(date), app.office_rep_month(date)
  to authenticated;
