-- =============================================================================
-- Kiran DMS · migration 0017 · A create_salon replay is checked for scope first
-- Requirements: SAL-01, H-14 (reps reach only their own territories' salons).
-- Fixes B-32 (ACTIVITY L-0274, found by the independent verifier of slices 1 to 3).
--
-- app.create_salon (migration 0009) answered a replay (same id, creator, area and type) before it
-- checked the rep's territory, so a rep who had lost the territory could call it again with the
-- salon's id and current area and read the salon's current row (name, address, pin, chairs,
-- stage), including office edits made after the assignment ended. The rep's area and source
-- checks now run first; a rep who still holds the area gets the replay as before. Office
-- behaviour, the signature and the grants are unchanged.
-- =============================================================================

create or replace function app.create_salon(
  p_id uuid, p_name text, p_type public.salon_type, p_area_id uuid, p_source public.salon_source,
  p_address text default null, p_lat numeric default null, p_lng numeric default null, p_chairs integer default null,
  p_contact_name text default null, p_contact_phone text default null, p_note text default null,
  p_created_at_client timestamptz default null)
returns public.salon
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  v      public.salon;
begin
  if v_role = 'rep' then
    if not app.rep_can_use_area(p_area_id) then
      perform app.raise_denied('reps add salons only in their own territories');
    end if;
    if p_source not in ('map_pin', 'sweep', 'referral', 'manual') then
      perform app.raise_denied('reps add salons from the field only');
    end if;
  end if;
  select * into v from public.salon where id = p_id;
  if v.id is not null then
    if v.created_by = auth.uid() and v.area_id = p_area_id and v.type = p_type then return v; end if;  -- replay
    raise exception using errcode = '23505', message = 'salon id already used';
  end if;
  if v_role <> 'rep' and not exists (select 1 from public.area where id = p_area_id) then
    raise exception using errcode = '22023', message = 'unknown area';
  end if;
  perform app.set_purpose('salon created');
  insert into public.salon (id, name, type, area_id, address, lat, lng, chairs, source, discovered_by, created_by,
                            created_at_client)
  values (p_id, nullif(btrim(p_name), ''), p_type, p_area_id, p_address, p_lat, p_lng, p_chairs, p_source,
          auth.uid(), auth.uid(), p_created_at_client)
  returning * into v;
  insert into public.stage_event (salon_id, from_stage, to_stage, trigger, actor_id)
  values (v.id, null, 'prospect', 'created', auth.uid());
  if p_contact_phone is not null then
    insert into public.salon_contact (salon_id, name, phone, created_by)
    values (v.id, nullif(btrim(p_contact_name), ''), p_contact_phone, auth.uid());
  end if;
  if p_note is not null and length(btrim(p_note)) > 0 then
    insert into public.salon_note (client_id, salon_id, author_id, body, created_at_client)
    values (gen_random_uuid(), v.id, auth.uid(), p_note, p_created_at_client);
  end if;
  return v;
end $$;
