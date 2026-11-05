-- =============================================================================
-- Kiran DMS · migration 20261105190000 · Rep detail and document lists for the office
-- Completion slice 10 (P1-28; docs/superpowers/plans/2026-11-05-frontend-structure.md sections 4, 6, F6).
-- Requirements: doc 16; ORD-05; CTL-01; FLD-06; D-38.
--
-- Read functions only. No table, column, policy, trigger or grant on a table changes; nothing here
-- writes a row (not even an audit row). Every list is filtered and capped in the database and carries
-- the total over all its rows, so a capped list can say so.
--
--   * app.office_rep_detail(p_rep_id): one rep's oversight page as one JSON value. Allow-listed fields
--     only. Masked phone; no device fingerprint, no GPS, no bag value limit, nothing from
--     supplier_vault, no cost, no credit snapshot. Cash and commission are not repeated here: the page
--     reads app.office_rep_cash_position and app.office_commission (no second formula); this function
--     gives it the Karachi month's first and last day for that call.
--   * app.office_invoices(p_salon_id): invoices, newest 100, with ids to open app.invoice_document.
--   * app.office_receipts(p_salon_id, p_invoice_id): receipts, newest 100, with ids to open
--     app.receipt_document. With p_invoice_id, the receipts of payments allocated to that invoice;
--     the amount is then what the payment allocated to it, as in the invoice document.
--
-- All three: owner or manager at AAL2 (app.assert_office). Errors: 42501 wrong role or session;
-- 22023 a missing or unknown id, or an id that is not a rep.
-- =============================================================================

create function app.office_rep_detail(p_rep_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role  public.app_role := app.assert_office();
  u       public.user_profile;
  v_bag   uuid;
  v_start date;
  v_end   date;
begin
  select * into u from public.user_profile x where x.id = p_rep_id and x.role = 'rep';
  if u.id is null then
    raise exception using errcode = '22023', message = 'unknown rep';
  end if;
  select l.id into v_bag from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = u.id;
  select m.month_start, m.month_end into v_start, v_end from app.overview_month(app.karachi_today()) m;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'rep_id', u.id, 'full_name', u.full_name, 'status', u.status, 'phone_masked', app.mask_phone(u.phone),
      'start_date', u.start_date, 'created_at', u.created_at),
    'month', jsonb_build_object('start', v_start, 'end', v_end),
    'devices', coalesce((select jsonb_agg(d order by d.created_at desc) from (
        select x.label, x.platform, x.status, x.created_at, x.approved_at, x.revoked_at, x.last_seen_at
        from public.device x where x.user_id = u.id
        order by x.created_at desc, x.id limit 20) d), '[]'::jsonb),
    'territories', coalesce((select jsonb_agg(t order by t.current desc, t.from_date desc) from (
        select tt.name, rt.from_date, rt.to_date, rt.to_date is null as current
        from public.rep_territory rt join public.territory tt on tt.id = rt.territory_id
        where rt.rep_id = u.id
        order by rt.to_date is null desc, rt.from_date desc, rt.id limit 20) t), '[]'::jsonb),
    -- The salons this rep holds today (R4, app.rep_holds_salon): directly assigned, or covered through a
    -- territory when no rep is assigned directly.
    'salons_total', (select count(*) from public.salon s where app.rep_holds_salon(u.id, s.id)),
    'salons', coalesce((select jsonb_agg(z order by z.direct desc, z.name, z.salon_id) from (
        select s.id as salon_id, s.name, s.stage, s.approval_status, app.salon_direct_rep(s.id) is not null as direct
        from public.salon s
        where app.rep_holds_salon(u.id, s.id)
        order by app.salon_direct_rep(s.id) is not null desc, s.name, s.id limit 50) z), '[]'::jsonb),
    'days_total', (select count(*) from public.rep_day d where d.rep_id = u.id),
    'days', coalesce((select jsonb_agg(y order by y.day desc) from (
        select d.day, d.status, d.check_in_at, d.check_out_at, d.bag_variance_units, d.close_reason,
               (select count(*) from public.visit v where v.rep_day_id = d.id) as visits
        from public.rep_day d where d.rep_id = u.id
        order by d.day desc limit 30) y), '[]'::jsonb),
    'visits_total', (select count(*) from public.visit v where v.rep_id = u.id),
    'visits', coalesce((select jsonb_agg(y order by y.arrived_at desc, y.visit_id) from (
        select v.id as visit_id, v.salon_id, s.name as salon_name, v.outcome, v.arrived_at, v.distance_from_pin_m,
               v.mock_location, v.notes
        from public.visit v join public.salon s on s.id = v.salon_id
        where v.rep_id = u.id
        order by v.arrived_at desc, v.id limit 50) y), '[]'::jsonb),
    'cards_total', (select count(*) from public.order_intake_card c where c.rep_id = u.id),
    'cards', coalesce((select jsonb_agg(y order by y.created_at desc, y.card_id) from (
        select c.id as card_id, c.salon_id, s.name as salon_name, app.card_body(c.id) as body, c.created_at,
               coalesce(x.outcome, 'open') as state, x.order_id
        from public.order_intake_card c
        join public.salon s on s.id = c.salon_id
        left join public.order_intake_card_close x on x.card_id = c.id
        where c.rep_id = u.id
        order by c.created_at desc, c.id limit 50) y), '[]'::jsonb),
    -- The same orders as Rep performance (app.rep_month_orders): the order's rep is this rep.
    'orders_total', (select count(*) from public.sales_order o where coalesce(o.assigned_rep_id, o.rep_id) = u.id),
    'orders', coalesce((select jsonb_agg(y order by y.created_at desc, y.order_id) from (
        select o.id as order_id, o.salon_id, s.name as salon_name, o.status, o.plan, o.total_paisa, o.created_at
        from public.sales_order o join public.salon s on s.id = o.salon_id
        where coalesce(o.assigned_rep_id, o.rep_id) = u.id
        order by o.created_at desc, o.id limit 50) y), '[]'::jsonb),
    -- Undecided submissions, oldest first; the amount as app.office_pending_deliveries works it. No GPS,
    -- no device. The decision is made on Delivery approvals, not from this read.
    'pending_total', (select count(*) from public.delivery_submission x
                      where x.rep_id = u.id
                        and not exists (select 1 from public.delivery_submission_decision d where d.submission_id = x.id)),
    'pending', coalesce((select jsonb_agg(y order by y.submitted_at, y.submission_id) from (
        select x.id as submission_id, x.order_id, x.salon_id, s.name as salon_name, x.submitted_at,
               (select coalesce(sum((e ->> 'qty')::bigint * ol.unit_price_paisa), 0)::bigint
                from jsonb_array_elements(x.lines) e
                join public.sales_order_line ol on ol.order_id = x.order_id and ol.sku_id = (e ->> 'sku_id')::uuid) as total_paisa
        from public.delivery_submission x join public.salon s on s.id = x.salon_id
        where x.rep_id = u.id
          and not exists (select 1 from public.delivery_submission_decision d where d.submission_id = x.id)
        order by x.submitted_at, x.id limit 50) y), '[]'::jsonb),
    'invoices_total', (select count(*) from public.invoice i where i.rep_id = u.id),
    'invoices', coalesce((select jsonb_agg(y order by y.issued_at desc, y.number desc) from (
        select i.id as invoice_id, i.number, i.issued_at, i.salon_id, s.name as salon_name, i.total_paisa
        from public.invoice i join public.salon s on s.id = i.salon_id
        where i.rep_id = u.id
        order by i.issued_at desc, i.number desc limit 20) y), '[]'::jsonb),
    -- Quantities only, as app.my_bag; the same stock movements decide them (H-10).
    'has_bag', v_bag is not null,
    'bag', coalesce((select jsonb_agg(y order by y.code) from (
        select k.code, k.variant, app.on_hand(v_bag, k.id) as on_hand
        from public.sku k
        where v_bag is not null and app.on_hand(v_bag, k.id) <> 0
        order by k.code) y), '[]'::jsonb));
end $$;

-- Newest 100 invoices, of one salon or of all. total_count is over every row of that filter.
create function app.office_invoices(p_salon_id uuid default null)
returns table (invoice_id uuid, number text, issued_at timestamptz, salon_id uuid, salon_name text, order_id uuid,
               total_paisa bigint, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform app.assert_office();
  if p_salon_id is not null and not exists (select 1 from public.salon s where s.id = p_salon_id) then
    raise exception using errcode = '22023', message = 'unknown salon';
  end if;
  return query
  select i.id, i.number, i.issued_at, i.salon_id, s.name, i.order_id, i.total_paisa, count(*) over ()
  from public.invoice i join public.salon s on s.id = i.salon_id
  where p_salon_id is null or i.salon_id = p_salon_id
  order by i.issued_at desc, i.number desc
  limit 100;
end $$;

-- Newest 100 receipts, of one salon, one invoice or all. amount_paisa is the payment's amount, or with
-- an invoice what the payment allocated to that invoice. total_count is over every row of that filter.
create function app.office_receipts(p_salon_id uuid default null, p_invoice_id uuid default null)
returns table (receipt_id uuid, number text, issued_at timestamptz, salon_id uuid, salon_name text,
               method public.pay_method, amount_paisa bigint, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform app.assert_office();
  if p_salon_id is not null and not exists (select 1 from public.salon s where s.id = p_salon_id) then
    raise exception using errcode = '22023', message = 'unknown salon';
  end if;
  if p_invoice_id is not null and not exists (select 1 from public.invoice i where i.id = p_invoice_id) then
    raise exception using errcode = '22023', message = 'unknown invoice';
  end if;
  return query
  select r.id, r.number, r.issued_at, r.salon_id, s.name, p.method,
         case when p_invoice_id is null then p.amount_paisa else a.amt end,
         count(*) over ()
  from public.receipt r
  join public.payment p on p.id = r.payment_id
  join public.salon s on s.id = r.salon_id
  left join lateral (
    select sum(x.amount_paisa)::bigint amt
    from public.payment_allocation x join public.installment n on n.id = x.installment_id
    where x.payment_id = p.id and n.invoice_id = p_invoice_id) a on true
  where (p_salon_id is null or r.salon_id = p_salon_id)
    and (p_invoice_id is null or a.amt is not null)
  order by r.issued_at desc, r.number desc
  limit 100;
end $$;

-- ----------------------------------------------------------------- function privileges ----
revoke all on function
  app.office_rep_detail(uuid), app.office_invoices(uuid), app.office_receipts(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  app.office_rep_detail(uuid), app.office_invoices(uuid), app.office_receipts(uuid, uuid)
  to authenticated;
