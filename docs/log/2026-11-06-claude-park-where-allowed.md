# 2026-11-06 15:40 PKT · Claude · Sonnet 5.5 · branch claude/park-where-allowed · TASK
**Task:** H6 of the Hermes work order (remaining-implementation plan C3, REP-12; areas: apps/web/app/app/salons/[id]/page.tsx)
**What / why:** app.rep_park_salon parks only a salon whose stage is prospect, visited or trial (read in migration 20261028060000_salons.sql). The rep's salon page offered Park for every stage except parked, so the rep got a refusal. The page now offers it only for those three stages, through a named constant PARKABLE. No database, test or other page change.
**Evidence:** `pnpm typecheck` passes; `biome ci` on the changed file passes. The page was not exercised in a browser (it needs a signed-in rep); no browser test mentions Park. Not run locally: the stack journeys; CI is the first run.
**Next / needs:** CI on the pull request; MJ's OK to merge.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no database change)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (no function added)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
