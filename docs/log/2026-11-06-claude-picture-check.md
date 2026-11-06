# 2026-11-06 07:22 PKT · Claude · Sonnet 5.5 · branch claude/picture-check · TASK
**Task:** AUTH-08, a stack check that the salon's own page shows a product picture the manager uploaded (areas: apps/web/e2e-stack/office.spec.ts; plan C4)
**What / why:** The P1-19 journey uploads a picture for its new product and checks it loads on the Products page, but nothing checked that a salon login can read it through its own screen and the bucket's policies. That journey now keeps the product's name and code; the later salon portal journey (P1-23) finds that product in the salon's catalogue and checks its picture is visible, has loaded (a width above zero) and carries the product's name. The rep screens show no product pictures (only the salon page and the office order form read them), so there is no rep screen to test; that part of AUTH-08 is closed by saying so. No migration, function, policy or page changed.
**Evidence:** pnpm typecheck, Biome and the activity-log check are run before the commit. Not run locally: the stack journeys (no Docker on this host); CI is the first run.
**Next / needs:** CI on the pull request; MJ's OK to push and to merge.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no table or policy touched)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (no database change)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (no function added)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
