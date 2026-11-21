# Verification infrastructure inventory — Kiran DMS

Date: 2026-11-21 (Asia/Karachi). Repo: workspace root, branch `integration/single-repo-consolidation`.
Purpose: ground MJ's requirement "Complete Frontend, Backend Alignment and Data Presentation" — specifically its verification section (responsive desktop/tablet/mobile, accessibility, per-role e2e for Owner/Manager/Rep/Salon, reconciliation of every displayed financial figure).
Method: read-only. All file reads and greps against the repo; no builds, no installs, no git mutations. Every claim below cites `path`. NOTE: the requested output path `.zwork/derived/fe-plan/verification-infra.md` is refused by the runtime ("the .zwork/ directory is reserved for runtime state and cannot be written"); this file is the same report written to `derived/fe-plan/` instead.

---

## 1. Database test suite — `supabase/tests/*.test.ts` (63 test files)

Runner: `pnpm db:test` = `vitest run --config supabase/tests/vitest.config.ts` (package.json). Fresh embedded Postgres (devDependency `embedded-postgres@17.9.0-beta.16`) or `KIRAN_TEST_DATABASE_URL` override; migrations applied; tests run in file-name order (CLAUDE.md / SPEC.md §6). `vitest.config.ts` excludes `.zwork`/`.worktrees` (docs/log/2026-11-21-autoclaw-consolidation.md, continuation 09:05).
Support files (not tests): `supabase/tests/helpers/`, `setup/` (fixtures, also reused by scripts/e2e-stack-seed.mjs), `shim/`, `log-check-harness.ts`, `tsconfig.json`.

One line per file (coverage from each file's own `describe(...)` titles, extracted 2026-11-21):

| File | Covers (one line) |
|---|---|
| append-only-sweep.test.ts | Sweep (doc 06 10.2): every business table refuses UPDATE/DELETE — append-only invariant. |
| audit-fixes.test.ts | Post-audit fixes: AUTH-01/05 salon-login & emailed-code sessions, maker≠checker adjustments, D-45 owner direct stock/discount, H4 credit exposure falls as salon pays, D-48 payment reversal, D-47 intraday cash cap, M7 suspended-rep cash, D-46 handover settlement, FLOW-09/10 rep month & home figures, REP-03/06/18/09/10, salon messaging (AUTH-09/10), timelines, AAL1 refusals. |
| b33-decisions.test.ts | B-33: territories/assignments (PIP-01), offboarding final (SEC-08), blank address keeps recorded value (SAL-01). |
| catalogue-availability.test.ts | INV-12: salon catalogue availability (warehouse shelf stock). |
| catalogue-prices.test.ts | Product description/picture path, list & per-salon prices (D-37), orders use salon price, no vault/cost/margin leakage, append-only price history, product-images bucket policies. |
| catalogue-seed.test.ts | P1-34 [Dummy] catalogue seed (7 cases). |
| commission.test.ts | Commission schema, rate stamped at approval (D-38), earned derived from invoices floored per invoice, rate setting, payments/reversals (FLD-06), who may call what. |
| create-salon-blanks.test.ts | create_salon treats whitespace-only text as blank. |
| crm-attacks.test.ts | Attack battery: direct writes refused for all roles, territory scoping/masking/list caps, function gates, malformed lines/price tampering/credit gate/replay, deliveries & invoices, stock attacks, partial-edit regression. |
| deliveries.test.ts | Delivering from bag/warehouse, cross-effects, reads & history (ORD-04). |
| delivery-approval.test.ts | D-32 submission→approval: pending goods, invoice stamps, office approval writes the official record once, rejection & pending-goods settlement, rep direct delivery closed. |
| dependency-audit.test.ts | Tests scripts/dependency-audit.mjs gating logic (doc 06 10.8). |
| device-guard.test.ts | device_guard (migration 0007): approved-device requirement. |
| foundation.test.ts | Audit hash chain (SEC-05/12), no hard deletes, owner-only governance + AAL2, device binding, maker≠checker, gapless numbering per FY, config defaults, device hardening/upgrade path. |
| function-gates.test.ts | Every client-callable function passes its role/AAL gate; guards report correctly; TOTP enforced for office. |
| handovers.test.ts | PAY-05/CTL-03 handover counting + rep acknowledge, replays, who may, what each side reads. |
| inventory.test.ts | INV-01…06: catalogue/prices, approved adjustments, two-party bag issue (CTL-05), counts, lost demand, reorder points, schema stock integrity. |
| investor-returns.test.ts | Promised return accrual (amount × % × whole periods), payouts capped at accrued+decisions−paid, term validation/replay, closing/reversal respect accrued, statement carries accrued as of row date, AAL2-only + leakage. |
| investors.test.ts | CAP-01/02 investor & money records, statement running balances in date order, refusals, replay, reversals, closing, AAL2-only, append-only, audit, concurrency. |
| invitations.test.ts | Invite rep/salon, pre-accept view, redemption, list/revoke, suspend/reactivate (D-39), salon_me isolation, nothing-redeemed sees nothing. |
| invoice-composer-signature.test.ts | Draft changes nothing real, issued invoice is a complete immutable snapshot, reprint unchanged, salon reads own invoices only. |
| invoice-document.test.ts | ORD-05 invoice document, who may read, no vault data in document. |
| issue-sku-names.test.ts | app.my_issue_skus (REP-14). |
| launch-acceptance.test.ts | PR 117 acceptance guards: acceptance index, guard itself (planted references), blocked/defective criteria pinned, runbook matches index. |
| log-check-rulings.test.ts | activity-log-check rulings: B-21/B-23/B-24, board VERIFIED moves, history pass, Status cells (L-0116), GitHub-rendered rows, verdict freshness, merges/encodings, owner terms per commit (clones repo per case — slow). |
| office-approvals.test.ts | app.office_pending_approvals, discount & adjustment approvals, integrity. |
| office-cash.test.ts | Office records cash collected from a salon (PAY-02, L-0362). |
| office-order-access.test.ts | Assigned rep delivers/reads office order (D-30), my_territory_orders, office_orders. |
| office-orders.test.ts | Office creates orders (D-30). |
| order-cards.test.ts | Order cards append-only, shape, channel/creator/assigned rep, rep saves card (ORD-14), office converts/dismisses. |
| order-steps-reminders.test.ts | Order step registry/steps, approval reminders. |
| orders.test.ts | Credit profile (SAL-04), rep order path closed (D-30), taking orders (ORD-01/10), credit check (ORD-02), discounts (CTL-07), cancel (ORD-03), orders cannot be rewritten. |
| overviews.test.ts | Karachi calendar months, who may read, office home placed/waiting/delivered counts, investors "This month" typed amounts only (D-40), rep performance/commission own figures only. |
| payments.test.ts | Installments fixed at invoice (PAY-01/A-11), uneven totals, recording (PAY-02/11, CTL-01), CTL-02 flags, append-only/audit, receipts, replay/server time/concurrency, invoice reads stored installments. |
| receivables-ageing.test.ts | PAY-07: ageing buckets by days past due (Karachi date), grouped by territory and rep, who may read. |
| rep-blind-stock-issues.test.ts | app.my_pending_issues (REP-05, CTL-05). |
| rep-detail-documents.test.ts | Who may read; office_rep_detail, office_invoices, office_receipts; documents the new pages read. |
| rep-readonly-timelines.test.ts | R3/D-35: rep reads salons and cannot edit; office can. |
| requests-portal.test.ts | Portal tables append-only, salon sends/edits/cancels own request (ORD-11), office queue + one-click convert (ORD-12/13), rep and salon views. |
| reverify-attacks.test.ts | Function surface after migration 0004, device gate on write/read paths, pre-0004 device upgrade path. |
| reverify-slices-1-3.test.ts | Slices 1–3 re-verified: office function refusals, two office sessions at once, role boundaries of replaced functions, offboarding, blank address. |
| reverify2-attacks.test.ts | 0005 device-id retirement, device gate + audit under unapproved phone, §7 sweep. |
| reverify3-attacks.test.ts | §7 sweep (independent), device lifecycle, backdated client timestamps, table-owner question, client device-id rotation. |
| reverify4-attacks.test.ts | Rep app client after L-0045; activity-log-check after L-0046. |
| reverify5-attacks.test.ts | Rep app client after L-0058; activity-log-check after L-0059. |
| reverify6-attacks.test.ts | activity-log-check P0-09 after L-0064. |
| reverify7-attacks.test.ts | activity-log-check P0-09 after L-0070. |
| reverify8-attacks.test.ts | activity-log-check P0-09 after L-0074. |
| reverify9-attacks.test.ts | activity-log-check P0-09 after L-0082. |
| reverify10-attacks.test.ts | P0-06/P1-01 guards; activity-log-check board rule 4b + history pass. |
| reverify11-attacks.test.ts | P0-06 harness; activity-log-check P0-09. |
| rls-matrix.test.ts | Role × table RLS matrix. |
| routes.test.ts | Opening last purchase (A-09), due-list (PIP-05/06), routes (PIP-03), history cannot be rewritten. |
| salon-approval.test.ts | Office decides a pending salon, queue, unapproved salon gets no order, direct assignment limits rep (R4), later assignment. |
| salon-self-signup.test.ts | Salon applies, applicant reach, office lists/decides, table keeps promises. |
| salons.test.ts | Territories, rep scoping, masked phone + one-at-a-time logged reveal, append-only notes, stages via stage_event, territory change/lost demand. |
| schema-hygiene.test.ts | Schema hygiene (search_path/defaults/etc.). |
| service-role-scan.test.ts | Tests scripts/service-role-scan.mjs (H-18). |
| stock-receipt-restock.test.ts | Office stock receipt (INV-03) incl. replay single-use + audit chain verify; restock estimate (INV-07) with worked arithmetic (S3: outward 14/28d, open order 3, reorder point 4, on hand 6 → suggest 8). |
| storefront-catalogue.test.ts | Visitor reads default price only, office writes, audit, storefront-images bucket. |
| verifier-attacks.test.ts | §7.5 approvals tampering, §7.6 replay, device binding, vault isolation, append-only as every app role, internal functions not callable, spoofing/suspended users, audit chain after attacks. |
| verify-slices-1-3.test.ts | Slice 1 function refusals, devices (nobody approves own), slice 3 territory scoping of every salon read/write, rep slices, edits keep history + audit chain, ending assignment takes salon away on every path. |
| visits.test.ts | No field work without open day (PIP-09), visits (PIP-02), check-out, history immutability. |

Evidence: `describe()` extraction over all 63 files (2026-11-21). Confidence: high for what each file aims at (titles are the authors' own words); test bodies were not read exhaustively.

## 2. Browser suites and scripts

### apps/web/e2e — rep PWA suite (`apps/web/playwright.config.ts`)
- Single project `low-end-android`: chromium, viewport 360×640, isMobile, hasTouch, Android SM-A105F UA ("the phone doc 01 assumes").
- `fullyParallel: true`; webServer = `pnpm build && pnpm start` on port 3100 with **placeholder** Supabase URL/anon key — no real backend; specs needing auth intercept requests.
- Services needed: only the built Next app. CI job `e2e` runs `pnpm -C apps/web test:e2e`.
- Specs (14): outbox-* ×8 are P1-09 offline-queue checks that "run in Node with no page" (access, classify, crypto, drain, gate, history, queue, signout); list-cap-note and office-gaps also Node-only helpers; time.spec Node-only Karachi-time formatter; rep-login/salon-login/salon-signup render pages with intercepted auth (rep-login also asserts no sideways scroll at 360 px and a role=alert message).
- Confidence: high — read from the config and each spec's header comments.

### apps/web/e2e-stack — office suite on a REAL stack (`apps/web/playwright.stack.config.ts`)
- Throws unless `NEXT_PUBLIC_SUPABASE_URL` is 127.0.0.1/localhost; header comment: "CI only (`e2e-stack` job): this repository's Windows host has no Docker."
- Single project `office-desktop`: chromium 1280×800. `workers: 1`, `fullyParallel: false` → files run in name order and share the stack.
- Services needed: real local Supabase stack — Postgres 54322 (migrations applied), GoTrue auth (password + TOTP for office; 6-digit email OTP via Mailpit 54324 for rep/salon), PostgREST via the Kong gateway, storage (product-picture journey), Mailpit. Heavy services excluded (`supabase start -x realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`); CI reserves ports 54320–54329. Seeded by scripts/e2e-stack-seed.mjs → apps/web/e2e-stack/.seed.json. Only public URL + anon key leave the stack (no service-role key).
- Specs (5, 53 tests): office.spec.ts (32 — owner/manager TOTP auth, rep lifecycle, ageing read, handover, delivery approval, commission, invitations, catalogue/pricing, portal request, investor "Rs 7,000 owed survives a reload", P1-25 end-to-end, product groups, storefront, shared phone); overviews.spec.ts (4 — home counts, rep performance, investors month, read refusals); p130-screens.spec.ts (9 — credit plan/limit screens, contacts, open rep day, bag, opening stock, handover disputes, payment reversal, cash cap, suspended-rep cash); rep-detail-documents.spec.ts (4 — sidebar keyboard + tablet width, rep detail, invoice/receipt documents English-only incl. Urdu-script check, read refusals); roles-coverage.spec.ts (4 — holistic journeys: salon self-signup/office decisions, discount tiers/maker-checker, invoice composer/warehouse delivery, rep field ops/phone reveal/salon portal edits).
- Confidence: high.

### scripts/ helpers (purpose of each)
- scripts/e2e-stack-seed.mjs — seeds the LOCAL stack only (refuses non-127.0.0.1/localhost): synthetic auth.users rows written directly (no service-role key), then app.bootstrap_owner / owner_create_user / business fixtures; writes .seed.json (sign-in accounts, SKU, warehouse, salons incl. `[Test] Crimson Salon` pilot, MJ mission 2026-11-21).
- scripts/e2e-stack-run.mjs — one-command runner (`pnpm test:e2e:stack`): resolves supabase CLI + Docker on host or via WSL, starts the trimmed stack, reads public URL/anon key from `supabase status`, seeds, runs playwright.stack.config.ts.
- scripts/wsl-install-supabase.sh — installs Supabase CLI + Docker inside WSL for this Windows host.
- scripts/apply-kiran-fresh.sh — applies every migration taken from `main` (git archive) via `supabase db push --include-all` to the new Kiran Supabase project (ref jlanskjgpuyycarwjafn; refuses any other URL); `--dry-run` writes nothing; H-19 needs MJ approval.
- scripts/apply-kiran-migrations.mjs — applies migrations not yet recorded on the Kiran hosted project, one transaction each; MJ runs it with his own connection string.
- scripts/activity-log-check.mjs — ACTIVITY.md Appendix C tripwire over docs/ACTIVITY.md + docs/log/: append-only log, canonical headers, Evidence + security checklist on VERIFIED, board Status-cell rules, secret/supplier-term/owner-term scan over every commit in range; self-described "a tripwire, not a proof".
- scripts/agent-preflight.mjs — read-only preflight of governance files/references and branch/worktree state (CI `--ci` mode; own failure-case tests).
- scripts/service-role-scan.mjs — H-18: service-role key NAMES in apps/packages source, key VALUES in the built bundle (`--bundle apps/web/.next/static`); fails closed on unreadable paths.
- scripts/dependency-audit.mjs — parses `pnpm audit --json --prod`; fails on high/critical advisories without an unexpired reasoned exception.
- scripts/staging-smoke.mjs — read-only check of a hosted project's Data API "Exposed schemas" setting (F-2/B-18).
- scripts/dummy-catalogue-seed.mjs + scripts/lib/dummy-catalogue.mjs — P1-34 [Dummy] catalogue into a LOCAL database only.
- scripts/backup/manifest.mjs + manifest.test.mjs — P1-12 Task 6: backup manifest (migrations, per-table row counts, relforcerowsecurity flags, auth users, audit-chain head) built in ONE transaction; pure compareManifests unit-tested (`pnpm backup:test`, 9 pass); CI agent-compliance runs node --test scripts/backup/manifest.test.mjs.
- scripts/fixtures/, scripts/lib/ — shared support.

## 3. CI jobs / check names

.github/workflows/ci.yml (`on: pull_request` + `push: main`) — 8 jobs:
1. `activity-log-check` — "activity-log-check (ACTIVITY.md Appendix C)"
2. `db-tests` — "migrations + RLS matrix (local Supabase stack)" (Supabase CLI 2.113.0, port reservation, `supabase start` db+auth only, `pnpm db:test`)
3. `typecheck` — "typecheck + service-role scan" (typecheck, workspace package tests, web production build, service-role scan of .next/static)
4. `lint` — "lint + format (Biome)"
5. `dependency-audit` — "dependency advisories (doc 06 10.8, H-18)"
6. `secret-scan` — "secret scan (doc 06 10.8)" (pinned gitleaks 8.30.1 + canary that must fail)
7. `e2e` — "rep PWA browser tests (Playwright)"
8. `e2e-stack` — "office browser tests (Playwright, local Supabase stack)"

.github/workflows/agent-compliance.yml — 1 job: `agent-policy-files` (agent-preflight --ci, preflight failure-case tests, backup manifest tests).

Note (confidence: medium, flagged): CLAUDE.md still says "six CI jobs" + agent-compliance adds the seventh required check; ci.yml now carries 8 jobs and docs/log/2026-11-21-autoclaw-consolidation.md speaks of "nine jobs" and "the seven required checks". The actual required-checks set lives in GitHub branch protection, which is not in the repo — **unknown from here which of the 9 are required**.

## 4. Reconciling displayed figures against the database

### What exists
DB-layer recomputation (vitest, high confidence — verified describe titles):
- overviews.test.ts: recomputes office home counts (placed / waiting to be delivered / delivered), investors "This month", rep performance & commission — the same functions the overview pages read.
- audit-fixes.test.ts FLOW-09/FLOW-10 "the month and home figures".
- commission.test.ts: earned derived from invoices, floored per invoice.
- investor-returns.test.ts: accrual arithmetic (amount × % × whole periods), payout cap = accrued + decisions − paid, statement accrued as-of each row's date.
- investors.test.ts: statement running balances derived in date order.
- receivables-ageing.test.ts: PAY-07 buckets by days past due (Karachi), grouped by territory/rep.
- payments.test.ts: installments fixed at issue; invoice reads stored installments.
- audit-fixes H4 + orders.test.ts ORD-02: credit exposure (owed on installment invoices + undelivered value of open installment orders; exposure + order ≤ limit).
- inventory.test.ts / stock-receipt-restock.test.ts: stock counts, reorder points, restock estimate arithmetic with a worked example.

UI-layer figure checks (e2e-stack, real stack, high confidence):
- office.spec.ts defines `paisaOf()` — parses printed "Rs 1,234.5" back to paisa and compares against hand-worked ledgers (P1-19 salon price/discount order; P1-20 investor journey: Rs 100,000 in / Rs 12,000 decided / Rs 5,000 paid → **Rs 7,000 owed survives a reload**); testid figure assertions: `balance`, `my-cash`, `office-cash`, `expected` at Rs 0; "a manager opens Receivables and reads the real ageing for each grouping (PAY-07)"; commission journey asserts an approved delivery earns at the set rate and the rep reads it.
- p130-screens.spec.ts: `credit-limit` Rs 25,000 / Rs 30,000, bag value limit Rs 40,000 notice, cash cap "you hold Rs 50,000.00", handover settlements Rs 900 / Rs 1,000, reversal notice "The salon owes Rs 1,000 again".
- overviews.spec.ts: `investor-accrued` Rs 0; home counts move by one when an order is placed/delivered.
- rep-detail-documents.spec.ts: invoice/receipt documents checked against database values, English-only (incl. an Urdu-script detector).

### What is missing for the requirement's verification section
1. Responsive (desktop/tablet/mobile) — only two fixed viewports exist in the whole suite: rep 360×640 (`low-end-android`), office 1280×800 (`office-desktop`). No tablet project, no desktop project for the rep PWA, no mobile project for office; one incidental tablet-width assertion (sidebar "usable at tablet width", rep-detail-documents.spec.ts). No setViewportSize sweeps, no visual-regression tests. → GAP.
2. Accessibility — zero. No @axe-core/playwright-axe/toHaveNoViolations/WCAG reference anywhere (repo-wide grep incl. apps/web, 2026-11-21). Only incidental signals: role="alert" matching in rep-login.spec.ts and the sidebar's keyboard-collapsibility phrase. No keyboard-traversal, ARIA, contrast, or screen-reader coverage. → GAP.
3. Per-role e2e (Owner/Manager/Rep/Salon) — partial. roles-coverage.spec.ts + office.spec.ts cover real journeys for all four roles, but there is no role × page visibility matrix; owner-only vs manager-only UI hiding is asserted only point-wise ("manager sees the team but no owner controls", product groups, investor isolation); salon-portal journeys are few (salon login/signup e2e are intercepted mocks; real-stack salon coverage is the request→convert journey and "salon portal edits"); the rep PWA has no real-backend browser journey (its suite is mocked + Node-only). → GAP.
4. Reconciliation of every displayed financial figure — no coverage matrix exists. Screen-level figure assertions are a few dozen testids concentrated in office.spec/p130-screens/overviews; the DB-layer recomputations (overviews, commission, investor returns, ageing, exposure) are proven against DB functions, not against what each page renders. Not (visibly) asserted on screens: ageing numbers per bucket (the office.spec test reads groupings; whether it asserts numeric equality per bucket was not verified — body not read), commission earned per rep screen vs recompute, invoice/installment split screens, warehouse valuation, investor statement totals beyond the one P1-20 figure, the exposure figure rendered by apps/web/components/salon-credit.tsx (exposure_paisa at :22/:128; no matching e2e assertion found — the grep for it was cancelled twice, marked unknown). → GAP.
5. Environment constraint — this Windows host has no Docker, so e2e-stack runs only in CI. Evidence: playwright.stack.config.ts header comment; scripts/e2e-stack-run.mjs (WSL fallback exists but was never completed — "the WSL stack attempt was interrupted before it came up", docs/log/2026-11-21-autoclaw-consolidation.md, "Not run here" list); the same log's repeated "Not run here: the office browser stack". Office-side UI verification therefore has no local channel until the WSL stack works. → CONSTRAINT/GAP.

Secondary gaps (outside the four listed requirement bullets): the P1-09 offline/sync UI has no browser-level test (all outbox specs are Node-only, no page, no DB); no browser test asserts the salon `/salon` account figures beyond the journeys above (unknown, not exhaustively scanned); log-check-rulings takes tens of minutes per case (repo-clone harness), which slows full `db:test` locally (log 2026-11-21).

## 5. Unknowns / unverified
- Exact GitHub required-checks set (branch protection not in repo).
- Whether office.spec.ts's ageing test asserts per-bucket numeric equality (test body not read).
- Whether any e2e asserts the credit-exposure figure on screen (grep cancelled twice).
- Full inventory of every displayed figure across every page (that enumeration is the requirement's own coverage-matrix work, not done here).

## 6. Suggested next steps
1. Build the requirement's feature→interface coverage matrix page by page; derive the missing figure-assertion list from it (each row: requirement → backend fn → page → testid → test).
2. Add a Playwright axe pass (per role × viewport) and tablet/desktop projects to both configs.
3. Finish the WSL Supabase stack (wsl-install-supabase.sh path) so e2e-stack is runnable locally, unblocking figure reconciliation before every push.
4. Add per-role negative-visibility sweeps (owner-only controls hidden for manager; office pages invisible to rep/salon) as one parametrized spec.
