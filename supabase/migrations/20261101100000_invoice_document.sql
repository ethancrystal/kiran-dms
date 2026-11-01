-- =============================================================================
-- Kiran DMS · migration 0014 · Invoice document (task P1-06, part c)
-- Requirements: ORD-05 (invoice document: Kiran branding, salon, lines, totals, payment plan
--               schedule, receipt numbers; never supplier or cost), CTL-01 and doc 08 §3 rule 1
--               (the invoice says in Urdu and English that paper receipts are not valid), doc 08
--               §3 rule 6 and doc 09 §6 (only Kiran's company accounts are printed).
-- Docs: 04 (invoice), 07 §3 (documents sent to salons render from `public` only), 09 §1
--       (plan templates), 03 ADM-03.
--
-- Part c builds the DATA of the document: one function returns everything a renderer needs, from
-- `public` tables and configuration only, so that nothing from the vault can reach a template
-- (doc 07 §3). The renderer itself (PDF or image, an Edge Function, doc 05) is not built here.
-- Receipts do not exist until P1-07, so `receipts` is an empty list for now.
--
-- The installment schedule is computed by app.plan_schedule from the `plan.templates`
-- configuration; P1-07 reuses it for the amounts due. Rounding (assumption A-11): each
-- installment is floor(total x pct / 100) in paisa and the last takes the remainder, so the
-- installments always add up to the invoice total exactly.
-- =============================================================================

-- ------------------------------------------------------------------- config -----
-- Branding and the company's accounts. Placeholders, clearly fake (B-06), until the owner sets
-- them with app.owner_set_config; changing the accounts becomes owner-only with a lock and a
-- notification in P1-08 (CTL-16). Not visible to reps: the invoice function reads them.
insert into public.app_config (key, value, rep_visible, note) values
  ('company.profile', '{
     "name_en": "[Dummy] Kiran Company",
     "name_ur": "[Dummy] کرن کمپنی",
     "city": "Karachi"
   }'::jsonb, false,
   '[default-unconfirmed] ORD-05 branding; placeholder until the owner sets the real name (ADM-02)'),
  ('company.bank_accounts', '[
     {"bank": "[Dummy] Bank", "account_title": "[Dummy] Kiran Company", "account_no": "0000-0000000000"}
   ]'::jsonb, false,
   '[default-unconfirmed] B-06: placeholder accounts, clearly fake; the real ones are the owner''s (CTL-16)')
on conflict (key) do nothing;

-- ----------------------------------------------------------------- schedule -----
-- The installments of a plan for a total, from the plan template. Internal (no grant): called
-- by the invoice document, and by P1-07 for the amounts due.
-- Every row of the template is checked before any arithmetic (L-0204): an object whose `pct` and
-- `day_offset` are JSON numbers, `pct` above 0, `day_offset` a whole number of days from 0 and
-- never earlier than the row before (the last row takes the rounding remainder, A-11, so row
-- order must be due order, A-12), and the percentages add up to exactly 100. A template that
-- fails is refused, never silently cast: a missing `pct` would otherwise drop out of the sum and
-- yield an installment of no amount, and a negative one would pass a total of 100.
create function app.plan_schedule(p_plan public.plan_code, p_total_paisa bigint, p_start date)
returns table (inst_no integer, inst_count integer, due_on date, pct_of_total numeric, amount_paisa bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_sched jsonb;
  v_row   jsonb;
  v_pct   numeric;
  v_day   numeric;
  v_prev  numeric := 0;
  v_sum   numeric := 0;
begin
  if p_total_paisa is null or p_total_paisa <= 0 or p_start is null then
    raise exception using errcode = '22023', message = 'a schedule needs a positive total and a start date';
  end if;
  select t -> 'schedule' into v_sched
  from public.app_config c, jsonb_array_elements(c.value) t
  where c.key = 'plan.templates' and t ->> 'code' = p_plan::text;
  if v_sched is null or jsonb_typeof(v_sched) <> 'array' or jsonb_array_length(v_sched) = 0 then
    raise exception using errcode = '22023', message = 'no installment schedule is configured for this plan';
  end if;
  for v_row in select e.v from jsonb_array_elements(v_sched) e(v) loop
    -- jsonb_typeof is null for a missing key and 'null' for a JSON null; JSON numbers are finite.
    if jsonb_typeof(v_row) is distinct from 'object'
       or jsonb_typeof(v_row -> 'pct') is distinct from 'number'
       or jsonb_typeof(v_row -> 'day_offset') is distinct from 'number' then
      raise exception using errcode = '22023',
        message = 'each installment of this plan needs a numeric pct and day_offset';
    end if;
    v_pct := (v_row ->> 'pct')::numeric;
    v_day := (v_row ->> 'day_offset')::numeric;
    if v_pct <= 0 then
      raise exception using errcode = '22023', message = 'each installment percentage of this plan must be above 0';
    end if;
    if v_day < 0 or v_day <> trunc(v_day) or v_day > 2147483647 then
      raise exception using errcode = '22023', message = 'each installment day_offset of this plan must be a whole number of days from 0';
    end if;
    if v_day < v_prev then
      raise exception using errcode = '22023', message = 'the installments of this plan must be in due order';
    end if;
    v_prev := v_day;
    v_sum := v_sum + v_pct;
  end loop;
  if v_sum <> 100 then
    raise exception using errcode = '22023', message = 'the installment percentages of this plan do not add up to 100';
  end if;
  return query
  with s as (
    select e.n::integer n, (e.v ->> 'pct')::numeric pct, (e.v ->> 'day_offset')::numeric::integer off
    from jsonb_array_elements(v_sched) with ordinality e(v, n)
  ), f as (
    select s.n, s.pct, s.off, (count(*) over ())::integer cnt, floor(p_total_paisa * s.pct / 100)::bigint base
    from s
  )
  select f.n, f.cnt, p_start + f.off, f.pct,
         case when f.n = f.cnt
              then p_total_paisa - coalesce(sum(f.base) over (order by f.n rows between unbounded preceding and 1 preceding), 0)::bigint
              else f.base end
  from f
  order by f.n;
end $$;

-- ----------------------------------------------------------------- document -----
-- Everything the invoice document shows, as one JSON value, from `public` only (doc 07 §3):
-- no supplier, cost, margin or lot field exists in any table it reads. A rep reads the invoices
-- of its own orders, the office reads all; anyone else (or an unknown id) gets null, so the
-- answer does not say whether an invoice exists. Read-only; nothing is written or logged.
create function app.invoice_document(p_invoice_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  i      public.invoice;
  d      public.delivery;
  s      public.salon;
  v_area text;
  v_plan text;
  v_on   date;
  v_fy   integer;
begin
  select * into i from public.invoice where id = p_invoice_id;
  if i.id is null then return null; end if;
  if not (app.is_office() or (app.user_role() = 'rep' and i.rep_id = auth.uid() and app.self_ok())) then
    return null;
  end if;
  select * into d from public.delivery where id = i.delivery_id;
  select * into s from public.salon where id = i.salon_id;
  select a.name into v_area from public.area a where a.id = s.area_id;
  select t ->> 'name' into v_plan
  from public.app_config c, jsonb_array_elements(c.value) t
  where c.key = 'plan.templates' and t ->> 'code' = i.plan::text;
  v_on := (d.delivered_at at time zone 'Asia/Karachi')::date;
  v_fy := app.fiscal_year((i.issued_at at time zone 'Asia/Karachi')::date);
  return jsonb_build_object(
    'version', 1,
    'number', i.number,
    'financial_year', (2000 + v_fy - 1)::text || '-' || lpad(v_fy::text, 2, '0'),
    'issued_at', i.issued_at,
    'company', coalesce((select c.value from public.app_config c where c.key = 'company.profile'), '{}'::jsonb),
    'bank_accounts', coalesce((select c.value from public.app_config c where c.key = 'company.bank_accounts'), '[]'::jsonb),
    'salon', jsonb_build_object('name', s.name, 'address', s.address, 'area', v_area),
    'delivery', jsonb_build_object('delivered_at', d.delivered_at, 'received_by_name', d.received_by_name, 'status', d.status),
    'plan', jsonb_build_object('code', i.plan, 'name', v_plan),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'line_no', ol.line_no, 'sku_code', k.code, 'product', p.brand_label || ' ' || p.name,
               'variant', k.variant, 'qty', dl.qty, 'list_price_paisa', dl.list_price_paisa,
               'unit_price_paisa', dl.unit_price_paisa, 'line_total_paisa', dl.line_total_paisa)
             order by ol.line_no)
      from public.delivery_line dl
      join public.sales_order_line ol on ol.id = dl.order_line_id
      join public.sku k on k.id = dl.sku_id
      join public.product p on p.id = k.product_id
      where dl.delivery_id = d.id), '[]'::jsonb),
    'totals', jsonb_build_object('subtotal_paisa', i.subtotal_paisa, 'discount_paisa', i.discount_paisa, 'total_paisa', i.total_paisa),
    'schedule', coalesce((
      select jsonb_agg(jsonb_build_object(
               'no', x.inst_no, 'of', x.inst_count, 'due_on', x.due_on, 'pct', x.pct_of_total, 'amount_paisa', x.amount_paisa)
             order by x.inst_no)
      from app.plan_schedule(i.plan, i.total_paisa, v_on) x), '[]'::jsonb),
    'receipts', '[]'::jsonb,                                  -- P1-07: numbered receipts of payments against this invoice
    'notices', jsonb_build_array(
      jsonb_build_object('code', 'no_paper_receipts',
        'en', 'Only the numbered receipt the system sends to your registered phone is valid. A paper receipt is not valid.',
        'ur', 'صرف وہ نمبر والی رسید درست ہے جو سسٹم آپ کے رجسٹرڈ فون پر بھیجتا ہے۔ کاغذی رسید درست نہیں۔'),
      jsonb_build_object('code', 'official_accounts_only',
        'en', 'Pay only into the company accounts printed on this invoice. Never pay a rep''s personal account or wallet.',
        'ur', 'ادائیگی صرف اس انوائس پر چھپے کمپنی کے اکاؤنٹس میں کریں۔ کسی ریپ کے ذاتی اکاؤنٹ یا والٹ میں ہرگز نہیں۔')));
end $$;

-- ----------------------------------------------------------------- privileges ----
revoke execute on function
  app.plan_schedule(public.plan_code, bigint, date),
  app.invoice_document(uuid)
  from public, anon, authenticated, service_role;

grant execute on function app.invoice_document(uuid) to authenticated;
