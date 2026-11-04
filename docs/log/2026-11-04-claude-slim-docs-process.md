# 2026-11-04 23:50 PKT · Claude · Opus 5.5 · branch claude/slim-docs-process · TASK
**Task:** P0-09 (build protocol; areas: docs/ACTIVITY.md, docs/log/, CLAUDE.md, AGENTS.md, SPEC.md, execution map, Gate 0 checklist, scripts/activity-log-check.mjs, scripts/agent-preflight, log-check tests)
**What / why:** Carries out MJ's process change, the "All five cuts" of 2026-11-04-mj-process-and-pr-b-plan. The log moved to docs/log/ (archive plus one file per entry), one TASK entry per task, the branch and pull request are the claim, status lives only on the section 12 board, and the compliance protocol is merged into ACTIVITY.md. Board change: the P0-09 row cites this entry. Blockers and assumptions tables unchanged. Hard rules H-01 to H-27 unchanged, byte for byte. DONE (self-reported); not verified.
**Evidence:** Filled in below as the runs finish.
**Next / needs:** MJ: push and pull request decision.

Security checklist (tick honestly):
[n/a] RLS enabled+forced; policies + role×table tests added/updated (H-13): no database change
[n/a] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07): no database change
[n/a] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08): no database change
[n/a] Audit trigger present; hash chain verifies (H-17): no database change
[x] No vault/supplier/cost data outside vault; the check now also scans new docs/log files (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[n/a] Governance powers still owner-only + AAL2 (H-15): no database change
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)
