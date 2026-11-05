# 2026-11-06 00:03 PKT · Claude · Sonnet 5.5 · branch claude/settings-nav · TASK
**Task:** the owner-only Settings link in the office sidebar (remaining-implementation plan C1; audit FLOW-14; areas: apps/web/lib/office-nav.ts, e2e-stack specs)
**What / why:** The Settings page existed but was reachable only from the Team page. It now has an Administration group in the sidebar with one item, Settings, marked ownerOnly, so the manager's sidebar shows neither the link nor the group (a group with no item is dropped). Hiding it is convenience; the page and the database still refuse a manager (unchanged). The owner settings journey opens Settings from the sidebar and checks that the manager has no such link; an older comment in the sidebar test now says why a manager sees none. No migration, function or policy changed.
**Evidence:** pnpm typecheck, Biome and the activity-log check are run before the commit. Not run locally: the stack journeys (no Docker); CI is the first run.
**Also on this branch:** scripts/apply-kiran-migrations.mjs, the checked script MJ runs with his own connection string to apply the 13 migrations after office_orders_cards to the Kiran project (H-19: only on MJ's approval; it refuses any other project, checks the starting state, one transaction per migration, stops at the first error). A dry run on 2026-11-06 showed 25 applied and 13 to apply; a real run applied 12, then stopped on a missing file in an out-of-date checkout, so audit_fixes was still to apply.
**Next / needs:** CI on the pull request; MJ's OK to push and to merge.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no table or policy touched)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (no database change)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (no function added)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (Settings stays owner-only; the manager is refused as before)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
