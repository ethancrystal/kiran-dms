-- =============================================================================
-- Kiran DMS · migration 0014 · A partial salon edit keeps what it does not name
-- Requirements: SAL-01 (edit a salon), MAP-02 (the pin), H-07 (history is not erased).
-- Found by the independent audit of 2026-11-01 (ACTIVITY L-0192, defect 1).
--
-- app.update_salon (migration 0009) took address, lat, lng and chairs as parameters that
-- default to null and then wrote them unconditionally, so an edit that only named the salon
-- and its area erased the address, the pin and the chair count. A null parameter now means
-- "leave as it is". The pin moves only as a pair (the salon_geo_pair check): passing one of
-- lat and lng is refused with a clear message instead of a constraint error. Who may call it,
-- the territory checks and the signature are unchanged, so the existing grants stay.
-- Whether a rep may move a pin at all is a question for MJ (B-31 a) and is not changed here.
-- =============================================================================

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
         address = coalesce(p_address, address),
         lat     = coalesce(p_lat, lat),
         lng     = coalesce(p_lng, lng),
         chairs  = coalesce(p_chairs, chairs)
   where id = p_id returning * into v;
  if v.id is null then raise exception using errcode = '22023', message = 'unknown salon'; end if;
  return v;
end $$;
