-- =============================================================================
-- Kiran DMS · migration 0004 · Device-binding hardening (corrects P1-01, ACTIVITY L-0025)
--
-- Defect 1 found by the independent verifier: a rep session on an UNAPPROVED phone
-- could read its approved device's fingerprint through RLS, replay it as the
-- x-kiran-device header, and pass app.rep_device_ok(). Reads were not device-gated.
--
--   1. Fingerprints are stored as sha256 hex. The header carries the preimage, so a
--      value read from the database (by anyone, incl. office or service_role) cannot be
--      replayed as a header.
--   2. Every self/rep read requires an active profile AND, for reps, the approved
--      device (doc 04 invariant 7). Suspended users read nothing (verifier Q3).
--   3. app.my_session(): the app's status screen (name, role, account status, this
--      device's status) without granting table reads to an unapproved device.
--   4. A revoked device that registers again goes back to `pending` (needs a fresh
--      office approval) instead of being stuck forever (verifier Q4).
--   5. Audit IP: prefer cf-connecting-ip, else the LAST x-forwarded-for entry (the one
--      the platform proxy appended), not the client-controlled first entry (verifier Q2).
--      Still evidence only, never used for access decisions.
--   6. Config is hidden from reps (doc 06 §2: reps have no access to "installment
--      templates, credit rules, config"; verifier Q1). Phase 1 RPCs will hand reps
--      the specific lists they need. Pending MJ (B-14).
-- =============================================================================

-- ------------------------------------------------------------- 1. hashing ----
create function app.fingerprint_hash(p_fingerprint text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_fingerprint, 'UTF8')), 'hex')
$$;

do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.device'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%length(device_fingerprint)%'
  loop
    execute format('alter table public.device drop constraint %I', c);
  end loop;
end $$;
update public.device set device_fingerprint = app.fingerprint_hash(device_fingerprint)
 where device_fingerprint !~ '^[0-9a-f]{64}$';
alter table public.device add constraint device_fingerprint_is_hash check (device_fingerprint ~ '^[0-9a-f]{64}$');
comment on column public.device.device_fingerprint is
  'sha256 hex of the client device id. The raw id exists only on the phone and in the x-kiran-device header.';

create or replace function app.rep_device_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when app.user_role() is distinct from 'rep' then true
    else exists (
      select 1 from public.device d
      where d.user_id = auth.uid() and d.status = 'approved'
        and d.device_fingerprint = app.fingerprint_hash(app.request_device_id()))
  end
$$;

-- ------------------------------------------------ 2. device-gated self reads ----
-- True when the caller has an active profile and, if a rep, is on the approved device.
create function app.self_ok() returns boolean
language sql stable set search_path = '' as $$
  select app.user_role() is not null and app.rep_device_ok()
$$;

alter policy user_profile_select on public.user_profile
  using ((id = (select auth.uid()) and (select app.self_ok())) or (select app.is_office()));

alter policy device_select on public.device
  using ((user_id = (select auth.uid()) and (select app.self_ok())) or (select app.is_office()));

alter policy app_config_select on public.app_config
  using ((select app.is_office()) or (rep_visible and (select app.self_ok())));

alter policy approval_request_select on control.approval_request
  using ((maker_id = (select auth.uid()) and (select app.self_ok())) or (select app.is_office()));

-- --------------------------------------------------------- 3. my_session ----
create function app.my_session() returns jsonb
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
  where p.id = auth.uid()
$$;

-- ------------------------------------------- 4. register: hash + re-pending ----
create or replace function app.register_device(p_fingerprint text, p_platform text default null, p_label text default null)
returns public.device
language plpgsql security definer set search_path = '' as $$
declare
  v      public.device;
  v_hash text;
begin
  if app.user_role() is null then perform app.raise_denied('no active user profile for this session'); end if;
  if length(coalesce(p_fingerprint, '')) not between 16 and 200 then
    raise exception using errcode = '22023', message = 'device id must be 16 to 200 characters';
  end if;
  v_hash := app.fingerprint_hash(p_fingerprint);
  select * into v from public.device where user_id = auth.uid() and device_fingerprint = v_hash for update;
  if v.id is null then
    insert into public.device (user_id, device_fingerprint, platform, label, last_seen_at)
    values (auth.uid(), v_hash, p_platform, p_label, now())
    returning * into v;
  elsif v.status = 'revoked' then
    perform app.set_purpose('revoked device registered again: back to pending');
    update public.device
       set status = 'pending', approved_by = null, approved_at = null, last_seen_at = now()
     where id = v.id returning * into v;
  else
    update public.device set last_seen_at = now() where id = v.id returning * into v;
  end if;
  return v;
end $$;

-- app.approve_device is unchanged: it still refuses a device whose status is `revoked`.
-- The way back is register again (→ pending), then a fresh office approval.

-- ------------------------------------------------------ 5. audit IP source ----
create or replace function control.audit_row() returns trigger
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
  v_xff     text[];
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
  -- Proxy-observed address: cf-connecting-ip, else the last x-forwarded-for hop.
  v_xff := string_to_array(coalesce(v_hdrs ->> 'x-forwarded-for', ''), ',');
  v_ip := nullif(btrim(coalesce(v_hdrs ->> 'cf-connecting-ip', v_xff[array_length(v_xff, 1)], '')), '');
  -- Store the hash, never the raw device id (it is a bearer credential).
  v_device := case when v_hdrs ? 'x-kiran-device' then app.fingerprint_hash(v_hdrs ->> 'x-kiran-device') end;

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

-- --------------------------------------------------- 6. config hidden from reps ----
update public.app_config set rep_visible = false where rep_visible;

-- ------------------------------------------------------------- privileges ----
revoke execute on function app.fingerprint_hash(text) from public, anon, authenticated, service_role;
revoke execute on function app.self_ok(), app.my_session() from public, anon, service_role;
grant execute on function app.self_ok(), app.my_session() to authenticated;
revoke execute on function app.rep_device_ok(), app.register_device(text, text, text) from public, anon, service_role;
grant execute on function app.rep_device_ok(), app.register_device(text, text, text) to authenticated;
