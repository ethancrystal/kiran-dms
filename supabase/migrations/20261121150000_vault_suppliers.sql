-- P1-05, first slice: the supplier vault foundation (VLT-01, VLT-04, VLT-06; doc 07).
--
-- What this migration adds
--   * supplier_vault.supplier        the classified record (name, contact, phone, note, status)
--   * supplier_vault.vault_access_log  append-only log of every vault_api call (doc 07 section 2)
--   * vault_api.supplier_list / supplier_upsert / supplier_grant_set  the only way in
--
-- Two design points that follow the docs and the existing guards, not convenience:
--
--  1. The access log lives in supplier_vault, as docs 04 (line 156), 06 (section 6) and 07 (section 2)
--     place it. It holds opaque row ids and the actor, never a name, a contact or a term, so it is
--     safe where it is; putting it in control with a column naming a supplier row would also fail
--     schema-hygiene.test.ts ("no public column name hints at supplier or cost data", H-01).
--
--  2. DA-033: control.audit_event stores the whole row as JSON (before/after), so a plain audit
--     trigger on a vault table would copy vault values into control and break H-01. The audit trigger
--     here still fires (H-17) and still extends the hash chain, but the row images are redacted in
--     control.audit_row() for supplier_vault tables: who, when and which row id are recorded, the
--     values are not. That is option (b) of the finding, the one that satisfies both H-01 and H-17.
--
-- No foreign key leaves supplier_vault (doc 04 invariant 9; schema-hygiene enforces it), so created_by
-- is a bare uuid. No policy is written: the schema is revoked from every application role and the RLS
-- default is deny, which is the strictest reading of doc 06 line "No policy -> no access".

-- ------------------------------------------------------------------ the record ----
create table supplier_vault.supplier (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  contact_name text,
  phone        text,
  note         text,
  status       text not null default 'active',
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint supplier_row_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint supplier_row_status_valid check (status in ('active', 'archived')),
  constraint supplier_row_text_lengths check (
        (contact_name is null or char_length(contact_name) <= 120)
    and (phone is null or char_length(phone) <= 40)
    and (note is null or char_length(note) <= 2000))
);
comment on table supplier_vault.supplier is
  'Classified record (VLT-01, doc 07 section 1). Read and written only through vault_api functions that check the vault grant and AAL2. Archived, never deleted (H-07).';

alter table supplier_vault.supplier enable row level security;
alter table supplier_vault.supplier force row level security;

-- ------------------------------------------------------------- the access log ----
-- Doc 04: id, user_id, function_called, record_refs, purpose, occurred_at. `action` and `client_id`
-- are added: the first so a read, a write and a grant are told apart, the second as the idempotency
-- key of a write (H-08), so a replayed call returns its first result and adds no second row.
create table supplier_vault.vault_access_log (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid,
  user_id         uuid not null,
  function_called text not null,
  action          text not null,
  record_refs     jsonb not null default '[]'::jsonb,
  purpose         text not null,
  occurred_at     timestamptz not null default now(),
  constraint vault_access_row_action_valid check (action in ('read', 'write', 'grant')),
  constraint vault_access_row_purpose_length check (char_length(btrim(purpose)) between 3 and 200),
  constraint vault_access_row_refs_is_array check (jsonb_typeof(record_refs) = 'array')
);
create unique index vault_access_log_client_id on supplier_vault.vault_access_log (client_id)
  where client_id is not null;
comment on table supplier_vault.vault_access_log is
  'Append-only log of every vault_api call (VLT-04, doc 07 section 2): who, when, which function, which row ids and a purpose. Never copies a vault value.';

create index vault_access_log_occurred_at on supplier_vault.vault_access_log (occurred_at);

alter table supplier_vault.vault_access_log enable row level security;
alter table supplier_vault.vault_access_log force row level security;

-- ------------------------------------------------------------------- triggers ----
create trigger audit after insert or update or delete on supplier_vault.supplier
  for each row execute function control.audit_row();
create trigger audit after insert or update or delete on supplier_vault.vault_access_log
  for each row execute function control.audit_row();

-- Append-only (H-06, doc 04 invariant 1) and no hard delete anywhere (H-07).
create trigger vault_access_log_append_only before update or delete on supplier_vault.vault_access_log
  for each row execute function control.forbid_mutation();
create trigger vault_access_log_no_truncate before truncate on supplier_vault.vault_access_log
  for each statement execute function control.forbid_mutation();
create trigger supplier_no_delete before delete on supplier_vault.supplier
  for each row execute function control.no_delete();

-- ------------------------------------------------- DA-033: redact vault images ----
-- Same body as migration 20261024232225 (device hardening), with one added branch: a row of
-- supplier_vault is audited as an event, never as a copy. Replacing the function keeps the chain
-- canonical input unchanged for every other table.
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
  -- DA-033: keep the event, drop the values. The row id stays so an access can still be tied to a
  -- record; nothing else from the vault row reaches control.
  if tg_table_schema = 'supplier_vault' then
    v_before := case when v_before is null then null else jsonb_build_object('redacted', true) end;
    v_after  := case when v_after  is null then null else jsonb_build_object('redacted', true) end;
  end if;
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

-- --------------------------------------------------------------- the API --------------
-- The only way in. Each function checks the vault grant (active profile, owner or manager, grant on,
-- AAL2 - app.has_vault_grant covers all four), takes a purpose for the log, and appends one
-- vault_access_log row. None of them is executable by anon or service_role.

create function vault_api.supplier_list(p_purpose text)
returns setof supplier_vault.supplier
language plpgsql security definer set search_path = '' as $$
declare
  v_purpose text := btrim(coalesce(p_purpose, ''));
  v_ids     jsonb;
begin
  if not app.has_vault_grant() then
    perform app.raise_denied('no vault access: the vault grant and AAL2 are both required');
  end if;
  if char_length(v_purpose) < 3 then
    raise exception using errcode = '22023', message = 'a purpose of at least 3 characters is required';
  end if;

  select coalesce(jsonb_agg(s.id order by s.id), '[]'::jsonb) into v_ids from supplier_vault.supplier s;

  insert into supplier_vault.vault_access_log (user_id, function_called, action, record_refs, purpose)
  values (auth.uid(), 'supplier_list', 'read', v_ids, v_purpose);

  return query select s.* from supplier_vault.supplier s order by s.name, s.id;
end $$;

create function vault_api.supplier_upsert(
  p_client_id uuid,
  p_id uuid,
  p_name text,
  p_contact_name text default null,
  p_phone text default null,
  p_note text default null,
  p_status text default null,
  p_purpose text default null
) returns supplier_vault.supplier
language plpgsql security definer set search_path = '' as $$
declare
  v_purpose text := btrim(coalesce(p_purpose, ''));
  v_name    text := btrim(coalesce(p_name, ''));
  v_status  text := nullif(btrim(coalesce(p_status, '')), '');
  v_row     supplier_vault.supplier;
  v_ref     uuid;
begin
  if not app.has_vault_grant() then
    perform app.raise_denied('no vault access: the vault grant and AAL2 are both required');
  end if;
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'client_id is required';
  end if;
  if char_length(v_purpose) < 3 then
    raise exception using errcode = '22023', message = 'a reason of at least 3 characters is required';
  end if;

  -- Idempotent replay (H-08): the same client_id returns what it wrote and logs nothing new.
  select (l.record_refs ->> 0)::uuid into v_ref
  from supplier_vault.vault_access_log l where l.client_id = p_client_id;
  if found then
    select * into v_row from supplier_vault.supplier s where s.id = v_ref;
    if v_row.id is null then
      raise exception using errcode = '23505', message = 'client_id was already used for another record';
    end if;
    return v_row;
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception using errcode = '22023', message = 'a name of 1 to 120 characters is required';
  end if;
  if v_status is not null and v_status not in ('active', 'archived') then
    raise exception using errcode = '22023', message = 'status must be active or archived';
  end if;

  if p_id is null then
    insert into supplier_vault.supplier (name, contact_name, phone, note, status, created_by)
    values (v_name,
            nullif(btrim(coalesce(p_contact_name, '')), ''),
            nullif(btrim(coalesce(p_phone, '')), ''),
            nullif(btrim(coalesce(p_note, '')), ''),
            coalesce(v_status, 'active'),
            auth.uid())
    returning * into v_row;
  else
    -- A null keeps what is recorded; an empty string clears it (the office_upsert_product rule).
    update supplier_vault.supplier s
       set name         = v_name,
           contact_name = case when p_contact_name is null then s.contact_name
                               else nullif(btrim(p_contact_name), '') end,
           phone        = case when p_phone is null then s.phone
                               else nullif(btrim(p_phone), '') end,
           note         = case when p_note is null then s.note
                               else nullif(btrim(p_note), '') end,
           status       = coalesce(v_status, s.status),
           updated_at   = now()
     where s.id = p_id
     returning * into v_row;
    if v_row.id is null then
      raise exception using errcode = '22023', message = 'unknown record';
    end if;
  end if;

  insert into supplier_vault.vault_access_log (client_id, user_id, function_called, action, record_refs, purpose)
  values (p_client_id, auth.uid(), 'supplier_upsert', 'write', jsonb_build_array(v_row.id), v_purpose);
  return v_row;
end $$;

create function vault_api.supplier_grant_set(
  p_client_id uuid,
  p_user_id uuid,
  p_grant boolean,
  p_purpose text
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_purpose text := btrim(coalesce(p_purpose, ''));
  v_seen    uuid;
  v_now     boolean;
begin
  -- VLT-06, H-15: a vault grant is governance, so the owner alone sets it, at AAL2, whatever grant
  -- the caller holds. app.owner_set_vault_grant carries the reason into the audit row.
  perform app.assert_owner();
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'client_id is required';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'a user is required';
  end if;
  if char_length(v_purpose) < 3 then
    raise exception using errcode = '22023', message = 'a reason of at least 3 characters is required';
  end if;

  select l.user_id into v_seen from supplier_vault.vault_access_log l where l.client_id = p_client_id;
  if found then
    select coalesce(p2.vault_grant, false) into v_now from public.user_profile p2 where p2.id = p_user_id;
    return coalesce(v_now, false);
  end if;

  perform app.owner_set_vault_grant(p_user_id, p_grant, v_purpose);

  insert into supplier_vault.vault_access_log (client_id, user_id, function_called, action, record_refs, purpose)
  values (p_client_id, auth.uid(), 'supplier_grant_set', 'grant', jsonb_build_array(p_user_id), v_purpose);
  return p_grant;
end $$;

-- ------------------------------------------------------------------ privileges ----
-- supplier_vault stays unreachable for every application role (the foundation already revoked the
-- schema; the tables add no grant of their own). vault_api is the only door, and only for signed-in
-- users: the two catalogue reads are the only functions anon may execute.
revoke all on function vault_api.supplier_list(text) from public, anon, service_role;
revoke all on function vault_api.supplier_upsert(uuid, uuid, text, text, text, text, text, text) from public, anon, service_role;
revoke all on function vault_api.supplier_grant_set(uuid, uuid, boolean, text) from public, anon, service_role;
grant execute on function vault_api.supplier_list(text) to authenticated;
grant execute on function vault_api.supplier_upsert(uuid, uuid, text, text, text, text, text, text) to authenticated;
grant execute on function vault_api.supplier_grant_set(uuid, uuid, boolean, text) to authenticated;
