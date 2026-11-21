# Frontend-alignment execution handoff — live coordination document

**Purpose:** any agent (or fresh session) picking up the frontend-alignment implementation resumes from this file with no re-planning. Prepared 2026-11-21 ~23:00 PKT by AutoClaw project 「K」 at MJ's instruction ("make a plan so if your credits end another agent picks it up without expensive planning and just start implementing"). MJ approved the plan in chat ("implement it", 2026-11-21).

**Source of truth for progress:** open pull requests + `docs/log/` + the board (docs/ACTIVITY.md §12) — not this table. The status table below is a convenience snapshot the lead updates from receipts.

**Companion documents:** the approved plan at `docs/plans/in-progress/2026-11-21-frontend-backend-alignment.md` (committed by Phase A together with this file); MJ's external review preserved verbatim at `derived/fe-plan/review-round-2026-11-21.md`; evidence reports committed by Phase A under `docs/coverage/evidence/` (working copies also in `derived/fe-plan/` and root `backend-inventory.md`).

## 0. Cold-start resume procedure (read this first, in order)

1. Read `AGENTS.md`, `docs/ACTIVITY.md` (rules, board, blockers), and the 5 newest `docs/log/` entries for your slice's area.
2. Read this file and `docs/plans/in-progress/2026-11-21-frontend-backend-alignment.md`.
3. Check what is already claimed: `git branch -r` and `gh pr list --state open`. If a slice's branch or PR already exists, do NOT redo it — review it, continue it, or pick another slice. The status table in §1 and the pre-assigned board IDs in §2 are the claim map.
4. `pnpm agent:preflight` from your worktree after creating it (§5).
5. Claim your slice: create the worktree + branch exactly as named in §2, start the TASK log entry with your first commit, and work the work order.
6. Open the PR; reply to the lead with: PR URL, check status, what was not run. Never merge — MJ approves each merge in chat (ACTIVITY §10).

**Non-negotiables:** never work on `main`; never switch the branch of the PRIMARY worktree `C:/Users/moizjmj/K` (it is shared by concurrent AutoClaw sessions and sits on `fix/roles-coverage-salon-refusal` with another session's state — do all work in your own `git worktree` under `.worktrees/`); no force-push, no reset of others' work; one coherent commit series per slice; evidence for every claim (H-23, H-24); timestamps Asia/Karachi (`YYYY-MM-DD HH:MM PKT`); never touch production or hosted databases (H-19); no secrets or real data in diffs (H-02, H-03, H-20); log-entry format per ACTIVITY §4 (one heading line, no `---`, no blockquotes, no `<`, `&` or backslash outside fenced code).

**Environment facts:** Windows host, pwsh 7, no Docker (the e2e-stack suite runs in CI only), pnpm + node + gh (authenticated as ethancrystal) available. A fresh worktree needs `pnpm install` before pnpm-based checks; the governance scripts are dependency-free and run with plain `node` (`node scripts/agent-preflight.mjs`, `node scripts/activity-log-check.mjs`). Biome can be run from the ROOT install against worktree files: `pnpm exec biome check --write <worktree-file-paths>`.

**Expected red job:** until C0a merges and branches merge `origin/main` afterwards, every PR's `office browser tests` job fails at `roles-coverage.spec.ts:264` — pre-existing on main (run 44930031088), not caused by your diff. Do not chase it in other slices; rebase/merge main after C0a lands.

## 1. Live status table (lead updates from receipts; agents update their own row only after the PR is open)

| Slice | Branch | PR | Board row | Status (2026-11-21 23:00 PKT) |
|---|---|---|---|---|
| C0a office-browser repair | `fix/e2e-stack-discount-journey` | — | P1-42 | DISPATCHED to cluster |
| Phase A mandate adoption | `docs/fe-alignment-mandate` | opened by the lead | P1-40 | COMMITTED 2026-11-21 — this file travels in that PR; supersedes PR #132 (see §2 Phase A) |
| Phase B coverage matrix + gate | `feat/coverage-matrix-gate` | — | P1-41 | DISPATCHED to cluster |
| C0 adopt vault + sheet worktrees | `feat/p1-05-vault-foundation` (continue) and `feat/office-sheet-import` (continue) | — | P1-43 | DISPATCHED to cluster (guards in §2 C0) |
| C1 goods-in/restock UI | not started | — | (assign P1-44 when claimed) | wave 2 |
| C2 team role control | not started | — | (assign P1-45 when claimed) | wave 2 |
| C3–C12 | not started | — | — | see plan §5; claim in order, respect the dependency notes |

Known open PRs at preparation time: #131 (railway docs, another session), #132 (preservation snapshot of this plan set — superseded by Phase A), #133 (staging env readiness, another session), #127 (dependabot). Do not touch other sessions' PRs or branches.

## 2. Slice work orders

### C0a — repair the office browser job on main (first; gates every other PR)

**Branch:** `fix/e2e-stack-discount-journey` from `origin/main` (was `0dad9f7`). **Files you may touch:** `apps/web/e2e-stack/roles-coverage.spec.ts`, your log entry, your board row. Nothing else.

**The defect:** run 44930031088 (and every main run since the #118 merge) fails one test: `roles-coverage.spec.ts:264` "discount tiers, maker-checker, withdrawal, cancel and credit-hold release" — `expect(before.length).toBeGreaterThan(0)` at line 275 where `before` = `select id, kind from control.approval_request where status='pending'` returns 0 rows. The spec file is new with the consolidation merge and this journey, like the role-isolation block PR #130 fixed (commit 675e768), was written against an imagined state: nothing in `scripts/e2e-stack-seed.mjs` or the earlier journeys (office.spec.ts runs first — it contains no discount at all; p130-screens none) leaves a pending approval.

**App facts the rewrite relies on (verified by reading the code on 2026-11-21):**

- `app.office_create_order` / `app.build_order` (migration `20261104090000_office_orders_cards.sql`, lines ~260-330): a line may carry `unit_price_paisa` (the form's per-line Price field; empty = the salon's price, else list). If total discount `v_disc > 0` and the maker is not an owner on an office order, `app.request_approval(..., 'discount', 'sales_order', v_id, jsonb {salon_id, subtotal_paisa, discount_paisa, total_paisa}, 'discount below list price (CTL-07)', checker)` opens a pending `control.approval_request` row. Checker is `'owner'` when the discount exceeds `app_config` key `approval.discount.owner_above` (pct and paisa; a missing/bad key means owner) — so a LARGE discount is deterministically owner-tier; a small one is manager-tier. The owner's own office-order discount takes effect at once (`v_by_owner`, D-45) and opens no request.
- The Approvals page (`apps/web/app/office/(shell)/approvals/page.tsx`): rows carry `data-testid="approval"`, badge text `Discount`, salon name, list/discount/total in rupees, "asked by {maker_name}", "needs the owner" or "an owner or a manager". Row mode `mine` (viewer made it): note "You asked for this; another office user decides it." + a `Withdraw` ConfirmAction (confirm label `Withdraw request`, reason label `Why it is withdrawn`, min 3 chars) and NO Approve/Refuse buttons. Mode `owner-only` (manager viewing an owner-tier request): text `Waiting for the owner.` and no buttons. Mode `decide`: `Approve` (confirm `Approve request`, reason label `Checked how`) and `Refuse`. After a discount decision the page calls `app.recheck_order` and shows `The order is now {status}.` Withdrawal: notice `Withdrew the discount request.` + recheck text.
- Order creation (P1-19 journey pattern, office.spec.ts ~1097-1122): `/office/orders` → `Create New Order` → form role name `New order` → `Salon` selectOption by id → line `select[id^='sku-']` option by SKU code text → `Product 1`, `Quantity 1`, `Plan` selectOption → `Create order` button. A held order shows `Order created for {salon}: draft · {amount} (held: pending).`
- Credit hold (order detail `apps/web/app/office/(shell)/orders/[id]/page.tsx` ~253-261): the `Release credit hold` button renders only when `status === "draft" && hold_credit && !credit_override_by`; ConfirmAction reason label `Why the credit hold is released`, confirm button `Release the credit hold`; `app.office_release_credit_hold` sets `credit_override_by`. A fresh order without credit arrangements is held pending credit (office.spec.ts:1115 shows exactly this for the catalogue salon).
- Seed (`scripts/e2e-stack-seed.mjs`): `seed.catalogueSalon` (id + name), `seed.sku` (id, code `DUMMY-...`, list_price_paisa), `seed.people` incl. `journeySalon` (invited earlier by office.spec.ts's slice-8 journey, so `/salon` sign-in works by the time this file runs), `seed.owner`, `seed.manager`. `officeSignIn(page, person)` and `codeSignIn(page, person, email)` helpers exist in the file. The stack runs one worker, files in name order.

**Journey rewrite (replace the body of the test at line 264; keep the test title):**

1. Manager signs in; creates a discounted order for `seed.catalogueSalon`, 1 × `seed.sku`, Plan CASH, and a per-line Price clearly below the applied price (e.g. `1` rupee) so the discount is owner-tier. Assert the creation notice `draft · ... (held: pending)`.
2. Manager opens `/office/approvals`; assert at least one `[data-testid="approval"]` row; find the Discount row containing `seed.catalogueSalon.name`; assert it contains `asked by` + the manager's name, the note `You asked for this`, a `Withdraw` button, and NO `Approve` button (maker ≠ checker, shown at the UI layer).
3. Manager withdraws: click `Withdraw`, fill `Why it is withdrawn` with `[Test] wrong price`, confirm `Withdraw request`; assert the notice `/Withdrew the discount request/` and that the approval row is gone after the reload the page performs. (Maker-checker at the SQL layer is already pinned by `supabase/tests/office-approvals.test.ts` — say so in a comment instead of re-testing it here.)
4. Manager creates a SECOND discounted order the same way (new client state; the form generates its own ids). Owner signs in (new page), opens `/office/approvals`, finds the Discount row (not theirs), clicks `Approve`, fills `Checked how` with `[Test] within policy`, confirms `Approve request`; asserts the notice `/Approved the discount request/` and `The order is now`.
5. Credit hold: owner (or manager) creates a THIRD order for `seed.catalogueSalon` at list price (no discount). Owner opens `/office/orders/{id}` (id from `stackQuery` on the newest sales_order for that salon), asserts `Release credit hold` is visible, fills `Why the credit hold is released` with `[Test] within policy`, clicks `Release the credit hold`; asserts via `stackQuery` that `credit_override_by` = owner id and the page shows `(credit hold released)`.
6. Keep the salon-isolation spirit lightly: `codeSignIn` as `seed.people.journeySalon` → `/salon` loads and shows the salon's own account (full isolation journeys exist elsewhere; do not duplicate them).

**Rules:** no other spec or app file changes; run `pnpm exec biome check --write apps/web/e2e-stack/roles-coverage.spec.ts` (from root, targeting the worktree file) and `pnpm -C apps/web typecheck` needs install — prefer running `pnpm install` in the worktree once, then `pnpm lint` and `pnpm -C apps/web typecheck`. You cannot run the stack locally (no Docker) — verify by reading + these checks + CI, and say so plainly in the log entry (the PR #130 precedent). **Deliverables:** the commit; TASK log entry `docs/log/2026-11-21-office-browser-discount-journey.md` (Evidence: the run id, the diagnosis, checks run, what was not run); board row `| P1-42 | Repair the office browser job: the discount-tiers journey creates its own pending discount | run 44930031088; ACTIVITY 2.6 | IN PROGRESS (pull request NNN) | — |`; PR title `fix(e2e-stack): the discount-tiers journey creates its own pending discount (P1-42)`; body notes that other open PRs show this job red until this merges and they merge origin/main.

### Phase A — adopt the mandate into the master execution prompt

**Branch:** `docs/fe-alignment-mandate` from `origin/main`. **Files:** `docs/audit-2026-10-31/master-prompt-2026-11-01.md`, `docs/log/2026-11-21-fe-alignment-decision.md`, `docs/log/2026-11-21-fe-alignment-mandate.md`, `docs/plans/**`, `docs/coverage/evidence/**`.

1. **DECISION entry** — create `docs/log/2026-11-21-fe-alignment-decision.md` exactly in ACTIVITY §4 DECISION shape, quoting MJ: the requirement text was supplied in chat on 2026-11-21 with the recommendation "Add this to the existing master execution prompt, rather than replacing it", the framing "the frontend should explain the business, not just display the database", and the instruction "implement it". State what was applied (§12A, matrix home, status vocabulary).
2. **Master prompt edit** — insert the following section VERBATIM between `# 12. FRONTEND ACCEPTANCE REQUIREMENTS` and `# 13. TESTING STRATEGY` (do NOT renumber §13–§19; `docs/audit-2026-10-31/execution-map.md` cites those numbers). Also extend the file's header governance note (the paragraph beginning "Verbatim copy of the master engineering prompt MJ supplied on 2026-11-01") with one sentence: "Amended 2026-11-21: section 12A added by MJ's instruction (docs/log/2026-11-21-fe-alignment-decision.md); everything else is unchanged."

```markdown
# 12A. COMPLETE FRONTEND, BACKEND ALIGNMENT AND DATA PRESENTATION

(Added 2026-11-21 by MJ's instruction, recorded in docs/log/2026-11-21-fe-alignment-decision.md. This section extends §12 (frontend acceptance) and §3.2 (requirement-to-implementation matrix); it does not replace them, and nothing here relaxes §10 or §11.)

Ensure Kiran DMS has a complete, production-ready frontend that fully complements and exposes the capabilities of the backend. Do not treat frontend completion as merely creating pages, forms or dashboards: the frontend must make every approved business workflow understandable, accessible, actionable and consistent with the underlying database, business rules, permissions and calculations. The frontend should explain the business, not just display the database.

## 12A.1 Complete feature coverage

- Map every approved feature, backend capability, database entity and business workflow to its corresponding frontend interface. The feature-to-interface coverage matrix in docs/coverage/ (matrix.json, the rendered COVERAGE.md, enforced by scripts/coverage/check.mjs in the agent-policy-files CI job) is that map and the completion gate for this section.
- Identify missing pages, screens, forms, tables, dashboards, detail views, filters, actions and navigation. Every user role has the correct interface and permitted actions. No implemented backend functionality that is intended for use through the application remains inaccessible.
- Matrix statuses reuse the ACTIVITY §7 words exactly: NOT STARTED, IN PROGRESS, DONE (self-reported), VERIFIED, BLOCKED, DEFERRED — FUTURE PHASE, plus N/A. A row is complete only when the frontend experience exists, talks to the real backend through the named function, respects role permission, shows the database's real states, has its figures reconciled by a test, and names its evidence. A backend existing alone never completes a row.

## 12A.2 Data presentation and layout

- Present information in the most appropriate format: tables, cards, summaries, charts, timelines, ledgers, calendars or detailed records. Organize related information logically; avoid clutter, duplication and unnecessary navigation.
- Provide meaningful sorting, searching, filtering, pagination and drill-down where appropriate. Make important figures, statuses, relationships and exceptions immediately understandable. Doc 11 Gate 1 criterion 4 — the owner answers "how much are we owed, by whom, who's collecting" from the phone in under 10 seconds — is the standing test of this section.

## 12A.3 Analytics and calculations

- Use authoritative backend calculations for financial and business-critical values. Never independently recreate a calculation in the frontend in a way that could conflict with the database's answer (frontend-structure plan rule 4: no financial or stock figure is calculated in the browser).
- Every displayed metric carries a plain-language explanation: what it represents, how it is calculated, its source data, the applicable period, and any exclusions or limitations.
- Totals, subtotals, balances, commissions, inventory values and investor returns reconcile with their authoritative records. Charts appear only when they improve understanding or decision-making.

## 12A.4 Explainability and usability

- Every important field, metric, status, action and business decision has a clear label and an understandable explanation. Explain what an action does, what happens next, who is responsible, and whether approval is required.
- Helpful empty, loading, validation, error, confirmation and success states on every data surface (the five-state rule); the database's own refusal wording is shown; capped lists say they are capped. Never leave users guessing what a number means, why an action is unavailable or what to do next. Terminology matches the approved business specifications.

## 12A.5 Backend and data integrity

- Every frontend action connects to the correct backend operation and respects database constraints, RLS, permissions, approval rules and audit requirements.
- No mock data, placeholder functionality, misleading charts, hardcoded business figures or buttons that do nothing. Data refreshes correctly and users see the appropriate state after creating, updating, approving or completing an operation.

## 12A.6 Responsive design and quality assurance

- The application works across desktop, tablet and mobile. Check usability, accessibility, consistency and performance. Test complete end-to-end workflows for Owner, Manager, Rep and Salon roles. Verify that displayed figures and analytics reconcile with database records and authoritative calculations.

## 12A.7 The coverage matrix gate

Before the project is declared finished, the docs/coverage/ matrix shows, per requirement: the business requirement; the backend implementation; the database source; the frontend page or component; the user roles and permissions; the calculations or analytics involved; the test evidence; and the status. scripts/coverage/check.mjs enforces structural completeness in CI: every Phase 1 requirement row present exactly once, every DONE or VERIFIED row citing an existing test, and every route file under apps/web/app appearing in at least one row. Do not mark a feature complete merely because its backend exists: it is complete only when the required frontend experience works correctly, communicates the business logic clearly and passes its relevant tests.

The objective is a cohesive business application in which the backend provides reliable functionality and data, while the frontend makes that functionality understandable, visible and easy to operate with minimal ambiguity.
```

3. **Plan + evidence committed** — copy the CURRENT (third-revision) alignment plan from the main worktree (`docs/plans/will-be-implemented/2026-11-21-frontend-backend-alignment.md`, untracked) into the branch as `docs/plans/in-progress/2026-11-21-frontend-backend-alignment.md`, with two edits: (a) the Status header becomes "APPROVED BY MJ in chat 2026-11-21 (implement it); execution in progress — see docs/plans/in-progress/2026-11-21-execution-handoff.md"; (b) the §10 evidence-appendix links change from `../../../derived/fe-plan/...` and `../../../backend-inventory.md` to the committed copies under `docs/coverage/evidence/` (same file names; the review copy becomes `review-round-2026-11-21.md`). Copy the evidence files: `derived/fe-plan/frontend-inventory.md`, `derived/fe-plan/frontend-inventory-office-routes.md`, `derived/fe-plan/scope-governance.md`, `derived/fe-plan/verification-infra.md`, `derived/fe-plan/review-round-2026-11-21.md`, and root `backend-inventory.md` → `docs/coverage/evidence/` (unchanged content). Commit this handoff file too (it travels with the repo). Then `git mv docs/plans/will-be-implemented/2026-11-10-khsalon-storefront-plan-a-decisions.md docs/plans/implemented/` and `git mv docs/plans/will-be-implemented/2026-11-10-khsalon-storefront-plan-g-timeline-reminders.md docs/plans/in-progress/` (both state changes are already recorded in their README; the moves follow docs/plans/README.md's rule). After the PR merges, the lead deletes the untracked originals from the main worktree.
4. **TASK entry** — `docs/log/2026-11-21-fe-alignment-mandate.md`, TASK shape, Evidence = preflight + `node scripts/activity-log-check.mjs` result + commit SHA + what was not run; paste the security checklist with n/a marks (docs only).
5. **Board row** — append after the last Phase 1 row (P1-14): `| P1-40 | Frontend-alignment mandate adopted: master prompt section 12A, DECISION entry, plan and evidence committed | MJ 2026-11-21; master prompt 12A | IN PROGRESS (pull request NNN) | — |`. Mention the board change in the TASK entry.
6. **Checks:** `node scripts/agent-preflight.mjs`, `node scripts/activity-log-check.mjs` (the log/board format tripwire — obey its rules exactly), lint not needed for md-only but run it if install exists. PR title `docs: adopt the Complete Frontend mandate as master prompt section 12A (P1-40)`; body records MJ's decision, the PR-#132 supersession (recommend MJ close #132, whose content this PR carries in revised form, or merge #132 first and this PR rebases), traceability, risks (none — docs), rollback (revert commit).

### Phase B — coverage matrix + CI gate

**Branch:** `feat/coverage-matrix-gate` from `origin/main`. **Files:** `docs/coverage/matrix.json`, `docs/coverage/COVERAGE.md`, `scripts/coverage/check.mjs`, `scripts/coverage/render.mjs`, `.github/workflows/agent-compliance.yml`, log entry, board row. Population sources (committed by Phase A under `docs/coverage/evidence/`): `backend-inventory.md` (function→UI-caller→purpose, 309 functions, the no-caller list), `frontend-inventory.md` + `frontend-inventory-office-routes.md` (54 routes with data sources and status), `verification-infra.md` (63 DB test files + both Playwright suites), `scope-governance.md` (doc 03 Phase-1 ID groups and counts, master-prompt hooks), `docs/03-requirements.md` (the rows themselves), `docs/ACTIVITY.md` §12 (statuses), §15 (assumptions A-01…A-26).

1. **`docs/coverage/matrix.json`** — `{ "generated": "2026-11-21", "phase": 1, "manifest": { "row_count": N, "groups": { "SAL": 11, ... } }, "rows": [ ... ] }`. Row schema (every key required; use `[]`/`""` when empty): `requirement` (doc-03 id like `SAL-01`, or a decision id like `D-30` for the additions section), `title` (one line from doc 03), `backend` (array of function/migration names), `database` (array of table names), `frontend` (array of repo-relative file paths that MUST exist), `roles` (string), `calculations` (string: the authoritative function behind each displayed figure, or `none`), `evidence` (`{ "tests": [paths that MUST exist], "note": string }`), `status` (exactly one of: `NOT STARTED`, `IN PROGRESS`, `DONE (self-reported)`, `VERIFIED`, `BLOCKED`, `DEFERRED — FUTURE PHASE`, `N/A`), `notes` (slice ids, blocker ids, board wording). Cover all Phase-1 doc-03 rows (≈116: SAL 11, PIP 7, MAP 4, ORD 11, PAY 9, INV 8 (+INV-12 built ahead), VLT 6, SEC 16, CTL 15, FLD 3, RPT 2, MSG 1, ADM 3, AGT 5, DEM 2, CAP 3) plus NFR anchors (NFR-01, 02, 03, 07) and the additions section (D-30, D-31/D-38, D-32, D-34/D-41, D-35/D-36, D-37/D-39, D-40 + the 2026-11-20 investor-return amendment (A-25), D-45–D-48, D-49, D-51–D-61 storefront). Statuses come from the board: slices merged but "awaiting an independent check" → `DONE (self-reported)` with the slice id in notes; NOT STARTED rows stay `NOT STARTED`; blocked rows cite B-xx. NEVER invent a path or test name — everything cites the evidence reports; where a row cannot be grounded, leave tests empty and say so in notes.
2. **`scripts/coverage/check.mjs`** — dependency-free node ESM, biome-clean (2-space, double quotes). Validates, exiting 1 with a clear message on the first failure: (a) JSON parses; manifest.row_count equals rows.length and the group counts match; (b) every row has all keys; `status` is legal; `requirement` unique; (c) every `evidence.tests` path exists in the repo for rows with status `DONE (self-reported)` or `VERIFIED`; (d) every `frontend` path exists; (e) ROUTE COMPLETENESS: enumerate `apps/web/app/**/page.tsx` recursively and require every one to appear in at least one row's `frontend` array. Header comment states: "A tripwire, not a proof (same stance as scripts/activity-log-check.mjs); structural gate for master prompt §12A.7."
3. **`scripts/coverage/render.mjs`** — reads matrix.json, writes `docs/coverage/COVERAGE.md`: a counts-by-group-and-status summary table, then one table section per group (Requirement, Title, Frontend, Status, Notes). Run it and commit the output; the check does not verify freshness in v1 (note that in the script header).
4. **Workflow wiring** — append one step to the `agent-policy-files` job in `.github/workflows/agent-compliance.yml` after the backup-manifest step: `name: Validate the coverage matrix` / `run: node scripts/coverage/check.mjs`. (Deliberately inside an existing required job — adding a new JOB would require a branch-protection change, which is MJ-only, ACTIVITY §10.)
5. **Log entry** `docs/log/2026-11-21-coverage-matrix.md` + board row `| P1-41 | Coverage matrix and CI gate: docs/coverage, scripts/coverage/check.mjs in agent-policy-files | frontend-alignment plan section 4; master prompt 12A | IN PROGRESS (pull request NNN) | — |`. Run `node scripts/coverage/check.mjs`, `node scripts/coverage/render.mjs`, biome on the new files, preflight, activity:check; record results. PR title `feat(coverage): feature-to-interface coverage matrix and CI gate (P1-41)`.

### C0 — adopt the vault and sheet worktrees (guards first)

**Branches:** continue the existing `feat/p1-05-vault-foundation` (worktree `.worktrees/vault`) and `feat/office-sheet-import` (worktree `.worktrees/sheet`). Do NOT create new branches for them; do NOT touch the primary worktree.

1. **Guards before touching:** (a) run `git -C .worktrees/vault status --short` and the same for sheet — expected uncommitted sets are recorded in §1 of the plan (vault: layout/nav/rpc/3 test files modified + untracked `office/(shell)/vault/`, `20261121150000_vault_suppliers.sql`, `vault-suppliers.test.ts`; sheet: products page/package.json modified + untracked upload page, `lib/sheet-import.ts`+test, `vitest.config.ts`, `sheet-import-rpcs.test.ts`, e2e spec). (b) Activity check: `Get-ChildItem -Recurse <worktree> -File | Sort LastWriteTime -Desc | Select -First 3` — if ANY file was modified within the last 3 hours, another session may be live: STOP that half, report to the lead, do not commit. (c) Snapshot: on each branch, `git add -A && git commit -m "snapshot: uncommitted work found in the worktree, 2026-11-21 (preserved before continuation)"`, then `git push -u origin <branch>`. Preservation precedes everything (MJ's review: preserve, review and finish).
2. **Vault — security review, not blind implementation:** read `20261121150000_vault_suppliers.sql` fully, then `docs/07-supplier-confidentiality.md` (requirement at line 23: column encryption `*_enc` with pgsodium, key in Supabase Vault). Investigate: does the CI embedded Postgres (npm embedded-postgres 17) include pgsodium or pgcrypto? (`pgcrypto` is standard contrib and likely present; `pgsodium` almost certainly not.) Produce a short options brief (a) keep plain text + access control as a logged DEVIATION needing MJ approval (H-26: doc 07 is MJ's to change), (b) pgcrypto `pgp_sym_encrypt` with the key held server-side and never in the repo — noting the key-storage difference from doc 07's pgsodium design, (c) full pgsodium parity (hosted-only, blocks db:test). Put the brief in the vault branch's PR description (draft PR, no merge request) and log a BLOCKER for MJ with the options — do NOT pick one unilaterally. No new migration work this wave.
3. **Sheet — the one code fix this wave:** derive the receipt batch id from the FILE CONTENT so re-selecting the same file replays the same `client_id` (H-08). Today `onFile` in `apps/web/app/office/(shell)/products/upload/page.tsx` (~line 104) mints `crypto.randomUUID()` per selection; within a selection all ids derive from the batch (retry-safe), but across re-selections the database replay guard is defeated and only a UI notice protects. Fix: compute `sha-256` of the file bytes (WebCrypto) and format 32 hex chars as a UUID (set version/variant nibbles, e.g. uuid-v8 style) for the batch; keep everything else. Update `apps/web/lib/sheet-import.test.ts` (or the upload page's test) with the same-file-same-batch and changed-file-new-batch assertions. Also read the upload page header's own ruling citation ("MJ, 2026-11-20, ruling 5: the office uploads a CSV...") and `docs/decisions/2026-11-19-mj-answers.md` / the 2026-11-20 decision files: if MJ's ruling says CSV (it appears to), the reviewer's "add Excel support" is an over-read — record that in the PR body and do NOT add Excel this wave; note the Excel deferral is already logged in code as a deviation.
4. **Log entries** on each branch (TASK, snapshot evidence, guards' results); board row P1-43 on the sheet PR: `| P1-43 | Adopt the vault and sheet worktrees: snapshot preserved, batch id made content-derived, vault encryption options to MJ | worktrees vault, sheet; doc 07; B-xx new | IN PROGRESS (pull request NNN) | — |`. PRs: `feat(office-sheet-import): the receipt batch id derives from the file content (P1-43)` from the sheet branch; vault: draft PR `feat(p1-05-vault-foundation): foundation snapshot; encryption options for MJ` or no PR if the snapshot push suffices — the lead prefers a draft PR so the work is visible.

### C1 + C2 (wave 2 — claim only after a §1 slot frees)

- **C1** goods-in/restock UI (plan §5 row C1): new components under `apps/web/app/office/(shell)/stock/` calling `office_receive_stock` + `office_restock_suggestions` (backend merged 20261121010000 with 7 passing tests in `supabase/tests/stock-receipt-restock.test.ts`); follow the existing ConfirmAction/ListState patterns; estimate wording per assumption A-26; a real-stack e2e assertion in office.spec.ts or a new spec file; board row P1-44.
- **C2** team role control (plan §5 row C2): owner-only role select + ConfirmAction on `/office/team` calling `owner_set_role` (owner-only, AAL2; the database refuses everyone else); board row P1-45.

## 3. Coordination rules for the parallel cluster

- **File ownership** (touch nothing outside your slice): C0a → `apps/web/e2e-stack/roles-coverage.spec.ts`; Phase A → master prompt + docs/log (its two files) + docs/plans/** + docs/coverage/evidence/**; Phase B → docs/coverage/matrix.json + COVERAGE.md + scripts/coverage/** + agent-compliance.yml; C0 → the two worktrees only. The ONLY shared file is `docs/ACTIVITY.md`: each PR appends exactly its own one board row after the last Phase 1 row; on a rebase conflict keep both rows. Board IDs are pre-assigned in §1 — never take another slice's ID.
- **After C0a merges:** each open PR runs `git merge origin/main` (a merge commit; never rebase pushed history, never force-push) so the office-browser job runs the fixed spec, then CI re-runs.
- **Do not** run `pnpm db:test` (tens of minutes on this host) — nothing in this wave changes migrations. Do not run the e2e suites locally (no Docker).
- **Receipts to the lead:** PR URL, the check names green/red on the head, what was not run, any guard that fired (C0).
- If a rule of `docs/ACTIVITY.md` and this handoff ever disagree, ACTIVITY.md wins — stop and log a BLOCKER rather than guessing.

## 4. MJ decisions that block specific slices (from plan §8)

Vault encryption approach (C0-vault), Excel-vs-CSV confirmation (C0-sheet, likely already answered by ruling 5), B-48/B-49/B-50/B-51 wording (C6), B-61 e-mail service (C8), B-56/B-57 Shopify (C11 plan F), B-59 storefront wording (C11), H-21 map provider (C9), agents scheduling (P1-15). Nothing in waves 0–1 is blocked except vault implementation (options brief instead).

## 5. Command cheat sheet

```bash
git worktree add .worktrees/<slug> -b <branch> origin/main
cd .worktrees/<slug> && pnpm install      # once, for pnpm-based checks
node scripts/agent-preflight.mjs          # or: pnpm agent:preflight
node scripts/activity-log-check.mjs       # or: pnpm activity:check
pnpm lint                                 # biome ci over the worktree
pnpm -C apps/web typecheck                # when app code changed
pnpm exec biome check --write <files>     # from anywhere using the root install
git add <specific files> && git commit -m "..."
git push -u origin <branch>
gh pr create --base main --title "..." --body-file <file>
# after C0a merges, on each open PR branch:
git merge origin/main && git push
```

## 6. Provenance

Prepared by AutoClaw project 「K」 (zwork session k), 2026-11-21 23:00 PKT, at MJ's instruction. Diagnosis evidence: `gh run view 44930031088`, check-runs on `0dad9f7`, code reads recorded in §2. The alignment plan's §11–§12 carry the full review-round and disposition history.
