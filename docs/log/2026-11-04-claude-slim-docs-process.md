# 2026-11-04 23:50 PKT · Claude · Opus 5.5 · branch claude/slim-docs-process · TASK
**Task:** P0-09 (build protocol; areas: docs/ACTIVITY.md, docs/log/, CLAUDE.md, AGENTS.md, SPEC.md, execution map, Gate 0 checklist, scripts/activity-log-check.mjs, scripts/agent-preflight, log-check tests)
**What / why:** Carries out MJ's process change, the "All five cuts" of 2026-11-04-mj-process-and-pr-b-plan. The log moved to docs/log/ (archive plus one file per entry), one TASK entry per task, the branch and pull request are the claim, status lives only on the section 12 board, and the compliance protocol is merged into ACTIVITY.md. Board change: the P0-09 row cites this entry. Blockers and assumptions tables unchanged. Hard rules H-01 to H-27 unchanged, byte for byte. DONE (self-reported); not verified.
**Evidence:** Runs on commit b5229fb, branch claude/slim-docs-process over c21c04d, DATABASE_URL unset, Windows host, embedded Postgres.
- Archive move: the committed blob docs/log/archive.md against the same byte range of the c21c04d blob of docs/ACTIVITY.md: both 755827 bytes, sha256 39482173d259b1a5a8bef82f4dc1fe405286fb655ef64e14086e92e6230ef10c, byte compare identical. Sections 5, 8, 10, 14 and 15 of ACTIVITY.md are byte-identical to c21c04d.
- docs/ACTIVITY.md: 828435 bytes before; `wc -c docs/ACTIVITY.md` gives 77198 after.
- `node scripts/activity-log-check.mjs origin/main` OK, exit 0, 2 new entries, 31 changed files, with no owner terms set locally. Same with base c21c04d.
- `pnpm lint` exit 0 (109 files, 33 warnings, 42 infos). `pnpm typecheck` exit 0. `pnpm agent:preflight` PREFLIGHT OK. `pnpm agent:preflight:test` 12 of 12. `pnpm service-role:scan` OK, 59 files.
- `git grep -n` for the deleted protocol's file name: 21 lines in docs/log/archive.md, none elsewhere.
- Log-check tests, one file at a time, `vitest run` with `-t "activity-log-check|log check"`: reverify4 5 passed, reverify5 10 passed, reverify6 6 passed, reverify7 5 passed, reverify8 12 passed, reverify9 8 passed, reverify10 10 passed, reverify11 5 passed and 4 expected fail (its it.fails entries, unchanged), log-check-rulings 36 passed.
- After those runs a board verdict was narrowed to VERIFIED and CORRECTION entries only, as MJ's instruction keeps VERIFIED a kind of its own, and the reverify11 D1 titles were reworded. Rerun on that change, same filter: reverify10 10 passed, reverify11 5 passed and 4 expected fail, log-check-rulings 36 passed. The check, lint and preflight were rerun too: same results.
- Not run: the database and client parts of reverify4, 5, 10 and 11 (filtered out by -t; those parts were not edited), the rest of db:test, the web build, e2e and the stack browser tests. CI covers them on push. KIRAN_SENSITIVE_TERMS is empty locally, so owner terms ran only in the tests that set their own term.
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
