-- =============================================================================
-- Kiran DMS · migration 0001 · Foundation (task P1-01)
-- Requirements: SEC-01, SEC-03 (device binding), SEC-04 (revocation), SEC-05,
--               SEC-07 (deny by default), SEC-11 (maker ≠ checker), SEC-12 (audit),
--               ADM-01 (config, owner-only), ADM-03 (gapless numbering)
-- Docs: 04 (domain model, invariants), 06 (§2 matrix, §4 RLS, §6 audit), 13 (§9)
--
-- Conventions used by every later migration:
--   * every table: ENABLE + FORCE row level security in the migration that creates it;
--   * application roles (anon, authenticated) get no INSERT/UPDATE/DELETE on business
--     tables — writes go through SECURITY DEFINER functions in schema `app` with
--     `set search_path = ''` and fully-qualified names;
--   * office access (owner/manager) requires an AAL2 (TOTP-verified) session at the
--     database, not only in the UI (SEC-02, doc 06 §3);
--   * every audited table gets control.audit_row(); append-only tables additionally get
--     control.forbid_mutation() (doc 04 invariant 1, H-06).
-- =============================================================================

-- ---------------------------------------------------------------- schemas ----
create schema if not exists app;            -- RPC write path + RLS helper functions
create schema if not exists control;        -- approvals, audit, counters (doc 04 control zone)
create schema if not exists vault_api;      -- grant-checked functions over supplier_vault (P1-05)
create schema if not exists supplier_vault; -- classified supplier data (doc 07). Named
                                            -- supplier_vault because Supabase already owns
                                            -- schema `vault` (supabase_vault). See doc 12 D-13.

revoke all on schema app, control, vault_api, supplier_vault from public;
revoke all on schema supplier_vault from anon, authenticated, service_role;
grant usage on schema app to authenticated;
grant usage on schema control to authenticated;   -- RLS still decides every row
grant usage on schema control to service_role;    -- read-only grants below (Edge Functions, H-18)
grant usage on schema vault_api to authenticated;

alter default privileges in schema app      revoke execute on functions from public;
alter default privileges in schema control  revoke execute on functions from public;
alter default privileges in schema vault_api revoke execute on functions from public;

-- ------------------------------------------------------------------ types ----
create type public.app_role       as enum ('owner', 'manager', 'rep');
create type public.user_status    as enum ('active', 'suspended', 'offboarded');
create type public.device_status  as enum ('pending', 'approved', 'revoked');
create type public.approval_kind  as enum (
  'discount', 'credit_override', 'adjustment', 'write_off', 'credit_note', 'return_accept',
  'payment_reversal', 'device_approve', 'unblock', 'cancel_order', 'restructure', 'stage_override');
create type public.approval_status as enum ('pending', 'approved', 'rejected', 'cancelled');

-- ----------------------------------------------------------------- tables ----
create table public.user_profile (
  id                 uuid primary key references auth.users (id),
  full_name          text not null check (length(btrim(full_name)) between 2 and 120),
  role               public.app_role not null,
  phone              text check (phone ~ '^\+?[0-9]{10,15}$'),
  status             public.user_status not null default 'active',
  start_date         date,
  commission_plan_id uuid,                      -- FK added with commission plans (Phase 2)
  vault_grant        boolean not null default false,
  created_by         uuid references public.user_profile (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint vault_grant_office_only check (vault_grant = false or role in ('owner', 'manager'))
);
comment on table public.user_profile is
  'One row per login. Role is read by app.user_role() for RLS; never trusted from the client. Writes: owner-only functions (doc 06 §2).';

create table public.device (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.user_profile (id),
  device_fingerprint text not null check (length(device_fingerprint) between 16 and 200),
  platform           text check (length(platform) <= 60),
  label              text check (length(label) <= 80),
  status             public.device_status not null default 'pending',
  approved_by        uuid references public.user_profile (id),
  approved_at        timestamptz,
  revoked_by         uuid references public.user_profile (id),
  revoked_at         timestamptz,
  last_seen_at       timestamptz,
  created_at         timestamptz not null default now(),
  unique (user_id, device_fingerprint),
  constraint device_not_self_approved check (approved_by is null or approved_by <> user_id),
  constraint device_status_fields check (
    (status = 'pending'  and approved_at is null) or
    (status = 'approved' and approved_by is not null and approved_at is not null) or
    (status = 'revoked'  and revoked_at is not null))
);
-- SEC-03 / doc 06 §3: max one active device per user by default.
create unique index device_one_approved_per_user on public.device (user_id) where status = 'approved';

create table public.app_config (
  key         text primary key check (key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
  value       jsonb not null,
  rep_visible boolean not null default false,
  note        text,
  updated_by  uuid references public.user_profile (id),
  updated_at  timestamptz not null default now()
);
comment on table public.app_config is
  'Owner-only configuration (ADM-01, doc 06 §2 governance). Values marked [default-unconfirmed] await MJ (A-01, B-05).';

create table control.approval_request (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null unique,      -- idempotency key from the caller (H-08)
  kind                  public.approval_kind not null,
  subject_type          text not null check (subject_type ~ '^[a-z_]+$'),
  subject_id            uuid,
  payload               jsonb not null default '{}'::jsonb,
  maker_id              uuid not null references public.user_profile (id),
  checker_role_required public.app_role not null check (checker_role_required in ('manager', 'owner')),
  checker_id            uuid references public.user_profile (id),
  status                public.approval_status not null default 'pending',
  reason                text not null check (length(btrim(reason)) >= 3),
  decision_reason       text,
  created_at            timestamptz not null default now(),
  decided_at            timestamptz,
  -- SEC-11 / H-12: the maker can never be the checker — enforced by the database.
  constraint approval_maker_ne_checker check (checker_id is null or checker_id <> maker_id),
  constraint approval_decision_shape check (
    (status = 'pending'   and checker_id is null     and decided_at is null) or
    (status in ('approved', 'rejected') and checker_id is not null and decided_at is not null
                          and length(btrim(coalesce(decision_reason, ''))) >= 3) or
    (status = 'cancelled' and checker_id is null     and decided_at is not null))
);
create index approval_request_pending_idx on control.approval_request (status, checker_role_required) where status = 'pending';

create table control.audit_chain_head (
  id        smallint primary key check (id = 1),
  last_seq  bigint not null,
  last_hash text   not null
);
insert into control.audit_chain_head (id, last_seq, last_hash) values (1, 0, repeat('0', 64));

create table control.audit_event (
  seq         bigint primary key,
  occurred_at timestamptz not null,
  actor_id    uuid,
  actor_role  text,
  db_role     text,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name  text not null,
  row_id      text,
  before      jsonb,
  after       jsonb,
  ip          text,
  device_id   text,
  purpose     text,
  prev_hash   text not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  hash        text not null unique check (hash ~ '^[0-9a-f]{64}$')
);
comment on table control.audit_event is
  'Tamper-evident audit chain (SEC-05, SEC-12). Written only by control.audit_row(); hash = sha256(prev_hash || canonical row). No role may insert, update or delete.';

create table control.doc_counter (
  doc_type text     not null check (doc_type in ('INV', 'R', 'CN', 'WO')),
  fy       smallint not null check (fy between 0 and 99),
  last_no  bigint   not null check (last_no > 0),
  primary key (doc_type, fy)
);
comment on table control.doc_counter is 'Gapless numbering per financial year (1 July–30 June), ADM-03 / H-11.';

-- --------------------------------------------------- RLS helper functions ----
-- app.user_role(): the caller's role, read from the database (doc 06 §4).
-- (Named user_role, not current_role: CURRENT_ROLE is a reserved SQL keyword.)
create function app.user_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.user_profile p
  where p.id = auth.uid() and p.status = 'active'
$$;

create function app.is_aal2() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- Office access requires an MFA-verified session (SEC-02): no AAL2, no office powers.
create function app.is_office() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(app.user_role() in ('owner', 'manager'), false) and app.is_aal2()
$$;

create function app.is_owner() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(app.user_role() = 'owner', false) and app.is_aal2()
$$;

create function app.is_rep() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(app.user_role() = 'rep', false)
$$;

-- VLT-06: vault access is an explicit, revocable grant (default on for owner/manager),
-- and every vault call also needs AAL2 (doc 07 §2).
create function app.has_vault_grant() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_profile p
    where p.id = auth.uid() and p.status = 'active'
      and p.role in ('owner', 'manager') and p.vault_grant
  ) and app.is_aal2()
$$;

-- Device id the client sends on every request (header x-kiran-device).
create function app.request_device_id() returns text
language plpgsql stable set search_path = '' as $$
declare v jsonb;
begin
  begin
    v := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  return v ->> 'x-kiran-device';
end $$;

-- Device gate (doc 04 invariant 7): reps act only from their approved device.
create function app.rep_device_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when app.user_role() is distinct from 'rep' then true
    else exists (
      select 1 from public.device d
      where d.user_id = auth.uid() and d.status = 'approved'
        and d.device_fingerprint = app.request_device_id())
  end
$$;

create function app.raise_denied(p_msg text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = p_msg;
end $$;

-- Common precondition for every write function: active profile, office sessions at
-- AAL2, reps on their approved device.
create function app.assert_actor_ready() returns public.app_role
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.app_role := app.user_role();
begin
  if v_role is null then
    perform app.raise_denied('no active user profile for this session');
  end if;
  if v_role in ('owner', 'manager') and not app.is_aal2() then
    perform app.raise_denied('office actions require an MFA-verified (AAL2) session');
  end if;
  if v_role = 'rep' and not app.rep_device_ok() then
    perform app.raise_denied('this device is not approved for this rep');
  end if;
  return v_role;
end $$;

create function app.assert_office() returns public.app_role
language plpgsql stable set search_path = '' as $$
declare v_role public.app_role := app.assert_actor_ready();
begin
  if v_role not in ('owner', 'manager') then
    perform app.raise_denied('owner or manager only');
  end if;
  return v_role;
end $$;

create function app.assert_owner() returns void
language plpgsql stable set search_path = '' as $$
begin
  if app.assert_actor_ready() <> 'owner' then
    perform app.raise_denied('owner only (governance power, doc 06 §2)');
  end if;
end $$;

-- Purpose string carried into the audit row of the current transaction.
create function app.set_purpose(p_purpose text) returns void
language sql set search_path = '' as $$
  select set_config('app.purpose', left(coalesce(p_purpose, ''), 500), true);
$$;

-- -------------------------------------------------------- audit machinery ----
create function control.audit_canonical(
  p_seq bigint, p_occurred_at timestamptz, p_actor_id uuid, p_actor_role text, p_db_role text,
  p_action text, p_table_name text, p_row_id text, p_before jsonb, p_after jsonb,
  p_ip text, p_device_id text, p_purpose text) returns text
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'seq', p_seq,
    'at', to_char(p_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actor', p_actor_id, 'actor_role', p_actor_role, 'db_role', p_db_role,
    'action', p_action, 'table', p_table_name, 'row', p_row_id,
    'before', p_before, 'after', p_after,
    'ip', p_ip, 'device', p_device_id, 'purpose', p_purpose)::text
$$;

create function control.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_before  jsonb;
  v_after   jsonb;
  v_row_id  text;
  v_seq     bigint;
  v_prev    text;
  v_hash    text;
  v_at      timestamptz := clock_timestamp();
  v_hdrs    jsonb;
  v_actor   uuid := auth.uid();
  v_arole   text := app.user_role()::text;
  v_dbrole  text := coalesce(auth.jwt() ->> 'role', session_user::text);
  v_ip      text;
  v_device  text;
  v_purpose text := nullif(current_setting('app.purpose', true), '');
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after  := to_jsonb(new); end if;
  v_row_id := coalesce(v_after ->> 'id', v_before ->> 'id', v_after ->> 'key', v_before ->> 'key');
  begin
    v_hdrs := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_hdrs := null;
  end;
  v_ip := split_part(coalesce(v_hdrs ->> 'x-forwarded-for', ''), ',', 1);
  v_ip := nullif(btrim(v_ip), '');
  v_device := v_hdrs ->> 'x-kiran-device';

  -- Serialise the chain: one writer at a time extends it.
  select h.last_seq, h.last_hash into v_seq, v_prev
  from control.audit_chain_head h where h.id = 1 for update;
  v_seq := v_seq + 1;

  v_hash := encode(sha256(convert_to(v_prev || control.audit_canonical(
    v_seq, v_at, v_actor, v_arole, v_dbrole, tg_op, tg_table_schema || '.' || tg_table_name, v_row_id,
    v_before, v_after, v_ip, v_device, v_purpose), 'UTF8')), 'hex');

  insert into control.audit_event
    (seq, occurred_at, actor_id, actor_role, db_role, action, table_name, row_id,
     before, after, ip, device_id, purpose, prev_hash, hash)
  values
    (v_seq, v_at, v_actor, v_arole, v_dbrole, tg_op, tg_table_schema || '.' || tg_table_name, v_row_id,
     v_before, v_after, v_ip, v_device, v_purpose, v_prev, v_hash);

  update control.audit_chain_head set last_seq = v_seq, last_hash = v_hash where id = 1;
  return null;
end $$;

-- Recompute the whole chain; returns the first broken link, if any.
create function control.verify_audit_chain()
returns table (ok boolean, checked bigint, first_bad_seq bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  r       record;
  v_prev  text := repeat('0', 64);
  v_n     bigint := 0;
  v_hash  text;
  v_expect bigint := 1;
begin
  for r in select * from control.audit_event order by seq loop
    v_hash := encode(sha256(convert_to(v_prev || control.audit_canonical(
      r.seq, r.occurred_at, r.actor_id, r.actor_role, r.db_role, r.action, r.table_name, r.row_id,
      r.before, r.after, r.ip, r.device_id, r.purpose), 'UTF8')), 'hex');
    if r.seq <> v_expect or r.prev_hash <> v_prev or r.hash <> v_hash then
      return query select false, v_n, r.seq;
      return;
    end if;
    v_prev := r.hash;
    v_n := v_n + 1;
    v_expect := v_expect + 1;
  end loop;
  if (select h.last_seq from control.audit_chain_head h where h.id = 1) <> v_n then
    return query select false, v_n, v_n + 1;
    return;
  end if;
  return query select true, v_n, null::bigint;
end $$;

-- Append-only guard (H-06). Binds every role, including table owners and service_role.
create function control.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using
    errcode = '42501',
    message = format('%s on %I.%I is not allowed: table is append-only (doc 04 invariant 1)',
                     tg_op, tg_table_schema, tg_table_name);
end $$;

-- Approval rows change exactly once (pending → decided/cancelled); identity columns never change.
create function control.approval_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'approval requests are never deleted';
  end if;
  if old.status <> 'pending' then
    raise exception using errcode = '42501', message = 'approval request already decided';
  end if;
  if (new.id, new.client_id, new.kind, new.subject_type, new.subject_id, new.payload,
      new.maker_id, new.reason, new.created_at)
     is distinct from
     (old.id, old.client_id, old.kind, old.subject_type, old.subject_id, old.payload,
      old.maker_id, old.reason, old.created_at)
     or new.checker_role_required > old.checker_role_required then  -- enum order: owner < manager; may only move towards owner
    raise exception using errcode = '42501', message = 'approval request identity is immutable';
  end if;
  return new;
end $$;

-- user_profile: identity columns immutable; updated_at maintained by the database.
create function control.user_profile_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'users are offboarded, never deleted (SEC-08, H-07)';
  end if;
  if new.id <> old.id or new.created_at <> old.created_at or new.created_by is distinct from old.created_by then
    raise exception using errcode = '42501', message = 'user identity columns are immutable';
  end if;
  new.updated_at := now();
  return new;
end $$;

create function control.no_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '42501',
    message = format('DELETE on %I.%I is not allowed: no hard deletes (H-07)', tg_table_schema, tg_table_name);
end $$;

-- audit_event is append-only, and so is the head except for the audit function itself.
create trigger audit_event_append_only before update or delete on control.audit_event
  for each row execute function control.forbid_mutation();
create trigger audit_event_no_truncate before truncate on control.audit_event
  for each statement execute function control.forbid_mutation();
create trigger audit_head_no_delete before delete on control.audit_chain_head
  for each row execute function control.no_delete();
create trigger audit_head_no_truncate before truncate on control.audit_chain_head
  for each statement execute function control.forbid_mutation();

create trigger user_profile_guard before update or delete on public.user_profile
  for each row execute function control.user_profile_guard();
create trigger device_no_delete before delete on public.device
  for each row execute function control.no_delete();
create trigger approval_guard before update or delete on control.approval_request
  for each row execute function control.approval_guard();
create trigger doc_counter_no_delete before delete on control.doc_counter
  for each row execute function control.no_delete();

create trigger audit after insert or update or delete on public.user_profile
  for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.device
  for each row execute function control.audit_row();
create trigger audit after insert or update or delete on public.app_config
  for each row execute function control.audit_row();
create trigger audit after insert or update or delete on control.approval_request
  for each row execute function control.audit_row();
create trigger audit after insert or update or delete on control.doc_counter
  for each row execute function control.audit_row();

-- -------------------------------------------------------------- numbering ----
-- Pakistan financial year ends 30 June: FY 2026-27 → 27 (doc 09 §8).
create function app.fiscal_year(p_date date) returns smallint
language sql immutable set search_path = '' as $$
  select ((case when extract(month from p_date) >= 7
                then extract(year from p_date) + 1
                else extract(year from p_date) end)::int % 100)::smallint
$$;

-- Internal: called only from issuing functions, inside the issuing transaction, so a
-- rollback rolls the counter back too (gapless, H-11). Not executable by app roles.
create function app.next_doc_number(p_doc_type text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_fy smallint := app.fiscal_year((now() at time zone 'Asia/Karachi')::date);
  v_no bigint;
begin
  insert into control.doc_counter as c (doc_type, fy, last_no) values (p_doc_type, v_fy, 1)
  on conflict (doc_type, fy) do update set last_no = c.last_no + 1
  returning c.last_no into v_no;
  return p_doc_type || '-' || lpad(v_fy::text, 2, '0') || '-' || lpad(v_no::text, 6, '0');
end $$;

-- ------------------------------------------------- users (owner-only, AAL2) ----
-- Human-only bootstrap (ACTIVITY §10): run once by MJ as `postgres` in the SQL editor
-- after creating the owner's auth user. Not executable by any application role.
create function app.bootstrap_owner(p_user_id uuid, p_full_name text) returns public.user_profile
language plpgsql security definer set search_path = '' as $$
declare v public.user_profile;
begin
  if exists (select 1 from public.user_profile where role = 'owner') then
    raise exception using errcode = '42501', message = 'an owner already exists; use app.owner_create_user';
  end if;
  perform app.set_purpose('bootstrap first owner account');
  insert into public.user_profile (id, full_name, role, vault_grant)
  values (p_user_id, p_full_name, 'owner', true) returning * into v;
  return v;
end $$;

create function app.owner_create_user(
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
  perform app.set_purpose('create user');
  insert into public.user_profile (id, full_name, role, phone, start_date, vault_grant, created_by)
  values (p_user_id, p_full_name, p_role, p_phone, p_start_date,
          p_role in ('owner', 'manager'),           -- VLT-06: default on for O/Mg, revocable
          auth.uid())
  returning * into v;
  return v;
end $$;

create function app.owner_set_role(p_user_id uuid, p_role public.app_role, p_reason text)
returns public.user_profile
language plpgsql security definer set search_path = '' as $$
declare v public.user_profile;
begin
  perform app.assert_owner();
  if p_user_id = auth.uid() then perform app.raise_denied('owners cannot change their own role'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required'; end if;
  perform app.set_purpose('set role: ' || p_reason);
  update public.user_profile
     set role = p_role,
         vault_grant = case when p_role = 'rep' then false else vault_grant end
   where id = p_user_id returning * into v;
  if v.id is null then raise exception 'unknown user'; end if;
  return v;
end $$;

create function app.owner_set_status(p_user_id uuid, p_status public.user_status, p_reason text)
returns public.user_profile
language plpgsql security definer set search_path = '' as $$
declare v public.user_profile;
begin
  perform app.assert_owner();
  if p_user_id = auth.uid() then perform app.raise_denied('owners cannot change their own status'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required'; end if;
  perform app.set_purpose('set status: ' || p_reason);
  update public.user_profile set status = p_status where id = p_user_id returning * into v;
  if v.id is null then raise exception 'unknown user'; end if;
  if p_status <> 'active' then                       -- SEC-04/SEC-08: revoke devices at once
    update public.device
       set status = 'revoked', revoked_by = auth.uid(), revoked_at = now()
     where user_id = p_user_id and status <> 'revoked';
  end if;
  return v;
end $$;

create function app.owner_set_vault_grant(p_user_id uuid, p_grant boolean, p_reason text)
returns public.user_profile
language plpgsql security definer set search_path = '' as $$
declare v public.user_profile;
begin
  perform app.assert_owner();
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required'; end if;
  perform app.set_purpose('vault grant ' || case when p_grant then 'on' else 'off' end || ': ' || p_reason);
  update public.user_profile set vault_grant = p_grant where id = p_user_id returning * into v;
  if v.id is null then raise exception 'unknown user'; end if;
  return v;
end $$;

-- ----------------------------------------------------------- device binding ----
-- SEC-03. Every new device starts `pending` and needs an office approval (doc 08 §2,
-- doc 13 §9 "Device approval"); see assumption A-02.
create function app.register_device(p_fingerprint text, p_platform text default null, p_label text default null)
returns public.device
language plpgsql security definer set search_path = '' as $$
declare v public.device;
begin
  if app.user_role() is null then perform app.raise_denied('no active user profile for this session'); end if;
  insert into public.device (user_id, device_fingerprint, platform, label, last_seen_at)
  values (auth.uid(), p_fingerprint, p_platform, p_label, now())
  on conflict (user_id, device_fingerprint) do update set last_seen_at = now()
  returning * into v;
  return v;
end $$;

create function app.approve_device(p_device_id uuid, p_reason text) returns public.device
language plpgsql security definer set search_path = '' as $$
declare v public.device;
begin
  perform app.assert_office();
  select * into v from public.device where id = p_device_id for update;
  if v.id is null then raise exception 'unknown device'; end if;
  if v.user_id = auth.uid() then perform app.raise_denied('you cannot approve your own device'); end if;
  if v.status = 'approved' then return v; end if;   -- idempotent
  if v.status = 'revoked' then perform app.raise_denied('revoked devices cannot be re-approved; register again'); end if;
  perform app.set_purpose('approve device: ' || coalesce(p_reason, ''));
  update public.device                              -- one active device per user
     set status = 'revoked', revoked_by = auth.uid(), revoked_at = now()
   where user_id = v.user_id and status = 'approved';
  update public.device
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_device_id returning * into v;
  return v;
end $$;

create function app.revoke_device(p_device_id uuid, p_reason text) returns public.device
language plpgsql security definer set search_path = '' as $$
declare v public.device;
begin
  perform app.assert_actor_ready();
  select * into v from public.device where id = p_device_id for update;
  if v.id is null then raise exception 'unknown device'; end if;
  if v.user_id <> auth.uid() and not app.is_office() then
    perform app.raise_denied('only the device owner or the office can revoke a device');
  end if;
  if v.status = 'revoked' then return v; end if;
  perform app.set_purpose('revoke device: ' || coalesce(p_reason, ''));
  update public.device set status = 'revoked', revoked_by = auth.uid(), revoked_at = now()
   where id = p_device_id returning * into v;
  return v;
end $$;

-- --------------------------------------------------------- configuration ----
create function app.owner_set_config(p_key text, p_value jsonb, p_reason text, p_rep_visible boolean default null)
returns public.app_config
language plpgsql security definer set search_path = '' as $$
declare v public.app_config;
begin
  perform app.assert_owner();
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required'; end if;
  perform app.set_purpose('config ' || p_key || ': ' || p_reason);
  insert into public.app_config as c (key, value, rep_visible, updated_by)
  values (p_key, p_value, coalesce(p_rep_visible, false), auth.uid())
  on conflict (key) do update
     set value = excluded.value,
         rep_visible = coalesce(p_rep_visible, c.rep_visible),
         note = null,
         updated_by = excluded.updated_by,
         updated_at = now()
  returning * into v;
  return v;
end $$;

-- ------------------------------------------------------ approval framework ----
-- Generic maker-checker (SEC-11). Domain functions in later migrations create requests
-- through app.request_approval and consume decided requests; the checker rules here
-- are the floor, domain thresholds (doc 13 §9) can only raise checker_role_required.
create function app.request_approval(
  p_client_id uuid, p_kind public.approval_kind, p_subject_type text, p_subject_id uuid,
  p_payload jsonb, p_reason text, p_checker_role public.app_role default 'manager')
returns control.approval_request
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  v      control.approval_request;
  v_checker public.app_role := p_checker_role;
begin
  select * into v from control.approval_request where client_id = p_client_id;
  if v.id is not null then
    if v.maker_id = auth.uid() then return v; end if;        -- idempotent replay
    raise exception using errcode = '23505', message = 'client_id already used';
  end if;
  if v_role = 'rep' and p_kind not in ('discount', 'return_accept', 'payment_reversal') then
    perform app.raise_denied('reps may only request discounts, return acceptance or payment reversals');
  end if;
  if v_checker not in ('manager', 'owner') then v_checker := 'manager'; end if;
  -- Owner-only decisions (doc 06 §2, doc 13 §9): write-offs always; anything a manager makes
  -- that a manager would otherwise check is still fine (maker ≠ checker is per person).
  if p_kind = 'write_off' then v_checker := 'owner'; end if;
  perform app.set_purpose('approval requested: ' || p_kind::text);
  insert into control.approval_request
    (client_id, kind, subject_type, subject_id, payload, maker_id, checker_role_required, reason)
  values
    (p_client_id, p_kind, p_subject_type, p_subject_id, coalesce(p_payload, '{}'::jsonb),
     auth.uid(), v_checker, p_reason)
  returning * into v;
  return v;
end $$;

create function app.decide_approval(p_request_id uuid, p_approve boolean, p_reason text)
returns control.approval_request
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_office();
  v      control.approval_request;
begin
  select * into v from control.approval_request where id = p_request_id for update;
  if v.id is null then raise exception 'unknown approval request'; end if;
  if v.maker_id = auth.uid() then
    perform app.raise_denied('maker cannot approve their own request (SEC-11)');
  end if;
  if v.status <> 'pending' then
    if v.checker_id = auth.uid() and (v.status = 'approved') = p_approve then return v; end if;  -- replay
    perform app.raise_denied('approval request already decided');
  end if;
  if v.checker_role_required = 'owner' and v_role <> 'owner' then
    perform app.raise_denied('this request needs the owner''s decision');
  end if;
  perform app.set_purpose('approval ' || case when p_approve then 'approved' else 'rejected' end);
  update control.approval_request
     set status = case when p_approve then 'approved'::public.approval_status else 'rejected'::public.approval_status end,
         checker_id = auth.uid(), decision_reason = p_reason, decided_at = now()
   where id = p_request_id returning * into v;
  return v;
end $$;

create function app.cancel_approval(p_request_id uuid, p_reason text) returns control.approval_request
language plpgsql security definer set search_path = '' as $$
declare v control.approval_request;
begin
  perform app.assert_actor_ready();
  select * into v from control.approval_request where id = p_request_id for update;
  if v.id is null then raise exception 'unknown approval request'; end if;
  if v.maker_id <> auth.uid() then perform app.raise_denied('only the maker can cancel a request'); end if;
  if v.status = 'cancelled' then return v; end if;
  if v.status <> 'pending' then perform app.raise_denied('approval request already decided'); end if;
  perform app.set_purpose('approval cancelled: ' || coalesce(p_reason, ''));
  update control.approval_request set status = 'cancelled', decided_at = now(), decision_reason = p_reason
   where id = p_request_id returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------- RLS -----
alter table public.user_profile        enable row level security;
alter table public.user_profile        force  row level security;
alter table public.device              enable row level security;
alter table public.device              force  row level security;
alter table public.app_config          enable row level security;
alter table public.app_config          force  row level security;
alter table control.approval_request   enable row level security;
alter table control.approval_request   force  row level security;
alter table control.audit_event        enable row level security;
alter table control.audit_event        force  row level security;
alter table control.audit_chain_head   enable row level security;
alter table control.audit_chain_head   force  row level security;
alter table control.doc_counter        enable row level security;
alter table control.doc_counter        force  row level security;

-- Reads only. No INSERT/UPDATE/DELETE policies exist for any application role.
create policy user_profile_select on public.user_profile for select to authenticated
  using (id = auth.uid() or app.is_office());

create policy device_select on public.device for select to authenticated
  using (user_id = auth.uid() or app.is_office());

create policy app_config_select on public.app_config for select to authenticated
  using (app.is_office() or (rep_visible and app.user_role() is not null));

create policy approval_request_select on control.approval_request for select to authenticated
  using (maker_id = auth.uid() or app.is_office());

-- Audit log: owner only, AAL2 (doc 06 §2). Nobody may write it.
create policy audit_event_select on control.audit_event for select to authenticated
  using (app.is_owner());
-- audit_chain_head, doc_counter: no policies → no application access.

-- ------------------------------------------------------------- privileges ----
revoke all on public.user_profile, public.device, public.app_config from anon, authenticated, service_role;
revoke all on control.approval_request, control.audit_event, control.audit_chain_head, control.doc_counter
  from public, anon, authenticated, service_role;

grant select on public.user_profile, public.device, public.app_config to authenticated;
grant select on control.approval_request, control.audit_event to authenticated;
-- service_role (Edge Functions only, H-18) may read operational tables, never write them directly.
grant select on public.user_profile, public.device, public.app_config, control.approval_request to service_role;

revoke execute on all functions in schema app, control from public, anon, authenticated, service_role;

-- RLS helpers must be executable by the querying role.
grant execute on function
  app.user_role(), app.is_aal2(), app.is_office(), app.is_owner(), app.is_rep(),
  app.has_vault_grant(), app.request_device_id(), app.rep_device_ok()
  to authenticated;

-- RPC surface (PostgREST exposes schema `app`; see supabase/config.toml).
grant execute on function
  app.owner_create_user(uuid, text, public.app_role, text, date),
  app.owner_set_role(uuid, public.app_role, text),
  app.owner_set_status(uuid, public.user_status, text),
  app.owner_set_vault_grant(uuid, boolean, text),
  app.register_device(text, text, text),
  app.approve_device(uuid, text),
  app.revoke_device(uuid, text),
  app.owner_set_config(text, jsonb, text, boolean),
  app.request_approval(uuid, public.approval_kind, text, uuid, jsonb, text, public.app_role),
  app.decide_approval(uuid, boolean, text),
  app.cancel_approval(uuid, text)
  to authenticated;
-- Not granted to anyone: app.bootstrap_owner (postgres only), app.next_doc_number
-- (internal), app.assert_* / app.raise_denied / app.set_purpose (internal),
-- control.* (triggers and owner-run verification).

-- --------------------------------------------------- default configuration ----
-- doc 13 §9 / doc 09 defaults. All [default-unconfirmed] until MJ answers (A-01, B-05).
insert into public.app_config (key, value, note) values
  ('cash.intraday_cap_paisa',                       '5000000',                    '[default-unconfirmed] CTL-17: Rs 50,000'),
  ('approval.discount.owner_above',                 '{"pct": 10, "paisa": 500000}', '[default-unconfirmed] doc 13 §9: >10% or > Rs 5,000 per order'),
  ('approval.payment_reversal.owner_above_paisa',   '1000000',                    '[default-unconfirmed] doc 13 §9: > Rs 10,000'),
  ('approval.stock_adjustment.owner_above',         '{"paisa": 1000000, "units": 10}', '[default-unconfirmed] doc 13 §9: > Rs 10,000 at list value or > 10 units'),
  ('approval.credit_note.owner_above_paisa',        '1000000',                    '[default-unconfirmed] doc 13 §9: > Rs 10,000'),
  ('approval.restructure.owner_above_paisa',        '5000000',                    '[default-unconfirmed] doc 13 §9: > Rs 50,000 outstanding'),
  ('approval.purchase_order.owner_above_paisa',     '20000000',                   '[default-unconfirmed] doc 13 §9: > Rs 200,000'),
  ('approval.petty_expense.owner_above_paisa',      '500000',                     '[default-unconfirmed] doc 13 §9: > Rs 5,000'),
  ('credit.manager_override.max_increase_pct',      '50',                         '[default-unconfirmed] doc 09 §2'),
  ('credit.manager_override.max_per_salon_month',   '2',                          '[default-unconfirmed] doc 09 §2'),
  ('payment.geofence_m',                            '300',                        '[default-unconfirmed] CTL-02'),
  ('payment.max_minutes_after_arrival',             '120',                        '[default-unconfirmed] CTL-02'),
  ('office_cash.max_age_working_days',              '2',                          '[default-unconfirmed] CTL-04'),
  ('transfer.match_within_working_days',            '3',                          '[default-unconfirmed] doc 09 §6');
