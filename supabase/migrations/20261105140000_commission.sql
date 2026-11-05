-- =============================================================================
-- Kiran DMS · migration 20261105140000 · Commission rates, stamps and payments (completion slice 5, P1-22)
-- Requirements: CTL-13, FLD-01 (default rate), FLD-03, FLD-06; H-06, H-08, H-09, H-10, H-13, H-17.
-- Decisions: D-31 (commission on the delivered and invoiced value of orders assigned to the rep; the
--            owner or manager sets the rate; a change applies from the change onward), D-38 (rate per
--            rep and salon with a rep default; commission_rep_id and commission_rate_bp stamped at
--            delivery approval; earned floor(total x bp / 10000) derived from invoices; append-only
--            payments and reversals; owed is earned minus paid), OQ-34 default (no second person).
-- Spec: docs/superpowers/specs/2026-11-05-reps-salons-catalogue-investors-design.md R7, R8, sections 3 and 4.
--
-- What is built:
--   * The per rep and salon rate is not a new table: it is salon_rep_assignment.rate_bp (slice 1,
--     migration 20261105100000), set with app.office_assign_salon_rep or app.office_decide_salon.
--   * public.rep_commission_rate: the rep's default rate, append-only and versioned (the latest row by
--     seq wins), set by the owner or a manager with a reason.
--   * invoice.commission_rate_bp, stamped in app.finalise_delivery's invoice insert (the single
--     stamping point slice 4 marked): the order's assigned rep's rate on the salon's current direct
--     assignment, else that rep's default, else 0; 0 for an order with no assigned rep. A NOT VALID
--     check binds every new invoice and leaves older ones (append-only, no backfill) alone.
--   * public.commission_payment: payments and full reversals, append-only. A payment never exceeds
--     what is earned and unpaid (23514), checked in a guard trigger under a per-rep lock, so a direct
--     insert meets the same rule. A payment is reversed once, with a reason; a reversal is final.
--   * app.office_set_commission_rate, app.office_record_commission_payment,
--     app.office_reverse_commission_payment, app.my_commission(from, to), app.office_commission(rep,
--     from, to), app.office_commission_reps(from, to).
--
-- Earned is never stored (H-10): it is the sum over the rep's stamped invoices of
-- floor(total_paisa x commission_rate_bp / 10000), floored per invoice. Paid is payments minus
-- reversals. Owed is all-time earned minus all-time paid. A date range (Karachi dates) selects the
-- invoices and payments shown; owed and the payment cap are always all-time.
-- OQ-34 [default-unconfirmed]: no checker on a commission payment or reversal; each is audited.
-- Clawback on write-offs (CTL-13) waits for write-offs (P1-08); the new-salon bonus is Phase 2.
-- =============================================================================

-- ------------------------------------------------------------- default rate ----
create table public.rep_commission_rate (
  id        uuid primary key default gen_random_uuid(),
  seq       bigint generated always as identity,                     -- "latest" is this, not a clock
  client_id uuid not null unique,                                    -- idempotency key from the page (H-08)
  rep_id    uuid not null references public.user_profile (id),
  rate_bp   integer not null check (rate_bp between 0 and 10000),
  reason    text not null check (length(btrim(reason)) between 5 and 300),
  set_by    uuid not null references public.user_profile (id),
  set_at    timestamptz not null default now()                       -- server time (H-09)
);
create index rep_commission_rate_latest_idx on public.rep_commission_rate (rep_id, seq desc);
comment on table public.rep_commission_rate is
  'D-31, D-38, FLD-01. Append-only. A rep''s default commission rate in basis points; the latest row by seq is current and applies to invoices issued after it. The per salon rate is salon_rep_assignment.rate_bp.';

-- ------------------------------------------------------------- invoice stamp ----
alter table public.invoice add column commission_rate_bp integer check (commission_rate_bp between 0 and 10000);
-- Named to sort after invoice_delivered_by_set (Postgres checks constraints in name order), so an
-- invoice missing both stamps is still refused with slice 4's name.
alter table public.invoice add constraint invoice_rate_stamped check (commission_rate_bp is not null) not valid;
create index invoice_commission_idx on public.invoice (commission_rep_id, issued_at) where commission_rep_id is not null;
comment on column public.invoice.commission_rate_bp is
  'D-38. The commission rate in basis points stamped at delivery approval for commission_rep_id: the rep''s rate on the salon''s current assignment, else the rep''s default, else 0. Never changes. Null only on invoices made before migration 20261105140000.';

-- ---------------------------------------------------------------- payments ----
create table public.commission_payment (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null unique,                                 -- idempotency key from the page (H-08)
  rep_id       uuid not null references public.user_profile (id),
  kind         text not null check (kind in ('payment', 'reversal')),
  amount_paisa bigint not null check (amount_paisa > 0),
  reverses_id  uuid unique references public.commission_payment (id), -- a payment is reversed at most once
  note         text check (length(note) <= 300),
  reason       text,
  recorded_by  uuid not null references public.user_profile (id),
  recorded_at  timestamptz not null default now(),                   -- server time (H-09)
  constraint commission_payment_shape check (
    (kind = 'payment' and reverses_id is null and reason is null)
    or (kind = 'reversal' and reverses_id is not null and length(btrim(coalesce(reason, ''))) between 5 and 500))
);
create index commission_payment_rep_idx on public.commission_payment (rep_id, recorded_at desc);
comment on table public.commission_payment is
  'D-38, FLD-06. Append-only. Commission paid to a rep, and full reversals of a payment with a reason. Paid is payments minus reversals; owed is earned (derived from invoices) minus paid. OQ-34: no checker.';

-- ------------------------------------------------------------------- helpers ----
-- Internal (no grant). The rate stamped on an invoice of p_salon_id for p_rep_id (D-38): the rate on
-- the salon's latest assignment row when that row names this rep and carries a rate; else the rep's
-- latest default; else 0. No rep, 0.
create function app.commission_rate_for(p_rep_id uuid, p_salon_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select case when p_rep_id is null then 0 else coalesce(
    (select a.rate_bp from (select x.rep_id, x.rate_bp from public.salon_rep_assignment x
                            where x.salon_id = p_salon_id order by x.seq desc limit 1) a
     where a.rep_id = p_rep_id),
    (select c.rate_bp from public.rep_commission_rate c where c.rep_id = p_rep_id order by c.seq desc limit 1),
    0) end
$$;

-- Internal (no grant). A Karachi date range: both ends, from not after to, at most 366 days.
create function app.assert_commission_range(p_from date, p_to date) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    raise exception using errcode = '22023', message = 'a date range needs a from and a to date, from not after to, at most 366 days';
  end if;
end $$;

-- Internal (no grant). Earned in a range of Karachi dates (null ends: all time), floored per invoice.
create function app.commission_earned_paisa(p_rep_id uuid, p_from date, p_to date) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum((i.total_paisa * i.commission_rate_bp) / 10000), 0)::bigint
  from public.invoice i
  where i.commission_rep_id = p_rep_id and i.commission_rate_bp is not null
    and (p_from is null or (i.issued_at at time zone 'Asia/Karachi')::date >= p_from)
    and (p_to is null or (i.issued_at at time zone 'Asia/Karachi')::date <= p_to)
$$;

-- Internal (no grant). Paid in a range (null ends: all time): payments minus reversals, each on its own date.
create function app.commission_paid_paisa(p_rep_id uuid, p_from date, p_to date) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case p.kind when 'payment' then p.amount_paisa else -p.amount_paisa end), 0)::bigint
  from public.commission_payment p
  where p.rep_id = p_rep_id
    and (p_from is null or (p.recorded_at at time zone 'Asia/Karachi')::date >= p_from)
    and (p_to is null or (p.recorded_at at time zone 'Asia/Karachi')::date <= p_to)
$$;

-- Internal (no grant). The rep's commission statement for a range: the shape app.my_commission and
-- app.office_commission return. Allow-listed fields only: invoice number, date, salon name, total,
-- rate and commission; never cost, margin, stock location or supplier data (H-05). Lists hold the
-- newest 50 (H-14); the totals cover every row in the range.
create function app.commission_statement(p_rep_id uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'rep_id', p_rep_id, 'from', p_from, 'to', p_to,
    'default_rate_bp', (select c.rate_bp from public.rep_commission_rate c where c.rep_id = p_rep_id order by c.seq desc limit 1),
    'earned_paisa', app.commission_earned_paisa(p_rep_id, p_from, p_to),
    'paid_paisa', app.commission_paid_paisa(p_rep_id, p_from, p_to),
    'earned_to_date_paisa', app.commission_earned_paisa(p_rep_id, null, null),
    'paid_to_date_paisa', app.commission_paid_paisa(p_rep_id, null, null),
    'owed_paisa', app.commission_earned_paisa(p_rep_id, null, null) - app.commission_paid_paisa(p_rep_id, null, null),
    'invoice_count', (select count(*) from public.invoice i
                      where i.commission_rep_id = p_rep_id and i.commission_rate_bp is not null
                        and (i.issued_at at time zone 'Asia/Karachi')::date between p_from and p_to),
    'invoices', coalesce((select jsonb_agg(x order by x.issued_at desc, x.number desc) from (
        select i.id as invoice_id, i.number, i.issued_at, s.name as salon_name, i.total_paisa,
               i.commission_rate_bp as rate_bp, (i.total_paisa * i.commission_rate_bp) / 10000 as commission_paisa
        from public.invoice i join public.salon s on s.id = i.salon_id
        where i.commission_rep_id = p_rep_id and i.commission_rate_bp is not null
          and (i.issued_at at time zone 'Asia/Karachi')::date between p_from and p_to
        order by i.issued_at desc, i.number desc
        limit 50) x), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(y order by y.recorded_at desc, y.payment_id) from (
        select p.id as payment_id, p.kind, p.amount_paisa, p.note, p.reason, p.reverses_id,
               exists (select 1 from public.commission_payment r where r.reverses_id = p.id) as reversed,
               p.recorded_at, u.full_name as recorded_by_name
        from public.commission_payment p join public.user_profile u on u.id = p.recorded_by
        where p.rep_id = p_rep_id and (p.recorded_at at time zone 'Asia/Karachi')::date between p_from and p_to
        order by p.recorded_at desc, p.id
        limit 50) y), '[]'::jsonb),
    'salon_rates', coalesce((select jsonb_agg(z order by z.salon_name, z.salon_id) from (
        select s.id as salon_id, s.name as salon_name, a.rate_bp
        from public.salon s
        join lateral (select x.rep_id, x.rate_bp from public.salon_rep_assignment x
                      where x.salon_id = s.id order by x.seq desc limit 1) a on a.rep_id = p_rep_id
        order by s.name, s.id
        limit 50) z), '[]'::jsonb))
$$;

-- ------------------------------------------------------------------- guards ----
-- Before every payment row, under the rep's lock: a payment is at most what is earned and unpaid; a
-- reversal mirrors one payment of the same rep and amount. A direct insert meets the same rule.
create function control.commission_payment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o public.commission_payment;
begin
  perform pg_advisory_xact_lock(hashtextextended('commission:' || new.rep_id::text, 0));
  if new.kind = 'payment' then
    if new.amount_paisa > app.commission_earned_paisa(new.rep_id, null, null) - app.commission_paid_paisa(new.rep_id, null, null) then
      raise exception using errcode = '23514', message = 'a commission payment cannot exceed what is earned and unpaid';
    end if;
  else
    select * into o from public.commission_payment x where x.id = new.reverses_id;
    if o.id is null or o.kind <> 'payment' or o.rep_id <> new.rep_id or o.amount_paisa <> new.amount_paisa then
      raise exception using errcode = '23514', message = 'a reversal mirrors one payment of the same rep and amount';
    end if;
  end if;
  return new;
end $$;

create trigger commission_payment_guard before insert on public.commission_payment
  for each row execute function control.commission_payment_guard();
create trigger append_only before update or delete on public.rep_commission_rate for each row execute function control.forbid_mutation();
create trigger append_only before update or delete on public.commission_payment  for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.rep_commission_rate         for each statement execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.commission_payment          for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on public.rep_commission_rate for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.commission_payment  for each row execute function control.audit_row();

-- ---------------------------------------------------------------------- RLS -----
alter table public.rep_commission_rate enable row level security;
alter table public.rep_commission_rate force  row level security;
alter table public.commission_payment  enable row level security;
alter table public.commission_payment  force  row level security;

-- The office reads both. A rep reads its own through app.my_commission only; a salon reads nothing.
create policy rep_commission_rate_select on public.rep_commission_rate for select to authenticated
  using ((select app.is_office()));
create policy commission_payment_select on public.commission_payment for select to authenticated
  using ((select app.is_office()));

-- ----------------------------------------------------------------- privileges ----
revoke all on public.rep_commission_rate, public.commission_payment from public, anon, authenticated, service_role;
grant select on public.rep_commission_rate, public.commission_payment to authenticated, service_role;
revoke all on sequence public.rep_commission_rate_seq_seq from public, anon, authenticated, service_role;
revoke execute on function control.commission_payment_guard() from public, anon, authenticated, service_role;

-- =============================================================================
-- The stamping point: migration 20261105130100's app.finalise_delivery, unchanged except that the
-- invoice insert also writes commission_rate_bp (app.commission_rate_for the order's assigned rep and
-- the salon, read in this transaction, so the rate current at approval is the one stamped).
-- =============================================================================
create or replace function app.finalise_delivery(
  p_client_id uuid, p_order_id uuid, p_from_location_id uuid, p_lines jsonb, p_received_by_name text,
  p_lat numeric, p_lng numeric, p_mock_location boolean, p_delivered_at_client timestamptz, p_rep_day_id uuid,
  p_delivered_by uuid, p_delivered_by_role public.app_role)
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
  values (p_client_id, o.id, o.salon_id, p_from_location_id, p_delivered_by, p_delivered_by_role, p_rep_day_id,
          case when v_done = v_left then 'full' else 'partial' end::public.delivery_status, btrim(p_received_by_name),
          p_lat, p_lng, v_dist, coalesce(p_mock_location, false), p_delivered_at_client)
  returning * into d;
  insert into public.delivery_line (delivery_id, order_line_id, sku_id, qty, list_price_paisa, unit_price_paisa, line_total_paisa)
  select d.id, t.order_line_id, t.sku_id, t.qty, t.list_price_paisa, t.unit_price_paisa, t.qty * t.unit_price_paisa
  from jsonb_to_recordset(v_lines) as t(order_line_id uuid, sku_id uuid, qty integer, list_price_paisa bigint, unit_price_paisa bigint);
  insert into public.stock_movement (client_id, sku_id, qty, from_location_id, kind, source_type, source_id, actor_id)
  select gen_random_uuid(), t.sku_id, t.qty, p_from_location_id, 'sale', 'delivery', d.id, auth.uid()
  from jsonb_to_recordset(v_lines) as t(order_line_id uuid, sku_id uuid, qty integer, list_price_paisa bigint, unit_price_paisa bigint);
  -- The invoice and its attribution stamps. This insert is the single stamping point: delivered_by is
  -- who handed the goods over, commission_rep_id the order's assigned rep at approval (D-31, Decision
  -- 6), commission_rate_bp that rep's rate now (D-38, slice 5): the salon's assignment rate for that
  -- rep, else the rep's default, else 0. Later rate changes and reassignments never touch it.
  insert into public.invoice (number, delivery_id, order_id, salon_id, rep_id, plan, subtotal_paisa, discount_paisa,
                              total_paisa, issued_by, delivered_by, commission_rep_id, commission_rate_bp)
  values (app.next_doc_number('INV'), d.id, o.id, o.salon_id, coalesce(o.assigned_rep_id, o.rep_id), o.plan, v_sub, v_sub - v_tot, v_tot,
          auth.uid(), p_delivered_by, o.assigned_rep_id, app.commission_rate_for(o.assigned_rep_id, o.salon_id))
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

-- =============================================================================
-- Office writes (owner or manager at AAL2, D-31, D-38)
-- =============================================================================
-- A rep's default rate, for invoices issued from now on. Reason 5 to 300 characters.
create function app.office_set_commission_rate(p_client_id uuid, p_rep_id uuid, p_rate_bp integer, p_reason text)
returns public.rep_commission_rate
language plpgsql security definer set search_path = '' as $$
declare
  v_role   public.app_role := app.assert_office();
  v_reason text := app.blank_to_null(p_reason);
  r        public.rep_commission_rate;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a rate needs a client_id (idempotency key, H-08)';
  end if;
  select * into r from public.rep_commission_rate x where x.client_id = p_client_id;
  if r.id is not null then
    if r.set_by = auth.uid() and r.rep_id = p_rep_id and r.rate_bp = p_rate_bp then return r; end if;   -- replay
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if p_rate_bp is null or p_rate_bp not between 0 and 10000 then
    raise exception using errcode = '22023', message = 'a commission rate is 0 to 100 percent (0 to 10000 basis points)';
  end if;
  if v_reason is null or length(v_reason) not between 5 and 300 then
    raise exception using errcode = '22023', message = 'a rate change needs a reason of 5 to 300 characters';
  end if;
  if not exists (select 1 from public.user_profile u where u.id = p_rep_id and u.role = 'rep' for share) then
    raise exception using errcode = '22023', message = 'unknown rep';
  end if;
  perform app.set_purpose('commission rate set');
  insert into public.rep_commission_rate (client_id, rep_id, rate_bp, reason, set_by)
  values (p_client_id, p_rep_id, p_rate_bp, v_reason, auth.uid())
  returning * into r;
  return r;
end $$;

-- A commission payment to a rep: at most what is earned and unpaid (the guard trigger, 23514).
create function app.office_record_commission_payment(p_client_id uuid, p_rep_id uuid, p_amount_paisa bigint, p_note text default null)
returns public.commission_payment
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_office();
  v_note text := app.blank_to_null(p_note);
  p      public.commission_payment;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a payment needs a client_id (idempotency key, H-08)';
  end if;
  select * into p from public.commission_payment x where x.client_id = p_client_id;
  if p.id is not null then
    if p.recorded_by = auth.uid() and p.kind = 'payment' and p.rep_id = p_rep_id and p.amount_paisa = p_amount_paisa
       and p.note is not distinct from v_note then
      return p;                                                                -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if p_amount_paisa is null or p_amount_paisa <= 0 then
    raise exception using errcode = '22023', message = 'a payment is a positive amount in paisa';
  end if;
  if length(v_note) > 300 then
    raise exception using errcode = '22023', message = 'a note is at most 300 characters';
  end if;
  if not exists (select 1 from public.user_profile u where u.id = p_rep_id and u.role = 'rep') then
    raise exception using errcode = '22023', message = 'unknown rep';
  end if;
  -- The rep's lock before the balance is read (the guard reads it again under the same lock).
  perform pg_advisory_xact_lock(hashtextextended('commission:' || p_rep_id::text, 0));
  select * into p from public.commission_payment x where x.client_id = p_client_id;
  if p.id is not null then
    raise exception using errcode = '23505', message = 'client_id already used';
  end if;
  perform app.set_purpose('commission paid');
  insert into public.commission_payment (client_id, rep_id, kind, amount_paisa, note, recorded_by)
  values (p_client_id, p_rep_id, 'payment', p_amount_paisa, v_note, auth.uid())
  returning * into p;
  return p;
end $$;

-- Reverses one payment in full, with a reason of 5 to 500 characters. Once per payment; a reversal is final.
create function app.office_reverse_commission_payment(p_client_id uuid, p_payment_id uuid, p_reason text)
returns public.commission_payment
language plpgsql security definer set search_path = '' as $$
declare
  v_role   public.app_role := app.assert_office();
  v_reason text := app.blank_to_null(p_reason);
  o        public.commission_payment;
  p        public.commission_payment;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a reversal needs a client_id (idempotency key, H-08)';
  end if;
  select * into p from public.commission_payment x where x.client_id = p_client_id;
  if p.id is not null then
    if p.recorded_by = auth.uid() and p.kind = 'reversal' and p.reverses_id = p_payment_id then return p; end if;   -- replay
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if v_reason is null or length(v_reason) not between 5 and 500 then
    raise exception using errcode = '22023', message = 'a reversal needs a reason of 5 to 500 characters';
  end if;
  select * into o from public.commission_payment x where x.id = p_payment_id for update;
  if o.id is null then raise exception using errcode = '22023', message = 'unknown commission payment'; end if;
  if o.kind <> 'payment' then
    raise exception using errcode = '55000', message = 'a reversal is final and cannot be reversed';
  end if;
  if exists (select 1 from public.commission_payment x where x.reverses_id = o.id) then
    raise exception using errcode = '55000', message = 'this payment is already reversed';
  end if;
  perform app.set_purpose('commission payment reversed');
  insert into public.commission_payment (client_id, rep_id, kind, amount_paisa, reverses_id, reason, recorded_by)
  values (p_client_id, o.rep_id, 'reversal', o.amount_paisa, o.id, v_reason, auth.uid())
  returning * into p;
  return p;
end $$;

-- =============================================================================
-- Reads
-- =============================================================================
-- The calling rep's own statement, on its approved phone. No rep id is taken: the session decides.
create function app.my_commission(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.app_role := app.assert_actor_ready();
begin
  if v_role <> 'rep' or not app.self_ok() then
    perform app.raise_denied('reps read their own commission, on their approved phone');
  end if;
  perform app.assert_commission_range(p_from, p_to);
  return app.commission_statement(auth.uid(), p_from, p_to);
end $$;

-- One rep's statement for the office, with the rep's name and status and the default-rate history.
create function app.office_commission(p_rep_id uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_office();
  u      public.user_profile;
begin
  perform app.assert_commission_range(p_from, p_to);
  select * into u from public.user_profile x where x.id = p_rep_id and x.role = 'rep';
  if u.id is null then raise exception using errcode = '22023', message = 'unknown rep'; end if;
  return app.commission_statement(u.id, p_from, p_to) || jsonb_build_object(
    'rep_name', u.full_name, 'rep_status', u.status,
    'rate_history', coalesce((select jsonb_agg(h order by h.seq desc) from (
        select c.seq, c.rate_bp, c.reason, c.set_at, s.full_name as set_by_name
        from public.rep_commission_rate c join public.user_profile s on s.id = c.set_by
        where c.rep_id = u.id order by c.seq desc limit 50) h), '[]'::jsonb));
end $$;

-- Every rep with its default rate, earned and paid in the range, and owed to date; up to 200.
create function app.office_commission_reps(p_from date, p_to date)
returns table (rep_id uuid, full_name text, status public.user_status, default_rate_bp integer,
               earned_paisa bigint, paid_paisa bigint, owed_paisa bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  perform app.assert_commission_range(p_from, p_to);
  return query
  select u.id, u.full_name, u.status,
         (select c.rate_bp from public.rep_commission_rate c where c.rep_id = u.id order by c.seq desc limit 1),
         app.commission_earned_paisa(u.id, p_from, p_to), app.commission_paid_paisa(u.id, p_from, p_to),
         app.commission_earned_paisa(u.id, null, null) - app.commission_paid_paisa(u.id, null, null)
  from public.user_profile u
  where u.role = 'rep'
  order by u.full_name, u.id
  limit 200;
end $$;

-- ----------------------------------------------------------------- function privileges ----
revoke all on function
  app.finalise_delivery(uuid, uuid, uuid, jsonb, text, numeric, numeric, boolean, timestamptz, uuid, uuid, public.app_role),
  app.commission_rate_for(uuid, uuid), app.assert_commission_range(date, date),
  app.commission_earned_paisa(uuid, date, date), app.commission_paid_paisa(uuid, date, date),
  app.commission_statement(uuid, date, date)
  from public, anon, authenticated, service_role;

revoke all on function
  app.office_set_commission_rate(uuid, uuid, integer, text),
  app.office_record_commission_payment(uuid, uuid, bigint, text),
  app.office_reverse_commission_payment(uuid, uuid, text),
  app.my_commission(date, date), app.office_commission(uuid, date, date), app.office_commission_reps(date, date)
  from public, anon, authenticated, service_role;
grant execute on function
  app.office_set_commission_rate(uuid, uuid, integer, text),
  app.office_record_commission_payment(uuid, uuid, bigint, text),
  app.office_reverse_commission_payment(uuid, uuid, text),
  app.my_commission(date, date), app.office_commission(uuid, date, date), app.office_commission_reps(date, date)
  to authenticated;
