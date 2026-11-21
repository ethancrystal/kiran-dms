-- MJ, 2026-11-20: an owner and a manager may both decide every write-off, at any amount
-- (receivable and stock). This replaces only the write-off checker floor in
-- app.request_approval from 20261024223304_foundation.sql. Maker != checker, AAL2 on the
-- decision, the rep-kind restriction and the idempotency key are unchanged.
-- Forward-only. No table, column, policy or grant changes.

create or replace function app.request_approval(
  p_client_id uuid, p_kind public.approval_kind, p_subject_type text, p_subject_id uuid,
  p_payload jsonb, p_reason text, p_checker_role public.app_role default 'manager')
returns control.approval_request
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := app.assert_actor_ready();
  v      control.approval_request;
  v_checker public.app_role := p_checker_role;
begin
  select * into v from control.approval_request where client_id = p_client_id;
  if v.id is not null then
    if v.maker_id = auth.uid() then return v; end if;        -- idempotent replay
    raise exception using errcode = '23505', message = 'client_id already used';
  end if;
  if v_role = 'rep' and p_kind not in ('discount', 'return_accept', 'payment_reversal') then
    perform app.raise_denied('reps may only request discounts, return acceptance or payment reversals');
  end if;
  if v_checker not in ('manager', 'owner') then v_checker := 'manager'; end if;
  -- MJ, 2026-11-20: 'manager' is the floor for write-offs. app.decide_approval accepts
  -- an owner for that floor too, so either office role can decide. The maker is still
  -- refused by the checker != maker constraint.
  if p_kind = 'write_off' then v_checker := 'manager'; end if;
  perform app.set_purpose('approval requested: ' || p_kind::text);
  insert into control.approval_request
    (client_id, kind, subject_type, subject_id, payload, maker_id, checker_role_required, reason)
  values
    (p_client_id, p_kind, p_subject_type, p_subject_id, coalesce(p_payload, '{}'::jsonb),
     auth.uid(), v_checker, p_reason)
  returning * into v;
  return v;
end $$;
