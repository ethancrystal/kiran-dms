-- =============================================================================
-- Kiran DMS · migration 0018 · MJ's B-33 decisions, enforced in the database
-- Requirements: PIP-01 (territories and assignments), SEC-08 (offboarding), SAL-01 (salon edit).
-- Decision: ACTIVITY L-0284 (MJ, 2026-11-02), on the verifier's questions B-33 (L-0275).
--
-- (a) A territory cannot be made inactive while a rep assignment to it is open: the office ends
--     each assignment first, with its recorded reason (app.office_end_territory), so no rep loses
--     or keeps access silently.
-- (b) A rep cannot be assigned to an inactive territory.
-- (c) Offboarding is final: no status change away from offboarded (a rehired person gets a new
--     account). Offboarding an offboarded person again is a harmless replay.
-- (d) An empty or blank address keeps the recorded address, as an empty name already does.
-- Signatures are unchanged, so the existing grants stay. Everything else in each function is as
-- in migrations 0001 (owner_set_status), 0009 (territory functions) and 0014 (update_salon).
-- =============================================================================

create or replace function app.office_upsert_territory(p_id uuid, p_name text, p_active boolean default true)
returns public.territory
language plpgsql security definer set search_path = '' as $$
declare v public.territory;
begin
  perform app.assert_office();
  if not coalesce(p_active, true)
     and exists (select 1 from public.rep_territory r where r.territory_id = p_id and r.to_date is null) then
    raise exception using errcode = '22023',
      message = 'end every rep assignment to this territory, with a reason, before making it inactive';
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
declare v public.rep_territory;
begin
  perform app.assert_office();
  if not exists (select 1 from public.user_profile u where u.id = p_rep_id and u.role = 'rep' and u.status = 'active') then
    raise exception using errcode = '22023', message = 'territories are assigned to active reps';
  end if;
  if not exists (select 1 from public.territory t where t.id = p_territory_id and t.active) then
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
declare v public.user_profile;
begin
  perform app.assert_owner();
  if p_user_id = auth.uid() then perform app.raise_denied('owners cannot change their own status'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required'; end if;
  if p_status <> 'offboarded'
     and exists (select 1 from public.user_profile u where u.id = p_user_id and u.status = 'offboarded') then
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
     set name    = coalesce(nullif(btrim(p_name), ''), name),
         type    = p_type,
         area_id = p_area_id,
         address = coalesce(nullif(btrim(p_address), ''), address),
         lat     = coalesce(p_lat, lat),
         lng     = coalesce(p_lng, lng),
         chairs  = coalesce(p_chairs, chairs)
   where id = p_id returning * into v;
  if v.id is null then raise exception using errcode = '22023', message = 'unknown salon'; end if;
  return v;
end $$;
