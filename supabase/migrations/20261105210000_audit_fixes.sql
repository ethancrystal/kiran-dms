-- =============================================================================
-- Kiran DMS · migration 20261105210000 · Fixes from the backend-to-screen wiring audit (P1-30)
-- Decisions: D-45 to D-48 (MJ in chat, 2026-11-05; decision file 2026-11-05-mj-audit-decisions).
-- Requirements: CTL-03, CTL-07, CTL-08, CTL-17, PAY-05, PAY-10, INV-03, ORD-02, SEC-11, SEC-13, SEC-16,
--               RPT-01 (thin), H-06, H-08, H-10, H-12, H-13, H-17.
--
-- What changes, by audit finding:
--   AUTH-01  app.owner_create_user refuses a login that holds a salon membership (not revoked).
--   AUTH-05  a login that redeemed a rep invitation acts as a rep only with an emailed-code session, as a
--            salon already must (app.salon_me): app.rep_session_ok in app.rep_device_ok,
--            app.register_device and app.my_session. A password token minted before the redemption
--            reads nothing and writes nothing.
--   H7       app.office_override_stage: a manager moving a salon out of stage blocked is held to the
--            CTL-08 monthly cap, and every move into or out of blocked writes its credit_event.
--   H2       app.office_adjustment_checker says which checker an adjustment needs (the rule
--            app.post_adjustment applies when it is used: the owner above approval.stock_adjustment.
--            owner_above), so the office pages ask the right checker when they raise the request and a
--            missing-goods request is no longer approved by someone whose approval cannot be posted.
--            app.request_approval and app.post_adjustment are unchanged (the posting check stays the gate).
--   D-45     the owner's own stock adjustment posts at once, with a reason, through the new append-only
--            public.owner_stock_adjustment (app.owner_adjust_stock for a warehouse or bag;
--            app.office_resolve_pending for goods the owner settles as missing). The owner's own
--            discount takes effect whatever the order's source (app.build_order). Maker-checker between
--            two different people is unchanged for everyone else (H-12 stays a constraint).
--   M8 and the second reader's dead ends: app.office_pending_stock returns the request's quantity and
--            the newest refused request with its reason; app.office_refused_approvals lists the requests
--            refused in the last 14 days with the checker's reason.
--   D-48     payment reversal (PAY-10): public.payment_reversal (append-only), app.office_reverse_payment,
--            app.office_salon_payments. A reversed payment's allocations stop counting everywhere a
--            balance is derived (installment state, allocation guard, ageing, receipt and invoice
--            documents, the salon portal), and its cash leaves the holder that has it.
--   H4       app.salon_exposure is what is still owed on installment invoices plus the undelivered
--            value of open installment orders, so paying lowers it (replaces A-10's interim rule).
--   D-47     the intraday cash cap (CTL-17) in app.rep_record_payment; app.office_cash_cap_reps lists
--            reps at or over the cap for the office home.
--   D-46     public.handover_settlement (append-only): app.owner_settle_handover (owner only, a
--            disputed handover) and app.office_withdraw_handover (owner or manager, an unanswered one,
--            nothing moves). A settled or withdrawn handover no longer blocks the next count.
--   FLOW-09, FLOW-10  the rep month reads value what was delivered (invoices) and what is still to
--            deliver (undelivered value), and count the orders a rep placed beside the orders assigned
--            to it; the office home's waiting rows carry the undelivered value; the home counts reps at
--            the cash cap and handovers waiting for an answer or the owner.
--   Part 2 (screens; reads only, at the end of this file):
--   REP-03, FLOW-06  app.my_territory_orders lists the rep's own open assigned orders first and says
--            why an order is held or cancelled (FLOW-18); app.my_territory_order reads one order by id
--            for the delivery page, so an assigned order never drops out of reach behind 50 newer ones.
--   REP-10   app.my_salon returns the office's reason for a rejected proposal; app.my_salons returns
--            the approval state, so the list can show it.
--   REP-09   app.my_collections: the rep's own recent payments with their receipt numbers.
--   AUTH-10  app.salon_my_orders says, in a fixed word, what an order on hold waits for (no credit
--            figure, no reason typed by the office).
--   AUTH-09  app.salon_login_status: the status of this login's own salon account, so a suspended or
--            closed account is told so instead of "no account".
-- Errors: 42501 wrong role or session; 22023 bad input or an unknown reference; 23505 a client_id used
-- for something else; 23514 a business limit; 55000 the wrong state.
-- =============================================================================

-- =============================================================================
-- AUTH-01: a salon's login is never turned into staff
-- =============================================================================
create or replace function app.owner_create_user(
  p_user_id uuid, p_full_name text, p_role public.app_role, p_phone text default null,
  p_start_date date default null) returns public.user_profile
language plpgsql security definer set search_path = '' as $$
declare v public.user_profile;
begin
  perform app.assert_owner();
  if exists (select 1 from public.user_profile where id = p_user_id) then
    select * into v from public.user_profile where id = p_user_id;
    if v.role = p_role and v.full_name = p_full_name then
      return v;                                      -- idempotent replay
    end if;
    raise exception using errcode = '23505', message = 'profile already exists for this user';
  end if;
  -- AUTH-01: a login tied to a salon (doc 06 section 2.1) is the salon's, not a person to employ.
  if exists (select 1 from public.salon_membership m where m.user_id = p_user_id and m.status <> 'revoked') then
    raise exception using errcode = '22023',
      message = 'this sign-in belongs to a salon account; a salon login cannot be made a rep, manager or owner';
  end if;
  perform app.set_purpose('create user');
  insert into public.user_profile (id, full_name, role, phone, start_date, vault_grant, created_by)
  values (p_user_id, p_full_name, p_role, p_phone, p_start_date,
          p_role in ('owner', 'manager'),           -- VLT-06: default on for O/Mg, revocable
          auth.uid())
  returning * into v;
  return v;
end $$;

-- =============================================================================
-- AUTH-05: an invited rep acts only with an emailed-code session
-- =============================================================================
-- Internal (no grant). False only for a login that redeemed a rep invitation and whose session did not
-- prove the mailbox (amr has no otp or magiclink): the password squatter of the invitation migration.
-- Reps the owner created without an invitation are unaffected.
create function app.rep_session_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.session_proved_email()
      or not exists (select 1 from public.invitation i
                     where i.redeemed_by = auth.uid() and i.kind = 'rep' and i.status = 'redeemed')
$$;
create index invitation_redeemed_by_idx on public.invitation (redeemed_by) where redeemed_by is not null;

create or replace function app.rep_device_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when app.user_role() is distinct from 'rep' then true
    else app.rep_session_ok() and exists (
      select 1 from public.device d
      where d.user_id = auth.uid() and d.status = 'approved'
        and d.device_fingerprint = app.fingerprint_hash(app.request_device_id()))
  end
$$;

create or replace function app.register_device(p_fingerprint text, p_platform text default null, p_label text default null)
returns public.device
language plpgsql security definer set search_path = '' as $$
declare
  v      public.device;
  v_hash text;
begin
  if app.user_role() is null then perform app.raise_denied('no active user profile for this session'); end if;
  if app.user_role() = 'rep' and not app.rep_session_ok() then
    perform app.raise_denied('sign in with the code emailed to you to use this account');
  end if;
  if length(coalesce(p_fingerprint, '')) not between 16 and 200 then
    raise exception using errcode = '22023', message = 'device id must be 16 to 200 characters';
  end if;
  v_hash := app.fingerprint_hash(p_fingerprint);
  select * into v from public.device where user_id = auth.uid() and device_fingerprint = v_hash for update;
  if v.id is not null and v.status = 'revoked' then
    perform app.raise_denied('device id revoked; generate a new one');
  end if;
  if v.id is not null then
    update public.device set last_seen_at = now() where id = v.id returning * into v;
    return v;
  end if;
  insert into public.device (user_id, device_fingerprint, platform, label, last_seen_at)
  values (auth.uid(), v_hash, p_platform, p_label, now())
  returning * into v;
  return v;
end $$;

create or replace function app.my_session() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', p.id,
    'full_name', p.full_name,
    'role', p.role,
    'status', p.status,
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'device_status', (
      select d.status from public.device d
      where d.user_id = p.id and d.device_fingerprint = app.fingerprint_hash(app.request_device_id())))
  from public.user_profile p
  where p.id = auth.uid() and (p.role <> 'rep' or app.rep_session_ok())
$$;

-- =============================================================================
-- H7: the stage unblock is a CTL-08 override with its credit event
-- =============================================================================
create or replace function app.office_override_stage(p_salon_id uuid, p_to public.salon_stage, p_reason text)
returns public.salon
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_office();
  v_from public.salon_stage;
  c      public.salon_credit;
  v      public.salon;
begin
  perform app.assert_reason(p_reason);
  select s.stage into v_from from public.salon s where s.id = p_salon_id for update;
  if not found then raise exception using errcode = '22023', message = 'unknown salon'; end if;
  -- credit_of reads stage blocked as blocked, so leaving it is an unblock (doc 06, doc 09 section 2).
  if v_from = 'blocked' and p_to is distinct from 'blocked' and v_role = 'manager' then
    perform app.assert_manager_override_allowed(p_salon_id);
  end if;
  perform app.set_purpose('stage override: ' || p_reason);
  v := app.move_stage(p_salon_id, p_to, 'manual', p_reason);
  if v_from is distinct from p_to and (v_from = 'blocked' or p_to = 'blocked') then
    select * into c from public.salon_credit x where x.salon_id = p_salon_id;
    insert into public.credit_event (salon_id, kind, old_plan, new_plan, old_limit_paisa, new_limit_paisa, old_blocked,
                                     new_blocked, reason, actor_id, actor_role)
    values (p_salon_id, case when p_to = 'blocked' then 'block' else 'unblock' end::public.credit_event_kind,
            c.plan_eligibility, coalesce(c.plan_eligibility, 'CASH'), c.credit_limit_paisa, coalesce(c.credit_limit_paisa, 0),
            coalesce(c.blocked, false) or v_from = 'blocked', coalesce(c.blocked, false) or p_to = 'blocked',
            left(btrim(p_reason), 300), auth.uid(), v_role);
  end if;
  return v;
end $$;

-- =============================================================================
-- H2: an adjustment request goes to the checker who can approve it
-- =============================================================================
-- Internal (no grant). doc 13 section 9: the owner decides a stock adjustment above the threshold (units
-- or value at list price). A missing or malformed threshold, or an unknown SKU, routes to the owner.
create function app.adjustment_needs_owner(p_sku_id uuid, p_delta bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when jsonb_typeof(c.value -> 'units') = 'number' and jsonb_typeof(c.value -> 'paisa') = 'number'
                     and k.list_price_paisa is not null
                then abs(p_delta) > (c.value ->> 'units')::numeric
                  or abs(p_delta) * k.list_price_paisa > (c.value ->> 'paisa')::numeric
                else true end
    from public.sku k
    left join public.app_config c on c.key = 'approval.stock_adjustment.owner_above'
    where k.id = p_sku_id), true)
$$;

-- H2: which checker an adjustment of this SKU and quantity needs, for the office pages to ask when they
-- raise the request (Stock: opening stock; Delivery approvals: goods missing). Owner or manager at AAL2.
-- app.post_adjustment applies the same rule when the approval is used, so it stays the gate.
create function app.office_adjustment_checker(p_sku_id uuid, p_qty_delta integer)
returns public.app_role
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  if p_qty_delta is null or p_qty_delta = 0 then
    raise exception using errcode = '22023', message = 'an adjustment is a quantity up or down';
  end if;
  return case when app.adjustment_needs_owner(p_sku_id, p_qty_delta) then 'owner' else 'manager' end::public.app_role;
end $$;

-- =============================================================================
-- D-45: the owner's own stock adjustment takes effect at once
-- =============================================================================
create table public.owner_stock_adjustment (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null unique,                                     -- idempotency key (H-08)
  location_id   uuid not null references public.stock_location (id),
  sku_id        uuid not null references public.sku (id),
  qty_delta     integer not null check (qty_delta <> 0 and qty_delta between -100000 and 100000),
  reason        text not null check (length(btrim(reason)) between 5 and 300),
  submission_id uuid references public.delivery_submission (id),         -- goods of a rejected delivery settled as missing
  owner_id      uuid not null references public.user_profile (id),
  created_at    timestamptz not null default now()
);
create index owner_stock_adjustment_location_idx on public.owner_stock_adjustment (location_id, created_at);
comment on table public.owner_stock_adjustment is
  'D-45. Append-only. The owner''s own stock adjustment, effective at once with a reason; its movement points here (source_type owner_stock_adjustment) instead of to an approval.';

-- Only the owner, as itself, ever writes a row, whatever function inserts it.
create function control.owner_stock_adjustment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if app.user_role() is distinct from 'owner' or new.owner_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'only the owner records an own stock adjustment (D-45)';
  end if;
  return new;
end $$;
create trigger owner_stock_adjustment_guard before insert on public.owner_stock_adjustment
  for each row execute function control.owner_stock_adjustment_guard();
create trigger append_only before update or delete on public.owner_stock_adjustment for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.owner_stock_adjustment         for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on public.owner_stock_adjustment for each row execute function control.audit_row();

alter table public.owner_stock_adjustment enable row level security;
alter table public.owner_stock_adjustment force  row level security;
create policy owner_stock_adjustment_select on public.owner_stock_adjustment for select to authenticated
  using ((select app.is_office()));
revoke all on public.owner_stock_adjustment from public, anon, authenticated, service_role;
grant select on public.owner_stock_adjustment to authenticated, service_role;

-- An adjustment movement is authorised by an approval, or by the owner's own adjustment row.
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
      when 'adjustment'          then (from_location_id is null) <> (to_location_id is null)
                                      and (approval_id is not null
                                           or (approval_id is null and source_type = 'owner_stock_adjustment' and source_id is not null))
      else true
    end);
-- The movement of an owner adjustment is its only one.
create unique index stock_movement_one_per_owner_adjustment on public.stock_movement (source_id)
  where source_type = 'owner_stock_adjustment';

-- A missing-goods settlement is authorised by an approval or by the owner's own adjustment, never both.
alter table public.pending_stock_resolution add column owner_adjustment_id uuid references public.owner_stock_adjustment (id);
alter table public.pending_stock_resolution drop constraint pending_stock_resolution_approval;
alter table public.pending_stock_resolution add constraint pending_stock_resolution_approval check (
  (outcome = 'missing') = (approval_id is not null or owner_adjustment_id is not null)
  and (approval_id is null or owner_adjustment_id is null));

-- Internal (no grant): the owner's adjustment and its movement, in one step. Idempotent on client_id.
create function app.owner_post_adjustment(
  p_client_id uuid, p_location_id uuid, p_sku_id uuid, p_qty_delta integer, p_reason text, p_submission_id uuid)
returns public.stock_movement
language plpgsql security definer set search_path = '' as $$
declare
  a        public.owner_stock_adjustment;
  m        public.stock_movement;
  v_reason text := btrim(p_reason);
begin
  perform app.assert_owner();
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'an adjustment needs a client_id (idempotency key, H-08)';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('owner-adjustment:' || p_client_id::text, 0));
  select * into a from public.owner_stock_adjustment x where x.client_id = p_client_id;
  if a.id is not null then
    if a.location_id = p_location_id and a.sku_id = p_sku_id and a.qty_delta = p_qty_delta
       and a.submission_id is not distinct from p_submission_id then
      select * into m from public.stock_movement x where x.source_type = 'owner_stock_adjustment' and x.source_id = a.id;
      return m;                                                                   -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if p_qty_delta is null or p_qty_delta = 0 or abs(p_qty_delta) > 100000 then
    raise exception using errcode = '22023', message = 'an adjustment is a quantity from 1 to 100000, up or down';
  end if;
  if v_reason is null or length(v_reason) not between 5 and 300 then
    raise exception using errcode = '22023', message = 'an adjustment needs a reason of 5 to 300 characters';
  end if;
  if not exists (select 1 from public.sku k where k.id = p_sku_id) then
    raise exception using errcode = '22023', message = 'unknown SKU';
  end if;
  if not exists (select 1 from public.stock_location l where l.id = p_location_id) then
    raise exception using errcode = '22023', message = 'unknown location';
  end if;
  perform app.set_purpose('owner stock adjustment (D-45): ' || v_reason);
  insert into public.owner_stock_adjustment (client_id, location_id, sku_id, qty_delta, reason, submission_id, owner_id)
  values (p_client_id, p_location_id, p_sku_id, p_qty_delta, v_reason, p_submission_id, auth.uid())
  returning * into a;
  insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind,
                                     source_type, source_id, reason, actor_id)
  values (gen_random_uuid(), p_sku_id, abs(p_qty_delta),
          case when p_qty_delta < 0 then p_location_id end,
          case when p_qty_delta > 0 then p_location_id end,
          'adjustment', 'owner_stock_adjustment', a.id, left(v_reason, 300), auth.uid())
  returning * into m;
  return m;
end $$;

-- D-45: the owner's adjustment of a warehouse or a rep's bag (opening stock, a count correction).
-- Goods in pending custody are settled through their delivery submission (app.office_resolve_pending).
create function app.owner_adjust_stock(
  p_client_id uuid, p_location_id uuid, p_sku_id uuid, p_qty_delta integer, p_reason text)
returns public.stock_movement
language plpgsql security definer set search_path = '' as $$
begin
  perform app.assert_owner();
  if exists (select 1 from public.stock_location l where l.id = p_location_id and l.kind = 'pending_delivery') then
    raise exception using errcode = '22023', message = 'pending stock is settled through its delivery submission';
  end if;
  return app.owner_post_adjustment(p_client_id, p_location_id, p_sku_id, p_qty_delta, p_reason, null);
end $$;

-- D-45: as migration 20261105130100's app.office_resolve_pending, except that the owner settles goods as
-- missing at once, without an approval (app.owner_post_adjustment), when no approval is given.
create or replace function app.office_resolve_pending(
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
  elsif p_approval_id is null and v_role = 'owner' then
    m := app.owner_post_adjustment(gen_random_uuid(), v_pend, p_sku_id, -p_qty, v_note, s.id);
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
  insert into public.pending_stock_resolution (id, client_id, submission_id, sku_id, qty, outcome, note, movement_id, approval_id,
                                             owner_adjustment_id, resolved_by)
  values (v_id, p_client_id, s.id, p_sku_id, p_qty, p_outcome, v_note, m.id,
          case when p_outcome = 'missing' and m.source_type is distinct from 'owner_stock_adjustment' then p_approval_id end,
          case when m.source_type = 'owner_stock_adjustment' then m.source_id end, auth.uid())
  returning * into r;
  return r;
end $$;

-- D-45 for discounts: the owner's own discount takes effect whatever the order's source.
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
  -- D-45 (MJ 2026-11-05, answers B-42 and audit M1): whatever the order's source (a salon's request or a
  -- rep's card the owner converts), the owner's own order takes its discount at once; the order row
  -- records it (discount_by_owner) and the audit trigger keeps the record.
  v_by_owner boolean := app.user_role() = 'owner';
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

-- =============================================================================
-- M8, H2 and the refused requests: what the office pages read
-- =============================================================================
drop function app.office_pending_stock();
-- What is waiting to be settled: per rejected submission and SKU, the unsettled quantity (oldest
-- decision first, up to 500), with the newest adjustment request for it that is pending, approved and
-- not yet used, or refused: its quantity (request_qty, a positive count of missing units), its required
-- checker and, when refused, the checker's reason. An approved request can be used only for at most the
-- unsettled quantity; the page offers a new request when it cannot.
create function app.office_pending_stock()
returns table (submission_id uuid, rep_id uuid, rep_name text, salon_name text, sku_id uuid, sku_code text, unsettled integer,
               pending_location_id uuid, reason text, decided_at timestamptz, request_id uuid,
               request_status public.approval_status, request_maker_id uuid, request_checker_role public.app_role,
               request_qty integer, request_decision_reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
  select q.submission_id, q.rep_id, q.rep_name, q.salon_name, q.sku_id, q.sku_code, q.unsettled, q.pending_location_id,
         q.reason, q.decided_at, req.id, req.status, req.maker_id, req.checker_role_required, req.qty, req.decision_reason
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
    select a.id, a.status, a.maker_id, a.checker_role_required, a.decision_reason,
           case when jsonb_typeof(a.payload -> 'qty_delta') = 'number' and (a.payload ->> 'qty_delta') ~ '^-?[0-9]{1,6}$'
                then -((a.payload ->> 'qty_delta')::integer) end qty
    from control.approval_request a
    where a.kind = 'adjustment' and a.subject_type = 'stock_location' and a.subject_id = q.pending_location_id
      and a.payload ->> 'submission_id' = q.submission_id::text and a.payload ->> 'sku_id' = q.sku_id::text
      and (a.status in ('pending', 'rejected')
           or (a.status = 'approved' and not exists (select 1 from public.stock_movement m where m.approval_id = a.id)))
    order by a.created_at desc, a.id
    limit 1) req on true
  where q.unsettled > 0
  order by q.decided_at, q.submission_id, q.sku_code
  limit 500;
end $$;

-- The second reader's finding: a refused request vanished from every page. The discount and adjustment
-- requests refused in the last 14 days, newest first (100), with the checker's name and reason, so the
-- maker sees the outcome. Owner or manager at AAL2. Allow-listed fields only, never the raw payload;
-- app.office_pending_approvals (the queue) is unchanged.
create function app.office_refused_approvals()
returns table (request_id uuid, kind public.approval_kind, made_by_me boolean, maker_name text, reason text,
               created_at timestamptz, salon_name text, location_name text, location_kind public.stock_location_kind,
               sku_code text, qty_delta bigint, decided_at timestamptz, checker_name text, decision_reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
  select a.id, a.kind, a.maker_id = auth.uid(), mk.full_name, a.reason, a.created_at, s.name, l.name, l.kind, k.code,
         case when a.kind = 'adjustment' and jsonb_typeof(a.payload -> 'qty_delta') = 'number'
                   and (a.payload ->> 'qty_delta') ~ '^-?[0-9]{1,6}$'
              then (a.payload ->> 'qty_delta')::bigint end,
         a.decided_at, ck.full_name, a.decision_reason
  from control.approval_request a
  join public.user_profile mk on mk.id = a.maker_id
  left join public.user_profile ck on ck.id = a.checker_id
  left join public.sales_order o on a.kind = 'discount' and a.subject_type = 'sales_order' and o.id = a.subject_id
  left join public.salon s on s.id = o.salon_id
  left join public.stock_location l on a.kind = 'adjustment' and a.subject_type = 'stock_location' and l.id = a.subject_id
  left join public.sku k on a.kind = 'adjustment'
                         and k.id = case when coalesce(a.payload ->> 'sku_id', '')
                                               ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                                         then (a.payload ->> 'sku_id')::uuid end
  where a.kind in ('discount', 'adjustment') and a.status = 'rejected' and a.decided_at > now() - interval '14 days'
  order by a.decided_at desc, a.id
  limit 100;
end $$;

-- =============================================================================
-- D-48: payment reversal
-- =============================================================================
create table public.payment_reversal (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null unique,                                  -- idempotency key (H-08)
  payment_id       uuid not null unique references public.payment (id),   -- a payment is reversed once
  reason           text not null check (length(btrim(reason)) between 5 and 300),
  cash_holder      text check (cash_holder in ('rep', 'office')),         -- whose cash ledger paid it back (cash only)
  reversed_by      uuid not null references public.user_profile (id),
  reversed_by_role public.app_role not null check (reversed_by_role in ('owner', 'manager')),
  reversed_at      timestamptz not null default clock_timestamp()
);
comment on table public.payment_reversal is
  'D-48, PAY-10. Append-only. The payment and its receipt stay; from here on its allocations no longer count as paid, and its cash leaves the holder.';

-- D-48 in the database: a manager never reverses a payment they recorded (the owner may).
create function control.payment_reversal_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.reversed_by_role = 'manager'
     and exists (select 1 from public.payment p where p.id = new.payment_id and p.recorded_by = new.reversed_by) then
    raise exception using errcode = '42501', message = 'a manager cannot reverse a payment they recorded; the owner can (D-48)';
  end if;
  return new;
end $$;
create trigger payment_reversal_guard before insert on public.payment_reversal
  for each row execute function control.payment_reversal_guard();
create trigger append_only before update or delete on public.payment_reversal for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.payment_reversal         for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on public.payment_reversal for each row execute function control.audit_row();

alter table public.payment_reversal enable row level security;
alter table public.payment_reversal force  row level security;
-- As payments: the office reads all; a rep reads the reversals of its own payments, on its approved phone.
create policy payment_reversal_select on public.payment_reversal for select to authenticated
  using ((select app.is_office()) or exists (
    select 1 from public.payment p where p.id = payment_id and p.recorded_by = (select auth.uid())
      and (select app.is_rep()) and (select app.self_ok())));
revoke all on public.payment_reversal from public, anon, authenticated, service_role;
grant select on public.payment_reversal to authenticated, service_role;

-- A reversed payment's allocations stop counting: the allocation guard lets a later payment settle the
-- installment again.
create or replace function control.allocation_guard() returns trigger
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
  if exists (select 1 from public.payment_reversal r where r.payment_id = new.payment_id) then
    raise exception using errcode = '23514', message = 'a reversed payment settles nothing';
  end if;
  select coalesce(sum(a.amount_paisa), 0) into v_paid from public.payment_allocation a
  where a.installment_id = new.installment_id
    and not exists (select 1 from public.payment_reversal r where r.payment_id = a.payment_id);
  if v_paid + new.amount_paisa > v_due then
    raise exception using errcode = '23514', message = 'an allocation would pay an installment more than it is owed';
  end if;
  select coalesce(sum(a.amount_paisa), 0) into v_used from public.payment_allocation a where a.payment_id = new.payment_id;
  if v_used + new.amount_paisa > v_amount then
    raise exception using errcode = '23514', message = 'allocations would exceed the payment';
  end if;
  return new;
end $$;

-- What each installment of a salon still owes, oldest due first (derived, H-10); reversed payments do not count.
create or replace function app.installment_state(p_salon_id uuid)
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
  left join lateral (select sum(x.amount_paisa) paid from public.payment_allocation x
                     where x.installment_id = i.id
                       and not exists (select 1 from public.payment_reversal r where r.payment_id = x.payment_id)) a on true
  where i.salon_id = p_salon_id
  order by i.due_on, v.issued_at, v.number, i.seq, i.id
$$;

-- D-48: as migration 0022's app.office_receivables_ageing; a reversed payment no longer counts as paid.
create or replace function app.office_receivables_ageing(p_group text)
returns table (group_id uuid, group_name text, salons integer, current_paisa bigint, d1_7_paisa bigint,
               d8_15_paisa bigint, d16_30_paisa bigint, d31_plus_paisa bigint, overdue_paisa bigint,
               total_paisa bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := app.karachi_today();
begin
  perform app.assert_office();
  if p_group is null or p_group not in ('salon', 'territory', 'rep') then
    raise exception using errcode = '22023', message = 'group must be salon, territory or rep';
  end if;

  return query
  with owed as (
    select i.salon_id, (i.amount_due_paisa - coalesce(a.paid, 0))::bigint as remaining, v_today - i.due_on as late
    from public.installment i
    left join lateral (select sum(x.amount_paisa) as paid from public.payment_allocation x where x.installment_id = i.id
                         and not exists (select 1 from public.payment_reversal pr where pr.payment_id = x.payment_id)) a on true
    where i.amount_due_paisa - coalesce(a.paid, 0) > 0
  ),
  per_salon as (
    select o.salon_id,
           coalesce(sum(o.remaining) filter (where o.late <= 0), 0)::bigint as cur,
           coalesce(sum(o.remaining) filter (where o.late between 1 and 7), 0)::bigint as d1,
           coalesce(sum(o.remaining) filter (where o.late between 8 and 15), 0)::bigint as d8,
           coalesce(sum(o.remaining) filter (where o.late between 16 and 30), 0)::bigint as d16,
           coalesce(sum(o.remaining) filter (where o.late > 30), 0)::bigint as d31
    from owed o
    group by o.salon_id
  ),
  keyed as (
    select ps.*, s.id as k, s.name as label
    from per_salon ps join public.salon s on s.id = ps.salon_id
    where p_group = 'salon'
    union all
    select ps.*, t.id, t.name
    from per_salon ps
    join public.salon s on s.id = ps.salon_id
    join public.area ar on ar.id = s.area_id
    join public.territory t on t.id = ar.territory_id
    where p_group = 'territory'
    union all
    select ps.*, rt.rep_id, u.full_name
    from per_salon ps
    join public.salon s on s.id = ps.salon_id
    join public.area ar on ar.id = s.area_id
    left join public.rep_territory rt on rt.territory_id = ar.territory_id and rt.to_date is null
    left join public.user_profile u on u.id = rt.rep_id
    where p_group = 'rep'
  )
  select kd.k, min(kd.label), count(distinct kd.salon_id)::integer,
         sum(kd.cur)::bigint, sum(kd.d1)::bigint, sum(kd.d8)::bigint, sum(kd.d16)::bigint, sum(kd.d31)::bigint,
         sum(kd.d1 + kd.d8 + kd.d16 + kd.d31)::bigint,
         sum(kd.cur + kd.d1 + kd.d8 + kd.d16 + kd.d31)::bigint
  from keyed kd
  group by kd.k
  order by sum(kd.d1 + kd.d8 + kd.d16 + kd.d31) desc, sum(kd.cur + kd.d1 + kd.d8 + kd.d16 + kd.d31) desc, min(kd.label), kd.k;
end $$;

-- D-48: as migration 0021's app.receipt_document, plus the reversal (when, and why) when there is one; the remaining schedule
-- is still as of this receipt, so a payment reversed before it was issued no longer counts there.
create or replace function app.receipt_document(p_receipt_id uuid) returns jsonb
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
        where a.installment_id = i.id and q.seq <= p.seq
          and not exists (select 1 from public.payment_reversal pr where pr.payment_id = q.id and pr.reversed_at <= r.issued_at)) paid
      where i.salon_id = p.salon_id and v.issued_at <= r.issued_at and i.amount_due_paisa - paid.n > 0), '[]'::jsonb),
    'notices', jsonb_build_array(
      jsonb_build_object('code', 'only_valid_proof',
        'en', 'This numbered receipt is your only valid proof of payment. A paper receipt is not valid.',
        'ur', 'یہ نمبر والی رسید آپ کی ادائیگی کا واحد درست ثبوت ہے۔ کاغذی رسید درست نہیں۔')))
    -- D-48: a reversed receipt says so, when and why; the key is absent otherwise.
    || coalesce((select jsonb_build_object('reversed', jsonb_build_object('reversed_at', pr.reversed_at, 'reason', pr.reason))
                 from public.payment_reversal pr where pr.payment_id = p.id), '{}'::jsonb);
end $$;

-- D-48: as migration 20261104090000's app.invoice_document; a reversed receipt carries "reversed": true (absent otherwise).
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
  if not (app.is_office() or coalesce(app.user_role() = 'rep' and i.rep_id = auth.uid() and app.self_ok(), false)) then
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
      select jsonb_agg(jsonb_build_object('number', r.number, 'issued_at', r.issued_at, 'amount_paisa', t.amt,
                                         'reversed', exists (select 1 from public.payment_reversal pr where pr.payment_id = t.payment_id))
                       - case when exists (select 1 from public.payment_reversal pr where pr.payment_id = t.payment_id)
                              then '' else 'reversed' end
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

-- D-48: as migration 20261105150000's app.salon_my_account; a reversed payment carries "reversed": true (the
-- key is absent otherwise, so an unreversed payment reads as before).
create or replace function app.salon_my_account() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_salon uuid := app.assert_salon_member();
  v_bal   jsonb;
begin
  select jsonb_build_object(
           'invoiced_paisa', coalesce(sum(x.amount_due_paisa), 0)::bigint,
           'paid_paisa', coalesce(sum(x.paid_paisa), 0)::bigint,
           'balance_paisa', coalesce(sum(x.remaining_paisa), 0)::bigint,
           'overdue_paisa', coalesce(sum(x.remaining_paisa) filter (where x.status = 'overdue'), 0)::bigint,
           'next_due_on', min(x.due_on) filter (where x.remaining_paisa > 0))
    into v_bal
  from app.installment_state(v_salon) x;
  return jsonb_build_object(
    'balance', v_bal,
    'installments', coalesce((
      select jsonb_agg(jsonb_build_object('invoice_number', x.invoice_number, 'seq', x.seq, 'of_count', x.of_count,
                                          'due_on', x.due_on, 'amount_due_paisa', x.amount_due_paisa,
                                          'paid_paisa', x.paid_paisa, 'remaining_paisa', x.remaining_paisa,
                                          'status', x.status)
                       order by x.due_on, x.issued_at, x.invoice_number, x.seq)
      from (select * from app.installment_state(v_salon) y where y.remaining_paisa > 0
            order by y.due_on, y.issued_at, y.invoice_number, y.seq limit 50) x), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('receipt_number', t.number, 'paid_at', t.recorded_at, 'method', t.method,
                                          'amount_paisa', t.amount_paisa)
                       || case when t.reversed then jsonb_build_object('reversed', true) else '{}'::jsonb end
                       order by t.recorded_at desc, t.seq desc)
      from (select r.number, p.recorded_at, p.method, p.amount_paisa, p.seq,
                   exists (select 1 from public.payment_reversal pr where pr.payment_id = p.id) reversed
            from public.payment p join public.receipt r on r.payment_id = p.id
            where p.salon_id = v_salon
            order by p.recorded_at desc, p.seq desc limit 50) t), '[]'::jsonb));
end $$;

-- D-48: the owner or the manager reverses a payment, with a reason. Idempotent on client_id. The cash of
-- a cash payment leaves the ledger that holds it: the office's for cash the office collected; for a rep's
-- collection, the rep's while the rep still holds it, the office's once a final handover (acknowledged or
-- settled) was counted after the payment or when the rep's ledger no longer covers it.
create function app.office_reverse_payment(p_client_id uuid, p_payment_id uuid, p_reason text)
returns public.payment_reversal
language plpgsql security definer set search_path = '' as $$
declare
  v_role   public.app_role := app.assert_office();
  v_reason text := btrim(p_reason);
  p        public.payment;
  x        public.payment_reversal;
  v_holder text;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a reversal needs a client_id (idempotency key, H-08)';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('payment-reversal-client:' || p_client_id::text, 0));
  select * into x from public.payment_reversal r where r.client_id = p_client_id;
  if x.id is not null then
    if x.payment_id = p_payment_id and x.reversed_by = auth.uid() then return x; end if;   -- replay
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if v_reason is null or length(v_reason) not between 5 and 300 then
    raise exception using errcode = '22023', message = 'a reversal needs a reason of 5 to 300 characters';
  end if;
  select * into p from public.payment q where q.id = p_payment_id;
  if p.id is null then raise exception using errcode = '22023', message = 'unknown payment'; end if;
  if v_role = 'manager' and p.recorded_by = auth.uid() then
    perform app.raise_denied('a manager cannot reverse a payment they recorded; the owner can (D-48)');
  end if;
  -- Lock order as app.rep_record_payment and the handover functions: the rep first, then the salon.
  if p.method = 'cash' and p.recorded_by_role = 'rep' then
    perform pg_advisory_xact_lock(hashtextextended('handover-rep:' || p.recorded_by::text, 0));
  end if;
  perform pg_advisory_xact_lock(hashtextextended('payment:' || p.salon_id::text, 0));
  if exists (select 1 from public.payment_reversal r where r.payment_id = p.id) then
    raise exception using errcode = '55000', message = 'this payment is already reversed';
  end if;
  if p.method = 'cash' then
    v_holder := 'office';
    if p.recorded_by_role = 'rep'
       and not exists (select 1 from public.handover h
                       left join public.handover_response r on r.handover_id = h.id
                       left join public.handover_settlement st on st.handover_id = h.id
                       where h.rep_id = p.recorded_by and h.counted_at > p.recorded_at
                         and (r.kind = 'ack' or st.outcome in ('counted', 'rep')))
       and app.rep_cash_balance(p.recorded_by) >= p.amount_paisa then
      v_holder := 'rep';
    end if;
  end if;
  perform app.set_purpose('payment reversed (D-48): ' || v_reason);
  insert into public.payment_reversal (client_id, payment_id, reason, cash_holder, reversed_by, reversed_by_role)
  values (p_client_id, p.id, v_reason, v_holder, auth.uid(), v_role)
  returning * into x;
  if v_holder is not null then
    insert into public.cash_ledger_entry (holder_type, holder_id, direction, amount_paisa, source_type, source_id)
    values (v_holder, case when v_holder = 'rep' then p.recorded_by end, 'out', p.amount_paisa, 'payment', p.id);
  end if;
  return x;
end $$;

-- FLOW-13, D-48: a salon's payments for the office, newest first (100): receipt, method, who recorded it,
-- the CTL-02 flags, and the reversal if any; may_reverse says whether the caller may reverse it.
create function app.office_salon_payments(p_salon_id uuid)
returns table (payment_id uuid, receipt_id uuid, receipt_number text, recorded_at timestamptz, method public.pay_method,
               amount_paisa bigint, bank_name text, bank_reference text, recorded_by_name text,
               recorded_by_role public.app_role, flags jsonb, distance_from_pin_m integer, reversed_at timestamptz,
               reversal_reason text, reversed_by_name text, may_reverse boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.app_role := app.assert_office();
begin
  if not exists (select 1 from public.salon s where s.id = p_salon_id) then
    raise exception using errcode = '22023', message = 'unknown salon';
  end if;
  return query
  select p.id, r.id, r.number, p.recorded_at, p.method, p.amount_paisa, p.bank_name, p.bank_reference, u.full_name,
         p.recorded_by_role, p.flags, p.distance_from_pin_m, x.reversed_at, x.reason, xu.full_name,
         x.id is null and (v_role = 'owner' or p.recorded_by <> auth.uid())
  from public.payment p
  join public.receipt r on r.payment_id = p.id
  join public.user_profile u on u.id = p.recorded_by
  left join public.payment_reversal x on x.payment_id = p.id
  left join public.user_profile xu on xu.id = x.reversed_by
  where p.salon_id = p_salon_id
  order by p.recorded_at desc, p.seq desc
  limit 100;
end $$;

-- =============================================================================
-- H4, FLOW-03: credit exposure falls as a salon pays
-- =============================================================================
-- Internal (no grant). What of an order is not delivered yet, at its own unit prices.
create function app.order_undelivered_paisa(p_order_id uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum((l.qty - coalesce(d.n, 0))::bigint * l.unit_price_paisa), 0)::bigint
  from public.sales_order_line l
  left join lateral (select sum(x.qty) n from public.delivery_line x where x.order_line_id = l.id) d on true
  where l.order_id = p_order_id
$$;

-- Replaces A-10's interim rule: what the salon still owes on its installment invoices (payments and
-- reversals counted, H-10) plus the undelivered value of its confirmed or part-delivered installment
-- orders. Cash orders and cash invoices never count (MJ L-0163).
create or replace function app.salon_exposure(p_salon_id uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select (
    coalesce((select sum(x.remaining_paisa) from app.installment_state(p_salon_id) x
              join public.invoice v on v.id = x.invoice_id
              where v.plan <> 'CASH'), 0)
    + coalesce((select sum(app.order_undelivered_paisa(o.id)) from public.sales_order o
                where o.salon_id = p_salon_id and o.plan <> 'CASH'
                  and o.status in ('confirmed', 'partially_delivered')), 0))::bigint
$$;

-- =============================================================================
-- D-47: the intraday cash cap (CTL-17)
-- =============================================================================
create or replace function app.rep_record_payment(
  p_client_id uuid, p_salon_id uuid, p_method public.pay_method, p_amount_paisa bigint, p_lat numeric, p_lng numeric,
  p_bank_name text default null, p_bank_reference text default null, p_mock_location boolean default false,
  p_recorded_at_client timestamptz default null)
returns public.receipt
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  v_day  uuid;
  v_cap  numeric;
  v_held bigint;
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
  if p_method = 'cash' then
    -- D-47, CTL-17: the rep's cash in hand after this collection stays within the cap. One collection at a
    -- time per rep (the same lock as the handover), so two salons cannot both pass it. Fails closed.
    v_cap := app.config_number('cash.intraday_cap_paisa');
    if v_cap is null or v_cap < 0 then
      perform app.raise_denied('the cash cap (cash.intraday_cap_paisa) is not configured; ask the owner');
    end if;
    perform pg_advisory_xact_lock(hashtextextended('handover-rep:' || auth.uid()::text, 0));
    if exists (select 1 from public.payment x where x.client_id = p_client_id) then
      return app.record_payment(p_client_id, p_salon_id, p_method, p_amount_paisa, p_bank_name, p_bank_reference,
                                p_lat, p_lng, p_mock_location, p_recorded_at_client, null);
    end if;
    v_held := app.rep_cash_balance(auth.uid());
    if p_amount_paisa is not null and v_held + p_amount_paisa > v_cap then
      raise exception using errcode = '23514',
        message = format('cash limit reached: you hold Rs %s and the limit is Rs %s; hand over cash at the office before collecting more (CTL-17)',
                         to_char(v_held / 100.0, 'FM999,999,990.00'), to_char(v_cap / 100.0, 'FM999,999,990.00'));
    end if;
  end if;
  return app.record_payment(p_client_id, p_salon_id, p_method, p_amount_paisa, p_bank_name, p_bank_reference,
                            p_lat, p_lng, p_mock_location, p_recorded_at_client, v_day);
end $$;

-- D-47: reps whose cash in hand is at or over the cap, for the office home (owner or manager).
create function app.office_cash_cap_reps()
returns table (rep_id uuid, full_name text, cash_paisa bigint, cap_paisa bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_cap numeric;
begin
  perform app.assert_office();
  v_cap := app.config_number('cash.intraday_cap_paisa');
  return query
  select u.id, u.full_name, app.rep_cash_balance(u.id), v_cap::bigint
  from public.user_profile u
  where u.role = 'rep' and v_cap is not null and app.rep_cash_balance(u.id) >= v_cap
  order by app.rep_cash_balance(u.id) desc, u.full_name, u.id
  limit 100;
end $$;

-- =============================================================================
-- D-46: settling a disputed handover; withdrawing an unanswered one
-- =============================================================================
create table public.handover_settlement (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null unique,                                     -- idempotency key (H-08)
  handover_id     uuid not null unique references public.handover (id),    -- one settlement per handover
  outcome         text not null check (outcome in ('counted', 'rep', 'withdrawn')),
  reason          text not null check (length(btrim(reason)) between 5 and 300),
  settled_by      uuid not null references public.user_profile (id),
  settled_by_role public.app_role not null check (settled_by_role in ('owner', 'manager')),
  settled_at      timestamptz not null default now(),
  -- D-46: only the owner settles a dispute; the office may withdraw a count the rep never answered.
  constraint handover_settlement_who check (outcome = 'withdrawn' or settled_by_role = 'owner')
);
comment on table public.handover_settlement is
  'D-46. Append-only. counted: the owner accepts the counted amount, the difference stays recorded against the rep; rep: the owner accepts the rep''s amount, the difference is an office difference; withdrawn: an unanswered count withdrawn, nothing moved.';

create trigger append_only before update or delete on public.handover_settlement for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.handover_settlement         for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on public.handover_settlement for each row execute function control.audit_row();

alter table public.handover_settlement enable row level security;
alter table public.handover_settlement force  row level security;
create policy handover_settlement_select on public.handover_settlement for select to authenticated
  using ((select app.is_office()) or exists (
    select 1 from public.handover h where h.id = handover_id and h.rep_id = (select auth.uid())
      and (select app.is_rep()) and (select app.self_ok())));
revoke all on public.handover_settlement from public, anon, authenticated, service_role;
grant select on public.handover_settlement to authenticated, service_role;

-- D-46: the owner settles a disputed handover. Both outcomes move the cash as an acknowledgment does
-- (A-15: the rep's ledger out by the expected amount, the office's in by the counted amount); the outcome
-- records whose the difference is: counted, the rep's (as on an acknowledged handover); rep, the
-- office's. Idempotent on client_id; serialised with the rep's answer and the next count.
create function app.owner_settle_handover(p_client_id uuid, p_handover_id uuid, p_outcome text, p_reason text)
returns public.handover_settlement
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := btrim(p_reason);
  h        public.handover;
  r        public.handover_response;
  x        public.handover_settlement;
begin
  perform app.assert_owner();
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a settlement needs a client_id (idempotency key, H-08)';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('handover-client:' || p_client_id::text, 0));
  select * into x from public.handover_settlement s where s.client_id = p_client_id;
  if x.id is not null then
    if x.handover_id = p_handover_id and x.outcome = p_outcome and x.settled_by = auth.uid() then return x; end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if p_outcome is null or p_outcome not in ('counted', 'rep') then
    raise exception using errcode = '22023', message = 'choose counted (the counted amount) or rep (the rep''s amount)';
  end if;
  if v_reason is null or length(v_reason) not between 5 and 300 then
    raise exception using errcode = '22023', message = 'a settlement needs a reason of 5 to 300 characters';
  end if;
  select * into h from public.handover x2 where x2.id = p_handover_id;
  if h.id is null then raise exception using errcode = '22023', message = 'unknown handover'; end if;
  perform pg_advisory_xact_lock(hashtextextended('handover-rep:' || h.rep_id::text, 0));
  if exists (select 1 from public.handover_settlement s where s.handover_id = h.id) then
    raise exception using errcode = '55000', message = 'this handover is already settled';
  end if;
  select * into r from public.handover_response y where y.handover_id = h.id;
  if r.id is null or r.kind <> 'dispute' then
    raise exception using errcode = '55000', message = 'only a disputed handover is settled; this one is not under dispute';
  end if;
  perform app.set_purpose('handover settled by the owner (D-46): ' || p_outcome || ': ' || v_reason);
  insert into public.handover_settlement (client_id, handover_id, outcome, reason, settled_by, settled_by_role)
  values (p_client_id, h.id, p_outcome, v_reason, auth.uid(), 'owner')
  returning * into x;
  if h.expected_paisa > 0 then
    insert into public.cash_ledger_entry (holder_type, holder_id, direction, amount_paisa, source_type, source_id)
    values ('rep', h.rep_id, 'out', h.expected_paisa, 'handover', h.id);
  end if;
  if h.counted_paisa > 0 then
    insert into public.cash_ledger_entry (holder_type, holder_id, direction, amount_paisa, source_type, source_id)
    values ('office', null, 'in', h.counted_paisa, 'handover', h.id);
  end if;
  return x;
end $$;

-- The second reader's case: a count the rep never answers (a lost phone, a rep who does not respond)
-- blocked every later count. The owner or the manager withdraws it with a reason; no cash moved, so
-- none moves now, and the rep can no longer answer it. Idempotent on client_id.
create function app.office_withdraw_handover(p_client_id uuid, p_handover_id uuid, p_reason text)
returns public.handover_settlement
language plpgsql security definer set search_path = '' as $$
declare
  v_role   public.app_role := app.assert_office();
  v_reason text := btrim(p_reason);
  h        public.handover;
  x        public.handover_settlement;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a withdrawal needs a client_id (idempotency key, H-08)';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('handover-client:' || p_client_id::text, 0));
  select * into x from public.handover_settlement s where s.client_id = p_client_id;
  if x.id is not null then
    if x.handover_id = p_handover_id and x.outcome = 'withdrawn' and x.settled_by = auth.uid() then return x; end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if v_reason is null or length(v_reason) not between 5 and 300 then
    raise exception using errcode = '22023', message = 'a withdrawal needs a reason of 5 to 300 characters';
  end if;
  select * into h from public.handover x2 where x2.id = p_handover_id;
  if h.id is null then raise exception using errcode = '22023', message = 'unknown handover'; end if;
  perform pg_advisory_xact_lock(hashtextextended('handover-rep:' || h.rep_id::text, 0));
  if exists (select 1 from public.handover_settlement s where s.handover_id = h.id) then
    raise exception using errcode = '55000', message = 'this handover is already settled or withdrawn';
  end if;
  if exists (select 1 from public.handover_response y where y.handover_id = h.id) then
    raise exception using errcode = '55000', message = 'the rep has answered this handover; only an unanswered one is withdrawn';
  end if;
  perform app.set_purpose('handover withdrawn: ' || v_reason);
  insert into public.handover_settlement (client_id, handover_id, outcome, reason, settled_by, settled_by_role)
  values (p_client_id, h.id, 'withdrawn', v_reason, auth.uid(), v_role)
  returning * into x;
  return x;
end $$;

-- D-46: as migration 0023's app.office_count_handover; a settled or withdrawn handover no longer blocks the next count.
create or replace function app.office_count_handover(
  p_client_id uuid, p_rep_id uuid, p_counted_paisa bigint, p_variance_reason text default null)
returns public.handover
language plpgsql security definer set search_path = '' as $$
declare
  v_role     public.app_role := app.assert_office();
  v_reason   text := nullif(btrim(p_variance_reason), '');
  v_expected bigint;
  h          public.handover;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a handover needs a client_id (idempotency key, H-08)';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('handover-client:' || p_client_id::text, 0));
  select * into h from public.handover x where x.client_id = p_client_id;
  if found then
    if h.rep_id is distinct from p_rep_id or h.counted_paisa is distinct from p_counted_paisa
       or h.variance_reason is distinct from v_reason then
      raise exception using errcode = '22023', message = 'this client_id was used for a different handover';
    end if;
    return h;
  end if;

  if not exists (select 1 from public.user_profile u where u.id = p_rep_id and u.role = 'rep' and u.status = 'active') then
    raise exception using errcode = '22023', message = 'unknown or inactive rep';
  end if;
  if p_counted_paisa is null or p_counted_paisa < 0 then
    raise exception using errcode = '22023', message = 'the counted amount must be zero or more';
  end if;

  -- One count at a time per rep, and the same lock as the rep's answer (A-15).
  perform pg_advisory_xact_lock(hashtextextended('handover-rep:' || p_rep_id::text, 0));
  if exists (select 1 from public.handover x left join public.handover_response r on r.handover_id = x.id
             where x.rep_id = p_rep_id and (r.id is null or r.kind = 'dispute')
               and not exists (select 1 from public.handover_settlement st where st.handover_id = x.id)) then
    raise exception using errcode = '55000',
      message = 'this rep has a handover waiting for an answer or under dispute: the owner settles a dispute, and an unanswered count can be withdrawn';
  end if;

  v_expected := app.rep_cash_balance(p_rep_id);
  if v_expected < 0 then v_expected := 0; end if;
  if v_expected = 0 and p_counted_paisa = 0 then
    raise exception using errcode = '22023', message = 'nothing to hand over: the rep holds no cash and none was counted';
  end if;
  if v_expected <> p_counted_paisa and (v_reason is null or length(v_reason) < 5) then
    raise exception using errcode = '22023',
      message = format('the count differs from the expected Rs %s; give a reason of at least 5 characters',
                       to_char(v_expected / 100.0, 'FM999,999,990.00'));
  end if;

  insert into public.handover (client_id, rep_id, rep_day_id, expected_paisa, counted_paisa, variance_reason,
                               counted_by, counted_by_role)
  values (p_client_id, p_rep_id,
          (select d.id from public.rep_day d where d.rep_id = p_rep_id and d.day = app.karachi_today()),
          v_expected, p_counted_paisa, case when v_expected = p_counted_paisa then null else v_reason end,
          auth.uid(), v_role)
  returning * into h;
  return h;
end $$;

-- D-46: as migration 0023's app.rep_respond_handover; a handover the office withdrew can no longer be answered.
create or replace function app.rep_respond_handover(p_client_id uuid, p_handover_id uuid, p_accept boolean, p_note text default null)
returns public.handover_response
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  v_note text := nullif(btrim(p_note), '');
  v_kind text := case when p_accept then 'ack' else 'dispute' end;
  h      public.handover;
  r      public.handover_response;
begin
  if v_role <> 'rep' then perform app.raise_denied('only the rep answers its own handover'); end if;
  if p_client_id is null or p_accept is null then
    raise exception using errcode = '22023', message = 'an answer needs a client_id and ack or dispute';
  end if;
  select * into h from public.handover x where x.id = p_handover_id;
  if not found or h.rep_id <> auth.uid() then
    perform app.raise_denied('this is not your handover');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('handover-rep:' || h.rep_id::text, 0));
  select * into r from public.handover_response x where x.handover_id = h.id;
  if found then
    if r.client_id = p_client_id and r.kind = v_kind and r.note is not distinct from v_note then
      return r;
    end if;
    raise exception using errcode = '55000', message = 'this handover has already been answered';
  end if;
  if exists (select 1 from public.handover_settlement st where st.handover_id = h.id) then
    raise exception using errcode = '55000', message = 'the office withdrew this handover; nothing moved';
  end if;
  if exists (select 1 from public.handover_response x where x.client_id = p_client_id) then
    raise exception using errcode = '22023', message = 'this client_id was used for a different answer';
  end if;
  if v_kind = 'dispute' and (v_note is null or length(v_note) < 5) then
    raise exception using errcode = '22023', message = 'say why you disagree (at least 5 characters)';
  end if;

  insert into public.handover_response (client_id, handover_id, kind, note, responded_by)
  values (p_client_id, h.id, v_kind, v_note, auth.uid())
  returning * into r;

  if v_kind = 'ack' then
    if h.expected_paisa > 0 then
      insert into public.cash_ledger_entry (holder_type, holder_id, direction, amount_paisa, source_type, source_id)
      values ('rep', h.rep_id, 'out', h.expected_paisa, 'handover', h.id);
    end if;
    if h.counted_paisa > 0 then
      insert into public.cash_ledger_entry (holder_type, holder_id, direction, amount_paisa, source_type, source_id)
      values ('office', null, 'in', h.counted_paisa, 'handover', h.id);
    end if;
  end if;
  return r;
end $$;

drop function app.my_handovers();
-- The calling rep's handovers, newest first, at most 20: what to answer, what was decided, and the
-- owner's settlement or the office's withdrawal with its reason.
create function app.my_handovers()
returns table (handover_id uuid, counted_at timestamptz, expected_paisa bigint, counted_paisa bigint,
               variance_paisa bigint, variance_reason text, counted_by_name text, status text,
               responded_at timestamptz, response_note text, settlement text, settlement_reason text,
               settled_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_role() is distinct from 'rep' or not app.self_ok() then
    perform app.raise_denied('only a rep reads its own handovers');
  end if;
  return query
  select h.id, h.counted_at, h.expected_paisa, h.counted_paisa, h.variance_paisa, h.variance_reason, u.full_name,
         case when st.outcome = 'withdrawn' then 'withdrawn'
              when st.outcome is not null then 'settled'
              when r.kind = 'ack' then 'final' when r.kind = 'dispute' then 'disputed' else 'pending' end,
         r.responded_at, r.note, st.outcome, st.reason, st.settled_at
  from public.handover h
  join public.user_profile u on u.id = h.counted_by
  left join public.handover_response r on r.handover_id = h.id
  left join public.handover_settlement st on st.handover_id = h.id
  where h.rep_id = auth.uid()
  order by h.counted_at desc, h.id
  limit 20;
end $$;

drop function app.office_handovers();
-- The office's list, newest first, at most 100; open ones (pending or disputed, not settled) first.
create function app.office_handovers()
returns table (handover_id uuid, rep_id uuid, rep_name text, counted_at timestamptz, expected_paisa bigint,
               counted_paisa bigint, variance_paisa bigint, variance_reason text, counted_by_name text,
               status text, responded_at timestamptz, response_note text, settlement text, settlement_reason text,
               settled_at timestamptz, settled_by_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
  select h.id, h.rep_id, rp.full_name, h.counted_at, h.expected_paisa, h.counted_paisa, h.variance_paisa,
         h.variance_reason, cb.full_name,
         case when st.outcome = 'withdrawn' then 'withdrawn'
              when st.outcome is not null then 'settled'
              when r.kind = 'ack' then 'final' when r.kind = 'dispute' then 'disputed' else 'pending' end,
         r.responded_at, r.note, st.outcome, st.reason, st.settled_at, su.full_name
  from public.handover h
  join public.user_profile rp on rp.id = h.rep_id
  join public.user_profile cb on cb.id = h.counted_by
  left join public.handover_response r on r.handover_id = h.id
  left join public.handover_settlement st on st.handover_id = h.id
  left join public.user_profile su on su.id = st.settled_by
  order by (st.id is null and (r.kind is null or r.kind = 'dispute')) desc, h.counted_at desc, h.id
  limit 100;
end $$;

-- =============================================================================
-- FLOW-09, FLOW-10: the month and home figures
-- =============================================================================
drop function app.my_month_orders(date);
drop function app.office_rep_month(date);
drop function app.rep_month_orders(uuid, date, date);

-- Internal (no grant). One rep's orders placed in a month. Assigned (A-20, kept): orders whose rep is this
-- rep (assigned_rep_id, or rep_id on older rep orders), the orders commission is stamped to (D-31, D-38).
-- Placed: orders from this rep's own card, or its older rep_visit orders, whoever delivers them, the
-- same rule as the office home's "placed by" (app.order_placed_by). Values: delivered is the total of the
-- order's invoices, waiting the undelivered value of confirmed or part-delivered orders (FLOW-09), so a
-- part delivery counts its delivered part once and its rest once.
create function app.rep_month_orders(p_rep_id uuid, p_start date, p_end date)
returns table (orders_count bigint, orders_value_paisa bigint, delivered_count bigint, delivered_value_paisa bigint,
               waiting_count bigint, waiting_value_paisa bigint, held_count bigint, cancelled_count bigint,
               placed_count bigint, placed_value_paisa bigint)
language sql stable security definer set search_path = '' as $$
  with m as (
    select o.id, o.status, o.total_paisa,
           coalesce(o.assigned_rep_id, o.rep_id) = p_rep_id assigned,
           ((o.source_channel = 'rep_visit' and o.rep_id = p_rep_id)
            or (k.submitter_kind = 'rep' and k.rep_id = p_rep_id)) is true placed
    from public.sales_order o
    left join public.order_intake_card k on k.id = o.intake_card_id
    where (coalesce(o.assigned_rep_id, o.rep_id) = p_rep_id or o.rep_id = p_rep_id or k.rep_id = p_rep_id)
      and app.karachi_month(o.created_at) between p_start and p_end)
  select count(*) filter (where m.assigned and m.status <> 'cancelled'),
         coalesce(sum(m.total_paisa) filter (where m.assigned and m.status <> 'cancelled'), 0)::bigint,
         count(*) filter (where m.assigned and m.status in ('delivered', 'closed')),
         coalesce(sum((select coalesce(sum(i.total_paisa), 0) from public.invoice i where i.order_id = m.id))
                  filter (where m.assigned and m.status <> 'cancelled'), 0)::bigint,
         count(*) filter (where m.assigned and m.status in ('confirmed', 'partially_delivered')),
         coalesce(sum(app.order_undelivered_paisa(m.id))
                  filter (where m.assigned and m.status in ('confirmed', 'partially_delivered')), 0)::bigint,
         count(*) filter (where m.assigned and m.status = 'draft'),
         count(*) filter (where m.assigned and m.status = 'cancelled'),
         count(*) filter (where m.placed and m.status <> 'cancelled'),
         coalesce(sum(m.total_paisa) filter (where m.placed and m.status <> 'cancelled'), 0)::bigint
  from m
$$;

-- The calling rep's orders of the month. Commission for the same month is app.my_commission(month_start,
-- month_end), which the page calls with these dates.
create function app.my_month_orders(p_month date)
returns table (month_start date, month_end date, orders_count bigint, orders_value_paisa bigint, delivered_count bigint,
               delivered_value_paisa bigint, waiting_count bigint, waiting_value_paisa bigint, held_count bigint,
               cancelled_count bigint, placed_count bigint, placed_value_paisa bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_role  public.app_role := app.assert_actor_ready();
  v_start date;
  v_end   date;
begin
  if v_role <> 'rep' or not app.self_ok() then
    perform app.raise_denied('reps read their own month, on their approved phone');
  end if;
  select m.month_start, m.month_end into v_start, v_end from app.overview_month(p_month) m;
  return query
  select v_start, v_end, x.orders_count, x.orders_value_paisa, x.delivered_count, x.delivered_value_paisa,
         x.waiting_count, x.waiting_value_paisa, x.held_count, x.cancelled_count, x.placed_count, x.placed_value_paisa
  from app.rep_month_orders(auth.uid(), v_start, v_end) x;
end $$;

-- Every rep (up to 200, by name) with its orders of the month and its commission: earned and paid in
-- the month, still owed over all time (earned minus paid, as app.office_commission_reps).
create function app.office_rep_month(p_month date)
returns table (rep_id uuid, full_name text, status public.user_status, month_start date, month_end date,
               orders_count bigint, orders_value_paisa bigint, delivered_count bigint, waiting_count bigint,
               held_count bigint, cancelled_count bigint, earned_month_paisa bigint, paid_month_paisa bigint,
               owed_paisa bigint, placed_count bigint, placed_value_paisa bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_start date;
  v_end   date;
begin
  perform app.assert_office();
  select m.month_start, m.month_end into v_start, v_end from app.overview_month(p_month) m;
  return query
  select u.id, u.full_name, u.status, v_start, v_end, x.orders_count, x.orders_value_paisa, x.delivered_count,
         x.waiting_count, x.held_count, x.cancelled_count,
         app.commission_earned_paisa(u.id, v_start, v_end), app.commission_paid_paisa(u.id, v_start, v_end),
         app.commission_earned_paisa(u.id, null, null) - app.commission_paid_paisa(u.id, null, null),
         x.placed_count, x.placed_value_paisa
  from public.user_profile u
  cross join lateral app.rep_month_orders(u.id, v_start, v_end) x
  where u.role = 'rep'
  order by u.full_name, u.id
  limit 200;
end $$;

drop function app.office_overview_counts();
-- The counts at the top of the office home, each over the whole table; with the reps at or over the
-- cash cap (D-47) and the handovers waiting for the rep's answer or for the owner (D-46).
create function app.office_overview_counts()
returns table (week_start date, placed_this_week bigint, to_deliver bigint, waiting_approval bigint, held_orders bigint,
               pending_salons bigint, pending_requests bigint, delivered_this_week bigint, reps_at_cash_cap bigint,
               handovers_unanswered bigint, handovers_disputed bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_week date;
  v_cap  numeric := app.config_number('cash.intraday_cap_paisa');
begin
  perform app.assert_office();
  v_week := date_trunc('week', app.karachi_today()::timestamp)::date;
  return query
  select v_week,
         (select count(*) from public.sales_order o where (o.created_at at time zone 'Asia/Karachi')::date >= v_week),
         (select count(*) from public.sales_order o where o.status in ('confirmed', 'partially_delivered')),
         (select count(*) from public.delivery_submission s
           where not exists (select 1 from public.delivery_submission_decision x where x.submission_id = s.id)),
         (select count(*) from public.sales_order o where o.status = 'draft'),
         (select count(*) from public.salon s where s.approval_status = 'pending'),
         (select count(*) from public.order_intake_card c
           where not exists (select 1 from public.order_intake_card_close x where x.card_id = c.id)),
         (select count(*) from public.invoice i where (i.issued_at at time zone 'Asia/Karachi')::date >= v_week),
         (select count(*) from public.user_profile u
           where u.role = 'rep' and v_cap is not null and app.rep_cash_balance(u.id) >= v_cap),
         (select count(*) from public.handover h
           where not exists (select 1 from public.handover_response r where r.handover_id = h.id)
             and not exists (select 1 from public.handover_settlement s where s.handover_id = h.id)),
         (select count(*) from public.handover h
           join public.handover_response r on r.handover_id = h.id and r.kind = 'dispute'
           where not exists (select 1 from public.handover_settlement s where s.handover_id = h.id));
end $$;

drop function app.office_overview_rows();
-- FLOW-09: as migration 20261105180000's app.office_overview_rows, plus undelivered_paisa: what of the
-- order is still to deliver, at its own prices (the waiting rows' amount), null on invoice rows.
create function app.office_overview_rows()
returns table (section text, order_id uuid, salon_id uuid, salon_name text, placed_by_kind text, placed_by_name text,
               status public.order_status, total_paisa bigint, placed_at timestamptz, confirmed_at timestamptz,
               waiting_days integer, deliverer_kind text, deliverer_name text, waiting_approval boolean, hold_reason text,
               invoice_id uuid, invoice_number text, invoice_total_paisa bigint, delivered_at timestamptz,
               delivered_by_name text, undelivered_paisa bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_today date := app.karachi_today();
  v_week  date := date_trunc('week', app.karachi_today()::timestamp)::date;
begin
  perform app.assert_office();
  return query
  with picked as (
    (select 'placed'::text sec, 1 rnk, x.id oid, row_number() over (order by x.created_at desc, x.id) n
     from public.sales_order x where (x.created_at at time zone 'Asia/Karachi')::date >= v_week
     order by x.created_at desc, x.id limit 50)
    union all
    (select 'waiting', 2, x.id, row_number() over (order by x.confirmed_at, x.id)
     from public.sales_order x where x.status in ('confirmed', 'partially_delivered')
     order by x.confirmed_at, x.id limit 50)
    union all
    (select 'held', 3, x.id, row_number() over (order by x.created_at, x.id)
     from public.sales_order x where x.status = 'draft'
     order by x.created_at, x.id limit 50)),
  order_rows as (
    select k.rnk, k.n, k.sec, o.id, o.salon_id, s.name salon, pb.kind pk, pb.name pn, o.status st, o.total_paisa tot,
           o.created_at ca, o.confirmed_at cf,
           case when o.confirmed_at is null then null
                else (v_today - (o.confirmed_at at time zone 'Asia/Karachi')::date)::integer end wd,
           case when coalesce(o.assigned_rep_id, o.rep_id) is null then 'office' else 'rep' end dk, u.full_name dn,
           exists (select 1 from public.delivery_submission d
                   where d.order_id = o.id
                     and not exists (select 1 from public.delivery_submission_decision y where y.submission_id = d.id)) pend,
           case when o.status <> 'draft' then null
                when o.hold_discount = 'pending' then 'discount_waiting'
                when o.hold_discount = 'rejected' then 'discount_refused'
                when o.hold_credit is not null then o.hold_credit
                else 'not_checked' end hr,
           null::uuid iid, null::text inum, null::bigint itot, null::timestamptz iat, null::text ibn,
           app.order_undelivered_paisa(o.id) und
    from picked k
    join public.sales_order o on o.id = k.oid
    join public.salon s on s.id = o.salon_id
    cross join lateral app.order_placed_by(o.id) pb
    left join public.user_profile u on u.id = coalesce(o.assigned_rep_id, o.rep_id)),
  invoice_rows as (
    select 4 rnk, row_number() over (order by i.issued_at desc, i.number desc) n, 'delivered'::text sec, i.order_id id,
           i.salon_id, s.name salon, pb.kind pk, pb.name pn, so.status st, so.total_paisa tot, so.created_at ca,
           so.confirmed_at cf, null::integer wd, case when b.role = 'rep' then 'rep' else 'office' end dk, null::text dn,
           false pend, null::text hr, i.id iid, i.number inum, i.total_paisa itot, i.issued_at iat, b.full_name ibn,
           null::bigint und
    from (select * from public.invoice x order by x.issued_at desc, x.number desc limit 20) i
    join public.sales_order so on so.id = i.order_id
    join public.salon s on s.id = i.salon_id
    cross join lateral app.order_placed_by(i.order_id) pb
    left join public.user_profile b on b.id = coalesce(i.delivered_by, i.issued_by)),
  all_rows as (select * from order_rows union all select * from invoice_rows)
  select a.sec, a.id, a.salon_id, a.salon, a.pk, a.pn, a.st, a.tot, a.ca, a.cf, a.wd, a.dk, a.dn, a.pend, a.hr,
         a.iid, a.inum, a.itot, a.iat, a.ibn, a.und
  from all_rows a
  order by a.rnk, a.n;
end $$;

-- =============================================================================
-- Function privileges
-- =============================================================================
-- Internal helpers: no grant to any role.
revoke all on function
  app.rep_session_ok(), app.adjustment_needs_owner(uuid, bigint),
  app.owner_post_adjustment(uuid, uuid, uuid, integer, text, uuid),
  app.order_undelivered_paisa(uuid), app.rep_month_orders(uuid, date, date),
  control.owner_stock_adjustment_guard(), control.payment_reversal_guard()
  from public, anon, authenticated, service_role;

revoke all on function
  app.owner_adjust_stock(uuid, uuid, uuid, integer, text), app.office_adjustment_checker(uuid, integer),
  app.office_pending_stock(), app.office_refused_approvals(),
  app.office_reverse_payment(uuid, uuid, text), app.office_salon_payments(uuid),
  app.office_cash_cap_reps(),
  app.owner_settle_handover(uuid, uuid, text, text), app.office_withdraw_handover(uuid, uuid, text),
  app.my_handovers(), app.office_handovers(),
  app.my_month_orders(date), app.office_rep_month(date),
  app.office_overview_counts(), app.office_overview_rows()
  from public, anon, authenticated, service_role;
grant execute on function
  app.owner_adjust_stock(uuid, uuid, uuid, integer, text), app.office_adjustment_checker(uuid, integer),
  app.office_pending_stock(), app.office_refused_approvals(),
  app.office_reverse_payment(uuid, uuid, text), app.office_salon_payments(uuid),
  app.office_cash_cap_reps(),
  app.owner_settle_handover(uuid, uuid, text, text), app.office_withdraw_handover(uuid, uuid, text),
  app.my_handovers(), app.office_handovers(),
  app.my_month_orders(date), app.office_rep_month(date),
  app.office_overview_counts(), app.office_overview_rows()
  to authenticated;

comment on function app.owner_adjust_stock(uuid, uuid, uuid, integer, text) is
  'D-45. The owner (AAL2) adjusts a warehouse or a rep bag at once, with a reason of 5 to 300 characters. Idempotent on client_id.';
comment on function app.office_reverse_payment(uuid, uuid, text) is
  'D-48, PAY-10. Owner or manager (AAL2), with a reason; a manager never reverses a payment they recorded. Idempotent on client_id.';
comment on function app.owner_settle_handover(uuid, uuid, text, text) is
  'D-46. The owner (AAL2) settles a disputed handover: counted (the difference stays against the rep) or rep (an office difference), with a reason.';
comment on function app.office_withdraw_handover(uuid, uuid, text) is
  'D-46 (second reader). Owner or manager (AAL2) withdraws a handover the rep has not answered, with a reason; nothing moves.';

-- =============================================================================
-- Part 2: reads for the screens of the audit's second package (no table, no write path)
-- =============================================================================

-- REP-03, FLOW-06, FLOW-18. The territory's orders, newest 50 as before, except that the rep's own open
-- assigned orders (confirmed or part delivered) come first, so they never drop behind 50 newer orders of
-- other reps. Adds the hold codes and the cancel reason (staff-facing; the rep page words them).
drop function app.my_territory_orders();
create function app.my_territory_orders()
returns table (order_id uuid, salon_id uuid, salon_name text, status public.order_status, plan public.plan_code,
               total_paisa bigint, assigned_rep_id uuid, created_at timestamptz,
               hold_credit text, hold_discount text, cancel_reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_role() is distinct from 'rep' or not coalesce(app.self_ok(), false) then
    perform app.raise_denied('territory orders are listed for reps only, on their approved phone');
  end if;
  return query
  select o.id, o.salon_id, case when app.rep_can_reach_salon(o.salon_id) then s.name end, o.status, o.plan,
         o.total_paisa, o.assigned_rep_id, o.created_at, o.hold_credit, o.hold_discount, o.cancel_reason
  from public.sales_order o
  join public.salon s on s.id = o.salon_id
  where app.rep_can_reach_salon(o.salon_id)
  order by coalesce(o.assigned_rep_id = auth.uid() and o.status in ('confirmed', 'partially_delivered'), false) desc,
           o.created_at desc, o.id
  limit 50;
end $$;

-- REP-03. One order of the rep's territories by id (the delivery page): the same columns and guard.
create function app.my_territory_order(p_order_id uuid)
returns table (order_id uuid, salon_id uuid, salon_name text, status public.order_status, plan public.plan_code,
               total_paisa bigint, assigned_rep_id uuid, created_at timestamptz,
               hold_credit text, hold_discount text, cancel_reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_role() is distinct from 'rep' or not coalesce(app.self_ok(), false) then
    perform app.raise_denied('territory orders are listed for reps only, on their approved phone');
  end if;
  return query
  select o.id, o.salon_id, s.name, o.status, o.plan, o.total_paisa, o.assigned_rep_id, o.created_at,
         o.hold_credit, o.hold_discount, o.cancel_reason
  from public.sales_order o
  join public.salon s on s.id = o.salon_id
  where o.id = p_order_id and app.rep_can_reach_salon(o.salon_id);
end $$;

-- REP-10. my_salon as in migration 20261105160000, plus the office's reason when it rejected the
-- proposal (what the rep needs to propose again). Null for any other state.
drop function app.my_salon(uuid);
create function app.my_salon(p_id uuid)
returns table (id uuid, name text, type public.salon_type, stage public.salon_stage,
               verification_status public.salon_verification, area_id uuid, area_name text,
               lat numeric, lng numeric, phone_masked text, address text, chairs integer,
               approval_status public.salon_approval, rejection_reason text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.type, s.stage, s.verification_status, a.id, a.name, s.lat, s.lng,
         app.mask_phone((select c.phone from public.salon_contact c
                         where c.salon_id = s.id and c.is_primary and c.active)),
         s.address, s.chairs, s.approval_status,
         (select d.reason from public.salon_approval_decision d
           where d.salon_id = s.id and d.decision = 'rejected' and s.approval_status = 'rejected')
  from public.salon s join public.area a on a.id = s.area_id
  where s.id = p_id and app.self_ok() and app.user_role() = 'rep'
    and app.rep_holds_salon(auth.uid(), s.id)
$$;

-- REP-10. my_salons as in migration 20261105100000, plus the approval state as the last column.
drop function app.my_salons(text, uuid, integer);
create function app.my_salons(p_after_name text default null, p_after_id uuid default null, p_limit integer default 50)
returns table (id uuid, name text, type public.salon_type, stage public.salon_stage,
               verification_status public.salon_verification, area_id uuid, area_name text,
               lat numeric, lng numeric, phone_masked text, approval_status public.salon_approval)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.type, s.stage, s.verification_status, a.id, a.name, s.lat, s.lng,
         app.mask_phone((select c.phone from public.salon_contact c
                         where c.salon_id = s.id and c.is_primary and c.active)),
         s.approval_status
  from public.salon s join public.area a on a.id = s.area_id
  where app.self_ok() and app.user_role() = 'rep'
    and app.rep_holds_salon(auth.uid(), s.id)
    and (p_after_id is null or (coalesce(s.name, ''), s.id) > (coalesce(p_after_name, ''), p_after_id))
  order by coalesce(s.name, ''), s.id
  limit least(greatest(coalesce(p_limit, 50), 1), 50)
$$;

-- REP-09. The rep's own payments, newest 50 (H-14), optionally for one salon: receipt number, method,
-- amount, server time and whether the office reversed it (D-48). The salon's name only while the rep can
-- still reach the salon. No bank reference, GPS or flags.
create function app.my_collections(p_salon_id uuid default null)
returns table (payment_id uuid, salon_id uuid, salon_name text, method public.pay_method, amount_paisa bigint,
               recorded_at timestamptz, receipt_number text, reversed boolean, reversed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if app.user_role() is distinct from 'rep' or not coalesce(app.self_ok(), false) then
    perform app.raise_denied('a rep''s collections are listed for that rep only, on their approved phone');
  end if;
  return query
  select p.id, p.salon_id, case when app.rep_can_reach_salon(p.salon_id) then s.name end, p.method, p.amount_paisa,
         p.recorded_at, r.number, x.id is not null, x.reversed_at
  from public.payment p
  join public.salon s on s.id = p.salon_id
  left join public.receipt r on r.payment_id = p.id
  left join public.payment_reversal x on x.payment_id = p.id
  where p.recorded_by = auth.uid() and (p_salon_id is null or p.salon_id = p_salon_id)
  order by p.recorded_at desc, p.id
  limit 50;
end $$;

-- AUTH-10, FLOW-18. salon_my_orders as in migration 20261105150000, plus waiting_on: for an order on
-- hold, one fixed word for what it waits for ('price_approval' for a discount, 'credit_check' for a
-- credit check, 'office_check' otherwise); null for every other status. No credit figure and no text the
-- office typed reaches the salon (the cancel reason stays with the office and the rep).
drop function app.salon_my_orders();
create function app.salon_my_orders()
returns table (order_id uuid, created_at timestamptz, status public.order_status, plan public.plan_code,
               subtotal_paisa bigint, discount_paisa bigint, total_paisa bigint, from_request boolean, lines jsonb,
               waiting_on text)
language plpgsql stable security definer set search_path = '' as $$
declare v_salon uuid := app.assert_salon_member();
begin
  return query
  select o.id, o.created_at, o.status, o.plan, o.subtotal_paisa, o.discount_paisa, o.total_paisa,
         o.source_channel = 'salon_portal',
         coalesce((select jsonb_agg(jsonb_build_object('line_no', l.line_no, 'code', k.code, 'product_name', p.name,
                                                       'variant', k.variant, 'qty', l.qty,
                                                       'unit_price_paisa', l.unit_price_paisa,
                                                       'line_total_paisa', l.line_total_paisa) order by l.line_no)
                   from public.sales_order_line l
                   join public.sku k on k.id = l.sku_id
                   join public.product p on p.id = k.product_id
                   where l.order_id = o.id), '[]'::jsonb),
         case when o.status <> 'draft' then null
              when o.hold_discount is not null then 'price_approval'
              when o.hold_credit is not null then 'credit_check'
              else 'office_check' end
  from public.sales_order o
  where o.salon_id = v_salon
  order by o.created_at desc, o.id
  limit 50;
end $$;

-- AUTH-09. The status of this login's own salon account (active, suspended or revoked) and the salon's
-- name, for a session that proved its mailbox (as app.salon_me). Null for any other login. The reason the
-- office typed is not returned, nor any balance (whether a suspended salon sees its balance is MJ's).
create function app.salon_login_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('membership_status', m.status, 'name', s.name)
  from public.salon_membership m
  join public.salon s on s.id = m.salon_id
  where m.user_id = auth.uid() and app.session_proved_email()
  order by (m.status = 'active') desc, m.created_at desc
  limit 1
$$;

revoke all on function
  app.my_territory_orders(), app.my_territory_order(uuid), app.my_salon(uuid), app.my_salons(text, uuid, integer),
  app.my_collections(uuid), app.salon_my_orders(), app.salon_login_status()
  from public, anon, authenticated, service_role;
grant execute on function
  app.my_territory_orders(), app.my_territory_order(uuid), app.my_salon(uuid), app.my_salons(text, uuid, integer),
  app.my_collections(uuid), app.salon_my_orders(), app.salon_login_status()
  to authenticated;

comment on function app.my_territory_order(uuid) is
  'REP-03 (P1-30). One order of the rep''s territories by id, for the delivery page. A rep on its approved phone.';
comment on function app.my_collections(uuid) is
  'REP-09 (P1-30). The rep''s own payments, newest 50, with receipt numbers and whether the office reversed them.';
comment on function app.salon_login_status() is
  'AUTH-09 (P1-30). The status of this login''s own salon account, for an emailed-code session; no reason, no balance.';
