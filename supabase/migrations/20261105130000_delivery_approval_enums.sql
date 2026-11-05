-- =============================================================================
-- Kiran DMS · migration 20261105130000 · Delivery approval: enum values (completion slice 4, P1-21)
-- Decision: D-32 (doc 12; MJ's requirement, ACTIVITY L-0385): a rep's delivery is an immutable
-- submission; only the owner's or manager's approval writes the delivery, the sale movement, the
-- invoice, the installments and the order status; rejected goods stay in pending custody.
-- Plan: docs/superpowers/plans/2026-11-04-delivery-submission-approval.md (Decision 7).
--
-- Only the `alter type ... add value` statements live here. Postgres refuses to use an enum value
-- in the transaction that added it ("unsafe use of new value"), and each migration file runs as one
-- transaction (the test set-up sends a whole file as one query), so everything that uses these
-- values is in the next migration, 20261105130100_delivery_approval.sql.
--
--   * stock_location_kind  + pending_delivery: one per rep, created with the rep's bag; goods a rep
--     has handed over but the office has not yet approved, or has rejected and not yet settled.
--   * stock_movement_kind  + submitted_to_salon: bag to pending, at the rep's submission.
--                          + pending_returned:   pending to bag, when the office returns rejected goods.
-- =============================================================================

alter type public.stock_location_kind add value if not exists 'pending_delivery';
alter type public.stock_movement_kind add value if not exists 'submitted_to_salon';
alter type public.stock_movement_kind add value if not exists 'pending_returned';
