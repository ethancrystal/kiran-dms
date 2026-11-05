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
