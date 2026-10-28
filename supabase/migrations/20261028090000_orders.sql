-- =============================================================================
-- Kiran DMS · migration 0012 · Credit profile and orders (task P1-06, part a)
-- Requirements: SAL-04 (plan eligibility, credit limit, exposure, blocked), ORD-01 (order with
--               lines at list price, discount, plan, delivery mode), ORD-02 (credit check: hard
--               stop for reps, office override with reason), ORD-03 (states; cancel before
--               delivery), ORD-10 (offline orders are rechecked on sync; the rep sees the hold),
--               CTL-07 (any price below list needs an approval), CTL-08 (manager overrides
--               logged, capped per salon per month).
-- Docs: 02 (first order → active), 04 (salon_credit, credit_event, order, order_line),
--       09 §1–2 (plans, credit rules), 13 §9 (discount thresholds), MJ L-0157.
--
-- Money is integer paisa (H-10). The credit profile changes only together with a credit_event
-- in the same transaction (the same pattern as stage_event). Until invoices and payments exist
-- (part b, P1-07) exposure is the total of confirmed installment orders (A-10). A cash order
-- never needs credit: a blocked salon may still buy cash on delivery (doc 09 §2, MJ L-0157).
-- Delivery, stock and invoices are part b; orders here stop at confirmed or cancelled.
-- =============================================================================

create type public.plan_code as enum ('CASH', 'INST2', 'INST4');          -- ordered: eligibility allows a plan up to its level
create type public.order_status as enum ('draft', 'confirmed', 'partially_delivered', 'delivered', 'closed', 'cancelled');
create type public.delivery_mode as enum ('bag_now', 'warehouse');
create type public.credit_event_kind as enum (
  'owner_set', 'manager_raise', 'block', 'unblock', 'order_override', 'auto_increase', 'auto_decrease');

-- ------------------------------------------------------------------- tables ----
create table public.salon_credit (
  salon_id           uuid primary key references public.salon (id),
  plan_eligibility   public.plan_code not null default 'CASH',
  credit_limit_paisa bigint not null default 0 check (credit_limit_paisa >= 0),
  blocked            boolean not null default false,
  updated_by         uuid not null references public.user_profile (id),
  updated_at         timestamptz not null default now()
);
comment on table public.salon_credit is
  'SAL-04. A salon without a row is cash only, limit 0, not blocked. Changes only with a credit_event in the same transaction; never deleted.';

create table public.credit_event (
  id              uuid primary key default gen_random_uuid(),
  salon_id        uuid not null references public.salon (id),
  kind            public.credit_event_kind not null,
  old_plan        public.plan_code,
  new_plan        public.plan_code not null,
  old_limit_paisa bigint,
  new_limit_paisa bigint not null check (new_limit_paisa >= 0),
  old_blocked     boolean,
  new_blocked     boolean not null,
  order_id        uuid,                                        -- order_override: the order released (FK below)
  reason          text not null check (length(btrim(reason)) between 3 and 300),
  actor_id        uuid not null references public.user_profile (id),
  actor_role      public.app_role not null check (actor_role in ('owner', 'manager')),
  tx_id           bigint not null default txid_current(),
  created_at      timestamptz not null default now(),
  constraint credit_event_order check ((kind = 'order_override') = (order_id is not null))
);
create index credit_event_salon_idx on public.credit_event (salon_id, created_at);
comment on table public.credit_event is
  'SAL-04, CTL-08. Append-only history of every credit change and every order released over a credit hold.';

create table public.sales_order (
  id                     uuid primary key,
  client_id              uuid not null unique,               -- idempotency key from the phone (H-08, ORD-10)
  salon_id               uuid not null references public.salon (id),
  rep_id                 uuid not null references public.user_profile (id),
  rep_day_id             uuid not null references public.rep_day (id),
  visit_id               uuid references public.visit (id),
  plan                   public.plan_code not null,
  delivery_mode          public.delivery_mode not null,
  status                 public.order_status not null default 'draft',
  subtotal_paisa         bigint not null check (subtotal_paisa > 0),      -- at list price
  discount_paisa         bigint not null default 0 check (discount_paisa >= 0),
  total_paisa            bigint not null,
  discount_approval_id   uuid references control.approval_request (id),
  hold_credit            text check (hold_credit in ('blocked', 'plan_not_allowed', 'over_limit')),
  hold_discount          text check (hold_discount in ('pending', 'rejected')),
  credit_snapshot        jsonb not null default '{}'::jsonb,  -- eligibility, limit, exposure at the last check
  credit_override_by     uuid references public.user_profile (id),
  credit_override_reason text check (length(credit_override_reason) <= 300),
  created_at             timestamptz not null default now(),
  created_at_client      timestamptz,
  confirmed_at           timestamptz,
  cancelled_at           timestamptz,
  cancelled_by           uuid references public.user_profile (id),
  cancel_reason          text check (length(cancel_reason) <= 300),
  constraint sales_order_total check (total_paisa = subtotal_paisa - discount_paisa and total_paisa > 0),
  constraint sales_order_discount_approval check ((discount_paisa > 0) = (discount_approval_id is not null)),
  constraint sales_order_confirmed check (
    (status = 'draft') = (confirmed_at is null and cancelled_at is null)
    or status = 'cancelled'),
  constraint sales_order_confirmed_clear check (
    status in ('draft', 'cancelled') or (confirmed_at is not null and hold_discount is null
                                          and (hold_credit is null or credit_override_by is not null))),
  constraint sales_order_cancel_shape check (
    (status = 'cancelled') = (cancelled_at is not null)
    and (status <> 'cancelled' or (cancelled_by is not null and length(btrim(coalesce(cancel_reason, ''))) >= 3)))
);
create index sales_order_salon_idx on public.sales_order (salon_id, created_at);
create index sales_order_rep_idx on public.sales_order (rep_id, created_at);
comment on table public.sales_order is
  'ORD-01 to ORD-03. Draft until the credit check passes (or the office releases it) and any discount is approved; then confirmed. Amounts and lines never change; cancel is the only undo before delivery.';

alter table public.credit_event
  add constraint credit_event_order_fk foreign key (order_id) references public.sales_order (id);

create table public.sales_order_line (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.sales_order (id),
  line_no          integer not null check (line_no between 1 and 50),
  sku_id           uuid not null references public.sku (id),
  qty              integer not null check (qty between 1 and 10000),
  list_price_paisa bigint not null check (list_price_paisa > 0),
  unit_price_paisa bigint not null check (unit_price_paisa > 0 and unit_price_paisa <= list_price_paisa),
  line_total_paisa bigint not null,
  unique (order_id, line_no),
  unique (order_id, sku_id),
  constraint sales_order_line_total check (line_total_paisa = qty * unit_price_paisa)
);
comment on table public.sales_order_line is
  'ORD-01. Append-only. The list price is copied at order time; a lower unit price is a discount (CTL-07).';

-- ------------------------------------------------------------------- guards ----
create function control.salon_credit_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'credit profiles are never deleted';
  end if;
  if tg_op = 'UPDATE' and new.salon_id is distinct from old.salon_id then
    raise exception using errcode = '42501', message = 'a credit profile belongs to one salon';
  end if;
  if not exists (
       select 1 from public.credit_event e
       where e.salon_id = new.salon_id and e.tx_id = txid_current() and e.kind <> 'order_override'
         and e.new_plan = new.plan_eligibility and e.new_limit_paisa = new.credit_limit_paisa
         and e.new_blocked = new.blocked) then
    raise exception using errcode = '42501', message = 'a credit profile changes only with a credit_event (SAL-04)';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Amounts, parties and lines are fixed at creation; the status moves forward only.
create function control.sales_order_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'orders are never deleted; cancel them';
  end if;
  if (new.id, new.client_id, new.salon_id, new.rep_id, new.rep_day_id, new.visit_id, new.plan, new.delivery_mode,
      new.subtotal_paisa, new.discount_paisa, new.total_paisa, new.discount_approval_id, new.created_at,
      new.created_at_client)
     is distinct from
     (old.id, old.client_id, old.salon_id, old.rep_id, old.rep_day_id, old.visit_id, old.plan, old.delivery_mode,
      old.subtotal_paisa, old.discount_paisa, old.total_paisa, old.discount_approval_id, old.created_at,
      old.created_at_client) then
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

create trigger salon_credit_guard before insert or update or delete on public.salon_credit
  for each row execute function control.salon_credit_guard();
create trigger no_truncate before truncate on public.salon_credit for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.credit_event for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.credit_event for each statement execute function control.forbid_mutation();
create trigger sales_order_guard before update or delete on public.sales_order
  for each row execute function control.sales_order_guard();
create trigger no_truncate before truncate on public.sales_order for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.sales_order_line for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.sales_order_line for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on public.salon_credit     for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.credit_event     for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.sales_order      for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.sales_order_line for each row execute function control.audit_row();

-- ------------------------------------------------------------------ helpers ----
-- The salon's credit terms; blocked also when the salon's stage is blocked (doc 02).
create function app.credit_of(p_salon_id uuid,
                              out plan_eligibility public.plan_code, out credit_limit_paisa bigint, out blocked boolean)
language sql stable security definer set search_path = '' as $$
  select coalesce(c.plan_eligibility, 'CASH'::public.plan_code), coalesce(c.credit_limit_paisa, 0),
         coalesce(c.blocked, false) or s.stage = 'blocked'
  from public.salon s left join public.salon_credit c on c.salon_id = s.id
  where s.id = p_salon_id
$$;

-- A-10: confirmed installment orders not yet cancelled. Cash orders never count (MJ L-0157).
create function app.salon_exposure(p_salon_id uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(o.total_paisa), 0)::bigint from public.sales_order o
  where o.salon_id = p_salon_id and o.plan <> 'CASH'
    and o.status in ('confirmed', 'partially_delivered', 'delivered')
$$;

-- CTL-08: manager overrides on this salon in the current Karachi month.
create function app.manager_overrides_this_month(p_salon_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.credit_event e
  where e.salon_id = p_salon_id and e.actor_role = 'manager' and e.kind in ('manager_raise', 'unblock', 'order_override')
    and e.created_at >= (date_trunc('month', now() at time zone 'Asia/Karachi') at time zone 'Asia/Karachi')
$$;

-- A numeric config value, or null when the key is missing or not a number (callers fail closed).
create function app.config_number(p_key text) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when jsonb_typeof(c.value) = 'number' then (c.value #>> '{}')::numeric end
  from public.app_config c where c.key = p_key
$$;

-- Manager cap (doc 09 §2): refuses when the month's overrides reach the configured maximum.
create function app.assert_manager_override_allowed(p_salon_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_max numeric := app.config_number('credit.manager_override.max_per_salon_month');
begin
  if v_max is null then
    perform app.raise_denied('the manager override cap is not configured; ask the owner');
  end if;
  if app.manager_overrides_this_month(p_salon_id) >= v_max then
    perform app.raise_denied('the manager override cap for this salon this month is reached (CTL-08); ask the owner');
  end if;
end $$;

-- Internal: the only path that changes a credit profile. Writes the event, then the profile.
create function app.write_credit(p_salon_id uuid, p_kind public.credit_event_kind, p_plan public.plan_code,
                                 p_limit_paisa bigint, p_blocked boolean, p_reason text)
returns public.salon_credit
language plpgsql security definer set search_path = '' as $$
declare
  c public.salon_credit;
  v public.salon_credit;
begin
  if not exists (select 1 from public.salon s where s.id = p_salon_id) then
    raise exception using errcode = '22023', message = 'unknown salon';
  end if;
  if p_limit_paisa is null or p_limit_paisa < 0 then
    raise exception using errcode = '22023', message = 'a credit limit is zero or more paisa';
  end if;
  select * into c from public.salon_credit where salon_id = p_salon_id for update;
  insert into public.credit_event (salon_id, kind, old_plan, new_plan, old_limit_paisa, new_limit_paisa, old_blocked,
                                   new_blocked, reason, actor_id, actor_role)
  values (p_salon_id, p_kind, c.plan_eligibility, p_plan, c.credit_limit_paisa, p_limit_paisa, c.blocked, p_blocked,
          p_reason, auth.uid(), app.user_role());
  insert into public.salon_credit as t (salon_id, plan_eligibility, credit_limit_paisa, blocked, updated_by)
  values (p_salon_id, p_plan, p_limit_paisa, p_blocked, auth.uid())
  on conflict (salon_id) do update
    set plan_eligibility = excluded.plan_eligibility, credit_limit_paisa = excluded.credit_limit_paisa,
        blocked = excluded.blocked, updated_by = excluded.updated_by
  returning * into v;
  return v;
end $$;

-- ------------------------------------------------------------ credit profile ----
-- MJ L-0157 (2): until salon verification exists, the owner sets plan eligibility and limit by hand.
create function app.owner_set_credit(p_salon_id uuid, p_plan public.plan_code, p_limit_paisa bigint, p_reason text)
returns public.salon_credit
language plpgsql security definer set search_path = '' as $$
begin
  perform app.assert_owner();
  perform app.assert_reason(p_reason);
  if p_plan is null then raise exception using errcode = '22023', message = 'a plan is required'; end if;
  perform app.set_purpose('credit set by the owner: ' || p_reason);
  return app.write_credit(p_salon_id, 'owner_set', p_plan, p_limit_paisa,
                          coalesce((select x.blocked from public.salon_credit x where x.salon_id = p_salon_id), false),
                          p_reason);
end $$;

-- Doc 09 §2: a manager raises an existing limit by at most the configured percentage, within
-- the monthly cap; the owner may raise by any amount. Lowering a limit is owner_set_credit.
create function app.office_raise_limit(p_salon_id uuid, p_new_limit_paisa bigint, p_reason text)
returns public.salon_credit
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_office();
  c      public.salon_credit;
  v_pct  numeric := app.config_number('credit.manager_override.max_increase_pct');
begin
  perform app.assert_reason(p_reason);
  select * into c from public.salon_credit where salon_id = p_salon_id for update;
  if c.salon_id is null or p_new_limit_paisa is null or p_new_limit_paisa <= c.credit_limit_paisa then
    raise exception using errcode = '22023', message = 'a raise needs an existing limit and a higher new limit';
  end if;
  if v_role = 'manager' then
    if v_pct is null then perform app.raise_denied('the manager raise limit is not configured; ask the owner'); end if;
    if p_new_limit_paisa * 100 > c.credit_limit_paisa * (100 + v_pct) then
      perform app.raise_denied('a manager may raise a limit by at most the configured percentage (doc 09 §2)');
    end if;
    perform app.assert_manager_override_allowed(p_salon_id);
  end if;
  perform app.set_purpose('credit limit raised: ' || p_reason);
  return app.write_credit(p_salon_id, case when v_role = 'owner' then 'owner_set' else 'manager_raise' end::public.credit_event_kind,
                          c.plan_eligibility, p_new_limit_paisa, c.blocked, p_reason);
end $$;

-- Block (any office user) or unblock (a manager within the monthly cap; the owner always).
create function app.office_set_blocked(p_salon_id uuid, p_blocked boolean, p_reason text)
returns public.salon_credit
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_office();
  c      record;
begin
  perform app.assert_reason(p_reason);
  if p_blocked is null then raise exception using errcode = '22023', message = 'blocked must be true or false'; end if;
  c := app.credit_of(p_salon_id);
  if c.plan_eligibility is null then raise exception using errcode = '22023', message = 'unknown salon'; end if;
  if not p_blocked and v_role = 'manager' then
    perform app.assert_manager_override_allowed(p_salon_id);
  end if;
  perform app.set_purpose(case when p_blocked then 'salon blocked: ' else 'salon unblocked: ' end || p_reason);
  return app.write_credit(p_salon_id, case when p_blocked then 'block' else 'unblock' end::public.credit_event_kind,
                          c.plan_eligibility, c.credit_limit_paisa, p_blocked, p_reason);
end $$;

-- -------------------------------------------------------------------- orders ----
-- Internal: re-run the checks of a draft order and confirm it when nothing holds it.
-- ORD-02: credit is checked for installment plans only; the office's release (credit_override_by)
-- clears a credit hold. CTL-07: a discount holds the order until its approval is approved.
create function app.evaluate_order(p_order_id uuid) returns public.sales_order
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
  if o.discount_paisa > 0 then
    select * into a from control.approval_request where id = o.discount_approval_id;
    v_hd := case when a.status = 'approved' and a.kind = 'discount' and a.subject_type = 'sales_order'
                      and a.subject_id = o.id and a.maker_id = o.rep_id
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

-- ORD-01 / ORD-10: the rep takes an order during an open day, for a salon it can reach. Prices are
-- the current list prices; a lower unit price is a discount and requests an approval (CTL-07),
-- from the owner above the doc 13 §9 threshold. Idempotent on client_id. A failed check does not
-- refuse the order: it stays a draft with its holds, so an offline order is never lost (ORD-10).
create function app.create_order(
  p_client_id uuid, p_salon_id uuid, p_plan public.plan_code, p_delivery_mode public.delivery_mode, p_lines jsonb,
  p_visit_id uuid default null, p_created_at_client timestamptz default null)
returns public.sales_order
language plpgsql security definer set search_path = '' as $$
declare
  v_role  public.app_role := app.assert_actor_ready();
  o       public.sales_order;
  v_id    uuid := gen_random_uuid();
  v_day   uuid;
  v_sub   bigint;
  v_disc  bigint;
  v_n     integer;
  v_cnt   integer;
  v_thr   jsonb;
  v_owner boolean;
  a       control.approval_request;
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
  if v_disc > 0 then
    v_thr := (select c.value from public.app_config c where c.key = 'approval.discount.owner_above');
    -- doc 13 §9: the owner decides above the threshold; a missing threshold sends it to the owner.
    v_owner := v_thr is null or jsonb_typeof(v_thr -> 'pct') <> 'number' or jsonb_typeof(v_thr -> 'paisa') <> 'number'
               or v_disc * 100 > v_sub * (v_thr ->> 'pct')::numeric or v_disc > (v_thr ->> 'paisa')::numeric;
    a := app.request_approval(gen_random_uuid(), 'discount', 'sales_order', v_id,
                              jsonb_build_object('salon_id', p_salon_id, 'subtotal_paisa', v_sub, 'discount_paisa', v_disc,
                                                 'total_paisa', v_sub - v_disc),
                              'discount below list price (CTL-07)',
                              case when v_owner then 'owner' else 'manager' end::public.app_role);
  end if;
  insert into public.sales_order (id, client_id, salon_id, rep_id, rep_day_id, visit_id, plan, delivery_mode,
                                  subtotal_paisa, discount_paisa, total_paisa, discount_approval_id, created_at_client)
  values (v_id, p_client_id, p_salon_id, auth.uid(), v_day, p_visit_id, p_plan, p_delivery_mode,
          v_sub, v_disc, v_sub - v_disc, a.id, p_created_at_client);
  insert into public.sales_order_line (order_id, line_no, sku_id, qty, list_price_paisa, unit_price_paisa, line_total_paisa)
  select v_id, e.ord::integer, k.id, (e.val ->> 'qty')::integer, k.list_price_paisa,
         coalesce((e.val ->> 'unit_price_paisa')::bigint, k.list_price_paisa),
         (e.val ->> 'qty')::integer * coalesce((e.val ->> 'unit_price_paisa')::bigint, k.list_price_paisa)
  from jsonb_array_elements(p_lines) with ordinality as e(val, ord)
  join public.sku k on k.id = (e.val ->> 'sku_id')::uuid;
  return app.evaluate_order(v_id);
end $$;

-- ORD-10: re-run the checks (after an approval, a credit change, or a sync). The order's rep or the office.
create function app.recheck_order(p_order_id uuid) returns public.sales_order
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  o      public.sales_order;
begin
  select * into o from public.sales_order where id = p_order_id;
  if o.id is null or not (app.is_office() or (v_role = 'rep' and o.rep_id = auth.uid())) then
    perform app.raise_denied('only the order''s rep or the office rechecks an order');
  end if;
  perform app.set_purpose('order rechecked');
  return app.evaluate_order(p_order_id);
end $$;

-- ORD-02: the office releases an order held by the credit check, with a reason. A manager may
-- release only what a manager could grant (doc 09 §2): an unblock, or an excess within the raise
-- percentage, never a plan above the salon's eligibility; each release counts toward the
-- monthly cap (CTL-08). The owner may release any hold.
create function app.office_release_credit_hold(p_order_id uuid, p_reason text) returns public.sales_order
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_office();
  o      public.sales_order;
  c      record;
  v_pct  numeric := app.config_number('credit.manager_override.max_increase_pct');
begin
  perform app.assert_reason(p_reason);
  o := app.evaluate_order(p_order_id);
  if o.status = 'confirmed' then return o; end if;                          -- nothing holds it any more
  if o.status <> 'draft' or o.hold_credit is null or o.credit_override_by is not null then
    raise exception using errcode = '22023', message = 'this order is not held by the credit check';
  end if;
  c := app.credit_of(o.salon_id);
  if v_role = 'manager' then
    -- Each condition on its own: the recorded hold is only the first that failed.
    if o.plan > c.plan_eligibility then
      perform app.raise_denied('only the owner gives a salon a plan above its eligibility');
    end if;
    if v_pct is null or (app.salon_exposure(o.salon_id) + o.total_paisa) * 100 > c.credit_limit_paisa * (100 + v_pct) then
      perform app.raise_denied('a manager may release at most the configured percentage over the limit (doc 09 §2)');
    end if;
    perform app.assert_manager_override_allowed(o.salon_id);
  end if;
  perform app.set_purpose('credit hold released: ' || p_reason);
  insert into public.credit_event (salon_id, kind, old_plan, new_plan, old_limit_paisa, new_limit_paisa, old_blocked,
                                   new_blocked, order_id, reason, actor_id, actor_role)
  values (o.salon_id, 'order_override', c.plan_eligibility, c.plan_eligibility, c.credit_limit_paisa, c.credit_limit_paisa,
          c.blocked, c.blocked, o.id, p_reason, auth.uid(), v_role);
  update public.sales_order set credit_override_by = auth.uid(), credit_override_reason = left(p_reason, 300)
   where id = o.id;
  return app.evaluate_order(o.id);
end $$;

-- ORD-03: the rep cancels its own draft; the office cancels a draft or a confirmed order before
-- delivery. Always with a reason. A pending discount request is cancelled with it.
create function app.cancel_order(p_order_id uuid, p_reason text) returns public.sales_order
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  o      public.sales_order;
begin
  perform app.assert_reason(p_reason);
  select * into o from public.sales_order where id = p_order_id for update;
  if o.id is null then raise exception using errcode = '22023', message = 'unknown order'; end if;
  if o.status = 'cancelled' then return o; end if;                          -- replay
  if not (app.is_office() and o.status in ('draft', 'confirmed'))
     and not (v_role = 'rep' and o.rep_id = auth.uid() and o.status = 'draft') then
    perform app.raise_denied('a rep cancels only its own draft; the office cancels before delivery (ORD-03)');
  end if;
  perform app.set_purpose('order cancelled: ' || p_reason);
  update control.approval_request
     set status = 'cancelled', decided_at = now(), decision_reason = 'order cancelled: ' || left(p_reason, 200)
   where id = o.discount_approval_id and status = 'pending';
  update public.sales_order
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = left(p_reason, 300)
   where id = o.id returning * into o;
  return o;
end $$;

-- ---------------------------------------------------------------------- reads ----
-- The credit terms a rep needs to choose a plan, for a salon it can reach (or the office).
create function app.salon_credit_status(p_salon_id uuid)
returns table (plan_eligibility public.plan_code, credit_limit_paisa bigint, exposure_paisa bigint,
               available_paisa bigint, blocked boolean)
language sql stable security definer set search_path = '' as $$
  select c.plan_eligibility, c.credit_limit_paisa, app.salon_exposure(p_salon_id),
         greatest(c.credit_limit_paisa - app.salon_exposure(p_salon_id), 0), c.blocked
  from app.credit_of(p_salon_id) c
  where c.plan_eligibility is not null and (app.rep_can_reach_salon(p_salon_id) or app.is_office())
$$;

-- The rep's own orders, newest first, at most 50.
create function app.my_orders()
returns table (id uuid, salon_id uuid, salon_name text, status public.order_status, plan public.plan_code,
               total_paisa bigint, discount_paisa bigint, hold_credit text, hold_discount text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.id, o.salon_id, case when app.rep_can_reach_salon(o.salon_id) then s.name end, o.status, o.plan, o.total_paisa, o.discount_paisa, o.hold_credit, o.hold_discount,
         o.created_at
  from public.sales_order o join public.salon s on s.id = o.salon_id
  where app.self_ok() and app.user_role() = 'rep' and o.rep_id = auth.uid()
  order by o.created_at desc, o.id
  limit 50
$$;

-- ---------------------------------------------------------------------- RLS -----
alter table public.salon_credit     enable row level security;
alter table public.salon_credit     force  row level security;
alter table public.credit_event     enable row level security;
alter table public.credit_event     force  row level security;
alter table public.sales_order      enable row level security;
alter table public.sales_order      force  row level security;
alter table public.sales_order_line enable row level security;
alter table public.sales_order_line force  row level security;

-- Credit is office-only at the table (reps read app.salon_credit_status); a rep reads its own
-- orders and their lines.
create policy salon_credit_select on public.salon_credit for select to authenticated using ((select app.is_office()));
create policy credit_event_select on public.credit_event for select to authenticated using ((select app.is_office()));
create policy sales_order_select on public.sales_order for select to authenticated
  using ((select app.is_office()) or (rep_id = (select auth.uid()) and (select app.self_ok())));
create policy sales_order_line_select on public.sales_order_line for select to authenticated
  using ((select app.is_office()) or exists (
    select 1 from public.sales_order o where o.id = order_id and o.rep_id = (select auth.uid()) and (select app.self_ok())));

-- ----------------------------------------------------------------- privileges ----
revoke all on public.salon_credit, public.credit_event, public.sales_order, public.sales_order_line
  from public, anon, authenticated, service_role;
grant select on public.salon_credit, public.credit_event, public.sales_order, public.sales_order_line
  to authenticated, service_role;

revoke execute on function
  control.salon_credit_guard(), control.sales_order_guard(),
  app.credit_of(uuid), app.salon_exposure(uuid), app.manager_overrides_this_month(uuid), app.config_number(text),
  app.assert_manager_override_allowed(uuid),
  app.write_credit(uuid, public.credit_event_kind, public.plan_code, bigint, boolean, text),
  app.owner_set_credit(uuid, public.plan_code, bigint, text), app.office_raise_limit(uuid, bigint, text),
  app.office_set_blocked(uuid, boolean, text), app.evaluate_order(uuid),
  app.create_order(uuid, uuid, public.plan_code, public.delivery_mode, jsonb, uuid, timestamptz),
  app.recheck_order(uuid), app.office_release_credit_hold(uuid, text), app.cancel_order(uuid, text),
  app.salon_credit_status(uuid), app.my_orders()
  from public, anon, authenticated, service_role;

grant execute on function
  app.owner_set_credit(uuid, public.plan_code, bigint, text), app.office_raise_limit(uuid, bigint, text),
  app.office_set_blocked(uuid, boolean, text),
  app.create_order(uuid, uuid, public.plan_code, public.delivery_mode, jsonb, uuid, timestamptz),
  app.recheck_order(uuid), app.office_release_credit_hold(uuid, text), app.cancel_order(uuid, text),
  app.salon_credit_status(uuid), app.my_orders()
  to authenticated;
