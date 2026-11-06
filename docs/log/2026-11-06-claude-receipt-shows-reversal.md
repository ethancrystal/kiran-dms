# 2026-11-06 17:30 PKT · Claude · Sonnet 5.5 · branch claude/receipt-shows-reversal · TASK
**Task:** H11 of the Hermes work order (remaining-implementation plan C5, receipt views first part, CTL-01; areas: apps/web/lib/documents.ts, apps/web/components/receipt-sheet.tsx, apps/web/app/office/(shell)/receipts/[id]/page.tsx)
**What / why:** app.receipt_document already returns reversed with reversed_at and reason when a payment was reversed, but ReceiptDocument dropped it, so a reversed receipt printed as if it were good. The type now has the optional reversed field. The receipt body moved unchanged into one shared component, ReceiptSheet, which now shows "This payment was reversed on {date} and no longer counts as paid." (data-testid doc-reversed) above the details, with the reason only when the page asks for it (the office does; a rep will not). The office page keeps its article, back link and Print button and renders the shared sheet. H12 reuses the component.
**Deliberately not done:** step 6 of the work order (an assertion in the p130 browser test) was skipped: the test named "payment reversal: the manager cannot reverse" never opens a /office/receipts page, and the work order forbids adding a navigation.
**Evidence:** `pnpm typecheck` passes; `biome ci` on the three files passes. `pnpm db:test audit-fixes`: passes (the test pinning what the function returns for reversed is unchanged). The receipt pages were not exercised in a browser locally; CI is the first run of the journeys.
**Next / needs:** CI on the pull request; MJ's OK to merge; H12 builds on this.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no database change)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (read only)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
