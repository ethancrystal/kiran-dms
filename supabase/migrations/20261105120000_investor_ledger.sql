-- =============================================================================
-- Kiran DMS · migration 20261105120000 · Basic investor ledger
-- Completion slice 3 (P1-20). Requirements: CAP-01, CAP-02, CAP-03; D-24, D-40, D-41; spec 2026-11-05
-- sections 2 to 4 and 7; docs/16-project-completion-goal.md (MJ: how much each investor gets "will be
-- decided by manager/owner"; "no automated investor profit-calculation or distribution engine").
--
-- What is built, office only (owner or manager at AAL2, app.assert_office):
--   * public.investor: a person who put money in. Name, optional phone and note, status active or
--     closed. client_id is unique per creator, and app.office_create_investor replays by it. The row is
--     never deleted; its name, phone, note and status change through app.office_update_investor.
--   * public.investment, public.investor_profit_decision, public.investor_payout: append-only. A
--     profit decision is an amount the office types; nothing calculates it. A payout is of profit or
--     of principal, by cash, bank or other, with an optional reference (required for bank). A mistake
--     is corrected by a reversal row in the same table: reverses_id names the row, the amount is its
--     exact negative, the reason (5 to 300 characters) is required, and the date is the server's
--     Karachi day. A reversal is never reversed, and a row is reversed once (unique reverses_id).
--   * Figures are always derived from the rows, never stored (H-10): per investment and per investor,
--     invested, principal returned, principal outstanding (invested minus returned), profit decided,
--     profit paid and profit owed (decided minus paid); app.office_investors adds one totals row over
--     every investor. app.office_investor_statement lists an investor's rows in date order with running
--     balances worked out over the whole history, then filtered to the dates asked for.
--   * Nothing here writes cash_ledger_entry, payment, receipt, invoice, sales_order or any commission
--     figure (CAP-03): investor money is a separate ledger.
--
-- Rules (the safest reading; none invents a business rule, see the TASK entry for the rulings):
--   * Profit payouts never exceed decided minus paid, and principal payouts never exceed invested minus
--     returned, per investment (23514, the repo's code for an amount over its limit, as in payments).
--   * A reversal never leaves a negative figure: a decision is not reversed below what was paid on its
--     investment; an investment is reversed only while nothing was returned, decided or paid on it
--     (23514). A reversed investment takes nothing new (55000).
--   * A closed investor takes nothing new, reversals included (55000); closing needs nothing
--     outstanding (principal and profit owed both zero; 55000). The office may reopen an investor.
--   * Dates are not in the future (Karachi), and a decision or payout is not dated before its
--     investment (22023). A profit payout may still be dated before the decision it pays, so a
--     statement's running profit owed can dip below zero between two rows; the totals cannot.
--   * Amounts are whole paisa from 1 to 99,999,999,999 (the largest lib/money.ts toPaisa makes).
-- Errors: 42501 wrong role or session; 22023 bad input or an unknown reference; 55000 wrong state;
-- 23505 a client_id replayed with other facts; 23514 an amount over its limit.
--
-- Locks (the repo's order, all before the first audited write, because control.audit_row holds the
-- audit chain head until commit): the client_id key, then the replay lookup, then the investor's key
-- 'investor:' || id, which covers all of its investments and its closing, so two payouts on one
-- investment, or a payout and a close, take turns and the second sees the first's committed rows.
-- A replay is checked before any state, so a lost-answer retry still gets the first result after a
-- close or a reversal. Investor rows can be edited, so a create replayed after an edit is 23505.
-- =============================================================================

-- ------------------------------------------------------------------ types ----
create type public.investor_status        as enum ('active', 'closed');
create type public.investor_payout_kind   as enum ('profit', 'principal');
create type public.investor_payout_method as enum ('cash', 'bank', 'other');

-- ------------------------------------------------------------------ tables ----
create table public.investor (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null,                                            -- idempotency key from the page (H-08)
  full_name  text not null check (length(full_name) between 2 and 120),
  phone      text check (phone ~ '^\+?[0-9]{10,15}$'),
  note       text check (length(note) <= 500),
  status     public.investor_status not null default 'active',
  created_by uuid not null references public.user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint investor_client_once unique (created_by, client_id)
);
create index investor_name_idx on public.investor (lower(full_name));
comment on table public.investor is
  'D-40, CAP-01. A person who invested with Kiran. Office only; no investor login. Never deleted; name, phone, note and status change through app.office_update_investor.';

create table public.investment (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null unique,                                  -- idempotency key from the page (H-08)
  investor_id uuid not null references public.investor (id),
  amount_paisa bigint not null,
  invested_on date not null,
  note        text check (length(note) <= 500),
  reverses_id uuid unique references public.investment (id),         -- a row is reversed once
  reason      text,
  recorded_by uuid not null references public.user_profile (id),
  created_at  timestamptz not null default now(),
  constraint investment_shape check (
    (reverses_id is null and amount_paisa between 1 and 99999999999 and reason is null)
    or (reverses_id is not null and amount_paisa between -99999999999 and -1 and coalesce(length(btrim(reason)), 0) between 5 and 300))
);
create index investment_investor_idx on public.investment (investor_id, invested_on);
comment on table public.investment is
  'D-40, CAP-01. Append-only. Money an investor put in, in paisa. A reversal row (reverses_id, the exact negative, a reason) corrects a mistake.';

create table public.investor_profit_decision (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null unique,                                -- idempotency key from the page (H-08)
  investment_id uuid not null references public.investment (id),
  amount_paisa  bigint not null,
  decided_on    date not null,
  note          text check (length(note) <= 500),
  reverses_id   uuid unique references public.investor_profit_decision (id),
  reason        text,
  recorded_by   uuid not null references public.user_profile (id),
  created_at    timestamptz not null default now(),
  constraint investor_profit_decision_shape check (
    (reverses_id is null and amount_paisa between 1 and 99999999999 and reason is null)
    or (reverses_id is not null and amount_paisa between -99999999999 and -1 and coalesce(length(btrim(reason)), 0) between 5 and 300))
);
create index investor_profit_decision_investment_idx on public.investor_profit_decision (investment_id);
comment on table public.investor_profit_decision is
  'D-40, CAP-02. Append-only. A profit amount the owner or manager decided for one investment, typed by hand; no formula, no split, no promised return.';

create table public.investor_payout (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null unique,                                -- idempotency key from the page (H-08)
  investment_id uuid not null references public.investment (id),
  kind          public.investor_payout_kind not null,
  method        public.investor_payout_method not null,
  reference     text check (length(reference) <= 120),
  amount_paisa  bigint not null,
  paid_on       date not null,
  note          text check (length(note) <= 500),
  reverses_id   uuid unique references public.investor_payout (id),
  reason        text,
  recorded_by   uuid not null references public.user_profile (id),
  created_at    timestamptz not null default now(),
  constraint investor_payout_shape check (
    (reverses_id is null and amount_paisa between 1 and 99999999999 and reason is null)
    or (reverses_id is not null and amount_paisa between -99999999999 and -1 and coalesce(length(btrim(reason)), 0) between 5 and 300))
);
create index investor_payout_investment_idx on public.investor_payout (investment_id, kind);
comment on table public.investor_payout is
  'D-40, CAP-02, CAP-03. Append-only. Profit or principal paid back to an investor for one investment. Not posted to the cash ledger.';

-- ------------------------------------------------------------------- guards ----
-- The investor's identity is fixed and it is never deleted (H-07); updated_at is the database's.
create function control.investor_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'investors are closed, never deleted (H-07)';
  end if;
  if (new.id, new.client_id, new.created_by, new.created_at) is distinct from (old.id, old.client_id, old.created_by, old.created_at) then
    raise exception using errcode = '42501', message = 'an investor''s identity is immutable';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- A reversal row must be the exact negative of an original row with the same parent (and, for a
-- payout, the same kind and method). The functions check this first with clearer words; these
-- guards hold for any writer, the table owner included.
create function control.investment_reversal_guard() returns trigger
language plpgsql set search_path = '' as $$
declare t public.investment;
begin
  if new.reverses_id is not null then
    select * into t from public.investment x where x.id = new.reverses_id;
    if t.reverses_id is not null or t.investor_id is distinct from new.investor_id or new.amount_paisa <> -t.amount_paisa then
      raise exception using errcode = '42501', message = 'a reversal is the exact negative of an original row of the same investor';
    end if;
  end if;
  return new;
end $$;

create function control.investor_profit_decision_reversal_guard() returns trigger
language plpgsql set search_path = '' as $$
declare t public.investor_profit_decision;
begin
  if new.reverses_id is not null then
    select * into t from public.investor_profit_decision x where x.id = new.reverses_id;
    if t.reverses_id is not null or t.investment_id is distinct from new.investment_id or new.amount_paisa <> -t.amount_paisa then
      raise exception using errcode = '42501', message = 'a reversal is the exact negative of an original decision on the same investment';
    end if;
  end if;
  return new;
end $$;

create function control.investor_payout_reversal_guard() returns trigger
language plpgsql set search_path = '' as $$
declare t public.investor_payout;
begin
  if new.reverses_id is not null then
    select * into t from public.investor_payout x where x.id = new.reverses_id;
    if t.reverses_id is not null or t.investment_id is distinct from new.investment_id or t.kind is distinct from new.kind
       or t.method is distinct from new.method or new.amount_paisa <> -t.amount_paisa then
      raise exception using errcode = '42501', message = 'a reversal is the exact negative of an original payout on the same investment';
    end if;
  end if;
  return new;
end $$;

create trigger investor_guard before update or delete on public.investor
  for each row execute function control.investor_guard();
create trigger reversal_guard before insert on public.investment
  for each row execute function control.investment_reversal_guard();
create trigger reversal_guard before insert on public.investor_profit_decision
  for each row execute function control.investor_profit_decision_reversal_guard();
create trigger reversal_guard before insert on public.investor_payout
  for each row execute function control.investor_payout_reversal_guard();
create trigger append_only before update or delete on public.investment               for each row execute function control.forbid_mutation();
create trigger append_only before update or delete on public.investor_profit_decision for each row execute function control.forbid_mutation();
create trigger append_only before update or delete on public.investor_payout          for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.investor                 for each statement execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.investment               for each statement execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.investor_profit_decision for each statement execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.investor_payout          for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on public.investor                 for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.investment               for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.investor_profit_decision for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.investor_payout          for each row execute function control.audit_row();

-- ---------------------------------------------------------------------- RLS -----
alter table public.investor                 enable row level security;
alter table public.investor                 force  row level security;
alter table public.investment               enable row level security;
alter table public.investment               force  row level security;
alter table public.investor_profit_decision enable row level security;
alter table public.investor_profit_decision force  row level security;
alter table public.investor_payout          enable row level security;
alter table public.investor_payout          force  row level security;

-- The office reads all four; nobody else reads any row (D-40: no investor login; reps see nothing).
create policy investor_select on public.investor for select to authenticated
  using ((select app.is_office()));
create policy investment_select on public.investment for select to authenticated
  using ((select app.is_office()));
create policy investor_profit_decision_select on public.investor_profit_decision for select to authenticated
  using ((select app.is_office()));
create policy investor_payout_select on public.investor_payout for select to authenticated
  using ((select app.is_office()));

-- ----------------------------------------------------------------- privileges ----
-- No API write grant: every write goes through the app.* functions below (H-08).
revoke all on public.investor, public.investment, public.investor_profit_decision, public.investor_payout
  from public, anon, authenticated, service_role;
grant select on public.investor, public.investment, public.investor_profit_decision, public.investor_payout
  to authenticated, service_role;
revoke execute on function control.investor_guard(), control.investment_reversal_guard(),
  control.investor_profit_decision_reversal_guard(), control.investor_payout_reversal_guard()
  from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------- helpers ----
-- Internal (no grant). An amount of whole paisa, 1 to 99,999,999,999.
create function app.investor_assert_amount(p_amount_paisa bigint) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_amount_paisa is null or p_amount_paisa not between 1 and 99999999999 then
    raise exception using errcode = '22023', message = 'an amount is 1 to 99,999,999,999 paisa (up to Rs 999,999,999.99)';
  end if;
end $$;

-- Internal (no grant). A date that is given and not in the future, Karachi time.
create function app.investor_assert_date(p_on date, p_what text) returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_on is null then
    raise exception using errcode = '22023', message = format('%s needs a date', p_what);
  end if;
  if p_on > app.karachi_today() then
    raise exception using errcode = '22023', message = format('%s cannot be dated in the future (Karachi time)', p_what);
  end if;
end $$;

-- Internal (no grant). A note of at most 500 characters.
create function app.investor_assert_note(p_note text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if length(p_note) > 500 then
    raise exception using errcode = '22023', message = 'a note is at most 500 characters';
  end if;
end $$;

-- Internal (no grant). A name of 2 to 120 characters and an optional phone of 10 to 15 digits.
create function app.investor_assert_details(p_name text, p_phone text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_name is null or length(p_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'an investor needs a name of 2 to 120 characters';
  end if;
  if p_phone is not null and p_phone !~ '^\+?[0-9]{10,15}$' then
    raise exception using errcode = '22023', message = 'a phone is 10 to 15 digits, with an optional leading +';
  end if;
end $$;

-- Internal (no grant). The figures of each original investment, derived from the rows (H-10). A
-- reversal row is not an investment of its own: it nets its original to zero, which reads reversed.
create function app.investment_figures(p_investor_id uuid)
returns table (investment_id uuid, investor_id uuid, invested_on date, note text, recorded_at timestamptz, reversed boolean,
               invested_paisa bigint, principal_returned_paisa bigint, profit_decided_paisa bigint, profit_paid_paisa bigint)
language sql stable security definer set search_path = '' as $$
  select i.id, i.investor_id, i.invested_on, i.note, i.created_at,
         exists (select 1 from public.investment r where r.reverses_id = i.id),
         (i.amount_paisa + coalesce((select sum(r.amount_paisa) from public.investment r where r.reverses_id = i.id), 0))::bigint,
         coalesce((select sum(p.amount_paisa) from public.investor_payout p where p.investment_id = i.id and p.kind = 'principal'), 0)::bigint,
         coalesce((select sum(d.amount_paisa) from public.investor_profit_decision d where d.investment_id = i.id), 0)::bigint,
         coalesce((select sum(p.amount_paisa) from public.investor_payout p where p.investment_id = i.id and p.kind = 'profit'), 0)::bigint
  from public.investment i
  where i.reverses_id is null and (p_investor_id is null or i.investor_id = p_investor_id)
$$;

-- Internal (no grant). Takes the investor's key: one money write, close or edit per investor at a time.
create function app.investor_lock(p_investor_id uuid) returns void
language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('investor:' || p_investor_id::text, 0))
$$;

-- Internal (no grant). Takes the key of one client_id of a ledger row: two sessions with the same key
-- take turns, and the second sees the first's committed row as a replay (H-08).
create function app.investor_entry_lock(p_client_id uuid) returns void
language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('investor-entry:' || p_client_id::text, 0))
$$;

-- ------------------------------------------------------------------ investors ----
-- CAP-01: the owner or a manager adds an investor. client_id is unique per creator: the same person's
-- replay returns the first row; the same key with other facts is 23505.
create function app.office_create_investor(p_client_id uuid, p_full_name text, p_phone text default null, p_note text default null)
returns public.investor
language plpgsql security definer set search_path = '' as $$
declare
  v_role  public.app_role := app.assert_office();
  v_name  text := app.blank_to_null(p_full_name);
  v_phone text := app.blank_to_null(p_phone);
  v_note  text := app.blank_to_null(p_note);
  x       public.investor;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'an investor needs a client_id (idempotency key, H-08)';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('investor-create:' || auth.uid()::text || ':' || p_client_id::text, 0));
  select * into x from public.investor i where i.created_by = auth.uid() and i.client_id = p_client_id;
  if x.id is not null then
    if x.full_name = v_name and x.phone is not distinct from v_phone and x.note is not distinct from v_note then
      return x;                                                                -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  perform app.investor_assert_details(v_name, v_phone);
  perform app.investor_assert_note(v_note);
  perform app.set_purpose('investor added');
  insert into public.investor (client_id, full_name, phone, note, created_by)
  values (p_client_id, v_name, v_phone, v_note, auth.uid())
  returning * into x;
  return x;
end $$;

-- The owner or a manager changes an investor's name, phone, note or status. Closing needs nothing
-- outstanding on any of its investments; reopening is allowed. The same values again write nothing.
create function app.office_update_investor(
  p_investor_id uuid, p_full_name text, p_phone text, p_note text, p_status text)
returns public.investor
language plpgsql security definer set search_path = '' as $$
declare
  v_role  public.app_role := app.assert_office();
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
       where f.invested_paisa <> f.principal_returned_paisa or f.profit_decided_paisa <> f.profit_paid_paisa) then
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

-- ---------------------------------------------------------------- the ledger ----
-- CAP-01: money an investor put in.
create function app.office_add_investment(
  p_client_id uuid, p_investor_id uuid, p_amount_paisa bigint, p_invested_on date, p_note text default null)
returns public.investment
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_office();
  v_note text := app.blank_to_null(p_note);
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
       and m.invested_on = p_invested_on and m.note is not distinct from v_note then
      return m;                                                                -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  perform app.investor_assert_amount(p_amount_paisa);
  perform app.investor_assert_date(p_invested_on, 'an investment');
  perform app.investor_assert_note(v_note);
  if p_investor_id is null then raise exception using errcode = '22023', message = 'unknown investor'; end if;
  perform app.investor_lock(p_investor_id);
  select i.status into v_status from public.investor i where i.id = p_investor_id;
  if not found then raise exception using errcode = '22023', message = 'unknown investor'; end if;
  if v_status = 'closed' then
    raise exception using errcode = '55000', message = 'this investor is closed; reopen it first';
  end if;
  perform app.set_purpose('investment recorded');
  insert into public.investment (client_id, investor_id, amount_paisa, invested_on, note, recorded_by)
  values (p_client_id, p_investor_id, p_amount_paisa, p_invested_on, v_note, auth.uid())
  returning * into m;
  return m;
end $$;

-- Internal (no grant). The original investment a decision or payout is for, after taking its
-- investor's key; refuses an unknown or reversed investment, a closed investor, and a date before
-- the investment.
create function app.investor_open_investment(p_investment_id uuid, p_on date, p_what text) returns public.investment
language plpgsql security definer set search_path = '' as $$
declare
  m        public.investment;
  v_status public.investor_status;
begin
  select * into m from public.investment x where x.id = p_investment_id and x.reverses_id is null;
  if m.id is null then raise exception using errcode = '22023', message = 'unknown investment'; end if;
  perform app.investor_lock(m.investor_id);
  select i.status into v_status from public.investor i where i.id = m.investor_id;
  if v_status = 'closed' then
    raise exception using errcode = '55000', message = 'this investor is closed; reopen it first';
  end if;
  if exists (select 1 from public.investment r where r.reverses_id = m.id) then
    raise exception using errcode = '55000', message = 'this investment was reversed; nothing more is recorded on it';
  end if;
  if p_on < m.invested_on then
    raise exception using errcode = '22023', message = format('%s cannot be dated before the investment (%s)', p_what, m.invested_on);
  end if;
  return m;
end $$;

-- CAP-02: the owner or a manager types a profit amount for one investment. Nothing calculates it.
create function app.office_decide_profit(
  p_client_id uuid, p_investment_id uuid, p_amount_paisa bigint, p_decided_on date, p_note text default null)
returns public.investor_profit_decision
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_office();
  v_note text := app.blank_to_null(p_note);
  d      public.investor_profit_decision;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a profit decision needs a client_id (idempotency key, H-08)';
  end if;
  perform app.investor_entry_lock(p_client_id);
  select * into d from public.investor_profit_decision x where x.client_id = p_client_id;
  if d.id is not null then
    if d.recorded_by = auth.uid() and d.reverses_id is null and d.investment_id = p_investment_id
       and d.amount_paisa = p_amount_paisa and d.decided_on = p_decided_on and d.note is not distinct from v_note then
      return d;                                                                -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  perform app.investor_assert_amount(p_amount_paisa);
  perform app.investor_assert_date(p_decided_on, 'a profit decision');
  perform app.investor_assert_note(v_note);
  perform app.investor_open_investment(p_investment_id, p_decided_on, 'a profit decision');
  perform app.set_purpose('investor profit decided');
  insert into public.investor_profit_decision (client_id, investment_id, amount_paisa, decided_on, note, recorded_by)
  values (p_client_id, p_investment_id, p_amount_paisa, p_decided_on, v_note, auth.uid())
  returning * into d;
  return d;
end $$;

-- CAP-02, CAP-03: profit or principal paid back on one investment, never more than is owed or
-- outstanding on it. Recorded here only: nothing is posted to the cash ledger.
create function app.office_record_payout(
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
  select case when p_kind = 'profit' then f.profit_decided_paisa - f.profit_paid_paisa
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

-- CAP-02: a mistake is corrected by a reversal row with a reason, dated by the server (Karachi). An
-- entry is reversed once, a reversal never, and no figure goes below zero (see the header).
create function app.office_reverse_investor_entry(p_client_id uuid, p_entry_kind text, p_entry_id uuid, p_reason text)
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
  -- Replay: the same person reversing the same entry with the same reason gets the first reversal row.
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

  -- The entry, its investor's key, then the state.
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
    if f.principal_returned_paisa <> 0 or f.profit_decided_paisa <> 0 or f.profit_paid_paisa <> 0 then
      raise exception using errcode = '23514',
        message = 'money was returned, decided or paid on this investment; reverse those entries first';
    end if;
    insert into public.investment (client_id, investor_id, amount_paisa, invested_on, reverses_id, reason, recorded_by)
    values (p_client_id, m.investor_id, -m.amount_paisa, v_today, m.id, v_reason, auth.uid())
    returning * into m;
    return jsonb_build_object('entry_kind', p_entry_kind, 'id', m.id, 'reverses_id', m.reverses_id, 'amount_paisa', m.amount_paisa);
  elsif p_entry_kind = 'profit_decision' then
    select * into f from app.investment_figures(null) g where g.investment_id = d.investment_id;
    if f.profit_decided_paisa - d.amount_paisa < f.profit_paid_paisa then
      raise exception using errcode = '23514', message = format(
        'reversing this decision would leave the profit decided below what was paid on this investment (%s paisa paid)',
        f.profit_paid_paisa);
    end if;
    insert into public.investor_profit_decision (client_id, investment_id, amount_paisa, decided_on, reverses_id, reason, recorded_by)
    values (p_client_id, d.investment_id, -d.amount_paisa, v_today, d.id, v_reason, auth.uid())
    returning * into d;
    return jsonb_build_object('entry_kind', p_entry_kind, 'id', d.id, 'reverses_id', d.reverses_id, 'amount_paisa', d.amount_paisa);
  end if;
  -- A payout's reversal only raises what is owed or outstanding, so it never goes below zero.
  insert into public.investor_payout (client_id, investment_id, kind, method, reference, amount_paisa, paid_on, reverses_id, reason, recorded_by)
  values (p_client_id, p.investment_id, p.kind, p.method, p.reference, -p.amount_paisa, v_today, p.id, v_reason, auth.uid())
  returning * into p;
  return jsonb_build_object('entry_kind', p_entry_kind, 'id', p.id, 'reverses_id', p.reverses_id, 'amount_paisa', p.amount_paisa);
end $$;

-- ------------------------------------------------------------------- reading ----
-- Every investor with its derived figures, then one totals row over all investors (is_total, no id
-- and no name). Investors by name.
create function app.office_investors()
returns table (investor_id uuid, full_name text, phone text, status public.investor_status, is_total boolean,
               invested_paisa bigint, principal_returned_paisa bigint, principal_outstanding_paisa bigint,
               profit_decided_paisa bigint, profit_paid_paisa bigint, profit_owed_paisa bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform app.assert_office();
  return query
  with g as (
    select f.investor_id iid, sum(f.invested_paisa) inv, sum(f.principal_returned_paisa) ret,
           sum(f.profit_decided_paisa) dcd, sum(f.profit_paid_paisa) paid
    from app.investment_figures(null) f group by f.investor_id),
  r as (
    select x.id, x.full_name, x.phone, x.status, coalesce(g.inv, 0)::bigint inv, coalesce(g.ret, 0)::bigint ret,
           coalesce(g.dcd, 0)::bigint dcd, coalesce(g.paid, 0)::bigint paid
    from public.investor x left join g on g.iid = x.id),
  u as (
    select r.id, r.full_name, r.phone, r.status, false tot, r.inv, r.ret, r.inv - r.ret out_p, r.dcd, r.paid, r.dcd - r.paid owed
    from r
    union all
    select null, null, null, null, true, coalesce(sum(r.inv), 0)::bigint, coalesce(sum(r.ret), 0)::bigint,
           coalesce(sum(r.inv - r.ret), 0)::bigint, coalesce(sum(r.dcd), 0)::bigint, coalesce(sum(r.paid), 0)::bigint,
           coalesce(sum(r.dcd - r.paid), 0)::bigint
    from r)
  select u.id, u.full_name, u.phone, u.status, u.tot, u.inv, u.ret, u.out_p, u.dcd, u.paid, u.owed
  from u
  order by u.tot, lower(u.full_name), u.id;
end $$;

-- One investor's investments, each with its derived figures, oldest first.
create function app.office_investor_investments(p_investor_id uuid)
returns table (investment_id uuid, invested_on date, note text, recorded_at timestamptz, reversed boolean,
               invested_paisa bigint, principal_returned_paisa bigint, principal_outstanding_paisa bigint,
               profit_decided_paisa bigint, profit_paid_paisa bigint, profit_owed_paisa bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform app.assert_office();
  if not exists (select 1 from public.investor x where x.id = p_investor_id) then
    raise exception using errcode = '22023', message = 'unknown investor';
  end if;
  return query
  select f.investment_id, f.invested_on, f.note, f.recorded_at, f.reversed, f.invested_paisa, f.principal_returned_paisa,
         f.invested_paisa - f.principal_returned_paisa, f.profit_decided_paisa, f.profit_paid_paisa,
         f.profit_decided_paisa - f.profit_paid_paisa
  from app.investment_figures(p_investor_id) f
  order by f.invested_on, f.recorded_at, f.investment_id;
end $$;

-- One investor's statement: every row of the three ledgers in date order (on one day: investments,
-- then decisions, then payouts), with the principal outstanding and the profit owed after each row.
-- The running figures are worked out over the whole history, then the rows are filtered to the dates
-- asked for (either end may be null), so a range starts from the true balances. Derived, never stored.
create function app.office_investor_statement(p_investor_id uuid, p_from date default null, p_to date default null)
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
         r.run_p::bigint, r.run_o::bigint
  from r left join public.user_profile u on u.id = r.who
  where (p_from is null or r.d >= p_from) and (p_to is null or r.d <= p_to)
  order by r.d, r.rnk, r.ts, r.eid;
end $$;

-- ----------------------------------------------------------------- function privileges ----
-- Internal helpers: no grant to any role.
revoke execute on function
  app.investor_assert_amount(bigint), app.investor_assert_date(date, text), app.investor_assert_note(text),
  app.investor_assert_details(text, text), app.investment_figures(uuid), app.investor_lock(uuid),
  app.investor_entry_lock(uuid), app.investor_open_investment(uuid, date, text)
  from public, anon, authenticated, service_role;

revoke all on function
  app.office_create_investor(uuid, text, text, text), app.office_update_investor(uuid, text, text, text, text),
  app.office_add_investment(uuid, uuid, bigint, date, text), app.office_decide_profit(uuid, uuid, bigint, date, text),
  app.office_record_payout(uuid, uuid, text, text, bigint, date, text, text),
  app.office_reverse_investor_entry(uuid, text, uuid, text), app.office_investors(),
  app.office_investor_investments(uuid), app.office_investor_statement(uuid, date, date)
  from public, anon, authenticated, service_role;
grant execute on function
  app.office_create_investor(uuid, text, text, text), app.office_update_investor(uuid, text, text, text, text),
  app.office_add_investment(uuid, uuid, bigint, date, text), app.office_decide_profit(uuid, uuid, bigint, date, text),
  app.office_record_payout(uuid, uuid, text, text, bigint, date, text, text),
  app.office_reverse_investor_entry(uuid, text, uuid, text), app.office_investors(),
  app.office_investor_investments(uuid), app.office_investor_statement(uuid, date, date)
  to authenticated;
