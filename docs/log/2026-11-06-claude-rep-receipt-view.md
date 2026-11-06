# 2026-11-06 17:50 PKT · Claude · Sonnet 5.5 · branch claude/rep-receipt-view · TASK
**Task:** H12 of the Hermes work order (remaining-implementation plan C5, receipt views second part, CTL-01; areas: apps/web/app/app/receipts/[id]/page.tsx, apps/web/components/money-section.tsx)
**What / why:** A rep who has just recorded a payment sees "Payment recorded. Receipt N" with no way to open it. app.receipt_document already serves the rep who recorded the payment on an approved phone, so a new page /app/receipts/[id] renders the shared ReceiptSheet from H11 (without the reversal reason), and the receipt number in the Payment recorded message now links to /app/receipts/{id} for a rep and still to /office/receipts/{id} for the office. The page has one message for an id that does not exist and for a caller the function refuses. A link from the rep's list of collections and a salon receipt view need a new field and a new function; they stay for MJ.
**Stacked on:** claude/receipt-shows-reversal (pull request 92), whose ReceiptSheet this page uses. Merge 92 first.
**Evidence:** `pnpm typecheck` passes; `biome ci` on the two files passes. `pnpm -C apps/web test:e2e` (rep browser tests, no backend): 10 passed. The page was not exercised in a browser locally (it needs a signed-in rep); the database side is covered by supabase/tests/payments.test.ts and rep-detail-documents.test.ts, which I did not change. Stack journeys not run locally (no Docker); CI is the first run.
**Next / needs:** CI on the pull request after 92 merges; MJ's OK to merge.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no database change)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (read only)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
