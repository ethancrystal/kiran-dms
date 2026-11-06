# 2026-11-06 20:10 PKT · Claude · Sonnet 5.5 · branch claude/records-after-hermes-2 · TASK
**Task:** H15 of the Hermes work order, second part (remaining-implementation plan C8; areas: docs/plans/in-progress/2026-11-05-remaining-implementation.md, docs/plans/README.md, hermes.md moved to docs/plans/implemented)
**What / why:** Pull requests 81, 82 and 84 to 96 are merged, so the plan list now carries a note on each item they finished (AUTH-05 residual, REP-07, REP-12 and REP-13, REP-16, AUTH-13, L6 to L8, the receipt views), the work order hermes.md moved from in-progress to implemented with git mv, and the plans README says so: no plan is waiting for an implement-only agent, and H11 to H15 came from the draft branch claude/hermes-15-tasks (pull request 80, not merged), whose version of hermes.md is not on main.
**Deliberately left out:** the notes for commission and handover settlement timelines, the office-only paisa messages, the searchable salon picker and the rep collection-list link all still wait for MJ, as the work order says.
**Evidence:** `pnpm activity:check` run before commit (result in the pull request checks). Documents only; no code run. The 13 merged pull requests were each merged on MJ's OK with every required check green on the exact head and a merge commit pinned to it.
**Next / needs:** CI on the pull request; MJ's OK to merge. Decide whether draft pull request 80 (the 15-task hermes.md) should be merged or closed.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (documents only)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (no code)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
