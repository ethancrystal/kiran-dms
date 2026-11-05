# 2026-11-05 09:12 PKT · Claude · Opus 5.5 · branch claude/product-group-screen · TASK
**Task:** ADM-01 (product groups and default cycles; supports INV-13, doc 16 "manager can add products"; areas: screen /office/products, stack test office.spec.ts). No database objects change. Open branches and pull requests checked for overlap: PR 59, claude/p1-22-commission, claude/p1-23-portal and claude/p1-24-rep-readonly do not touch /office/products; the session building those slices confirmed it has no claim here.
**What / why:** A walk through the code against doc 16 found that Add a product requires a product group, while no screen on main or on the slice branches calls `app.office_upsert_product_group`; only the test seed and the database tests make groups. So on a fresh database nobody could add a product from the app. This adds a Product groups section to the Products page: list, add, edit name and default cycle, deactivate and activate. Each add attempt has one id, so a retry after a lost answer is the same group. Refusals show the database's message. Groups are config, owner only in doc 06 section 2, so the owner sees the controls and a manager sees a read-only list; B-41 asks MJ to settle the difference from the database, which still allows any office role.

The same walk found other journeys that have no screen, which this task does not build: stock issue and bags, office delivery, order cancellation, releasing credit and discount holds. The session building slices 4 to 7 is taking those to MJ as unassigned scope.
**Evidence:** Base origin/main 903cd29. Commit SHA: the commit that adds this file on branch claude/product-group-screen.
Run before the change: `node scripts/agent-preflight.mjs` PREFLIGHT OK; `pnpm lint` exit 0 (35 warnings, 42 infos); `pnpm typecheck` exit 0.
Run after the change: `pnpm lint` exit 0 (35 warnings, 42 infos, same as before); `pnpm typecheck` exit 0; `pnpm -C apps/web build` exit 0.

Not run, so nothing here is proven at runtime:
- `pnpm db:test`, baseline: started and stopped by Claude Code because the machine was critically low on memory, with no result. ACTIVITY section 2 step 6 asks for this baseline, so it is an open gap, not a pass. This task changes no migration or database test.
- The two new stack tests in apps/web/e2e-stack/office.spec.ts have never run: this machine has no Docker, so no local Supabase stack. They and the screen are unverified until the CI office browser test job runs them.
- No browser opened the screen.
**Next / needs:** MJ: approve pushing this branch and answer B-41. Then CI on the pull request, especially the office browser tests. Status: implemented but not tested in a browser or against a database; not `DONE (self-reported)`, so the board row is unchanged. B-41 added to section 14. A rebase over slices 4 to 7 may conflict additively in office.spec.ts and section 14; the B number may need renumbering if another branch takes B-41.

Security checklist (tick honestly):
[n/a] RLS enabled+forced; policies + role×table tests added/updated (H-13): no table changes
[n/a] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07): no append-only table touched
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08): existing function, keyed by id
[ ] Audit trigger present; hash chain verifies (H-17): existing trigger not changed; not run here
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05): no vault data read or shown; leakage tests not run here
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20): test names are [Dummy]; diff read
[ ] Governance powers still owner-only + AAL2 (H-15): the screen is owner-only, the database is not; see B-41
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25): B-41 records the mismatch
[ ] Tests actually run; real results recorded (H-23, H-24): lint, typecheck and build only; see Not run
