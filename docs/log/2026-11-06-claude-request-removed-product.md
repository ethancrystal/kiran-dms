# 2026-11-06 16:10 PKT · Claude · Sonnet 5.5 · branch claude/request-removed-product · TASK
**Task:** H7 of the Hermes work order (remaining-implementation plan C4, AUTH-13; areas: apps/web/app/salon/page.tsx, supabase/tests/requests-portal.test.ts)
**What / why:** The database rightly refuses a salon's edit of a request that still holds a product no longer sold, but the form could not show that line, so the salon could not get out. The edit form now leaves such lines out, names them in a note (data-testid removed-lines) and says to save the rest or cancel the request; if every line is gone it starts with one empty line. A new database test pins the rule the page works around: after the second SKU is deactivated by the manager, an edit with both lines is refused with 22023 and an edit with only the first line succeeds as version 2 with one line.
**Deliberately not done:** the rep card edit page (apps/web/app/app/cards/page.tsx) is unchanged: rep card edit not changed: its options load after the form is seeded; needs a small design, not done.
**Evidence:** `pnpm typecheck` passes. `biome ci` on apps/web/app/salon/page.tsx reports only an existing img warning. `pnpm db:test requests-portal`: 1 file, 35 tests pass including the new one. The salon page was not exercised in a browser (it needs a signed-in salon); the stack journeys were not run locally (no Docker); CI is the first run.
**Next / needs:** CI on the pull request; MJ's OK to merge.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no table or policy touched)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (no function added or changed)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
