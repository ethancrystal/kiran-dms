# 2026-11-06 14:30 PKT · Claude · Sonnet 5.5 · branch claude/reorder-hidden-stop · TASK
**Task:** H3 of the Hermes work order (remaining-implementation plan C3, REP-13, PIP-03; areas: migration 20261106050000, supabase/tests/routes.test.ts, the plan file)
**What / why:** app.my_route hides a stop whose salon the rep no longer holds, but app.rep_reorder_route counted every stop, so after a salon moved away every reorder was refused with "name every stop of the route exactly once". The function now counts and accepts only the stops the rep can see, puts the named stops first in the order given, renumbers hidden stops after them in their old order, and returns the number of visible stops. Same arguments and return type; no grant changed; no function name added.
**Evidence:** `pnpm db:test routes`: 23 of 23 pass (the new test needed approveSalon first, as the work order says; the first run failed with "this salon is pending" before that line was added). Guard files `pnpm db:test verifier-attacks schema-hygiene rls-matrix`: 3 files, 2900 tests pass. Branch was merged with origin/main after PRs 81 and 82 merged. The office and rep browser journeys were not run locally (no Docker); CI is the first run.
**Next / needs:** CI on the pull request; MJ's OK to merge.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no table or policy touched)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (route_stop is not append-only; only its sequence changes, as before)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
