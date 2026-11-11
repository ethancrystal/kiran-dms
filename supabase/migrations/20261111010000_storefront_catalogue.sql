-- P1-33, plan B (D-52, D-54, D-58). Public catalogue data for the shop.
-- No price column: the public price is sku.list_price_paisa, set by app.office_set_sku_price.
-- Visitors read two functions only. No role gets a SELECT policy on these tables.

-- ---------------------------------------------------------------- tables ----
create table public.storefront_category (
  product_group_id  uuid primary key references public.product_group (id),
  slug              text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 80),
  meta_title        text not null unique check (length(meta_title) between 10 and 60),
  meta_description  text not null unique check (length(meta_description) between 50 and 160),
  body              text check (body is null or length(body) between 1 and 4000),
  published         boolean not null default false,
  published_at      timestamptz,
  created_by        uuid not null references public.user_profile (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.storefront_category is
  'P1-33. Public page for one product group. The slug never changes once published_at is set.';

create table public.storefront_product (
  product_id        uuid primary key references public.product (id),
  slug              text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 80),
  meta_title        text not null unique check (length(meta_title) between 10 and 60),
  meta_description  text not null unique check (length(meta_description) between 50 and 160),
  body              text check (body is null or length(body) between 1 and 4000),
  how_to_use        text check (how_to_use is null or length(how_to_use) between 1 and 2000),
  image_path        text check (image_path is null or image_path ~ (
                      '^storefront/' || product_id::text
                      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$')),
  published         boolean not null default false,
  published_at      timestamptz,
  created_by        uuid not null references public.user_profile (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.storefront_product is
  'P1-33. Public page for one product. image_path is an object in the storefront-images bucket.';

create table public.storefront_sku (
  sku_id       uuid primary key references public.sku (id),
  published    boolean not null default false,
  created_by   uuid not null references public.user_profile (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.storefront_sku is
  'P1-33. Which shades of a product are on the public page. The price stays on sku.list_price_paisa.';

create table public.storefront_write (
  client_id     uuid primary key,
  kind          text not null check (kind in ('category', 'product', 'sku')),
  subject_id    uuid not null,
  payload_hash  text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  actor_id      uuid not null references public.user_profile (id),
  created_at    timestamptz not null default now()
);
comment on table public.storefront_write is
  'P1-33. Append-only idempotency record for the storefront write functions (H-08).';

-- ---------------------------------------------------------------- guards ----
create function control.storefront_row_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501',
      message = format('DELETE on %I.%I is not allowed', tg_table_schema, tg_table_name);
  end if;
  if new.created_at <> old.created_at or new.created_by is distinct from old.created_by then
    raise exception using errcode = '42501',
      message = format('identity columns of %I.%I are immutable', tg_table_schema, tg_table_name);
  end if;
  -- Nested. One trigger serves three row types, and naming a column the current row
  -- does not have fails even when an earlier AND would have been false.
  if tg_table_name = 'storefront_category' then
    if new.product_group_id <> old.product_group_id then
      raise exception using errcode = '42501', message = 'a category identity never changes';
    end if;
  elsif tg_table_name = 'storefront_product' then
    if new.product_id <> old.product_id then
      raise exception using errcode = '42501', message = 'a product page identity never changes';
    end if;
  elsif tg_table_name = 'storefront_sku' then
    if new.sku_id <> old.sku_id then
      raise exception using errcode = '42501', message = 'a shade page identity never changes';
    end if;
  end if;
  -- storefront_sku has no slug and no published_at. Those rules apply to the page tables only.
  if tg_table_name in ('storefront_category', 'storefront_product') then
    if old.published_at is not null and new.slug is distinct from old.slug then
      raise exception using errcode = '22023', message = 'a published address cannot change';
    end if;
    if old.published_at is not null then
      new.published_at := old.published_at;
    elsif new.published and new.published_at is null then
      new.published_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger storefront_row_guard before update or delete on public.storefront_category
  for each row execute function control.storefront_row_guard();
create trigger storefront_row_guard before update or delete on public.storefront_product
  for each row execute function control.storefront_row_guard();
create trigger storefront_row_guard before update or delete on public.storefront_sku
  for each row execute function control.storefront_row_guard();

create trigger append_only before update or delete on public.storefront_write
  for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.storefront_write
  for each statement execute function control.forbid_mutation();

create trigger audit after insert or update or delete on public.storefront_category
  for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.storefront_product
  for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.storefront_sku
  for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.storefront_write
  for each row execute function control.audit_row();

-- --------------------------------------------------------------- helpers ----
-- True when this client_id already recorded the same write by the same person.
-- A different write with that client_id is refused. A new client_id returns false.
create function app.storefront_seen(p_client_id uuid, p_kind text, p_subject uuid, p_hash text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare w public.storefront_write;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a storefront write needs a client_id (idempotency key, H-08)';
  end if;
  select * into w from public.storefront_write x where x.client_id = p_client_id;
  if w.client_id is null then return false; end if;
  if w.actor_id = auth.uid() and w.kind = p_kind and w.subject_id = p_subject and w.payload_hash = p_hash then
    return true;
  end if;
  raise exception using errcode = '23505', message = 'client_id already used with different content';
end $$;

create function app.storefront_record(p_client_id uuid, p_kind text, p_subject uuid, p_hash text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.storefront_write (client_id, kind, subject_id, payload_hash, actor_id)
  values (p_client_id, p_kind, p_subject, p_hash, auth.uid());
exception when unique_violation then
  if not app.storefront_seen(p_client_id, p_kind, p_subject, p_hash) then
    raise exception using errcode = '23505', message = 'client_id already used; reload and try again';
  end if;
end $$;

create function app.storefront_hash(p_parts text[]) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(array_to_string(p_parts, E'\n'), 'UTF8')), 'hex')
$$;

-- True when an active warehouse has any of this shade free to sell. The count stays here.
create function app.storefront_shade_available(p_sku uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.stock_location l
    where l.kind = 'warehouse' and l.active
      and app.on_hand(l.id, p_sku) - app.pending_out(l.id, p_sku) > 0)
$$;

-- --------------------------------------------------------- office writes ----
create function app.office_upsert_storefront_category(
  p_client_id uuid, p_product_group_id uuid, p_slug text, p_meta_title text, p_meta_description text, p_body text)
returns public.storefront_category
language plpgsql security definer set search_path = '' as $$
declare
  v_slug text := btrim(p_slug);
  v_title text := btrim(p_meta_title);
  v_desc text := btrim(p_meta_description);
  v_body text := nullif(btrim(p_body), '');
  v_hash text;
  v public.storefront_category;
begin
  perform app.assert_office();
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) not between 3 and 80 then
    raise exception using errcode = '22023', message = 'a slug is 3 to 80 lower-case letters, digits and hyphens';
  end if;
  if v_title is null or length(v_title) not between 10 and 60 then
    raise exception using errcode = '22023', message = 'a meta title is 10 to 60 characters';
  end if;
  if v_desc is null or length(v_desc) not between 50 and 160 then
    raise exception using errcode = '22023', message = 'a meta description is 50 to 160 characters';
  end if;
  if v_body is not null and length(v_body) > 4000 then
    raise exception using errcode = '22023', message = 'page text is at most 4000 characters';
  end if;
  if not exists (select 1 from public.product_group g where g.id = p_product_group_id) then
    raise exception using errcode = '22023', message = 'unknown category';
  end if;
  v_hash := app.storefront_hash(array['category', p_product_group_id::text, v_slug, v_title, v_desc, coalesce(v_body, '')]);
  if app.storefront_seen(p_client_id, 'category', p_product_group_id, v_hash) then
    select * into v from public.storefront_category c where c.product_group_id = p_product_group_id;
    if v.product_group_id is null then
      raise exception using errcode = '22023', message = 'unknown category';
    end if;
    return v;
  end if;
  perform 1 from public.product_group g where g.id = p_product_group_id for update;
  if app.storefront_seen(p_client_id, 'category', p_product_group_id, v_hash) then
    select * into v from public.storefront_category c where c.product_group_id = p_product_group_id;
    return v;
  end if;
  perform app.set_purpose('storefront category');
  insert into public.storefront_category as c
    (product_group_id, slug, meta_title, meta_description, body, created_by)
  values (p_product_group_id, v_slug, v_title, v_desc, v_body, auth.uid())
  on conflict (product_group_id) do update
    set slug = excluded.slug, meta_title = excluded.meta_title,
        meta_description = excluded.meta_description, body = excluded.body
  returning * into v;
  perform app.storefront_record(p_client_id, 'category', p_product_group_id, v_hash);
  return v;
end $$;

create function app.office_upsert_storefront_product(
  p_client_id uuid, p_product_id uuid, p_slug text, p_meta_title text, p_meta_description text,
  p_body text, p_how_to_use text, p_image_path text)
returns public.storefront_product
language plpgsql security definer set search_path = '' as $$
declare
  v_slug text := btrim(p_slug);
  v_title text := btrim(p_meta_title);
  v_desc text := btrim(p_meta_description);
  v_body text := nullif(btrim(p_body), '');
  v_how text := nullif(btrim(p_how_to_use), '');
  v_img text := nullif(btrim(p_image_path), '');
  v_hash text;
  v public.storefront_product;
begin
  perform app.assert_office();
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) not between 3 and 80 then
    raise exception using errcode = '22023', message = 'a slug is 3 to 80 lower-case letters, digits and hyphens';
  end if;
  if v_title is null or length(v_title) not between 10 and 60 then
    raise exception using errcode = '22023', message = 'a meta title is 10 to 60 characters';
  end if;
  if v_desc is null or length(v_desc) not between 50 and 160 then
    raise exception using errcode = '22023', message = 'a meta description is 50 to 160 characters';
  end if;
  if v_body is not null and length(v_body) > 4000 then
    raise exception using errcode = '22023', message = 'page text is at most 4000 characters';
  end if;
  if v_how is not null and length(v_how) > 2000 then
    raise exception using errcode = '22023', message = 'how to use is at most 2000 characters';
  end if;
  if v_img is not null and v_img !~ (
       '^storefront/' || p_product_id::text
       || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$') then
    raise exception using errcode = '22023',
      message = 'a picture path must be storefront/{this product''s id}/{uuid}.png, .jpg, .jpeg or .webp';
  end if;
  if not exists (select 1 from public.product p where p.id = p_product_id) then
    raise exception using errcode = '22023', message = 'unknown product';
  end if;
  v_hash := app.storefront_hash(array['product', p_product_id::text, v_slug, v_title, v_desc,
                                      coalesce(v_body, ''), coalesce(v_how, ''), coalesce(v_img, '')]);
  if app.storefront_seen(p_client_id, 'product', p_product_id, v_hash) then
    select * into v from public.storefront_product s where s.product_id = p_product_id;
    if v.product_id is null then raise exception using errcode = '22023', message = 'unknown product'; end if;
    return v;
  end if;
  perform 1 from public.product p where p.id = p_product_id for update;
  if app.storefront_seen(p_client_id, 'product', p_product_id, v_hash) then
    select * into v from public.storefront_product s where s.product_id = p_product_id;
    return v;
  end if;
  select * into v from public.storefront_product s where s.product_id = p_product_id;
  if v.published and v_img is null then
    raise exception using errcode = '55000', message = 'a published product keeps its picture';
  end if;
  perform app.set_purpose('storefront product');
  insert into public.storefront_product as s
    (product_id, slug, meta_title, meta_description, body, how_to_use, image_path, created_by)
  values (p_product_id, v_slug, v_title, v_desc, v_body, v_how, v_img, auth.uid())
  on conflict (product_id) do update
    set slug = excluded.slug, meta_title = excluded.meta_title, meta_description = excluded.meta_description,
        body = excluded.body, how_to_use = excluded.how_to_use, image_path = excluded.image_path
  returning * into v;
  perform app.storefront_record(p_client_id, 'product', p_product_id, v_hash);
  return v;
end $$;

create function app.office_set_storefront_published(
  p_client_id uuid, p_kind text, p_subject_id uuid, p_published boolean)
returns table (kind text, subject_id uuid, published boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_hash text;
  v_on boolean;
  k public.sku;
  p public.product;
  g public.product_group;
begin
  perform app.assert_office();
  if p_kind not in ('category', 'product', 'sku') or p_published is null or p_subject_id is null then
    raise exception using errcode = '22023', message = 'publish needs a category, product or shade, and on or off';
  end if;
  v_hash := app.storefront_hash(array['published', p_kind, p_subject_id::text, p_published::text]);
  if app.storefront_seen(p_client_id, p_kind, p_subject_id, v_hash) then
    if p_kind = 'category' then
      select c.published into v_on from public.storefront_category c where c.product_group_id = p_subject_id;
    elsif p_kind = 'product' then
      select s.published into v_on from public.storefront_product s where s.product_id = p_subject_id;
    else
      select s.published into v_on from public.storefront_sku s where s.sku_id = p_subject_id;
    end if;
    if v_on is null then raise exception using errcode = '22023', message = 'save the page before publishing'; end if;
    return query select p_kind, p_subject_id, v_on;
    return;
  end if;

  if p_kind = 'sku' then
    select * into k from public.sku s where s.id = p_subject_id for update;
    if k.id is null then raise exception using errcode = '22023', message = 'unknown shade'; end if;
    if p_published then
      if not k.active then raise exception using errcode = '55000', message = 'this shade is inactive'; end if;
      if k.list_price_paisa is null then
        raise exception using errcode = '55000', message = 'this shade has no default price';
      end if;
      if not exists (select 1 from public.product x where x.id = k.product_id and x.active) then
        raise exception using errcode = '55000', message = 'this product is inactive';
      end if;
    elsif exists (select 1 from public.storefront_product sp
                   where sp.product_id = k.product_id and sp.published)
      and not exists (select 1 from public.storefront_sku ss
                      join public.sku s on s.id = ss.sku_id
                      where s.product_id = k.product_id and ss.published and ss.sku_id <> k.id
                        and s.active and s.list_price_paisa is not null) then
      raise exception using errcode = '55000',
        message = 'this is the only published shade: unpublish the product first';
    end if;
    perform app.set_purpose('storefront shade published');
    insert into public.storefront_sku as s (sku_id, published, created_by)
    values (k.id, p_published, auth.uid())
    on conflict (sku_id) do update set published = excluded.published;
    select s.published into v_on from public.storefront_sku s where s.sku_id = k.id;

  elsif p_kind = 'product' then
    select * into p from public.product x where x.id = p_subject_id for update;
    if p.id is null then raise exception using errcode = '22023', message = 'unknown product'; end if;
    if not exists (select 1 from public.storefront_product s where s.product_id = p.id) then
      raise exception using errcode = '22023', message = 'save the page before publishing';
    end if;
    if p_published then
      if not p.active then raise exception using errcode = '55000', message = 'this product is inactive'; end if;
      if not exists (select 1 from public.storefront_product s where s.product_id = p.id and s.image_path is not null) then
        raise exception using errcode = '55000', message = 'this product needs a picture before it can be published';
      end if;
      if not exists (select 1 from public.storefront_sku ss
                     join public.sku s on s.id = ss.sku_id
                     where s.product_id = p.id and ss.published and s.active and s.list_price_paisa is not null) then
        raise exception using errcode = '55000', message = 'this product needs a published shade with a default price';
      end if;
    end if;
    perform app.set_purpose('storefront product published');
    update public.storefront_product s set published = p_published where s.product_id = p.id
    returning s.published into v_on;

  else
    select * into g from public.product_group x where x.id = p_subject_id for update;
    if g.id is null then raise exception using errcode = '22023', message = 'unknown category'; end if;
    if not exists (select 1 from public.storefront_category c where c.product_group_id = g.id) then
      raise exception using errcode = '22023', message = 'save the page before publishing';
    end if;
    if p_published and not g.active then
      raise exception using errcode = '55000', message = 'this category is inactive';
    end if;
    perform app.set_purpose('storefront category published');
    update public.storefront_category c set published = p_published where c.product_group_id = g.id
    returning c.published into v_on;
  end if;

  perform app.storefront_record(p_client_id, p_kind, p_subject_id, v_hash);
  return query select p_kind, p_subject_id, v_on;
end $$;

-- The office panel reads through this. Direct selects on the tables stay denied.
create function app.office_storefront_sheet()
returns table (product_group_id uuid, category_slug text, category_meta_title text, category_meta_description text,
               category_body text, category_published boolean, product_id uuid, slug text, meta_title text,
               meta_description text, body text, how_to_use text, image_path text, published boolean, skus jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
    select p.product_group_id, c.slug, c.meta_title, c.meta_description, c.body, c.published,
           p.id, s.slug, s.meta_title, s.meta_description, s.body, s.how_to_use, s.image_path, s.published,
           coalesce((select jsonb_agg(jsonb_build_object(
                       'id', k.id, 'code', k.code, 'variant', k.variant,
                       'published', coalesce(ss.published, false),
                       'list_price_paisa', k.list_price_paisa) order by k.code)
                     from public.sku k
                     left join public.storefront_sku ss on ss.sku_id = k.id
                     where k.product_id = p.id), '[]'::jsonb)
    from public.product p
    left join public.storefront_category c on c.product_group_id = p.product_group_id
    left join public.storefront_product s on s.product_id = p.id
    order by p.name, p.id
    limit 1000;
end $$;

-- -------------------------------------------------------- visitor reads ----
create function app.storefront_catalogue()
returns table (category_id uuid, category_slug text, category_name text, category_meta_title text,
               category_meta_description text, product_id uuid, product_slug text, product_name text,
               brand_label text, meta_title text, meta_description text, image_path text,
               lowest_default_price_paisa bigint)
language sql stable security definer set search_path = '' as $$
  select g.id, c.slug, g.name, c.meta_title, c.meta_description,
         p.id, sp.slug, p.name, p.brand_label, sp.meta_title, sp.meta_description, sp.image_path,
         min(k.list_price_paisa)
  from public.storefront_category c
  join public.product_group g on g.id = c.product_group_id and g.active
  join public.product p on p.product_group_id = g.id and p.active
  join public.storefront_product sp on sp.product_id = p.id and sp.published
  join public.storefront_sku ss on ss.published
  join public.sku k on k.id = ss.sku_id and k.product_id = p.id and k.active and k.list_price_paisa is not null
  where c.published
  group by g.id, c.slug, g.name, c.meta_title, c.meta_description,
           p.id, sp.slug, p.name, p.brand_label, sp.meta_title, sp.meta_description, sp.image_path
  order by g.name, p.name
$$;

create function app.storefront_product(p_slug text)
returns table (product_id uuid, slug text, name text, brand_label text, meta_title text, meta_description text,
               body text, how_to_use text, image_path text, sku_id uuid, code text, variant text, unit text,
               size_value numeric, default_price_paisa bigint, available boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, sp.slug, p.name, p.brand_label, sp.meta_title, sp.meta_description, sp.body, sp.how_to_use,
         sp.image_path, k.id, k.code, k.variant, k.unit, k.size_value, k.list_price_paisa,
         app.storefront_shade_available(k.id)
  from public.storefront_product sp
  join public.product p on p.id = sp.product_id and p.active
  join public.storefront_sku ss on ss.published
  join public.sku k on k.id = ss.sku_id and k.product_id = p.id and k.active and k.list_price_paisa is not null
  where sp.published and sp.slug = btrim(p_slug)
  order by k.code
$$;

-- ---------------------------------------------------------------- storage ----
do $storage$
declare
  v_name_shape constant text :=
    '^storefront/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$';
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage schema absent: bucket storefront-images and its policies not created';
    return;
  end if;
  begin
    execute $q$insert into storage.buckets (id, name) values ('storefront-images', 'storefront-images') on conflict (id) do nothing$q$;
    if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'public') then
      execute $q$update storage.buckets set public = true where id = 'storefront-images'$q$;
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      execute $q$update storage.buckets set file_size_limit = 5242880 where id = 'storefront-images'$q$;
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
      execute $q$update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'] where id = 'storefront-images'$q$;
    end if;
    execute $q$create policy storefront_images_read on storage.objects for select to anon, authenticated
      using (bucket_id = 'storefront-images')$q$;
    execute format($q$create policy storefront_images_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'storefront-images' and (select app.is_office()) and name ~ %L)$q$, v_name_shape);
    execute format($q$create policy storefront_images_update on storage.objects for update to authenticated
      using (bucket_id = 'storefront-images' and (select app.is_office()) and name ~ %L)
      with check (bucket_id = 'storefront-images' and (select app.is_office()) and name ~ %L)$q$, v_name_shape, v_name_shape);
    execute format($q$create policy storefront_images_delete on storage.objects for delete to authenticated
      using (bucket_id = 'storefront-images' and (select app.is_office()) and name ~ %L)$q$, v_name_shape);
  exception when insufficient_privilege then
    raise warning 'storefront-images bucket and policies not created (insufficient privilege on storage): %', sqlerrm;
  end;
end $storage$;

-- ------------------------------------------------------------ privileges ----
alter table public.storefront_category enable row level security;
alter table public.storefront_category force row level security;
alter table public.storefront_product enable row level security;
alter table public.storefront_product force row level security;
alter table public.storefront_sku enable row level security;
alter table public.storefront_sku force row level security;
alter table public.storefront_write enable row level security;
alter table public.storefront_write force row level security;

revoke all on public.storefront_category, public.storefront_product, public.storefront_sku, public.storefront_write
  from public, anon, authenticated, service_role;

revoke all on function
  control.storefront_row_guard(),
  app.storefront_seen(uuid, text, uuid, text),
  app.storefront_record(uuid, text, uuid, text),
  app.storefront_hash(text[]),
  app.storefront_shade_available(uuid),
  app.office_upsert_storefront_category(uuid, uuid, text, text, text, text),
  app.office_upsert_storefront_product(uuid, uuid, text, text, text, text, text, text),
  app.office_set_storefront_published(uuid, text, uuid, boolean),
  app.office_storefront_sheet(),
  app.storefront_catalogue(),
  app.storefront_product(text)
  from public, anon, authenticated, service_role;

grant execute on function
  app.office_upsert_storefront_category(uuid, uuid, text, text, text, text),
  app.office_upsert_storefront_product(uuid, uuid, text, text, text, text, text, text),
  app.office_set_storefront_published(uuid, text, uuid, boolean),
  app.office_storefront_sheet()
  to authenticated;

-- D-52: these two reads are the only functions anon may execute.
grant usage on schema app to anon;
grant execute on function app.storefront_catalogue(), app.storefront_product(text) to anon, authenticated;
