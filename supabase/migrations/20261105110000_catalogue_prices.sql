-- =============================================================================
-- Kiran DMS · migration 20261105110000 · Catalogue: pictures, descriptions, manager prices, salon prices
-- Completion slice 2 (P1-19). Requirements: INV-13, ORD-07 (per-salon part); D-37, D-39; spec
-- 2026-11-05 ruling R6 and sections 2, 4, 5, 7; OQ-33 at its stated default.
--
-- What is built:
--   * product.description (at most 1000 characters) and product.image_path (a storage object name of
--     the exact shape products/{this product's id}/{uuid}.png|jpg|jpeg|webp; an allowlist, so no URL,
--     scheme, backslash or path traversal can be stored).
--   * app.office_upsert_product takes both. A null keeps what is recorded; an empty string clears it.
--     app.office_upsert_sku is unchanged: the SKU gains no field in this slice.
--   * public.sku_price_change (append-only): every list price change, by app.office_set_sku_price
--     (owner or manager at AAL2, reason, client_id replay) or app.owner_set_sku_price (kept, owner only,
--     same history). Price 0 or below refused; above app.price_ceiling_paisa() refused.
--   * public.salon_sku_price (append-only; latest row by seq wins per salon and SKU; a null price
--     clears): app.office_set_salon_price (owner or manager, approved salons only, at most the list
--     price), app.office_salon_prices.
--   * app.build_order: a line with no price takes the salon's office-set price when there is one, else
--     the list price. Nothing else in the price gate changes (OQ-33 default): a line below LIST is a
--     discount and is held for approval exactly as before, unless the owner makes the office order
--     (the existing MJ 2026-11-04 rule). List price stays the cap; a salon price that became higher
--     than a lowered list price is refused at order time rather than silently capped.
--   * app.office_catalogue: products with SKUs, prices, picture paths, descriptions, inactive ones too.
--     Reps keep reading active rows of product and sku through RLS, as before.
--   * Storage bucket product-images (private, png/jpeg/webp, 5 MB) with policies: the owner or a manager
--     at AAL2 writes under products/ only; an active staff profile or an active salon member reads.
--     Created only where the storage schema exists (not in the embedded test database, nor needed for
--     the rest of this slice).
-- =============================================================================

-- ------------------------------------------------------------------ constants ----
-- Sanity ceiling for any unit price set through the office: PKR 100,000 per unit, in paisa. A typo
-- guard, not a business rule; raising it is a new migration.
create function app.price_ceiling_paisa() returns bigint
language sql immutable set search_path = '' as $$ select 10000000::bigint $$;

-- ------------------------------------------------------------------- product ----
alter table public.product add column description text;
alter table public.product add column image_path text;
alter table public.product add constraint product_description_shape
  check (description is null or (length(btrim(description)) >= 1 and length(description) <= 1000));
alter table public.product add constraint product_image_path_shape
  check (image_path is null or image_path ~ ('^products/' || id::text
         || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$'));
comment on column public.product.description is
  'D-39. Shown to staff and, from slice 6, to salons. Never names another party (doc 07).';
comment on column public.product.image_path is
  'D-39. Object name in the private storage bucket product-images: products/{product id}/{uuid}.{png|jpg|jpeg|webp}.';
comment on table public.sku is
  'INV-01. Prices in integer paisa, set by the owner or a manager with a reason (D-37, D-39), each change in sku_price_change. The agent price is a separate table (P1-15) so reps never read it.';

-- ---------------------------------------------------------------- price history ----
create table public.sku_price_change (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null unique,                              -- idempotency key (H-08); random on the owner path
  sku_id          uuid not null references public.sku (id),
  old_price_paisa bigint,
  new_price_paisa bigint check (new_price_paisa is null or new_price_paisa > 0),   -- null: the owner unpriced the SKU
  reason          text not null check (length(btrim(reason)) between 3 and 300),
  via             text not null check (via in ('office_set_sku_price', 'owner_set_sku_price')),
  changed_by      uuid not null references public.user_profile (id),
  created_at      timestamptz not null default now(),
  constraint sku_price_change_office_priced check (via <> 'office_set_sku_price' or new_price_paisa is not null)
);
create index sku_price_change_sku_idx on public.sku_price_change (sku_id, created_at desc);
comment on table public.sku_price_change is
  'D-37, D-39. Append-only. Every change of sku.list_price_paisa, who made it, why, and through which function.';

create table public.salon_sku_price (
  id          uuid primary key default gen_random_uuid(),
  seq         bigint generated always as identity,                   -- "latest" is this, not a clock
  client_id   uuid not null unique,                                  -- idempotency key (H-08)
  salon_id    uuid not null references public.salon (id),
  sku_id      uuid not null references public.sku (id),
  price_paisa bigint check (price_paisa is null or price_paisa between 1 and app.price_ceiling_paisa()),   -- null clears
  reason      text not null check (length(btrim(reason)) between 3 and 300),
  set_by      uuid not null references public.user_profile (id),
  created_at  timestamptz not null default now()
);
create index salon_sku_price_latest_idx on public.salon_sku_price (salon_id, sku_id, seq desc);
create index salon_sku_price_sku_idx on public.salon_sku_price (sku_id);
comment on table public.salon_sku_price is
  'D-37 (R6). Append-only. The office-set price of one SKU for one salon: the latest row by seq wins, a null price clears it. Used as the default unit price of that salon''s order lines; the list price stays the cap and the discount gate is unchanged (OQ-33).';

create trigger append_only before update or delete on public.sku_price_change for each row execute function control.forbid_mutation();
create trigger append_only before update or delete on public.salon_sku_price  for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.sku_price_change for each statement execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.salon_sku_price  for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on public.sku_price_change for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.salon_sku_price  for each row execute function control.audit_row();

alter table public.sku_price_change enable row level security;
alter table public.sku_price_change force  row level security;
alter table public.salon_sku_price  enable row level security;
alter table public.salon_sku_price  force  row level security;

-- The office reads both. Reps do not (a salon's price is the office's to quote); salons read their own
-- prices through slice 6's app.salon_* functions only.
create policy sku_price_change_select on public.sku_price_change for select to authenticated
  using ((select app.is_office()));
create policy salon_sku_price_select on public.salon_sku_price for select to authenticated
  using ((select app.is_office()));

revoke all on public.sku_price_change, public.salon_sku_price from public, anon, authenticated, service_role;
grant select on public.sku_price_change, public.salon_sku_price to authenticated, service_role;
revoke all on sequence public.salon_sku_price_seq_seq from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------- helpers ----
-- Internal (no grant). The salon's current office-set price for a SKU, or null.
create function app.salon_price(p_salon_id uuid, p_sku_id uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select x.price_paisa from public.salon_sku_price x
  where x.salon_id = p_salon_id and x.sku_id = p_sku_id
  order by x.seq desc
  limit 1
$$;

-- Internal (no grant). A price the office may set: whole paisa, above 0, at most the ceiling.
create function app.assert_office_price(p_price_paisa bigint) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_price_paisa is null or p_price_paisa < 1 then
    raise exception using errcode = '22023', message = 'a price must be above 0';
  end if;
  if p_price_paisa > app.price_ceiling_paisa() then
    raise exception using errcode = '22023',
      message = format('a price above %s paisa is refused (app.price_ceiling_paisa)', app.price_ceiling_paisa());
  end if;
end $$;

-- Internal (no grant). A reason of 3 to 300 characters, as the bad-input error of spec section 7.
create function app.assert_price_reason(p_reason text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := app.blank_to_null(p_reason);
begin
  if v is null or length(v) < 3 or length(v) > 300 then
    raise exception using errcode = '22023', message = 'a reason of 3 to 300 characters is required';
  end if;
  return v;
end $$;

-- RLS helper for the product-images bucket: an active staff profile (a rep on its approved device) or a
-- salon login with an active membership that proved its email. An unredeemed login reads nothing.
create function app.may_read_product_images() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.self_ok() or exists (
    select 1 from public.salon_membership m
    where m.user_id = auth.uid() and m.status = 'active' and app.session_proved_email())
$$;

-- ------------------------------------------------------ catalogue functions ----
-- Migration 0008's upsert with two new fields. A null keeps what is recorded (the seed and older callers
-- pass four or five arguments); an empty string clears. Every earlier check is unchanged.
drop function app.office_upsert_product(uuid, uuid, text, text, boolean);
create function app.office_upsert_product(p_id uuid, p_product_group_id uuid, p_brand_label text, p_name text,
                                          p_active boolean default true, p_description text default null,
                                          p_image_path text default null)
returns public.product
language plpgsql security definer set search_path = '' as $$
declare
  v      public.product;
  v_desc text := app.blank_to_null(p_description);
  v_img  text := app.blank_to_null(p_image_path);
begin
  perform app.assert_office();
  if v_desc is not null and length(v_desc) > 1000 then
    raise exception using errcode = '22023', message = 'a description has at most 1000 characters';
  end if;
  if v_img is not null and (p_id is null or v_img !~ ('^products/' || p_id::text
       || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$')) then
    raise exception using errcode = '22023',
      message = 'a picture path must be products/{this product''s id}/{uuid}.png, .jpg, .jpeg or .webp';
  end if;
  perform app.set_purpose('catalogue: product');
  insert into public.product as p (id, product_group_id, brand_label, name, active, description, image_path, created_by)
  values (p_id, p_product_group_id, p_brand_label, p_name, coalesce(p_active, true), v_desc, v_img, auth.uid())
  on conflict (id) do update
     set product_group_id = excluded.product_group_id, brand_label = excluded.brand_label,
         name = excluded.name, active = excluded.active,
         description = case when p_description is null then p.description else excluded.description end,
         image_path  = case when p_image_path  is null then p.image_path  else excluded.image_path  end
  returning * into v;
  return v;
end $$;

-- D-39: the owner or a manager sets a SKU's list price, with a reason; the change is in sku_price_change.
-- A replay of the client_id returns the SKU as it is now and records nothing.
create function app.office_set_sku_price(p_client_id uuid, p_sku_id uuid, p_price_paisa bigint, p_reason text)
returns public.sku
language plpgsql security definer set search_path = '' as $$
declare
  v_role   public.app_role := app.assert_office();
  v_reason text;
  h        public.sku_price_change;
  k        public.sku;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a price change needs a client_id (idempotency key, H-08)';
  end if;
  select * into h from public.sku_price_change x where x.client_id = p_client_id;
  if h.id is not null then
    if h.changed_by = auth.uid() and h.sku_id = p_sku_id and h.new_price_paisa = p_price_paisa
       and h.reason = app.blank_to_null(p_reason) and h.via = 'office_set_sku_price' then
      select * into k from public.sku s where s.id = p_sku_id;
      return k;                                                                -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  perform app.assert_office_price(p_price_paisa);
  v_reason := app.assert_price_reason(p_reason);
  select * into k from public.sku s where s.id = p_sku_id for update;          -- one change at a time per SKU
  if k.id is null then raise exception using errcode = '22023', message = 'unknown sku'; end if;
  -- A concurrent call with this client_id may have finished while this one waited on the lock.
  select * into h from public.sku_price_change x where x.client_id = p_client_id;
  if h.id is not null then
    raise exception using errcode = '23505', message = 'client_id already used; reload and try again';
  end if;
  perform app.set_purpose('price list: ' || v_reason);
  insert into public.sku_price_change (client_id, sku_id, old_price_paisa, new_price_paisa, reason, via, changed_by)
  values (p_client_id, k.id, k.list_price_paisa, p_price_paisa, v_reason, 'office_set_sku_price', auth.uid());
  update public.sku set list_price_paisa = p_price_paisa where id = k.id returning * into k;
  return k;
end $$;

-- Migration 0008's owner-only path, unchanged in what it allows; it now also writes the history.
create or replace function app.owner_set_sku_price(p_sku_id uuid, p_list_price_paisa bigint, p_reason text)
returns public.sku
language plpgsql security definer set search_path = '' as $$
declare
  v     public.sku;
  v_old bigint;
begin
  perform app.assert_owner();
  perform app.assert_reason(p_reason);
  perform app.set_purpose('price list: ' || p_reason);
  select s.list_price_paisa into v_old from public.sku s where s.id = p_sku_id for update;
  update public.sku set list_price_paisa = p_list_price_paisa where id = p_sku_id returning * into v;
  if v.id is null then raise exception using errcode = '22023', message = 'unknown sku'; end if;
  insert into public.sku_price_change (client_id, sku_id, old_price_paisa, new_price_paisa, reason, via, changed_by)
  values (gen_random_uuid(), v.id, v_old, p_list_price_paisa, left(btrim(p_reason), 300), 'owner_set_sku_price', auth.uid());
  return v;
end $$;

-- D-37: the owner or a manager sets (or, with a null price, clears) one salon's price for one SKU. The
-- salon must be approved; the SKU must have a list price, and the salon price may not exceed it.
create function app.office_set_salon_price(p_client_id uuid, p_salon_id uuid, p_sku_id uuid, p_price_paisa bigint,
                                           p_reason text)
returns public.salon_sku_price
language plpgsql security definer set search_path = '' as $$
declare
  v_role   public.app_role := app.assert_office();
  v_reason text;
  v_status public.salon_approval;
  v_list   bigint;
  r        public.salon_sku_price;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a salon price needs a client_id (idempotency key, H-08)';
  end if;
  select * into r from public.salon_sku_price x where x.client_id = p_client_id;
  if r.id is not null then
    if r.set_by = auth.uid() and r.salon_id = p_salon_id and r.sku_id = p_sku_id
       and r.price_paisa is not distinct from p_price_paisa and r.reason = app.blank_to_null(p_reason) then
      return r;                                                                -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if p_price_paisa is not null then perform app.assert_office_price(p_price_paisa); end if;
  v_reason := app.assert_price_reason(p_reason);
  select s.approval_status into v_status from public.salon s where s.id = p_salon_id for update;
  if not found then raise exception using errcode = '22023', message = 'unknown salon'; end if;
  if v_status <> 'approved' then
    raise exception using errcode = '55000', message = format('this salon is %s: only an approved salon gets a price (D-35)', v_status);
  end if;
  select k.list_price_paisa into v_list from public.sku k where k.id = p_sku_id for share;
  if not found then raise exception using errcode = '22023', message = 'unknown sku'; end if;
  if p_price_paisa is not null and v_list is null then
    raise exception using errcode = '55000', message = 'this SKU has no list price yet: set the list price first';
  end if;
  if p_price_paisa > v_list then
    raise exception using errcode = '22023', message = 'a salon price may not be above the list price (the list price is the cap)';
  end if;
  select * into r from public.salon_sku_price x where x.client_id = p_client_id;
  if r.id is not null then
    raise exception using errcode = '23505', message = 'client_id already used; reload and try again';
  end if;
  perform app.set_purpose(case when p_price_paisa is null then 'salon price cleared: ' else 'salon price: ' end || v_reason);
  insert into public.salon_sku_price (client_id, salon_id, sku_id, price_paisa, reason, set_by)
  values (p_client_id, p_salon_id, p_sku_id, p_price_paisa, v_reason, auth.uid())
  returning * into r;
  return r;
end $$;

-- The office's price sheet for one salon: every priced SKU and every SKU with a current salon price.
-- reference_price_paisa is what app.build_order uses for a line given no price.
create function app.office_salon_prices(p_salon_id uuid)
returns table (sku_id uuid, code text, variant text, product_name text, sku_active boolean,
               list_price_paisa bigint, salon_price_paisa bigint, reference_price_paisa bigint,
               above_list boolean, reason text, set_by_name text, set_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  if not exists (select 1 from public.salon s where s.id = p_salon_id) then
    raise exception using errcode = '22023', message = 'unknown salon';
  end if;
  return query
    select k.id, k.code, k.variant, p.name, k.active and p.active, k.list_price_paisa,
           x.price_paisa, coalesce(x.price_paisa, k.list_price_paisa),
           coalesce(x.price_paisa > k.list_price_paisa, false),
           x.reason, u.full_name, x.created_at
    from public.sku k
    join public.product p on p.id = k.product_id
    left join lateral (
      select y.price_paisa, y.reason, y.set_by, y.created_at from public.salon_sku_price y
      where y.salon_id = p_salon_id and y.sku_id = k.id
      order by y.seq desc limit 1) x on true
    left join public.user_profile u on u.id = x.set_by and x.price_paisa is not null
    where k.list_price_paisa is not null or x.price_paisa is not null
    order by k.code
    limit 2000;
end $$;

-- The office catalogue: every product (inactive too) with its SKUs and their list prices. No other
-- party, no purchase figure: those stay in the vault (doc 07).
create function app.office_catalogue()
returns table (product_id uuid, product_group_id uuid, group_name text, brand_label text, name text,
               description text, image_path text, active boolean, skus jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
    select p.id, p.product_group_id, g.name, p.brand_label, p.name, p.description, p.image_path, p.active,
           coalesce((select jsonb_agg(jsonb_build_object(
                       'id', k.id, 'code', k.code, 'variant', k.variant, 'unit', k.unit, 'size_value', k.size_value,
                       'units_per_carton', k.units_per_carton, 'barcode', k.barcode,
                       'list_price_paisa', k.list_price_paisa, 'active', k.active) order by k.code)
                     from public.sku k where k.product_id = p.id), '[]'::jsonb)
    from public.product p
    join public.product_group g on g.id = p.product_group_id
    order by p.active desc, p.name, p.id
    limit 1000;
end $$;

-- ------------------------------------------------------------ order builder ----
-- Slice 1's engine (migration 20261105100000). One change: a line given no price takes the salon's
-- office-set price when there is one, else the list price, computed once per line. The price gate is
-- as written: list price is the cap and the discount (against LIST) is held for approval unless the
-- owner makes the office order (OQ-33 default). A salon price above a since-lowered list is refused.
create or replace function app.build_order(
  p_client_id uuid, p_salon_id uuid, p_plan public.plan_code, p_delivery_mode public.delivery_mode, p_lines jsonb,
  p_channel public.order_channel, p_rep_id uuid, p_rep_day_id uuid, p_visit_id uuid, p_assigned_rep_id uuid,
  p_intake_card_id uuid, p_created_at_client timestamptz)
returns public.sales_order
language plpgsql security definer set search_path = '' as $$
declare
  v_id    uuid := gen_random_uuid();
  v_sub   bigint;
  v_disc  bigint;
  v_n     integer;
  v_cnt   integer;
  v_thr   jsonb;
  v_owner boolean;
  v_stale text;
  -- MJ 2026-11-04: the owner's own discount on an office order needs no approval. Reps never get it.
  v_by_owner boolean := p_channel = 'office' and app.user_role() = 'owner';
  a       control.approval_request;
begin
  perform app.assert_salon_approved(p_salon_id);
  if p_plan is null or p_delivery_mode is null then
    raise exception using errcode = '22023', message = 'a plan and a delivery mode are required';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'an order has 1 to 50 lines';
  end if;
  -- A line with no price whose default is a salon price above the current list price: refused, with the
  -- SKU named, so the office corrects the salon price instead of an order going out above the cap.
  select k.code into v_stale
  from jsonb_array_elements(p_lines) e(val)
  join public.sku k on k.id = (e.val ->> 'sku_id')::uuid
  where (e.val ->> 'unit_price_paisa') is null and k.list_price_paisa is not null
    and app.salon_price(p_salon_id, k.id) > k.list_price_paisa
  limit 1;
  if v_stale is not null then
    raise exception using errcode = '22023',
      message = format('this salon''s price for %s is above its list price: correct the salon price first', v_stale);
  end if;
  -- Lines: [{sku_id, qty, unit_price_paisa?}]; the unit price defaults to the salon price, else the list price.
  with x as (
    select e.ord, k.id as sku_id, (e.val ->> 'qty')::integer as qty, k.list_price_paisa as list_price,
           coalesce((e.val ->> 'unit_price_paisa')::bigint, app.salon_price(p_salon_id, k.id), k.list_price_paisa) as unit_price
    from jsonb_array_elements(p_lines) with ordinality as e(val, ord)
    left join public.sku k on k.id = (e.val ->> 'sku_id')::uuid)
  select count(*), count(distinct x.sku_id),
         sum(x.qty::bigint * x.list_price), sum(x.qty::bigint * (x.list_price - x.unit_price))
    into v_cnt, v_n, v_sub, v_disc
  from x;
  if exists (
       select 1 from jsonb_array_elements(p_lines) e(val)
       left join public.sku k on k.id = (e.val ->> 'sku_id')::uuid
       left join public.product p on p.id = k.product_id
       where k.id is null or not k.active or not p.active or k.list_price_paisa is null
          or (e.val ->> 'qty') is null or (e.val ->> 'qty')::integer not between 1 and 10000
          or coalesce((e.val ->> 'unit_price_paisa')::bigint, app.salon_price(p_salon_id, k.id), k.list_price_paisa)
             not between 1 and k.list_price_paisa) then
    raise exception using errcode = '22023',
      message = 'every line needs an active, priced SKU, a quantity of 1 to 10000 and a unit price above 0 and at most the list price';
  end if;
  if v_n <> v_cnt then
    raise exception using errcode = '22023', message = 'a SKU appears once in an order';
  end if;
  perform app.set_purpose('order taken');
  if v_disc > 0 and not v_by_owner then
    v_thr :=(select c.value from public.app_config c where c.key = 'approval.discount.owner_above');
    -- doc 13 §9: the owner decides above the threshold; a missing threshold sends it to the owner.
    v_owner := v_thr is null or jsonb_typeof(v_thr -> 'pct') <> 'number' or jsonb_typeof(v_thr -> 'paisa') <> 'number'
               or v_disc * 100 > v_sub * (v_thr ->> 'pct')::numeric or v_disc > (v_thr ->> 'paisa')::numeric;
    -- The approval's maker is the caller (app.request_approval), the same person as the order's created_by.
    a := app.request_approval(gen_random_uuid(), 'discount', 'sales_order', v_id,
                              jsonb_build_object('salon_id', p_salon_id, 'subtotal_paisa', v_sub, 'discount_paisa', v_disc,
                                                 'total_paisa', v_sub - v_disc),
                              'discount below list price (CTL-07)',
                              case when v_owner then 'owner' else 'manager' end::public.app_role);
  end if;
  insert into public.sales_order (id, client_id, salon_id, rep_id, rep_day_id, visit_id, plan, delivery_mode,
                                  subtotal_paisa, discount_paisa, total_paisa, discount_approval_id, created_at_client,
                                  source_channel, created_by, assigned_rep_id, intake_card_id, discount_by_owner)
  values (v_id, p_client_id, p_salon_id, p_rep_id, p_rep_day_id, p_visit_id, p_plan, p_delivery_mode,
          v_sub, v_disc, v_sub - v_disc, a.id, p_created_at_client,
          p_channel, auth.uid(), p_assigned_rep_id, p_intake_card_id, v_disc > 0 and v_by_owner);
  insert into public.sales_order_line (order_id, line_no, sku_id, qty, list_price_paisa, unit_price_paisa, line_total_paisa)
  select v_id, x.ord::integer, x.sku_id, x.qty, x.list_price, x.unit_price, x.qty * x.unit_price
  from (
    select e.ord, k.id as sku_id, (e.val ->> 'qty')::integer as qty, k.list_price_paisa as list_price,
           coalesce((e.val ->> 'unit_price_paisa')::bigint, app.salon_price(p_salon_id, k.id), k.list_price_paisa) as unit_price
    from jsonb_array_elements(p_lines) with ordinality as e(val, ord)
    join public.sku k on k.id = (e.val ->> 'sku_id')::uuid) x;
  return app.evaluate_order(v_id);
end $$;

-- ---------------------------------------------------------------- storage ----
-- Bucket product-images and its policies, only where Supabase Storage's schema exists (hosted projects
-- and the CLI stack; not the embedded test database). Columns that the storage service adds itself
-- (public, file_size_limit, allowed_mime_types) are set only when present. Never creates the schema.
do $storage$
declare
  v_name_shape constant text :=
    '^products/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$';
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage schema absent: bucket product-images and its policies not created';
    return;
  end if;
  execute $q$insert into storage.buckets (id, name) values ('product-images', 'product-images') on conflict (id) do nothing$q$;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'public') then
    execute $q$update storage.buckets set public = false where id = 'product-images'$q$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute $q$update storage.buckets set file_size_limit = 5242880 where id = 'product-images'$q$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $q$update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'] where id = 'product-images'$q$;
  end if;
  begin
    execute $q$create policy product_images_read on storage.objects for select to authenticated
      using (bucket_id = 'product-images' and (select app.may_read_product_images()))$q$;
    execute format($q$create policy product_images_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'product-images' and (select app.is_office()) and name ~ %L)$q$, v_name_shape);
    execute format($q$create policy product_images_update on storage.objects for update to authenticated
      using (bucket_id = 'product-images' and (select app.is_office()) and name ~ %L)
      with check (bucket_id = 'product-images' and (select app.is_office()) and name ~ %L)$q$, v_name_shape, v_name_shape);
    execute format($q$create policy product_images_delete on storage.objects for delete to authenticated
      using (bucket_id = 'product-images' and (select app.is_office()) and name ~ %L)$q$, v_name_shape);
  exception when insufficient_privilege then
    -- Fail closed: with no policy nobody but the storage service reads or writes the bucket. The CI
    -- storage test checks that the four policies exist wherever storage does.
    raise warning 'product-images policies not created (insufficient privilege on storage.objects): %', sqlerrm;
  end;
end $storage$;

-- ----------------------------------------------------------------- function privileges ----
revoke execute on function
  app.price_ceiling_paisa(), app.salon_price(uuid, uuid), app.assert_office_price(bigint), app.assert_price_reason(text)
  from public, anon, authenticated, service_role;

-- RLS helper used inside the storage policies.
revoke all on function app.may_read_product_images() from public, anon, authenticated, service_role;
grant execute on function app.may_read_product_images() to authenticated;

revoke all on function
  app.office_upsert_product(uuid, uuid, text, text, boolean, text, text),
  app.office_set_sku_price(uuid, uuid, bigint, text),
  app.office_set_salon_price(uuid, uuid, uuid, bigint, text),
  app.office_salon_prices(uuid), app.office_catalogue()
  from public, anon, authenticated, service_role;
grant execute on function
  app.office_upsert_product(uuid, uuid, text, text, boolean, text, text),
  app.office_set_sku_price(uuid, uuid, bigint, text),
  app.office_set_salon_price(uuid, uuid, uuid, bigint, text),
  app.office_salon_prices(uuid), app.office_catalogue()
  to authenticated;
