# 2026-11-05 07:14 PKT · Claude · Opus 5.5 · branch claude/p1-22-commission · TASK
**Task:** P1-22 (completion slice 5; CTL-13, FLD-01, FLD-03, FLD-06; D-31, D-38, OQ-34 default; areas: migration 20261105140000_commission.sql, tables rep_commission_rate and commission_payment, column invoice.commission_rate_bp, app.finalise_delivery stamping point, app.office_set_commission_rate, app.office_record_commission_payment, app.office_reverse_commission_payment, app.my_commission, app.office_commission, app.office_commission_reps; supabase/tests/commission.test.ts, rls-matrix rows, verifier-attacks allowlist; office page /office/commission and its nav entry; rep pages /app/commission and /app/account; the stack test; docs 03, 04, 06, 12, SPEC.md, board row P1-22)
**What / why:** Slice 5 of the project completion plan (docs/superpowers/plans/2026-11-05-project-completion.md, section Slice 5). Claim: this branch, stacked on claude/p1-21-delivery-approval (slice 4, local only), at 55c48f2. Checked before starting: git branch -r shows no other commission branch (origin/claude/orders-delivery-commission is PR A, merged); slices 2 and 3 (P1-19, P1-20) are not on this branch, so there is no investor ledger here to copy and migrations 20261105110000 and 20261105120000 do not exist yet.

Session start: read CLAUDE.md, docs/ACTIVITY.md in full, the ten newest docs/log entries, docs/16-project-completion-goal.md, the completion design spec (R7, R8), the completion plan, the slice 4 entry, doc 03 rows CTL-13, FLD-01, FLD-03, FLD-06, doc 06 section 2 commission rows, doc 04 and SPEC.md commission lines, doc 12 D-31, D-38 and OQ-34. The caller's brief names docs/AGENT-COMPLIANCE-PROTOCOL.md; that file does not exist on this branch: MJ's decision 2026-11-04-mj-process-and-pr-b-plan merged it into ACTIVITY.md and deleted it, and CLAUDE.md no longer names it.

Database, migration 20261105140000_commission.sql (forward-only):
- The per rep and salon rate is not a new table: it stays salon_rep_assignment.rate_bp (slice 1, set with app.office_assign_salon_rep or app.office_decide_salon). rep_commission_rate holds only the rep default: append-only (forbid_mutation, no_truncate), audited, RLS enabled and forced, office-only select, no write grant; rate 0 to 10000 bp, reason 5 to 300, the latest row by seq is current.
- invoice.commission_rate_bp with a range check, and a NOT VALID check invoice_rate_stamped (not null) binding new invoices only, no backfill of append-only invoices (as slice 4's Decision 8). Named to sort after invoice_delivered_by_set, because Postgres checks constraints in name order and slice 4's test expects its own name on an invoice missing both stamps; no slice 4 assertion changed.
- app.finalise_delivery re-created with slice 4's body unchanged except the invoice insert, which also writes app.commission_rate_for(o.assigned_rep_id, o.salon_id): the salon's latest assignment row's rate when that row names the order's assigned rep and carries a rate, else the rep's latest default, else 0; 0 for an order with no assigned rep. Diffed against the slice 4 body: only the insert's column list, values and comment differ. Both callers (office approval of a rep's submission, office_deliver) get it.
- commission_payment: append-only, audited, RLS enabled and forced, office-only select. Kinds payment and reversal; a reversal names the payment (unique, so once), copies its amount and carries a reason of 5 to 500. control.commission_payment_guard (before insert, per-rep advisory lock) refuses a payment above all-time earned minus all-time paid and a reversal that does not mirror one payment of the same rep and amount, both 23514, so a direct insert meets the same rule.
- Writes, owner or manager at AAL2 (app.assert_office), security definer, search_path pinned, client_id replay (same actor and facts returns the row; other facts 23505), actor from auth.uid(): app.office_set_commission_rate, app.office_record_commission_payment (positive amount, note up to 300, rep lock before the balance read), app.office_reverse_commission_payment (row lock on the payment; a reversal or an already reversed payment is 55000; unknown 22023).
- Reads: app.my_commission(from, to) for a rep on its approved phone only, no rep id taken; app.office_commission(rep, from, to) adds the rep's name, status and default-rate history; app.office_commission_reps(from, to) lists every rep with default rate, earned and paid in the range and owed to date. The shared internal app.commission_statement returns allow-listed fields only (invoice id, number, date, salon name, total, rate, commission; payment kind, amount, note, reason, reversed, time, recorder's name; the rep's directly assigned salons and their rates); lists hold the newest 50, totals count every row. Internal helpers (commission_rate_for, assert_commission_range, commission_earned_paisa, commission_paid_paisa, commission_statement) have no grant.

Web: /office/commission (date range, reps table, open a rep: default rate with reason, rate history, assigned salons and rates, record a payment in rupees with a note, payments with Reverse and a reason, the invoices behind the figures; one client id per form kept until success; the database's refusals shown), nav entry Commission; /app/commission (rep, date range, earned, paid, owed, invoices, payments, read-only); /app/account (rep, read-only from app.my_session); links on /app. Shared types and Karachi date helpers in apps/web/lib/commission.ts. Stack test (CI only): manager sets Rep One's default rate, the rep hands over one unit of the order the rejection test left confirmed, the manager approves, the office sees the stamped invoice and records Rs 20, the rep reads owed and the payment, the office reverses it, the rep sees the reversal, the rep's account page; and the signed-out redirect for /office/commission. It reads the owed figure first and asserts only deltas, because Rep One's earlier invoices were stamped at 0%.

Docs (H-25): doc 03 CTL-13, FLD-03, FLD-06 as built; doc 04 rep_commission_rate and commission_payment rows and the derived figures; doc 06 section 2 commission rows and the as-built note; doc 12 D-38 status; SPEC.md P1-22 row; board row P1-22 set to IN PROGRESS (implemented, awaiting CI including the e2e-stack browser test, and an independent check), in P1-21's wording. Doc 10 has no commission text, so it is unchanged. In the master prompt's words this is IMPLEMENTED — NOT VERIFIED.

Rulings made here (safest reading; MJ may overrule):
- Earned base: invoice.total_paisa (after discount) of every invoice whose commission_rep_id is the rep, at its stamped rate, floor per invoice (D-31 delivered and invoiced value, D-38 formula). Office deliveries of an assigned order earn too, since D-31 keys on the assigned rep. Invoices older than this migration have no rate and earn nothing.
- Ranges are Karachi dates, both ends, at most 366 days. Earned and paid are for the range; owed and the payment cap are always all-time, because a range-owed figure could go negative.
- A reversal is always the full payment, once; a reversal is final. OQ-34 default: no checker, marked default-unconfirmed in the migration header.
- Reps have no table read of rep_commission_rate or commission_payment; they read only through app.my_commission. A salon login reads nothing.
- One read beyond the plan's five: app.office_commission_reps, the office screen's per-rep summary.
- Not built: the clawback on write-offs (CTL-13) waits for write-offs (P1-08); the new-salon bonus and the monthly statement stay Phase 2.
**Evidence:** Baseline on 55c48f2 in the new worktree, DATABASE_URL unset: pnpm install --frozen-lockfile done; pnpm agent:preflight PREFLIGHT OK, worktree clean; pnpm typecheck exit 0; pnpm lint exit 0 (123 files, 33 warnings, 42 infos).

Commits: bab8749 (this entry, intent), 84f3095 (migration and commission.test.ts), 074e8d8 (rls-matrix rows, verifier-attacks allowlist and CALLS), 01dd370 (screens), c6442d1 (test type fix), 28fc6ec (stack test), 7893853 (docs and board), and the commit that carries this addition. DATABASE_URL and KIRAN_TEST_DATABASE_URL unset; embedded Postgres; pnpm exec vitest run --config supabase/tests/vitest.config.ts, one command at a time.
- commission: first run the known No test files found and Unknown Error setup flake, rerun: 34 tests, 1 failed (the invoice document check matched the word in the test product's name; the test now checks JSON keys only), then 34 passed. After adding tests: 36 passed.
- delivery-approval after the stamp: 1 failed (a new invoice without delivered_by is refused: the new check fired first by name order); the constraint was renamed invoice_rate_stamped, no slice 4 assertion changed; then 42 passed.
- verifier-attacks 43 passed; rls-matrix 2163 passed; schema-hygiene 13 passed (introspective, nothing to add).
- The combined leakage run, ONE command: commission delivery-approval rls-matrix schema-hygiene verifier-attacks payments deliveries invitations salon-approval visits: 10 files, 2543 passed, 0 failed.
- Adjacent delivering suites, one command: crm-attacks handovers invoice-document office-cash office-order-access order-cards orders.test receivables-ageing: 9 files, 241 passed. reverify10 alone: 16 passed. reverify11 alone: 8 passed, 6 expected fail (its it.fails entries, unchanged).
- pnpm typecheck exit 0. pnpm lint exit 0 (128 files, 33 warnings, 42 infos, the baseline counts).
- NODE_ENV=production with the CI NEXT_PUBLIC placeholders, pnpm -C apps/web build exit 0; routes include /app/account, /app/commission, /office/commission.
- CI=true pnpm -C apps/web test:e2e: 4 passed. pnpm service-role:scan OK, 73 files; node scripts/service-role-scan.mjs --bundle apps/web/.next/static OK, 118 files. node --check scripts/e2e-stack-seed.mjs exit 0 (the seed is unchanged by this slice).
- node scripts/activity-log-check.mjs origin/main and pnpm agent:preflight: see the addition at the end.

Not run here: apps/web/e2e-stack (no Docker on this host; CI only), so the commission browser journey is unexercised. The other reverify suites and the rest of db:test (CI runs them). A two-session race on the payment cap (the per-rep lock is in place; not exercised with two connections). Nothing was pushed, merged or applied to any Supabase project; synthetic data only.

DoD (section 6):
[x] Requirement IDs implemented as written, differences listed above (clawback waits for P1-08)
[x] Migration forward-only; applies on a fresh embedded database after every earlier migration
[x] New tables: RLS enabled and forced, policies, matrix rows for every persona
[x] Append-only tables refuse UPDATE, DELETE and TRUNCATE, tested even as postgres
[x] Mutations through security definer functions, pinned search_path, client_id replay tested
[x] Audit rows produced with the session's actor, chain verifies (tested)
[x] No vault data involved; the rep statement's keys are allow-listed (tested)
[ ] Offline: online-only office and rep reads; no rep write in this slice
[x] Money in integer paisa, floor per invoice tested with hand-worked figures
[ ] Lint, typecheck, touched DB suites pass locally; CI not yet run (so not DONE)
[x] Docs and board updated
[x] No secrets, real personal or supplier data in the diff (read)
[x] This entry holds the evidence

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[x] Audit trigger present; hash chain verifies (H-17)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Docs match code; deviations logged (H-25)
[x] Tests actually run; real results recorded (H-23, H-24)
**Next / needs:** CI on a pull request (MJ decides when to push), especially e2e-stack (the commission journey) and the full reverify suites. MJ: OQ-34 (a checker or owner threshold on commission payments) stays open with the built default. Slices 2 and 3 touch the same verifier-attacks list, rls-matrix, office nav and board: rebase conflicts are expected there and are additive.
