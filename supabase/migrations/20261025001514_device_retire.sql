-- =============================================================================
-- Kiran DMS · migration 0005 · Retire leaked device ids (corrects P1-01, ACTIVITY L-0030)
--
-- Defect 1 of L-0030: on a database that had devices before migration 0004, the raw
-- device ids (bearer credentials) remain in control.audit_event, which is append-only
-- and can never be rewritten (H-06, H-17). Anyone who can read the audit log or a backup
-- could pair one with a stolen rep session and pass the device gate.
--
-- Fix: make every such id worthless instead of trying to erase history. Revoke every
-- device whose raw id appears anywhere in audit history (device_id, or
-- device_fingerprint inside before/after). Post-0004 rows hold hashes, which never hash
-- to a stored fingerprint, so only genuinely leaked ids match.
--
-- After revocation a leaked id is no better than a made-up one: registering it again
-- only puts it back in the approval queue (migration 0004 behaviour), where an office
-- user must approve it like any new phone. Whether a revoked id should be dead for good
-- is MJ's open question L-0030 Q6 (B-16), not changed here.
--
-- No-op on staging: it had 0 devices and 0 audit rows with device data (checked
-- 2026-10-25 before applying).
-- =============================================================================

select app.set_purpose('retire device ids exposed in pre-0004 audit history (L-0030)');

update public.device d
   set status = 'revoked', revoked_at = now()
 where d.status <> 'revoked'
   and exists (
     select 1 from control.audit_event e
     where app.fingerprint_hash(e.device_id) = d.device_fingerprint
        or app.fingerprint_hash(e.before ->> 'device_fingerprint') = d.device_fingerprint
        or app.fingerprint_hash(e.after  ->> 'device_fingerprint') = d.device_fingerprint);
