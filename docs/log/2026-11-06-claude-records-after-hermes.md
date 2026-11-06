# 2026-11-06 18:50 PKT · Claude · Sonnet 5.5 · branch claude/records-after-hermes · TASK
**Task:** H15 of the Hermes work order, first part (remaining-implementation plan C8; areas: docs/ACTIVITY.md section 12 rows, docs/plans/in-progress/2026-11-05-remaining-implementation.md)
**What / why:** The board rows P1-18 to P1-26 and P1-28 to P1-31 still said "implemented on branch ... awaiting CI" although their pull requests merged long ago. Each cell now names its merged pull request and merge commit, read from GitHub (all 13 listed pull requests are MERGED with the listed merge commits, and `gh pr checks N --required` for each pull request N showed every required check passing on pull requests 56 and 57 to 70). P1-19 also names pull request 71 for the product group screen and the picture check, and P1-24 says the end-to-end journey was built in P1-25. No cell says VERIFIED and nothing is verified here. In the plan list only the two items whose pull requests have merged got their note: stale refused request (H1, pull request 81) and timelines (H2, pull request 82).
**Not yet done (the rest of H15, waiting for the other pull requests to merge):** the notes for H3 to H13 on the plan list, and moving hermes.md to docs/plans/implemented with the README updated. The work order says to leave out any item whose pull request did not merge; pull requests 84 to 95 are open.
**Evidence:** `pnpm activity:check` run before commit (result in the pull request checks). Documents only; no code run.
**Next / needs:** CI on the pull request; MJ's OK to merge; a second records pull request after 84 to 95 merge.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (documents only)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (no code)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
