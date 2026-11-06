# 2026-11-06 18:30 PKT · Claude · Sonnet 5.5 · branch claude/apply-script-parts · TASK
**Task:** H14 of the Hermes work order (no plan item; found 2026-11-06 in 2026-11-06-mj-apply-inactive-rep-cash; areas: scripts/apply-kiran-migrations.mjs only)
**What / why:** The script had a fixed list of 13 files and matched by exact name, so it reported audit_fixes as pending although the project holds it as three parts, and it would miss every newer migration. It now lists every migration file from 20261105100000 on, in file-name order, treats audit_fixes as recorded when its three part names are recorded, and checks only that office_orders_cards is already applied (the fixed expected count of 25 is gone). The header comment no longer says 13. Rule 1.3 of the work order was lifted for this one file.
**Evidence:** `node --check scripts/apply-kiran-migrations.mjs` passes. `node scripts/apply-kiran-migrations.mjs` with KIRAN_DB_URL unset stops at the Set KIRAN_DB_URL error. `biome ci` on the file passes. The script was not run against any database, with or without --dry-run; MJ's next dry run is its first real check. The recorded names of migrations applied after 2026-11-05 (for example inactive_rep_cash) are assumed to equal their file slugs; the dry run will show it if not.
**Next / needs:** CI on the pull request; MJ's OK to merge; MJ runs the dry run before any real run (H-19).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no database change)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (no function added; the script is MJ-run only)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16) (it still refuses any database that is not the Kiran project)
