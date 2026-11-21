Closes the pre-existing red `office browser tests` job on main (first red run of origin/main 0dad9f7: run 44930031088). The other open PRs (131, 132, 133, 134) show the same job red until this merges and they take origin/main in.

## What and why

The discount-tiers journey in apps/web/e2e-stack/roles-coverage.spec.ts (line 264) was written against an imagined state: it asserted pending approval_request rows exist, but nothing in the seeded stack or the earlier journeys leaves one when this file runs — the P1-19 journey's salon-price order does open a discount request, and the P1-25 end-to-end journey approves it ("Approved the discount request. The order is now confirmed."), so the pending queue is empty by then. The old body also withdrew whichever row it found and released a credit hold on "the newest sales_order of the whole stack", an order it owned nothing about.

The rewrite follows the C0a work order (docs/plans/in-progress/2026-11-21-execution-handoff.md §2 C0a, dispatched by the lead 2026-11-21) and keeps the test title. The journey now creates its own pending discount:

- The manager makes two discounted office orders for seed.catalogueSalon through the order form (one line, the seed SKU, CASH, per-line price Rs 1 against the Rs 1,500 list — a 99.9 percent discount, owner-tier whatever app_config holds), asserting the creation notice "Order created for {salon}: draft · ... (held: pending)." and the database rows (draft, hold_discount pending, hold_credit null, discount = list minus 100 paisa, maker and checker_role_required owner).
- Asserts the Approvals page rows (maker = manager, mine mode: the "You asked for this; another office user decides it." note, Withdraw visible, no Approve). Maker-checker at the SQL layer stays pinned by supabase/tests/office-approvals.test.ts, cited in a comment.
- Withdraws the first (reason "[Test] wrong price"); the notice "Withdrew the discount request." shows, the row leaves the page, the request reads cancelled.
- The owner approves the second ("Checked how" "[Test] within policy"); the notice matches "Approved the discount request. The order is now", the request reads approved with checker_id = owner, the order reads confirmed.
- Credit hold on a third list-price order on INST2 (no discount, and app.credit_of defaults to CASH eligibility so the order is a draft held plan_not_allowed): owner opens the order, Release credit hold with the reason, the page shows "(credit hold released)", and stackQuery reads credit_override_by = owner id, status confirmed.
- Keeps the light salon-portal check (codeSignIn as seed.people.journeySalon; full isolation journeys live elsewhere).

## Evidence

- Diagnosis and every asserted string are first-hand code reads on this branch: supabase/migrations/20261105110000_catalogue_prices.sql (app.build_order pricing and the discount hold), apps/web/app/office/(shell)/approvals/page.tsx (row testid, mine/decide modes, ConfirmAction labels, notices), apps/web/components/order-form.tsx and apps/web/app/office/(shell)/orders/page.tsx (form labels, "New order" role, creation notice), apps/web/app/office/(shell)/orders/[id]/page.tsx (Release credit hold, "(credit hold released)"), apps/web/lib/money.ts (toPaisa), scripts/e2e-stack-seed.mjs (sku list 150000 paisa, catalogueSalon, journeySalon), office.spec.ts (the P1-19 order pattern at ~1097-1122 and the P1-25 approvals step at ~1604-1616).
- node scripts/agent-preflight.mjs: exit 0, "PREFLIGHT OK: governance files and references are in place."
- node scripts/activity-log-check.mjs: OK (1 new log entry, 3 changed files).
- pnpm lint (biome ci, worktree): exit 0, 252 files checked, the pre-existing 42 warnings and 38 infos only. The one diagnostic touching the spec file (unused CODE_LENGTH, line 27) exists unchanged on origin/main.
- pnpm -C apps/web typecheck: exit 0.
- pnpm exec biome check --write apps/web/e2e-stack/roles-coverage.spec.ts: formatting only.
- Commit: 67210fe. Log entry: docs/log/2026-11-21-office-browser-discount-journey.md. Board row P1-42 appended after P1-14 (docs/ACTIVITY.md).

## Not run

The e2e-stack suite itself cannot run on this host (no Docker); CI proves the fix — the office browser tests job on this head is the evidence (the pull request 130 precedent, docs/log/2026-11-21-roles-coverage-salon-refusal.md). pnpm db:test not run (no migration changed). Nothing was run against a hosted Supabase project (H-19).

## Risks and rollback

No app or database change; the only behaviour change is the test journey itself. If the journey still fails in CI, revert commit 67210fe — the job returns to its pre-existing state, no worse.
