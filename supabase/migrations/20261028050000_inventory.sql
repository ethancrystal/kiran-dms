-- =============================================================================
-- Kiran DMS · migration 0008 · Inventory (task P1-04) and lost-demand capture
-- Requirements: INV-01 (catalogue), INV-02 (locations), INV-03 (append-only movements),
--               INV-04 (stock on hand; reps see their bag and warehouse availability),
--               INV-05 (daily close), INV-06 (manual reorder points, low stock),
--               CTL-05 (bag value limit, two-party issue, spot checks),
--               DEM-01 (lost demand tapped during a visit; DEM-02/03 build on this table)
-- Decisions: D-15 to D-20 (ACTIVITY L-0128). Docs: 04 (stock), 10, 13 §9.
--
-- Same conventions as migration 0001: RLS enabled and forced on every table; no
-- INSERT/UPDATE/DELETE for application roles; writes only through SECURITY DEFINER
-- functions in `app` with `set search_path = ''`; audit trigger on every table;
-- append-only tables also refuse UPDATE, DELETE and TRUNCATE for every role.
--
-- Stock integrity is enforced in the schema, not only in the functions:
--   * quantities are always positive; direction comes from from/to locations;
--   * a movement may never leave its source location below zero (trigger, all roles);
--   * stock reaches or leaves a rep bag only through a two-party stock_issue that the
--     rep confirms with a matching count (CTL-05);
--   * adjustments (including opening stock) need an approved `adjustment` request,
--     each request is used at most once (unique approval_id), and the owner threshold
--     (approval.stock_adjustment.owner_above, doc 13 §9) is re-checked at use: a
--     request that now needs the owner fails unless the owner decided it.
-- Agent prices, sales and agent purchases come with P1-06 and P1-15; the movement
-- kinds exist now so the enum never has to change shape.
-- =============================================================================

-- ------------------------------------------------------------------ types ----
create type public.stock_location_kind as enum ('warehouse', 'rep_bag', 'quarantine', 'damaged');
create type public.stock_movement_kind as enum (
  'receipt', 'issue_to_rep', 'sale', 'return_in', 'return_to_warehouse', 'quarantine',
  'write_off', 'adjustment', 'transfer', 'sale_to_agent');
create type public.stock_issue_direction as enum ('to_rep', 'to_warehouse');
create type public.stock_issue_status    as enum ('pending', 'confirmed', 'disputed', 'cancelled');
create type public.stock_count_kind      as enum ('daily_close', 'spot_check', 'cycle_count', 'stock_take');
create type public.demand_reason  as enum ('not_in_bag', 'out_of_stock', 'not_in_catalogue', 'price', 'supply_short', 'other');
create type public.demand_source  as enum ('visit_tap', 'order_shortfall', 'delivery_shortfall',
                                           'agent_purchase_shortfall', 'bag_load_shortfall');
create type public.demand_outcome as enum ('lost', 'backordered');

-- ---------------------------------------------------------------- catalogue ----
create table public.product_group (
  id                 uuid primary key,
  name               text not null unique check (length(btrim(name)) between 2 and 60),
  default_cycle_days integer not null check (default_cycle_days between 1 and 365),
  active             boolean not null default true,
  created_by         uuid not null references public.user_profile (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.product_group is
  'INV-01. default_cycle_days seeds the due-list (PIP-05 thin, D-19). Values are [Dummy] until OQ-16.';

create table public.product (
  id               uuid primary key,
  product_group_id uuid not null references public.product_group (id),
  brand_label      text not null check (length(btrim(brand_label)) between 2 and 60),
  name             text not null check (length(btrim(name)) between 2 and 120),
  active           boolean not null default true,
  created_by       uuid not null references public.user_profile (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.product is 'INV-01. brand_label is Kiran''s public label; no other party is ever named here (doc 07).';

create table public.sku (
  id               uuid primary key,
  product_id       uuid not null references public.product (id),
  code             text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'),
  variant          text not null check (length(btrim(variant)) between 1 and 80),
  unit             text not null check (unit in ('ml', 'l', 'g', 'kg', 'pack', 'piece')),
  size_value       numeric(10, 3) check (size_value > 0),
  units_per_carton integer check (units_per_carton > 0),
  barcode          text unique check (barcode ~ '^[0-9A-Za-z-]{4,32}$'),
  list_price_paisa bigint check (list_price_paisa > 0),          -- null: not priced yet, cannot be issued or sold
  active           boolean not null default true,
  created_by       uuid not null references public.user_profile (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.sku is
  'INV-01. Prices in integer paisa, set by the owner only (price lists are governance, doc 06 §2). The agent price is a separate table (P1-15) so reps never read it.';

-- ---------------------------------------------------------------- locations ----
create table public.stock_location (
  id                    uuid primary key,
  kind                  public.stock_location_kind not null,
  name                  text not null check (length(btrim(name)) between 2 and 80),
  owner_user_id         uuid references public.user_profile (id),
  bag_value_limit_paisa bigint check (bag_value_limit_paisa >= 0),
  active                boolean not null default true,
  created_by            uuid not null references public.user_profile (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint stock_location_bag_owner check ((kind = 'rep_bag') = (owner_user_id is not null)),
  constraint stock_location_bag_limit check (kind = 'rep_bag' or bag_value_limit_paisa is null),
  constraint stock_location_bag_has_limit check (kind <> 'rep_bag' or bag_value_limit_paisa is not null)
);
create unique index stock_location_one_bag_per_rep on public.stock_location (owner_user_id) where kind = 'rep_bag';
comment on table public.stock_location is
  'INV-02. One rep_bag per rep (CTL-05 bag value limit at list price). Independent agents have no location: their stock is theirs (D-15).';

-- ---------------------------------------------------------------- movements ----
create table public.stock_movement (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null unique,                       -- idempotency key (H-08)
  sku_id           uuid not null references public.sku (id),
  qty              integer not null check (qty > 0),
  from_location_id uuid references public.stock_location (id),
  to_location_id   uuid references public.stock_location (id),
  kind             public.stock_movement_kind not null,
  source_type      text check (source_type ~ '^[a-z_]+$'),
  source_id        uuid,
  approval_id      uuid references control.approval_request (id),
  reason           text check (length(reason) <= 300),
  actor_id         uuid not null references public.user_profile (id),
  created_at       timestamptz not null default now(),
  constraint stock_movement_has_side check (from_location_id is not null or to_location_id is not null),
  constraint stock_movement_two_sides_differ check (from_location_id is distinct from to_location_id),
  constraint stock_movement_kind_shape check (
    case kind
      when 'issue_to_rep'        then from_location_id is not null and to_location_id is not null
      when 'return_to_warehouse' then from_location_id is not null and to_location_id is not null
      when 'transfer'            then from_location_id is not null and to_location_id is not null
      when 'sale'                then from_location_id is not null and to_location_id is null
      when 'sale_to_agent'       then from_location_id is not null and to_location_id is null
      when 'receipt'             then from_location_id is null     and to_location_id is not null
      when 'return_in'           then from_location_id is null     and to_location_id is not null
      when 'adjustment'          then (from_location_id is null) <> (to_location_id is null) and approval_id is not null
      else true
    end)
);
-- Each approval authorizes at most one movement (single use; RFC issue 4).
create unique index stock_movement_one_use_per_approval on public.stock_movement (approval_id) where approval_id is not null;
create index stock_movement_from_idx on public.stock_movement (from_location_id, sku_id) where from_location_id is not null;
create index stock_movement_to_idx   on public.stock_movement (to_location_id, sku_id)   where to_location_id is not null;
create index stock_movement_sku_idx  on public.stock_movement (sku_id);
create index stock_movement_actor_idx on public.stock_movement (actor_id);
comment on table public.stock_movement is
  'INV-03. Append-only (doc 04 invariant 1). Stock on hand = Σ in − Σ out per location and SKU; never stored.';

-- --------------------------------------------------- two-party issue/return ----
create table public.stock_issue (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null unique,
  direction          public.stock_issue_direction not null,
  warehouse_id       uuid not null references public.stock_location (id),
  bag_id             uuid not null references public.stock_location (id),
  lines              jsonb not null,                            -- [{sku_id, qty}], normalised by the issuing function
  route_date         date,
  suggestion         jsonb,                                     -- INV-11 bag-load suggestion it came from (P1-17)
  issued_by          uuid not null references public.user_profile (id),
  status             public.stock_issue_status not null default 'pending',
  counted_lines      jsonb,
  decided_by         uuid references public.user_profile (id),
  decided_at         timestamptz,
  decision_note      text check (length(decision_note) <= 300),
  created_at         timestamptz not null default now(),
  constraint stock_issue_lines_array check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0),
  constraint stock_issue_decision_shape check (
    (status = 'pending' and decided_by is null and decided_at is null) or
    (status <> 'pending' and decided_by is not null and decided_at is not null))
);
create index stock_issue_bag_idx on public.stock_issue (bag_id, status);
comment on table public.stock_issue is
  'CTL-05 two-party custody: the office proposes, the rep confirms the count, and only then do movements post. Changes once: pending → confirmed / disputed / cancelled; disputed → cancelled.';

-- ------------------------------------------------------------------- counts ----
create table public.stock_count (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null unique,
  location_id    uuid not null references public.stock_location (id),
  kind           public.stock_count_kind not null,
  counted_by     uuid not null references public.user_profile (id),
  lines          jsonb not null,                                -- [{sku_id, expected, counted}]
  variance_units integer not null,                              -- Σ |counted − expected|
  counted_at_client timestamptz,
  created_at     timestamptz not null default now()
);
create index stock_count_location_idx on public.stock_count (location_id, created_at);
comment on table public.stock_count is
  'INV-05, CTL-05. Append-only. A count never changes stock: a variance becomes an approval-gated adjustment and a digest line (doc 10 §4).';

-- ------------------------------------------------------------ reorder rules ----
create table public.reorder_rule (
  id            uuid primary key default gen_random_uuid(),
  sku_id        uuid not null unique references public.sku (id),
  reorder_point integer not null check (reorder_point >= 0),
  method        text not null default 'manual' check (method in ('manual', 'computed')),
  updated_by    uuid not null references public.user_profile (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.reorder_rule is 'INV-06. Manual in Phase 1; computed from unconstrained demand in Phase 2 (doc 10 §6).';

-- -------------------------------------------------------------- lost demand ----
create table public.demand_signal (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null unique,
  sku_id             uuid references public.sku (id),
  product_group_id   uuid references public.product_group (id),
  qty                integer not null check (qty between 1 and 100000),
  reason             public.demand_reason not null,
  source             public.demand_source not null,
  outcome            public.demand_outcome not null default 'lost',
  salon_id           uuid,                                      -- FK added with salons (P1-02)
  location_id        uuid references public.stock_location (id),
  source_id          uuid,
  captured_by        uuid not null references public.user_profile (id),
  captured_at_client timestamptz,
  created_at         timestamptz not null default now(),
  -- An item Kiran does not carry is recorded by product group, never as free text (H-27).
  constraint demand_signal_item check (
    (reason = 'not_in_catalogue' and sku_id is null and product_group_id is not null) or
    (reason <> 'not_in_catalogue' and sku_id is not null and product_group_id is null))
);
create index demand_signal_sku_idx on public.demand_signal (sku_id, created_at) where sku_id is not null;
create index demand_signal_captured_by_idx on public.demand_signal (captured_by);
comment on table public.demand_signal is
  'DEM-01 to DEM-03. Append-only lost demand. Unconstrained demand = delivered + lost feeds reorder points (doc 10 §6, D-18).';

-- ------------------------------------------------------------------- guards ----
-- Master data: never deleted (H-07), identity immutable, updated_at kept by the database.
create function control.master_row_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501',
      message = format('DELETE on %I.%I is not allowed: deactivate instead (H-07)', tg_table_schema, tg_table_name);
  end if;
  if new.id <> old.id or new.created_at <> old.created_at
     or (to_jsonb(new) ->> 'created_by') is distinct from (to_jsonb(old) ->> 'created_by') then
    raise exception using errcode = '42501',
      message = format('identity columns of %I.%I are immutable', tg_table_schema, tg_table_name);
  end if;
  new.updated_at := now();
  return new;
end $$;

create function control.stock_location_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind <> old.kind or new.owner_user_id is distinct from old.owner_user_id then
    raise exception using errcode = '42501', message = 'a stock location''s kind and owner never change';
  end if;
  return new;
end $$;

-- A movement may never leave its source location below zero (doc 10 §3). Serialised per
-- source location by locking its row, so two concurrent movements cannot both pass.
create function control.stock_movement_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_on_hand bigint;
begin
  if new.from_location_id is not null then
    perform 1 from public.stock_location l where l.id = new.from_location_id for update;
    select coalesce(sum(case when m.to_location_id = new.from_location_id then m.qty else -m.qty end), 0)
      into v_on_hand
      from public.stock_movement m
     where m.sku_id = new.sku_id
       and (m.to_location_id = new.from_location_id or m.from_location_id = new.from_location_id);
    if v_on_hand < new.qty then
      raise exception using errcode = '23514',
        message = format('insufficient stock: %s on hand, %s requested', v_on_hand, new.qty);
    end if;
  end if;
  return new;
end $$;

create function control.stock_issue_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'stock issues are never deleted';
  end if;
  if (new.id, new.client_id, new.direction, new.warehouse_id, new.bag_id, new.lines, new.route_date,
      new.suggestion, new.issued_by, new.created_at)
     is distinct from
     (old.id, old.client_id, old.direction, old.warehouse_id, old.bag_id, old.lines, old.route_date,
      old.suggestion, old.issued_by, old.created_at) then
    raise exception using errcode = '42501', message = 'stock issue identity is immutable';
  end if;
  if not ((old.status = 'pending'  and new.status in ('confirmed', 'disputed', 'cancelled'))
       or (old.status = 'disputed' and new.status = 'cancelled')) then
    raise exception using errcode = '42501',
      message = format('stock issue cannot move from %s to %s', old.status, new.status);
  end if;
  return new;
end $$;

create trigger master_row_guard before update or delete on public.product_group  for each row execute function control.master_row_guard();
create trigger master_row_guard before update or delete on public.product        for each row execute function control.master_row_guard();
create trigger master_row_guard before update or delete on public.sku            for each row execute function control.master_row_guard();
create trigger master_row_guard before update or delete on public.stock_location for each row execute function control.master_row_guard();
create trigger master_row_guard before update or delete on public.reorder_rule   for each row execute function control.master_row_guard();
create trigger stock_location_guard before update on public.stock_location for each row execute function control.stock_location_guard();

create trigger stock_movement_guard before insert on public.stock_movement for each row execute function control.stock_movement_guard();
create trigger stock_issue_guard before update or delete on public.stock_issue for each row execute function control.stock_issue_guard();

-- Append-only (H-06): UPDATE, DELETE and TRUNCATE refused for every role.
create trigger append_only before update or delete on public.stock_movement for each row execute function control.forbid_mutation();
create trigger append_only before update or delete on public.stock_count    for each row execute function control.forbid_mutation();
create trigger append_only before update or delete on public.demand_signal  for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.stock_movement for each statement execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.stock_count    for each statement execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.demand_signal  for each statement execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.stock_issue    for each statement execute function control.forbid_mutation();

create trigger audit after insert or update or delete on public.product_group  for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.product        for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.sku            for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.stock_location for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.stock_movement for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.stock_issue    for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.stock_count    for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.reorder_rule   for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.demand_signal  for each row execute function control.audit_row();

-- ------------------------------------------------------------ internal helpers ----
-- The caller's own rep bag (null for non-reps or a rep without a bag).
create function app.my_bag_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select l.id from public.stock_location l
  where l.kind = 'rep_bag' and l.owner_user_id = auth.uid() and app.user_role() = 'rep'
$$;

create function app.on_hand(p_location uuid, p_sku uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when m.to_location_id = p_location then m.qty else -m.qty end), 0)
  from public.stock_movement m
  where m.sku_id = p_sku and (m.to_location_id = p_location or m.from_location_id = p_location)
$$;

-- Units already promised by pending issues out of a warehouse (or back from a bag).
create function app.pending_out(p_location uuid, p_sku uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum((e ->> 'qty')::bigint), 0)
  from public.stock_issue i, jsonb_array_elements(i.lines) e
  where i.status = 'pending' and (e ->> 'sku_id')::uuid = p_sku
    and ((i.direction = 'to_rep' and i.warehouse_id = p_location)
      or (i.direction = 'to_warehouse' and i.bag_id = p_location))
$$;

-- Normalise [{sku_id, qty}]: valid ids, positive integer quantities, duplicates summed.
-- p_allow_zero (counts): zero quantities and an empty list are accepted.
create function app.parse_lines(p_lines jsonb, p_allow_zero boolean default false)
returns table (sku_id uuid, qty bigint)
language plpgsql stable security definer set search_path = '' as $$
declare e jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or (jsonb_array_length(p_lines) = 0 and not p_allow_zero) then
    raise exception using errcode = '22023', message = 'lines must be a non-empty array of {sku_id, qty}';
  end if;
  for e in select * from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(e) <> 'object' or coalesce(jsonb_typeof(e -> 'qty'), '') <> 'number'
       or (e ->> 'qty')::numeric <> trunc((e ->> 'qty')::numeric)
       or (e ->> 'qty')::numeric < (case when p_allow_zero then 0 else 1 end)
       or (e ->> 'qty')::numeric > 100000
       or coalesce(e ->> 'sku_id', '') !~ '^[0-9a-fA-F-]{36}$' then
      raise exception using errcode = '22023', message = 'each line needs a sku_id and a whole quantity';
    end if;
    if not exists (select 1 from public.sku s where s.id = (e ->> 'sku_id')::uuid) then
      raise exception using errcode = '22023', message = 'unknown sku in lines';
    end if;
  end loop;
  return query
    select (x ->> 'sku_id')::uuid, sum((x ->> 'qty')::bigint)::bigint
    from jsonb_array_elements(p_lines) x group by 1 order by 1;
end $$;

create function app.assert_reason(p_reason text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode = '23514', message = 'a reason of at least 3 characters is required';
  end if;
end $$;

-- ------------------------------------------------------ catalogue functions ----
create function app.office_upsert_product_group(p_id uuid, p_name text, p_default_cycle_days integer, p_active boolean default true)
returns public.product_group
language plpgsql security definer set search_path = '' as $$
declare v public.product_group;
begin
  perform app.assert_office();
  perform app.set_purpose('catalogue: product group');
  insert into public.product_group as g (id, name, default_cycle_days, active, created_by)
  values (p_id, p_name, p_default_cycle_days, coalesce(p_active, true), auth.uid())
  on conflict (id) do update
     set name = excluded.name, default_cycle_days = excluded.default_cycle_days, active = excluded.active
  returning * into v;
  return v;
end $$;

create function app.office_upsert_product(p_id uuid, p_product_group_id uuid, p_brand_label text, p_name text,
                                          p_active boolean default true)
returns public.product
language plpgsql security definer set search_path = '' as $$
declare v public.product;
begin
  perform app.assert_office();
  perform app.set_purpose('catalogue: product');
  insert into public.product as p (id, product_group_id, brand_label, name, active, created_by)
  values (p_id, p_product_group_id, p_brand_label, p_name, coalesce(p_active, true), auth.uid())
  on conflict (id) do update
     set product_group_id = excluded.product_group_id, brand_label = excluded.brand_label,
         name = excluded.name, active = excluded.active
  returning * into v;
  return v;
end $$;

-- Structure only; prices are owner-only (app.owner_set_sku_price).
create function app.office_upsert_sku(p_id uuid, p_product_id uuid, p_code text, p_variant text, p_unit text,
                                      p_size_value numeric default null, p_units_per_carton integer default null,
                                      p_barcode text default null, p_active boolean default true)
returns public.sku
language plpgsql security definer set search_path = '' as $$
declare v public.sku;
begin
  perform app.assert_office();
  perform app.set_purpose('catalogue: sku');
  insert into public.sku as s (id, product_id, code, variant, unit, size_value, units_per_carton, barcode, active, created_by)
  values (p_id, p_product_id, p_code, p_variant, p_unit, p_size_value, p_units_per_carton, p_barcode,
          coalesce(p_active, true), auth.uid())
  on conflict (id) do update
     set product_id = excluded.product_id, code = excluded.code, variant = excluded.variant, unit = excluded.unit,
         size_value = excluded.size_value, units_per_carton = excluded.units_per_carton,
         barcode = excluded.barcode, active = excluded.active
  returning * into v;
  return v;
end $$;

create function app.owner_set_sku_price(p_sku_id uuid, p_list_price_paisa bigint, p_reason text)
returns public.sku
language plpgsql security definer set search_path = '' as $$
declare v public.sku;
begin
  perform app.assert_owner();
  perform app.assert_reason(p_reason);
  perform app.set_purpose('price list: ' || p_reason);
  update public.sku set list_price_paisa = p_list_price_paisa where id = p_sku_id returning * into v;
  if v.id is null then raise exception using errcode = '22023', message = 'unknown sku'; end if;
  return v;
end $$;

-- ------------------------------------------------------- location functions ----
create function app.office_create_location(p_id uuid, p_kind public.stock_location_kind, p_name text,
                                           p_owner_user_id uuid default null, p_bag_value_limit_paisa bigint default null)
returns public.stock_location
language plpgsql security definer set search_path = '' as $$
declare v public.stock_location;
begin
  perform app.assert_office();
  -- A rep bag's value limit caps the stock a rep is trusted with (CTL-05). The docs are silent
  -- on who sets it, so the restrictive reading applies (ACTIVITY §1, A-08): owner only.
  if p_kind = 'rep_bag' and not app.is_owner() then
    perform app.raise_denied('rep bags and their value limits are set by the owner (A-08)');
  end if;
  select * into v from public.stock_location where id = p_id;
  if v.id is not null then
    if v.kind = p_kind and v.owner_user_id is not distinct from p_owner_user_id then return v; end if;  -- replay
    raise exception using errcode = '23505', message = 'location id already used';
  end if;
  if p_kind = 'rep_bag' and not exists (
       select 1 from public.user_profile u where u.id = p_owner_user_id and u.role = 'rep' and u.status = 'active') then
    raise exception using errcode = '22023', message = 'a rep bag belongs to an active rep';
  end if;
  perform app.set_purpose('stock location: ' || p_kind::text);
  insert into public.stock_location (id, kind, name, owner_user_id, bag_value_limit_paisa, created_by)
  values (p_id, p_kind, p_name, p_owner_user_id, p_bag_value_limit_paisa, auth.uid())
  returning * into v;
  return v;
end $$;

create function app.owner_set_bag_limit(p_location_id uuid, p_bag_value_limit_paisa bigint, p_reason text)
returns public.stock_location
language plpgsql security definer set search_path = '' as $$
declare v public.stock_location;
begin
  perform app.assert_owner();                                      -- A-08
  perform app.assert_reason(p_reason);
  perform app.set_purpose('bag value limit: ' || p_reason);
  update public.stock_location set bag_value_limit_paisa = p_bag_value_limit_paisa
   where id = p_location_id and kind = 'rep_bag' returning * into v;
  if v.id is null then raise exception using errcode = '22023', message = 'unknown rep bag'; end if;
  return v;
end $$;

-- ----------------------------------------------------- two-party issue/return ----
-- Office proposes stock for a rep bag (to_rep) or records what a rep hands back
-- (to_warehouse). Nothing moves until the rep confirms the same count.
create function app.office_propose_stock_issue(
  p_client_id uuid, p_direction public.stock_issue_direction, p_warehouse_id uuid, p_bag_id uuid,
  p_lines jsonb, p_route_date date default null, p_note text default null)
returns public.stock_issue
language plpgsql security definer set search_path = '' as $$
declare
  v        public.stock_issue;
  v_bag    public.stock_location;
  v_lines  jsonb;
  r        record;
  v_source uuid;
  v_value  bigint := 0;
begin
  perform app.assert_office();
  select * into v from public.stock_issue where client_id = p_client_id;
  if v.id is not null then
    if v.issued_by = auth.uid() then return v; end if;                     -- replay
    raise exception using errcode = '23505', message = 'client_id already used';
  end if;
  select * into v_bag from public.stock_location where id = p_bag_id and kind = 'rep_bag' and active for update;
  if v_bag.id is null then raise exception using errcode = '22023', message = 'unknown or inactive rep bag'; end if;
  if not exists (select 1 from public.stock_location where id = p_warehouse_id and kind = 'warehouse' and active) then
    raise exception using errcode = '22023', message = 'unknown or inactive warehouse';
  end if;
  if v_bag.owner_user_id = auth.uid() then perform app.raise_denied('you cannot issue stock to your own bag'); end if;

  v_source := case when p_direction = 'to_rep' then p_warehouse_id else p_bag_id end;
  perform 1 from public.stock_location where id = v_source for update;    -- serialise reservations
  for r in select * from app.parse_lines(p_lines) loop
    if p_direction = 'to_rep' and not exists (
         select 1 from public.sku s where s.id = r.sku_id and s.active and s.list_price_paisa is not null) then
      raise exception using errcode = '22023', message = 'only active, priced SKUs can be issued';
    end if;
    if app.on_hand(v_source, r.sku_id) - app.pending_out(v_source, r.sku_id) < r.qty then
      raise exception using errcode = '23514', message = 'insufficient available stock for this issue';
    end if;
  end loop;
  select jsonb_agg(jsonb_build_object('sku_id', x.sku_id, 'qty', x.qty) order by x.sku_id) into v_lines
    from app.parse_lines(p_lines) x;

  if p_direction = 'to_rep' then
    -- CTL-05: bag value at list price, after this issue and any pending ones, within the limit.
    select coalesce(sum(s.list_price_paisa *
             (app.on_hand(p_bag_id, s.id)
              + coalesce((select sum((e ->> 'qty')::bigint) from public.stock_issue i, jsonb_array_elements(i.lines) e
                          where i.bag_id = p_bag_id and i.status = 'pending' and i.direction = 'to_rep'
                            and (e ->> 'sku_id')::uuid = s.id), 0)
              + coalesce((select x.qty from app.parse_lines(p_lines) x where x.sku_id = s.id), 0))), 0)
      into v_value
      from public.sku s where s.list_price_paisa is not null;
    if v_value > v_bag.bag_value_limit_paisa then
      raise exception using errcode = '23514',
        message = format('bag value limit exceeded: %s paisa after this issue, limit %s', v_value, v_bag.bag_value_limit_paisa);
    end if;
  end if;

  perform app.set_purpose('stock issue proposed: ' || p_direction::text);
  insert into public.stock_issue (client_id, direction, warehouse_id, bag_id, lines, route_date, issued_by, decision_note)
  values (p_client_id, p_direction, p_warehouse_id, p_bag_id, v_lines, p_route_date, auth.uid(), p_note)
  returning * into v;
  return v;
end $$;

-- The rep confirms with their own count. Same count → movements post; otherwise the
-- issue is disputed and nothing moves (the office cancels and proposes again).
create function app.rep_confirm_stock_issue(p_issue_id uuid, p_counted jsonb)
returns public.stock_issue
language plpgsql security definer set search_path = '' as $$
declare
  v_role    public.app_role := app.assert_actor_ready();
  v         public.stock_issue;
  v_counted jsonb;
  e         jsonb;
  v_match   boolean;
begin
  if v_role <> 'rep' then perform app.raise_denied('only the receiving rep confirms a stock issue'); end if;
  select * into v from public.stock_issue where id = p_issue_id for update;
  if v.id is null or v.bag_id is distinct from app.my_bag_id() then
    perform app.raise_denied('this stock issue is not for your bag');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('sku_id', x.sku_id, 'qty', x.qty) order by x.sku_id), '[]'::jsonb)
    into v_counted
    from app.parse_lines(p_counted, true) x where x.qty > 0;
  if v.status <> 'pending' then
    if v.counted_lines = v_counted then return v; end if;                   -- replay
    perform app.raise_denied('stock issue already decided');
  end if;
  v_match := v_counted = v.lines;
  perform app.set_purpose(case when v_match then 'stock issue confirmed by rep' else 'stock issue disputed by rep' end);
  if v_match then
    for e in select * from jsonb_array_elements(v.lines) loop
      insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind,
                                         source_type, source_id, actor_id)
      values (gen_random_uuid(), (e ->> 'sku_id')::uuid, (e ->> 'qty')::integer,
              case when v.direction = 'to_rep' then v.warehouse_id else v.bag_id end,
              case when v.direction = 'to_rep' then v.bag_id else v.warehouse_id end,
              case when v.direction = 'to_rep' then 'issue_to_rep'::public.stock_movement_kind
                   else 'return_to_warehouse'::public.stock_movement_kind end,
              'stock_issue', v.id, auth.uid());
    end loop;
  end if;
  update public.stock_issue
     set status = case when v_match then 'confirmed'::public.stock_issue_status else 'disputed'::public.stock_issue_status end,
         counted_lines = v_counted, decided_by = auth.uid(), decided_at = now()
   where id = v.id returning * into v;
  return v;
end $$;

create function app.office_cancel_stock_issue(p_issue_id uuid, p_reason text)
returns public.stock_issue
language plpgsql security definer set search_path = '' as $$
declare v public.stock_issue;
begin
  perform app.assert_office();
  perform app.assert_reason(p_reason);
  select * into v from public.stock_issue where id = p_issue_id for update;
  if v.id is null then raise exception using errcode = '22023', message = 'unknown stock issue'; end if;
  if v.status = 'cancelled' then return v; end if;
  if v.status not in ('pending', 'disputed') then perform app.raise_denied('a confirmed stock issue cannot be cancelled'); end if;
  perform app.set_purpose('stock issue cancelled: ' || p_reason);
  update public.stock_issue
     set status = 'cancelled', decided_by = auth.uid(), decided_at = now(),
         decision_note = left(p_reason, 300)
   where id = v.id returning * into v;
  return v;
end $$;

-- ------------------------------------------------------------------- counts ----
create function app.record_count(p_client_id uuid, p_location_id uuid, p_kind public.stock_count_kind,
                                 p_counted jsonb, p_counted_at_client timestamptz default null)
returns public.stock_count
language plpgsql security definer set search_path = '' as $$
declare
  v_role  public.app_role := app.assert_actor_ready();
  v       public.stock_count;
  v_loc   public.stock_location;
  v_lines jsonb;
  v_var   integer;
begin
  select * into v from public.stock_count where client_id = p_client_id;
  if v.id is not null then
    if v.counted_by = auth.uid() then return v; end if;                     -- replay
    raise exception using errcode = '23505', message = 'client_id already used';
  end if;
  select * into v_loc from public.stock_location where id = p_location_id;
  if v_loc.id is null then raise exception using errcode = '22023', message = 'unknown location'; end if;
  if v_role = 'rep' then
    if p_kind <> 'daily_close' or v_loc.id is distinct from app.my_bag_id() then
      perform app.raise_denied('reps record only the daily close of their own bag');
    end if;
  elsif p_kind = 'daily_close' then
    perform app.raise_denied('the daily close is recorded by the rep');
  elsif p_kind = 'spot_check' and v_loc.kind <> 'rep_bag' then
    raise exception using errcode = '22023', message = 'spot checks are for rep bags';
  end if;
  -- Expected = system on hand for every SKU present or counted; a SKU not listed counts as 0.
  with counted as (select x.sku_id, x.qty from app.parse_lines(p_counted, true) x),
       skus as (select c.sku_id from counted c
                union
                select m.sku_id from public.stock_movement m
                 where m.to_location_id = p_location_id or m.from_location_id = p_location_id),
       l as (select s.sku_id, app.on_hand(p_location_id, s.sku_id) as expected,
                    coalesce((select c.qty from counted c where c.sku_id = s.sku_id), 0) as counted
               from skus s)
  select coalesce(jsonb_agg(jsonb_build_object('sku_id', l.sku_id, 'expected', l.expected, 'counted', l.counted)
                            order by l.sku_id) filter (where l.expected <> 0 or l.counted <> 0), '[]'::jsonb),
         coalesce(sum(abs(l.counted - l.expected)), 0)::integer
    into v_lines, v_var
    from l;
  perform app.set_purpose('stock count: ' || p_kind::text);
  insert into public.stock_count (client_id, location_id, kind, counted_by, lines, variance_units, counted_at_client)
  values (p_client_id, p_location_id, p_kind, auth.uid(), v_lines, v_var, p_counted_at_client)
  returning * into v;
  return v;
end $$;

-- -------------------------------------------------------------- adjustments ----
-- Posts an approved `adjustment` request (opening stock, count variance). The request
-- payload names the SKU and the signed quantity; subject is the location. Single use is
-- the unique index on stock_movement.approval_id. The owner threshold is re-checked here:
-- if it now requires the owner, a manager's approval is not enough (fails closed).
create function app.office_post_adjustment(p_client_id uuid, p_approval_id uuid)
returns public.stock_movement
language plpgsql security definer set search_path = '' as $$
declare
  v       public.stock_movement;
  a       control.approval_request;
  v_sku   public.sku;
  v_delta bigint;
  v_cfg   jsonb;
  v_owner boolean;
begin
  perform app.assert_office();
  select * into v from public.stock_movement where client_id = p_client_id;
  if v.id is not null then
    if v.approval_id = p_approval_id then return v; end if;                 -- replay
    raise exception using errcode = '23505', message = 'client_id already used';
  end if;
  select * into a from control.approval_request where id = p_approval_id for update;
  if a.id is null or a.kind <> 'adjustment' or a.subject_type <> 'stock_location' then
    perform app.raise_denied('an approved stock adjustment request is required');
  end if;
  if a.status <> 'approved' then perform app.raise_denied('the adjustment request is not approved'); end if;
  if exists (select 1 from public.stock_movement m where m.approval_id = a.id) then
    perform app.raise_denied('this approval has already been used');
  end if;
  if coalesce(jsonb_typeof(a.payload -> 'qty_delta'), '') <> 'number' or coalesce(a.payload ->> 'sku_id', '') !~ '^[0-9a-fA-F-]{36}$' then
    raise exception using errcode = '22023', message = 'adjustment payload needs sku_id and qty_delta';
  end if;
  v_delta := (a.payload ->> 'qty_delta')::bigint;
  select * into v_sku from public.sku where id = (a.payload ->> 'sku_id')::uuid;
  if v_sku.id is null or coalesce(v_delta, 0) = 0 or abs(v_delta) > 100000 then
    raise exception using errcode = '22023', message = 'invalid adjustment payload';
  end if;
  if not exists (select 1 from public.stock_location where id = a.subject_id) then
    raise exception using errcode = '22023', message = 'unknown location';
  end if;
  -- doc 13 §9: owner above the threshold (units or value at list price). A missing or
  -- malformed threshold routes to the owner.
  select c.value into v_cfg from public.app_config c where c.key = 'approval.stock_adjustment.owner_above';
  v_owner := true;
  if jsonb_typeof(v_cfg -> 'units') = 'number' and jsonb_typeof(v_cfg -> 'paisa') = 'number'
     and v_sku.list_price_paisa is not null then
    v_owner := abs(v_delta) > (v_cfg ->> 'units')::numeric
            or abs(v_delta) * v_sku.list_price_paisa > (v_cfg ->> 'paisa')::numeric;
  end if;
  if v_owner and not exists (select 1 from public.user_profile u where u.id = a.checker_id and u.role = 'owner') then
    perform app.raise_denied('this adjustment needs the owner''s approval');
  end if;
  perform app.set_purpose('stock adjustment posted: ' || a.reason);
  insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind,
                                     source_type, source_id, approval_id, reason, actor_id)
  values (p_client_id, v_sku.id, abs(v_delta)::integer,
          case when v_delta < 0 then a.subject_id end,
          case when v_delta > 0 then a.subject_id end,
          'adjustment', 'approval_request', a.id, a.id, left(a.reason, 300), auth.uid())
  returning * into v;
  return v;
end $$;

-- ------------------------------------------------------------ reorder points ----
create function app.office_set_reorder_point(p_sku_id uuid, p_reorder_point integer)
returns public.reorder_rule
language plpgsql security definer set search_path = '' as $$
declare v public.reorder_rule;
begin
  perform app.assert_office();
  perform app.set_purpose('reorder point');
  insert into public.reorder_rule as r (sku_id, reorder_point, updated_by)
  values (p_sku_id, p_reorder_point, auth.uid())
  on conflict (sku_id) do update set reorder_point = excluded.reorder_point, updated_by = excluded.updated_by
  returning * into v;
  return v;
end $$;

-- -------------------------------------------------------------- lost demand ----
-- DEM-01: "asked for, could not sell". Reps (approved device) and office users.
create function app.record_demand(
  p_client_id uuid, p_sku_id uuid, p_product_group_id uuid, p_qty integer, p_reason public.demand_reason,
  p_salon_id uuid default null, p_captured_at_client timestamptz default null)
returns public.demand_signal
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  v      public.demand_signal;
begin
  select * into v from public.demand_signal where client_id = p_client_id;
  if v.id is not null then
    if v.captured_by = auth.uid() and v.sku_id is not distinct from p_sku_id
       and v.product_group_id is not distinct from p_product_group_id
       and v.qty = p_qty and v.reason = p_reason then
      return v;                                                             -- idempotent replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if p_reason = 'supply_short' and v_role = 'rep' then
    perform app.raise_denied('reps record out_of_stock; supply shortages are recorded by the office');
  end if;
  perform app.set_purpose('lost demand: ' || p_reason::text);
  insert into public.demand_signal (client_id, sku_id, product_group_id, qty, reason, source, salon_id,
                                    location_id, captured_by, captured_at_client)
  values (p_client_id, p_sku_id, p_product_group_id, p_qty, p_reason, 'visit_tap', p_salon_id,
          app.my_bag_id(), auth.uid(), p_captured_at_client)
  returning * into v;
  return v;
end $$;

-- ------------------------------------------------------------------- reads ----
-- INV-04: a rep's own bag, and warehouse availability as quantities only.
create function app.my_bag() returns table (sku_id uuid, code text, variant text, on_hand bigint)
language sql stable security definer set search_path = '' as $$
  select s.id, s.code, s.variant, app.on_hand(app.my_bag_id(), s.id)
  from public.sku s
  where app.self_ok() and app.my_bag_id() is not null and app.on_hand(app.my_bag_id(), s.id) <> 0
  order by s.code
$$;

create function app.warehouse_availability() returns table (sku_id uuid, code text, available bigint)
language sql stable security definer set search_path = '' as $$
  select s.id, s.code,
         greatest(0, sum(app.on_hand(l.id, s.id) - app.pending_out(l.id, s.id)))::bigint
  from public.sku s cross join public.stock_location l
  where s.active and l.kind = 'warehouse' and l.active
    and (app.self_ok() and app.user_role() is not null)
  group by s.id, s.code
  order by s.code
$$;

-- Office: stock on hand per location and SKU, and SKUs at or below their reorder point.
create function app.stock_on_hand(p_location_id uuid default null)
returns table (location_id uuid, sku_id uuid, on_hand bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
    select t.loc, t.sku, sum(t.n)::bigint
    from (
      select m.to_location_id as loc, m.sku_id as sku, m.qty::bigint as n
        from public.stock_movement m where m.to_location_id is not null
      union all
      select m.from_location_id, m.sku_id, -m.qty::bigint
        from public.stock_movement m where m.from_location_id is not null
    ) t
    where p_location_id is null or t.loc = p_location_id
    group by t.loc, t.sku
    having sum(t.n) <> 0
    order by 1, 2;
end $$;

create function app.low_stock() returns table (sku_id uuid, code text, on_hand bigint, reorder_point integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
    select s.id, s.code,
           coalesce((select sum(app.on_hand(l.id, s.id)) from public.stock_location l
                     where l.kind in ('warehouse', 'rep_bag')), 0)::bigint,
           r.reorder_point
    from public.sku s join public.reorder_rule r on r.sku_id = s.id
    where s.active
      and coalesce((select sum(app.on_hand(l.id, s.id)) from public.stock_location l
                    where l.kind in ('warehouse', 'rep_bag')), 0) <= r.reorder_point
    order by s.code;
end $$;

-- ---------------------------------------------------------------- RLS -----
alter table public.product_group  enable row level security;
alter table public.product_group  force  row level security;
alter table public.product        enable row level security;
alter table public.product        force  row level security;
alter table public.sku            enable row level security;
alter table public.sku            force  row level security;
alter table public.stock_location enable row level security;
alter table public.stock_location force  row level security;
alter table public.stock_movement enable row level security;
alter table public.stock_movement force  row level security;
alter table public.stock_issue    enable row level security;
alter table public.stock_issue    force  row level security;
alter table public.stock_count    enable row level security;
alter table public.stock_count    force  row level security;
alter table public.reorder_rule   enable row level security;
alter table public.reorder_rule   force  row level security;
alter table public.demand_signal  enable row level security;
alter table public.demand_signal  force  row level security;

-- Catalogue: office sees everything; any other active user (approved device for reps)
-- sees active rows only.
create policy product_group_select on public.product_group for select to authenticated
  using ((select app.is_office()) or (active and (select app.self_ok())));
create policy product_select on public.product for select to authenticated
  using ((select app.is_office()) or (active and (select app.self_ok())));
create policy sku_select on public.sku for select to authenticated
  using ((select app.is_office()) or (active and (select app.self_ok())));

-- Locations: reps see their own bag and the active warehouses.
create policy stock_location_select on public.stock_location for select to authenticated
  using ((select app.is_office())
         or ((select app.is_rep()) and (select app.self_ok())
             and (owner_user_id = (select auth.uid()) or (kind = 'warehouse' and active))));

-- Movements and issues: reps see only what touches their own bag.
create policy stock_movement_select on public.stock_movement for select to authenticated
  using ((select app.is_office())
         or ((select app.self_ok()) and (select app.my_bag_id()) is not null
             and (from_location_id = (select app.my_bag_id()) or to_location_id = (select app.my_bag_id()))));
create policy stock_issue_select on public.stock_issue for select to authenticated
  using ((select app.is_office())
         or ((select app.self_ok()) and bag_id = (select app.my_bag_id())));

-- Counts: reps see their own daily closes; spot checks and warehouse counts are office-only.
create policy stock_count_select on public.stock_count for select to authenticated
  using ((select app.is_office())
         or ((select app.is_rep()) and (select app.self_ok()) and counted_by = (select auth.uid()) and kind = 'daily_close'));

create policy reorder_rule_select on public.reorder_rule for select to authenticated
  using ((select app.is_office()));

create policy demand_signal_select on public.demand_signal for select to authenticated
  using ((select app.is_office()) or (captured_by = (select auth.uid()) and (select app.self_ok())));

-- ------------------------------------------------------------- privileges ----
revoke all on public.product_group, public.product, public.sku, public.stock_location, public.stock_movement,
              public.stock_issue, public.stock_count, public.reorder_rule, public.demand_signal
  from public, anon, authenticated, service_role;
grant select on public.product_group, public.product, public.sku, public.stock_location, public.stock_movement,
                public.stock_issue, public.stock_count, public.reorder_rule, public.demand_signal
  to authenticated, service_role;

revoke execute on function
  control.master_row_guard(), control.stock_location_guard(), control.stock_movement_guard(), control.stock_issue_guard(),
  app.my_bag_id(), app.on_hand(uuid, uuid), app.pending_out(uuid, uuid), app.parse_lines(jsonb, boolean),
  app.assert_reason(text),
  app.office_upsert_product_group(uuid, text, integer, boolean),
  app.office_upsert_product(uuid, uuid, text, text, boolean),
  app.office_upsert_sku(uuid, uuid, text, text, text, numeric, integer, text, boolean),
  app.owner_set_sku_price(uuid, bigint, text),
  app.office_create_location(uuid, public.stock_location_kind, text, uuid, bigint),
  app.owner_set_bag_limit(uuid, bigint, text),
  app.office_propose_stock_issue(uuid, public.stock_issue_direction, uuid, uuid, jsonb, date, text),
  app.rep_confirm_stock_issue(uuid, jsonb),
  app.office_cancel_stock_issue(uuid, text),
  app.record_count(uuid, uuid, public.stock_count_kind, jsonb, timestamptz),
  app.office_post_adjustment(uuid, uuid),
  app.office_set_reorder_point(uuid, integer),
  app.record_demand(uuid, uuid, uuid, integer, public.demand_reason, uuid, timestamptz),
  app.my_bag(), app.warehouse_availability(), app.stock_on_hand(uuid), app.low_stock()
  from public, anon, authenticated, service_role;

-- RLS helper used inside policies.
grant execute on function app.my_bag_id() to authenticated;

-- RPC surface.
grant execute on function
  app.office_upsert_product_group(uuid, text, integer, boolean),
  app.office_upsert_product(uuid, uuid, text, text, boolean),
  app.office_upsert_sku(uuid, uuid, text, text, text, numeric, integer, text, boolean),
  app.owner_set_sku_price(uuid, bigint, text),
  app.office_create_location(uuid, public.stock_location_kind, text, uuid, bigint),
  app.owner_set_bag_limit(uuid, bigint, text),
  app.office_propose_stock_issue(uuid, public.stock_issue_direction, uuid, uuid, jsonb, date, text),
  app.rep_confirm_stock_issue(uuid, jsonb),
  app.office_cancel_stock_issue(uuid, text),
  app.record_count(uuid, uuid, public.stock_count_kind, jsonb, timestamptz),
  app.office_post_adjustment(uuid, uuid),
  app.office_set_reorder_point(uuid, integer),
  app.record_demand(uuid, uuid, uuid, integer, public.demand_reason, uuid, timestamptz),
  app.my_bag(), app.warehouse_availability(), app.stock_on_hand(uuid), app.low_stock()
  to authenticated;
