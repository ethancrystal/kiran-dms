-- =============================================================================
-- Kiran DMS · migration 20261106040000 · H2: timelines show delivery submissions, decisions, signatures
--                                         and payment reversals
-- Requirements: C2 (plan item "Timelines cover delivery submissions, commission, signatures, reversals,
--               settlements"), H-08, H-13, H-17.
-- Decisions: none new. Scope ruling from hermes.md H2: four tables are added (delivery_submission,
--            delivery_submission_decision, delivery_signature, payment_reversal). Commission, handover
--            settlement, pending-stock resolution, signature use/image/access, stock, location, vault and
--            investor tables stay out: they name neither a salon nor an order, or hold pictures.
--
-- What changes: app.timeline_label, app.office_salon_timeline and app.office_order_timeline are replaced
-- with the same arguments and return types (no grant changes). Labels are fixed strings; the detail of a
-- signature is its outcome only. No reason, name, token, hash or picture reaches the timeline.
-- =============================================================================

create or replace function app.timeline_label(p_table text, p_action text, p_before jsonb, p_after jsonb)
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
      when 'public.delivery_submission'          then 'delivery submitted'
      when 'public.delivery_submission_decision' then 'delivery ' || coalesce(p_after ->> 'outcome', 'decided')
      when 'public.delivery_signature'           then 'receipt acknowledgement'
      when 'public.payment_reversal'             then 'payment reversed'
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
      when 'public.delivery_signature'           then p_after ->> 'outcome'
      else null
    end
$$;

create or replace function app.office_salon_timeline(p_salon_id uuid)
returns table (seq bigint, occurred_at timestamptz, actor_name text, actor_kind text, action text,
               detail text, entity text, entity_id text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_submission text[];
begin
  perform app.assert_office();
  if p_salon_id is null or not exists (select 1 from public.salon s where s.id = p_salon_id) then
    raise exception using errcode = '22023', message = 'unknown salon';
  end if;
  select coalesce(array_agg(s.id::text), '{}') into v_submission
  from public.delivery_submission s where s.salon_id = p_salon_id;
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
                            'public.payment', 'public.delivery_submission', 'public.delivery_signature')
           and coalesce(x.after ->> 'salon_id', x.before ->> 'salon_id') = p_salon_id::text)
       or (x.table_name = 'public.delivery_submission_decision'
           and coalesce(x.after ->> 'submission_id', x.before ->> 'submission_id') = any (v_submission))
       or (x.table_name = 'public.payment_reversal'
           and exists (select 1 from public.payment p where p.salon_id = p_salon_id
                       and p.id::text = coalesce(x.after ->> 'payment_id', x.before ->> 'payment_id')))
    order by x.seq desc
    limit 500
  ) e
  cross join lateral app.timeline_actor(e.actor_id, e.actor_role) who
  cross join lateral app.timeline_label(e.table_name, e.action, e.before, e.after) lbl
  order by e.seq;
end $$;

create or replace function app.office_order_timeline(p_order_id uuid)
returns table (seq bigint, occurred_at timestamptz, actor_name text, actor_kind text, action text,
               detail text, entity text, entity_id text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cards       text[];
  v_installment text[];
  v_submission  text[];
  v_payment     text[];
begin
  perform app.assert_office();
  if p_order_id is null or not exists (select 1 from public.sales_order o where o.id = p_order_id) then
    raise exception using errcode = '22023', message = 'unknown order';
  end if;
  select coalesce(array_agg(c.card_id::text), '{}') into v_cards
  from public.order_intake_card_close c where c.order_id = p_order_id;
  select coalesce(array_agg(i.id::text), '{}') into v_installment
  from public.installment i join public.invoice v on v.id = i.invoice_id where v.order_id = p_order_id;
  select coalesce(array_agg(s.id::text), '{}') into v_submission
  from public.delivery_submission s where s.order_id = p_order_id;
  select coalesce(array_agg(distinct a.payment_id::text), '{}') into v_payment
  from public.payment_allocation a where a.installment_id::text = any (v_installment);
  return query
  select e.seq, e.occurred_at, who.actor_name, who.actor_kind, lbl.action, lbl.detail,
         e.table_name, e.row_id
  from (
    select x.* from control.audit_event x
    where (x.table_name = 'public.sales_order' and x.row_id = p_order_id::text)
       or (x.table_name in ('public.sales_order_line', 'public.credit_event', 'public.delivery', 'public.invoice',
                            'public.order_intake_card_close', 'public.delivery_submission', 'public.delivery_signature')
           and coalesce(x.after ->> 'order_id', x.before ->> 'order_id') = p_order_id::text)
       or (x.table_name = 'control.approval_request'
           and coalesce(x.after ->> 'subject_id', x.before ->> 'subject_id') = p_order_id::text)
       or (x.table_name = 'public.order_intake_card' and x.row_id = any (v_cards))
       or (x.table_name = 'public.order_intake_card_version'
           and coalesce(x.after ->> 'card_id', x.before ->> 'card_id') = any (v_cards))
       or (x.table_name = 'public.installment' and x.row_id = any (v_installment))
       or (x.table_name = 'public.payment_allocation'
           and coalesce(x.after ->> 'installment_id', x.before ->> 'installment_id') = any (v_installment))
       or (x.table_name = 'public.delivery_submission_decision'
           and coalesce(x.after ->> 'submission_id', x.before ->> 'submission_id') = any (v_submission))
       or (x.table_name = 'public.payment_reversal'
           and coalesce(x.after ->> 'payment_id', x.before ->> 'payment_id') = any (v_payment))
    order by x.seq desc
    limit 500
  ) e
  cross join lateral app.timeline_actor(e.actor_id, e.actor_role) who
  cross join lateral app.timeline_label(e.table_name, e.action, e.before, e.after) lbl
  order by e.seq;
end $$;
