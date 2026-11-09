-- =============================================================================
-- Kiran DMS · migration 20261109200000 · Salon self-signup
-- MJ's decision of 2026-11-09 (docs/log/2026-11-09-mj-salon-self-signup.md) reverses L-0376 for salons:
-- a salon may sign up on its own. Reps stay invitation-only (app.office_invite, unchanged). Requirements:
-- SEC-13, SAL-11, SAL-13, SAL-14; doc 06 section 2.1; D-35, D-39.
--
-- What is built:
--   * public.salon_signup_request: what a self-signing salon tells us. NOT a public.salon row: a salon row
--     needs a staff creator (created_by) and an area, and a pending row would enter rep territory and
--     route logic. The request holds the applicant's login, name, salon name, type and address, and moves
--     once, from pending to approved or rejected.
--   * app.salon_apply: the applicant's one call, from a session that proved its email with the emailed
--     code (the same proof as app.redeem_invitation). It makes a request and nothing else: no user_profile,
--     no salon, no membership, no price, no order. The login is then reachable only through the emailed
--     code (the password-squatter defence of app.redeem_invitation).
--   * app.office_pending_signups, app.office_decide_signup: the office (owner or manager, AAL2, D-39) lists
--     requests and decides each once. Approving creates the real salon through app.create_salon (the
--     office picks the area) or attaches the login to an existing approved salon that has no account, then
--     creates the salon_membership, with an optional rep and rate as app.office_decide_salon does.
--     Rejecting needs a reason of at least 5 characters.
--   * public.salon_membership: invitation_id may now be null when signup_request_id is set, exactly one of
--     the two. Everything else about a membership is unchanged (one login per salon, one salon per login).
--   * app.salon_login_status: also tells an applicant whose request is waiting or rejected so, and nothing
--     else. app.salon_me is unchanged: it answers only for an active membership.
--
-- What a request gives its applicant: nothing but the answer 'applied' or 'application_rejected' from
-- app.salon_login_status.
-- The catalogue, prices, orders and documents are reached only through an active salon_membership
-- (migrations 20261105110000, 20261105150000), which exists only after the office approves.
-- =============================================================================

-- ------------------------------------------------------------------- request ----
create table public.salon_signup_request (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null unique,                          -- idempotency key from the page (H-08)
  user_id            uuid not null unique references auth.users (id),   -- one request per login, ever
  email              text not null check (email = lower(btrim(email)) and length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  contact_name       text not null check (length(btrim(contact_name)) between 2 and 120),
  salon_name         text not null check (length(btrim(salon_name)) between 2 and 120),
  type               public.salon_type not null,
  address            text not null check (length(btrim(address)) between 5 and 300),
  status             public.salon_approval not null default 'pending',
  created_at         timestamptz not null default now(),
  decision_client_id uuid unique,                                   -- idempotency key of the office's decision (H-08)
  decided_by         uuid references public.user_profile (id),
  decided_at         timestamptz,
  reason             text check (length(reason) <= 500),
  salon_id           uuid references public.salon (id),
  constraint salon_signup_decided_shape
    check ((status = 'pending') = (decided_by is null and decided_at is null and decision_client_id is null)),
  constraint salon_signup_approved_salon check ((status = 'approved') = (salon_id is not null)),
  constraint salon_signup_reject_reason check (status <> 'rejected' or length(btrim(coalesce(reason, ''))) >= 5)
);
create index salon_signup_request_pending_idx on public.salon_signup_request (created_at) where status = 'pending';
comment on table public.salon_signup_request is
  'MJ 2026-11-09 (self-signup). A salon''s own application for an account. Facts are fixed; the status moves once, from pending to approved or rejected, only through app.office_decide_signup. Not exposed through the API: the office lists it with app.office_pending_signups, the applicant reads only the answer from app.salon_login_status.';

-- ---------------------------------------------------------------- membership ----
alter table public.salon_membership alter column invitation_id drop not null;
alter table public.salon_membership add column signup_request_id uuid unique references public.salon_signup_request (id);
alter table public.salon_membership add constraint salon_membership_one_source
  check ((invitation_id is null) <> (signup_request_id is null));
comment on column public.salon_membership.signup_request_id is
  'Set when the login came from a self-signup approved by the office (app.office_decide_signup); then invitation_id is null. Exactly one of the two is set.';

-- Migration 20261105100000's guard, plus signup_request_id in the identity that cannot change.
create or replace function control.salon_membership_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'memberships are revoked, never deleted (H-07)';
  end if;
  if (new.id, new.user_id, new.salon_id, new.invitation_id, new.signup_request_id, new.full_name, new.email, new.created_at)
     is distinct from
     (old.id, old.user_id, old.salon_id, old.invitation_id, old.signup_request_id, old.full_name, old.email, old.created_at) then
    raise exception using errcode = '42501', message = 'a membership''s identity is immutable';
  end if;
  if old.status = 'revoked' then
    raise exception using errcode = '42501', message = 'a revoked membership is final';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ------------------------------------------------------------------- guards ----
-- Facts are fixed; the status moves once, from pending. Like control.invitation_guard.
create function control.salon_signup_request_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'signup requests are decided, never deleted (H-07)';
  end if;
  if (new.id, new.client_id, new.user_id, new.email, new.contact_name, new.salon_name, new.type, new.address, new.created_at)
     is distinct from
     (old.id, old.client_id, old.user_id, old.email, old.contact_name, old.salon_name, old.type, old.address, old.created_at) then
    raise exception using errcode = '42501', message = 'a signup request''s facts are immutable';
  end if;
  if old.status <> 'pending' or new.status = 'pending' then
    raise exception using errcode = '42501', message = 'a signup request is decided once, from pending to approved or rejected';
  end if;
  return new;
end $$;

create trigger salon_signup_request_guard before update or delete on public.salon_signup_request
  for each row execute function control.salon_signup_request_guard();
create trigger no_truncate before truncate on public.salon_signup_request
  for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on public.salon_signup_request
  for each row execute function control.audit_row();

-- ---------------------------------------------------------------------- RLS -----
alter table public.salon_signup_request enable row level security;
alter table public.salon_signup_request force  row level security;
-- No policy and no grant: nobody reads the table through the API, not even the office (like
-- public.invitation). The office lists it with app.office_pending_signups; the applicant reads only
-- the answer from app.salon_login_status.
revoke all on public.salon_signup_request from public, anon, authenticated, service_role;
revoke execute on function control.salon_signup_request_guard() from public, anon, authenticated, service_role;

-- --------------------------------------------------------------------- apply ----
-- The applicant's one call. Same proof as app.redeem_invitation: a session that signed in with the
-- emailed code, on an address GoTrue confirmed. Refused when the login is already staff, already a salon
-- account, already applied, or holds a live invitation (the invitation link is the way in then).
-- Idempotent on p_client_id. Never makes a user_profile (reps are invitation-only).
create function app.salon_apply(p_client_id uuid, p_salon_name text, p_contact_name text, p_type public.salon_type, p_address text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := auth.uid();
  v_email     text;
  v_confirmed timestamptz;
  v_salon     text := app.blank_to_null(p_salon_name);
  v_contact   text := app.blank_to_null(p_contact_name);
  v_address   text := app.blank_to_null(p_address);
  r           public.salon_signup_request;
begin
  if v_uid is null or not app.session_proved_email() then
    perform app.raise_denied('sign in with the emailed code to sign up');
  end if;
  if p_client_id is null or p_type is null then
    raise exception using errcode = '22023', message = 'a signup needs a client_id (idempotency key, H-08) and a salon type';
  end if;
  if v_salon is null or length(v_salon) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'the salon name is 2 to 120 characters';
  end if;
  if v_contact is null or length(v_contact) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'your name is 2 to 120 characters';
  end if;
  if v_address is null or length(v_address) not between 5 and 300 then
    raise exception using errcode = '22023', message = 'the address is 5 to 300 characters';
  end if;
  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = v_uid;
  if v_email is null or v_confirmed is null then
    raise exception using errcode = '22023', message = 'this login has no confirmed email address';
  end if;
  select * into r from public.salon_signup_request x where x.user_id = v_uid for update;
  if r.id is not null then
    if r.client_id = p_client_id and r.salon_name = v_salon and r.contact_name = v_contact and r.type = p_type
       and r.address = v_address then
      return jsonb_build_object('status', r.status);                                   -- replay
    end if;
    raise exception using errcode = '55000', message = 'this login has already applied for an account';
  end if;
  if exists (select 1 from public.salon_signup_request x where x.client_id = p_client_id) then
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if exists (select 1 from public.user_profile p where p.id = v_uid) then
    raise exception using errcode = '55000', message = 'this login already has a staff account';
  end if;
  if exists (select 1 from public.salon_membership m where m.user_id = v_uid and m.status <> 'revoked') then
    raise exception using errcode = '55000', message = 'this login already belongs to a salon account';
  end if;
  if exists (select 1 from public.invitation i where i.email = v_email and i.status = 'pending' and i.expires_at > now()) then
    raise exception using errcode = '55000', message = 'this email address has an invitation; open the invitation link instead';
  end if;
  perform app.set_purpose('salon signup');
  insert into public.salon_signup_request (client_id, user_id, email, contact_name, salon_name, type, address)
  values (p_client_id, v_uid, v_email, v_contact, v_salon, p_type, v_address)
  returning * into r;
  -- From here on the emailed code is the only way into this login (see app.redeem_invitation): a
  -- password set on this address by someone else is cleared and any session that did not prove the
  -- mailbox is ended. Auth tables have no audit trigger, so this is not audited.
  update auth.users set encrypted_password = '' where id = v_uid and coalesce(encrypted_password, '') <> '';
  delete from auth.sessions s where s.user_id = v_uid and s.id is distinct from nullif(auth.jwt() ->> 'session_id', '')::uuid;
  return jsonb_build_object('status', r.status);
end $$;

-- ------------------------------------------------------------------- the queue ----
-- Pending requests, oldest first, up to 200. similar_salons: approved salons with the same name that have
-- no account yet, so the office can attach the login to the imported salon instead of making a second one.
create function app.office_pending_signups()
returns table (request_id uuid, salon_name text, contact_name text, email text, type public.salon_type,
               address text, created_at timestamptz, similar_salons jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
  select r.id, r.salon_name, r.contact_name, r.email, r.type, r.address, r.created_at,
         coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'area_name', a.name) order by x.created_at)
                   from (select s.id, s.name, s.area_id, s.created_at
                         from public.salon s
                         where s.approval_status = 'approved'
                           and lower(btrim(s.name)) = lower(btrim(r.salon_name))
                           and not exists (select 1 from public.salon_membership m where m.salon_id = s.id and m.status <> 'revoked')
                         order by s.created_at limit 5) x
                   join public.area a on a.id = x.area_id), '[]'::jsonb)
  from public.salon_signup_request r
  where r.status = 'pending'
  order by r.created_at, r.id
  limit 200;
end $$;

-- ---------------------------------------------------------------- the decision ----
-- Approve: pick an area (a new salon is made through app.create_salon, approved, source manual) or an
-- existing approved salon without an account (attach); never both. An optional rep and rate follow
-- app.office_decide_salon. Reject: a reason of at least 5 characters. A request is decided once; the same
-- p_client_id with the same content returns the same answer (H-08).
create function app.office_decide_signup(
  p_client_id uuid, p_request_id uuid, p_approve boolean, p_reason text,
  p_area_id uuid default null, p_existing_salon_id uuid default null,
  p_rep_id uuid default null, p_rate_bp integer default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role     public.app_role := app.assert_office();
  v_status   public.salon_approval := case when p_approve then 'approved' else 'rejected' end::public.salon_approval;
  v_reason   text := app.blank_to_null(p_reason);
  v_salon_id uuid;
  v_sstatus  public.salon_approval;
  q          public.salon_signup_request;
begin
  if p_client_id is null or p_request_id is null or p_approve is null then
    raise exception using errcode = '22023', message = 'a decision needs a client_id (idempotency key, H-08), a request and an answer';
  end if;
  select * into q from public.salon_signup_request x where x.decision_client_id = p_client_id;
  if q.id is not null then
    if q.id = p_request_id and q.decided_by = auth.uid() and q.status = v_status then
      return jsonb_build_object('request_id', q.id, 'status', q.status, 'salon_id', q.salon_id);   -- replay
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if not p_approve and (v_reason is null or length(v_reason) not between 5 and 500) then
    raise exception using errcode = '22023', message = 'a rejection needs a reason of 5 to 500 characters';
  end if;
  if p_approve and length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'a reason is at most 500 characters';
  end if;
  if not p_approve and (p_area_id is not null or p_existing_salon_id is not null or p_rep_id is not null or p_rate_bp is not null) then
    raise exception using errcode = '22023', message = 'a rejected request gets no area, salon, rep or rate';
  end if;
  if p_approve and ((p_area_id is null) = (p_existing_salon_id is null)) then
    raise exception using errcode = '22023', message = 'approving needs an area for a new salon, or an existing salon to attach, not both';
  end if;
  perform app.assert_assignment_rate(p_rep_id, p_rate_bp);
  if p_rep_id is not null then perform app.assert_assignable_rep(p_rep_id); end if;
  select * into q from public.salon_signup_request x where x.id = p_request_id for update;
  if q.id is null then raise exception using errcode = '22023', message = 'unknown signup request'; end if;
  if q.status <> 'pending' then
    raise exception using errcode = '55000', message = format('this request is already %s', q.status);
  end if;
  if not p_approve then
    perform app.set_purpose('salon signup rejected');
    update public.salon_signup_request
       set status = 'rejected', decision_client_id = p_client_id, decided_by = auth.uid(), decided_at = now(), reason = v_reason
     where id = q.id returning * into q;
    return jsonb_build_object('request_id', q.id, 'status', q.status, 'salon_id', null);
  end if;
  -- Approve. The login must still be nobody else's.
  if exists (select 1 from public.user_profile p where p.id = q.user_id) then
    raise exception using errcode = '55000', message = 'this login has become a staff account; reject the request';
  end if;
  if exists (select 1 from public.salon_membership m where m.user_id = q.user_id and m.status <> 'revoked') then
    raise exception using errcode = '55000', message = 'this login already belongs to a salon account; reject the request';
  end if;
  if p_existing_salon_id is not null then
    select s.approval_status into v_sstatus from public.salon s where s.id = p_existing_salon_id for update;
    if not found then raise exception using errcode = '22023', message = 'unknown salon'; end if;
    if v_sstatus <> 'approved' then
      raise exception using errcode = '55000', message = format('this salon is %s: decide it first', v_sstatus);
    end if;
    if exists (select 1 from public.salon_membership m where m.salon_id = p_existing_salon_id and m.status <> 'revoked') then
      raise exception using errcode = '55000', message = 'this salon already has an account (one login per salon)';
    end if;
    v_salon_id := p_existing_salon_id;
  else
    v_salon_id := (app.create_salon(gen_random_uuid(), q.salon_name, q.type, p_area_id, 'manual', q.address)).id;
  end if;
  perform app.set_purpose('salon signup approved');
  insert into public.salon_membership (user_id, salon_id, signup_request_id, full_name, email)
  values (q.user_id, v_salon_id, q.id, q.contact_name, q.email);
  if p_rep_id is not null then
    insert into public.salon_rep_assignment (client_id, salon_id, rep_id, rate_bp, assigned_by)
    values (gen_random_uuid(), v_salon_id, p_rep_id, p_rate_bp, auth.uid());
  end if;
  update public.salon_signup_request
     set status = 'approved', decision_client_id = p_client_id, decided_by = auth.uid(), decided_at = now(),
         reason = v_reason, salon_id = v_salon_id
   where id = q.id returning * into q;
  return jsonb_build_object('request_id', q.id, 'status', q.status, 'salon_id', q.salon_id);
end $$;

-- ------------------------------------------------------------------ login status ----
-- Migration 20261105230000's app.salon_login_status (AUTH-09), plus: an applicant whose request is waiting
-- or was rejected reads 'applied' or 'application_rejected' and the salon name they gave, nothing else (the
-- office's reason is never shown). app.salon_me is unchanged: it answers only for an active membership,
-- which is why the portal page, which loads the catalogue and orders once salon_me answers, never opens
-- for an applicant. An approved request has a membership, which the first branch answers.
create or replace function app.salon_login_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('membership_status', m.status, 'name', s.name)
     from public.salon_membership m
     join public.salon s on s.id = m.salon_id
     where m.user_id = auth.uid() and app.session_proved_email()
     order by (m.status = 'active') desc, m.created_at desc
     limit 1),
    (select jsonb_build_object('membership_status',
                               case r.status when 'pending' then 'applied' else 'application_rejected' end,
                               'name', r.salon_name)
     from public.salon_signup_request r
     where r.user_id = auth.uid() and r.status <> 'approved' and app.session_proved_email()))
$$;

-- ----------------------------------------------------------------- function privileges ----
revoke all on function
  app.salon_apply(uuid, text, text, public.salon_type, text),
  app.office_pending_signups(),
  app.office_decide_signup(uuid, uuid, boolean, text, uuid, uuid, uuid, integer),
  app.salon_login_status()
  from public, anon, authenticated, service_role;
grant execute on function
  app.salon_apply(uuid, text, text, public.salon_type, text),
  app.office_pending_signups(),
  app.office_decide_signup(uuid, uuid, boolean, text, uuid, uuid, uuid, integer),
  app.salon_login_status()
  to authenticated;
