-- =============================================================================
-- Kiran DMS · migration 0016 · One salon for the rep, with what the edit form needs
-- Requirements: SAL-01 (edit a salon), H-14 (reps read through capped app.* functions).
-- Execution map slice 3 (salon edit). ACTIVITY C-014.
--
-- app.my_salons returns the list columns only, so a rep's edit form could not show the address
-- or chair count it is about to change (app.update_salon keeps a field when it gets null,
-- migration 0014). app.my_salon returns one salon with the same scope as app.my_salons (a rep,
-- ready, in one of their own territories; nothing for anyone else), the phone masked as there,
-- plus address and chairs. One row, so the 50-row page cap is not needed. Read only.
-- =============================================================================

create function app.my_salon(p_id uuid)
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
    and a.territory_id in (select app.my_territory_ids())
$$;

revoke execute on function app.my_salon(uuid) from public, anon, authenticated, service_role;
grant execute on function app.my_salon(uuid) to authenticated;
