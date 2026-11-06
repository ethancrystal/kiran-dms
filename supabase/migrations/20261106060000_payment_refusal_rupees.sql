-- The payment refusal a rep sees quotes rupees, not paisa (REP-16).
-- Requirements: PAY-02, REP-16 (remaining-implementation plan C3).
-- app.record_payment is copied from 20261103210000_office_cash.sql with one change: the refusal "the payment
-- is more than the salon owes" now quotes rupees, as the two rupee messages in 20261105230000_audit_fixes.sql do.
-- Same arguments and return type; the existing grants stand.
create or replace function app.record_payment(
  p_client_id uuid, p_salon_id uuid, p_method public.pay_method, p_amount_paisa bigint,
  p_bank_name text, p_bank_reference text, p_lat numeric, p_lng numeric, p_mock_location boolean,
  p_recorded_at_client timestamptz, p_rep_day_id uuid)
returns public.receipt
language plpgsql security definer set search_path = '' as $$
declare
  v_role    public.app_role := app.user_role();
  s         public.salon;
  p         public.payment;
  r         public.receipt;
  v_name    text := nullif(btrim(p_bank_name), '');
  v_ref     text := nullif(btrim(p_bank_reference), '');
  v_owed    bigint;
  v_dist    integer;
  v_max_m   numeric;
  v_max_min numeric;
  v_visit   public.visit;
  v_flags   text[] := '{}';
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'a payment needs a client_id (idempotency key, H-08)';
  end if;
  -- One call per client_id at a time, taken before the first lookup: two sessions racing with the same
  -- key meet here, and the second one sees the first one's committed payment as a replay (H-08).
  perform pg_advisory_xact_lock(hashtextextended('payment-client:' || p_client_id::text, 0));
  -- Replay: the same call again returns the same receipt; the same key with any other persisted fact
  -- (who, salon, method, amount, bank fields, position, mock flag, the phone's time) is refused.
  select * into p from public.payment where client_id = p_client_id;
  if p.id is not null then
    if p.recorded_by = auth.uid() and p.salon_id = p_salon_id and p.method = p_method and p.amount_paisa = p_amount_paisa
       and p.bank_name is not distinct from v_name and p.bank_reference is not distinct from v_ref
       and p.lat is not distinct from round(p_lat, 6) and p.lng is not distinct from round(p_lng, 6)
       and p.mock_location = coalesce(p_mock_location, false)
       and p.recorded_at_client is not distinct from p_recorded_at_client then
      return (select x from public.receipt x where x.payment_id = p.id);
    end if;
    raise exception using errcode = '23505', message = 'client_id already used with different content';
  end if;
  if p_amount_paisa is null or p_amount_paisa <= 0 then
    raise exception using errcode = '22023', message = 'a payment needs an amount above zero';
  end if;
  if p_method = 'bank_transfer' and (v_name is null or v_ref is null) then
    raise exception using errcode = '22023', message = 'a bank transfer needs the bank name and the reference (PAY-02)';
  end if;
  if p_method = 'cash' and (v_name is not null or v_ref is not null) then
    raise exception using errcode = '22023', message = 'a cash payment carries no bank name or reference';
  end if;
  select * into s from public.salon where id = p_salon_id;
  if s.id is null then raise exception using errcode = '22023', message = 'unknown salon'; end if;
  if v_role = 'rep' then
    -- Only a rep's payment is judged against these (the office's carries on_behalf instead).
    v_max_m := app.config_number('payment.geofence_m');
    v_max_min := app.config_number('payment.max_minutes_after_arrival');
    if v_max_m is null or v_max_min is null or v_max_m < 0 or v_max_min < 0 then
      perform app.raise_denied('the payment flag thresholds (payment.geofence_m, payment.max_minutes_after_arrival) are not configured; ask the owner');
    end if;
  end if;

  -- One payment at a time per salon, so the allocation below sees every earlier one.
  perform pg_advisory_xact_lock(hashtextextended('payment:' || p_salon_id::text, 0));
  select coalesce(sum(x.remaining_paisa), 0) into v_owed from app.installment_state(p_salon_id) x;
  if v_owed = 0 then
    raise exception using errcode = '23514', message = 'this salon owes nothing; advances are not built yet (PAY-02)';
  end if;
  if p_amount_paisa > v_owed then
    raise exception using errcode = '23514',
      message = format('the payment is more than the salon owes (Rs %s)', to_char(v_owed / 100.0, 'FM999,999,990.00'));
  end if;

  -- CTL-02 and M14 findings, kept on the payment for the manager's review.
  if s.lat is not null and p_lat is not null and p_lng is not null then
    v_dist := app.distance_m(s.lat, s.lng, p_lat, p_lng);
  end if;
  if v_role = 'rep' then
    if v_dist is null then v_flags := array_append(v_flags, 'distance_unknown');
    elsif v_dist > v_max_m then v_flags := array_append(v_flags, 'far_from_salon'); end if;
    select * into v_visit from public.visit v
      where v.rep_day_id = p_rep_day_id and v.salon_id = p_salon_id order by v.arrived_at desc, v.id limit 1;
    if v_visit.id is null then v_flags := array_append(v_flags, 'no_visit');
    elsif now() - v_visit.arrived_at > v_max_min * interval '1 minute' then v_flags := array_append(v_flags, 'late_after_arrival'); end if;
  else
    -- The office's own cash collection (L-0362) is flagged office_collected; a bank transfer stays on_behalf.
    v_flags := array_append(v_flags, case when p_method = 'cash' then 'office_collected' else 'on_behalf' end);
  end if;
  if coalesce(p_mock_location, false) then v_flags := array_append(v_flags, 'mock_location'); end if;

  perform app.set_purpose('payment recorded');
  insert into public.payment (client_id, salon_id, recorded_by, recorded_by_role, rep_day_id, visit_id, method, amount_paisa,
                              bank_name, bank_reference, lat, lng, distance_from_pin_m, mock_location, flags, recorded_at_client)
  values (p_client_id, p_salon_id, auth.uid(), v_role, p_rep_day_id, v_visit.id, p_method, p_amount_paisa,
          v_name, v_ref, p_lat, p_lng, v_dist, coalesce(p_mock_location, false), to_jsonb(v_flags), p_recorded_at_client)
  returning * into p;

  -- PAY-11: oldest due first, across every invoice of the salon.
  insert into public.payment_allocation (payment_id, installment_id, amount_paisa)
  select p.id, o.installment_id, least(o.remaining_paisa, p.amount_paisa - o.before_paisa)
  from (select x.installment_id, x.remaining_paisa,
               coalesce(sum(x.remaining_paisa) over (order by x.due_on, x.issued_at, x.invoice_number, x.seq, x.installment_id
                                                     rows between unbounded preceding and 1 preceding), 0)::bigint before_paisa
        from app.installment_state(p_salon_id) x where x.remaining_paisa > 0) o
  where o.before_paisa < p.amount_paisa;

  insert into public.receipt (number, payment_id, salon_id, contact_id)
  values (app.next_doc_number('R'), p.id, p.salon_id,
          (select c.id from public.salon_contact c where c.salon_id = p.salon_id and c.is_primary and c.active limit 1))
  returning * into r;

  -- Cash collected by a rep is in the rep's custody; cash collected by the office is in the office pool
  -- (L-0362, doc 08 chain), never in a rep's ledger.
  if p.method = 'cash' and v_role = 'rep' then
    insert into public.cash_ledger_entry (holder_type, holder_id, direction, amount_paisa, source_type, source_id)
    values ('rep', p.recorded_by, 'in', p.amount_paisa, 'payment', p.id);
  elsif p.method = 'cash' then
    insert into public.cash_ledger_entry (holder_type, holder_id, direction, amount_paisa, source_type, source_id)
    values ('office', null, 'in', p.amount_paisa, 'payment', p.id);
  end if;
  return r;
end $$;
