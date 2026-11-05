# 2026-11-05 05:40 PKT · Claude · Opus 5.5 · branch claude/p1-20-investors · TASK
**Task:** P1-20 (completion slice 3; CAP-01, CAP-02, CAP-03; D-24, D-40, D-41; areas: investor, investment, investor_profit_decision, investor_payout, the app.office_*investor* functions, /office/investors, /office/investors/[id], the office nav, the stack test, docs 03, 04, 06, 12, 14, SPEC.md, the board row P1-20)
**What / why:** Slice 3 of the project completion plan (docs/superpowers/plans/2026-11-05-project-completion.md): the basic investor ledger MJ asked for ("how much money they will get on it will be decided by manager/owner"; master task: no automated investor profit-calculation or distribution engine). Office only, no investor login, separate from commission, not posted to cash, receivables or sales; no formula, no split, no promised return.

Database, migration 20261105120000_investor_ledger.sql (test first):
- public.investor: name, optional phone (10 to 15 digits, optional +) and note, status active or closed; client_id unique per creator, and app.office_create_investor replays by it (another person with the same key gets their own row, never someone else's). Never deleted, identity immutable (guard trigger, also for the table owner).
- public.investment, public.investor_profit_decision, public.investor_payout: append-only (control.forbid_mutation on UPDATE and DELETE, no TRUNCATE). Decisions and payouts belong to one investment. A payout is of profit or principal, by cash, bank or other, with a reference (required for bank). A reversal is a row in the same table: unique reverses_id, the exact negative, the same parent (and kind and method for a payout), a reason of 5 to 300 characters required on reversal rows only (check constraint plus a guard trigger that holds for any writer).
- Forced RLS, select for owner or manager at AAL2 only (app.is_office), no API write grant, audit trigger on all four tables.
- Functions, all security definer with search_path pinned, granted to authenticated only, owner or manager at AAL2 (app.assert_office), actor from auth.uid(): app.office_create_investor, app.office_update_investor (name, phone, note, status; closing needs principal outstanding and profit owed both zero; reopening allowed; the same values write nothing), app.office_add_investment, app.office_decide_profit, app.office_record_payout, app.office_reverse_investor_entry(p_client_id, p_entry_kind, p_entry_id, p_reason), app.office_investors (each investor plus one totals row, is_total, over all investors), app.office_investor_investments (each investment with its figures; added because the detail page needs them), app.office_investor_statement(p_investor_id, p_from, p_to) (date order, running principal outstanding and profit owed worked out over the whole history, then filtered). Figures are derived, never stored.
- Replay: client_id lock, replay lookup first (so a lost-answer retry after a close or reversal still returns the first row), different facts 23505. Then the investor's advisory key (investor: and the id), which covers all its investments and its closing, then the state checks, then the first write: the repo's lock order, all before the audited insert.
- Errors: 42501 wrong role or session; 22023 bad input or unknown reference (no 23503 or P0002); 55000 wrong state (closed investor, reversed investment, already reversed, a reversal reversed, closing with money outstanding); 23505 replay with other facts; 23514 an amount over its limit (the payments precedent): a profit payout above decided minus paid, a principal payout above invested minus returned, a decision reversed below what was paid, an investment reversed while money moved on it.

Rulings (safe defaults recorded here; none invents a business rule; MJ may overrule):
- From the brief: investor.client_id unique per creator; a reason column required on reversal rows; totals as a row of app.office_investors (one function, not a second); 22023 for unknown references.
- Decisions and payouts are per investment (the brief locks the investment; the investor key covers it).
- An investment can be reversed only while nothing was returned, decided or paid on it; nothing new on a reversed investment.
- A closed investor takes nothing new, reversals included; the office may reopen it.
- Reversals are dated by the server (Karachi today); dates are not in the future and a decision or payout is not dated before its investment. A profit payout may still be dated before the decision it pays, so a statement's running profit owed can dip below zero between two rows; the totals cannot.
- Amounts 1 to 99,999,999,999 paisa, the largest lib/money.ts toPaisa makes. A bank payout needs a reference.
- OQ-34 default: no second person on a payout.

Web: nav Investors; /office/investors (totals strip from the database's totals row: invested, principal outstanding, profit decided, profit paid, profit owed; the investors table; add investor) and /office/investors/[id] (figures; investments with their numbers; add investment, decide profit, record payout; the statement with a date range and Reverse through ConfirmAction with the database's 5-character minimum; details edit, close and reopen). A plain note on both pages: amounts are decided and typed by the office, nothing is calculated, nothing is posted to cash, receivables, sales or commission. Database messages shown; one client_id per attempt, renewed on success; loading, empty and error states; rupees typed through toPaisa.

Docs: 03 (how CAP-01 to 03 are built), 04 (built rows and columns, invariant 1 gains the three append-only tables, investor totals as office functions), 06 (the matrix row: built, not verified, OQ-34 default), 12 (D-40 status; OQ-24, OQ-25, OQ-29, OQ-30 built notes), 14 (a note under 6.1 and under journey J5: the basic ledger is not the agreement, batch or settlement model), SPEC.md (owner's morning journey J5 gains step 6, Investors; the feature row names the tests). SPEC.md's own J5 is the owner's morning; doc 14's J5 is the investor journey; both got a line. Board row P1-20 set to IN PROGRESS (implemented, awaiting CI including the e2e-stack browser test, and an independent check). In the master prompt's words this is IMPLEMENTED — NOT VERIFIED; the board cannot say so (Appendix C rule 4), as with P1-18. ACTIVITY H-06's list is unchanged (B-29).
**Evidence:** Branch claude/p1-20-investors from origin/main e7209f4. Commits 44b88f5 (migration and database tests), c7c95ff (web and stack test), and the docs commit carrying this entry. DATABASE_URL and KIRAN_TEST_DATABASE_URL unset in every test shell; embedded Postgres 17 (locale C), synthetic data only ([Dummy] names, phone +920000001234).

Test first: pnpm exec vitest run --config supabase/tests/vitest.config.ts investors.test before the migration: 1 file failed (beforeAll and afterAll errors, the functions and tables missing), 39 skipped.

After the migration, each command once:
- investors.test: 39 passed (first run on the migration). Covers owner and manager, hand-worked totals across two investors and several investments with reversals (totals row checked as a delta and as the sum of the investor rows), the statement and its date filter, every 22023 refusal with its words, overpay and overreturn (23514), no partial writes (row and audit counts unchanged after four refused committed calls), replays and different-facts replays, replay before state, reversal rules, closing and reopening, every function refused for rep A, rep B, rep A on a wrong device, a suspended rep, manager and owner at AAL1, anon and a login with nothing redeemed, zero rows for those personas on all four tables, direct INSERT, UPDATE and DELETE refused for manager, owner, rep A, anon and service_role, append-only and guards as postgres, forged reversal rows, the audit actor from the session and the chain verifying, nothing posted to cash, payments, receipts, invoices or orders, a payout waiting for the investor's advisory key held by another session (over 1 s), and two concurrent payouts of Rs 40,000 against Rs 60,000 decided: one passed, one refused.
- rls-matrix: 2123 passed (four new rows). schema-hygiene: 13 passed (no change needed). verifier-attacks: 36 passed after adding the nine functions to the allowlist (first run 1 failed: list order, fixed).
- Leakage: the two-session tests commit one investor (an investment, a decision, one payout); afterAll deletes exactly those rows in one committed transaction with the four tables' triggers off, then checks no row is left and no trigger is disabled. One vitest command, files in name order: pnpm exec vitest run --config supabase/tests/vitest.config.ts investors.test visits.test crm-attacks.test orders.test schema-hygiene verifier-attacks rls-matrix: 8 files (crm-attacks, investors, office-orders, orders, rls-matrix, schema-hygiene, verifier-attacks, visits), 2348 passed. Without rls-matrix: 7 files, 225 passed. Name order puts crm-attacks before investors, so that file cannot see leakage from this one; the files after it (office-orders, orders, rls-matrix, schema-hygiene, verifier-attacks, visits) passed.
- pnpm typecheck: pass. pnpm lint: pass, 33 warnings and 42 infos (the baseline counts).
- pnpm -C apps/web build with the CI placeholder public settings: pass; routes include /office/investors and /office/investors/[id].
- pnpm service-role:scan: OK, 69 files. node scripts/service-role-scan.mjs --bundle apps/web/.next/static: OK, 110 files. node --check scripts/e2e-stack-seed.mjs: exit 0 (the seed needs no change).
- CI=true pnpm -C apps/web test:e2e: 4 passed.
- pnpm agent:preflight: PREFLIGHT OK at the start; node scripts/activity-log-check.mjs origin/main and the final preflight: see the addition at the end of this entry.

Not run here: apps/web/e2e-stack (no Docker on this host; CI only), so the new journey (manager adds a [Dummy] investor, Rs 100,000 invested, Rs 12,000 decided, Rs 5,000 paid, Rs 7,000 owed on the figures and the investment row, again after a reload and on the list; the rep's phone has no Investors link and reaches no office page) is unexercised. The reverify suites and the full suite (CI runs them). Nothing touched staging or production.

DoD (section 6):
[x] Requirement IDs implemented as written (CAP-01 to 03); rulings above
[x] Migration forward-only; applies on a fresh embedded database with every earlier migration
[x] New tables: RLS enabled and forced, policies, matrix rows for every persona
[x] Append-only tables refuse UPDATE and DELETE, tested even as the table owner
[x] Mutations through security definer functions, pinned search_path, client_id replay tested
[x] Audit rows produced with the session's actor; the chain verifies
[x] No vault data involved
[ ] Offline: not applicable (office screens only)
[x] Money in integer paisa, bigint, no floats
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

Concerns: slice 2 (P1-19, pull request 57, migration 20261105110000) is not on main. If this branch merges first, a database that already has 20261105120000 will refuse the older 20261105110000 under the Supabase CLI; merge slice 2 first or renumber. Both change the verifier allowlist, the RLS matrix, the office nav, the board and docs, so the second to merge resolves conflicts. Doc 14 section 6.1 asks for adviser review before live use; OQ-23, OQ-26, OQ-27 and OQ-28 stay open.
Addition, on 7cb341d: node scripts/activity-log-check.mjs origin/main: OK (1 new log entry, 17 changed files; owner terms checked: 0, the secret is not set locally). pnpm agent:preflight: PREFLIGHT OK, worktree clean.
**Next / needs:** CI on the pull request, especially the e2e-stack job. MJ: the rulings above (reopening, the investment-reversal rule, per-investment decisions and payouts, OQ-34 default) and the merge order with slice 2. Then slice 4 (P1-21).
