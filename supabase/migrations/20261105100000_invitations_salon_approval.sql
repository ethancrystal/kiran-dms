-- =============================================================================
-- Kiran DMS · migration 20261105100000 · Invitations, salon membership, salon approval, rep assignment
-- Completion slice 1 (P1-18). Requirements: SEC-13, SEC-16, SEC-17, SAL-11, SAL-13, SAL-14; doc 06
-- section 2 and 2.1; D-35, D-36, D-39, D-41; spec 2026-11-05 rulings R2, R3, R4 and sections 2 to 4.
--
-- What is built:
--   * public.invitation: the office invites a rep or a salon. The token is 32 random bytes from the
--     database, returned once to the office user, and only its sha256 is stored. Single use, 7 days,
--     bound to the invited email. Nothing in this table is readable through the API: the office lists
--     it through app.office_invitations, the invitee through app.invitation_preview.
--   * public.salon_membership: a login's tie to one salon (doc 06 section 2.1). One login per salon and
--     one salon per login, for now (L-0376, L-0382). Never a user_profile.role.
--   * public.salon_approval_decision (append-only), public.salon_rep_assignment (append-only; latest
--     row wins, a null rep clears it). salon.approval_status moves only with a decision row in the same
--     transaction. Existing rows read approved (column default). Nothing creates a pending salon until
--     slice 7 (a rep's proposal); app.create_salon is unchanged here.
--   * app.office_invite, app.office_invitations, app.office_revoke_invitation, app.invitation_preview,
--     app.redeem_invitation, app.office_set_member_status, app.office_decide_salon,
--     app.office_assign_salon_rep, app.office_pending_salons, app.salon_me.
--   * R4 (app.rep_holds_salon, app.rep_can_reach_salon): a direct assignment limits the salon to that
--     rep; otherwise territory coverage, as before. app.my_salons, app.my_salon, app.due_list and
--     app.my_route inlined the territory test and now use the same predicate. app.office_create_order
--     follows it for the delivering rep (A-16). A pending or rejected salon gets no order
--     (app.build_order) and no order card (app.rep_create_card).
--
-- Email-code proof. Signup is on for the invite page (supabase/config.toml), and GoTrue has no switch
-- that allows codes but not passwords, while enable_confirmations = false signs a password signup in
-- at once. So an address in auth.users proves nothing by itself: app.redeem_invitation,
-- app.invitation_preview and app.salon_me also need the session's signed amr claim to show an emailed
-- code. And a password squatter could register the invitee's address first, then share the invitee's
-- login: redeeming clears the login's password and ends its other sessions.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------------ types ----
create type public.salon_approval    as enum ('pending', 'approved', 'rejected');
create type public.invitation_kind   as enum ('rep', 'salon');
create type public.invitation_status as enum ('pending', 'redeemed', 'revoked');
create type public.membership_status as enum ('active', 'suspended', 'revoked');

-- ------------------------------------------------------------------ salon ----
alter table public.salon add column approval_status public.salon_approval not null default 'approved';
create index salon_pending_idx on public.salon (created_at) where approval_status = 'pending';
comment on column public.salon.approval_status is
  'D-35. Office-added salons are approved; a rep''s proposal stays pending until the office decides (slice 7). Only an approved salon gets an order or a card. Changes only with a salon_approval_decision.';

-- ------------------------------------------------------------- invitations ----
create table public.invitation (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null unique,                                -- idempotency key from the page (H-08)
  kind          public.invitation_kind not null,
  email         text not null check (email = lower(btrim(email)) and length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  full_name     text not null check (length(btrim(full_name)) between 2 and 120),
  salon_id      uuid references public.salon (id),
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),   -- sha256 of the token; the token is never stored
  status        public.invitation_status not null default 'pending',
  expires_at    timestamptz not null,
  invited_by    uuid not null references public.user_profile (id),
  created_at    timestamptz not null default now(),
  redeemed_by   uuid references auth.users (id),
  redeemed_at   timestamptz,
  revoked_by    uuid references public.user_profile (id),
  revoked_at    timestamptz,
  revoke_reason text check (length(revoke_reason) <= 300),
  constraint invitation_kind_shape check ((kind = 'salon') = (salon_id is not null)),
  constraint invitation_redeemed_shape check ((status = 'redeemed') = (redeemed_by is not null and redeemed_at is not null)),
  constraint invitation_revoked_shape check ((status = 'revoked') = (revoked_by is not null and revoked_at is not null and revoke_reason is not null))
);
create index invitation_email_idx on public.invitation (email, created_at desc);
create index invitation_salon_idx on public.invitation (salon_id, created_at desc) where salon_id is not null;
comment on table public.invitation is
  'D-39, spec section 3. An invitation to become a rep or a salon account. Facts are fixed; the status moves once, from pending to redeemed or revoked. Expiry is read from expires_at. Not exposed through the API.';

-- ---------------------------------------------------------------- membership ----
create table public.salon_membership (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id),
  salon_id      uuid not null references public.salon (id),
  invitation_id uuid not null unique references public.invitation (id),
  full_name     text not null check (length(btrim(full_name)) between 2 and 120),
  email         text not null,
  status        public.membership_status not null default 'active',
  status_by     uuid references public.user_profile (id),
  status_reason text check (length(status_reason) <= 300),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- One login per salon and one salon per login (L-0376, L-0382). A revoked membership frees both.
create unique index salon_membership_one_per_login on public.salon_membership (user_id) where status <> 'revoked';
create unique index salon_membership_one_per_salon on public.salon_membership (salon_id) where status <> 'revoked';
comment on table public.salon_membership is
  'Doc 06 section 2.1. A login''s tie to one salon, from a redeemed invitation. Not a staff role. The status changes through app.office_set_member_status; revoked is final.';

-- ------------------------------------------------------------------ decisions ----
create table public.salon_approval_decision (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null unique,                                   -- idempotency key from the page (H-08)
  salon_id   uuid not null references public.salon (id),
  decision   public.salon_approval not null check (decision <> 'pending'),
  reason     text check (length(reason) <= 500),
  decided_by uuid not null references public.user_profile (id),
  decided_at timestamptz not null default now(),
  tx_id      bigint not null default txid_current(),
  constraint salon_decision_reject_reason check (decision <> 'rejected' or length(btrim(coalesce(reason, ''))) >= 5)
);
create unique index salon_approval_decision_once on public.salon_approval_decision (salon_id);   -- a salon is decided once
comment on table public.salon_approval_decision is
  'D-35. Append-only. The office''s decision on a pending salon. A rejection carries a reason of at least 5 characters.';

create table public.salon_rep_assignment (
  id          uuid primary key default gen_random_uuid(),
  seq         bigint generated always as identity,                   -- "latest" is this, not a clock: now() ties within a transaction
  client_id   uuid not null unique,                                  -- idempotency key from the page (H-08)
  salon_id    uuid not null references public.salon (id),
  rep_id      uuid references public.user_profile (id),              -- null: back to territory coverage
  rate_bp     integer check (rate_bp between 0 and 10000),           -- commission rate; stored here, used from slice 5
  assigned_by uuid not null references public.user_profile (id),
  created_at  timestamptz not null default now(),
  constraint salon_rep_assignment_rate_needs_rep check (rep_id is not null or rate_bp is null)
);
create index salon_rep_assignment_latest_idx on public.salon_rep_assignment (salon_id, seq desc);
create index salon_rep_assignment_rep_idx on public.salon_rep_assignment (rep_id) where rep_id is not null;
comment on table public.salon_rep_assignment is
  'D-36, R4. Append-only. The latest row of a salon says who reaches it: that rep alone, or (null) the reps covering its territory.';

-- ------------------------------------------------------------------- guards ----
-- Facts are fixed; the status moves once, from pending. A later migration or a test's direct update
-- meets the same rule.
create function control.invitation_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'invitations are revoked, never deleted (H-07)';
  end if;
  if (new.id, new.client_id, new.kind, new.email, new.full_name, new.salon_id, new.token_hash, new.expires_at,
      new.invited_by, new.created_at)
     is distinct from
     (old.id, old.client_id, old.kind, old.email, old.full_name, old.salon_id, old.token_hash, old.expires_at,
      old.invited_by, old.created_at) then
    raise exception using errcode = '42501', message = 'an invitation''s facts are immutable';
  end if;
  if old.status <> 'pending' or new.status = 'pending' then
    raise exception using errcode = '42501', message = 'an invitation moves once, from pending to redeemed or revoked';
  end if;
  return new;
end $$;

create function control.salon_membership_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'memberships are revoked, never deleted (H-07)';
  end if;
  if (new.id, new.user_id, new.salon_id, new.invitation_id, new.full_name, new.email, new.created_at)
     is distinct from
     (old.id, old.user_id, old.salon_id, old.invitation_id, old.full_name, old.email, old.created_at) then
    raise exception using errcode = '42501', message = 'a membership''s identity is immutable';
  end if;
  if old.status = 'revoked' then
    raise exception using errcode = '42501', message = 'a revoked membership is final';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Migration 0009's guard, plus: approval moves only with a decision row in the same transaction.
create or replace function control.salon_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'salons are never deleted (H-07); park them instead';
  end if;
  if (new.id, new.created_by, new.created_at, new.source, new.discovered_by, new.created_at_client)
     is distinct from (old.id, old.created_by, old.created_at, old.source, old.discovered_by, old.created_at_client) then
    raise exception using errcode = '42501', message = 'salon identity columns are immutable';
  end if;
  if new.stage is distinct from old.stage and not exists (
       select 1 from public.stage_event e
       where e.salon_id = new.id and e.from_stage = old.stage and e.to_stage = new.stage
         and e.tx_id = txid_current()) then
    raise exception using errcode = '42501', message = 'a salon''s stage changes only with a stage_event (doc 04)';
  end if;
  if new.verification_status is distinct from old.verification_status then
    raise exception using errcode = '42501', message = 'verification changes only through the CTL-09 flow';
  end if;
  if new.approval_status is distinct from old.approval_status and not exists (
       select 1 from public.salon_approval_decision d
       where d.salon_id = new.id and d.decision = new.approval_status and d.tx_id = txid_current()) then
    raise exception using errcode = '42501', message = 'a salon''s approval changes only with a decision (app.office_decide_salon)';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger invitation_guard before update or delete on public.invitation
  for each row execute function control.invitation_guard();
create trigger salon_membership_guard before update or delete on public.salon_membership
  for each row execute function control.salon_membership_guard();
create trigger append_only before update or delete on public.salon_approval_decision for each row execute function control.forbid_mutation();
create trigger append_only before update or delete on public.salon_rep_assignment    for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.invitation              for each statement execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.salon_membership        for each statement execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.salon_approval_decision for each statement execute function control.forbid_mutation();
create trigger no_truncate before truncate on public.salon_rep_assignment    for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on public.invitation              for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.salon_membership        for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.salon_approval_decision for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.salon_rep_assignment    for each row execute function control.audit_row();

-- ---------------------------------------------------------------------- RLS -----
alter table public.invitation              enable row level security;
alter table public.invitation              force  row level security;
alter table public.salon_membership        enable row level security;
alter table public.salon_membership        force  row level security;
alter table public.salon_approval_decision enable row level security;
alter table public.salon_approval_decision force  row level security;
alter table public.salon_rep_assignment    enable row level security;
alter table public.salon_rep_assignment    force  row level security;

-- The office reads these. No salon or rep reads them: a salon reads through app.salon_me only (spec
-- section 4), and public.invitation has no grant and no policy at all, so its token hash never leaves.
create policy salon_membership_select on public.salon_membership for select to authenticated
  using ((select app.is_office()));
create policy salon_approval_decision_select on public.salon_approval_decision for select to authenticated
  using ((select app.is_office()));
create policy salon_rep_assignment_select on public.salon_rep_assignment for select to authenticated
  using ((select app.is_office()));

-- ----------------------------------------------------------------- privileges ----
revoke all on public.invitation, public.salon_membership, public.salon_approval_decision, public.salon_rep_assignment
  from public, anon, authenticated, service_role;
grant select on public.salon_membership, public.salon_approval_decision, public.salon_rep_assignment
  to authenticated, service_role;
-- The identity behind salon_rep_assignment.seq: only the table's owner (the definer functions) draws on it.
revoke all on sequence public.salon_rep_assignment_seq_seq from public, anon, authenticated, service_role;
revoke execute on function control.invitation_guard(), control.salon_membership_guard()
  from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------- helpers ----
-- Internal (no grant). True when this session signed in with an emailed code: GoTrue signs the method
-- into the JWT's amr claim (otp for a verified code, magiclink for a verified link; password never
-- proves the mailbox, because enable_confirmations is off). See the note at the top of this file.
create function app.session_proved_email() returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) e
    where e.value ->> 'method' in ('otp', 'magiclink'))
$$;

-- Internal (no grant). The sha256 stored for a token, in hex.
create function app.invitation_hash(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;

-- Internal (no grant). A pending invitation past its date reads expired; the row itself stays pending.
create function app.invitation_state(i public.invitation) returns text
language sql stable set search_path = '' as $$
  select case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status::text end
$$;

-- Internal (no grant). The rep of the salon's latest assignment row; null when it has none or was cleared.
create function app.salon_direct_rep(p_salon_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.rep_id from public.salon_rep_assignment r
  where r.salon_id = p_salon_id
  order by r.seq desc
  limit 1
$$;

-- Internal (no grant). A row-locked check that this person can be assigned a salon. The lock waits for
-- a suspension in progress and then reads its committed result (the B-34 lesson).
create function app.assert_assignable_rep(p_rep_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.user_profile u
                 where u.id = p_rep_id and u.role = 'rep' and u.status = 'active' for share) then
    raise exception using errcode = '22023', message = 'a salon is assigned only to an active rep';
  end if;
end $$;

-- Internal (no grant). A commission rate is a whole number of basis points, 0 to 10000, and needs a rep.
create function app.assert_assignment_rate(p_rep_id uuid, p_rate_bp integer) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_rate_bp is not null and p_rep_id is null then
    raise exception using errcode = '22023', message = 'a commission rate needs a rep';
  end if;
  if p_rate_bp is not null and p_rate_bp not between 0 and 10000 then
    raise exception using errcode = '22023', message = 'a commission rate is 0 to 100 percent (0 to 10000 basis points)';
  end if;
end $$;

-- ------------------------------------------------------------------ reachability ----
-- R4: a salon with a direct assignment belongs to that rep alone; with none, to the reps covering its
-- territory (migration 0011's test). An unknown salon has neither, so nobody holds it.
create or replace function app.rep_holds_salon(p_rep_id uuid, p_salon_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when d.rep_id is not null then d.rep_id = p_rep_id
    else exists (
      select 1 from public.salon s
      join public.area a on a.id = s.area_id
      join public.rep_territory rt on rt.territory_id = a.territory_id and rt.rep_id = p_rep_id and rt.to_date is null
      where s.id = p_salon_id)
  end
  from (select app.salon_direct_rep(p_salon_id) as rep_id) d
$$;

-- True when the calling rep may act on this salon: an active rep on the approved device (as in
-- migration 0009) who holds the salon under R4.
create or replace function app.rep_can_reach_salon(p_salon_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.self_ok() and app.user_role() = 'rep' and app.rep_holds_salon(auth.uid(), p_salon_id)
$$;

-- Migration 0009, with the reach test on R4. Same columns, cap and order.
create or replace function app.my_salons(p_after_name text default null, p_after_id uuid default null, p_limit integer default 50)
returns table (id uuid, name text, type public.salon_type, stage public.salon_stage,
               verification_status public.salon_verification, area_id uuid, area_name text,
               lat numeric, lng numeric, phone_masked text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.type, s.stage, s.verification_status, a.id, a.name, s.lat, s.lng,
         app.mask_phone((select c.phone from public.salon_contact c
                         where c.salon_id = s.id and c.is_primary and c.active))
  from public.salon s join public.area a on a.id = s.area_id
  where app.self_ok() and app.user_role() = 'rep'
    and app.rep_holds_salon(auth.uid(), s.id)
    and (p_after_id is null or (coalesce(s.name, ''), s.id) > (coalesce(p_after_name, ''), p_after_id))
  order by coalesce(s.name, ''), s.id
  limit least(greatest(coalesce(p_limit, 50), 1), 50)
$$;

-- Migration 0016, with the reach test on R4. Same columns.
create or replace function app.my_salon(p_id uuid)
returns table (id uuid, name text, type public.salon_type, stage public.salon_stage,
               verification_status public.salon_verification, area_id uuid, area_name text,
               lat numeric, lng numeric, phone_masked text, address text, chairs integer)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.type, s.stage, s.verification_status, a.id, a.name, s.lat, s.lng,
         app.mask_phone((select c.phone from public.salon_contact c
                         where c.salon_id = s.id and c.is_primary and c.active)),
         s.address, s.chairs
  from public.salon s join public.area a on a.id = s.area_id
  where s.id = p_id and app.self_ok() and app.user_role() = 'rep'
    and app.rep_holds_salon(auth.uid(), s.id)
$$;

-- Migration 0011, with the rep's scope on R4. Same columns, urgency and cap.
create or replace function app.due_list(p_on date default null, p_territory_id uuid default null)
returns table (salon_id uuid, salon_name text, area_name text, stage public.salon_stage, product_group_id uuid,
               product_group_name text, last_order_on date, cycle_days integer, next_due_on date, due_status text)
language sql stable security definer set search_path = '' as $$
  with d as (
    select s.id as sid, s.name as sname, a.name as aname, s.stage as sstage, g.id as gid, g.name as gname,
           c.last_order_on as last_on, coalesce(c.cycle_days, g.default_cycle_days) as cyc,
           coalesce(p_on, app.karachi_today()) as on_day
    from public.cycle_estimate c
    join public.salon s on s.id = c.salon_id
    join public.area a on a.id = s.area_id
    join public.product_group g on g.id = c.product_group_id
    where g.active and s.stage <> 'parked'
      and (p_territory_id is null or a.territory_id = p_territory_id)
      and ((app.self_ok() and app.user_role() = 'rep' and app.rep_holds_salon(auth.uid(), s.id))
           or app.is_office())
  )
  select d.sid, d.sname, d.aname, d.sstage, d.gid, d.gname, d.last_on, d.cyc, d.last_on + d.cyc,
         case when d.on_day >= d.last_on + d.cyc + ceil(d.cyc / 2.0)::integer then 'at_risk'
              when d.on_day >= d.last_on + d.cyc then 'overdue'
              else 'due' end
  from d
  where d.on_day >= d.last_on + d.cyc - 3
  order by d.last_on + d.cyc, d.sid, d.gid
  limit 50
$$;

-- Migration 0011, with the hidden-stop test on R4. Same columns and order.
create or replace function app.my_route(p_day date default null)
returns table (stop_id uuid, sequence integer, salon_id uuid, salon_name text, area_name text, stage public.salon_stage,
               reason public.route_stop_reason, lat numeric, lng numeric, next_due_on date,
               visited boolean, last_outcome public.visit_outcome)
language sql stable security definer set search_path = '' as $$
  select st.id, st.sequence, s.id, s.name, a.name, s.stage, st.reason, s.lat, s.lng,
         (select min(c.last_order_on + coalesce(c.cycle_days, g.default_cycle_days))
            from public.cycle_estimate c join public.product_group g on g.id = c.product_group_id
           where c.salon_id = s.id and g.active),
         lv.outcome is not null, lv.outcome
  from public.route r
  join public.route_stop st on st.route_id = r.id
  join public.salon s on s.id = st.salon_id
  join public.area a on a.id = s.area_id
  left join lateral (
    select v.outcome from public.visit v join public.rep_day d on d.id = v.rep_day_id
    where d.rep_id = r.rep_id and d.day = r.day and v.salon_id = s.id
    order by v.arrived_at desc, v.id desc limit 1) lv on true
  where app.self_ok() and app.user_role() = 'rep' and r.rep_id = auth.uid()
    and r.day = coalesce(p_day, app.karachi_today())
    and app.rep_holds_salon(auth.uid(), s.id)
  order by st.sequence
$$;

-- ------------------------------------------------------------ order builder ----
-- Migration 0025's engine, with one new first check: only an approved salon gets an order (D-35).
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

-- Internal (no grant). D-35: a pending or rejected salon has no orders and no requests. An unknown salon
-- is the caller's to report.
create function app.assert_salon_approved(p_salon_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v public.salon_approval;
begin
  select s.approval_status into v from public.salon s where s.id = p_salon_id;
  if v is distinct from 'approved' and v is not null then
    raise exception using errcode = '55000', message = format('this salon is %s: only an approved salon can have an order (D-35)', v);
  end if;
end $$;

-- --------------------------------------------------------- office order path ----
-- Migration 0025, with the delivering rep on R4 (A-16, MJ L-0385): a directly assigned salon takes its
-- assigned rep only; otherwise an active rep covering its territory, as before.
create or replace function app.office_create_order(
  p_client_id uuid, p_salon_id uuid, p_plan public.plan_code, p_lines jsonb,
  p_assigned_rep_id uuid default null, p_intake_card_id uuid default null)
returns public.sales_order
language plpgsql security definer set search_path = '' as $$
declare
  v_role   public.app_role := app.assert_office();
  o        public.sales_order;
  v_area   uuid;
  v_direct uuid;
  k        public.order_intake_card;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'an order needs a client_id (idempotency key, H-08)';
  end if;
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
    -- A concurrent call with this client_id may have converted the card while this one waited on the
    -- lock: check the replay again now that its order is visible, before the already-closed test.
    select * into o from public.sales_order where client_id = p_client_id;
    if o.id is not null then
      if o.created_by = auth.uid() and o.salon_id = p_salon_id and o.plan = p_plan
         and o.intake_card_id is not distinct from p_intake_card_id then
        return o;                                                              -- replay
      end if;
      raise exception using errcode = '23505', message = 'client_id already used with different content';
    end if;
    if exists (select 1 from public.order_intake_card_close x where x.card_id = k.id) then
      raise exception using errcode = '55000', message = 'this order card is already closed';
    end if;
  end if;
  select s.area_id into v_area from public.salon s where s.id = p_salon_id;
  if not found then raise exception using errcode = '22023', message = 'unknown salon'; end if;
  v_direct := app.salon_direct_rep(p_salon_id);
  if p_assigned_rep_id is not null and v_direct is not null and p_assigned_rep_id <> v_direct then
    raise exception using errcode = '22023', message = 'this salon is assigned to another rep (D-36)';
  end if;
  if p_assigned_rep_id is not null and not (
       exists (select 1 from public.user_profile u
                where u.id = p_assigned_rep_id and u.role = 'rep' and u.status = 'active')
       and app.rep_holds_salon(p_assigned_rep_id, p_salon_id)) then
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

-- ------------------------------------------------------------- order cards ----
-- Migration 0025, with the approval check after reach: a pending salon takes no request either (spec
-- section 3). The rest of slice 6's rework of this function is still to come.
create or replace function app.rep_create_card(p_client_id uuid, p_salon_id uuid, p_body text, p_visit_id uuid default null)
returns public.order_intake_card
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  k      public.order_intake_card;
  v_day  uuid;
  v_body text := btrim(p_body);
begin
  if v_role <> 'rep' then perform app.raise_denied('only reps save order cards'); end if;
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a card needs a client_id (idempotency key, H-08)';
  end if;
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
  perform app.assert_salon_approved(p_salon_id);
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

-- ------------------------------------------------------------------ inviting ----
-- D-39: the owner or a manager invites a rep or a salon, at AAL2. Nobody invites an owner or a manager
-- this way; the owner creates those (app.owner_create_user). A rep needs a name and an email; a salon
-- also needs an existing approved salon, or a new salon's id, name, type and area, which app.create_salon
-- adds in this transaction, approved. The token comes back once. A replay of the client_id returns the
-- same invitation with a null token, because only the hash exists.
-- One live invitation per email and per salon; an expired or revoked one does not count.
create function app.office_invite(
  p_client_id uuid, p_kind text, p_full_name text, p_email text, p_salon_id uuid default null,
  p_new_salon_id uuid default null, p_new_salon_name text default null,
  p_new_salon_type public.salon_type default null, p_new_salon_area uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role  public.app_role := app.assert_office();
  v_name  text := app.blank_to_null(p_full_name);
  v_email text := lower(btrim(p_email));
  v_salon uuid := coalesce(p_salon_id, p_new_salon_id);
  v_appr  public.salon_approval;
  v_token text;
  i       public.invitation;
begin
  if p_kind in ('owner', 'manager') then
    perform app.raise_denied('owners and managers are not invited: the owner creates them (D-39)');
  end if;
  if p_kind is distinct from 'rep' and p_kind is distinct from 'salon' then
    raise exception using errcode = '22023', message = 'an invitation is for a rep or a salon';
  end if;
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'an invitation needs a client_id (idempotency key, H-08)';
  end if;
  select * into i from public.invitation x where x.client_id = p_client_id;
  if i.id is not null then
    if i.invited_by = auth.uid() and i.kind::text = p_kind and i.email = v_email and i.full_name = v_name
       and i.salon_id is not distinct from v_salon then
      return jsonb_build_object('id', i.id, 'kind', i.kind, 'email', i.email, 'full_name', i.full_name,
                                'salon_id', i.salon_id, 'status', app.invitation_state(i), 'expires_at', i.expires_at,
                                'token', null);                                -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if v_name is null or length(v_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'an invitation needs a name of 2 to 120 characters';
  end if;
  if v_email is null or length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception using errcode = '22023', message = 'an invitation needs a valid email address';
  end if;
  if p_kind = 'rep' and (p_salon_id is not null or p_new_salon_id is not null or p_new_salon_name is not null) then
    raise exception using errcode = '22023', message = 'a rep invitation names no salon';
  end if;
  if p_kind = 'salon' and (p_salon_id is null) = (p_new_salon_name is null) then
    raise exception using errcode = '22023', message = 'a salon invitation names an existing salon or a new one, not both';
  end if;

  -- One writer per address at a time, so two invitations cannot pass the checks below together.
  perform pg_advisory_xact_lock(hashtextextended('invitation:' || v_email, 0));
  if exists (select 1 from auth.users u join public.user_profile p on p.id = u.id where lower(u.email) = v_email) then
    raise exception using errcode = '55000', message = 'this email already has a staff account';
  end if;
  if exists (select 1 from auth.users u join public.salon_membership m on m.user_id = u.id
             where lower(u.email) = v_email and m.status <> 'revoked') then
    raise exception using errcode = '55000', message = 'this email already belongs to a salon account';
  end if;
  if exists (select 1 from public.invitation x where x.email = v_email and x.status = 'pending' and x.expires_at > now()) then
    raise exception using errcode = '55000', message = 'this email already has a live invitation; revoke it first';
  end if;

  if p_kind = 'salon' then
    if p_salon_id is not null then
      select s.approval_status into v_appr from public.salon s where s.id = p_salon_id for update;
      if not found then raise exception using errcode = '22023', message = 'unknown salon'; end if;
      if v_appr <> 'approved' then
        raise exception using errcode = '55000', message = format('this salon is %s: only an approved salon can be invited', v_appr);
      end if;
      if exists (select 1 from public.salon_membership m where m.salon_id = p_salon_id and m.status <> 'revoked') then
        raise exception using errcode = '55000', message = 'this salon already has an account (one login per salon)';
      end if;
      if exists (select 1 from public.invitation x where x.salon_id = p_salon_id and x.status = 'pending' and x.expires_at > now()) then
        raise exception using errcode = '55000', message = 'this salon already has a live invitation; revoke it first';
      end if;
    else
      if p_new_salon_id is null or app.blank_to_null(p_new_salon_name) is null or p_new_salon_type is null or p_new_salon_area is null then
        raise exception using errcode = '22023', message = 'a new salon needs an id, a name, a type and an area';
      end if;
      perform app.create_salon(p_new_salon_id, p_new_salon_name, p_new_salon_type, p_new_salon_area, 'manual');
    end if;
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  perform app.set_purpose('invitation created');
  insert into public.invitation (client_id, kind, email, full_name, salon_id, token_hash, expires_at, invited_by)
  values (p_client_id, p_kind::public.invitation_kind, v_email, v_name, v_salon, app.invitation_hash(v_token),
          now() + interval '7 days', auth.uid())
  returning * into i;
  return jsonb_build_object('id', i.id, 'kind', i.kind, 'email', i.email, 'full_name', i.full_name,
                            'salon_id', i.salon_id, 'status', i.status, 'expires_at', i.expires_at, 'token', v_token);
end $$;

-- The office's list, newest 200, with no token data; a pending invitation past its date reads expired.
create function app.office_invitations()
returns table (id uuid, kind public.invitation_kind, email text, full_name text, salon_id uuid, salon_name text,
               status text, expires_at timestamptz, invited_by_name text, created_at timestamptz,
               redeemed_at timestamptz, revoked_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
  select i.id, i.kind, i.email, i.full_name, i.salon_id, s.name, app.invitation_state(i), i.expires_at, u.full_name,
         i.created_at, i.redeemed_at, i.revoked_at
  from public.invitation i
  join public.user_profile u on u.id = i.invited_by
  left join public.salon s on s.id = i.salon_id
  order by i.created_at desc, i.id
  limit 200;
end $$;

-- Revoking stops a link that has not been used. A second revoke returns the same answer and keeps the
-- first person and reason; a used invitation is refused: its member is suspended instead.
create function app.office_revoke_invitation(p_invitation_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_office();
  i      public.invitation;
begin
  perform app.assert_reason(p_reason);
  select * into i from public.invitation x where x.id = p_invitation_id for update;
  if i.id is null then raise exception using errcode = '22023', message = 'unknown invitation'; end if;
  if i.status = 'redeemed' then
    raise exception using errcode = '55000', message = 'this invitation has been used; suspend the account instead';
  end if;
  if i.status = 'pending' then
    perform app.set_purpose('invitation revoked: ' || p_reason);
    update public.invitation
       set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(), revoke_reason = left(p_reason, 300)
     where id = i.id returning * into i;
  end if;
  return jsonb_build_object('id', i.id, 'status', i.status, 'revoked_at', i.revoked_at);
end $$;

-- ------------------------------------------------------------------ redeeming ----
-- What the invitee sees after the emailed code, before accepting: who invited whom for what. Signed-in
-- sessions only: no function in our schemas runs for anon (schema-hygiene), so nothing is shown before
-- the code. An unknown token, another email and a session without the code all get the same null.
create function app.invitation_preview(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('kind', i.kind, 'full_name', i.full_name, 'invited_by', u.full_name, 'salon_name', s.name,
                            'status', app.invitation_state(i), 'expires_at', i.expires_at)
  from public.invitation i
  join auth.users au on au.id = auth.uid()
  join public.user_profile u on u.id = i.invited_by
  left join public.salon s on s.id = i.salon_id
  where i.token_hash = app.invitation_hash(p_token) and lower(au.email) = i.email
    and au.email_confirmed_at is not null and app.session_proved_email()
$$;

-- Spec section 3: the invitee proves the email with the code, then the database redeems the token,
-- creating the rep's profile or the salon's membership. A login has no profile yet, so this cannot use
-- app.assert_actor_ready. The token row is locked, so two calls take turns. The same login's replay
-- changes nothing; any other state is refused. No salon ever gets a role, and a rep gets only 'rep'.
create function app.redeem_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := auth.uid();
  v_email     text;
  v_confirmed timestamptz;
  i           public.invitation;
begin
  if v_uid is null or not app.session_proved_email() then
    perform app.raise_denied('sign in with the emailed code to accept an invitation');
  end if;
  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = v_uid;
  select * into i from public.invitation x where x.token_hash = app.invitation_hash(p_token) for update;
  if i.id is null or v_email is distinct from i.email or v_confirmed is null then
    raise exception using errcode = '22023', message = 'this invitation does not exist or was sent to another email address';
  end if;
  if i.status = 'redeemed' then
    if i.redeemed_by = v_uid then return jsonb_build_object('kind', i.kind); end if;   -- replay
    raise exception using errcode = '55000', message = 'this invitation has already been used';
  end if;
  if i.status = 'revoked' then
    raise exception using errcode = '55000', message = 'this invitation was revoked; ask the office for a new one';
  end if;
  if i.expires_at <= now() then
    raise exception using errcode = '55000', message = 'this invitation has expired; ask the office for a new one';
  end if;
  if exists (select 1 from public.user_profile p where p.id = v_uid) then
    raise exception using errcode = '55000', message = 'this login already has a staff account';
  end if;
  if exists (select 1 from public.salon_membership m where m.user_id = v_uid and m.status <> 'revoked') then
    raise exception using errcode = '55000', message = 'this login already belongs to a salon account';
  end if;
  perform app.set_purpose('invitation redeemed');
  if i.kind = 'rep' then
    insert into public.user_profile (id, full_name, role, vault_grant, created_by)
    values (v_uid, i.full_name, 'rep', false, i.invited_by);
  else
    perform 1 from public.salon s where s.id = i.salon_id for update;     -- one login per salon
    if exists (select 1 from public.salon_membership m where m.salon_id = i.salon_id and m.status <> 'revoked') then
      raise exception using errcode = '55000', message = 'this salon already has an account (one login per salon)';
    end if;
    insert into public.salon_membership (user_id, salon_id, invitation_id, full_name, email)
    values (v_uid, i.salon_id, i.id, i.full_name, i.email);
  end if;
  update public.invitation set status = 'redeemed', redeemed_by = v_uid, redeemed_at = now() where id = i.id;
  -- See the note at the top of this file: from here on the emailed code is the only way into this
  -- login, and any session that did not prove the mailbox is ended. Not audited: auth tables have no
  -- audit trigger. The signed amr claim keeps such a session's last token out of app.salon_me too.
  update auth.users set encrypted_password = '' where id = v_uid and coalesce(encrypted_password, '') <> '';
  delete from auth.sessions s where s.user_id = v_uid and s.id is distinct from nullif(auth.jwt() ->> 'session_id', '')::uuid;
  return jsonb_build_object('kind', i.kind);
end $$;

-- ----------------------------------------------------------------- member status ----
-- D-39: the owner or a manager suspends and reactivates reps, and suspends, reactivates and revokes salon
-- accounts. Staff who are not reps are not reachable here (owner: app.owner_set_status). Offboarding and
-- role changes stay with the owner. The target row is locked before its state is read (the B-34 lesson).
-- The same status again changes nothing. A suspended rep's devices are revoked at once, as in
-- app.owner_set_status (SEC-04, SEC-08); a reactivated rep's phone asks for approval again.
create function app.office_set_member_status(p_kind text, p_member_id uuid, p_status text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_office();
  u      public.user_profile;
  m      public.salon_membership;
begin
  perform app.assert_reason(p_reason);
  if p_kind = 'rep' then
    if p_status = 'offboarded' then perform app.raise_denied('offboarding stays with the owner'); end if;
    if p_status is distinct from 'active' and p_status is distinct from 'suspended' then
      raise exception using errcode = '22023', message = 'a rep is set active or suspended';
    end if;
    select * into u from public.user_profile x where x.id = p_member_id for update;
    if u.id is null then raise exception using errcode = '22023', message = 'unknown rep'; end if;
    if u.role <> 'rep' then perform app.raise_denied('only reps change status here; the owner manages owners and managers'); end if;
    if u.status = 'offboarded' then
      raise exception using errcode = '55000', message = 'offboarding is final; a person who returns gets a new account';
    end if;
    if u.status::text = p_status then return jsonb_build_object('id', u.id, 'status', u.status); end if;   -- replay
    perform app.set_purpose('set status: ' || p_reason);
    update public.user_profile set status = p_status::public.user_status where id = u.id returning * into u;
    if p_status = 'suspended' then
      update public.device
         set status = 'revoked', revoked_by = auth.uid(), revoked_at = now()
       where user_id = u.id and status <> 'revoked';
    end if;
    return jsonb_build_object('id', u.id, 'status', u.status);
  end if;
  if p_kind is distinct from 'salon' then
    raise exception using errcode = '22023', message = 'a member is a rep or a salon account';
  end if;
  if p_status is null or p_status not in ('active', 'suspended', 'revoked') then
    raise exception using errcode = '22023', message = 'a salon account is set active, suspended or revoked';
  end if;
  select * into m from public.salon_membership x where x.id = p_member_id for update;
  if m.id is null then raise exception using errcode = '22023', message = 'unknown salon account'; end if;
  if m.status::text = p_status then return jsonb_build_object('id', m.id, 'status', m.status); end if;     -- replay
  if m.status = 'revoked' then
    raise exception using errcode = '55000', message = 'a revoked salon account is final; invite the salon again';
  end if;
  perform app.set_purpose('set salon account status: ' || p_reason);
  update public.salon_membership
     set status = p_status::public.membership_status, status_by = auth.uid(), status_reason = left(p_reason, 300)
   where id = m.id returning * into m;
  return jsonb_build_object('id', m.id, 'status', m.status);
end $$;

-- ------------------------------------------------------------------ salon account ----
-- The caller's own active salon account, allow-listed fields only (spec section 4); null when there is
-- none. It takes no id: the membership decides. A suspended or revoked account reads null at once.
create function app.salon_me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', s.name, 'address', s.address, 'approval_status', s.approval_status,
                            'membership_status', m.status)
  from public.salon_membership m
  join public.salon s on s.id = m.salon_id
  where m.user_id = auth.uid() and m.status = 'active' and app.session_proved_email()
$$;

-- ------------------------------------------------------------- salon decisions ----
-- D-35, D-36: the owner or a manager approves a pending salon, optionally with a rep and a rate, or
-- rejects it with a reason of 5 to 500 characters. A salon is decided once, so a rejected proposal is
-- final and the rep proposes again. The salon row is locked, so two decisions take turns.
create function app.office_decide_salon(
  p_client_id uuid, p_salon_id uuid, p_approve boolean, p_reason text,
  p_rep_id uuid default null, p_rate_bp integer default null)
returns public.salon_approval_decision
language plpgsql security definer set search_path = '' as $$
declare
  v_role     public.app_role := app.assert_office();
  v_decision public.salon_approval := case when p_approve then 'approved' else 'rejected' end::public.salon_approval;
  v_reason   text := app.blank_to_null(p_reason);
  v_status   public.salon_approval;
  d          public.salon_approval_decision;
begin
  if p_client_id is null or p_approve is null then
    raise exception using errcode = '22023', message = 'a decision needs a client_id (idempotency key, H-08) and an answer';
  end if;
  select * into d from public.salon_approval_decision x where x.client_id = p_client_id;
  if d.id is not null then
    if d.decided_by = auth.uid() and d.salon_id = p_salon_id and d.decision = v_decision then return d; end if;   -- replay
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if not p_approve and (v_reason is null or length(v_reason) not between 5 and 500) then
    raise exception using errcode = '22023', message = 'a rejection needs a reason of 5 to 500 characters';
  end if;
  if p_approve and length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'a reason is at most 500 characters';
  end if;
  if not p_approve and (p_rep_id is not null or p_rate_bp is not null) then
    raise exception using errcode = '22023', message = 'a rejected salon gets no rep or rate';
  end if;
  perform app.assert_assignment_rate(p_rep_id, p_rate_bp);
  if p_rep_id is not null then perform app.assert_assignable_rep(p_rep_id); end if;
  select s.approval_status into v_status from public.salon s where s.id = p_salon_id for update;
  if not found then raise exception using errcode = '22023', message = 'unknown salon'; end if;
  if v_status <> 'pending' then
    raise exception using errcode = '55000', message = format('this salon is already %s', v_status);
  end if;
  perform app.set_purpose('salon ' || v_decision::text);
  insert into public.salon_approval_decision (client_id, salon_id, decision, reason, decided_by)
  values (p_client_id, p_salon_id, v_decision, v_reason, auth.uid())
  returning * into d;
  update public.salon set approval_status = v_decision where id = p_salon_id;
  if p_rep_id is not null then
    insert into public.salon_rep_assignment (client_id, salon_id, rep_id, rate_bp, assigned_by)
    values (gen_random_uuid(), p_salon_id, p_rep_id, p_rate_bp, auth.uid());
  end if;
  return d;
end $$;

-- D-36: only the office assigns or changes a salon's rep. The latest row wins; a null rep clears it, back
-- to territory coverage. The salon row is locked, so the row order is the order the changes committed.
create function app.office_assign_salon_rep(
  p_client_id uuid, p_salon_id uuid, p_rep_id uuid, p_rate_bp integer default null)
returns public.salon_rep_assignment
language plpgsql security definer set search_path = '' as $$
declare
  v_role   public.app_role := app.assert_office();
  v_status public.salon_approval;
  r        public.salon_rep_assignment;
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'an assignment needs a client_id (idempotency key, H-08)';
  end if;
  select * into r from public.salon_rep_assignment x where x.client_id = p_client_id;
  if r.id is not null then
    if r.assigned_by = auth.uid() and r.salon_id = p_salon_id and r.rep_id is not distinct from p_rep_id
       and r.rate_bp is not distinct from p_rate_bp then
      return r;                                                                -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  perform app.assert_assignment_rate(p_rep_id, p_rate_bp);
  if p_rep_id is not null then perform app.assert_assignable_rep(p_rep_id); end if;
  select s.approval_status into v_status from public.salon s where s.id = p_salon_id for update;
  if not found then raise exception using errcode = '22023', message = 'unknown salon'; end if;
  if v_status <> 'approved' then
    raise exception using errcode = '55000', message = format('this salon is %s: decide it first', v_status);
  end if;
  perform app.set_purpose('salon rep assigned');
  insert into public.salon_rep_assignment (client_id, salon_id, rep_id, rate_bp, assigned_by)
  values (p_client_id, p_salon_id, p_rep_id, p_rate_bp, auth.uid())
  returning * into r;
  return r;
end $$;

-- The approvals queue: pending salons, oldest first, up to 200, with who proposed each.
create function app.office_pending_salons()
returns table (salon_id uuid, name text, type public.salon_type, address text, lat numeric, lng numeric,
               area_name text, territory_name text, proposed_by_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
  select s.id, s.name, s.type, s.address, s.lat, s.lng, a.name, t.name, u.full_name, s.created_at
  from public.salon s
  join public.area a on a.id = s.area_id
  join public.territory t on t.id = a.territory_id
  join public.user_profile u on u.id = s.created_by
  where s.approval_status = 'pending'
  order by s.created_at, s.id
  limit 200;
end $$;

-- ----------------------------------------------------------------- function privileges ----
-- Internal helpers: no grant to any role.
revoke execute on function
  app.session_proved_email(), app.invitation_hash(text), app.invitation_state(public.invitation),
  app.salon_direct_rep(uuid), app.assert_assignable_rep(uuid), app.assert_assignment_rate(uuid, integer),
  app.assert_salon_approved(uuid)
  from public, anon, authenticated, service_role;

revoke all on function
  app.office_invite(uuid, text, text, text, uuid, uuid, text, public.salon_type, uuid),
  app.office_invitations(), app.office_revoke_invitation(uuid, text),
  app.invitation_preview(text), app.redeem_invitation(text),
  app.office_set_member_status(text, uuid, text, text), app.salon_me(),
  app.office_decide_salon(uuid, uuid, boolean, text, uuid, integer),
  app.office_assign_salon_rep(uuid, uuid, uuid, integer), app.office_pending_salons()
  from public, anon, authenticated, service_role;
grant execute on function
  app.office_invite(uuid, text, text, text, uuid, uuid, text, public.salon_type, uuid),
  app.office_invitations(), app.office_revoke_invitation(uuid, text),
  app.invitation_preview(text), app.redeem_invitation(text),
  app.office_set_member_status(text, uuid, text, text), app.salon_me(),
  app.office_decide_salon(uuid, uuid, boolean, text, uuid, integer),
  app.office_assign_salon_rep(uuid, uuid, uuid, integer), app.office_pending_salons()
  to authenticated;
