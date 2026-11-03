-- =============================================================================
-- Kiran DMS · migration 0019 · MJ's B-33 rules hold under concurrency and for any whitespace
-- Requirements: PIP-01, SEC-08, SAL-01. Decision: ACTIVITY L-0284 (B-33). Fixes B-34 (L-0290,
-- L-0291), found by the re-verifier of slices 1 to 3 on merged main 3630998.
--
-- (1) office_assign_territory and office_upsert_territory each read the territory row with a lock
--     before their check (FOR SHARE to assign, FOR UPDATE to deactivate), so an assignment and a
--     deactivation of the same territory run one after the other and the second sees the first:
--     an inactive territory with an open assignment can no longer arise from a race.
-- (2) owner_set_status locks the person's profile row before its "offboarded is final" check, so a
--     reactivation sent while another session offboards the person waits and is then refused.
-- (3) update_salon treats a name or address made only of whitespace of any kind (tab, line break,
--     no-break space and the other Unicode spaces) as blank, so it keeps the recorded value, and it
--     stores values trimmed of such whitespace. btrim() alone strips only the space character.
-- Signatures are unchanged, so the existing grants stay. Everything else in each function is as in
-- migration 0018.
-- =============================================================================

-- Internal helper (no grant to any API role): trims every kind of whitespace from both ends and
-- returns null for what is left empty.
create function app.blank_to_null(p text)
returns text
language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(p, '^[[:space:]\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+|[[:space:]\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g'), '')
$$;
revoke execute on function app.blank_to_null(text) from public, anon, authenticated, service_role;

create or replace function app.office_upsert_territory(p_id uuid, p_name text, p_active boolean default true)
returns public.territory
language plpgsql security definer set search_path = '' as $$
declare v public.territory;
begin
  perform app.assert_office();
  if not coalesce(p_active, true) then
    -- Lock first, so an assignment being made now finishes (or waits) before the check below.
    perform 1 from public.territory t where t.id = p_id for update;
    if exists (select 1 from public.rep_territory r where r.territory_id = p_id and r.to_date is null) then
      raise exception using errcode = '22023',
        message = 'end every rep assignment to this territory, with a reason, before making it inactive';
    end if;
  end if;
  perform app.set_purpose('territory');
  insert into public.territory as t (id, name, active, created_by)
  values (p_id, p_name, coalesce(p_active, true), auth.uid())
  on conflict (id) do update set name = excluded.name, active = excluded.active
  returning * into v;
  return v;
end $$;

create or replace function app.office_assign_territory(p_rep_id uuid, p_territory_id uuid)
returns public.rep_territory
language plpgsql security definer set search_path = '' as $$
declare
  v        public.rep_territory;
  v_active boolean;
begin
  perform app.assert_office();
  if not exists (select 1 from public.user_profile u where u.id = p_rep_id and u.role = 'rep' and u.status = 'active') then
    raise exception using errcode = '22023', message = 'territories are assigned to active reps';
  end if;
  -- FOR SHARE waits for a deactivation in progress and then reads its committed result.
  select t.active into v_active from public.territory t where t.id = p_territory_id for share;
  if not coalesce(v_active, false) then
    raise exception using errcode = '22023', message = 'reps are assigned only to active territories';
  end if;
  select * into v from public.rep_territory where rep_id = p_rep_id and territory_id = p_territory_id and to_date is null;
  if v.id is not null then return v; end if;                                -- already assigned
  perform app.set_purpose('territory assigned');
  insert into public.rep_territory (rep_id, territory_id, assigned_by)
  values (p_rep_id, p_territory_id, auth.uid()) returning * into v;
  return v;
end $$;

create or replace function app.owner_set_status(p_user_id uuid, p_status public.user_status, p_reason text)
returns public.user_profile
language plpgsql security definer set search_path = '' as $$
declare
  v     public.user_profile;
  v_now public.user_status;
begin
  perform app.assert_owner();
  if p_user_id = auth.uid() then perform app.raise_denied('owners cannot change their own status'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required'; end if;
  -- Lock the row first, so an offboarding in progress commits before the check reads the status.
  select u.status into v_now from public.user_profile u where u.id = p_user_id for update;
  if v_now = 'offboarded' and p_status is distinct from 'offboarded' then
    raise exception using errcode = '22023',
      message = 'offboarding is final; a person who returns gets a new account';
  end if;
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

create or replace function app.update_salon(
  p_id uuid, p_name text, p_type public.salon_type, p_area_id uuid,
  p_address text default null, p_lat numeric default null, p_lng numeric default null, p_chairs integer default null)
returns public.salon
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  v      public.salon;
begin
  if v_role = 'rep' then
    if not app.rep_can_reach_salon(p_id) or not app.rep_can_use_area(p_area_id) then
      perform app.raise_denied('reps edit salons only in their own territories');
    end if;
  elsif v_role not in ('owner', 'manager') or not app.is_office() then
    perform app.raise_denied('owner or manager only');
  end if;
  if (p_lat is null) <> (p_lng is null) then
    raise exception using errcode = '22023', message = 'a pin needs both lat and lng, or neither';
  end if;
  perform app.set_purpose('salon edited');
  update public.salon
     set name    = coalesce(app.blank_to_null(p_name), name),
         type    = p_type,
         area_id = p_area_id,
         address = coalesce(app.blank_to_null(p_address), address),
         lat     = coalesce(p_lat, lat),
         lng     = coalesce(p_lng, lng),
         chairs  = coalesce(p_chairs, chairs)
   where id = p_id returning * into v;
  if v.id is null then raise exception using errcode = '22023', message = 'unknown salon'; end if;
  return v;
end $$;
