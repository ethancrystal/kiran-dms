-- =============================================================================
-- Kiran DMS · migration 20261120060000 · Investor recurring percentage return
-- Decision 2026-11-20-mj-rep-scope-stock-investors (MJ, 2026-11-20); assumption
-- 2026-11-20-hermes-investor-return-period (A-24). Amends doc 16 and supersedes the
-- no-calculation rule of D-40 / D-43 for the investor ledger.
--
-- What changes: an investment may carry a promised recurring return, a percentage
-- per period (monthly by default, or yearly). The system derives the accrued return
-- from the invested amount, the percentage and the whole periods elapsed since the
-- investment date; nothing is stored (H-10). The office still records payouts; a
-- profit payout is now capped at accrued + decided - paid. Investments with no
-- return terms behave exactly as before (accrued = 0), so the typed profit decision
-- path is unchanged for them.
--
-- Accrual rule (A-24): per_period = floor(amount_paisa * return_pct / 100). Whole
-- periods elapsed use Postgres age(as_of, invested_on): monthly counts whole years
-- times 12 plus whole months; yearly counts whole years. A part period does not
-- accrue. A reversed investment accrues nothing.
--
-- Forward-only: adds two nullable columns to public.investment and widens its shape
-- check; drops and recreates the three derived-figure read functions (their return
-- type gains columns) and investment_figures; replaces the write functions in place
-- (their return types are unchanged). Grants are restated for the recreated reads.
-- =============================================================================

-- ------------------------------------------------------------------- type ----
create type public.investor_return_period as enum ('monthly', 'yearly');

-- ------------------------------------------------------------------ columns --
alter table public.investment
  add column return_pct    numeric(9,4),
  add column return_period public.investor_return_period;

comment on column public.investment.return_pct is
  'Promised recurring return, percent per period (10.0000 = 10%). Null when the investment has no promised return. Decision 2026-11-20-mj-rep-scope-stock-investors.';
comment on column public.investment.return_period is
  'The period of the promised return: monthly or yearly. Null when return_pct is null.';

-- The shape check now also governs the return terms: an original row has either no
-- terms or both terms (pct above 0 and at most 1000, a period); a reversal row has
-- no terms. The amount and reason rules are unchanged.
alter table public.investment drop constraint investment_shape;
alter table public.investment add constraint investment_shape check (
  (reverses_id is null and amount_paisa between 1 and 99999999999 and reason is null
    and (
      (return_pct is null and return_period is null)
      or (return_pct is not null and return_period is not null and return_pct > 0 and return_pct <= 1000)
    ))
  or (reverses_id is not null and amount_paisa between -99999999999 and -1
      and coalesce(length(btrim(reason)), 0) between 5 and 300
      and return_pct is null and return_period is null)
);

-- ------------------------------------------------------------------ helpers --
-- Internal (no grant). The accrued promised return of one investment as of a date,
-- in paisa. Zero when there are no terms, the date is before the investment, or the
-- investment is reversed (the caller passes 0 for reversed rows). Whole periods only.
create function app.investor_accrued_return(
  p_amount_paisa bigint, p_return_pct numeric, p_return_period public.investor_return_period,
  p_invested_on date, p_as_of date)
returns bigint language sql immutable set search_path = '' as $$
  select case
    when p_return_pct is null or p_return_period is null or p_as_of < p_invested_on then 0::bigint
    else (
      floor(p_amount_paisa::numeric * p_return_pct / 100)::bigint
      * greatest(0, case
          when p_return_period::text = 'monthly' then
            extract(year from age(p_as_of, p_invested_on))::int * 12
            + extract(month from age(p_as_of, p_invested_on))::int
          else extract(year from age(p_as_of, p_invested_on))::int
        end)
    )::bigint
  end
$$;

-- Internal (no grant). The figures of each original investment, derived from the rows
-- (H-10), now with the live accrued promised return and the return terms. A reversal
-- row nets its original to zero (reads reversed) and accrues nothing.
drop function if exists app.investment_figures(uuid);
create function app.investment_figures(p_investor_id uuid)
returns table (investment_id uuid, investor_id uuid, invested_on date, note text, recorded_at timestamptz, reversed boolean,
               invested_paisa bigint, principal_returned_paisa bigint, profit_decided_paisa bigint, profit_paid_paisa bigint,
               profit_accrued_paisa bigint, return_pct numeric, return_period text)
language sql stable security definer set search_path = '' as $$
  select i.id, i.investor_id, i.invested_on, i.note, i.created_at,
         exists (select 1 from public.investment r where r.reverses_id = i.id),
         (i.amount_paisa + coalesce((select sum(r.amount_paisa) from public.investment r where r.reverses_id = i.id), 0))::bigint,
         coalesce((select sum(p.amount_paisa) from public.investor_payout p where p.investment_id = i.id and p.kind = 'principal'), 0)::bigint,
         coalesce((select sum(d.amount_paisa) from public.investor_profit_decision d where d.investment_id = i.id), 0)::bigint,
         coalesce((select sum(p.amount_paisa) from public.investor_payout p where p.investment_id = i.id and p.kind = 'profit'), 0)::bigint,
         case when exists (select 1 from public.investment r where r.reverses_id = i.id) then 0::bigint
              else app.investor_accrued_return(i.amount_paisa, i.return_pct, i.return_period, i.invested_on, app.karachi_today())
         end,
         i.return_pct, i.return_period::text
  from public.investment i
  where i.reverses_id is null and (p_investor_id is null or i.investor_id = p_investor_id)
$$;

-- -------------------------------------------------------------- the ledger ---
-- CAP-01: money an investor put in, optionally with a promised recurring return.
-- The signature gains two parameters, so the old five-argument function is dropped
-- first; otherwise a five-argument call would be ambiguous between the two overloads.
drop function if exists app.office_add_investment(uuid, uuid, bigint, date, text);
create function app.office_add_investment(
  p_client_id uuid, p_investor_id uuid, p_amount_paisa bigint, p_invested_on date, p_note text default null,
  p_return_pct numeric default null, p_return_period text default null)
returns public.investment
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_office();
  v_note text := app.blank_to_null(p_note);
  v_period public.investor_return_period;
  v_status public.investor_status;
  m      public.investment;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'an investment needs a client_id (idempotency key, H-08)';
  end if;
  perform app.investor_entry_lock(p_client_id);
  select * into m from public.investment x where x.client_id = p_client_id;
  if m.id is not null then
    if m.recorded_by = auth.uid() and m.reverses_id is null and m.investor_id = p_investor_id and m.amount_paisa = p_amount_paisa
       and m.invested_on = p_invested_on and m.note is not distinct from v_note
       and m.return_pct is not distinct from p_return_pct and m.return_period::text is not distinct from p_return_period then
      return m;                                                                -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  perform app.investor_assert_amount(p_amount_paisa);
  perform app.investor_assert_date(p_invested_on, 'an investment');
  perform app.investor_assert_note(v_note);
  -- The return terms: either both absent, or both present and valid.
  if (p_return_pct is null) <> (p_return_period is null) then
    raise exception using errcode = '22023', message = 'a promised return needs both a percentage and a period (monthly or yearly)';
  end if;
  if p_return_pct is not null then
    if p_return_pct <= 0 or p_return_pct > 1000 then
      raise exception using errcode = '22023', message = 'a return percentage is above 0 and at most 1000';
    end if;
    if p_return_period not in ('monthly', 'yearly') then
      raise exception using errcode = '22023', message = 'a return period is monthly or yearly';
    end if;
    v_period := p_return_period::public.investor_return_period;
  end if;
  if p_investor_id is null then raise exception using errcode = '22023', message = 'unknown investor'; end if;
  perform app.investor_lock(p_investor_id);
  select i.status into v_status from public.investor i where i.id = p_investor_id;
  if not found then raise exception using errcode = '22023', message = 'unknown investor'; end if;
  if v_status = 'closed' then
    raise exception using errcode = '55000', message = 'this investor is closed; reopen it first';
  end if;
  perform app.set_purpose('investment recorded');
  insert into public.investment (client_id, investor_id, amount_paisa, invested_on, note, return_pct, return_period, recorded_by)
  values (p_client_id, p_investor_id, p_amount_paisa, p_invested_on, v_note, p_return_pct, v_period, auth.uid())
  returning * into m;
  return m;
end $$;

-- CAP-02, CAP-03: a profit payout is capped at the accrued promised return plus the
-- typed decisions, minus what was paid; a principal payout at invested minus returned.
create or replace function app.office_record_payout(
  p_client_id uuid, p_investment_id uuid, p_kind text, p_method text, p_amount_paisa bigint, p_paid_on date,
  p_reference text default null, p_note text default null)
returns public.investor_payout
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_office();
  v_ref  text := app.blank_to_null(p_reference);
  v_note text := app.blank_to_null(p_note);
  v_left bigint;
  p      public.investor_payout;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a payout needs a client_id (idempotency key, H-08)';
  end if;
  perform app.investor_entry_lock(p_client_id);
  select * into p from public.investor_payout x where x.client_id = p_client_id;
  if p.id is not null then
    if p.recorded_by = auth.uid() and p.reverses_id is null and p.investment_id = p_investment_id
       and p.kind::text = p_kind and p.method::text = p_method and p.amount_paisa = p_amount_paisa
       and p.paid_on = p_paid_on and p.reference is not distinct from v_ref and p.note is not distinct from v_note then
      return p;                                                                -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if p_kind is null or p_kind not in ('profit', 'principal') then
    raise exception using errcode = '22023', message = 'a payout is of profit or principal';
  end if;
  if p_method is null or p_method not in ('cash', 'bank', 'other') then
    raise exception using errcode = '22023', message = 'a payout method is cash, bank or other';
  end if;
  perform app.investor_assert_amount(p_amount_paisa);
  perform app.investor_assert_date(p_paid_on, 'a payout');
  if p_method = 'bank' and v_ref is null then
    raise exception using errcode = '22023', message = 'a bank payout needs the transfer reference';
  end if;
  if length(v_ref) > 120 then
    raise exception using errcode = '22023', message = 'a reference is at most 120 characters';
  end if;
  perform app.investor_assert_note(v_note);
  perform app.investor_open_investment(p_investment_id, p_paid_on, 'a payout');
  -- After the investor's key: every earlier payout on this investment is committed and counted.
  select case when p_kind = 'profit' then f.profit_accrued_paisa + f.profit_decided_paisa - f.profit_paid_paisa
              else f.invested_paisa - f.principal_returned_paisa end
    into v_left
  from app.investment_figures(null) f where f.investment_id = p_investment_id;
  if p_amount_paisa > v_left then
    raise exception using errcode = '23514', message = case when p_kind = 'profit'
      then format('this payout is more than the profit owed on this investment (%s paisa)', v_left)
      else format('this payout is more than the principal outstanding on this investment (%s paisa)', v_left) end;
  end if;
  perform app.set_purpose('investor payout recorded');
  insert into public.investor_payout (client_id, investment_id, kind, method, reference, amount_paisa, paid_on, note, recorded_by)
  values (p_client_id, p_investment_id, p_kind::public.investor_payout_kind, p_method::public.investor_payout_method,
          v_ref, p_amount_paisa, p_paid_on, v_note, auth.uid())
  returning * into p;
  return p;
end $$;

-- The owner or a manager changes an investor's details or status. Closing needs nothing
-- outstanding: all principal returned and all profit owed (accrued + decided - paid) zero.
create or replace function app.office_update_investor(
  p_investor_id uuid, p_full_name text, p_phone text, p_note text, p_status text)
returns public.investor
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_office();
  v_name  text := app.blank_to_null(p_full_name);
  v_phone text := app.blank_to_null(p_phone);
  v_note  text := app.blank_to_null(p_note);
  x       public.investor;
begin
  if p_status is distinct from 'active' and p_status is distinct from 'closed' then
    raise exception using errcode = '22023', message = 'an investor is active or closed';
  end if;
  if p_investor_id is null then raise exception using errcode = '22023', message = 'unknown investor'; end if;
  perform app.investor_lock(p_investor_id);
  select * into x from public.investor i where i.id = p_investor_id;
  if x.id is null then raise exception using errcode = '22023', message = 'unknown investor'; end if;
  perform app.investor_assert_details(v_name, v_phone);
  perform app.investor_assert_note(v_note);
  if p_status = 'closed' and x.status = 'active' and exists (
       select 1 from app.investment_figures(x.id) f
       where f.invested_paisa <> f.principal_returned_paisa
          or f.profit_accrued_paisa + f.profit_decided_paisa <> f.profit_paid_paisa) then
    raise exception using errcode = '55000',
      message = 'this investor still has principal or profit outstanding; record the payouts before closing';
  end if;
  if (x.full_name, x.phone, x.note, x.status::text) is not distinct from (v_name, v_phone, v_note, p_status) then
    return x;                                                                  -- nothing to change
  end if;
  perform app.set_purpose(case when x.status::text <> p_status then 'investor ' || p_status else 'investor updated' end);
  update public.investor
     set full_name = v_name, phone = v_phone, note = v_note, status = p_status::public.investor_status
   where id = x.id
  returning * into x;
  return x;
end $$;

-- CAP-02: a mistake is corrected by a reversal row with a reason. An investment cannot
-- be reversed once money moved on it or a return has accrued; a decision cannot be
-- reversed below what was paid (accrued return counts toward what covers the paid).
create or replace function app.office_reverse_investor_entry(p_client_id uuid, p_entry_kind text, p_entry_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role   public.app_role := app.assert_office();
  v_reason text := app.blank_to_null(p_reason);
  v_today  date := app.karachi_today();
  v_status public.investor_status;
  v_inv    uuid;
  f        record;
  m        public.investment;
  d        public.investor_profit_decision;
  p        public.investor_payout;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a reversal needs a client_id (idempotency key, H-08)';
  end if;
  if p_entry_kind is null or p_entry_kind not in ('investment', 'profit_decision', 'payout') then
    raise exception using errcode = '22023', message = 'an entry kind is investment, profit_decision or payout';
  end if;
  perform app.investor_entry_lock(p_client_id);
  if p_entry_kind = 'investment' then
    select * into m from public.investment x where x.client_id = p_client_id;
    if m.id is not null then
      if m.recorded_by = auth.uid() and m.reverses_id = p_entry_id and m.reason = v_reason then
        return jsonb_build_object('entry_kind', p_entry_kind, 'id', m.id, 'reverses_id', m.reverses_id, 'amount_paisa', m.amount_paisa);
      end if;
      raise exception using errcode = '23505', message = 'client_id already used with different content';
    end if;
  elsif p_entry_kind = 'profit_decision' then
    select * into d from public.investor_profit_decision x where x.client_id = p_client_id;
    if d.id is not null then
      if d.recorded_by = auth.uid() and d.reverses_id = p_entry_id and d.reason = v_reason then
        return jsonb_build_object('entry_kind', p_entry_kind, 'id', d.id, 'reverses_id', d.reverses_id, 'amount_paisa', d.amount_paisa);
      end if;
      raise exception using errcode = '23505', message = 'client_id already used with different content';
    end if;
  else
    select * into p from public.investor_payout x where x.client_id = p_client_id;
    if p.id is not null then
      if p.recorded_by = auth.uid() and p.reverses_id = p_entry_id and p.reason = v_reason then
        return jsonb_build_object('entry_kind', p_entry_kind, 'id', p.id, 'reverses_id', p.reverses_id, 'amount_paisa', p.amount_paisa);
      end if;
      raise exception using errcode = '23505', message = 'client_id already used with different content';
    end if;
  end if;
  if v_reason is null or length(v_reason) not between 5 and 300 then
    raise exception using errcode = '22023', message = 'a reversal needs a reason of 5 to 300 characters';
  end if;

  if p_entry_kind = 'investment' then
    select * into m from public.investment x where x.id = p_entry_id;
    if m.id is null then raise exception using errcode = '22023', message = 'unknown investment'; end if;
    v_inv := m.investor_id;
  elsif p_entry_kind = 'profit_decision' then
    select * into d from public.investor_profit_decision x where x.id = p_entry_id;
    if d.id is null then raise exception using errcode = '22023', message = 'unknown profit decision'; end if;
    select x.investor_id into v_inv from public.investment x where x.id = d.investment_id;
  else
    select * into p from public.investor_payout x where x.id = p_entry_id;
    if p.id is null then raise exception using errcode = '22023', message = 'unknown payout'; end if;
    select x.investor_id into v_inv from public.investment x where x.id = p.investment_id;
  end if;
  perform app.investor_lock(v_inv);
  select i.status into v_status from public.investor i where i.id = v_inv;
  if v_status = 'closed' then
    raise exception using errcode = '55000', message = 'this investor is closed; reopen it first';
  end if;
  if coalesce(m.reverses_id, d.reverses_id, p.reverses_id) is not null then
    raise exception using errcode = '55000', message = 'a reversal cannot be reversed';
  end if;
  if (p_entry_kind = 'investment' and exists (select 1 from public.investment x where x.reverses_id = p_entry_id))
     or (p_entry_kind = 'profit_decision' and exists (select 1 from public.investor_profit_decision x where x.reverses_id = p_entry_id))
     or (p_entry_kind = 'payout' and exists (select 1 from public.investor_payout x where x.reverses_id = p_entry_id)) then
    raise exception using errcode = '55000', message = 'this entry is already reversed';
  end if;

  perform app.set_purpose('investor entry reversed: ' || v_reason);
  if p_entry_kind = 'investment' then
    select * into f from app.investment_figures(null) g where g.investment_id = m.id;
    if f.principal_returned_paisa <> 0 or f.profit_decided_paisa <> 0 or f.profit_paid_paisa <> 0 or f.profit_accrued_paisa <> 0 then
      raise exception using errcode = '23514',
        message = 'money was returned, decided, paid or accrued on this investment; reverse those entries first';
    end if;
    insert into public.investment (client_id, investor_id, amount_paisa, invested_on, reverses_id, reason, recorded_by)
    values (p_client_id, m.investor_id, -m.amount_paisa, v_today, m.id, v_reason, auth.uid())
    returning * into m;
    return jsonb_build_object('entry_kind', p_entry_kind, 'id', m.id, 'reverses_id', m.reverses_id, 'amount_paisa', m.amount_paisa);
  elsif p_entry_kind = 'profit_decision' then
    select * into f from app.investment_figures(null) g where g.investment_id = d.investment_id;
    if f.profit_accrued_paisa + f.profit_decided_paisa - d.amount_paisa < f.profit_paid_paisa then
      raise exception using errcode = '23514', message = format(
        'reversing this decision would leave the profit owed below what was paid on this investment (%s paisa paid)',
        f.profit_paid_paisa);
    end if;
    insert into public.investor_profit_decision (client_id, investment_id, amount_paisa, decided_on, reverses_id, reason, recorded_by)
    values (p_client_id, d.investment_id, -d.amount_paisa, v_today, d.id, v_reason, auth.uid())
    returning * into d;
    return jsonb_build_object('entry_kind', p_entry_kind, 'id', d.id, 'reverses_id', d.reverses_id, 'amount_paisa', d.amount_paisa);
  end if;
  insert into public.investor_payout (client_id, investment_id, kind, method, reference, amount_paisa, paid_on, reverses_id, reason, recorded_by)
  values (p_client_id, p.investment_id, p.kind, p.method, p.reference, -p.amount_paisa, v_today, p.id, v_reason, auth.uid())
  returning * into p;
  return jsonb_build_object('entry_kind', p_entry_kind, 'id', p.id, 'reverses_id', p.reverses_id, 'amount_paisa', p.amount_paisa);
end $$;

-- ------------------------------------------------------------------- reading --
-- Every investor with its derived figures (now including the accrued promised return),
-- then one totals row. Profit owed = accrued + decided - paid.
drop function if exists app.office_investors();
create function app.office_investors()
returns table (investor_id uuid, full_name text, phone text, status public.investor_status, is_total boolean,
               invested_paisa bigint, principal_returned_paisa bigint, principal_outstanding_paisa bigint,
               profit_decided_paisa bigint, profit_paid_paisa bigint, profit_accrued_paisa bigint, profit_owed_paisa bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform app.assert_office();
  return query
  with g as (
    select f.investor_id iid, sum(f.invested_paisa) inv, sum(f.principal_returned_paisa) ret,
           sum(f.profit_decided_paisa) dcd, sum(f.profit_paid_paisa) paid, sum(f.profit_accrued_paisa) acc
    from app.investment_figures(null) f group by f.investor_id),
  r as (
    select x.id, x.full_name, x.phone, x.status, coalesce(g.inv, 0)::bigint inv, coalesce(g.ret, 0)::bigint ret,
           coalesce(g.dcd, 0)::bigint dcd, coalesce(g.paid, 0)::bigint paid, coalesce(g.acc, 0)::bigint acc
    from public.investor x left join g on g.iid = x.id),
  u as (
    select r.id, r.full_name, r.phone, r.status, false tot, r.inv, r.ret, r.inv - r.ret out_p, r.dcd, r.paid, r.acc,
           r.acc + r.dcd - r.paid owed
    from r
    union all
    select null, null, null, null, true, coalesce(sum(r.inv), 0)::bigint, coalesce(sum(r.ret), 0)::bigint,
           coalesce(sum(r.inv - r.ret), 0)::bigint, coalesce(sum(r.dcd), 0)::bigint, coalesce(sum(r.paid), 0)::bigint,
           coalesce(sum(r.acc), 0)::bigint, coalesce(sum(r.acc + r.dcd - r.paid), 0)::bigint
    from r)
  select u.id, u.full_name, u.phone, u.status, u.tot, u.inv, u.ret, u.out_p, u.dcd, u.paid, u.acc, u.owed
  from u
  order by u.tot, lower(u.full_name), u.id;
end $$;

-- One investor's investments, each with its derived figures and return terms, oldest first.
drop function if exists app.office_investor_investments(uuid);
create function app.office_investor_investments(p_investor_id uuid)
returns table (investment_id uuid, invested_on date, note text, recorded_at timestamptz, reversed boolean,
               invested_paisa bigint, principal_returned_paisa bigint, principal_outstanding_paisa bigint,
               profit_decided_paisa bigint, profit_paid_paisa bigint, profit_accrued_paisa bigint, profit_owed_paisa bigint,
               return_pct numeric, return_period text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform app.assert_office();
  if not exists (select 1 from public.investor x where x.id = p_investor_id) then
    raise exception using errcode = '22023', message = 'unknown investor';
  end if;
  return query
  select f.investment_id, f.invested_on, f.note, f.recorded_at, f.reversed, f.invested_paisa, f.principal_returned_paisa,
         f.invested_paisa - f.principal_returned_paisa, f.profit_decided_paisa, f.profit_paid_paisa, f.profit_accrued_paisa,
         f.profit_accrued_paisa + f.profit_decided_paisa - f.profit_paid_paisa, f.return_pct, f.return_period
  from app.investment_figures(p_investor_id) f
  order by f.invested_on, f.recorded_at, f.investment_id;
end $$;

-- One investor's statement: every row in date order with running balances. The running
-- profit owed now includes the promised return accrued as of each row's date, so the
-- last row's owed matches the live figure when the last row is today. Return type is
-- unchanged, so this replaces in place.
create or replace function app.office_investor_statement(p_investor_id uuid, p_from date default null, p_to date default null)
returns table (entry_kind text, entry_id uuid, investment_id uuid, entry_on date, payout_kind public.investor_payout_kind,
               method public.investor_payout_method, reference text, amount_paisa bigint, note text, reason text,
               reverses_id uuid, reversed boolean, recorded_by_name text, recorded_at timestamptz,
               principal_outstanding_paisa bigint, profit_owed_paisa bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform app.assert_office();
  if not exists (select 1 from public.investor x where x.id = p_investor_id) then
    raise exception using errcode = '22023', message = 'unknown investor';
  end if;
  if p_from > p_to then
    raise exception using errcode = '22023', message = 'the statement''s start date is after its end date';
  end if;
  return query
  with e as (
    select 'investment'::text k, 1 rnk, i.id eid, i.id inv, i.invested_on d, null::public.investor_payout_kind pk,
           null::public.investor_payout_method pm, null::text ref, i.amount_paisa amt, i.note nt, i.reason rs,
           i.reverses_id rev, exists (select 1 from public.investment x where x.reverses_id = i.id) was_rev,
           i.recorded_by who, i.created_at ts, i.amount_paisa dp, 0::bigint dow
    from public.investment i where i.investor_id = p_investor_id
    union all
    select 'profit_decision', 2, dd.id, dd.investment_id, dd.decided_on, null, null, null, dd.amount_paisa, dd.note, dd.reason,
           dd.reverses_id, exists (select 1 from public.investor_profit_decision x where x.reverses_id = dd.id),
           dd.recorded_by, dd.created_at, 0::bigint, dd.amount_paisa
    from public.investor_profit_decision dd join public.investment i on i.id = dd.investment_id
    where i.investor_id = p_investor_id
    union all
    select 'payout', 3, pp.id, pp.investment_id, pp.paid_on, pp.kind, pp.method, pp.reference, pp.amount_paisa, pp.note, pp.reason,
           pp.reverses_id, exists (select 1 from public.investor_payout x where x.reverses_id = pp.id),
           pp.recorded_by, pp.created_at,
           case when pp.kind = 'principal' then -pp.amount_paisa else 0::bigint end,
           case when pp.kind = 'profit' then -pp.amount_paisa else 0::bigint end
    from public.investor_payout pp join public.investment i on i.id = pp.investment_id
    where i.investor_id = p_investor_id),
  r as (
    select e.*, sum(e.dp) over w run_p, sum(e.dow) over w run_o
    from e
    window w as (order by e.d, e.rnk, e.ts, e.eid rows between unbounded preceding and current row))
  select r.k, r.eid, r.inv, r.d, r.pk, r.pm, r.ref, r.amt, r.nt, r.rs, r.rev, r.was_rev, u.full_name, r.ts,
         r.run_p::bigint,
         (r.run_o + (
           select coalesce(sum(app.investor_accrued_return(i.amount_paisa, i.return_pct, i.return_period, i.invested_on, r.d)), 0)::bigint
           from public.investment i
           where i.investor_id = p_investor_id and i.reverses_id is null
             and not exists (select 1 from public.investment rr where rr.reverses_id = i.id)
         ))::bigint
  from r left join public.user_profile u on u.id = r.who
  where (p_from is null or r.d >= p_from) and (p_to is null or r.d <= p_to)
  order by r.d, r.rnk, r.ts, r.eid;
end $$;

-- ----------------------------------------------------------------- privileges --
revoke execute on function app.investor_accrued_return(bigint, numeric, public.investor_return_period, date, date)
  from public, anon, authenticated, service_role;

revoke all on function app.investment_figures(uuid), app.office_investors(), app.office_investor_investments(uuid),
  app.office_add_investment(uuid, uuid, bigint, date, text, numeric, text)
  from public, anon, authenticated, service_role;
grant execute on function app.office_investors(), app.office_investor_investments(uuid),
  app.office_add_investment(uuid, uuid, bigint, date, text, numeric, text) to authenticated;
