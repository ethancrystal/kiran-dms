# 2026-11-10 23:00 PKT · Claude · Opus 5.5 · branch claude/p1-09-board-row · TASK
**Task:** — (board row P1-09 in section 13 brought up to date; no code)
**What / why:** MJ asked in chat on 2026-11-10 to fix the P1-09 board row, which still read NOT STARTED although pull request 103 (the outbox core, plan tasks 2 to 5) merged into main at 8b80918. The row now reads IN PROGRESS and names what is merged, what is untested (store-idb.ts, index.ts), what waits on MJ (plan task 1, the 48 hour window) and what is not started (tasks 6 to 9). No other row changed.
**Evidence:** git log origin/main shows 8b80918 "Merge pull request #103 from ethancrystal/claude/p1-09-outbox-core"; the merged entry 2026-11-10-claude-p1-09-outbox-core records the 40 passing specs and the untested files. pnpm activity:check result below.
**Not done:** the H-19 DECISION entry for the owner-account query on the Kiran project. No record of that query (its text, time, who ran it, MJ's approval) exists in docs/log, on main or in the session transcripts I could search, so an entry written now would be invented. Waiting on MJ for the facts.
**Next / needs:** MJ: the owner-account query's details and the approval wording, so the DECISION entry can quote them.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (n/a: docs only)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (n/a)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (n/a)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) (n/a)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24) (activity:check only; nothing else applies)
