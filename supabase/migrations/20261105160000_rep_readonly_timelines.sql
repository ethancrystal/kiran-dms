-- =============================================================================
-- Kiran DMS · migration 20261105160000 · Rep read-only salons, salon proposals, office timelines
-- Completion slice 7 (P1-24). Requirements: SAL-05, SAL-09, SAL-13; doc 06 section 2; D-35, D-39;
-- spec 2026-11-05 rulings R3 and R4, sections 2, 3 and 5; docs/16-project-completion-goal.md
-- ("view permitted Salon information in read-only mode").
--
-- What changes:
--   * app.update_salon refuses every rep (42501) before it reads anything: reps cannot edit a salon
--     (R3, D-35). The owner and a manager edit as before. Same signature, so the grants stand.
--   * app.create_salon by a rep makes a PENDING salon: a proposal (R3). It has no rep assignment; it is
--     reachable under R4 (territory coverage) like any salon with no direct assignment, so the rep sees
--     it, adds notes and visits, but gets no card and no order until the office approves it through
--     app.office_decide_salon (slice 1), which may also assign a rep and a rate. The office's salons
--     stay approved. app.rep_park_salon is unchanged (B-28 default). Same signature.
--   * app.my_salon gains approval_status (last column), so the rep's salon page says a proposal waits.
--     The return type changes, so it is dropped and created again with the same grants.
--   * app.office_salon_timeline(salon) and app.office_order_timeline(order): owner or manager at AAL2
--     (app.assert_office). They read control.audit_event inside the function; the raw audit log stays
--     owner-only (its RLS policy is not touched). Each row is allow-listed: seq, when, the actor's name
--     and kind (role at the time, or 'salon' for a salon login, 'system' when there is none), an action
--     label from a fixed table-and-operation map, a short detail drawn only from enum or status columns
--     (or, for a salon edit, the NAMES of the changed fields), the entity table and its row id. Never
--     the before or after images, the ip, the device, the purpose (it holds typed reasons) or a hash.
--     Only the tables listed in the maps below are read; control.phone_reveal (owner-only) and every
--     vault, stock, location and investor table are left out. Newest 500 events, oldest first.
--   * Indexes on control.audit_event for the two lookups (row id per table, and the salon and order
--     ids in the row images). Nothing else on the audit table changes.
-- =============================================================================

-- ------------------------------------------------------------- update_salon ----
-- Migration 0019's body for the office; reps are refused first (D-35).
create or replace function app.update_salon(
  p_id uuid, p_name text, p_type public.salon_type, p_area_id uuid,
  p_address text default null, p_lat numeric default null, p_lng numeric default null, p_chairs integer default null)
returns public.salon
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  v      public.salon;
begin
  if v_role not in ('owner', 'manager') or not app.is_office() then
    perform app.raise_denied('only the office edits a salon: reps read salon details and add notes (D-35)');
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

-- ------------------------------------------------------------- create_salon ----
-- Migration 0020's body; a rep's salon is a pending proposal (R3), the office's is approved.
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
  perform app.set_purpose(case when v_role = 'rep' then 'salon proposed' else 'salon created' end);
  insert into public.salon (id, name, type, area_id, address, lat, lng, chairs, source, discovered_by, created_by,
                            created_at_client, approval_status)
  values (p_id, app.blank_to_null(p_name), p_type, p_area_id, app.blank_to_null(p_address), p_lat, p_lng, p_chairs, p_source,
          auth.uid(), auth.uid(), p_created_at_client,
          case when v_role = 'rep' then 'pending' else 'approved' end::public.salon_approval)
  returning * into v;
  insert into public.stage_event (salon_id, from_stage, to_stage, trigger, actor_id)
  values (v.id, null, 'prospect', 'created', auth.uid());
  if p_contact_phone is not null then
    insert into public.salon_contact (salon_id, name, phone, created_by)
    values (v.id, app.blank_to_null(p_contact_name), p_contact_phone, auth.uid());
  end if;
  if app.blank_to_null(p_note) is not null then
    insert into public.salon_note (client_id, salon_id, author_id, body, created_at_client)
    values (gen_random_uuid(), v.id, auth.uid(), p_note, p_created_at_client);
  end if;
  return v;
end $$;

comment on column public.salon.approval_status is
  'D-35. Office-added salons are approved; a rep''s proposal (app.create_salon by a rep, slice 7) stays pending until the office decides. Only an approved salon gets an order or a card. Changes only with a salon_approval_decision.';

-- ----------------------------------------------------------------- my_salon ----
-- Migration 20261105100000's my_salon, plus approval_status as the last column.
drop function app.my_salon(uuid);
create function app.my_salon(p_id uuid)
returns table (id uuid, name text, type public.salon_type, stage public.salon_stage,
               verification_status public.salon_verification, area_id uuid, area_name text,
               lat numeric, lng numeric, phone_masked text, address text, chairs integer,
               approval_status public.salon_approval)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.type, s.stage, s.verification_status, a.id, a.name, s.lat, s.lng,
         app.mask_phone((select c.phone from public.salon_contact c
                         where c.salon_id = s.id and c.is_primary and c.active)),
         s.address, s.chairs, s.approval_status
  from public.salon s join public.area a on a.id = s.area_id
  where s.id = p_id and app.self_ok() and app.user_role() = 'rep'
    and app.rep_holds_salon(auth.uid(), s.id)
$$;
revoke execute on function app.my_salon(uuid) from public, anon, authenticated, service_role;
grant execute on function app.my_salon(uuid) to authenticated;

-- ------------------------------------------------------------ audit indexes ----
create index if not exists audit_event_table_row_idx on control.audit_event (table_name, row_id);
create index if not exists audit_event_salon_ref_idx
  on control.audit_event ((coalesce(after ->> 'salon_id', before ->> 'salon_id')));
create index if not exists audit_event_order_ref_idx
  on control.audit_event ((coalesce(after ->> 'order_id', before ->> 'order_id')));
create index if not exists audit_event_subject_ref_idx
  on control.audit_event ((coalesce(after ->> 'subject_id', before ->> 'subject_id')))
  where table_name = 'control.approval_request';

-- ----------------------------------------------------------------- timelines ----
-- Internal (no grant). Who did it, from the event's own actor: a staff profile's name and the role
-- recorded at the time; a salon login's membership name; else nobody (the system or a migration).
create function app.timeline_actor(p_actor uuid, p_role text)
returns table (actor_name text, actor_kind text)
language sql stable security definer set search_path = '' as $$
  select coalesce(
           (select u.full_name from public.user_profile u where u.id = p_actor),
           (select m.full_name from public.salon_membership m where m.user_id = p_actor order by m.created_at desc limit 1)),
         case
           when p_actor is null then 'system'
           when p_role is not null then p_role
           when exists (select 1 from public.salon_membership m where m.user_id = p_actor) then 'salon'
           else 'system'
         end
$$;

-- Internal (no grant). The label and detail of one event, from a fixed map. The detail is an enum or
-- status value, or for a salon edit the names of the fields that changed; never a typed text, an
-- amount, a phone, a pin or a reason.
create function app.timeline_label(p_table text, p_action text, p_before jsonb, p_after jsonb)
returns table (action text, detail text)
language sql immutable set search_path = '' as $$
  select
    case p_table
      when 'public.salon' then
        case p_action when 'INSERT' then
               case p_after ->> 'approval_status' when 'pending' then 'salon proposed' else 'salon added' end
             else 'salon updated' end
      when 'public.salon_contact'           then case p_action when 'INSERT' then 'phone added' else 'phone changed' end
      when 'public.salon_note'              then 'note added'
      when 'public.stage_event'             then 'stage changed'
      when 'public.visit'                   then 'visit logged'
      when 'public.salon_approval_decision' then 'salon ' || coalesce(p_after ->> 'decision', 'decided')
      when 'public.salon_rep_assignment'    then case when p_after ->> 'rep_id' is null then 'rep cleared' else 'rep assigned' end
      when 'public.salon_membership'        then case p_action when 'INSERT' then 'salon account joined' else 'salon account changed' end
      when 'public.invitation'              then case p_action when 'INSERT' then 'invitation sent' else 'invitation changed' end
      when 'public.salon_sku_price'         then 'salon price set'
      when 'public.salon_credit'            then 'credit settings changed'
      when 'public.credit_event'            then 'credit event'
      when 'public.order_intake_card'       then
        case p_action when 'INSERT' then
               case p_after ->> 'submitter_kind' when 'salon' then 'request sent' else 'order card saved' end
             else 'request updated' end
      when 'public.order_intake_card_version' then 'request edited'
      when 'public.order_intake_card_close' then 'request ' || coalesce(p_after ->> 'outcome', 'closed')
      when 'public.sales_order'             then case p_action when 'INSERT' then 'order created' else 'order updated' end
      when 'public.sales_order_line'        then 'order line added'
      when 'public.delivery'                then 'delivery recorded'
      when 'public.invoice'                 then 'invoice issued'
      when 'public.installment'             then 'installment scheduled'
      when 'public.payment'                 then 'payment recorded'
      when 'public.payment_allocation'      then 'payment allocated'
      when 'control.approval_request'       then case p_action when 'INSERT' then 'approval requested' else 'approval decided' end
      else 'changed'
    end,
    case p_table
      when 'public.salon' then
        case p_action when 'INSERT' then p_after ->> 'approval_status'
          else nullif(concat_ws(', ',
                 case when p_after -> 'name'    is distinct from p_before -> 'name'    then 'name' end,
                 case when p_after -> 'type'    is distinct from p_before -> 'type'    then 'type' end,
                 case when p_after -> 'area_id' is distinct from p_before -> 'area_id' then 'area' end,
                 case when p_after -> 'address' is distinct from p_before -> 'address' then 'address' end,
                 case when (p_after -> 'lat', p_after -> 'lng') is distinct from (p_before -> 'lat', p_before -> 'lng') then 'pin' end,
                 case when p_after -> 'chairs'  is distinct from p_before -> 'chairs'  then 'chairs' end,
                 case when p_after -> 'stage'   is distinct from p_before -> 'stage'   then 'stage' end,
                 case when p_after -> 'approval_status' is distinct from p_before -> 'approval_status' then 'approval' end), '')
        end
      when 'public.stage_event'             then p_after ->> 'to_stage'
      when 'public.visit'                   then p_after ->> 'outcome'
      when 'public.salon_membership'        then p_after ->> 'status'
      when 'public.invitation'              then p_after ->> 'status'
      when 'public.sales_order'             then p_after ->> 'status'
      when 'public.order_intake_card_close' then p_after ->> 'outcome'
      when 'public.payment'                 then p_after ->> 'method'
      when 'control.approval_request'       then concat_ws(' ', p_after ->> 'kind', p_after ->> 'status')
      else null
    end
$$;

-- The salon's timeline: the salon row and the rows of the listed tables that name the salon.
create function app.office_salon_timeline(p_salon_id uuid)
returns table (seq bigint, occurred_at timestamptz, actor_name text, actor_kind text, action text,
               detail text, entity text, entity_id text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  if p_salon_id is null or not exists (select 1 from public.salon s where s.id = p_salon_id) then
    raise exception using errcode = '22023', message = 'unknown salon';
  end if;
  return query
  select e.seq, e.occurred_at, who.actor_name, who.actor_kind, lbl.action, lbl.detail,
         e.table_name, e.row_id
  from (
    select x.* from control.audit_event x
    where (x.table_name = 'public.salon' and x.row_id = p_salon_id::text)
       or (x.table_name in ('public.salon_contact', 'public.salon_note', 'public.stage_event', 'public.visit',
                            'public.salon_approval_decision', 'public.salon_rep_assignment', 'public.salon_membership',
                            'public.invitation', 'public.salon_sku_price', 'public.salon_credit', 'public.credit_event',
                            'public.order_intake_card', 'public.sales_order', 'public.delivery', 'public.invoice',
                            'public.payment')
           and coalesce(x.after ->> 'salon_id', x.before ->> 'salon_id') = p_salon_id::text)
    order by x.seq desc
    limit 500
  ) e
  cross join lateral app.timeline_actor(e.actor_id, e.actor_role) who
  cross join lateral app.timeline_label(e.table_name, e.action, e.before, e.after) lbl
  order by e.seq;
end $$;

-- The order's timeline: the order row and the rows of the listed tables that name the order, the
-- request it came from, its approval requests and the payments allocated to its installments.
create function app.office_order_timeline(p_order_id uuid)
returns table (seq bigint, occurred_at timestamptz, actor_name text, actor_kind text, action text,
               detail text, entity text, entity_id text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cards       text[];
  v_installment text[];
begin
  perform app.assert_office();
  if p_order_id is null or not exists (select 1 from public.sales_order o where o.id = p_order_id) then
    raise exception using errcode = '22023', message = 'unknown order';
  end if;
  select coalesce(array_agg(c.card_id::text), '{}') into v_cards
  from public.order_intake_card_close c where c.order_id = p_order_id;
  select coalesce(array_agg(i.id::text), '{}') into v_installment
  from public.installment i join public.invoice v on v.id = i.invoice_id where v.order_id = p_order_id;
  return query
  select e.seq, e.occurred_at, who.actor_name, who.actor_kind, lbl.action, lbl.detail,
         e.table_name, e.row_id
  from (
    select x.* from control.audit_event x
    where (x.table_name = 'public.sales_order' and x.row_id = p_order_id::text)
       or (x.table_name in ('public.sales_order_line', 'public.credit_event', 'public.delivery', 'public.invoice',
                            'public.order_intake_card_close')
           and coalesce(x.after ->> 'order_id', x.before ->> 'order_id') = p_order_id::text)
       or (x.table_name = 'control.approval_request'
           and coalesce(x.after ->> 'subject_id', x.before ->> 'subject_id') = p_order_id::text)
       or (x.table_name = 'public.order_intake_card' and x.row_id = any (v_cards))
       or (x.table_name = 'public.order_intake_card_version'
           and coalesce(x.after ->> 'card_id', x.before ->> 'card_id') = any (v_cards))
       or (x.table_name = 'public.installment' and x.row_id = any (v_installment))
       or (x.table_name = 'public.payment_allocation'
           and coalesce(x.after ->> 'installment_id', x.before ->> 'installment_id') = any (v_installment))
    order by x.seq desc
    limit 500
  ) e
  cross join lateral app.timeline_actor(e.actor_id, e.actor_role) who
  cross join lateral app.timeline_label(e.table_name, e.action, e.before, e.after) lbl
  order by e.seq;
end $$;

-- ----------------------------------------------------------------- privileges ----
revoke execute on function app.timeline_actor(uuid, text), app.timeline_label(text, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function app.office_salon_timeline(uuid), app.office_order_timeline(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.office_salon_timeline(uuid), app.office_order_timeline(uuid) to authenticated;
