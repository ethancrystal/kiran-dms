-- =============================================================================
-- Kiran DMS · migration 0007 · Device state guard (reopens P1-01 for council finding 5;
-- MJ approval B-26, ACTIVITY L-0110)
--
-- "A revoked device stays revoked" was enforced only inside app.register_device and
-- app.approve_device. Migration 0004 broke it once (L-0035) and no constraint failed. Move
-- the rule into the schema, so any future function (or a direct write by the table owner)
-- that tries it fails:
--   * a revoked row never changes again (not its status, not last_seen_at);
--   * identity columns (id, user_id, device_fingerprint, created_at) never change;
--   * status moves only pending -> approved, pending -> revoked, approved -> revoked
--     (approved -> pending was the 0004 revival path that 0006 removed).
-- Binds every role, including table owners, like control.forbid_mutation (H-06).
-- =============================================================================

create function control.device_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'revoked' then
    raise exception using errcode = '42501',
      message = 'a revoked device is final and cannot change (device_guard)';
  end if;
  if (new.id, new.user_id, new.device_fingerprint, new.created_at)
     is distinct from (old.id, old.user_id, old.device_fingerprint, old.created_at) then
    raise exception using errcode = '42501',
      message = 'device identity columns are immutable (device_guard)';
  end if;
  if new.status is distinct from old.status
     and not ((old.status = 'pending'  and new.status in ('approved', 'revoked'))
           or (old.status = 'approved' and new.status = 'revoked')) then
    raise exception using errcode = '42501',
      message = format('device status cannot move from %s to %s (device_guard)', old.status, new.status);
  end if;
  return new;
end $$;

comment on function control.device_guard() is
  'BEFORE UPDATE guard on public.device: revoked is final, identity immutable, forward-only status (B-26, council finding 5).';

create trigger device_guard before update on public.device
  for each row execute function control.device_guard();

revoke execute on function control.device_guard() from public, anon, authenticated, service_role;
