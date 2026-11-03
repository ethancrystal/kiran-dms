-- =============================================================================
-- Kiran DMS · migration 0021 · Money in (task P1-07, part a)
-- Requirements: PAY-01 (each delivered order gets its installment schedule), PAY-02 (record a
--               payment against installments: cash or bank transfer), PAY-03 (a numbered receipt
--               per payment; sending it is the SMS adapter's job, B-08), PAY-04 (the rep's
--               cash-in-hand ledger), PAY-10 (payments are append-only), PAY-11 (partial and
--               early payment, oldest-first), CTL-01 (the receipt is issued by the system),
--               CTL-02 (payments carry GPS and server time; far or late ones are flagged).
-- Docs: 04 (installment, payment, payment_allocation, receipt, cash_ledger_entry), 09 sections
--       1, 3, 4, 5 and 8, 13 (R1 to R4, M14, detectors D-01 and D-02), 06 section 2 (who logs
--       payments), ACTIVITY A-11 (rounding), A-12 (template validity), B-37 (payment actor-scope blocker).
--
-- What is built: the installment rows are written by a trigger when an invoice is issued, from
-- app.plan_schedule, so a later change to the plan template never moves an issued invoice's
-- schedule. A payment is recorded by a rep at the salon (open day, approved device, own
-- territories, GPS) or, as a flagged on-behalf bank transfer, by the office. It is allocated
-- oldest due first across all of the salon's invoices in the same transaction, gets a receipt
-- number from app.next_doc_number('R') (gapless per financial year, H-11), and a cash payment
-- adds an `in` row to the rep's cash ledger. Balances are sums of rows (H-10): nothing here is
-- an editable running figure.
--
-- What is not built (see docs/09-payments-credit-installments.md §3 and B-37): payment reversal (an approval consumer, waits for
-- KIR-14 and the approval registry of D-25), collection outside the rep's territory (needs a
-- pre-approval), advances above what is owed, the two-party handover and the intraday cash cap,
-- bank deposits, the ageing report, sending receipts, and replacing the credit exposure rule.
-- =============================================================================

-- ------------------------------------------------------------------- config -----
-- No new setting: CTL-02's thresholds are the owner-editable keys payment.geofence_m (metres, 300)
-- and payment.max_minutes_after_arrival (minutes, 120) that the foundation migration seeded as
-- [default-unconfirmed]. Their values are JSON numbers; app.config_number reads them, and a value
-- that is missing or not a number refuses the payment (fail closed).

-- ------------------------------------------------------------------- tables ----
create type public.pay_method as enum ('cash', 'bank_transfer');

-- Fixed at invoice issue (doc 04). Immutable: what has been paid and the status are derived.
create table public.installment (
  id               uuid primary key default gen_random_uuid(),
  invoice_id       uuid not null references public.invoice (id),
  salon_id         uuid not null references public.salon (id),
  seq              integer not null check (seq >= 1),
  of_count         integer not null check (of_count >= seq),
  pct_of_total     numeric not null check (pct_of_total > 0 and pct_of_total <= 100),   -- the template's percentage, frozen with the row
  due_on           date not null,
  amount_due_paisa bigint not null check (amount_due_paisa >= 0),
  unique (invoice_id, seq)
);
create index installment_salon_due_idx on public.installment (salon_id, due_on);
comment on table public.installment is
  'PAY-01. Append-only; written by the invoice trigger from app.plan_schedule (A-11). Paid amount and status are derived from payment_allocation (H-10).';

create table public.payment (
  id                 uuid primary key default gen_random_uuid(),
  seq                bigint generated always as identity,        -- insertion order, for as-of reads
  client_id          uuid not null unique,                       -- idempotency key (H-08)
  salon_id           uuid not null references public.salon (id),
  recorded_by        uuid not null references public.user_profile (id),
  recorded_by_role   public.app_role not null,
  rep_day_id         uuid references public.rep_day (id),         -- the rep's open day; null for the office
  visit_id           uuid references public.visit (id),           -- the rep's latest visit to this salon that day, if any
  method             public.pay_method not null,
  amount_paisa       bigint not null check (amount_paisa > 0),
  bank_name          text check (bank_name is null or length(btrim(bank_name)) between 2 and 60),
  bank_reference     text check (bank_reference is null or length(btrim(bank_reference)) between 3 and 60),
  lat                numeric(9, 6) check (lat between -90 and 90),
  lng                numeric(9, 6) check (lng between -180 and 180),
  distance_from_pin_m integer check (distance_from_pin_m >= 0),
  mock_location      boolean not null default false,
  flags              jsonb not null default '[]'::jsonb check (jsonb_typeof(flags) = 'array'),
  recorded_at        timestamptz not null default clock_timestamp(),  -- server time (H-09), taken at the insert, under the salon lock
  recorded_at_client timestamptz,                                  -- evidence only
  constraint payment_geo_pair check ((lat is null) = (lng is null)),
  constraint payment_bank_fields check (
    (method = 'bank_transfer' and bank_name is not null and bank_reference is not null)
    or (method = 'cash' and bank_name is null and bank_reference is null)),
  -- A rep records at the salon with GPS in an open day; the office path is on-behalf bank transfers only (B-37).
  constraint payment_actor_shape check (
    (recorded_by_role = 'rep') = (rep_day_id is not null)
    and (recorded_by_role <> 'rep' or lat is not null)
    and (recorded_by_role = 'rep' or method = 'bank_transfer'))
);
create index payment_salon_idx on public.payment (salon_id, recorded_at);
create index payment_recorder_idx on public.payment (recorded_by, recorded_at);
comment on table public.payment is
  'PAY-02, PAY-10. Append-only. A mistake is corrected by a reversal row, built later with the approval registry (KIR-14); flags carry the CTL-02 findings.';

create table public.payment_allocation (
  id             uuid primary key default gen_random_uuid(),
  payment_id     uuid not null references public.payment (id),
  installment_id uuid not null references public.installment (id),
  amount_paisa   bigint not null check (amount_paisa > 0),
  unique (payment_id, installment_id)
);
create index payment_allocation_installment_idx on public.payment_allocation (installment_id);
comment on table public.payment_allocation is 'PAY-11. Append-only. Oldest due first. A trigger keeps allocations within the installment and the payment.';

-- Delivery of the receipt (phone, channel, status) is added with the SMS adapter; a receipt row is
-- the system's issued record, so it never changes.
create table public.receipt (
  id         uuid primary key default gen_random_uuid(),
  number     text not null unique check (number ~ '^R-[0-9]{2}-[0-9]{6}$'),
  payment_id uuid not null unique references public.payment (id),
  salon_id   uuid not null references public.salon (id),
  contact_id uuid references public.salon_contact (id),            -- the salon's primary active contact when issued
  issued_at  timestamptz not null default clock_timestamp()   -- taken under the salon lock, after earlier invoices and payments (as-of reads)
);
comment on table public.receipt is
  'PAY-03, CTL-01. Append-only, one per payment, gapless per financial year. No phone is copied here (H-27); sending is the adapter''s (B-08).';

create table public.cash_ledger_entry (
  id           uuid primary key default gen_random_uuid(),
  holder_type  text not null check (holder_type in ('rep', 'office', 'bank')),
  holder_id    uuid references public.user_profile (id),
  direction    text not null check (direction in ('in', 'out')),
  amount_paisa bigint not null check (amount_paisa > 0),
  source_type  text not null check (source_type in ('payment', 'handover', 'deposit', 'variance', 'expense')),
  source_id    uuid not null,
  created_at   timestamptz not null default now(),
  constraint cash_ledger_holder check ((holder_type = 'rep') = (holder_id is not null)),
  unique (source_type, source_id, holder_type, direction)
);
create index cash_ledger_holder_idx on public.cash_ledger_entry (holder_id, created_at);
comment on table public.cash_ledger_entry is
  'PAY-04. Append-only custody chain. Part a writes only `in` rows for cash payments; handovers and deposits come with part b and c. A balance is a sum (H-10).';

-- ----------------------------------------------------------------- guards ------
create trigger append_only before update or delete on public.installment        for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.installment                for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.payment            for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.payment                    for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.payment_allocation for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.payment_allocation         for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.receipt            for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.receipt                    for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.cash_ledger_entry  for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.cash_ledger_entry          for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on public.installment        for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.payment            for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.payment_allocation for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.receipt            for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.cash_ledger_entry  for each row execute function control.audit_row();

-- An allocation can never exceed what the installment is owed, nor what the payment paid, nor
-- tie a payment to another salon's installment, whatever function inserts it (H-10, H-16).
-- It takes the salon's allocation lock first, so concurrent sessions are serialised here as well. This
-- holds under READ COMMITTED, the isolation level the application uses; the guard does not claim more.
create function control.allocation_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_due    bigint;
  v_salon  uuid;
  v_paid   bigint;
  v_amount bigint;
  v_p_salon uuid;
  v_used   bigint;
begin
  select i.amount_due_paisa, i.salon_id into v_due, v_salon from public.installment i where i.id = new.installment_id;
  select p.amount_paisa, p.salon_id into v_amount, v_p_salon from public.payment p where p.id = new.payment_id;
  -- Same per-salon lock as app.record_payment (re-entrant in one session): two sessions cannot both pass the sums below.
  perform pg_advisory_xact_lock(hashtextextended('payment:' || v_salon::text, 0));
  if v_salon is distinct from v_p_salon then
    raise exception using errcode = '23514', message = 'a payment can settle only its own salon''s installments';
  end if;
  select coalesce(sum(a.amount_paisa), 0) into v_paid from public.payment_allocation a where a.installment_id = new.installment_id;
  if v_paid + new.amount_paisa > v_due then
    raise exception using errcode = '23514', message = 'an allocation would pay an installment more than it is owed';
  end if;
  select coalesce(sum(a.amount_paisa), 0) into v_used from public.payment_allocation a where a.payment_id = new.payment_id;
  if v_used + new.amount_paisa > v_amount then
    raise exception using errcode = '23514', message = 'allocations would exceed the payment';
  end if;
  return new;
end $$;
create trigger allocation_guard before insert on public.payment_allocation
  for each row execute function control.allocation_guard();

-- Issue ordering. An invoice and a payment for the same salon take the same per-salon advisory lock,
-- and the invoice's issue time is read after the lock is held (clock_timestamp, not the transaction's
-- start), as the receipt's is. So whatever a payment's allocation could see (invoices committed
-- before it took the lock) is exactly the invoices issued before its receipt, and an invoice that
-- waited for the lock is issued after it.
create function control.invoice_issue() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('payment:' || new.salon_id::text, 0));
  new.issued_at := clock_timestamp();
  return new;
end $$;

-- PAY-01: the schedule of an invoice, fixed when it is issued (A-11: delivery's Karachi date plus
-- the template's day offsets; the last installment takes the rounding remainder). A missing or invalid
-- plan template (A-12) makes app.plan_schedule raise, so the delivery that issues the invoice fails:
-- nothing is delivered, numbered or invoiced without a valid schedule.
create function control.invoice_installments() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_on date;
begin
  select (d.delivered_at at time zone 'Asia/Karachi')::date into v_on from public.delivery d where d.id = new.delivery_id;
  insert into public.installment (invoice_id, salon_id, seq, of_count, pct_of_total, due_on, amount_due_paisa)
  select new.id, new.salon_id, s.inst_no, s.inst_count, s.pct_of_total, s.due_on, s.amount_paisa
  from app.plan_schedule(new.plan, new.total_paisa, v_on) s;
  return new;
end $$;

-- The schedule of every invoice that has none yet, from the template as it stands now. Internal; the
-- migration calls it once, and the tests call it to show the upgrade path.
create function control.backfill_installments() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  insert into public.installment (invoice_id, salon_id, seq, of_count, pct_of_total, due_on, amount_due_paisa)
  select i.id, i.salon_id, s.inst_no, s.inst_count, s.pct_of_total, s.due_on, s.amount_paisa
  from public.invoice i
  join public.delivery d on d.id = i.delivery_id
  cross join lateral app.plan_schedule(i.plan, i.total_paisa, (d.delivered_at at time zone 'Asia/Karachi')::date) s
  where not exists (select 1 from public.installment x where x.invoice_id = i.id);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Postcondition: every invoice has installments that add up to its total, to the paisa.
create function control.check_installments() returns void
language plpgsql security definer set search_path = '' as $$
declare v_bad integer;
begin
  select count(*) into v_bad
  from public.invoice i
  where not exists (select 1 from public.installment x where x.invoice_id = i.id)
     or i.total_paisa <> (select coalesce(sum(x.amount_due_paisa), 0) from public.installment x where x.invoice_id = i.id);
  if v_bad > 0 then
    raise exception using errcode = '23514',
      message = format('%s invoice(s) have no installments, or installments that do not add up to the invoice total', v_bad);
  end if;
end $$;

-- Invoices issued before this migration get their schedule from the template as it stands now.
-- The invoice table is locked (share row exclusive: reads go on, inserts wait) from here to the end of
-- this migration's transaction, so no invoice can be issued between the backfill and the triggers.
-- The backfill fails closed: app.plan_schedule refuses a missing or invalid plan template (A-12) and
-- then the whole migration stops, and so does the postcondition below. Reconcile the template (owner,
-- app.owner_set_config) before migrating any database that already holds invoices. A fresh database
-- has none; tests/payments.test.ts runs the same two functions on an invoice made without installments.
-- The statement needs a transaction block: the Supabase CLI and the test harness both send a migration
-- file as one multi-statement query, which runs as one transaction.
lock table public.invoice in share row exclusive mode;
select control.backfill_installments();

create trigger invoice_issue before insert on public.invoice
  for each row execute function control.invoice_issue();
create trigger invoice_installments after insert on public.invoice
  for each row execute function control.invoice_installments();

select control.check_installments();

-- ------------------------------------------------------------------ helpers ----
-- Who may read a salon's money: the office, or a rep whose territories include the salon.
create function app.can_see_salon_money(p_salon_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_office() or app.rep_can_reach_salon(p_salon_id)
$$;

-- What each installment of a salon still owes, oldest due first (derived, H-10).
create function app.installment_state(p_salon_id uuid)
returns table (installment_id uuid, invoice_id uuid, invoice_number text, seq integer, of_count integer, due_on date,
               amount_due_paisa bigint, paid_paisa bigint, remaining_paisa bigint, status text, issued_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, i.invoice_id, v.number, i.seq, i.of_count, i.due_on, i.amount_due_paisa,
         coalesce(a.paid, 0)::bigint, (i.amount_due_paisa - coalesce(a.paid, 0))::bigint,
         case when i.amount_due_paisa - coalesce(a.paid, 0) = 0 then 'paid'
              when i.due_on < app.karachi_today() then 'overdue'
              when coalesce(a.paid, 0) > 0 then 'partial'
              else 'pending' end,
         v.issued_at
  from public.installment i
  join public.invoice v on v.id = i.invoice_id
  left join lateral (select sum(x.amount_paisa) paid from public.payment_allocation x where x.installment_id = i.id) a on true
  where i.salon_id = p_salon_id
  order by i.due_on, v.issued_at, v.number, i.seq, i.id
$$;

-- Internal: the one path that records a payment. The wrappers check who may call it.
create function app.record_payment(
  p_client_id uuid, p_salon_id uuid, p_method public.pay_method, p_amount_paisa bigint,
  p_bank_name text, p_bank_reference text, p_lat numeric, p_lng numeric, p_mock_location boolean,
  p_recorded_at_client timestamptz, p_rep_day_id uuid)
returns public.receipt
language plpgsql security definer set search_path = '' as $$
declare
  v_role    public.app_role := app.user_role();
  s         public.salon;
  p         public.payment;
  r         public.receipt;
  v_name    text := nullif(btrim(p_bank_name), '');
  v_ref     text := nullif(btrim(p_bank_reference), '');
  v_owed    bigint;
  v_dist    integer;
  v_max_m   numeric;
  v_max_min numeric;
  v_visit   public.visit;
  v_flags   text[] := '{}';
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a payment needs a client_id (idempotency key, H-08)';
  end if;
  -- One call per client_id at a time, taken before the first lookup: two sessions racing with the same
  -- key meet here, and the second one sees the first one's committed payment as a replay (H-08).
  perform pg_advisory_xact_lock(hashtextextended('payment-client:' || p_client_id::text, 0));
  -- Replay: the same call again returns the same receipt; the same key with any other persisted fact
  -- (who, salon, method, amount, bank fields, position, mock flag, the phone's time) is refused.
  select * into p from public.payment where client_id = p_client_id;
  if p.id is not null then
    if p.recorded_by = auth.uid() and p.salon_id = p_salon_id and p.method = p_method and p.amount_paisa = p_amount_paisa
       and p.bank_name is not distinct from v_name and p.bank_reference is not distinct from v_ref
       and p.lat is not distinct from round(p_lat, 6) and p.lng is not distinct from round(p_lng, 6)
       and p.mock_location = coalesce(p_mock_location, false)
       and p.recorded_at_client is not distinct from p_recorded_at_client then
      return (select x from public.receipt x where x.payment_id = p.id);
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if p_amount_paisa is null or p_amount_paisa <= 0 then
    raise exception using errcode = '22023', message = 'a payment needs an amount above zero';
  end if;
  if p_method = 'bank_transfer' and (v_name is null or v_ref is null) then
    raise exception using errcode = '22023', message = 'a bank transfer needs the bank name and the reference (PAY-02)';
  end if;
  if p_method = 'cash' and (v_name is not null or v_ref is not null) then
    raise exception using errcode = '22023', message = 'a cash payment carries no bank name or reference';
  end if;
  select * into s from public.salon where id = p_salon_id;
  if s.id is null then raise exception using errcode = '22023', message = 'unknown salon'; end if;
  if v_role = 'rep' then
    -- Only a rep's payment is judged against these (the office's carries on_behalf instead).
    v_max_m := app.config_number('payment.geofence_m');
    v_max_min := app.config_number('payment.max_minutes_after_arrival');
    if v_max_m is null or v_max_min is null or v_max_m < 0 or v_max_min < 0 then
      perform app.raise_denied('the payment flag thresholds (payment.geofence_m, payment.max_minutes_after_arrival) are not configured; ask the owner');
    end if;
  end if;

  -- One payment at a time per salon, so the allocation below sees every earlier one.
  perform pg_advisory_xact_lock(hashtextextended('payment:' || p_salon_id::text, 0));
  select coalesce(sum(x.remaining_paisa), 0) into v_owed from app.installment_state(p_salon_id) x;
  if v_owed = 0 then
    raise exception using errcode = '23514', message = 'this salon owes nothing; advances are not built yet (PAY-02)';
  end if;
  if p_amount_paisa > v_owed then
    raise exception using errcode = '23514', message = format('the payment is more than the salon owes (%s paisa)', v_owed);
  end if;

  -- CTL-02 and M14 findings, kept on the payment for the manager's review.
  if s.lat is not null and p_lat is not null and p_lng is not null then
    v_dist := app.distance_m(s.lat, s.lng, p_lat, p_lng);
  end if;
  if v_role = 'rep' then
    if v_dist is null then v_flags := array_append(v_flags, 'distance_unknown');
    elsif v_dist > v_max_m then v_flags := array_append(v_flags, 'far_from_salon'); end if;
    select * into v_visit from public.visit v
      where v.rep_day_id = p_rep_day_id and v.salon_id = p_salon_id order by v.arrived_at desc, v.id limit 1;
    if v_visit.id is null then v_flags := array_append(v_flags, 'no_visit');
    elsif now() - v_visit.arrived_at > v_max_min * interval '1 minute' then v_flags := array_append(v_flags, 'late_after_arrival'); end if;
  else
    v_flags := array_append(v_flags, 'on_behalf');
  end if;
  if coalesce(p_mock_location, false) then v_flags := array_append(v_flags, 'mock_location'); end if;

  perform app.set_purpose('payment recorded');
  insert into public.payment (client_id, salon_id, recorded_by, recorded_by_role, rep_day_id, visit_id, method, amount_paisa,
                              bank_name, bank_reference, lat, lng, distance_from_pin_m, mock_location, flags, recorded_at_client)
  values (p_client_id, p_salon_id, auth.uid(), v_role, p_rep_day_id, v_visit.id, p_method, p_amount_paisa,
          v_name, v_ref, p_lat, p_lng, v_dist, coalesce(p_mock_location, false), to_jsonb(v_flags), p_recorded_at_client)
  returning * into p;

  -- PAY-11: oldest due first, across every invoice of the salon.
  insert into public.payment_allocation (payment_id, installment_id, amount_paisa)
  select p.id, o.installment_id, least(o.remaining_paisa, p.amount_paisa - o.before_paisa)
  from (select x.installment_id, x.remaining_paisa,
               coalesce(sum(x.remaining_paisa) over (order by x.due_on, x.issued_at, x.invoice_number, x.seq, x.installment_id
                                                     rows between unbounded preceding and 1 preceding), 0)::bigint before_paisa
        from app.installment_state(p_salon_id) x where x.remaining_paisa > 0) o
  where o.before_paisa < p.amount_paisa;

  insert into public.receipt (number, payment_id, salon_id, contact_id)
  values (app.next_doc_number('R'), p.id, p.salon_id,
          (select c.id from public.salon_contact c where c.salon_id = p.salon_id and c.is_primary and c.active limit 1))
  returning * into r;

  if p.method = 'cash' then
    insert into public.cash_ledger_entry (holder_type, holder_id, direction, amount_paisa, source_type, source_id)
    values ('rep', p.recorded_by, 'in', p.amount_paisa, 'payment', p.id);
  end if;
  return r;
end $$;

-- The invoice document (migration 0014) now reads the stored installments, so a later change to the plan
-- template can neither change a printed schedule nor make an old invoice unreadable, and it lists the
-- numbered receipts of payments allocated to the invoice. Same fields, same access guard, same grants.
create or replace function app.invoice_document(p_invoice_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  i      public.invoice;
  d      public.delivery;
  s      public.salon;
  v_area text;
  v_plan text;
  v_on   date;
  v_fy   integer;
begin
  select * into i from public.invoice where id = p_invoice_id;
  if i.id is null then return null; end if;
  if not (app.is_office() or (app.user_role() = 'rep' and i.rep_id = auth.uid() and app.self_ok())) then
    return null;
  end if;
  select * into d from public.delivery where id = i.delivery_id;
  select * into s from public.salon where id = i.salon_id;
  select a.name into v_area from public.area a where a.id = s.area_id;
  select t ->> 'name' into v_plan
  from public.app_config c, jsonb_array_elements(c.value) t
  where c.key = 'plan.templates' and t ->> 'code' = i.plan::text;
  v_on := (d.delivered_at at time zone 'Asia/Karachi')::date;
  v_fy := substring(i.number from 5 for 2)::integer;               -- INV-27-000001: the number carries its financial year
  return jsonb_build_object(
    'version', 1,
    'number', i.number,
    'financial_year', (2000 + v_fy - 1)::text || '-' || lpad(v_fy::text, 2, '0'),
    'issued_at', i.issued_at,
    'company', coalesce((select c.value from public.app_config c where c.key = 'company.profile'), '{}'::jsonb),
    'bank_accounts', coalesce((select c.value from public.app_config c where c.key = 'company.bank_accounts'), '[]'::jsonb),
    'salon', jsonb_build_object('name', s.name, 'address', s.address, 'area', v_area),
    'delivery', jsonb_build_object('delivered_at', d.delivered_at, 'received_by_name', d.received_by_name, 'status', d.status),
    'plan', jsonb_build_object('code', i.plan, 'name', v_plan),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'line_no', ol.line_no, 'sku_code', k.code, 'product', p.brand_label || ' ' || p.name,
               'variant', k.variant, 'qty', dl.qty, 'list_price_paisa', dl.list_price_paisa,
               'unit_price_paisa', dl.unit_price_paisa, 'line_total_paisa', dl.line_total_paisa)
             order by ol.line_no)
      from public.delivery_line dl
      join public.sales_order_line ol on ol.id = dl.order_line_id
      join public.sku k on k.id = dl.sku_id
      join public.product p on p.id = k.product_id
      where dl.delivery_id = d.id), '[]'::jsonb),
    'totals', jsonb_build_object('subtotal_paisa', i.subtotal_paisa, 'discount_paisa', i.discount_paisa, 'total_paisa', i.total_paisa),
    'schedule', coalesce((
      select jsonb_agg(jsonb_build_object(
               'no', x.seq, 'of', x.of_count, 'due_on', x.due_on, 'pct', x.pct_of_total, 'amount_paisa', x.amount_due_paisa)
             order by x.seq)
      from public.installment x where x.invoice_id = i.id), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(jsonb_build_object('number', r.number, 'issued_at', r.issued_at, 'amount_paisa', t.amt)
                       order by r.issued_at, r.number)
      from (select a.payment_id, sum(a.amount_paisa)::bigint amt
            from public.payment_allocation a join public.installment x on x.id = a.installment_id
            where x.invoice_id = i.id group by a.payment_id) t
      join public.receipt r on r.payment_id = t.payment_id), '[]'::jsonb),
    'notices', jsonb_build_array(
      jsonb_build_object('code', 'no_paper_receipts',
        'en', 'Only the numbered receipt the system sends to your registered phone is valid. A paper receipt is not valid.',
        'ur', 'صرف وہ نمبر والی رسید درست ہے جو سسٹم آپ کے رجسٹرڈ فون پر بھیجتا ہے۔ کاغذی رسید درست نہیں۔'),
      jsonb_build_object('code', 'official_accounts_only',
        'en', 'Pay only into the company accounts printed on this invoice. Never pay a rep''s personal account or wallet.',
        'ur', 'ادائیگی صرف اس انوائس پر چھپے کمپنی کے اکاؤنٹس میں کریں۔ کسی ریپ کے ذاتی اکاؤنٹ یا والٹ میں ہرگز نہیں۔')));
end $$;

-- Delivery (migration 0013): the same function, with the per-salon payment lock taken before the first
-- audited write (see the comment inside). Signature, owner, search_path and the revoked grants are unchanged.
create or replace function app.deliver(
  p_client_id uuid, p_order_id uuid, p_from_location_id uuid, p_lines jsonb, p_received_by_name text,
  p_lat numeric, p_lng numeric, p_mock_location boolean, p_delivered_at_client timestamptz, p_rep_day_id uuid)
returns public.invoice
language plpgsql security definer set search_path = '' as $$
declare
  o       public.sales_order;
  s       public.salon;
  d       public.delivery;
  inv     public.invoice;
  v_left  integer;
  v_bad   integer;
  v_sub   bigint;
  v_tot   bigint;
  v_dist  integer;
  v_done  integer;
  v_lines jsonb;                                            -- [{order_line_id, sku_id, qty, list_price_paisa, unit_price_paisa}]
begin
  select * into o from public.sales_order where id = p_order_id for update;
  if o.id is null then raise exception using errcode = '22023', message = 'unknown order'; end if;
  if o.status not in ('confirmed', 'partially_delivered') then
    raise exception using errcode = '22023', message = 'only a confirmed order is delivered (ORD-03)';
  end if;
  if length(btrim(coalesce(p_received_by_name, ''))) not between 2 and 80 then
    raise exception using errcode = '22023', message = 'the name of the person who received the goods is required (MJ L-0163)';
  end if;
  -- The lines to deliver: as given (duplicates summed), or everything left.
  if p_lines is null then
    select jsonb_agg(jsonb_build_object('order_line_id', x.order_line_id, 'sku_id', x.sku_id, 'qty', x.remaining,
                                        'list_price_paisa', x.list_price_paisa, 'unit_price_paisa', x.unit_price_paisa))
      into v_lines
    from app.order_lines_left(o.id) x where x.remaining > 0;
  else
    select count(*) into v_bad
    from app.parse_lines(p_lines) p
    left join app.order_lines_left(o.id) x on x.sku_id = p.sku_id
    where x.order_line_id is null or p.qty > x.remaining;
    if v_bad > 0 then
      raise exception using errcode = '22023', message = 'every line must be a SKU of this order, at most what is left to deliver';
    end if;
    select jsonb_agg(jsonb_build_object('order_line_id', x.order_line_id, 'sku_id', x.sku_id, 'qty', p.qty,
                                        'list_price_paisa', x.list_price_paisa, 'unit_price_paisa', x.unit_price_paisa))
      into v_lines
    from app.parse_lines(p_lines) p join app.order_lines_left(o.id) x on x.sku_id = p.sku_id;
  end if;
  if v_lines is null then
    raise exception using errcode = '22023', message = 'nothing is left to deliver on this order';
  end if;
  -- Units promised to a pending issue out of this location are not available (migration 0008).
  if exists (select 1 from jsonb_to_recordset(v_lines) as t(order_line_id uuid, sku_id uuid, qty integer, list_price_paisa bigint, unit_price_paisa bigint)
             where app.on_hand(p_from_location_id, t.sku_id) - app.pending_out(p_from_location_id, t.sku_id) < t.qty) then
    raise exception using errcode = '23514', message = 'insufficient stock at the delivery location (part delivery is allowed)';
  end if;
  select * into s from public.salon where id = o.salon_id;
  if s.lat is not null and p_lat is not null and p_lng is not null then
    v_dist := app.distance_m(s.lat, s.lng, p_lat, p_lng);
  end if;
  select coalesce(sum(t.qty::bigint * t.list_price_paisa), 0), coalesce(sum(t.qty::bigint * t.unit_price_paisa), 0)
    into v_sub, v_tot from jsonb_to_recordset(v_lines) as t(order_line_id uuid, sku_id uuid, qty integer, list_price_paisa bigint, unit_price_paisa bigint);
  select coalesce(sum(x.remaining), 0)::integer into v_left from app.order_lines_left(o.id) x;
  select coalesce(sum(t.qty), 0)::integer into v_done from jsonb_to_recordset(v_lines) as t(order_line_id uuid, sku_id uuid, qty integer, list_price_paisa bigint, unit_price_paisa bigint);
  -- Lock order (M1): the per-salon payment lock comes before the first audited write of this delivery.
  -- A payment takes that lock first and then writes audited rows; a delivery that wrote its audited
  -- delivery row (which holds the audit chain head until commit) and only then asked for the lock at
  -- the invoice would deadlock with it. Nothing above this line writes an audited row. The invoice
  -- trigger asks for the same lock again later in this transaction, which is free.
  perform pg_advisory_xact_lock(hashtextextended('payment:' || o.salon_id::text, 0));
  perform app.set_purpose('order delivered');
  insert into public.delivery (client_id, order_id, salon_id, from_location_id, delivered_by, delivered_by_role, rep_day_id,
                               status, received_by_name, lat, lng, distance_from_pin_m, mock_location, delivered_at_client)
  values (p_client_id, o.id, o.salon_id, p_from_location_id, auth.uid(), app.user_role(), p_rep_day_id,
          case when v_done = v_left then 'full' else 'partial' end::public.delivery_status, btrim(p_received_by_name),
          p_lat, p_lng, v_dist, coalesce(p_mock_location, false), p_delivered_at_client)
  returning * into d;
  insert into public.delivery_line (delivery_id, order_line_id, sku_id, qty, list_price_paisa, unit_price_paisa, line_total_paisa)
  select d.id, t.order_line_id, t.sku_id, t.qty, t.list_price_paisa, t.unit_price_paisa, t.qty * t.unit_price_paisa
  from jsonb_to_recordset(v_lines) as t(order_line_id uuid, sku_id uuid, qty integer, list_price_paisa bigint, unit_price_paisa bigint);
  insert into public.stock_movement (client_id, sku_id, qty, from_location_id, kind, source_type, source_id, actor_id)
  select gen_random_uuid(), t.sku_id, t.qty, p_from_location_id, 'sale', 'delivery', d.id, auth.uid()
  from jsonb_to_recordset(v_lines) as t(order_line_id uuid, sku_id uuid, qty integer, list_price_paisa bigint, unit_price_paisa bigint);
  insert into public.invoice (number, delivery_id, order_id, salon_id, rep_id, plan, subtotal_paisa, discount_paisa,
                              total_paisa, issued_by)
  values (app.next_doc_number('INV'), d.id, o.id, o.salon_id, o.rep_id, o.plan, v_sub, v_sub - v_tot, v_tot, auth.uid())
  returning * into inv;
  update public.sales_order set status = case when v_done = v_left then 'delivered' else 'partially_delivered' end::public.order_status
   where id = o.id and status is distinct from case when v_done = v_left then 'delivered' else 'partially_delivered' end::public.order_status;
  -- PIP-05: deliveries keep the last purchase per product group (basis orders, migration 0011).
  insert into public.cycle_estimate as c (salon_id, product_group_id, last_order_on, basis, basis_orders, set_by)
  select distinct o.salon_id, p.product_group_id, app.karachi_today(), 'orders'::public.cycle_basis, 1, auth.uid()
  from jsonb_to_recordset(v_lines) as t(order_line_id uuid, sku_id uuid, qty integer, list_price_paisa bigint, unit_price_paisa bigint) join public.sku k on k.id = t.sku_id join public.product p on p.id = k.product_id
  on conflict (salon_id, product_group_id) do update
    set last_order_on = greatest(c.last_order_on, excluded.last_order_on), basis = 'orders',
        basis_orders = case when c.basis = 'orders' then c.basis_orders + 1 else 1 end,
        set_by = excluded.set_by, set_at = now();
  -- Doc 02: 3 completed orders make a new active salon a regular one.
  if v_done = v_left and s.stage = 'active_new'
     and (select count(*) from public.sales_order x where x.salon_id = o.salon_id and x.status in ('delivered', 'closed')) >= 3 then
    perform app.move_stage(o.salon_id, 'active_regular', 'order', '3 orders delivered');
  end if;
  return inv;
end $$;

-- Document numbers (foundation): the financial year of a number is read when the number is allocated, not at
-- the start of the transaction, so a call that waited for a lock across 1 July (Karachi) still numbers into the
-- year it is issued in. The counter row, the gapless rule and the grants are unchanged. Remaining risk: the
-- number and the row's own issue time (invoice.issued_at, receipt.issued_at) are read a few microseconds apart,
-- so exactly at midnight they could still fall either side; the invoice document therefore prints the year of
-- the number.
create or replace function app.next_doc_number(p_doc_type text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_fy smallint := app.fiscal_year((clock_timestamp() at time zone 'Asia/Karachi')::date);
  v_no bigint;
begin
  insert into control.doc_counter as c (doc_type, fy, last_no) values (p_doc_type, v_fy, 1)
  on conflict (doc_type, fy) do update set last_no = c.last_no + 1
  returning c.last_no into v_no;
  return p_doc_type || '-' || lpad(v_fy::text, 2, '0') || '-' || lpad(v_no::text, 6, '0');
end $$;

-- ------------------------------------------------------------------ recording ---
-- A rep records a payment at the salon: open day, approved device, a salon in its own territories,
-- GPS (PAY-02, CTL-02). Idempotent on client_id.
create function app.rep_record_payment(
  p_client_id uuid, p_salon_id uuid, p_method public.pay_method, p_amount_paisa bigint, p_lat numeric, p_lng numeric,
  p_bank_name text default null, p_bank_reference text default null, p_mock_location boolean default false,
  p_recorded_at_client timestamptz default null)
returns public.receipt
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  v_day  uuid;
begin
  if v_role <> 'rep' then perform app.raise_denied('reps record their own collections; the office uses office_record_payment'); end if;
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a payment needs a client_id (idempotency key, H-08)';
  end if;
  -- A replay needs no open day or territory any more: the first call was checked.
  if exists (select 1 from public.payment x where x.client_id = p_client_id) then
    return app.record_payment(p_client_id, p_salon_id, p_method, p_amount_paisa, p_bank_name, p_bank_reference,
                              p_lat, p_lng, p_mock_location, p_recorded_at_client, null);
  end if;
  v_day := app.my_open_day_id();
  if v_day is null then perform app.raise_denied('check in before recording a payment (PIP-09)'); end if;
  if not app.rep_can_reach_salon(p_salon_id) then
    perform app.raise_denied('reps record payments only for salons in their own territories');
  end if;
  if p_lat is null or p_lng is null then
    raise exception using errcode = '22023', message = 'GPS is required to record a payment (CTL-02)';
  end if;
  return app.record_payment(p_client_id, p_salon_id, p_method, p_amount_paisa, p_bank_name, p_bank_reference,
                            p_lat, p_lng, p_mock_location, p_recorded_at_client, v_day);
end $$;

-- The office records a bank transfer on behalf of a salon's rep (doc 06 section 2, M14): always
-- flagged on_behalf, never cash; Manager/Owner own-collection permissions remain blocked by B-37.
create function app.office_record_payment(
  p_client_id uuid, p_salon_id uuid, p_amount_paisa bigint, p_bank_name text, p_bank_reference text,
  p_lat numeric default null, p_lng numeric default null)
returns public.receipt
language plpgsql security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return app.record_payment(p_client_id, p_salon_id, 'bank_transfer', p_amount_paisa, p_bank_name, p_bank_reference,
                            p_lat, p_lng, false, null, null);
end $$;

-- -------------------------------------------------------------------- reads -----
-- Internal: a caller without access is refused with 42501 (a rep outside the salon's territory, any
-- other role), never answered with an empty or zero result that looks like a real balance. The
-- office asking about a salon that does not exist gets 22023.
create function app.assert_salon_money(p_salon_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.can_see_salon_money(p_salon_id) then
    perform app.raise_denied('no access to this salon''s account');
  end if;
  if not exists (select 1 from public.salon s where s.id = p_salon_id) then
    raise exception using errcode = '22023', message = 'unknown salon';
  end if;
end $$;

-- What the salon still owes, installment by installment, oldest first, at most 50 rows (H-14).
create function app.salon_installments(p_salon_id uuid)
returns table (installment_id uuid, invoice_number text, seq integer, of_count integer, due_on date,
               amount_due_paisa bigint, paid_paisa bigint, remaining_paisa bigint, status text)
language plpgsql security definer set search_path = '' as $$
begin
  perform app.assert_salon_money(p_salon_id);
  return query
  select x.installment_id, x.invoice_number, x.seq, x.of_count, x.due_on, x.amount_due_paisa, x.paid_paisa,
         x.remaining_paisa, x.status
  from app.installment_state(p_salon_id) x
  where x.remaining_paisa > 0
  order by x.due_on, x.issued_at, x.invoice_number, x.seq, x.installment_id
  limit 50;
end $$;

-- The salon's receivable, derived: invoiced minus paid, with the overdue part and the next due date.
create function app.salon_balance(p_salon_id uuid)
returns table (invoiced_paisa bigint, paid_paisa bigint, balance_paisa bigint, overdue_paisa bigint, next_due_on date)
language plpgsql security definer set search_path = '' as $$
begin
  perform app.assert_salon_money(p_salon_id);
  return query
  select coalesce(sum(x.amount_due_paisa), 0)::bigint, coalesce(sum(x.paid_paisa), 0)::bigint,
         coalesce(sum(x.remaining_paisa), 0)::bigint,
         coalesce(sum(x.remaining_paisa) filter (where x.status = 'overdue'), 0)::bigint,
         min(x.due_on) filter (where x.remaining_paisa > 0)
  from app.installment_state(p_salon_id) x;
end $$;

-- PAY-04: cash in hand = cash in minus cash out, from the ledger. A rep reads its own; the office
-- reads any rep's. Anyone else is refused (42501), so a zero is always a real zero.
create function app.my_cash_position()
returns table (in_paisa bigint, out_paisa bigint, balance_paisa bigint)
language plpgsql security definer set search_path = '' as $$
begin
  if app.user_role() is distinct from 'rep' or not app.self_ok() then
    perform app.raise_denied('only a rep reads its own cash position; the office reads office_rep_cash_position');
  end if;
  return query
  select coalesce(sum(e.amount_paisa) filter (where e.direction = 'in'), 0)::bigint,
         coalesce(sum(e.amount_paisa) filter (where e.direction = 'out'), 0)::bigint,
         coalesce(sum(case e.direction when 'in' then e.amount_paisa else -e.amount_paisa end), 0)::bigint
  from public.cash_ledger_entry e
  where e.holder_type = 'rep' and e.holder_id = auth.uid();
end $$;

create function app.office_rep_cash_position(p_rep_id uuid)
returns table (in_paisa bigint, out_paisa bigint, balance_paisa bigint)
language plpgsql security definer set search_path = '' as $$
begin
  perform app.assert_office();
  if not exists (select 1 from public.user_profile u where u.id = p_rep_id and u.role = 'rep') then
    raise exception using errcode = '22023', message = 'unknown rep';
  end if;
  return query
  select coalesce(sum(e.amount_paisa) filter (where e.direction = 'in'), 0)::bigint,
         coalesce(sum(e.amount_paisa) filter (where e.direction = 'out'), 0)::bigint,
         coalesce(sum(case e.direction when 'in' then e.amount_paisa else -e.amount_paisa end), 0)::bigint
  from public.cash_ledger_entry e
  where e.holder_type = 'rep' and e.holder_id = p_rep_id;
end $$;

-- CTL-01, doc 09 section 4: everything a receipt shows, from `public` only, as one JSON value. The
-- remaining schedule is as of this receipt: only invoices issued up to the receipt, and only payments up to this one.
-- The office reads any receipt, a rep the receipts of its own payments; anyone else gets null.
create function app.receipt_document(p_receipt_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.receipt;
  p public.payment;
  s public.salon;
begin
  select * into r from public.receipt where id = p_receipt_id;
  if r.id is null then return null; end if;
  select * into p from public.payment where id = r.payment_id;
  if not (app.is_office() or (app.user_role() = 'rep' and p.recorded_by = auth.uid() and app.self_ok())) then
    return null;
  end if;
  select * into s from public.salon where id = r.salon_id;
  return jsonb_build_object(
    'version', 1,
    'number', r.number,
    'issued_at', r.issued_at,
    'company', coalesce((select c.value from public.app_config c where c.key = 'company.profile'), '{}'::jsonb),
    'salon', jsonb_build_object('name', s.name),
    'payment', jsonb_build_object('amount_paisa', p.amount_paisa, 'method', p.method, 'bank_name', p.bank_name,
                                  'bank_reference', p.bank_reference, 'recorded_at', p.recorded_at),
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object('invoice_number', v.number, 'seq', i.seq, 'of', i.of_count, 'amount_paisa', a.amount_paisa)
                       order by i.due_on, v.issued_at, i.seq)
      from public.payment_allocation a
      join public.installment i on i.id = a.installment_id
      join public.invoice v on v.id = i.invoice_id
      where a.payment_id = p.id), '[]'::jsonb),
    'remaining', coalesce((
      select jsonb_agg(jsonb_build_object('invoice_number', v.number, 'seq', i.seq, 'of', i.of_count, 'due_on', i.due_on,
                                          'remaining_paisa', i.amount_due_paisa - paid.n) order by i.due_on, v.issued_at, i.seq)
      from public.installment i
      join public.invoice v on v.id = i.invoice_id
      cross join lateral (
        select coalesce(sum(a.amount_paisa), 0)::bigint n
        from public.payment_allocation a join public.payment q on q.id = a.payment_id
        where a.installment_id = i.id and q.seq <= p.seq) paid
      where i.salon_id = p.salon_id and v.issued_at <= r.issued_at and i.amount_due_paisa - paid.n > 0), '[]'::jsonb),
    'notices', jsonb_build_array(
      jsonb_build_object('code', 'only_valid_proof',
        'en', 'This numbered receipt is your only valid proof of payment. A paper receipt is not valid.',
        'ur', 'یہ نمبر والی رسید آپ کی ادائیگی کا واحد درست ثبوت ہے۔ کاغذی رسید درست نہیں۔')));
end $$;

-- ---------------------------------------------------------------------- RLS -----
alter table public.installment        enable row level security;
alter table public.installment        force  row level security;
alter table public.payment            enable row level security;
alter table public.payment            force  row level security;
alter table public.payment_allocation enable row level security;
alter table public.payment_allocation force  row level security;
alter table public.receipt            enable row level security;
alter table public.receipt            force  row level security;
alter table public.cash_ledger_entry  enable row level security;
alter table public.cash_ledger_entry  force  row level security;

-- Installments and allocations are office-only at the table; a rep reads them through the
-- functions above. A rep reads its own payments and their receipts, and its own cash rows; the own-rows
-- branch is for reps only, so an office user at AAL1 (no MFA) sees nothing, not even rows it recorded.
create policy installment_select on public.installment for select to authenticated
  using ((select app.is_office()));
create policy payment_allocation_select on public.payment_allocation for select to authenticated
  using ((select app.is_office()));
create policy payment_select on public.payment for select to authenticated
  using ((select app.is_office()) or (recorded_by = (select auth.uid()) and (select app.is_rep()) and (select app.self_ok())));
create policy receipt_select on public.receipt for select to authenticated
  using ((select app.is_office()) or exists (
    select 1 from public.payment p where p.id = payment_id and p.recorded_by = (select auth.uid()) and (select app.is_rep()) and (select app.self_ok())));
create policy cash_ledger_entry_select on public.cash_ledger_entry for select to authenticated
  using ((select app.is_office()) or (holder_type = 'rep' and holder_id = (select auth.uid()) and (select app.is_rep()) and (select app.self_ok())));

-- ----------------------------------------------------------------- privileges ----
revoke all on public.installment, public.payment, public.payment_allocation, public.receipt, public.cash_ledger_entry
  from public, anon, authenticated, service_role;
grant select on public.installment, public.payment, public.payment_allocation, public.receipt, public.cash_ledger_entry
  to authenticated, service_role;

-- payment.seq is an identity column; Supabase's default privileges can hand its sequence to the API roles.
do $$
begin
  execute format('revoke all on sequence %s from public, anon, authenticated, service_role',
                 pg_get_serial_sequence('public.payment', 'seq'));
end $$;

revoke execute on function
  app.deliver(uuid, uuid, uuid, jsonb, text, numeric, numeric, boolean, timestamptz, uuid),
  app.next_doc_number(text),
  control.allocation_guard(),
  control.invoice_issue(),
  control.invoice_installments(),
  control.backfill_installments(),
  control.check_installments(),
  app.can_see_salon_money(uuid),
  app.assert_salon_money(uuid),
  app.installment_state(uuid),
  app.record_payment(uuid, uuid, public.pay_method, bigint, text, text, numeric, numeric, boolean, timestamptz, uuid),
  app.rep_record_payment(uuid, uuid, public.pay_method, bigint, numeric, numeric, text, text, boolean, timestamptz),
  app.office_record_payment(uuid, uuid, bigint, text, text, numeric, numeric),
  app.salon_installments(uuid),
  app.salon_balance(uuid),
  app.my_cash_position(),
  app.office_rep_cash_position(uuid),
  app.receipt_document(uuid)
  from public, anon, authenticated, service_role;

revoke execute on function app.invoice_document(uuid) from public, anon, authenticated, service_role;
grant execute on function app.invoice_document(uuid) to authenticated;

grant execute on function
  app.rep_record_payment(uuid, uuid, public.pay_method, bigint, numeric, numeric, text, text, boolean, timestamptz),
  app.office_record_payment(uuid, uuid, bigint, text, text, numeric, numeric),
  app.salon_installments(uuid),
  app.salon_balance(uuid),
  app.my_cash_position(),
  app.office_rep_cash_position(uuid),
  app.receipt_document(uuid)
  to authenticated;
