# 2026-11-06 17:05 PKT · Claude · Sonnet 5.5 · branch claude/route-picker-more · TASK
**Task:** H10 of the Hermes work order (remaining-implementation plan C3, REP-07; areas: apps/web/app/app/route/page.tsx)
**What / why:** Adding any salon the rep holds to the route already worked; what was missing was the picker holding only the first 50 salons by name with no way to load more. The page now remembers whether the last page was full and shows a "Show more salons" button that reads the next page with the same function the first load uses (salonPage, after the last salon shown) and appends it. A failed read shows the page's error. Because salonPage takes a full Salon as its cursor and the picker holds the smaller Mine type, the cursor is cast at that one call (salonPage only reads id and name from it).
**Evidence:** `pnpm typecheck` passes; `biome ci` on the changed file passes. Paging is not browser-tested: no fixture holds more than 50 salons. Not run locally: the stack journeys; CI is the first run.
**Next / needs:** CI on the pull request; MJ's OK to merge.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no database change)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (read only; same function, same 50-row cap)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
