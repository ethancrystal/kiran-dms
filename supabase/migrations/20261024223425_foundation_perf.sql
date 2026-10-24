-- =============================================================================
-- Kiran DMS · migration 0002 · Foundation performance fixes (task P1-01)
-- From the Supabase advisors run on staging after migration 0001 (ACTIVITY L-0019):
--   * auth_rls_initplan (WARN): wrap auth.uid() and the app.* helpers in scalar
--     subqueries so they are evaluated once per statement, not once per row.
--     Same rows visible to the same roles; the RLS matrix suite proves it.
--   * unindexed_foreign_keys (INFO): cover the audit-trail foreign keys.
-- Not changed (intentional): control.audit_chain_head and control.doc_counter have RLS
-- with no policies on purpose — no application role may read or write them (doc 06 §6).
-- =============================================================================

alter policy user_profile_select on public.user_profile
  using (id = (select auth.uid()) or (select app.is_office()));

alter policy device_select on public.device
  using (user_id = (select auth.uid()) or (select app.is_office()));

alter policy app_config_select on public.app_config
  using ((select app.is_office()) or (rep_visible and (select app.user_role()) is not null));

alter policy approval_request_select on control.approval_request
  using (maker_id = (select auth.uid()) or (select app.is_office()));

alter policy audit_event_select on control.audit_event
  using ((select app.is_owner()));

create index approval_request_maker_idx   on control.approval_request (maker_id);
create index approval_request_checker_idx on control.approval_request (checker_id) where checker_id is not null;
create index app_config_updated_by_idx    on public.app_config (updated_by) where updated_by is not null;
create index device_approved_by_idx       on public.device (approved_by) where approved_by is not null;
create index device_revoked_by_idx        on public.device (revoked_by) where revoked_by is not null;
create index user_profile_created_by_idx  on public.user_profile (created_by) where created_by is not null;
