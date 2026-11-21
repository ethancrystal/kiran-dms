# Complete Frontend, Backend Alignment and Data Presentation — execution plan

**Status:** APPROVED BY MJ in chat on 2026-11-21 (implement it). Third revision, 2026-11-21 (PKT): review disposition (§12) and the C0a red-baseline slice added; execution in progress — live coordination: docs/plans/in-progress/2026-11-21-execution-handoff.md. The investigation began on branch `integration/single-repo-consolidation` (77b34f8); the baseline is now remote `main` at `0dad9f7` (PRs #118, #119, #129, #130 merged). Nothing is merged yet; Phase A (branch docs/fe-alignment-mandate) commits this plan, the evidence set, the execution handoff and the master-prompt amendment. This plan supplements `docs/ACTIVITY.md` and the master execution prompt; where they and this file disagree, those win.

## 1. What MJ asked

MJ's requirement (attachment, 2026-11-21): Kiran DMS must have a **complete, production-ready frontend that fully complements and exposes the backend** — not merely pages that display data, but an interface that makes every approved business workflow understandable, accessible, actionable and consistent with the database, business rules, permissions and calculations. Completion is gated by a **feature-to-interface coverage matrix** (requirement → backend → database → frontend page → roles → calculations → test evidence → status). The recommendation was to **add** this to the existing master execution prompt, not replace it. One governing distinction: *the frontend should explain the business, not just display the database.*

## 2. Where the project stands (evidence, read-only investigation of 2026-11-21)

| Fact | Evidence |
|---|---|
| Frontend: 54 pages (office 30, rep 18, salon 4, invite 1, public landing 1; storefront 0), 171 distinct `app.*` functions called, 28 public tables read under RLS; **no placeholders, TODOs, dead buttons, fake success messages or hardcoded business figures found**; every write goes through an `app.*` RPC (H-08 honoured) | [derived/fe-plan/frontend-inventory.md](../../coverage/evidence/frontend-inventory.md) |
| Backend: 309 unique `app.*` functions (201 RPC-exposed), 71 public tables (45 append-only), 6 control tables; `supplier_vault` and `vault_api` **empty** (P1-05 not started); `packages/shared` **does not exist**; `packages/import` built (dry-run only, not wired to the web app) | [backend-inventory.md](../../coverage/evidence/backend-inventory.md) |
| Granted business functions with **no UI caller**: `office_receive_stock` + `office_restock_suggestions` (built 2026-11-21), `owner_set_role`, `owner_set_vault_grant`, and the two anon visitor reads `storefront_catalogue` / `storefront_product` (public shop pages are P1-35, NOT STARTED); plus the service_role reminder pair with no production wiring (B-61) | backend-inventory.md §3 |
| Offline outbox built but **unwired**: no page calls `submit()`, `startSync()` never mounted — rep writes are online-only (P1-09 tasks 6–9) | frontend-inventory.md §6; ACTIVITY §12 P1-09 |
| 2026-11-20 MJ decisions not yet reflected in the UI: rep area narrows to check-in/out, route, notes, Order Notes (no bag, no rep delivery, no money handling — separate cleanup slice); investor recurring return is now calculated (A-25) | docs/log/2026-11-20-mj-rep-scope-stock-investors.md; ACTIVITY §15 A-25 |
| Verification: 63 DB test suites (RLS matrix, attacks, recomputed overviews/commission/investor returns/ageing/exposure); rep PWA e2e at 360×640 (mocked); real-stack e2e-stack suite (53 tests, `paisaOf()` figure reconciliation) — **CI-only, this Windows host has no Docker**; missing: responsive coverage (2 viewports only), accessibility (zero axe/WCAG anywhere), a role×page visibility matrix, systematic on-screen figure reconciliation | [derived/fe-plan/verification-infra.md](../../coverage/evidence/verification-infra.md) |
| Board: P1-18…P1-31 completion slices merged "awaiting an independent check". **PR #118 merged** (e7e028b, 2026-11-21 15:46Z), **#119 merged** (0dfb9fb), then #129/#130 — remote main at `0dad9f7`. **ci is RED on main**: the office browser job fails at `roles-coverage.spec.ts:264` — the discount-tiers journey expects at least one pending `control.approval_request` and finds zero (50 passed / 1 failed / 2 did not run); every main run since the #118 merge is red, last green `2d0f6a6` (2026-11-19). The secret-scan failure on the consolidation head is resolved on main (the .gitleaksignore fix held). **C0a repairs this before any other PR** — the required checks apply to docs PRs too, and ACTIVITY §2.6 forbids building on red | gh run view 44930031088; check-runs on 0dad9f7; gh run list (2026-11-21) |
| **Active worktrees with uncommitted implementation** (preserve and finish — do not redesign): `.worktrees/vault` @ feat/p1-05-vault-foundation — supplier directory screen `office/(shell)/vault/`, migration 20261121150000_vault_suppliers.sql, vault-suppliers db tests, nav/rpc/rls-matrix edits, all uncommitted; `.worktrees/sheet` @ feat/office-sheet-import — products upload page, `lib/sheet-import.ts` (+ unit test), e2e-stack spec, sheet-import-rpcs db tests, all uncommitted. Both branch from bac779e (pre-merge) and need a rebase onto current main. Other worktrees present: inv12, p134, offline (feat/p1-09-outbox-wiring), preserve-uncommitted, railway-deploy-record-pr | git worktree list; git -C status (2026-11-21) |
| **Vault encryption gap:** doc 07 requires column encryption for identity and cost fields (`*_enc`, pgsodium, key in Supabase Vault); the vault worktree migration stores name/contact/phone/note as plain `text` — access-gated (forced RLS, deny-by-default, grant + AAL2 reads, audit images redacted) but **not encrypted**. Restricted access is not encryption; this needs correction or an MJ-approved DEVIATION before that PR merges | docs/07-supplier-confidentiality.md:23; .worktrees/vault/supabase/migrations/20261121150000_vault_suppliers.sql |
| Existing plan assets to extend, not duplicate: `docs/plans/in-progress/2026-11-05-frontend-structure.md` (nine screen rules; foundation F1–F8; §9 per-screen definition template — the closest precursor of the coverage matrix); master prompt §3.2 requirement-to-implementation matrix, §12 Frontend acceptance, §17 Gate E; execution map deliverables B (traceability matrix) and C (frontend report) | [derived/fe-plan/scope-governance.md](../../coverage/evidence/scope-governance.md) |

**Bottom line:** the frontend is far more complete than the mandate assumes — the real work is (a) a handful of uncovered capabilities, (b) decided-but-unbuilt rep-surface changes, (c) the offline wiring, (d) the explain/presentation layer, (e) verification depth, and (f) the coverage matrix itself as the gate, and (g) the two in-flight worktree implementations (vault foundation, sheet import) that must be finished, not redesigned. Scope of "complete" for this program = **Phase 1 requirement rows** (≈116 of doc 03's 164 rows + NFR anchors), per H-22.

## 3. Phase A — Adopt the mandate (docs-only, one session)

1. **Record the decision.** Log a `DECISION` entry in `docs/log/` quoting MJ's instruction (the attachment) so the addition carries MJ's authority under ACTIVITY §1.
2. **Edit the master prompt** `docs/audit-2026-10-31/master-prompt-2026-11-01.md`: insert the attachment's section, adapted, as **`# 12A. COMPLETE FRONTEND, BACKEND ALIGNMENT AND DATA PRESENTATION`** between `# 12. FRONTEND ACCEPTANCE REQUIREMENTS` and `# 13. TESTING STRATEGY`. **Do not renumber §13–§19** — `docs/audit-2026-10-31/execution-map.md` cites those §-numbers throughout (scope-governance report §2). Adaptations while inserting:
   - Cross-reference what exists instead of inventing competing artifacts (§14 of the prompt itself warns against this): the §3.2 requirement-to-implementation matrix, §17 Gate E, ACTIVITY status words, and the frontend-structure plan's §9 per-screen template.
   - Point the matrix column "Calculations or analytics involved" at the authoritative source (the `app.*` function that computes each figure) and codify the attachment's rule "use authoritative backend calculations; never recreate them in the frontend" by citing the frontend plan's rule 4 (no browser arithmetic) as its enforcement.
   - Name the matrix's home: `docs/coverage/` (Phase B below) and its CI hook.
3. **Housekeeping in the same PR** (per docs/plans/README.md's git-mv rule): move `2026-11-10-khsalon-storefront-plan-a-decisions.md` to `implemented/` (PR 105 merged) and `plan-g-timeline-reminders.md` to `in-progress/` (built on a branch).
4. Branch `docs/frontend-alignment-mandate`, `pnpm agent:preflight`, `pnpm activity:check` + lint/typecheck green, one coherent commit, PR; merge on MJ's chat approval for that PR (ACTIVITY §10).

## 4. Phase B — Build the coverage matrix and its CI gate (two sessions)

**Artifact:** `docs/coverage/matrix.yaml` — one row per requirement, machine-readable, plus a generated human view `docs/coverage/COVERAGE.md`.

Columns (the attachment's §7 set, keyed to repo reality): `requirement` (doc 03 ID + one-line text) · `backend` (functions/migrations) · `database` (tables/views read) · `frontend` (route file(s)/component) · `roles` (who sees/acts, owner-only flags) · `calculations` (the authoritative RPC that computes each displayed figure) · `evidence` (test file + test name, or "none") · `status` · `notes` (blocker IDs, deviations).

**Status words:** reuse ACTIVITY §7 exactly — NOT STARTED / IN PROGRESS / DONE (self-reported) / VERIFIED / BLOCKED / DEFERRED — FUTURE PHASE (plus N/A). The attachment's complete/incomplete/blocked/n-a map onto these; no second vocabulary.

**Row-completion rule (what "complete" means):** a row is DONE/VERIFIED only when the frontend experience exists, talks to the real backend through the named function, respects role permission (RLS/stack test), shows the database's real states (five-state rule), has its figures reconciled by a test, and names its evidence. A backend existing alone never completes a row.

**Population sources (all already on disk):** doc 03 Phase 1 rows; doc 16 per-role sections; the execution map's four requirement tables (`docs/audit-2026-10-31/salons-map-routes.md`, `stock-orders-agents.md`, `money-controls-vault.md`, `security-nfr-webapp.md`); the frontend-structure plan §8 screen catalogue (corrected to current truth — its cells are stale); the four investigation reports of 2026-11-21 (commit them under `docs/coverage/evidence/` in the Phase B PR); ACTIVITY §12 board for status; ACTIVITY §15 assumptions (A-01…A-26) for `[default-unconfirmed]` figures.

**CI gate:** `scripts/coverage/check.mjs` validates: every Phase 1 requirement ID appears exactly once; every DONE/VERIFIED row cites an existing test file and test name; every route file under `apps/web/app` appears in at least one row; status words are legal. Run it in the existing `agent-policy-files` job (node is available there) — **not** as a new CI job, because adding a required check means changing branch protection, which is MJ-only (ACTIVITY §10). A PR that flips a row to DONE without evidence fails CI.

**First population pass output:** counts by domain; the INCOMPLETE list becomes the Phase C backlog; BLOCKED rows cite their B-xx blocker.

## 5. Phase C — Close the gaps (vertical slices, dependency order)

Each slice: one branch, one PR, full ACTIVITY §6 Definition of Done, its own board row or sub-row, its matrix rows updated in the same PR. Backend-led Phase 1 areas still unstarted (P1-05 vault, P1-08 control layer, P1-15 agents, P1-03 map) stay board tasks in the §12.1 order; this program delivers their frontend surfaces as each backend lands and marks the matrix rows accordingly.

| # | Slice | Scope | Refs / depends on |
|---|---|---|---|
| C0a | Repair the red office browser job on main | `roles-coverage.spec.ts:264` ("discount tiers, maker-checker, withdrawal, cancel and credit-hold release") reads `control.approval_request where status='pending'` and requires ≥1 row, but nothing in the seed (`scripts/e2e-stack-seed.mjs`) or the earlier journeys leaves a pending discount request — the spec file is new with the consolidation merge and this journey, like the role-isolation block PR #130 fixed, was written against an imagined state. Fix it in the same pattern PR #118 applied to the salon-proposal journey: the journey creates its own pending discount (an office order priced below list above the owner threshold opens one through `office_create_order`) instead of depending on leftover state; then all nine checks must be green on the PR head and on main after merge | ACTIVITY §2.6 (do not build on red); run 44930031088; gates every PR including Phase A |
| C0 | Adopt in-flight worktree work (vault + sheet) | **Vault:** review `20261121150000_vault_suppliers.sql` against doc 07's `*_enc`/pgsodium requirement — add column encryption or log a DEVIATION MJ approves; finish the supplier screen, grants UI and tests; PR. **Sheet:** derive the receipt batch id from the file content hash so re-selecting the same file replays the same `client_id` (today `onFile` mints a fresh randomUUID per selection — within a selection all ids derive from the batch, but across re-selections the database replay guard is defeated and only a UI notice protects); add Excel .xlsx support (MJ 2026-11-20 ruling: Excel or CSV; the slice is CSV-only with the deviation already noted in code) or MJ confirms CSV-only; PR | Worktrees `.worktrees/vault`, `.worktrees/sheet`; rebase from bac779e onto current main first; H-08; doc 07 | 
| C1 | Office goods-in + restock suggestions | Screens for `office_receive_stock` (warehouse receipt, single-use batch, replay reported) and `office_restock_suggestions` (weekly estimate, worded as an estimate, never stored) under /office/stock | Backend already merged 20261121010000 with 7 tests; assumption A-26 |
| C2 | Team page role control + vault grant toggle | Surface `owner_set_role` (owner-only, AAL2, with reason) on /office/team; `owner_set_vault_grant` minimal or deferred to P1-05 (vault empty) | owner-only per H-15 |
| C3 | Rep-area cleanup per MJ 2026-11-20 | Remove/retire bag, deliver and money surfaces from the rep area; rep keeps check-in/out, route, notes, Order Notes; redirect legacy routes; re-point matrix rows | docs/log/2026-11-20-mj-rep-scope-stock-investors.md; touches /app/stock, /app/orders/[id]/deliver, /app/handovers, money-section on rep salon page |
| C4 | Foundation F1+F2 | `packages/shared`: DB-generated types + validation schemas; typed RPC client over `lib/rpc.ts` with one error mapping (42501/22023/55000/23505) | frontend-structure plan §3 ("F8 first, then F1 and F2"); prerequisite for trustworthy alignment; P1-09 also needs it |
| C5 | Offline outbox wiring (P1-09 tasks 6–9) | Route rep mutations through `submit()`; mount `startSync`; rejection surfaced with the database's words; first browser-level outbox test (current 8 specs are Node-only) | C4 types; plan 2026-11-08-p1-09-offline-rep-app.md (its server-time DEVIATION needs MJ first) |
| C6 | Control layer screens (P1-08 frontend) | Daily owner digest, balance-confirmation list, offboarding screen, Controls sidebar group (A-21), approvals queue reads from `control.approval_request` via a read function | Backend P1-08 not started — backend slice first; wording blocked by B-48/B-49/B-50/B-51 answers |
| C7 | Deposits (CTL-04) + a payments list page | Office deposits out of office cash; dedicated payments list (reversals currently live only inside salon-payments/commission) | office_cash_position already assumes deposits ("handovers in − deposits out") |
| C8 | Owner dashboard + admin config completion (P1-10/P1-11) | Owner home digest, in-app notifications (MSG-03), company profile, rep profile (ADM-01/02, FLD-01); RPT-01 thin completion | P1-10 row: only the ageing screen exists today |
| C9 | Rep map (P1-03) | Pins by stage on territory/area views for office; rep map view | **H-21: needs MJ's approval of a map provider before any third-party** |
| C10 | Documents: salon receipt view, server-side PDF, statements | `salon_receipt_document` read + salon receipt page; server-side PDF renderer with logo (B-46 decided: server-side PDF with logo now); rep/salon printable statements (F6 remainder) | invoice/receipt snapshot functions exist |
| C11 | Storefront pages (P1-35) + tracking (P1-36) | Public catalogue/product pages calling `storefront_catalogue`/`storefront_product` (already granted to anon), SEO metadata, client-salon link into the portal, "Become a client salon" enquiry; tracking registry + office insights | plans D/E under docs/plans/will-be-implemented/; B-59 (distribution wording) PENDING — default: print nothing; Shopify plan F waits B-56/B-57 |
| C12 | Verification hardening (can run parallel from Phase B onward) | Axe accessibility pass per role×viewport; tablet + mobile-office and desktop-rep Playwright projects; one parametrized owner-only-visibility sweep; extend the `paisaOf()` reconciliation pattern to every money-bearing screen (ageing buckets, commission statement, credit exposure, installment splits, warehouse figures); finish the WSL Supabase stack so e2e-stack runs locally | verification-infra report §4/§6; unblocks local figure verification |

**Sequencing:** Wave 0 — **repair the red baseline (C0a)**: the office browser job is failing on main (§2) and ACTIVITY §2.6 forbids building on red; every PR, including Phase A's docs-only PR, needs the required office-browser check green, so C0a lands first, on its own branch from current main. Wave 1 — Phase A + Phase B start; **C0** (adopt and finish the vault and sheet worktrees) and C1/C2 (small, unblocked). Wave 2 — C3, C4. Wave 3 — C5, C7, C10. Wave 4 — C6, C8 (after their backend slices), C11, C12 throughout. C9 waits on H-21. Rough order of magnitude: **20–28 agent sessions** for Waves 1–4, excluding the backend-led board tasks (P1-08 backend, P1-15) that C6/C8 depend on. Worktrees are shared on this host: do PR work in `git worktree` checkouts, never by switching branches in the main worktree (a stray-commit incident on 2026-11-21 proved the risk).

## 6. The data-presentation standard (what "explain the business" means concretely)

Add to the frontend-structure plan's nine rules, enforced per screen via the §9 template and checked in Phase D:

1. **Provenance:** every financial/stock figure renders from a named `app.*` function column; the screen carries a one-line explanation — what it is, the period, and exclusions (e.g. exposure = owed on installment invoices + undelivered open installment orders; ageing buckets by Karachi days past due). No figure may be computed in the browser (rule 4 already).
2. **Action explanation:** every primary action states what it does, what happens next, who acts, and whether approval is required (e.g. "Submit delivery — holds the goods as pending until a manager approves; nothing is invoiced yet").
3. **Honest states:** the five-state rule (loading, empty, error, permission-denied, success) on every data surface, with the database's own refusal wording; capped lists say they are capped.
4. **Terminology:** labels match the docs' terms (stage names, statuses, money words); no synonyms per screen.
5. **Reconciliation:** every money-bearing screen has a stack test asserting printed figures equal hand-worked ledger values (`paisaOf()` pattern).

## 7. Phase D — Verification campaign and gate

1. Full local suite green at the final head: `pnpm agent:preflight`, `pnpm activity:check`, `pnpm lint`, `pnpm typecheck`, `pnpm db:test`, `pnpm -C apps/web test:e2e`; `e2e-stack` in CI (no Docker locally until C12's WSL work lands).
2. Matrix sweep: every Phase 1 row DONE/VERIFIED with evidence, or BLOCKED citing its B-xx, or DEFERRED with the dependency recorded. No row says complete because the backend exists.
3. Doc 11 Gate 1 criteria checked from the artifacts — including criterion 4 ("owner answers how much are we owed, by whom, who's collecting from the phone in < 10 s"), which is itself a data-presentation test and gets its own e2e timing assertion.
4. Final report per master prompt §18 + ACTIVITY handoff §11: summary, baseline, results per slice, CI, security, commits, remaining work, and exactly one of PHASE 1 VERIFIED COMPLETE / PARTIALLY COMPLETE / BLOCKED / NOT COMPLETE. **Gate sign-off (ACCEPTED) stays MJ's (§8); pilot criteria (20 working days, receipts, offline field test, restore drill) are MJ's human-only items.**

## 8. Decisions MJ must make (each blocks named slices)

| Decision | Blocks | Default meanwhile |
|---|---|---|
| B-48 payment-reversal threshold + short-cash carrying | C6 wording, matrix rows | As built |
| B-49 handover settlement label-vs-ledger; who withdraws a count | C6 | Label; owner or non-maker manager |
| B-50 manager adjustment threshold; owner-discount reason field | C6 | Doc 13 threshold; no reason field |
| B-51 what the manager sees about cap-refused collections | C6/C8 | As built |
| B-61 e-mail service for reminders | C8 (reminder runner) | Nothing sends; wording dummy |
| B-56/B-57 Shopify store questions | Storefront plan F | Nothing built against a live store |
| B-59 distribution wording on the public site | C11 copy | Nothing printed |
| B-47(b) office in-app recovery page | C8 | Documented dashboard steps |
| H-21 map/places provider approval | C9 | No map UI |
| Agents (P1-15) scheduling + B-31(g) representation | Matrix AGT rows stay NOT STARTED | Board order |
| Vault encryption implementation (doc 07 `*_enc`/pgsodium vs a logged DEVIATION) | C0 vault PR | doc 07 as written (encrypt) |
| Excel .xlsx support for the sheet import vs CSV-only deviation | C0 sheet PR | CSV-only first slice, deviation logged in code |
| Vault timing (P1-05) — matrix VLT rows + C2's grant toggle | Matrix VLT rows BLOCKED | Board §12.1 order |

## 9. Scope guards

Phase 1 only (H-22). No new roles, permissions, financial terms, thresholds or production actions (H-26, H-19). No new third party without MJ's approval (H-21). The matrix is an evidence artifact, not a second status authority — ACTIVITY §12 remains the only board. Nothing here reopens decided conflicts (Urdu vs D-42 English-only; investor calculation supersedes D-40's no-calculation; rep narrowing recorded 2026-11-20) — they are applied as decided and the stale doc lines are amended in the same PRs that touch them (H-25).

## 10. Evidence appendix

Investigation reports (2026-11-21, read-only, to be committed under `docs/coverage/evidence/` in the Phase B PR):
- [derived/fe-plan/frontend-inventory.md](../../coverage/evidence/frontend-inventory.md) — 54 pages, callers per function, gaps
- [derived/fe-plan/frontend-inventory-office-routes.md](../../coverage/evidence/frontend-inventory-office-routes.md) — reconciliation supplement: the 30 office routes tabulated
- [backend-inventory.md](../../coverage/evidence/backend-inventory.md) — 309 functions, tables, the 24 no-caller analysis
- [derived/fe-plan/scope-governance.md](../../coverage/evidence/scope-governance.md) — master prompt structure and 12A insertion point, doc 03/16 scope, plans inventory, conflicts C1–C6
- [derived/fe-plan/verification-infra.md](../../coverage/evidence/verification-infra.md) — 63 DB suites, both Playwright stacks, CI jobs, the five verification gaps
- [derived/fe-plan/review-round-2026-11-21.md](../../coverage/evidence/review-round-2026-11-21.md) — MJ's external review of both documents, preserved verbatim (identical copies attached at 17:29 and 17:44 UTC, 2026-11-21)

## 11. Delegation reconciliation (2026-11-21)

Four read-only researchers were dispatched in parallel; all four settled usable — none failed, stopped or returned empty. Scope reconciliation against each assignment:

| Child | Assigned scope | Outcome |
|---|---|---|
| Frontend inventory | Every route per surface, data sources, status; e2e files; role-gating | Covered for public, auth, rep (18), salon (4), gating, components and e2e. **Shortfall found in reconciliation:** the 30 office routes were summarized (totals, gating, partials, components) but not tabulated route-by-route. Closed by the supplement [frontend-inventory-office-routes.md](../../coverage/evidence/frontend-inventory-office-routes.md), grounded in each file's own heading and the backend caller mapping; Phase B's route-completeness CI check keeps it enforced. |
| Backend inventory | Schemas/tables; all `app.*`/`vault_api` functions with purpose and W/R; no-caller cross-check; packages status | Fully covered: 309 functions across 12 domains, 71 + 6 tables, the 24-name no-caller analysis, packages status. |
| Scope and governance | Master prompt section list and insertion point; execution map; doc 16 per role; doc 03 groups; docs/plans inventory | Fully covered; its unread areas (docs 06 §10, docs 07 §5, docs/requirements/ and contexts/, the 2026-11-20 decision log) are declared as unknowns §10 of its report and assigned to Phase B population work. |
| Verification infrastructure | Test suites, both Playwright stacks, scripts, CI jobs, reconciliation gaps | Fully covered, including the five verification gaps and the no-Docker constraint. |

No delegated scope was left silent: the one shortfall above is the only one found, it is closed by a grounded supplement, and every unknown the children declared is carried into Phase B's population sources (§4).

**Review round (2026-11-21, external verdict on this plan and the route supplement).** Accepted and applied: office auth wording narrowed (`/office/login` open; AAL2 everywhere except `/office/mfa`, which must accept AAL1 to complete enrollment; 28 protected routes at AAL2 — proxy.ts:40-43); salon list/detail attribution fixed (`update_salon`, `office_override_stage`, `office_salon_timeline` are on `[id]`; the list page reads `salon` + `salon_approval_decision` with OfficeAddSalon/DuplicatePhones); PR status refreshed and the merge step replaced by the baseline sweep; the two active worktrees adopted as slice C0; the vault encryption gap recorded against doc 07 line 23; the Excel-support gap recorded; the coverage-check wording corrected to "planned, not yet built"; the 171/177 count discrepancy documented as methodological (163 strict `rpc(` call sites / 171 call-site scan / 177 string matches including e2e and comments) and superseded per-row in the matrix. Evidence-based nuances kept: `stock_on_hand` is called on **both** stock pages (`stock/page.tsx:84` whole-stock view; `stock/levels/page.tsx:294` per-location held check), so the correction adds a caller rather than moving one; and remote main had already moved past the review's `0dfb9fb` to `0dad9f7`. The sheet-retry concern is real but narrower than stated — within one selection all ids derive from the batch (retry-safe, page lines 50-54); across re-selections a fresh `randomUUID` defeats the replay guard, leaving a UI notice as the only protection; C0 fixes it with a content-derived batch id.

A second copy of the same review arrived at 17:44 UTC; it is byte-identical to the 17:29 copy and already fully incorporated above. Its "two failed CI jobs on 77b34f8" item is resolved as fact: the secret scan is green on main; the office browser job is still red — that is C0a. The disposition table is §12.

## 12. Review disposition (MJ's external review, 2026-11-21)

The review's recommended dispositions, mapped to where this plan carries them (verbatim evidence copy: [derived/fe-plan/review-round-2026-11-21.md](../../coverage/evidence/review-round-2026-11-21.md)):

| Review item | Disposition | Where in this plan |
|---|---|---|
| 30-route Office inventory | Keep, with corrections | Supplement revised: auth wording, salon and stock attribution, direct reads and components named |
| Frontend/backend coverage matrix | Keep as the main completion gate | Phase B (§4) |
| Data-presentation standard | Keep | §6 |
| Responsive, accessibility and role testing | Keep and implement | C12, Phase D (§7) |
| PR #118 merge step | Remove; already merged | §2 baseline rows; Wave 0 replaced by the red-baseline repair |
| Office goods-in/restock UI | Keep as unfinished implementation | C1 |
| Vault worktree | Preserve, review and finish | C0 — encryption review against doc 07 `*_enc`/pgsodium before that PR merges |
| Sheet-import worktree | Preserve, finish and add Excel support | C0 — content-derived batch id; Excel per MJ's 2026-11-20 ruling or a logged deviation |
| Rep cleanup and offline wiring | Keep | C3, C5 |
| Coverage CI script | Build; do not claim it already exists | Phase B (§4); wording corrected in plan and supplement |
| CI failures on the consolidated head need resolution and verification against current main | Confirmed by inspection, elevated to a slice | **C0a**: office browser job red on main since the #118 merge; secret scan green |

The review's closing instruction — start from current main, preserve the `sheet` and `vault` implementations, correct the route matrix, execute the remaining work, and do not repeat the planning exercise or recreate existing features — is the operating rule for every slice in §5.
