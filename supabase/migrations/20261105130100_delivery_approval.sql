-- =============================================================================
-- Kiran DMS · migration 20261105130100 · Delivery submission and office approval (completion slice 4, P1-21)
-- Requirements: ORD-03, ORD-04 (rewritten for D-32), ADM-03, SEC-11, CTL-05, H-06, H-08, H-09, H-13.
-- Decisions: D-32 (doc 12; MJ's requirement, ACTIVITY L-0385: a rep's delivery is an immutable
--            submission; only the owner's or manager's approval writes the delivery, the sale
--            movement, the invoice, the installments and the order status; rejected goods stay in
--            pending custody until the office settles them), D-31, D-30, A-16, A-18, L-0163.
-- Plan: docs/superpowers/plans/2026-11-04-delivery-submission-approval.md; MJ accepted every
--       recommended default of its decisions table on 2026-11-04 (cash at the door: the rep collects
--       after approval; no payment code changes).
-- Spec: docs/superpowers/specs/2026-11-03-orders-delivery-commission-design.md sections 4 (PR B) to 7.
--
-- Uses the enum values added by 20261105130000_delivery_approval_enums.sql (Decision 7: Postgres
-- cannot use a value added by `alter type ... add value` in the same transaction).
--
-- What is built:
--   * A pending_delivery stock location per rep, made with the rep's bag (trigger) and backfilled for
--     bags that exist. The office cannot make one by hand.
--   * public.delivery_submission, public.delivery_submission_decision, public.pending_stock_resolution:
--     append-only, audited, RLS enabled and forced, no write grant to any role.
--   * invoice.delivered_by and invoice.commission_rep_id (Decision 8: nullable, with a NOT VALID check
--     that binds every new invoice and leaves existing rows, which are append-only, alone).
--   * app.finalise_delivery (internal) replaces app.deliver and takes the deliverer as parameters;
--     app.office_approve_delivery and app.office_deliver are its only callers.
--   * app.rep_submit_delivery: the rep's delivery is a submission that moves goods bag to pending and
--     changes nothing official. app.rep_deliver keeps its signature, refuses everyone and has no grant.
--   * app.office_approve_delivery, app.office_reject_delivery, app.office_resolve_pending and the reads
--     app.my_submissions, app.office_pending_deliveries, app.office_pending_stock.
-- =============================================================================

-- ------------------------------------------------------- pending location ----
-- A pending_delivery location has an owner (the rep) like a bag, and no value limit (CTL-05 counts
-- the bag only, Decision 13).
alter table public.stock_location drop constraint stock_location_bag_owner;
alter table public.stock_location
  add constraint stock_location_bag_owner check ((kind in ('rep_bag', 'pending_delivery')) = (owner_user_id is not null));
create unique index stock_location_one_pending_per_rep on public.stock_location (owner_user_id) where kind = 'pending_delivery';
comment on index public.stock_location_one_pending_per_rep is
  'D-32. One pending-delivery location per rep: goods handed over and waiting for the office''s decision, or rejected and not yet settled.';

-- Every new rep bag gets its pending twin, with the same owner and maker.
create function control.stock_location_pending_twin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.stock_location (id, kind, name, owner_user_id, created_by)
  values (gen_random_uuid(), 'pending_delivery', 'Pending: ' || left(new.name, 60), new.owner_user_id, new.created_by);
  return null;
end $$;

create trigger stock_location_pending_twin after insert on public.stock_location
  for each row when (new.kind = 'rep_bag') execute function control.stock_location_pending_twin();

-- Backfill: bags that already exist get their twin now.
select set_config('app.purpose', 'D-32: pending location for an existing rep bag', true);
insert into public.stock_location (id, kind, name, owner_user_id, created_by)
select gen_random_uuid(), 'pending_delivery', 'Pending: ' || left(b.name, 60), b.owner_user_id, b.created_by
from public.stock_location b
where b.kind = 'rep_bag'
  and not exists (select 1 from public.stock_location p where p.kind = 'pending_delivery' and p.owner_user_id = b.owner_user_id);
select set_config('app.purpose', '', true);

-- Migration 0008's app.office_create_location with one refusal added: a pending location is made only
-- with the rep's bag (the trigger above), never by hand.
create or replace function app.office_create_location(p_id uuid, p_kind public.stock_location_kind, p_name text,
                                                      p_owner_user_id uuid default null, p_bag_value_limit_paisa bigint default null)
returns public.stock_location
language plpgsql security definer set search_path = '' as $$
declare v public.stock_location;
begin
  perform app.assert_office();
  if p_kind = 'pending_delivery' then
    raise exception using errcode = '22023', message = 'pending locations are created with the rep''s bag';
  end if;
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

-- --------------------------------------------------------- movement kinds ----
-- submitted_to_salon (bag to pending) and pending_returned (pending to bag) move between two
-- locations. Every other kind keeps migration 0008's shape.
alter table public.stock_movement drop constraint stock_movement_kind_shape;
alter table public.stock_movement
  add constraint stock_movement_kind_shape check (
    case kind
      when 'issue_to_rep'        then from_location_id is not null and to_location_id is not null
      when 'return_to_warehouse' then from_location_id is not null and to_location_id is not null
      when 'transfer'            then from_location_id is not null and to_location_id is not null
      when 'submitted_to_salon'  then from_location_id is not null and to_location_id is not null
      when 'pending_returned'    then from_location_id is not null and to_location_id is not null
      when 'sale'                then from_location_id is not null and to_location_id is null
      when 'sale_to_agent'       then from_location_id is not null and to_location_id is null
      when 'receipt'             then from_location_id is null     and to_location_id is not null
      when 'return_in'           then from_location_id is null     and to_location_id is not null
      when 'adjustment'          then (from_location_id is null) <> (to_location_id is null) and approval_id is not null
      else true
    end);

-- ------------------------------------------------------------ submissions ----
create table public.delivery_submission (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null unique,                    -- idempotency key from the phone (H-08)
  order_id            uuid not null references public.sales_order (id),
  salon_id            uuid not null references public.salon (id),
  rep_id              uuid not null references public.user_profile (id),
  rep_day_id          uuid not null references public.rep_day (id),
  lines               jsonb not null,                          -- [{sku_id, qty}], normalised, ordered by sku_id
  received_by_name    text not null,
  lat                 numeric(9, 6) not null,
  lng                 numeric(9, 6) not null,
  distance_from_pin_m integer,
  device_fingerprint  text not null,
  mock_location       boolean not null default false,
  flags               jsonb not null default '[]'::jsonb,      -- mock_location, distance_unknown (Decision 11)
  submitted_at        timestamptz not null default now(),      -- server time (H-09)
  submitted_at_client timestamptz,                             -- the phone's time, evidence only
  constraint delivery_submission_lines check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0),
  constraint delivery_submission_received_by check (length(btrim(received_by_name)) between 2 and 80),
  -- Named as on public.delivery, so a bad GPS reading is refused in the same words (names are per table).
  constraint delivery_lat_check check (lat between -90 and 90),
  constraint delivery_lng_check check (lng between -180 and 180),
  constraint delivery_submission_distance check (distance_from_pin_m >= 0),
  constraint delivery_submission_flags check (jsonb_typeof(flags) = 'array')
);
create index delivery_submission_order_idx on public.delivery_submission (order_id);
create index delivery_submission_rep_idx   on public.delivery_submission (rep_id, submitted_at desc);
comment on table public.delivery_submission is
  'D-32. Append-only. A rep''s delivery as handed over: the goods moved bag to pending; nothing official (delivery, sale, invoice, order status) changes until the office decides.';

create table public.delivery_submission_decision (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null unique,                          -- idempotency key (H-08)
  submission_id uuid not null unique references public.delivery_submission (id),   -- decided once
  outcome       text not null check (outcome in ('approved', 'rejected')),
  delivery_id   uuid unique references public.delivery (id),
  reason        text,
  decided_by    uuid not null references public.user_profile (id),
  decided_at    timestamptz not null default now(),
  constraint delivery_submission_decision_shape check (
    (outcome = 'approved' and delivery_id is not null and reason is null)
    or (outcome = 'rejected' and delivery_id is null and length(btrim(coalesce(reason, ''))) between 5 and 500))
);
comment on table public.delivery_submission_decision is
  'D-32. Append-only. The office''s one decision on a submission: approved (with the delivery it wrote) or rejected (with a reason).';

create table public.pending_stock_resolution (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null unique,                          -- idempotency key (H-08)
  submission_id uuid not null references public.delivery_submission (id),
  sku_id        uuid not null references public.sku (id),
  qty           integer not null check (qty > 0),
  outcome       text not null check (outcome in ('returned_to_bag', 'returned_to_warehouse', 'missing')),
  note          text not null check (length(btrim(note)) between 3 and 300),   -- the count evidence
  movement_id   uuid not null unique references public.stock_movement (id),
  approval_id   uuid references control.approval_request (id),
  resolved_by   uuid not null references public.user_profile (id),
  resolved_at   timestamptz not null default now(),
  constraint pending_stock_resolution_approval check ((outcome = 'missing') = (approval_id is not null))
);
create index pending_stock_resolution_submission_idx on public.pending_stock_resolution (submission_id, sku_id);
comment on table public.pending_stock_resolution is
  'D-32, L-0385. Append-only. Where rejected goods went: back to the bag, to a warehouse, or missing (with an approved adjustment). Never more than is unsettled.';

-- What is unsettled for one submission and SKU: submitted minus delivered (the decision's delivery;
-- 0 when rejected) minus what earlier settlements took. An undecided submission has nothing to settle.
-- The submission row is locked first, so two settlements of the same goods cannot both pass.
create function control.pending_resolution_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_sub       integer;
  v_delivered integer;
  v_settled   integer;
  v_decided   boolean;
begin
  perform 1 from public.delivery_submission s where s.id = new.submission_id for update;
  select coalesce(sum((e ->> 'qty')::integer), 0) into v_sub
  from public.delivery_submission s, jsonb_array_elements(s.lines) e
  where s.id = new.submission_id and (e ->> 'sku_id')::uuid = new.sku_id;
  select exists (select 1 from public.delivery_submission_decision x where x.submission_id = new.submission_id) into v_decided;
  select coalesce(sum(dl.qty), 0) into v_delivered
  from public.delivery_submission_decision x join public.delivery_line dl on dl.delivery_id = x.delivery_id
  where x.submission_id = new.submission_id and dl.sku_id = new.sku_id;
  select coalesce(sum(r.qty), 0) into v_settled
  from public.pending_stock_resolution r where r.submission_id = new.submission_id and r.sku_id = new.sku_id;
  if not v_decided or new.qty + v_settled > v_sub - v_delivered then
    raise exception using errcode = '23514', message = 'more than is unsettled for this submission and SKU';
  end if;
  return new;
end $$;

create trigger pending_resolution_guard before insert on public.pending_stock_resolution
  for each row execute function control.pending_resolution_guard();

-- ------------------------------------------------------------ invoice stamps ----
-- delivered_by: who handed the goods over (the submitting rep, or the office user for an office
-- delivery). commission_rep_id: the order's assigned rep at approval (D-31, Decision 6). Slice 5
-- (P1-22, D-38) adds commission_rate_bp beside it, stamped in app.finalise_delivery.
-- Decision 8: no backfill (invoices are append-only, H-06); the NOT VALID check binds new rows only.
alter table public.invoice
  add column delivered_by      uuid references public.user_profile (id),
  add column commission_rep_id uuid references public.user_profile (id);
alter table public.invoice add constraint invoice_delivered_by_set check (delivered_by is not null) not valid;
comment on column public.invoice.delivered_by is
  'D-32. Who handed the goods over: the rep whose submission was approved, or the office user who delivered. Null only on invoices made before migration 20261105130100.';
comment on column public.invoice.commission_rep_id is
  'D-31, D-32. The order''s assigned rep at approval; null for a rep-less or legacy rep_visit order. Read by slice 5 (P1-22).';

-- ------------------------------------------------------------------- guards ----
create trigger append_only before update or delete on public.delivery_submission          for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.delivery_submission                  for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.delivery_submission_decision for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.delivery_submission_decision         for each statement execute function control.forbid_mutation();
create trigger append_only before update or delete on public.pending_stock_resolution     for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.pending_stock_resolution             for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on public.delivery_submission          for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.delivery_submission_decision for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.pending_stock_resolution     for each row execute function control.audit_row();

-- ---------------------------------------------------------------------- RLS -----
alter table public.delivery_submission          enable row level security;
alter table public.delivery_submission          force  row level security;
alter table public.delivery_submission_decision enable row level security;
alter table public.delivery_submission_decision force  row level security;
alter table public.pending_stock_resolution     enable row level security;
alter table public.pending_stock_resolution     force  row level security;

-- The office reads all; a rep reads its own submissions, their decisions and settlements, on its
-- approved phone (Decision 12).
create policy delivery_submission_select on public.delivery_submission for select to authenticated
  using ((select app.is_office())
         or (rep_id = (select auth.uid()) and (select app.is_rep()) and (select app.self_ok())));
create policy delivery_submission_decision_select on public.delivery_submission_decision for select to authenticated
  using ((select app.is_office()) or exists (
    select 1 from public.delivery_submission s where s.id = submission_id and s.rep_id = (select auth.uid())
      and (select app.is_rep()) and (select app.self_ok())));
create policy pending_stock_resolution_select on public.pending_stock_resolution for select to authenticated
  using ((select app.is_office()) or exists (
    select 1 from public.delivery_submission s where s.id = submission_id and s.rep_id = (select auth.uid())
      and (select app.is_rep()) and (select app.self_ok())));

-- ----------------------------------------------------------------- privileges ----
revoke all on public.delivery_submission, public.delivery_submission_decision, public.pending_stock_resolution
  from public, anon, authenticated, service_role;
grant select on public.delivery_submission, public.delivery_submission_decision, public.pending_stock_resolution
  to authenticated, service_role;

revoke execute on function control.stock_location_pending_twin(), control.pending_resolution_guard()
  from public, anon, authenticated, service_role;

-- =============================================================================
-- The one finalising path (plan Task 2)
-- =============================================================================
-- Internal (no grant): migration 20261104090000's app.deliver, every guard and the M1 lock note kept,
-- with the deliverer passed in instead of read from the session. Exactly these actors change:
--   delivery.delivered_by, delivered_by_role, rep_day_id, lat, lng, mock_location, delivered_at_client:
--     the parameters (the submitting rep and its submission's evidence, or the office user);
--   delivery.delivered_at: server time now, the approval (Decision 5);
--   stock_movement.actor_id, invoice.issued_by, cycle_estimate.set_by: auth.uid(), the approver or the
--     office user who delivered;
--   invoice.delivered_by: p_delivered_by; invoice.commission_rep_id: the order's assigned rep (Decision 6);
--   invoice.rep_id: coalesce(assigned_rep_id, rep_id), unchanged.
-- Callers: app.office_approve_delivery (the rep's approved submission, from its pending location) and
-- app.office_deliver (the office, from a warehouse).
create function app.finalise_delivery(
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
  -- 6). Slice 5 (P1-22, D-38) adds commission_rate_bp to this same insert.
  insert into public.invoice (number, delivery_id, order_id, salon_id, rep_id, plan, subtotal_paisa, discount_paisa,
                              total_paisa, issued_by, delivered_by, commission_rep_id)
  values (app.next_doc_number('INV'), d.id, o.id, o.salon_id, coalesce(o.assigned_rep_id, o.rep_id), o.plan, v_sub, v_sub - v_tot, v_tot,
          auth.uid(), p_delivered_by, o.assigned_rep_id)
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

revoke all on function
  app.finalise_delivery(uuid, uuid, uuid, jsonb, text, numeric, numeric, boolean, timestamptz, uuid, uuid, public.app_role)
  from public, anon, authenticated, service_role;

-- Migration 20261104090000's app.rep_deliver, calling app.finalise_delivery with the caller as the
-- deliverer. Kept only until the test fixtures move to submit-then-approve; closed further down.
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
  if o.id is null or (o.rep_id is distinct from auth.uid() and o.assigned_rep_id is distinct from auth.uid()) then
    perform app.raise_denied('reps deliver only their own orders');
  end if;
  v_day := app.my_open_day_id();
  if v_day is null then perform app.raise_denied('check in before delivering (PIP-09)'); end if;
  if not app.rep_can_reach_salon(o.salon_id) then
    perform app.raise_denied('reps deliver only to salons in their own territories');
  end if;
  if v_bag is null then perform app.raise_denied('this rep has no bag to deliver from'); end if;
  if p_lat is null or p_lng is null then
    raise exception using errcode = '22023', message = 'GPS is required for a delivery (MJ L-0163)';
  end if;
  return app.finalise_delivery(p_client_id, p_order_id, v_bag, p_lines, p_received_by_name, p_lat, p_lng, p_mock_location,
                               p_delivered_at_client, v_day, auth.uid(), v_role);
end $$;

-- Migration 0013's app.office_deliver, calling app.finalise_delivery with the office user as the
-- deliverer (A-18: a rep-less order is delivered by the office).
create or replace function app.office_deliver(
  p_client_id uuid, p_order_id uuid, p_warehouse_id uuid, p_received_by_name text,
  p_lines jsonb default null, p_lat numeric default null, p_lng numeric default null)
returns public.invoice
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_office();
  d      public.delivery;
begin
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
  return app.finalise_delivery(p_client_id, p_order_id, p_warehouse_id, p_lines, p_received_by_name, p_lat, p_lng, false,
                               null, null, auth.uid(), v_role);
end $$;

drop function app.deliver(uuid, uuid, uuid, jsonb, text, numeric, numeric, boolean, timestamptz, uuid);

-- =============================================================================
-- Rep submission (plan Task 3)
-- =============================================================================
-- Internal: a rep's pending-delivery location.
create function app.pending_location_of(p_rep_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select l.id from public.stock_location l where l.kind = 'pending_delivery' and l.owner_user_id = p_rep_id
$$;

-- Internal: per order line, what is left to deliver, how much of it undecided submissions already
-- hold (reserved), and what is still open to submit (Review Focus 1: a second phone, or a second tap
-- with a new client_id, cannot submit the same goods twice).
create function app.order_lines_open(p_order_id uuid)
returns table (order_line_id uuid, sku_id uuid, remaining integer, reserved integer, open integer)
language sql stable security definer set search_path = '' as $$
  with r as (
    select (e ->> 'sku_id')::uuid sku_id, sum((e ->> 'qty')::integer)::integer qty
    from public.delivery_submission s, jsonb_array_elements(s.lines) e
    where s.order_id = p_order_id
      and not exists (select 1 from public.delivery_submission_decision x where x.submission_id = s.id)
    group by 1)
  select x.order_line_id, x.sku_id, x.remaining, coalesce(r.qty, 0), x.remaining - coalesce(r.qty, 0)
  from app.order_lines_left(p_order_id) x left join r on r.sku_id = x.sku_id
  order by x.line_no
$$;

-- D-32: the rep hands the goods over and records the handover. The goods move from the bag to the
-- rep's pending location; the order, the official delivery, the sale and the invoice do not change
-- until the office approves. Same checks and messages as the rep path it replaces (app.rep_deliver),
-- in the same order, so the moved test fixtures fail the same way. p_lines null: everything still
-- open. Idempotent on client_id (H-08): the same rep, order, receiver and (when given) lines get the
-- same submission back.
create function app.rep_submit_delivery(
  p_client_id uuid, p_order_id uuid, p_received_by_name text, p_lat numeric, p_lng numeric,
  p_lines jsonb default null, p_mock_location boolean default false, p_submitted_at_client timestamptz default null)
returns public.delivery_submission
language plpgsql security definer set search_path = '' as $$
declare
  v_role  public.app_role := app.assert_actor_ready();
  sub     public.delivery_submission;
  o       public.sales_order;
  s       public.salon;
  v_day   uuid;
  v_bag   uuid := app.my_bag_id();
  v_pend  uuid;
  v_given jsonb;
  v_lines jsonb;                                           -- [{sku_id, qty}] ordered by sku_id
  v_bad   integer;
  v_dist  integer;
  v_flags jsonb := '[]'::jsonb;
begin
  if v_role <> 'rep' then perform app.raise_denied('reps deliver from their bag; the office uses office_deliver'); end if;
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a delivery needs a client_id (idempotency key, H-08)';
  end if;
  if p_lines is not null then
    select jsonb_agg(jsonb_build_object('sku_id', x.sku_id, 'qty', x.qty) order by x.sku_id) into v_given
    from app.parse_lines(p_lines) x;
  end if;
  select * into sub from public.delivery_submission where client_id = p_client_id;
  if sub.id is not null then
    if sub.rep_id = auth.uid() and sub.order_id = p_order_id and sub.received_by_name = btrim(p_received_by_name)
       and (v_given is null or sub.lines = v_given) then
      return sub;                                                                -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  select * into o from public.sales_order where id = p_order_id;
  if o.id is null or (o.rep_id is distinct from auth.uid() and o.assigned_rep_id is distinct from auth.uid()) then
    perform app.raise_denied('reps deliver only their own orders');
  end if;
  v_day := app.my_open_day_id();
  if v_day is null then perform app.raise_denied('check in before delivering (PIP-09)'); end if;
  if not app.rep_can_reach_salon(o.salon_id) then
    perform app.raise_denied('reps deliver only to salons in their own territories');
  end if;
  if v_bag is null then perform app.raise_denied('this rep has no bag to deliver from'); end if;
  if p_lat is null or p_lng is null then
    raise exception using errcode = '22023', message = 'GPS is required for a delivery (MJ L-0163)';
  end if;
  -- One submission of an order at a time; a retry that waited on this lock finds its own row now.
  select * into o from public.sales_order where id = p_order_id for update;
  select * into sub from public.delivery_submission where client_id = p_client_id;
  if sub.id is not null then
    if sub.rep_id = auth.uid() and sub.order_id = p_order_id and sub.received_by_name = btrim(p_received_by_name)
       and (v_given is null or sub.lines = v_given) then
      return sub;                                                                -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if o.status not in ('confirmed', 'partially_delivered') then
    raise exception using errcode = '22023', message = 'only a confirmed order is delivered (ORD-03)';
  end if;
  if length(btrim(coalesce(p_received_by_name, ''))) not between 2 and 80 then
    raise exception using errcode = '22023', message = 'the name of the person who received the goods is required (MJ L-0163)';
  end if;
  if v_given is null then
    select jsonb_agg(jsonb_build_object('sku_id', x.sku_id, 'qty', x.open) order by x.sku_id) into v_lines
    from app.order_lines_open(o.id) x where x.open > 0;
  else
    select count(*) into v_bad
    from jsonb_to_recordset(v_given) as g(sku_id uuid, qty integer)
    left join app.order_lines_open(o.id) x on x.sku_id = g.sku_id
    where x.order_line_id is null or g.qty > x.open;
    if v_bad > 0 then
      raise exception using errcode = '22023', message = 'every line must be a SKU of this order, at most what is left to deliver';
    end if;
    v_lines := v_given;
  end if;
  if v_lines is null then
    raise exception using errcode = '22023', message = 'nothing is left to deliver on this order';
  end if;
  v_pend := app.pending_location_of(auth.uid());
  if v_pend is null then
    raise exception using errcode = '55000', message = 'this rep has no pending-delivery location; the office re-creates the bag';
  end if;
  -- Units promised to a pending issue back to the warehouse are not available (migration 0008).
  if exists (select 1 from jsonb_to_recordset(v_lines) as t(sku_id uuid, qty integer)
             where app.on_hand(v_bag, t.sku_id) - app.pending_out(v_bag, t.sku_id) < t.qty) then
    raise exception using errcode = '23514', message = 'insufficient stock at the delivery location (part delivery is allowed)';
  end if;
  select * into s from public.salon where id = o.salon_id;
  if s.lat is null then
    v_flags := v_flags || '["distance_unknown"]'::jsonb;
  elsif p_lat between -90 and 90 and p_lng between -180 and 180 then
    v_dist := app.distance_m(s.lat, s.lng, p_lat, p_lng);
  end if;
  if coalesce(p_mock_location, false) then v_flags := '["mock_location"]'::jsonb || v_flags; end if;
  perform app.set_purpose('delivery submitted for approval');
  insert into public.delivery_submission (client_id, order_id, salon_id, rep_id, rep_day_id, lines, received_by_name,
                                          lat, lng, distance_from_pin_m, device_fingerprint, mock_location, flags,
                                          submitted_at_client)
  values (p_client_id, o.id, o.salon_id, auth.uid(), v_day, v_lines, btrim(p_received_by_name),
          p_lat, p_lng, v_dist, coalesce(app.request_device_id(), ''), coalesce(p_mock_location, false), v_flags,
          p_submitted_at_client)
  returning * into sub;
  insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, source_type, source_id, actor_id)
  select gen_random_uuid(), t.sku_id, t.qty, v_bag, v_pend, 'submitted_to_salon', 'delivery_submission', sub.id, auth.uid()
  from jsonb_to_recordset(v_lines) as t(sku_id uuid, qty integer);
  return sub;
end $$;

-- The rep's own submissions, newest 50, with how each stands: pending, approved (with its invoice) or
-- rejected (with the reason and what is still in pending custody). The salon's name only while the rep
-- reaches it, as app.my_orders. Lines carry the SKU code and variant.
create function app.my_submissions()
returns table (submission_id uuid, order_id uuid, salon_id uuid, salon_name text, lines jsonb, received_by_name text,
               submitted_at timestamptz, status text, reason text, invoice_id uuid, invoice_number text, unsettled integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.assert_actor_ready() <> 'rep' then perform app.raise_denied('delivery submissions are listed for reps only'); end if;
  return query
  select s.id, s.order_id, s.salon_id, case when app.rep_can_reach_salon(s.salon_id) then sa.name end,
         (select jsonb_agg(jsonb_build_object('sku_id', k.id, 'code', k.code, 'variant', k.variant, 'qty', (e ->> 'qty')::integer)
                           order by k.code)
          from jsonb_array_elements(s.lines) e join public.sku k on k.id = (e ->> 'sku_id')::uuid),
         s.received_by_name, s.submitted_at, coalesce(x.outcome, 'pending'), x.reason, i.id, i.number,
         case when x.outcome = 'rejected' then
           (select coalesce(sum((e ->> 'qty')::integer), 0) from jsonb_array_elements(s.lines) e)::integer
           - (select coalesce(sum(r.qty), 0) from public.pending_stock_resolution r where r.submission_id = s.id)::integer
         else 0 end
  from public.delivery_submission s
  join public.salon sa on sa.id = s.salon_id
  left join public.delivery_submission_decision x on x.submission_id = s.id
  left join public.invoice i on i.delivery_id = x.delivery_id
  where s.rep_id = auth.uid()
  order by s.submitted_at desc, s.id
  limit 50;
end $$;

revoke all on function
  app.pending_location_of(uuid), app.order_lines_open(uuid),
  app.rep_submit_delivery(uuid, uuid, text, numeric, numeric, jsonb, boolean, timestamptz), app.my_submissions()
  from public, anon, authenticated, service_role;
grant execute on function
  app.rep_submit_delivery(uuid, uuid, text, numeric, numeric, jsonb, boolean, timestamptz), app.my_submissions()
  to authenticated;

-- =============================================================================
-- Office approval (plan Task 4)
-- =============================================================================
-- The owner or a manager (AAL2) approves a rep's submission. In one transaction app.finalise_delivery
-- re-checks the order, what is left and the stock in the rep's pending location, writes the delivery
-- (the rep as deliverer, the submission's day and GPS), the sale movement out of pending, the invoice
-- (with its installments, by trigger) and the order status; then the decision is recorded. All or
-- nothing (Decision 2): a wrong quantity is rejected and resubmitted. The rep's later suspension, move
-- or check-out does not block approval (Decision 9). Idempotent on client_id: the same caller and
-- submission get the same invoice back, including a retry that waited on the submission lock.
create function app.office_approve_delivery(p_submission_id uuid, p_client_id uuid)
returns public.invoice
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_office();
  s      public.delivery_submission;
  x      public.delivery_submission_decision;
  inv    public.invoice;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'an approval needs a client_id (idempotency key, H-08)';
  end if;
  select * into x from public.delivery_submission_decision where client_id = p_client_id;
  if x.id is not null then
    if x.submission_id = p_submission_id and x.decided_by = auth.uid() and x.outcome = 'approved' then
      return (select i from public.invoice i where i.delivery_id = x.delivery_id);   -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  select * into s from public.delivery_submission where id = p_submission_id for update;
  if s.id is null then raise exception using errcode = '22023', message = 'unknown delivery submission'; end if;
  -- A concurrent call with this client_id may have decided while this one waited on the lock.
  select * into x from public.delivery_submission_decision where client_id = p_client_id;
  if x.id is not null then
    if x.submission_id = p_submission_id and x.decided_by = auth.uid() and x.outcome = 'approved' then
      return (select i from public.invoice i where i.delivery_id = x.delivery_id);   -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  -- Roles normally make this impossible; app.owner_set_role can promote a rep with a submission queued.
  if s.rep_id = auth.uid() then perform app.raise_denied('the approver cannot be the rep who submitted (SEC-11)'); end if;
  if exists (select 1 from public.delivery_submission_decision d where d.submission_id = s.id) then
    raise exception using errcode = '55000', message = 'this delivery submission is already decided';
  end if;
  inv := app.finalise_delivery(s.client_id, s.order_id, app.pending_location_of(s.rep_id), s.lines, s.received_by_name,
                               s.lat, s.lng, s.mock_location, s.submitted_at_client, s.rep_day_id, s.rep_id, 'rep');
  -- Written only now, after app.finalise_delivery has taken the per-salon payment lock (M1).
  perform app.set_purpose('delivery submission approved');
  insert into public.delivery_submission_decision (client_id, submission_id, outcome, delivery_id, decided_by)
  values (p_client_id, s.id, 'approved', inv.delivery_id, auth.uid());
  return inv;
end $$;

-- The office's queue: undecided submissions, oldest first, up to 200, with the order's prices.
create function app.office_pending_deliveries()
returns table (submission_id uuid, order_id uuid, salon_id uuid, salon_name text, rep_id uuid, rep_name text, lines jsonb,
               total_paisa bigint, received_by_name text, distance_from_pin_m integer, mock_location boolean, flags jsonb,
               submitted_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
  select s.id, s.order_id, s.salon_id, sa.name, s.rep_id, u.full_name,
         (select jsonb_agg(jsonb_build_object('sku_id', k.id, 'code', k.code, 'variant', k.variant, 'qty', (e ->> 'qty')::integer,
                                              'unit_price_paisa', ol.unit_price_paisa) order by k.code)
          from jsonb_array_elements(s.lines) e
          join public.sku k on k.id = (e ->> 'sku_id')::uuid
          join public.sales_order_line ol on ol.order_id = s.order_id and ol.sku_id = k.id),
         (select coalesce(sum((e ->> 'qty')::bigint * ol.unit_price_paisa), 0)::bigint
          from jsonb_array_elements(s.lines) e
          join public.sales_order_line ol on ol.order_id = s.order_id and ol.sku_id = (e ->> 'sku_id')::uuid),
         s.received_by_name, s.distance_from_pin_m, s.mock_location, s.flags, s.submitted_at
  from public.delivery_submission s
  join public.salon sa on sa.id = s.salon_id
  join public.user_profile u on u.id = s.rep_id
  where not exists (select 1 from public.delivery_submission_decision x where x.submission_id = s.id)
  order by s.submitted_at, s.id
  limit 200;
end $$;

-- app.office_deliver above, with one refusal (Review Focus 3): while a rep's submission of the order
-- waits for a decision, the office cannot deliver the order from the warehouse, or the goods in pending
-- custody would be stranded. The order row is locked first, as a submission takes the same lock.
create or replace function app.office_deliver(
  p_client_id uuid, p_order_id uuid, p_warehouse_id uuid, p_received_by_name text,
  p_lines jsonb default null, p_lat numeric default null, p_lng numeric default null)
returns public.invoice
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_office();
  d      public.delivery;
begin
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
  perform 1 from public.sales_order o where o.id = p_order_id for update;
  if exists (select 1 from public.delivery_submission s where s.order_id = p_order_id
               and not exists (select 1 from public.delivery_submission_decision x where x.submission_id = s.id)) then
    raise exception using errcode = '55000', message = 'this order has a delivery waiting for approval';
  end if;
  return app.finalise_delivery(p_client_id, p_order_id, p_warehouse_id, p_lines, p_received_by_name, p_lat, p_lng, false,
                               null, null, auth.uid(), v_role);
end $$;

-- Migration 20261104090000's app.cancel_order with one refusal, after the row lock (Review Focus 3):
-- an order with a delivery waiting for approval is not cancelled. The refusal comes after the
-- who-may-cancel test (the plan put it before), so a caller who may not cancel the order learns
-- nothing about its submissions; the office still gets 55000.
create or replace function app.cancel_order(p_order_id uuid, p_reason text) returns public.sales_order
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
     and not (v_role = 'rep' and coalesce(o.rep_id = auth.uid(), false) and o.status = 'draft') then
    perform app.raise_denied('a rep cancels only its own draft; the office cancels before delivery (ORD-03)');
  end if;
  if exists (select 1 from public.delivery_submission s where s.order_id = o.id
               and not exists (select 1 from public.delivery_submission_decision x where x.submission_id = s.id)) then
    raise exception using errcode = '55000', message = 'this order has a delivery waiting for approval';
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

revoke all on function app.office_approve_delivery(uuid, uuid), app.office_pending_deliveries()
  from public, anon, authenticated, service_role;
grant execute on function app.office_approve_delivery(uuid, uuid), app.office_pending_deliveries() to authenticated;

-- =============================================================================
-- Rejection and settling pending stock (plan Task 5; L-0385's three ways to settle)
-- =============================================================================
-- The owner or a manager rejects a submission with a reason of 5 to 500 characters. Nothing moves:
-- the goods stay in the rep's pending location until app.office_resolve_pending settles them. Same
-- guards and replay rule as approval.
create function app.office_reject_delivery(p_submission_id uuid, p_client_id uuid, p_reason text)
returns public.delivery_submission_decision
language plpgsql security definer set search_path = '' as $$
declare
  v_role   public.app_role := app.assert_office();
  s        public.delivery_submission;
  x        public.delivery_submission_decision;
  v_reason text := btrim(p_reason);
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a rejection needs a client_id (idempotency key, H-08)';
  end if;
  select * into x from public.delivery_submission_decision where client_id = p_client_id;
  if x.id is not null then
    if x.submission_id = p_submission_id and x.decided_by = auth.uid() and x.outcome = 'rejected' then
      return x;                                                                  -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if v_reason is null or length(v_reason) not between 5 and 500 then
    raise exception using errcode = '22023', message = 'a rejection needs a reason of 5 to 500 characters';
  end if;
  select * into s from public.delivery_submission where id = p_submission_id for update;
  if s.id is null then raise exception using errcode = '22023', message = 'unknown delivery submission'; end if;
  select * into x from public.delivery_submission_decision where client_id = p_client_id;
  if x.id is not null then
    if x.submission_id = p_submission_id and x.decided_by = auth.uid() and x.outcome = 'rejected' then
      return x;                                                                  -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if s.rep_id = auth.uid() then perform app.raise_denied('the approver cannot be the rep who submitted (SEC-11)'); end if;
  if exists (select 1 from public.delivery_submission_decision d where d.submission_id = s.id) then
    raise exception using errcode = '55000', message = 'this delivery submission is already decided';
  end if;
  perform app.set_purpose('delivery submission rejected');
  insert into public.delivery_submission_decision (client_id, submission_id, outcome, reason, decided_by)
  values (p_client_id, s.id, 'rejected', v_reason, auth.uid())
  returning * into x;
  return x;
end $$;

-- Internal: migration 0008's app.office_post_adjustment body (an approved `adjustment` request, single
-- use, the owner threshold re-checked at use), shared by the office RPC and pending-stock settlement.
create function app.post_adjustment(p_client_id uuid, p_approval_id uuid)
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

-- The office RPC keeps its signature and grant. Pending stock is settled only through its submission
-- (app.office_resolve_pending), so an approved adjustment cannot drain a pending location directly
-- (Review Focus 5).
create or replace function app.office_post_adjustment(p_client_id uuid, p_approval_id uuid)
returns public.stock_movement
language plpgsql security definer set search_path = '' as $$
begin
  perform app.assert_office();
  if exists (select 1 from control.approval_request a join public.stock_location l on l.id = a.subject_id
             where a.id = p_approval_id and a.subject_type = 'stock_location' and l.kind = 'pending_delivery') then
    raise exception using errcode = '22023', message = 'pending stock is settled through its delivery submission';
  end if;
  return app.post_adjustment(p_client_id, p_approval_id);
end $$;

-- Internal: what of a submission's SKU is still in pending custody: submitted minus delivered (0 when
-- rejected) minus earlier settlements. Zero for an undecided submission (nothing to settle yet).
create function app.pending_unsettled(p_submission_id uuid, p_sku_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select case when not exists (select 1 from public.delivery_submission_decision x where x.submission_id = p_submission_id) then 0
         else (select coalesce(sum((e ->> 'qty')::integer), 0) from public.delivery_submission s, jsonb_array_elements(s.lines) e
               where s.id = p_submission_id and (e ->> 'sku_id')::uuid = p_sku_id)
            - (select coalesce(sum(dl.qty), 0) from public.delivery_submission_decision x join public.delivery_line dl on dl.delivery_id = x.delivery_id
               where x.submission_id = p_submission_id and dl.sku_id = p_sku_id)
            - (select coalesce(sum(r.qty), 0) from public.pending_stock_resolution r
               where r.submission_id = p_submission_id and r.sku_id = p_sku_id)
         end::integer
$$;

-- The office settles goods a rejected submission left in pending custody, with a count note:
--   returned_to_bag        pending to the rep's bag (Decision 4: no rep confirmation; the rep's next
--                          daily close is the cross-check);
--   returned_to_warehouse  pending to an active warehouse;
--   missing                an approved `adjustment` request for exactly this submission, SKU and
--                          quantity (Decision 3), posted through app.post_adjustment (status, single
--                          use and the owner threshold are enforced there).
-- Never more than is unsettled (here, and again by control.pending_resolution_guard). Idempotent on
-- client_id.
create function app.office_resolve_pending(
  p_client_id uuid, p_submission_id uuid, p_sku_id uuid, p_qty integer, p_outcome text, p_note text,
  p_warehouse_id uuid default null, p_approval_id uuid default null)
returns public.pending_stock_resolution
language plpgsql security definer set search_path = '' as $$
declare
  v_role  public.app_role := app.assert_office();
  s       public.delivery_submission;
  r       public.pending_stock_resolution;
  a       control.approval_request;
  m       public.stock_movement;
  v_id    uuid := gen_random_uuid();
  v_pend  uuid;
  v_bag   uuid;
  v_note  text := btrim(p_note);
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a settlement needs a client_id (idempotency key, H-08)';
  end if;
  select * into r from public.pending_stock_resolution where client_id = p_client_id;
  if r.id is not null then
    if r.resolved_by = auth.uid() and r.submission_id = p_submission_id and r.sku_id = p_sku_id and r.qty = p_qty
       and r.outcome = p_outcome then
      return r;                                                                  -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  select * into s from public.delivery_submission where id = p_submission_id for update;
  if s.id is null then raise exception using errcode = '22023', message = 'unknown delivery submission'; end if;
  select * into r from public.pending_stock_resolution where client_id = p_client_id;
  if r.id is not null then
    if r.resolved_by = auth.uid() and r.submission_id = p_submission_id and r.sku_id = p_sku_id and r.qty = p_qty
       and r.outcome = p_outcome then
      return r;                                                                  -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if s.rep_id = auth.uid() then perform app.raise_denied('the office user cannot settle their own submission (SEC-11)'); end if;
  if not exists (select 1 from public.delivery_submission_decision x where x.submission_id = s.id) then
    raise exception using errcode = '55000', message = 'decide the submission before settling its goods';
  end if;
  if p_outcome is null or p_outcome not in ('returned_to_bag', 'returned_to_warehouse', 'missing') then
    raise exception using errcode = '22023', message = 'a settlement is returned_to_bag, returned_to_warehouse or missing';
  end if;
  if v_note is null or length(v_note) not between 3 and 300 then
    raise exception using errcode = '22023', message = 'a settlement needs a count note of 3 to 300 characters';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > app.pending_unsettled(s.id, p_sku_id) then
    raise exception using errcode = '22023', message = 'at most the unsettled quantity can be settled';
  end if;
  v_pend := app.pending_location_of(s.rep_id);
  perform app.set_purpose('pending stock settled: ' || p_outcome);
  if p_outcome = 'returned_to_bag' then
    select l.id into v_bag from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = s.rep_id;
    if v_bag is null then raise exception using errcode = '22023', message = 'the rep has no bag to return the goods to'; end if;
    insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, source_type, source_id, reason, actor_id)
    values (gen_random_uuid(), p_sku_id, p_qty, v_pend, v_bag, 'pending_returned', 'pending_stock_resolution', v_id, left(v_note, 300), auth.uid())
    returning * into m;
  elsif p_outcome = 'returned_to_warehouse' then
    if not exists (select 1 from public.stock_location l where l.id = p_warehouse_id and l.kind = 'warehouse' and l.active) then
      raise exception using errcode = '22023', message = 'the goods return to an active warehouse';
    end if;
    insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, source_type, source_id, reason, actor_id)
    values (gen_random_uuid(), p_sku_id, p_qty, v_pend, p_warehouse_id, 'return_to_warehouse', 'pending_stock_resolution', v_id, left(v_note, 300), auth.uid())
    returning * into m;
  else
    select * into a from control.approval_request where id = p_approval_id for update;
    if a.id is null or a.kind <> 'adjustment' or a.subject_type <> 'stock_location' or a.subject_id is distinct from v_pend
       or a.payload ->> 'sku_id' is distinct from p_sku_id::text
       or coalesce(jsonb_typeof(a.payload -> 'qty_delta'), '') <> 'number' or (a.payload ->> 'qty_delta')::numeric <> -p_qty
       or a.payload ->> 'submission_id' is distinct from s.id::text then
      perform app.raise_denied('an approved adjustment for this quantity is required');
    end if;
    m := app.post_adjustment(gen_random_uuid(), p_approval_id);
  end if;
  insert into public.pending_stock_resolution (id, client_id, submission_id, sku_id, qty, outcome, note, movement_id, approval_id, resolved_by)
  values (v_id, p_client_id, s.id, p_sku_id, p_qty, p_outcome, v_note, m.id,
          case when p_outcome = 'missing' then p_approval_id end, auth.uid())
  returning * into r;
  return r;
end $$;

-- What is waiting to be settled: per rejected submission and SKU, the unsettled quantity (oldest
-- decision first, up to 500), with the newest adjustment request for it that is pending or approved
-- and not yet used, so the office page can offer the next step of a "missing" settlement.
create function app.office_pending_stock()
returns table (submission_id uuid, rep_id uuid, rep_name text, salon_name text, sku_id uuid, sku_code text, unsettled integer,
               pending_location_id uuid, reason text, decided_at timestamptz, request_id uuid,
               request_status public.approval_status, request_maker_id uuid, request_checker_role public.app_role)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
  select q.submission_id, q.rep_id, q.rep_name, q.salon_name, q.sku_id, q.sku_code, q.unsettled, q.pending_location_id,
         q.reason, q.decided_at, req.id, req.status, req.maker_id, req.checker_role_required
  from (
    select s.id submission_id, s.rep_id, u.full_name rep_name, sa.name salon_name, k.id sku_id, k.code sku_code,
           app.pending_unsettled(s.id, k.id) unsettled, app.pending_location_of(s.rep_id) pending_location_id,
           x.reason, x.decided_at
    from public.delivery_submission s
    join public.delivery_submission_decision x on x.submission_id = s.id and x.outcome = 'rejected'
    join public.user_profile u on u.id = s.rep_id
    join public.salon sa on sa.id = s.salon_id
    cross join lateral jsonb_array_elements(s.lines) e
    join public.sku k on k.id = (e ->> 'sku_id')::uuid) q
  left join lateral (
    select a.id, a.status, a.maker_id, a.checker_role_required
    from control.approval_request a
    where a.kind = 'adjustment' and a.subject_type = 'stock_location' and a.subject_id = q.pending_location_id
      and a.payload ->> 'submission_id' = q.submission_id::text and a.payload ->> 'sku_id' = q.sku_id::text
      and a.status in ('pending', 'approved')
      and not exists (select 1 from public.stock_movement m where m.approval_id = a.id)
    order by a.created_at desc, a.id
    limit 1) req on true
  where q.unsettled > 0
  order by q.decided_at, q.submission_id, q.sku_code
  limit 500;
end $$;

revoke all on function
  app.office_reject_delivery(uuid, uuid, text), app.post_adjustment(uuid, uuid), app.pending_unsettled(uuid, uuid),
  app.office_resolve_pending(uuid, uuid, uuid, integer, text, text, uuid, uuid), app.office_pending_stock()
  from public, anon, authenticated, service_role;
grant execute on function
  app.office_reject_delivery(uuid, uuid, text), app.office_resolve_pending(uuid, uuid, uuid, integer, text, text, uuid, uuid),
  app.office_pending_stock()
  to authenticated;

-- =============================================================================
-- The rep's direct delivery is closed (plan Task 7)
-- =============================================================================
-- D-32: a rep's delivery is a submission the office approves. app.rep_deliver keeps its signature,
-- language, SECURITY DEFINER and search_path, refuses every caller as its first statement (nothing in
-- its declarations runs anything), and loses every grant, so Postgres refuses it before the body for
-- every API role. Invoices it issued before stay as they are.
create or replace function app.rep_deliver(
  p_client_id uuid, p_order_id uuid, p_received_by_name text, p_lat numeric, p_lng numeric,
  p_lines jsonb default null, p_mock_location boolean default false, p_delivered_at_client timestamptz default null)
returns public.invoice
language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = '42501',
    message = 'a rep''s delivery is a submission the office approves: use app.rep_submit_delivery (D-32)';
end $$;

revoke execute on function app.rep_deliver(uuid, uuid, text, numeric, numeric, jsonb, boolean, timestamptz)
  from public, anon, authenticated, service_role;
