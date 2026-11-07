# 2026-11-07 10:00 PKT · Claude · Sonnet 5.5 · branch claude/blind-stock-issues · TASK
**Task:** REP-05 of the remaining-implementation plan C3 (CTL-05, INV-03; areas: migration 20261107010000, apps/web/app/app/stock/page.tsx, supabase/tests/blind-stock-issues.test.ts, rls-matrix.test.ts, verifier-attacks.test.ts, the plan file)
**What / why:** The rep confirms a stock issue or return with its own count, which is meant to be blind. The rep's page read public.stock_issue directly under RLS, so the office's quantities (lines) reached the browser and the second count could be copied. New app.my_pending_issues() gives a rep on an approved phone the pending issues of its own bag with the SKU ids to count and never a quantity (id, direction, note, time, sku_ids). The rep select policy on public.stock_issue is dropped, so the table is readable by the office only; app.rep_confirm_stock_issue is unchanged. The page reads the function and builds its count fields from the SKU ids. This is a tightening of an existing control, not a loosening.
**Test changes that follow from the design:** the RLS matrix row for stock_issue now expects repA and repB to see no rows (it expected their own bag's rows); the verifier allowlist of functions callable by authenticated gains my_pending_issues. Both are the intended new state, named here because they edit existing expectations.
**Evidence:** `pnpm db:test blind-stock-issues`: 6 of 6 pass (the function returns SKU ids and no quantity, the rep reads no row of the table, the office still reads the quantities, another rep sees nothing of rep A's issue, the office, an unapproved phone and a suspended rep get nothing and anonymous is refused, the count still posts). `pnpm db:test inventory issue-sku-names rls-matrix verifier-attacks schema-hygiene crm-attacks`: 6 files, 2990 tests pass. `pnpm typecheck` passes. The stock page was not exercised in a browser locally and the stack journeys were not run (no Docker); CI is the first run. A first run of five files together showed a file-level failure in inventory.test.ts that did not repeat when it was run alone or in the six-file run; I did not find its cause.
**Next / needs:** CI on the pull request, including the office and rep stock journeys; MJ's OK to merge.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (stock_issue select narrowed to the office; matrix row updated)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (read only; no mutation changed)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16) (a control is strengthened)
