-- =============================================================================
-- Kiran DMS · migration 0013 · Deliveries and invoices (task P1-06, part b)
-- Requirements: ORD-03 (confirmed → partially delivered → delivered), ORD-04 (a delivery
--               creates the stock movement from its source and one invoice with a sequential
--               number), ADM-03 (invoice numbers gapless per financial year from 1 July).
-- Docs: 02 (3 orders → active regular), 04 (delivery, invoice), 09 §8 (INV-<FY>-<seq>),
--       10 (stock leaves only through movements), MJ L-0163 (the salon's acknowledgment in
--       Phase 1 is the receiver's name with GPS and server time; an OTP comes with SMS).
--
-- A delivery takes some or all of what is left on a confirmed order. The rep delivers its own
-- orders from its own bag during an open day; the office delivers from a warehouse. Each line
-- leaves as one `sale` movement, so the negative-stock guard (migration 0008) applies; units
-- promised to a pending issue are not available. The invoice is numbered with
-- app.next_doc_number('INV') in the same transaction, so a refused delivery takes no number.
-- Deliveries, their lines and invoices never change. Deliveries keep the salon's cycle
-- estimate (basis orders) for the due-list (migration 0011).
-- =============================================================================

create type public.delivery_status as enum ('full', 'partial');

-- ------------------------------------------------------------------- tables ----
create table public.delivery (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null unique,                    -- idempotency key (H-08)
  order_id            uuid not null references public.sales_order (id),
  salon_id            uuid not null references public.salon (id),
  from_location_id    uuid not null references public.stock_location (id),
  delivered_by        uuid not null references public.user_profile (id),
  delivered_by_role   public.app_role not null,
  rep_day_id          uuid references public.rep_day (id),      -- the rep's open day; null for the office
  status              public.delivery_status not null,         -- full: this delivery completed the order
  received_by_name    text not null check (length(btrim(received_by_name)) between 2 and 80),
  lat                 numeric(9, 6) check (lat between -90 and 90),
  lng                 numeric(9, 6) check (lng between -180 and 180),
  distance_from_pin_m integer check (distance_from_pin_m >= 0),
  mock_location       boolean not null default false,
  delivered_at        timestamptz not null default now(),
  delivered_at_client timestamptz,
  constraint delivery_geo_pair check ((lat is null) = (lng is null)),
  constraint delivery_rep_shape check (
    (delivered_by_role = 'rep') = (rep_day_id is not null) and (delivered_by_role <> 'rep' or lat is not null))
);
create index delivery_order_idx on public.delivery (order_id);
create index delivery_salon_idx on public.delivery (salon_id, delivered_at);
comment on table public.delivery is
  'ORD-04. Append-only. The acknowledgment is the receiver''s name, GPS and server time (MJ L-0163); an OTP is added with SMS.';

create table public.delivery_line (
  id               uuid primary key default gen_random_uuid(),
  delivery_id      uuid not null references public.delivery (id),
  order_line_id    uuid not null references public.sales_order_line (id),
  sku_id           uuid not null references public.sku (id),
  qty              integer not null check (qty > 0),
  list_price_paisa bigint not null check (list_price_paisa > 0),
  unit_price_paisa bigint not null check (unit_price_paisa > 0 and unit_price_paisa <= list_price_paisa),
  line_total_paisa bigint not null,
  unique (delivery_id, order_line_id),
  constraint delivery_line_total check (line_total_paisa = qty * unit_price_paisa)
);
create index delivery_line_order_line_idx on public.delivery_line (order_line_id);
comment on table public.delivery_line is 'ORD-04. Append-only. Prices are the order line''s; these are also the invoice''s lines.';

create table public.invoice (
  id             uuid primary key default gen_random_uuid(),
  number         text not null unique check (number ~ '^INV-[0-9]{2}-[0-9]{6}$'),
  delivery_id    uuid not null unique references public.delivery (id),
  order_id       uuid not null references public.sales_order (id),
  salon_id       uuid not null references public.salon (id),
  rep_id         uuid not null references public.user_profile (id),
  plan           public.plan_code not null,
  subtotal_paisa bigint not null check (subtotal_paisa > 0),
  discount_paisa bigint not null check (discount_paisa >= 0),
  total_paisa    bigint not null,
  issued_by      uuid not null references public.user_profile (id),
  issued_at      timestamptz not null default now(),
  constraint invoice_total check (total_paisa = subtotal_paisa - discount_paisa and total_paisa > 0)
);
create index invoice_salon_idx on public.invoice (salon_id, issued_at);
create index invoice_order_idx on public.invoice (order_id);
comment on table public.invoice is
  'ORD-04, ADM-03. Immutable (doc 04): corrections are credit notes (Phase 2). One per delivery; the number is gapless per financial year.';

create trigger append_only before update or delete on public.delivery      for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.delivery              for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.delivery_line for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.delivery_line         for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.invoice       for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.invoice               for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on public.delivery      for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.delivery_line for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.invoice       for each row execute function control.audit_row();

-- ------------------------------------------------------------------ helpers ----
-- What is left to deliver on each line of an order.
create function app.order_lines_left(p_order_id uuid)
returns table (order_line_id uuid, line_no integer, sku_id uuid, ordered integer, delivered integer, remaining integer,
               list_price_paisa bigint, unit_price_paisa bigint)
language sql stable security definer set search_path = '' as $$
  select l.id, l.line_no, l.sku_id, l.qty,
         coalesce((select sum(d.qty) from public.delivery_line d where d.order_line_id = l.id), 0)::integer,
         l.qty - coalesce((select sum(d.qty) from public.delivery_line d where d.order_line_id = l.id), 0)::integer,
         l.list_price_paisa, l.unit_price_paisa
  from public.sales_order_line l
  where l.order_id = p_order_id
  order by l.line_no
$$;

-- Internal: the one path that delivers. Checks what is left, moves the stock, numbers the
-- invoice, moves the order and the salon forward, keeps the cycle estimates.
create function app.deliver(
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

-- ------------------------------------------------------------------ delivery ----
-- The rep delivers its own confirmed order from its own bag during an open day, for a salon it
-- can reach, with the receiver's name and GPS (MJ L-0163). p_lines null: everything left.
-- Idempotent on client_id: a replay returns the same invoice.
create function app.rep_deliver(
  p_client_id uuid, p_order_id uuid, p_received_by_name text, p_lat numeric, p_lng numeric,
  p_lines jsonb default null, p_mock_location boolean default false, p_delivered_at_client timestamptz default null)
returns public.invoice
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  d      public.delivery;
  o      public.sales_order;
  v_day  uuid;
  v_bag  uuid := app.my_bag_id();
begin
  if v_role <> 'rep' then perform app.raise_denied('reps deliver from their bag; the office uses office_deliver'); end if;
  select * into d from public.delivery where client_id = p_client_id;
  if d.id is not null then
    if d.order_id = p_order_id and d.delivered_by = auth.uid() then
      return (select i from public.invoice i where i.delivery_id = d.id);          -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  select * into o from public.sales_order where id = p_order_id;
  if o.id is null or o.rep_id <> auth.uid() then perform app.raise_denied('reps deliver only their own orders'); end if;
  v_day := app.my_open_day_id();
  if v_day is null then perform app.raise_denied('check in before delivering (PIP-09)'); end if;
  if not app.rep_can_reach_salon(o.salon_id) then
    perform app.raise_denied('reps deliver only to salons in their own territories');
  end if;
  if v_bag is null then perform app.raise_denied('this rep has no bag to deliver from'); end if;
  if p_lat is null or p_lng is null then
    raise exception using errcode = '22023', message = 'GPS is required for a delivery (MJ L-0163)';
  end if;
  return app.deliver(p_client_id, p_order_id, v_bag, p_lines, p_received_by_name, p_lat, p_lng, p_mock_location,
                     p_delivered_at_client, v_day);
end $$;

-- The office delivers a confirmed order from a warehouse (doc 06: on behalf, recorded with the
-- office role). GPS is optional: it may be recorded after the driver returns.
create function app.office_deliver(
  p_client_id uuid, p_order_id uuid, p_warehouse_id uuid, p_received_by_name text,
  p_lines jsonb default null, p_lat numeric default null, p_lng numeric default null)
returns public.invoice
language plpgsql security definer set search_path = '' as $$
declare d public.delivery;
begin
  perform app.assert_office();
  select * into d from public.delivery where client_id = p_client_id;
  if d.id is not null then
    if d.order_id = p_order_id and d.delivered_by = auth.uid() then
      return (select i from public.invoice i where i.delivery_id = d.id);          -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if not exists (select 1 from public.stock_location l where l.id = p_warehouse_id and l.kind = 'warehouse' and l.active) then
    raise exception using errcode = '22023', message = 'the office delivers from an active warehouse';
  end if;
  return app.deliver(p_client_id, p_order_id, p_warehouse_id, p_lines, p_received_by_name, p_lat, p_lng, false, null, null);
end $$;

-- ---------------------------------------------------------------------- reads ----
-- What is left on an order, for its rep or the office.
create function app.order_remaining(p_order_id uuid)
returns table (line_no integer, sku_id uuid, ordered integer, delivered integer, remaining integer)
language sql stable security definer set search_path = '' as $$
  select x.line_no, x.sku_id, x.ordered, x.delivered, x.remaining
  from app.order_lines_left(p_order_id) x
  where app.is_office() or exists (
    select 1 from public.sales_order o
    where o.id = p_order_id and o.rep_id = auth.uid() and app.user_role() = 'rep' and app.self_ok())
$$;

-- ---------------------------------------------------------------------- RLS -----
alter table public.delivery      enable row level security;
alter table public.delivery      force  row level security;
alter table public.delivery_line enable row level security;
alter table public.delivery_line force  row level security;
alter table public.invoice       enable row level security;
alter table public.invoice       force  row level security;

-- A rep reads the deliveries and invoices of its own orders; the office reads all.
create policy delivery_select on public.delivery for select to authenticated
  using ((select app.is_office()) or exists (
    select 1 from public.sales_order o where o.id = order_id and o.rep_id = (select auth.uid()) and (select app.self_ok())));
create policy delivery_line_select on public.delivery_line for select to authenticated
  using ((select app.is_office()) or exists (
    select 1 from public.delivery d join public.sales_order o on o.id = d.order_id
    where d.id = delivery_id and o.rep_id = (select auth.uid()) and (select app.self_ok())));
create policy invoice_select on public.invoice for select to authenticated
  using ((select app.is_office()) or (rep_id = (select auth.uid()) and (select app.self_ok())));

-- ----------------------------------------------------------------- privileges ----
revoke all on public.delivery, public.delivery_line, public.invoice from public, anon, authenticated, service_role;
grant select on public.delivery, public.delivery_line, public.invoice to authenticated, service_role;

revoke execute on function
  app.order_lines_left(uuid),
  app.deliver(uuid, uuid, uuid, jsonb, text, numeric, numeric, boolean, timestamptz, uuid),
  app.rep_deliver(uuid, uuid, text, numeric, numeric, jsonb, boolean, timestamptz),
  app.office_deliver(uuid, uuid, uuid, text, jsonb, numeric, numeric),
  app.order_remaining(uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  app.rep_deliver(uuid, uuid, text, numeric, numeric, jsonb, boolean, timestamptz),
  app.office_deliver(uuid, uuid, uuid, text, jsonb, numeric, numeric),
  app.order_remaining(uuid)
  to authenticated;
