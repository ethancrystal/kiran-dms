-- =============================================================================
-- Kiran DMS · migration 20261111010000 · P1-38 order steps and approval reminders
-- Requirements: D-59, D-60, MSG-03, ORD-04. Plan G. Real mail waits on B-61.
--
-- What this adds:
--   * A fixed step registry, and a projection of one order onto those steps from the
--     records that already exist. Nothing here writes an order, a delivery, an invoice
--     or an approval. Closed stays upcoming (B-45): no function sets status closed.
--   * Office and salon reads. The salon read has no actor name.
--   * control.approval_reminder_log, append-only, and the service-role functions that
--     list one grouped reminder per person and record one round. No pg_cron and no
--     network. The mail service is not named (B-61), so nothing is sent from here.
--
-- A rep order sorts "out for delivery" at the submission, before goods are released.
-- An office order sorts the customer's acknowledgement before goods are released,
-- because that delivery is signed first (D-49).
-- =============================================================================

-- ---------------------------------------------------------------- registry ----
-- Internal. Regular User steps are listed and unused: no shopify channel is added (Plan F).
create function app.order_step_registry()
returns table (
  step_key text,
  meaning text,
  performer text,
  needs_approval boolean,
  applies_to text,
  rep_sort integer,
  office_sort integer
)
language sql immutable set search_path = '' as $$
  select * from (values
    ('request_received', 'Request received', 'rep or salon', false, 'client_salon', 10, 10),
    ('request_reviewed', 'Request reviewed', 'manager or owner', false, 'client_salon', 20, 20),
    ('official_order_created', 'Official order created', 'office', false, 'client_salon', 30, 30),
    ('price_or_credit_approval', 'Price or credit approval', 'manager or owner', true, 'client_salon', 40, 40),
    ('delivery_submitted', 'Delivery submitted', 'rep', false, 'client_salon', 50, null::integer),
    ('out_for_delivery', 'Out for delivery', 'rep or office', false, 'client_salon', 60, 70),
    ('customer_acknowledged', 'Customer acknowledged', 'salon', false, 'client_salon', 70, 50),
    ('delivery_approved', 'Delivery approved', 'manager or owner', true, 'client_salon', 80, 80),
    ('goods_released', 'Goods released', 'system', false, 'client_salon', 90, 60),
    ('invoice_issued', 'Invoice issued', 'system', false, 'client_salon', 100, 90),
    ('delivered', 'Delivered', 'system', false, 'client_salon', 110, 100),
    ('closed', 'Closed', 'office', false, 'client_salon', 120, 110),
    ('cancelled', 'Cancelled', 'manager or owner', false, 'client_salon', null::integer, null::integer),
    ('paid_on_shopify', 'Paid on Shopify', 'direct buyer', false, 'regular_user', null::integer, null::integer),
    ('dispatched_with_rider', 'Dispatched with a rider and marked delivered', 'manager or owner', false, 'regular_user', null::integer, null::integer)
  ) as t(step_key, meaning, performer, needs_approval, applies_to, rep_sort, office_sort)
$$;

comment on function app.order_step_registry() is
  'P1-38. The fixed order steps. needs_approval is true only for price or credit, and for delivery approval. Regular User rows are listed and not projected.';

-- ------------------------------------------------------------- projection ----
-- Internal (no grant). One row per applicable step. A step with proof stays done even
-- when an earlier step is not. The first not-done step is current, later ones upcoming.
-- Closed is always upcoming. A cancelled order keeps the steps already done and adds
-- cancelled; steps that had not happened are omitted.
create function app.order_steps_projected(p_order_id uuid)
returns table (
  step_key text,
  meaning text,
  performer text,
  needs_approval boolean,
  state text,
  occurred_at timestamptz,
  actor_id uuid,
  actor_role text,
  sort_no integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_order public.sales_order;
  v_rep boolean;
  v_card public.order_intake_card;
  v_close public.order_intake_card_close;
  v_reviewed boolean := false;
  v_sub public.delivery_submission;
  v_dec public.delivery_submission_decision;
  v_del public.delivery;
  v_latest public.delivery;
  v_sig public.delivery_signature;
  v_inv public.invoice;
  v_price_needed boolean;
  v_credit_needed boolean;
  v_price_on boolean;
  v_price_done boolean;
  v_price_actor uuid;
  v_price_at timestamptz;
begin
  select * into v_order from public.sales_order s where s.id = p_order_id;
  if not found then
    return;
  end if;

  -- A submission means the rep path, even when the office created the order from a request.
  v_rep := v_order.source_channel = 'rep_visit'
    or exists (select 1 from public.delivery_submission s where s.order_id = v_order.id);

  select * into v_card from public.order_intake_card c where c.id = v_order.intake_card_id;
  select * into v_close from public.order_intake_card_close c
   where c.card_id = v_order.intake_card_id and c.order_id = v_order.id
   order by c.closed_at, c.id
   limit 1;
  v_reviewed := found;

  select * into v_sub from public.delivery_submission s
   where s.order_id = v_order.id
   order by s.submitted_at, s.id
   limit 1;
  select * into v_dec from public.delivery_submission_decision d where d.submission_id = v_sub.id;
  select * into v_del from public.delivery d
   where d.order_id = v_order.id
   order by d.delivered_at, d.id
   limit 1;
  select * into v_latest from public.delivery d
   where d.order_id = v_order.id
   order by d.delivered_at desc, d.id desc
   limit 1;
  select * into v_sig from public.delivery_signature g
   where g.order_id = v_order.id and g.outcome = 'signed'
   order by g.signed_at, g.id
   limit 1;
  select * into v_inv from public.invoice i
   where i.order_id = v_order.id
   order by i.issued_at, i.id
   limit 1;

  v_price_needed := v_order.hold_discount is not null
    or exists (
      select 1 from control.approval_request a
      where a.kind = 'discount' and a.subject_type = 'sales_order' and a.subject_id = v_order.id);
  v_credit_needed := v_order.hold_credit is not null
    or v_order.credit_override_by is not null
    or exists (
      select 1 from public.credit_event e
      where e.kind = 'order_override' and e.order_id = v_order.id);
  v_price_on := v_price_needed or v_credit_needed;
  -- A refusal stays not done. The step is done only when every part that applies is clear.
  v_price_done := v_price_on
    and not exists (
      select 1 from control.approval_request a
      where a.kind = 'discount' and a.subject_type = 'sales_order' and a.subject_id = v_order.id
        and a.status in ('pending', 'rejected'))
    and v_order.hold_discount is null
    and (
      not v_price_needed
      or exists (
        select 1 from control.approval_request a
        where a.kind = 'discount' and a.subject_type = 'sales_order' and a.subject_id = v_order.id
          and a.status = 'approved')
      or not exists (
        select 1 from control.approval_request a
        where a.kind = 'discount' and a.subject_type = 'sales_order' and a.subject_id = v_order.id))
    and (
      v_order.hold_credit is null
      or v_order.credit_override_by is not null
      or exists (
        select 1 from public.credit_event e
        where e.kind = 'order_override' and e.order_id = v_order.id));

  if v_price_done then
    select s.actor, s.at into v_price_actor, v_price_at
    from (
      select a.checker_id as actor, a.decided_at as at
      from control.approval_request a
      where a.kind = 'discount' and a.subject_type = 'sales_order' and a.subject_id = v_order.id
        and a.status = 'approved'
      union all
      select e.actor_id, e.created_at
      from public.credit_event e
      where e.kind = 'order_override' and e.order_id = v_order.id
      union all
      select v_order.credit_override_by, v_order.confirmed_at
      where v_order.credit_override_by is not null
    ) s
    order by s.at desc nulls last
    limit 1;
  end if;

  return query
  with raw as (
    select * from (values
      ('request_received'::text,
        v_card.id is not null, v_card.id is not null,
        v_card.created_at, coalesce(v_card.rep_id, v_card.salon_user_id), null::integer),
      ('request_reviewed',
        v_card.id is not null, v_reviewed,
        v_close.closed_at, coalesce(v_close.closed_by, v_close.closed_by_salon_user), null::integer),
      ('official_order_created',
        true, true,
        v_order.created_at, v_order.created_by, null::integer),
      ('price_or_credit_approval',
        v_price_on, v_price_done,
        v_price_at, v_price_actor, null::integer),
      ('delivery_submitted',
        v_rep, v_sub.id is not null,
        v_sub.submitted_at, v_sub.rep_id, null::integer),
      ('out_for_delivery',
        true, case when v_rep then v_sub.id is not null else v_del.id is not null end,
        case when v_rep then v_sub.submitted_at else v_del.delivered_at end,
        case when v_rep then v_sub.rep_id else v_del.delivered_by end,
        null::integer),
      ('customer_acknowledged',
        true, v_sig.id is not null,
        v_sig.signed_at, v_sig.rep_id, null::integer),
      ('delivery_approved',
        true,
        case when v_rep then coalesce(v_dec.outcome = 'approved', false) else v_del.id is not null end,
        case when v_rep then v_dec.decided_at else v_del.delivered_at end,
        case when v_rep then v_dec.decided_by else v_del.delivered_by end,
        null::integer),
      ('goods_released',
        true, v_del.id is not null,
        v_del.delivered_at, v_del.delivered_by, null::integer),
      ('invoice_issued',
        true, v_inv.id is not null,
        v_inv.issued_at, v_inv.issued_by, null::integer),
      ('delivered',
        true, v_order.status = 'delivered'::public.order_status,
        v_latest.delivered_at, v_latest.delivered_by, null::integer),
      ('closed',
        true, false,
        null::timestamptz, null::uuid, null::integer),
      ('cancelled',
        v_order.status = 'cancelled'::public.order_status,
        v_order.status = 'cancelled'::public.order_status,
        v_order.cancelled_at, v_order.cancelled_by, 200)
    ) as t(step_key, applicable, done, occurred_at, actor_id, sort_override)
  ),
  joined as (
    select t.step_key, g.meaning, g.performer, g.needs_approval, t.done,
           case when t.done then t.occurred_at end as occurred_at,
           case when t.done then t.actor_id end as actor_id,
           coalesce(t.sort_override, case when v_rep then g.rep_sort else g.office_sort end) as sort_no
    from raw t
    join app.order_step_registry() g on g.step_key = t.step_key
    where g.applies_to = 'client_salon'
      and t.applicable
      and coalesce(t.sort_override, case when v_rep then g.rep_sort else g.office_sort end) is not null
      and (v_order.status is distinct from 'cancelled'::public.order_status or t.done)
  ),
  marked as (
    select j.*,
           coalesce(bool_and(j.done) over (
             order by j.sort_no rows between unbounded preceding and 1 preceding), true) as prev_done
    from joined j
  )
  select m.step_key, m.meaning, m.performer, m.needs_approval,
         case
           when m.step_key = 'closed' then 'upcoming'
           when m.done then 'done'
           when m.prev_done then 'current'
           else 'upcoming'
         end,
         m.occurred_at, m.actor_id,
         case when m.done then (select u.role::text from public.user_profile u where u.id = m.actor_id) end,
         m.sort_no
  from marked m
  order by m.sort_no;
end $$;

comment on function app.order_steps_projected(uuid) is
  'P1-38. Internal. Projects one order onto the client-salon steps. No grant.';

-- ----------------------------------------------------------------- office ----
create function app.office_order_steps(p_order_id uuid)
returns table (
  step_key text,
  meaning text,
  performer text,
  needs_approval boolean,
  state text,
  occurred_at timestamptz,
  actor_name text,
  actor_kind text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  if p_order_id is null or not exists (select 1 from public.sales_order s where s.id = p_order_id) then
    raise exception using errcode = '22023', message = 'unknown order';
  end if;
  return query
  select s.step_key, s.meaning, s.performer, s.needs_approval, s.state,
         case when s.state = 'done' then s.occurred_at end,
         case when s.state = 'done' then who.actor_name end,
         case when s.state = 'done' then who.actor_kind end
  from app.order_steps_projected(p_order_id) s
  cross join lateral app.timeline_actor(
    case when s.state = 'done' then s.actor_id end,
    case when s.state = 'done' then s.actor_role end) who
  order by s.sort_no;
end $$;

comment on function app.office_order_steps(uuid) is
  'P1-38. Office read of one order''s steps at AAL2. Actor name and kind only on a done step.';

-- ------------------------------------------------------------------ salon ----
-- Same projection, own orders only. No actor name, so a salon does not learn who in the office acted.
create function app.salon_order_steps(p_order_id uuid)
returns table (
  step_key text,
  meaning text,
  state text,
  occurred_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_salon uuid := app.assert_salon_member();
begin
  if not exists (select 1 from public.sales_order s where s.id = p_order_id and s.salon_id = v_salon) then
    perform app.raise_denied('not your order');
  end if;
  return query
  select s.step_key, s.meaning, s.state, case when s.state = 'done' then s.occurred_at end
  from app.order_steps_projected(p_order_id) s
  order by s.sort_no;
end $$;

comment on function app.salon_order_steps(uuid) is
  'P1-38. A salon reads the steps of its own order. Unknown and another salon are the same refusal. No actor name.';

-- --------------------------------------------------------- reminder log ----
-- One row per person, per item, per round. No policies: the office reads it through a function.
-- service_role may bypass RLS, so the revoke below is the barrier. The trigger blocks changes
-- for every role, including the table owner.
create table control.approval_reminder_log (
  id uuid primary key default gen_random_uuid(),
  item_kind text not null check (item_kind in ('discount', 'adjustment', 'delivery', 'stock', 'salon')),
  item_id uuid not null,
  recipient_id uuid not null references public.user_profile (id),
  round_no integer not null check (round_no >= 0),
  sent_at timestamptz not null default now(),
  result text not null check (result in ('claimed', 'sent', 'not_configured')),
  unique (item_kind, item_id, recipient_id, round_no)
);
create index approval_reminder_log_sent_idx on control.approval_reminder_log (sent_at desc, id desc);
comment on table control.approval_reminder_log is
  'P1-38, MSG-03. Append-only. One reminder round for one waiting item and one person. Real mail is not sent (B-61).';

alter table control.approval_reminder_log enable row level security;
alter table control.approval_reminder_log force row level security;

create trigger append_only before update or delete on control.approval_reminder_log
  for each row execute function control.forbid_mutation();
create trigger no_truncate before truncate on control.approval_reminder_log
  for each statement execute function control.forbid_mutation();
create trigger audit after insert or update or delete on control.approval_reminder_log
  for each row execute function control.audit_row();

-- The cadence MJ already set (B-61). Nothing is sent until a mail service is named.
insert into public.app_config (key, value, rep_visible, note) values
  ('reminders.interval_minutes', '120', false,
   'P1-38. Minutes between reminder rounds. Real mail waits on B-61.'),
  ('reminders.hours_start', '9', false,
   'P1-38. First hour, Asia/Karachi, when a reminder may be prepared.'),
  ('reminders.hours_end', '21', false,
   'P1-38. Last hour, Asia/Karachi, not included.'),
  ('reminders.owner_after_hours', '24', false,
   'P1-38. Hours before an owner is added on an item a manager can decide.'),
  ('reminders.on.discount', 'true', false, 'P1-38. Remind about a discount that is waiting.'),
  ('reminders.on.adjustment', 'true', false, 'P1-38. Remind about a stock adjustment that is waiting.'),
  ('reminders.on.delivery', 'true', false, 'P1-38. Remind about a delivery that is waiting for a decision.'),
  ('reminders.on.stock', 'true', false, 'P1-38. Remind about rejected goods that are still unsettled.'),
  ('reminders.on.salon', 'true', false, 'P1-38. Remind about a salon proposal that is waiting.')
on conflict (key) do nothing;

-- -------------------------------------------------------------- helpers ----
create function app.reminder_config_int(p_key text, p_default integer) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select (c.value #>> '{}')::integer
     from public.app_config c
     where c.key = p_key and (c.value #>> '{}') ~ '^-?[0-9]+$'),
    p_default)
$$;

create function app.reminder_enabled(p_kind text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select c.value = 'true'::jsonb from public.app_config c where c.key = 'reminders.on.' || p_kind),
    true)
$$;

-- The body is kind, reference, age and path. No price, quantity, salon name, person name or phone.
create function app.reminder_body(p_items jsonb) returns text
language sql immutable set search_path = '' as $$
  select coalesce(string_agg(
    format(
      '%s. Reference %s. Waiting %s. Open %s',
      i.kind,
      i.reference,
      case
        when coalesce(i.age_seconds, 0) < 3600 then 'under an hour'
        else floor(i.age_seconds / 3600)::integer::text || ' hours'
      end,
      i.path),
    E'\n' order by i.kind, i.reference),
    '')
  from jsonb_to_recordset(p_items) as i(kind text, reference text, age_seconds numeric, path text)
$$;

create function app.assert_service_role() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  -- current_user inside a security definer function is the owner, so the gate is the JWT claim.
  if coalesce(
       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
       '') is distinct from 'service_role' then
    perform app.raise_denied('service role only');
  end if;
end $$;

-- --------------------------------------------------------- what is waiting ----
-- One row per recipient: the text to send, and the claims the recorder stores.
-- Managers (except the maker) are included at once when they may decide.
-- An owner is included at once only when the owner is the checker.
-- An owner is also included after the configured wait on a manager item, still except the maker.
-- Nothing is due outside the Karachi window. A round already recorded waits out the interval.
create function app.approval_reminders_due(p_now timestamptz default now())
returns table (recipient_id uuid, body text, claims jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_start integer := app.reminder_config_int('reminders.hours_start', 9);
  v_end integer := app.reminder_config_int('reminders.hours_end', 21);
  v_interval integer := app.reminder_config_int('reminders.interval_minutes', 120);
  v_owner_after integer := app.reminder_config_int('reminders.owner_after_hours', 24);
  v_hour integer;
begin
  perform app.assert_service_role();
  if v_interval < 1 then
    v_interval := 120;
  end if;
  if v_owner_after < 0 then
    v_owner_after := 24;
  end if;
  v_hour := extract(hour from p_now at time zone 'Asia/Karachi')::integer;
  if p_now is null or v_start >= v_end or v_hour < v_start or v_hour >= v_end then
    return;
  end if;

  return query
  with items as (
    select 'discount'::text as kind, a.id as item_id, a.subject_id::text as reference,
           '/office/approvals'::text as path, a.maker_id as maker, a.checker_role_required::text as checker,
           a.created_at
    from control.approval_request a
    where app.reminder_enabled('discount')
      and a.status = 'pending' and a.kind = 'discount' and a.subject_type = 'sales_order'
      and a.subject_id is not null
    union all
    select 'adjustment', a.id, a.id::text, '/office/approvals', a.maker_id, a.checker_role_required::text, a.created_at
    from control.approval_request a
    where app.reminder_enabled('adjustment')
      and a.status = 'pending' and a.kind = 'adjustment'
    union all
    select 'delivery', s.id, s.order_id::text, '/office/deliveries', s.rep_id, 'manager', s.submitted_at
    from public.delivery_submission s
    where app.reminder_enabled('delivery')
      and not exists (select 1 from public.delivery_submission_decision d where d.submission_id = s.id)
    union all
    select 'stock', s.id, s.id::text, '/office/stock', s.rep_id, 'manager', x.decided_at
    from public.delivery_submission s
    join public.delivery_submission_decision x on x.submission_id = s.id and x.outcome = 'rejected'
    where app.reminder_enabled('stock')
      and exists (
        select 1 from jsonb_array_elements(s.lines) e
        where (e ->> 'sku_id') ~ '^[0-9a-fA-F-]{36}$'
          and app.pending_unsettled(s.id, (e ->> 'sku_id')::uuid) > 0
          and not exists (
            select 1 from control.approval_request a
            where a.kind = 'adjustment' and a.status = 'pending'
              and a.payload ->> 'submission_id' = s.id::text
              and a.payload ->> 'sku_id' = e ->> 'sku_id'))
    union all
    select 'salon', sa.id, sa.id::text, '/office/salons/approvals', sa.created_by, 'manager', sa.created_at
    from public.salon sa
    where app.reminder_enabled('salon') and sa.approval_status = 'pending'
  ),
  people as (
    select i.*, u.id as recipient_id
    from items i
    join public.user_profile u
      on u.status = 'active'
     and u.role in ('manager', 'owner')
     and u.id is distinct from i.maker
     and (
       (u.role = 'manager' and i.checker = 'manager')
       or (u.role = 'owner' and i.checker = 'owner')
       or (u.role = 'owner' and i.checker = 'manager'
           and p_now >= i.created_at + make_interval(hours => v_owner_after)))
  ),
  rounds as (
    select p.*,
           case when lg.round_no is null then 0 else lg.round_no + 1 end as round_no
    from people p
    left join lateral (
      select l.round_no, l.sent_at
      from control.approval_reminder_log l
      where l.item_kind = p.kind and l.item_id = p.item_id and l.recipient_id = p.recipient_id
      order by l.round_no desc
      limit 1
    ) lg on true
    where lg.round_no is null
       or lg.sent_at + make_interval(mins => v_interval) <= p_now
  )
  select r.recipient_id,
         app.reminder_body(jsonb_agg(
           jsonb_build_object(
             'kind', r.kind,
             'reference', r.reference,
             'age_seconds', extract(epoch from (p_now - r.created_at)),
             'path', r.path)
           order by r.created_at, r.kind, r.item_id)),
         jsonb_agg(
           jsonb_build_object('kind', r.kind, 'item_id', r.item_id, 'round_no', r.round_no)
           order by r.created_at, r.kind, r.item_id)
  from rounds r
  group by r.recipient_id;
end $$;

comment on function app.approval_reminders_due(timestamptz) is
  'P1-38. Service role only. One grouped reminder per person. Does not send mail (B-61).';

-- Records every claim or none. A repeated round returns 0, so the caller does not send again.
-- not_configured consumes the round when no mail service is configured.
create function app.record_approval_reminders(p_recipient uuid, p_claims jsonb, p_result text)
returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_n integer;
begin
  perform app.assert_service_role();
  if p_recipient is null
     or p_result is null
     or p_result not in ('claimed', 'sent', 'not_configured')
     or p_claims is null
     or jsonb_typeof(p_claims) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'bad reminder record';
  end if;
  if jsonb_array_length(p_claims) = 0 then
    return 0;
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_claims) e
    where jsonb_typeof(e) is distinct from 'object'
       or e ->> 'kind' not in ('discount', 'adjustment', 'delivery', 'stock', 'salon')
       or e ->> 'item_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or e ->> 'round_no' !~ '^[0-9]{1,9}$'
  ) then
    raise exception using errcode = '22023', message = 'bad reminder claims';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_claims) as c(kind text, item_id uuid, round_no integer)
    join control.approval_reminder_log l
      on l.item_kind = c.kind and l.item_id = c.item_id
     and l.recipient_id = p_recipient and l.round_no = c.round_no
  ) then
    return 0;
  end if;

  begin
    insert into control.approval_reminder_log (item_kind, item_id, recipient_id, round_no, result)
    select c.kind, c.item_id, p_recipient, c.round_no, p_result
    from jsonb_to_recordset(p_claims) as c(kind text, item_id uuid, round_no integer);
    get diagnostics v_n = row_count;
    return v_n;
  exception when unique_violation then
    return 0;
  end;
end $$;

comment on function app.record_approval_reminders(uuid, jsonb, text) is
  'P1-38. Service role only. Inserts a whole round or nothing. A second call for the same round returns 0.';

create function app.office_reminder_log()
returns table (
  item_kind text,
  item_id uuid,
  recipient_id uuid,
  round_no integer,
  sent_at timestamptz,
  result text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.assert_office();
  return query
  select l.item_kind, l.item_id, l.recipient_id, l.round_no, l.sent_at, l.result
  from control.approval_reminder_log l
  order by l.sent_at desc, l.id desc
  limit 200;
end $$;

comment on function app.office_reminder_log() is
  'P1-38. Office read of the reminder log at AAL2. The table itself has no grant and no policy.';

-- -------------------------------------------------------------- privileges ----
revoke all on function app.order_step_registry() from public, anon, authenticated, service_role;
revoke all on function app.order_steps_projected(uuid) from public, anon, authenticated, service_role;
revoke all on function app.reminder_config_int(text, integer) from public, anon, authenticated, service_role;
revoke all on function app.reminder_enabled(text) from public, anon, authenticated, service_role;
revoke all on function app.reminder_body(jsonb) from public, anon, authenticated, service_role;
revoke all on function app.assert_service_role() from public, anon, authenticated, service_role;

revoke all on function app.office_order_steps(uuid) from public, anon, authenticated, service_role;
revoke all on function app.salon_order_steps(uuid) from public, anon, authenticated, service_role;
revoke all on function app.office_reminder_log() from public, anon, authenticated, service_role;
grant execute on function app.office_order_steps(uuid), app.salon_order_steps(uuid), app.office_reminder_log()
  to authenticated;

revoke all on function app.approval_reminders_due(timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.record_approval_reminders(uuid, jsonb, text) from public, anon, authenticated, service_role;
-- Foundation grants schema app to authenticated only. The service role needs usage to call these two
-- functions and no others (execute stays revoked everywhere else).
grant usage on schema app to service_role;
grant execute on function app.approval_reminders_due(timestamptz), app.record_approval_reminders(uuid, jsonb, text)
  to service_role;

revoke all on table control.approval_reminder_log from public, anon, authenticated, service_role;
