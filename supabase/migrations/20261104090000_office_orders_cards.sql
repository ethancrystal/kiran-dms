-- =============================================================================
-- Kiran DMS · migration 0025 · Office orders and rep order cards (PR A, D-30)
-- Requirements: ORD-01 (an order records its salon, lines and who made it), ORD-10 (idempotent),
--               doc 04 invariant 1 (append-only), H-13 (RLS enabled and forced).
-- Docs: docs/superpowers/specs/2026-11-03-orders-delivery-commission-design.md section 4 (PR A);
--       ACTIVITY D-30 (MJ: reps no longer create orders; the office does, directly or from a rep's
--       card; the salon portal is reserved), L-0363, L-0385 (a rep-less order is delivered by the office).
--
-- What is built (the schema, office order creation, order cards and their conversion):
--   * public.order_channel and sales_order.source_channel (rep_visit, office, salon_portal). Every
--     existing order is a rep_visit order. The column keeps a default of rep_visit only so that the
--     rep path app.create_order, which is refused for reps in a later task, still inserts today.
--   * sales_order.created_by (the auth user who made the order; backfilled from rep_id), assigned_rep_id
--     (the rep who delivers and, later, earns commission on it) and intake_card_id (the card it came from).
--   * sales_order.rep_id and rep_day_id become optional, and invoice.rep_id too, so an office order that
--     has no rep can be delivered and invoiced by the office. A check keeps both shapes honest.
--   * public.order_intake_card (a rep's note of what a salon needs) and public.order_intake_card_close
--     (converted into an order, or dismissed with a reason). Both are append-only and audited.
--   * The order immutability trigger now also fixes channel, creator, assigned rep and source card.
--   * Existing rows: created_by is backfilled from rep_id and source_channel reads rep_visit (column default).
--   * app.rep_deliver is re-issued with one change: a rep-less order is refused (rep_id is distinct from
--     the caller), because rep_id can now be null and `null <> uid` would have let any rep deliver it.
--   * app.build_order (internal, no grant) holds the shared order engine of migration 0012 (line checks,
--     discount approval, insert, evaluation) with created_by = the caller; app.create_order (rep path,
--     same signature) and the new app.office_create_order (owner or manager, D-30) both call it.
--     app.evaluate_order matches the discount approval's maker against created_by instead of rep_id.
--   * sales_order.discount_by_owner (MJ 2026-11-04, "Yes, no approval"): the owner's own discount on an
--     office order needs no approval request and holds nothing; the audit insert row records it.
--   * Order cards (ORD-14): app.rep_create_card (a rep, approved phone, open day, salon in its territory),
--     app.my_cards (the rep's last 50 cards and how they ended), app.office_open_cards (open cards, up to
--     200, oldest first), app.office_dismiss_card (a reason of 5+ characters), and
--     app.office_create_order(p_intake_card_id) converting a card. A card closes once (55000 after that).
-- =============================================================================

-- ------------------------------------------------------------------ channel ----
create type public.order_channel as enum ('rep_visit', 'office', 'salon_portal');

alter table public.sales_order
  add column source_channel  public.order_channel not null default 'rep_visit',
  add column created_by      uuid references public.user_profile (id),
  add column assigned_rep_id uuid references public.user_profile (id),
  add column intake_card_id  uuid,                                   -- FK below, once the card table exists
  add column discount_by_owner boolean not null default false;

-- MJ 2026-11-04 (chat, "Yes, no approval"): the owner's own discount on an office order needs no
-- approval request; the order's audit insert row records it (discount_by_owner and the amounts).
alter table public.sales_order drop constraint sales_order_discount_approval;
alter table public.sales_order
  add constraint sales_order_discount_approval
    check ((discount_paisa > 0) = (discount_approval_id is not null or discount_by_owner)),
  add constraint sales_order_discount_by_owner check (not discount_by_owner or discount_paisa > 0);

-- The immutability trigger forbids changing created_by, so the backfill of the rows that exist runs
-- with that one trigger off; audit and foreign-key triggers still run. Existing rows already read
-- rep_visit from the column default.
alter table public.sales_order disable trigger sales_order_guard;
update public.sales_order set created_by = rep_id;
alter table public.sales_order enable trigger sales_order_guard;

alter table public.sales_order alter column created_by set not null;
alter table public.sales_order alter column rep_id drop not null;
alter table public.sales_order alter column rep_day_id drop not null;
alter table public.invoice alter column rep_id drop not null;

alter table public.sales_order
  add constraint sales_order_channel_shape check (
    (source_channel <> 'rep_visit' or (rep_id is not null and rep_day_id is not null and created_by = rep_id))
    and (source_channel <> 'office' or (rep_id is null and rep_day_id is null)));

comment on column public.sales_order.source_channel is
  'D-30. Where the order came from: rep_visit (existing rep orders), office (made by the owner or a manager), salon_portal (reserved).';
comment on column public.sales_order.created_by is
  'D-30. The signed-in user who made the order; for a rep_visit order it is the rep.';
comment on column public.sales_order.assigned_rep_id is
  'D-30. The rep who delivers the order and later earns commission on it; null for an office order delivered by the office.';
comment on column public.sales_order.intake_card_id is
  'D-30. The rep order card this order was made from, when it came from one.';

-- An order made without naming its creator (the rep path, direct inserts) is its rep's own.
create function control.sales_order_creator() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_by := coalesce(new.created_by, new.rep_id);
  return new;
end $$;

create trigger sales_order_creator before insert on public.sales_order
  for each row execute function control.sales_order_creator();

create index sales_order_assigned_rep_idx on public.sales_order (assigned_rep_id, created_at) where assigned_rep_id is not null;

-- Amounts, parties and lines are fixed at creation; the status moves forward only.
create or replace function control.sales_order_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'orders are never deleted; cancel them';
  end if;
  if (new.id, new.client_id, new.salon_id, new.rep_id, new.rep_day_id, new.visit_id, new.plan, new.delivery_mode,
      new.subtotal_paisa, new.discount_paisa, new.total_paisa, new.discount_approval_id, new.created_at,
      new.created_at_client, new.source_channel, new.created_by, new.assigned_rep_id, new.intake_card_id,
      new.discount_by_owner)
     is distinct from
     (old.id, old.client_id, old.salon_id, old.rep_id, old.rep_day_id, old.visit_id, old.plan, old.delivery_mode,
      old.subtotal_paisa, old.discount_paisa, old.total_paisa, old.discount_approval_id, old.created_at,
      old.created_at_client, old.source_channel, old.created_by, old.assigned_rep_id, old.intake_card_id,
      old.discount_by_owner) then
    raise exception using errcode = '42501', message = 'an order''s parties and amounts are immutable';
  end if;
  if old.status in ('cancelled', 'closed') then
    raise exception using errcode = '42501', message = 'a cancelled or closed order is final';
  end if;
  if old.status <> 'draft' and (new.hold_credit, new.hold_discount, new.credit_snapshot, new.credit_override_by,
                                new.credit_override_reason, new.confirmed_at)
                               is distinct from (old.hold_credit, old.hold_discount, old.credit_snapshot,
                                                 old.credit_override_by, old.credit_override_reason, old.confirmed_at) then
    raise exception using errcode = '42501', message = 'a confirmed order''s checks are final';
  end if;
  if new.status is distinct from old.status and (old.status, new.status) not in (
       ('draft'::public.order_status, 'confirmed'::public.order_status), ('draft', 'cancelled'),
       ('confirmed', 'cancelled'), ('confirmed', 'partially_delivered'), ('confirmed', 'delivered'),
       ('partially_delivered', 'delivered'), ('delivered', 'closed')) then
    raise exception using errcode = '42501', message = 'that order status change is not allowed (ORD-03)';
  end if;
  return new;
end $$;

-- -------------------------------------------------------------------- cards ----
create table public.order_intake_card (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null unique,                                  -- idempotency key from the phone (H-08)
  salon_id    uuid not null references public.salon (id),
  rep_id      uuid not null references public.user_profile (id),
  rep_day_id  uuid not null references public.rep_day (id),
  visit_id    uuid references public.visit (id),
  body        text not null check (length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index order_intake_card_rep_idx   on public.order_intake_card (rep_id, created_at desc);
create index order_intake_card_salon_idx on public.order_intake_card (salon_id, created_at desc);
comment on table public.order_intake_card is
  'D-30. Append-only. A rep''s note of what a salon needs; it is not an order. The office turns it into an order or dismisses it (order_intake_card_close).';

create table public.order_intake_card_close (
  id        uuid primary key default gen_random_uuid(),
  card_id   uuid not null unique references public.order_intake_card (id),   -- a card closes once
  outcome   text not null check (outcome in ('converted', 'dismissed')),
  order_id  uuid references public.sales_order (id),
  reason    text,
  closed_by uuid not null references public.user_profile (id),
  closed_at timestamptz not null default now(),
  constraint order_intake_card_close_shape check (
    (outcome = 'converted' and order_id is not null and reason is null)
    or (outcome = 'dismissed' and order_id is null and length(btrim(coalesce(reason, ''))) >= 5))
);
create unique index order_intake_card_close_order_idx on public.order_intake_card_close (order_id) where order_id is not null;  -- one order from one card
comment on table public.order_intake_card_close is
  'D-30. Append-only. How a card ended: converted into an order, or dismissed with a reason of at least 5 characters.';

alter table public.sales_order
  add constraint sales_order_intake_card_fk foreign key (intake_card_id) references public.order_intake_card (id);
create unique index sales_order_intake_card_idx on public.sales_order (intake_card_id) where intake_card_id is not null;

-- ----------------------------------------------------------------- guards ------
create trigger append_only before update or delete on public.order_intake_card       for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.order_intake_card               for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.order_intake_card_close for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.order_intake_card_close         for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on public.order_intake_card       for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.order_intake_card_close for each row execute function control.audit_row();

-- ---------------------------------------------------------------------- RLS -----
alter table public.order_intake_card       enable row level security;
alter table public.order_intake_card       force  row level security;
alter table public.order_intake_card_close enable row level security;
alter table public.order_intake_card_close force  row level security;

-- The office reads all; a rep reads its own cards, and how they ended, on its approved phone.
create policy order_intake_card_select on public.order_intake_card for select to authenticated
  using ((select app.is_office())
         or (rep_id = (select auth.uid()) and (select app.is_rep()) and (select app.self_ok())));
create policy order_intake_card_close_select on public.order_intake_card_close for select to authenticated
  using ((select app.is_office()) or exists (
    select 1 from public.order_intake_card c where c.id = card_id and c.rep_id = (select auth.uid())
      and (select app.is_rep()) and (select app.self_ok())));

-- ----------------------------------------------------------------- privileges ----
revoke all on public.order_intake_card, public.order_intake_card_close from public, anon, authenticated, service_role;
grant select on public.order_intake_card, public.order_intake_card_close to authenticated, service_role;

revoke execute on function control.sales_order_creator() from public, anon, authenticated, service_role;

-- ------------------------------------------------------------ rep delivery ----
-- Same as migration 0013 except the ownership test: rep_id may now be null (an office order), and
-- `null <> auth.uid()` is not true, so the old test would have let any rep deliver a rep-less order.
create or replace function app.rep_deliver(
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
  if o.id is null or o.rep_id is distinct from auth.uid() then perform app.raise_denied('reps deliver only their own orders'); end if;
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

-- ------------------------------------------------------------ order builder ----
-- Internal (no grant): the part of the order engine shared by every channel. Same checks, messages,
-- discount approval and insert as app.create_order in migration 0012, with the channel, the rep, the
-- rep day, the assigned rep and the source card passed in, and created_by = the signed-in caller.
-- The caller's wrapper has already checked who may order for this salon and handled the replay.
create function app.build_order(
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
  -- MJ 2026-11-04: the owner's own discount on an office order needs no approval. Reps never get it.
  v_by_owner boolean := p_channel = 'office' and app.user_role() = 'owner';
  a       control.approval_request;
begin
  if p_plan is null or p_delivery_mode is null then
    raise exception using errcode = '22023', message = 'a plan and a delivery mode are required';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'an order has 1 to 50 lines';
  end if;
  -- Lines: [{sku_id, qty, unit_price_paisa?}]; the unit price defaults to the list price.
  with x as (
    select e.ord, (e.val ->> 'sku_id')::uuid as sku_id, (e.val ->> 'qty')::integer as qty,
           (e.val ->> 'unit_price_paisa')::bigint as unit_price
    from jsonb_array_elements(p_lines) with ordinality as e(val, ord))
  select count(*), count(distinct x.sku_id),
         sum(x.qty::bigint * k.list_price_paisa), sum(x.qty::bigint * (k.list_price_paisa - coalesce(x.unit_price, k.list_price_paisa)))
    into v_cnt, v_n, v_sub, v_disc
  from x left join public.sku k on k.id = x.sku_id;
  if exists (
       select 1 from jsonb_array_elements(p_lines) e(val)
       left join public.sku k on k.id = (e.val ->> 'sku_id')::uuid
       left join public.product p on p.id = k.product_id
       where k.id is null or not k.active or not p.active or k.list_price_paisa is null
          or (e.val ->> 'qty') is null or (e.val ->> 'qty')::integer not between 1 and 10000
          or coalesce((e.val ->> 'unit_price_paisa')::bigint, k.list_price_paisa) not between 1 and k.list_price_paisa) then
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
  select v_id, e.ord::integer, k.id, (e.val ->> 'qty')::integer, k.list_price_paisa,
         coalesce((e.val ->> 'unit_price_paisa')::bigint, k.list_price_paisa),
         (e.val ->> 'qty')::integer * coalesce((e.val ->> 'unit_price_paisa')::bigint, k.list_price_paisa)
  from jsonb_array_elements(p_lines) with ordinality as e(val, ord)
  join public.sku k on k.id = (e.val ->> 'sku_id')::uuid;
  return app.evaluate_order(v_id);
end $$;

-- ------------------------------------------------------------ rep order path ----
-- Same signature, checks and messages as migration 0012; the shared part now lives in app.build_order.
-- Still open to reps until a later task of PR A refuses it (D-30).
create or replace function app.create_order(
  p_client_id uuid, p_salon_id uuid, p_plan public.plan_code, p_delivery_mode public.delivery_mode, p_lines jsonb,
  p_visit_id uuid default null, p_created_at_client timestamptz default null)
returns public.sales_order
language plpgsql security definer set search_path = '' as $$
declare
  v_role  public.app_role := app.assert_actor_ready();
  o       public.sales_order;
  v_day   uuid;
begin
  if v_role <> 'rep' then perform app.raise_denied('only reps take orders in Phase 1'); end if;
  select * into o from public.sales_order where client_id = p_client_id;
  if o.id is not null then
    if o.rep_id = auth.uid() and o.salon_id = p_salon_id and o.plan = p_plan then return o; end if;   -- replay
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  v_day := app.my_open_day_id();
  if v_day is null then perform app.raise_denied('check in before taking orders (PIP-09)'); end if;
  if not app.rep_can_reach_salon(p_salon_id) then
    perform app.raise_denied('reps take orders only for salons in their own territories');
  end if;
  if p_plan is null or p_delivery_mode is null then
    raise exception using errcode = '22023', message = 'a plan and a delivery mode are required';
  end if;
  if p_visit_id is not null and not exists (
       select 1 from public.visit v where v.id = p_visit_id and v.rep_id = auth.uid() and v.salon_id = p_salon_id
         and v.rep_day_id = v_day) then
    raise exception using errcode = '22023', message = 'the visit must be the rep''s visit to this salon today';
  end if;
  return app.build_order(p_client_id, p_salon_id, p_plan, p_delivery_mode, p_lines, 'rep_visit', auth.uid(), v_day,
                         p_visit_id, null, null, p_created_at_client);
end $$;

-- --------------------------------------------------------- office order path ----
-- D-30: the owner or a manager makes an order for any salon. No rep and no rep day; an assigned rep
-- (who delivers it from the bag) must be an active rep currently covering the salon's territory,
-- otherwise the office delivers it from the warehouse. Idempotent on client_id (ORD-10): the same
-- creator, salon, plan and card get the same order back, checked before the card's open test.
-- ORD-14: with p_intake_card_id the order converts a rep's card. The card row is locked, must exist
-- and be for this salon (22023) and still be open (55000); the 'converted' close row is written in the
-- same transaction as the order. The assigned rep may differ from the card's rep (the page pre-selects it).
create function app.office_create_order(
  p_client_id uuid, p_salon_id uuid, p_plan public.plan_code, p_lines jsonb,
  p_assigned_rep_id uuid default null, p_intake_card_id uuid default null)
returns public.sales_order
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_office();
  o      public.sales_order;
  v_area uuid;
  k      public.order_intake_card;
begin
  select * into o from public.sales_order where client_id = p_client_id;
  if o.id is not null then
    if o.created_by = auth.uid() and o.salon_id = p_salon_id and o.plan = p_plan
       and o.intake_card_id is not distinct from p_intake_card_id then
      return o;                                                                -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if p_intake_card_id is not null then
    select * into k from public.order_intake_card c where c.id = p_intake_card_id for update;   -- one close per card
    if k.id is null then raise exception using errcode = '22023', message = 'unknown order card'; end if;
    if k.salon_id is distinct from p_salon_id then
      raise exception using errcode = '22023', message = 'the order card is for another salon';
    end if;
    if exists (select 1 from public.order_intake_card_close x where x.card_id = k.id) then
      raise exception using errcode = '55000', message = 'this order card is already closed';
    end if;
  end if;
  select s.area_id into v_area from public.salon s where s.id = p_salon_id;
  if not found then raise exception using errcode = '22023', message = 'unknown salon'; end if;
  if p_assigned_rep_id is not null and not (
       exists (select 1 from public.user_profile u
                where u.id = p_assigned_rep_id and u.role = 'rep' and u.status = 'active')
       and exists (select 1 from public.rep_territory rt join public.area a on a.territory_id = rt.territory_id
                    where rt.rep_id = p_assigned_rep_id and rt.to_date is null and a.id = v_area)) then
    raise exception using errcode = '22023',
      message = 'the assigned rep must be an active rep who covers this salon''s territory';
  end if;
  o := app.build_order(p_client_id, p_salon_id, p_plan,
                       case when p_assigned_rep_id is null then 'warehouse' else 'bag_now' end::public.delivery_mode,
                       p_lines, 'office', null, null, null, p_assigned_rep_id, p_intake_card_id, null);
  if p_intake_card_id is not null then
    perform app.set_purpose('order card converted');
    insert into public.order_intake_card_close (card_id, outcome, order_id, closed_by)
    values (p_intake_card_id, 'converted', o.id, auth.uid());
  end if;
  return o;
end $$;

-- ------------------------------------------------------------ order checks ----
-- Same as migration 0012 except the discount approval must be made by the order's creator
-- (created_by) rather than its rep: an office order has no rep, and the office user is the maker;
-- and an owner's own discount (discount_by_owner, MJ 2026-11-04) holds nothing.
create or replace function app.evaluate_order(p_order_id uuid) returns public.sales_order
language plpgsql security definer set search_path = '' as $$
declare
  o     public.sales_order;
  c     record;
  v_exp bigint;
  v_hc  text;
  v_hd  text;
  a     control.approval_request;
  s     public.salon;
  v_del integer;
begin
  select * into o from public.sales_order where id = p_order_id for update;
  if o.id is null then raise exception using errcode = '22023', message = 'unknown order'; end if;
  if o.status <> 'draft' then return o; end if;
  perform 1 from public.salon where id = o.salon_id for update;           -- one credit check per salon at a time
  c := app.credit_of(o.salon_id);
  v_exp := app.salon_exposure(o.salon_id);
  v_hc := case when o.plan = 'CASH' then null
               when c.blocked then 'blocked'
               when o.plan > c.plan_eligibility then 'plan_not_allowed'
               when v_exp + o.total_paisa > c.credit_limit_paisa then 'over_limit' end;
  if o.discount_paisa > 0 and not o.discount_by_owner then          -- the owner's own discount is approved
    select * into a from control.approval_request where id = o.discount_approval_id;
    v_hd := case when a.status = 'approved' and a.kind = 'discount' and a.subject_type = 'sales_order'
                      and a.subject_id = o.id and a.maker_id = o.created_by
                      and (a.payload ->> 'total_paisa')::bigint = o.total_paisa then null
                 when a.status = 'pending' then 'pending'
                 else 'rejected' end;
  end if;
  update public.sales_order
     set hold_credit = v_hc, hold_discount = v_hd,
         credit_snapshot = jsonb_build_object('plan_eligibility', c.plan_eligibility, 'credit_limit_paisa', c.credit_limit_paisa,
                                              'blocked', c.blocked, 'exposure_paisa', v_exp, 'checked_at', now())
   where id = o.id returning * into o;
  if o.hold_discount is null and (o.hold_credit is null or o.credit_override_by is not null) then
    update public.sales_order set status = 'confirmed', confirmed_at = now() where id = o.id returning * into o;
    -- Doc 02: an order makes the salon active (a dormant or at-risk salon restarts as active).
    select * into s from public.salon where id = o.salon_id;
    if s.stage in ('prospect', 'visited', 'trial', 'parked', 'dormant', 'at_risk') then
      select count(*) into v_del from public.sales_order x where x.salon_id = o.salon_id and x.status in ('delivered', 'closed');
      perform app.move_stage(o.salon_id, case when s.stage = 'at_risk' and v_del >= 3 then 'active_regular'
                                              else 'active_new' end::public.salon_stage, 'order', 'order confirmed');
    end if;
  end if;
  return o;
end $$;

-- ---------------------------------------------------- order path privileges ----
-- app.build_order is internal (no grant to any role); app.office_create_order is an RPC for the office.
revoke execute on function
  app.build_order(uuid, uuid, public.plan_code, public.delivery_mode, jsonb, public.order_channel, uuid, uuid, uuid,
                  uuid, uuid, timestamptz),
  app.office_create_order(uuid, uuid, public.plan_code, jsonb, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.office_create_order(uuid, uuid, public.plan_code, jsonb, uuid, uuid) to authenticated;

-- -------------------------------------------------------------- order cards ----
-- ORD-14, D-30: at a visit a rep saves what the salon needs as a card (not an order). Same day, device
-- and territory checks as app.log_visit. Idempotent on client_id (H-08): the same rep, salon, body and
-- visit get the same card back.
create function app.rep_create_card(p_client_id uuid, p_salon_id uuid, p_body text, p_visit_id uuid default null)
returns public.order_intake_card
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  k      public.order_intake_card;
  v_day  uuid;
  v_body text := btrim(p_body);
begin
  if v_role <> 'rep' then perform app.raise_denied('only reps save order cards'); end if;
  select * into k from public.order_intake_card where client_id = p_client_id;
  if k.id is not null then
    if k.rep_id = auth.uid() and k.salon_id = p_salon_id and k.body = v_body
       and k.visit_id is not distinct from p_visit_id then
      return k;                                                                -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  v_day := app.my_open_day_id();
  if v_day is null then perform app.raise_denied('check in before saving order cards (PIP-09)'); end if;
  if not app.rep_can_reach_salon(p_salon_id) then
    perform app.raise_denied('reps save order cards only for salons in their own territories');
  end if;
  if v_body is null or length(v_body) not between 1 and 2000 then
    raise exception using errcode = '22023', message = 'an order card needs a note of 1 to 2000 characters';
  end if;
  if p_visit_id is not null and not exists (
       select 1 from public.visit v where v.id = p_visit_id and v.rep_id = auth.uid() and v.salon_id = p_salon_id
         and v.rep_day_id = v_day) then
    raise exception using errcode = '22023', message = 'the visit must be the rep''s visit to this salon today';
  end if;
  perform app.set_purpose('order card saved');
  insert into public.order_intake_card (client_id, salon_id, rep_id, rep_day_id, visit_id, body)
  values (p_client_id, p_salon_id, auth.uid(), v_day, p_visit_id, v_body)
  returning * into k;
  return k;
end $$;

-- The rep's own cards (newest 50) and how each ended: open, converted (with the order) or dismissed
-- (with the reason). The salon's name is shown only while the rep still covers it, as in app.my_orders.
create function app.my_cards()
returns table (card_id uuid, salon_id uuid, salon_name text, body text, created_at timestamptz, status text,
               order_id uuid, reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.assert_actor_ready() <> 'rep' then perform app.raise_denied('order cards are listed for reps only'); end if;
  return query
  select c.id, c.salon_id, case when app.rep_can_reach_salon(c.salon_id) then s.name end, c.body, c.created_at,
         coalesce(x.outcome, 'open'), x.order_id, x.reason
  from public.order_intake_card c
  join public.salon s on s.id = c.salon_id
  left join public.order_intake_card_close x on x.card_id = c.id
  where c.rep_id = auth.uid()
  order by c.created_at desc, c.id
  limit 50;
end $$;

-- The office's queue: every card not yet converted or dismissed, oldest first, up to 200.
create function app.office_open_cards()
returns table (card_id uuid, salon_id uuid, salon_name text, rep_id uuid, rep_name text, body text,
               created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
  select c.id, c.salon_id, s.name, c.rep_id, u.full_name, c.body, c.created_at
  from public.order_intake_card c
  join public.salon s on s.id = c.salon_id
  join public.user_profile u on u.id = c.rep_id
  where not exists (select 1 from public.order_intake_card_close x where x.card_id = c.id)
  order by c.created_at, c.id
  limit 200;
end $$;

-- The office closes a card without an order, with a reason of at least 5 characters. The card row is
-- locked first, so a dismissal and a conversion cannot both close it (55000 for the second).
create function app.office_dismiss_card(p_card_id uuid, p_reason text)
returns public.order_intake_card_close
language plpgsql security definer set search_path = '' as $$
declare
  v_role   public.app_role := app.assert_office();
  k        public.order_intake_card;
  x        public.order_intake_card_close;
  v_reason text := btrim(p_reason);
begin
  if v_reason is null or length(v_reason) < 5 then
    raise exception using errcode = '22023', message = 'a dismissal needs a reason of at least 5 characters';
  end if;
  select * into k from public.order_intake_card c where c.id = p_card_id for update;
  if k.id is null then raise exception using errcode = '22023', message = 'unknown order card'; end if;
  if exists (select 1 from public.order_intake_card_close c where c.card_id = k.id) then
    raise exception using errcode = '55000', message = 'this order card is already closed';
  end if;
  perform app.set_purpose('order card dismissed');
  insert into public.order_intake_card_close (card_id, outcome, reason, closed_by)
  values (k.id, 'dismissed', v_reason, auth.uid())
  returning * into x;
  return x;
end $$;

revoke all on function
  app.rep_create_card(uuid, uuid, text, uuid), app.my_cards(), app.office_open_cards(),
  app.office_dismiss_card(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function
  app.rep_create_card(uuid, uuid, text, uuid), app.my_cards(), app.office_open_cards(),
  app.office_dismiss_card(uuid, text)
  to authenticated;
