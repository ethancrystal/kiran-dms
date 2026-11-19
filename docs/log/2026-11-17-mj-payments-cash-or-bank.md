# 2026-11-17 13:15 PKT · Grok · grok-4.7 · branch claude/p1-12-acceptance-guards · DECISION
**Task:** Payments. No board row changes status. Blocker B-62 added.
**What / why:** MJ said in chat on 2026-11-17: no payment will be added; all payments will be in cash or bank to bank; they are only kept as a record in the system after the payment. The database already matches the methods: public.pay_method is cash or bank_transfer (migration 20261103154528_payments.sql), and app.record_payment writes the row after the fact. No card, wallet, payment link or pay-now path is added. Plan F decision D-53, a direct buyer paying on Shopify, conflicts, so P1-37 stays unbuilt. B-62 records that default.
**Evidence:** Read the pay_method enum and the payment_bank_fields check in supabase/migrations/20261103154528_payments.sql, and the Shopify checkout line in docs/plans/will-be-implemented/2026-11-10-khsalon-storefront-overview.md. No migration, screen or payment function was changed. Not run: no payment test, because no payment code changed.
**Next / needs:** MJ can later say whether the public shop is catalogue only, or a Shopify order is entered only after cash or a bank transfer has already moved. Until then the default on B-62 stands.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (n/a: no schema change)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (n/a)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (n/a)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) (n/a)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25) (B-62 names the clash with D-53)
[x] Tests actually run; real results recorded (H-23, H-24) (no code to test; the read is named above)
