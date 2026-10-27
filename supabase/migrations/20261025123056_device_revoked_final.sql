-- =============================================================================
-- Kiran DMS · migration 0006 · A revoked device id is dead for good (corrects P1-01, L-0035)
--
-- Defect 1 of L-0035: migration 0005 revoked device ids leaked into pre-0004 audit
-- history, but app.register_device (0004) flipped a revoked row back to `pending`,
-- reviving the rep's ORIGINAL row (same id, platform, label). The real phone keeps the
-- same id forever, so restoring it meant approving that row, which re-enabled the raw id
-- still readable in control.audit_event.
--
-- Fix (L-0030 Q6 / B-16c answered the restrictive way, §1):
--   * registering a revoked device id is refused (42501 "device id revoked; generate a
--     new one"); revoked rows never return to pending or approved;
--   * the rep app (apps/web) generates a fresh device id when its id is revoked and
--     queues that new id for office approval.
-- A leaked id therefore can never pass the device gate again, whatever the office does.
-- =============================================================================

create or replace function app.register_device(p_fingerprint text, p_platform text default null, p_label text default null)
returns public.device
language plpgsql security definer set search_path = '' as $$
declare
  v      public.device;
  v_hash text;
begin
  if app.user_role() is null then perform app.raise_denied('no active user profile for this session'); end if;
  if length(coalesce(p_fingerprint, '')) not between 16 and 200 then
    raise exception using errcode = '22023', message = 'device id must be 16 to 200 characters';
  end if;
  v_hash := app.fingerprint_hash(p_fingerprint);
  select * into v from public.device where user_id = auth.uid() and device_fingerprint = v_hash for update;
  if v.id is not null and v.status = 'revoked' then
    perform app.raise_denied('device id revoked; generate a new one');
  end if;
  if v.id is not null then
    update public.device set last_seen_at = now() where id = v.id returning * into v;
    return v;
  end if;
  insert into public.device (user_id, device_fingerprint, platform, label, last_seen_at)
  values (auth.uid(), v_hash, p_platform, p_label, now())
  returning * into v;
  return v;
end $$;

revoke execute on function app.register_device(text, text, text) from public, anon, service_role;
grant execute on function app.register_device(text, text, text) to authenticated;
