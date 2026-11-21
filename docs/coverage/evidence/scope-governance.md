# Scope & governance extraction — grounding for the "Complete Frontend, Backend Alignment and Data Presentation" plan

> Path note: the requested location `.zwork/derived/fe-plan/scope-governance.md` is reserved for runtime state and the platform denied writes there; this report is written instead to `derived/fe-plan/scope-governance.md` (closest writable equivalent). Nothing else in the repository was modified.

Written 2026-11-21 (Asia/Karachi). Branch `integration/single-repo-consolidation`, HEAD `77b34f8` (2026-11-21), verified read-only via `git branch --show-current` / `git log -1`. Read-only investigation: the only file written is this report. No build, install, db or state-changing command was run.

**Sources read in full:** `docs/audit-2026-10-31/master-prompt-2026-11-01.md`, `docs/audit-2026-10-31/execution-map.md`, `docs/16-project-completion-goal.md`, `docs/03-requirements.md`, `docs/11-roadmap.md`, `docs/plans/README.md`, `docs/plans/in-progress/2026-11-05-frontend-structure.md`. Read partially: `docs/ACTIVITY.md` (§14 blockers spot rows, §15 assumptions register, appendices), every other plan file's header. Not read: `docs/06-security-plan.md` (§10 acceptance list), `docs/07-*` (§5 vault tests), `docs/requirements/` and `docs/contexts/` module documents — marked as unknowns below.

Evidence tiers used: **[E1]** first-hand repo text (quoted or cited path+anchor); **[E2]** derived summary of E1 text; **[E3]** observation/anomaly, not resolved. Every heading quoted below is verbatim from the file.

---

## 1. Master execution prompt (2026-11-01) — verbatim section list

File: `docs/audit-2026-10-31/master-prompt-2026-11-01.md`. [E1]

Top matter: `# KIRAN DMS — MASTER ENGINEERING EXECUTION PROMPT` / `## Repository Forensics, Phase 1 Completion, Full-Stack Implementation, Security, Testing, and Verified Delivery`. (The file also opens with a governance note: "Verbatim copy of the master engineering prompt MJ supplied on 2026-11-01 (logged L-0205)... `execution-map.md` in this folder was built from an earlier version whose section numbers differ... Where the two disagree, this revision governs the order of work and `docs/ACTIVITY.md` governs status.")

Top-level sections (#), in order:

1. `# 1. YOUR MISSION`
2. `# 2. FUNDAMENTAL ENGINEERING PRINCIPLES`
3. `# 3. REPOSITORY DISCOVERY — ESTABLISH THE SOURCE OF TRUTH`
4. `# 4. SAFE EXECUTION AND CHANGE CONTROL`
5. `# 5. PRIORITY 0 — COMPLETE THE update_salon FIX`
6. `# 6. PRIORITY 1 — VERIFY STAGING MIGRATIONS AND B-18`
7. `# 7. PRIORITY 2 — SAVE THE PHASE 1 EXECUTION MAP TO DISK`
8. `# 8. PRIORITY 3 — IMPLEMENT SLICE 1: OFFICE LAYOUT, DEVICES, USERS, TERRITORIES`
9. `# 9. PRIORITY 4 — REAL LOCAL SUPABASE + PLAYWRIGHT CI JOB`
10. `# 10. APPLICATION SECURITY REQUIREMENTS`
11. `# 11. DATABASE AND BUSINESS DATA INTEGRITY`
12. `# 12. FRONTEND ACCEPTANCE REQUIREMENTS`
13. `# 13. TESTING STRATEGY`
14. `# 14. REQUIRED IMPLEMENTATION AND DOCUMENTATION EVIDENCE`
15. `# 15. REQUIRED GIT AND CHANGE MANAGEMENT`
16. `# 16. EXECUTION ORDER — FOLLOW THIS SEQUENCE`
17. `# 17. DEFINITION OF DONE — NON-NEGOTIABLE ACCEPTANCE GATES`
18. `# 18. REQUIRED FINAL ENGINEERING REPORT`
19. `# 19. FINAL DIRECTIVE`

Sub-headings (##), verbatim, under each:

- §2: `2.1 Working functionality takes priority over visual polish` · `2.2 Actual implementation matters more than file existence` · `2.3 Work in complete full-stack vertical slices` · `2.4 Implement in dependency order` · `2.5 Maintain evidence throughout implementation` · `2.6 Do not expand the approved scope unnecessarily`
- §3: `3.1 Establish requirement authority` · `3.2 Create a requirement-to-implementation matrix` · `3.3 Establish the actual Phase 1 scope`
- §4: `4.1 Protect existing work` · `4.2 Destructive operation restrictions` · `4.3 Migration safety`
- §5: `5.1 Investigate the existing implementation` · `5.2 Verify partial-update semantics` · `5.3 Verify security` · `5.4 Test the actual behavior` · `5.5 Correct the activity log` · `5.6 Verify and commit this fix`
- §6: `6.1 Establish the correct staging environment` · `6.2 Verify migration state` · `6.3 Investigate B-18` · `6.4 Document the result`
- §8: `8.1 Office layout` · `8.2 Device management` · `8.3 User management` · `8.4 Territory management` · `8.5 Build each capability as a complete vertical slice`
- §9: `9.1 Do not substitute mocks for the real backend` · `9.2 Establish local Supabase infrastructure` · `9.3 Database testing` · `9.4 Playwright testing` · `9.5 CI quality requirements`
- §10: `10.1 Authentication` · `10.2 Authorization` · `10.3 Supabase Row Level Security` · `10.4 Backend validation` · `10.5 Data isolation` · `10.6 Audit trail` · `10.7 Negative-path and abuse testing` · `10.8 Reliability and concurrency`
- §13: `13.1 Unit tests` · `13.2 Integration tests` · `13.3 Database tests` · `13.4 Security tests` · `13.5 End-to-end tests` · `13.6 Regression tests` · `13.7 Test evidence requirements`
- §16: `TASK 1 — Establish the actual repository state` · `TASK 2 — Complete update_salon` · `TASK 3 — Verify staging migrations and B-18` · `TASK 4 — Save the execution map` · `TASK 5 — Implement Slice 1` · `TASK 6 — Implement real-backend CI` · `TASK 7 — Run final verification` · `TASK 8 — Document and commit Slice 1` · `TASK 9 — Reassess Phase 1`
- §17: `Gate A — Requirements` · `Gate B — Database` · `Gate C — Backend` · `Gate D — Security` · `Gate E — Frontend` · `Gate F — Auditability` · `Gate G — Testing` · `Gate H — CI` · `Gate I — Documentation and delivery`
- §18 report parts: `A. Executive summary` · `B. Repository baseline` · `C. update_salon result` · `D. Staging and B-18 verification` · `E. Execution map` · `F. Slice 1 implementation` · `G. CI and Playwright` · `H. Security verification` · `I. Git commits` · `J. Remaining work` · `K. Final status`

## 2. Recommended insertion point for the new section "Complete Frontend, Backend Alignment and Data Presentation"

**Recommended exact place: immediately after `# 12. FRONTEND ACCEPTANCE REQUIREMENTS` and before `# 13. TESTING STRATEGY`.** [E2, from E1 structure]

Quoted anchors:
- Heading before the insertion point: `# 12. FRONTEND ACCEPTANCE REQUIREMENTS`
- Heading after the insertion point: `# 13. TESTING STRATEGY`

Rationale (each point grounded):
1. §12 is the master prompt's only frontend-acceptance section ("The application must provide a coherent, operational frontend for its documented business roles... The frontend must use actual application data. Do not leave production workflows dependent on hardcoded dashboard figures, static arrays, fake success messages, or placeholder responses."). A section on frontend↔backend alignment and data presentation is the natural extension of §12, not of any other section. [E1]
2. The requested feature-to-interface coverage matrix (requirement → backend → database → frontend page → roles → calculations → test evidence → status) is a direct extension of §3.2's "requirement-to-implementation matrix" (columns already include Requirement ID, Frontend, Backend, Database, Security, Business validation, Audit trail, Tests, Status, Remaining work) and of §14's evidence table. The new section should reference/extend those tables rather than invent a competing one — §14 itself warns "Do not create competing status documents unnecessarily". [E1]
3. Acceptance hooks already exist in §17 Gate E — Frontend ("Relevant documented roles can access their permitted workflows... No critical control is a placeholder") and Gate I. [E1]

**Cross-reference hazard (do not renumber §13–§19):** `docs/audit-2026-10-31/execution-map.md` cites the master prompt by section number throughout — e.g. the G2 gate row cites "Prompt §13 'real local Supabase Auth and Postgres'", G3 cites "§16 'CI passes'", and §-references appear at execution-map.md:5, :40, :68, :93 and across its step tables (§2, §5, §6, §7, §8, §9, §10, §11, §12, §13, §14, §16, §17). The master prompt's own header already records one such drift ("it cites §6 business modules A to K and §16 'CI passes'; in this revision §6 is staging and B-18, §16 is the execution order"). [E1]

**Recommendation:** insert the new section as `# 12A. COMPLETE FRONTEND, BACKEND ALIGNMENT AND DATA PRESENTATION` placed between the two quoted headings, so every existing §13–§19 number and all external citations stay valid. If MJ prefers full renumbering (§13→§20 shifting), the same pull request must sweep every §-citation in `docs/audit-2026-10-31/execution-map.md` and anywhere else that cites §13 or later; that sweep is the cost of the renumber option. [E2]

Secondary anchors worth citing inside the new section: §3.2 (matrix), §12 (frontend acceptance), §17 Gate E (acceptance), §14 (evidence structure), and the execution map's deliverables table rows "B. traceability matrix | the four requirement tables (add Frontend, E2E columns per slice)" and "C. frontend report | route list per slice". [E1]

## 3. Execution map (`docs/audit-2026-10-31/execution-map.md`) — slices and frontend vs backend

[E1 unless noted. The map states no status itself: "It states no status: task status is only on the ACTIVITY §12 board."]

Hard gates that precede all slices (map §"Hard gates"): G1 owner account with TOTP on staging (MJ, human-only); G2 real local Supabase stack for browser tests (CI job); G3 MJ approves each push; G4 MJ decisions/blockers. [E1]

The map's §12 defines nine slices, "Each slice below is one branch and one pull request". Classification below marks the dominant surface; the map's own §7 note says frontend and backend standards are "Applied in every slice" (one layout with role-aware navigation; five states per page; no button without a working server call; authorisation only in the database; RPCs validate, are idempotent and audited) — every slice is a vertical slice by construction. [E1 + E2 classification]

| # | Slice (verbatim gist) | Frontend-facing surface | Backend/DB surface | Classification |
|---|---|---|---|---|
| 1 | Office shell: layout and navigation, devices, users, territories and assignments; CI job with a real local Supabase stack and Playwright (G2) | office layout/nav, devices, users, territories pages | device/user/territory RPCs + migrations; CI infra (G2) | Mixed: frontend shell + full-stack verticals + CI infrastructure |
| 2 | Rep shell: check-in and check-out, territory, route and due list | rep PWA pages (`/app`, `/app/route`) | `app.my_session`, `rep_check_in/out`, `due_list`, `my_route` | Full-stack, rep-frontend facing |
| 3 | Salons: list, detail (notes, visits, stages, phone reveal), create with pin, edit | salon list/detail/create/edit (office + rep) | salon RPCs, phone reveal, duplicate checks | Full-stack, frontend-heavy |
| 4 | **D-30 order rework (Phase 1)**: office Orders area creates official orders; rep records a New Order Details card; office converts and links the card. Three PRs: A (orders+cards, PR 48/L-0400), B (delivery submission + office approval, D-32), C (commission, D-31 → now P1-22 with D-38) | office Orders area, rep cards, delivery approvals, commission pages | `app.office_create_order`, `office_open_cards`, `finalise_delivery`, commission stamping | Full-stack |
| 5 | Stock: bag, issue and confirm, daily close, office stock, low stock, adjustments and the approvals queue | office stock screens, rep bag/confirm pages | two-party `stock_issue`, `stock_count`, adjustments via approvals | Full-stack |
| 6 | Payments, receipts, cash ledger, handover and remaining P1-07 controls | payment/handover/receipt screens | payment write path, receipt adapter, append-only ledger | Full-stack |
| 7 | Control layer and digest (P1-08), vault (P1-05), dashboards (P1-10), agents (P1-15), offboarding | dashboards, agents app, digest/offboarding screens | control.approval_request read functions, vault functions, offboarding function | Backend-heavy with dashboard/agent frontend |
| 8 | Offline client (P1-09): offline visits, prospects, payment capture and ORD-14 intake cards; "Urdu strings throughout" [stale — see §9 conflict C1]; no offline salon portal order submission | rep PWA offline layer, outbox, sync UI | sync contracts, idempotent replay, server rejection surfacing | Frontend/client-side (PWA) over existing backend |
| 9 | Security acceptance suite and restore drill (P1-12), then the pilot (MJ) | none | attack-pass tests, backup/restore drill, CI gates | Backend/CI testing; no UI |

Journeys the map tabulates (input material for a coverage matrix): J1 Representative's day (18 steps, each with database/RPC → page → slice); J2 Salon acquisition; J3 Agent purchase (slice 7); J4 Manager's day; J5 Owner's view. Deliverables table: "B. traceability matrix | the four requirement tables (add Frontend, E2E columns per slice)", "C. frontend report | route list per slice", "D. backend report | migration and RPC list", "E. security report | `crm-attacks.test.ts`, rls-matrix, advisors". [E1]

Map preamble history note: the original order-journey text put the salon portal in Phase 2; "Amended 2026-11-05 (doc 16, D-33 to D-41): the salon portal, invitations, commission payments, the investor ledger and per-salon prices moved to Phase 1 (D-41)... Where this map and that spec differ, the spec wins; the Phase 2 wording above and below is kept as history of the plan at that time." The remaining completion work is "the project completion slices, P1-18 to P1-24 on the board, in the order of `docs/superpowers/specs/2026-11-05-reps-salons-catalogue-investors-design.md` section 6". Since then the board grew P1-25…P1-31 (completion/audit slices — see the "What is built" table in `docs/plans/in-progress/2026-11-05-remaining-implementation.md`) and P1-32…P1-38 (storefront). [E1]

## 4. `docs/16-project-completion-goal.md` (authoritative business spec) — per role

[E1 quotes/paraphrase; doc 16 declares itself: "This file is the authoritative business specification. Where it conflicts with an older document or decision, this file wins and the older one is amended."]

**Owner and Manager (doc 16 treats them in one section):** the Office workspace provides — Rep and Salon account invitations and management; product catalogue management; product images and descriptions; product pricing; official order creation and approval; a central order-request review workflow; payments and outstanding balances; Rep commission management; investor-related financial decisions, including "a promised recurring percentage return that the system calculates from the invested amount and the percentage (amended 2026-11-20, decision 2026-11-20-mj-rep-scope-stock-investors; this supersedes the earlier no-automated-calculation rule)". Bound: "The Manager performs the specified account, product and pricing operations. Permissions go no further: for example, a Manager cannot promote a user to Owner." The owner/manager power split itself is defined in doc 03 SEC-01 (owner = operational + governance: users, bank details, write-offs/credit notes, price lists, commission plans, vault grants, audit log, configuration; manager = full operational access; "A manager never creates or promotes an owner or manager"). [E1]

**Sales Representatives:** access only assigned Salons; permitted Salon info read-only; add Salon notes; check in/out, plan a route, record visits and follow-ups; a dedicated Order Notes area ("including a potential (not yet approved) salon, since a prospect is a potential client"); may submit New Order Details and order requests; view their requests and relevant official orders; deliver and collect "according to the approved workflow"; view their own commission information and payment history. Hard line: "Reps must not create, approve or modify official orders." **2026-11-20 amendment:** MJ "further narrows the rep area to check-in/out, route, notes and Order Notes with no bag, rep delivery or money handling; that rep-area cleanup is a separate slice, recorded in `docs/log/2026-11-20-mj-rep-scope-stock-investors.md`". This directly changes which rep surfaces a complete frontend must present (bag, Deliver, Cash pages are slated for removal from the rep area). [E1]

**Salon Customers:** "The Salon Portal uses the existing membership and authorization architecture. Salons log in through an invitation; view their own Salon account; browse the shared active product catalogue; see their own approved prices; submit order requests; view and track their orders; view permitted payment and account information. Strict Salon-to-Salon data isolation. Salon Customers are not an internal `user_profile.role`." [E1]

**Investor:** no user-facing role. Doc 16: "Investor finances stay separate from Rep commissions. Each investment may carry a promised recurring percentage return (monthly by default, or yearly) that the system calculates from the invested amount and the percentage; the office records payouts against it. There is no batch profit-sharing or distribution engine." Doc 03 CAP-01: "no investor login or portal". Assumption A-25 (ACTIVITY §15) pins the default period: monthly accrual `floor(amount × pct / 100)` per whole calendar month, yearly selectable per investment. The office-side screens must therefore present investor figures, the calculated accrual and payout rows; no investor login surface exists or is approved. [E1]

**Independent agent:** not covered by doc 16. Doc 03 AGT module: AGT-01 owner-created account, signs in like a rep (email code, approved device); AGT-02 agent price per SKU in `agent_price`, owner-only, "a SKU without an agent price is not sold to agents"; AGT-03 cash-and-carry, paid in full before stock leaves the warehouse, numbered invoice/receipt, never on credit; AGT-04 (S, Phase 1) agent app: own purchases, catalogue with agent prices and warehouse availability (quantities only), and "an optional pre-order request, the only thing an agent ever sends back"; AGT-06 no recruitment pay (SECP, Companies Act 2017 s.301). Execution map module L places agents in slice 7, gated by "B-31 g (how an agent is represented)". [E1]

**Public visitor:** not a role anywhere in doc 16 or doc 03's role model. In the DMS app the only anonymous-reachable page is `/invite/[token]` — SEC-16: "The invite page is the only page that creates a login; a login with nothing redeemed has no profile and RLS shows it nothing." A served public-visitor role exists only in the khsalon.com storefront plan set (MJ added it to Phase 1 on 2026-11-10, decisions D-52…D-61): consumers at retail price, Shopify checkout, catalogue reads moved out of schema `app` (B-62 decision), order processing split "1, Regular User 2, Client Salon" with the manager/owner releasing and completing orders (D-60/D-61: a Regular User order is marked delivered on dispatch with a rider, no signature; Client Salon orders keep D-49's signed-acknowledgement rule). If the new frontend-alignment plan's matrix is scoped to the DMS app, the public visitor column is "n/a — /invite/[token] only"; the storefront is a separate plan family (see §7). [E1]

**Cross-cutting requirements doc 16 also fixes** (these constrain any frontend plan): unified order workflow — one coherent Office review experience for Rep and Salon submissions; both are requests, never official orders; the Office converts/creates/approves/rejects; "The canonical `sales_order` and `sales_order_line` model is reused, with no second order ledger." Delivery approval (D-32): "A Rep submission must not finalize stock movements, invoicing or order completion before the required Office approval." Safeguards: forward-only migrations; reuse of canonical entities; no duplicate tables/RPCs/dashboards/order engines/catalogues/payment ledgers/CRM; "permissions enforced in RLS and server-side RPCs, not only by hiding UI"; historical records and audit trails preserved; idempotency and maker-checker preserved; integer paisa; "supplier, cost and margin data never exposed to unauthorized users"; no hard deletes; offline Rep functionality preserved; branch/PR workflow; no direct push to `main`. [E1]

## 5. `docs/03-requirements.md` — requirement groups, counts, phase split

[E1 — counted from the file's own tables. Doc 03's preamble: "Priorities use MoSCoW: M must have (MVP), S should have (Phase 2), C could have (Phase 3+)... Phase numbers refer to doc 11." Standard-records note (documentation audit, 2026-11-19): doc 03 is "the index of requirement IDs and the source of every statement"; per-requirement detail lives in `docs/contexts/` and `docs/requirements/` (index `docs/requirements/README.md`); "A row's phase says when it is due, never that it exists; task status is only on the ACTIVITY board."]

| Group | Rows | Phase 1 (rows) | Phase 2 | Phase 3 | Notes |
|---|---|---|---|---|---|
| SAL — Salons | 14 | 11 (01–05, 09–14) | 2 (06, 07) | 1 (08) | SAL-11/12 moved into Phase 1 by D-41; SAL-09 read-only per D-35 |
| PIP — Pipeline/territories/routes/visits | 13 | 7 (01, 02, 03-manual, 05-thin, 06-thin, 07, 09) | rows 03(auto), 04, 05(full), 06(full), 08, 10, 11, 12, 13 | — | 3 dual-phase rows (03, 05, 06); PIP-12/13 are M but Phase 2 |
| MAP — Map prospecting/discovery | 13 | 4 (01, 02, 03, 12) | 8 (04–09, 11, 13) | 1 (10) | MAP provider approval = H-21 |
| ORD — Orders/deliveries/invoices | 15 | 11 (01–05, 07-part, 11, 12, 13, 14, 15) | rows 06, 09, 07(dated lists) | 1 (08) | ORD-10 superseded by D-30 (no phase, "— \| —"); ORD-11–13 moved to Phase 1 by D-41 |
| PAY — Payments/installments/cash | 11 | 9 (01, 02, 03-generate, 04, 05, 07, 08-manual, 10, 11) | rows 06, 09, 03-auto-send, 08-timers | — | 2 dual rows (03, 08) |
| INV — Inventory | 13 | 8 (01–05, 06-manual, 11, 13) | rows 07, 08, 09, 10, 12, 06-computed | — | INV-12 explicitly "Stays Phase 2" (D-41) despite priority M |
| VLT — Supplier vault | 7 | 6 (01–06) | 1 (07 column encryption) | — | |
| SEC — Users/roles/security | 17 | 16 (01–08, 10–17) | — | 1 (09 honeytokens) | SEC-13…15/16 moved to Phase 1 by D-41/D-39 |
| CTL — Anti-fraud controls | 18 | 15 (01–09, 11-manual, 13, 15, 16, 17, 18) | rows 10, 12, 14, 11-automated | — | CTL-11 dual; CTL-13 commission in Phase 1 by L-0385 |
| FLD — Field team | 6 | 3 (01, 03-part, 06) | rows 02, 04, 05, 03-statement/bonus | — | FLD-03 dual ("M/S \| 1–2") |
| RPT — Reporting | 5 | 2 (01, 02) | 3 (03, 04, 05) | — | RPT-01 marked partially built in-row (P1-26, "not all on it yet") |
| MSG — Messaging | 4 | 1 (03 in-app) | rows 01, 02, 04, 03-push | — | MSG-03 dual |
| ADM — Administration | 3 | 3 (01-part, 02, 03) | (01 remainder) | — | ADM-01 dual ("M/S \| 1–2"); P1-30 note: logo/address/phone "not built" |
| AGT — Independent agents | 7 | 5 (01, 02, 03, 06 at M/1; 04 at S/**1**) | 2 (05, 07) | — | AGT-04 is S-priority but Phase 1 |
| DEM — Lost demand | 3 | 2 (01, 02) | 03 report part | — | DEM-03 dual ("M \| 1 / S \| 2"); doc 11 puts the DEM-03 report in Phase 1 |
| CAP — Investor ledger | 3 | 3 (01, 02, 03) | — | — | D-40 baseline "no calculation"; superseded by doc 16's 2026-11-20 amendment (see §4, §9 conflict C2) |
| NFR — Non-functional | 12 | no Phase column in the table | — | — | Phase mapping is not stated per row in doc 03. Anchors that do exist: NFR-01 (offline-first rep app) is Phase 1 scope via P1-09 / execution-map slice 8 / doc 11 Gate 1 criterion 6; NFR-03 "English-only UI (D-42...) No Urdu labels and no i18n layer"; NFR-02 low-end Android budgets; NFR-07 OWASP ASVS L2 |

Totals: 164 rows (152 functional + 12 NFR). Rows spanning both phases (12): PIP-03, PIP-05, PIP-06, ORD-07, PAY-03, PAY-08, INV-06, CTL-11, FLD-03, MSG-03, ADM-01, DEM-03.

**A-xx:** A-xx is **not** a section of doc 03 — it is the assumptions register, `docs/ACTIVITY.md` §15 "## 15. Assumptions register" ("Any assumption an agent makes to proceed goes here and in a log ASSUMPTION entry. MJ reviews this table at each gate."). Count: **26 rows, A-01…A-26**. Doc 03 rows cite A-06, A-07, A-08 (AGT-06, AGT-03, the rep-bag rule at 03-requirements.md:74/:94) and A-16, A-18 (delivering-rep and rep-less-delivery rules). Status mix [E1, counted from §15]: open 18 (A-01–A-09, A-11, A-12, A-13, A-18, A-20, A-21, A-24, A-25, A-26); confirmed 4 (A-14 L-0361, A-15 L-0360 as amended by D-46, A-16 L-0385, A-23 as amended by D-58); rejected 2 (A-17 L-0382 one-login-per-salon, A-19 B-41 manager may edit product groups); closed 1 (A-10, replaced in P1-30); no status cell 1 (A-22 — row formatting anomaly, its impact/status columns are missing [E3]). Load-bearing for a frontend plan: A-16/A-18 (delivering-rep picker, office delivery of rep-less orders), A-08 (owner-only bag limits), A-21 (sidebar placement decisions), A-22 (invoice composer prints first-8-char order/salon IDs; browser print dialog is the PDF), A-25 (investor return period default). Note on the register itself: the A-25 row records "renumbered A-24 to A-25 on 2026-11-21: A-24 was already the P1-33 catalogue assumption" — the register is actively maintained, so cite A-IDs by row text, not by memory. [E1]

## 6. `docs/11-roadmap.md` — what "Phase 1" means and its exit criteria

[E1.] Doc 11 states the Phase 1 scope per area with requirement IDs (consistent with §5 above, including the D-41 extension note: "Scope extended by MJ on 2026-11-05 (D-41): the salon portal, invitations, commission payments, the basic investor ledger, product pictures and per-salon prices are now Phase 1. This states what is approved, not what is built."). Its **Phase 1 exit criteria (all must pass)** are the phase-level definition of "complete":

1. "Security acceptance list in doc 06 §10 passes."
2. "20 consecutive working days of pilot with handover variance Rs 0 and stock close variance 0 — or every variance explained in a case."
3. "100% of payments in the pilot have a delivered receipt (SMS or WhatsApp)."
4. "Owner answers 'how much are we owed, by whom, who's collecting' from the phone in < 10 s."
5. "Vault tests in doc 07 §5 pass."
6. "Offline capture → sync works in a basement salon with no signal (tested in the field)."
7. "Backup restore drill done."

`docs/plans/README.md` maps the four unplanned packages to Gate 1 criteria 1/3/5/6/7. Note: criterion 4 ("< 10 s from the phone") is a direct data-presentation requirement — exactly the kind of thing the new frontend plan's matrix should carry. [E1/E2]

## 7. Plans inventory — `docs/plans/` (19 files)

Folder meanings per `docs/plans/README.md`: `implemented/` = merged to main; `in-progress/` = partly merged or being worked; `will-be-implemented/` = nothing built yet. "Status of a task still lives only on the board (docs/ACTIVITY.md section 12); this folder says where a plan is, not whether a task is verified." [E1]

### implemented/ (5 files)
| File | One-line status |
|---|---|
| `2026-11-03-office-orders-and-cards.md` | Header: "Status, 2026-11-06: built and merged to `main` (pull request A...)"; its internal 2026-11-04 Status block is kept as stale history. |
| `2026-11-04-delivery-submission-approval.md` | Header: "built and merged to `main` as completion slice 4 (P1-21), with the signed acknowledgement of P1-31 added on top"; internal Status line still reads NOT STARTED (stale, kept as history). |
| `2026-11-05-final-review-checklist.md` | No status header; README: end-to-end journey built in slice 8 in a changed form the file records; one open line (timeline maps, same as hermes H2). |
| `2026-11-05-project-completion.md` | README: "All seven slices merged (pull requests 53 to 65)... Nothing left." Checklist per slice, not step-level. |
| `hermes.md` | README: the fifteen-task work order; "H1 to H15 are merged (pull requests 81, 82, 84 to 96, and 98 for H2 on main)... Nothing in it is left to build." |

### in-progress/ (5 files)
| File | One-line status |
|---|---|
| `2026-11-05-frontend-structure.md` | Header: "Status: DRAFT FOR REVIEW, 2026-11-05"; MJ approved the direction in chat (log `2026-11-05-mj-frontend-structure.md`). Built: F5 office shell, F6 invoice/receipt views + composer + acknowledgement (P1-28, P1-31), Rep-detail page, S-C routes, most of S-A. Open: F1–F4 and F8 foundation, S-B leftovers, S-D2, S-F offline. See §8. |
| `2026-11-05-remaining-implementation.md` | Master list of what is left, written 2026-11-05. README: "Accurate as a list, but one line an item: not enough for an agent that only implements. Several lines are out of date: C1 is done (PRs 71, 73); REP-20, AUTH-08, AUTH-15 and AUTH-16 are done (74 to 77); M7 is merged (PR 78); REP-07 was already built... REP-05 describes the wrong screen." Its §"What is built" table is the current built-surface index (invitations, products, investor ledger, delivery approval, commission, requests queue + portal, rep read-only, office ops screens, office home/rep detail, invoice composer, audit fixes). |
| `2026-11-08-p1-09-offline-rep-app.md` | Header: "**Status:** DRAFT FOR MJ REVIEW... Nothing here has been run. ... row P1-09, NOT STARTED." Step-level, 11 tasks / 5 PRs; its first PR is a DEVIATION from server-time-authoritative that needs MJ approval (H-19). |
| `2026-11-09-p1-12-security-acceptance-and-restore-drill.md` | Header: "**Status:** DRAFT FOR MJ REVIEW... Nothing here has been run. ... row P1-12, NOT STARTED." Ten tasks / 4 PRs; five open questions for MJ. |
| `2026-11-10-khsalon-storefront-plan-b-catalogue-data.md` | Header: "**Status:** IN PROGRESS, step level expanded 2026-11-11 on `claude/p1-33-catalogue` from `main` at `727ebb3`. Plan A is merged (pull request 105)." Board row P1-33. |

### will-be-implemented/ (9 files)
| File | One-line status |
|---|---|
| `2026-11-06-not-yet-planned.md` | "A register, not a plan. It lists every remaining item that has no step-level plan, with what blocks it. Nothing in it may be built until MJ answers the question beside it or a plan is written." (README) |
| `2026-11-10-khsalon-storefront-overview.md` | Header: "**Status:** DRAFT FOR MJ REVIEW... Nothing here has been built or run." Plan-set overview for the khsalon.com public shop (goal §1, MJ's chat decisions §2). |
| `2026-11-10-khsalon-storefront-agent-prompts.md` | Executor prompts for plans A–G; no own status header (grep: only the standard status-words block at its line 36). |
| `2026-11-10-khsalon-storefront-plan-a-decisions.md` | Header still "**Status:** DRAFT FOR MJ REVIEW, task level. Nothing here has been built or run." — stale: plan B's header and the README both say "Plan A is merged (pull request 105)". The file also still sits in `will-be-implemented/` despite the merge — folder state lags the README text [E3]. |
| `2026-11-10-khsalon-storefront-plan-c-catalogue-load.md` | Header: DRAFT FOR MJ REVIEW; board P1-34; waits on B-54/B-55 (blocker register §14 marks both "DECIDED for interim dummy data"). |
| `2026-11-10-khsalon-storefront-plan-d-pages-seo.md` | Header: DRAFT FOR MJ REVIEW; board P1-35; blockers B-54–B-59 (B-59 still PENDING). |
| `2026-11-10-khsalon-storefront-plan-e-tracking.md` | Header: DRAFT FOR MJ REVIEW; board P1-36; blocker B-58 (PENDING on dummy default). |
| `2026-11-10-khsalon-storefront-plan-f-shopify.md` | Header: DRAFT FOR MJ REVIEW; board P1-37; blockers B-56/B-57 (PENDING on dummy default). |
| `2026-11-10-khsalon-storefront-plan-g-timeline-reminders.md` | Header: "**Status:** Built on branch claude/p1-38-timeline. Order steps, the reminder log and the unconfigured reminder job are in the code. Real e-mail waits on B-61." Built on a branch but still filed under will-be-implemented [E3]. |

Folder-vs-README mismatches noted above are observations, not resolved (the README's own rule is that moving a plan is a `git mv` in the PR that changes its state). [E3]

## 8. The existing frontend plan (`in-progress/2026-11-05-frontend-structure.md`) — what it covers and what the new plan must add

[E1 unless marked E2.]

**What it is:** "the architectural roadmap for the three applications" (Office `/office`, Rep `/app` PWA, Salon `/salon`). It deliberately sits under the completion slices, doc 12 decisions and the ACTIVITY board, "reopens none of their decisions", "authorises no new role, permission, financial term, phase change or production action", and defers to doc 16. Evidence base declared: `origin/main` at e703fe3 + in-flight branches, as of 2026-11-05.

**What it already covers (the new plan must extend these, not duplicate):**
- **§2 Nine screen rules** — the repo's frontend law: authorisation lives in the database; five states on every data surface (loading, empty, error, permission denied, success); "Refusals show the database's own message. No fake success, no dead button, no hardcoded figure or static array"; **rule 4 "No financial or stock figure is calculated in the browser"** (formatting only, via `lib/money.ts`); totals from the source, never the loaded page; `client_id` per mutation; rep never sees supplier/cost/margin or unmasked phones; historical records immutable in the UI; and rule 9: each screen defined before built, shipping "at least one stack or browser test that exercises the real UI-to-database path".
- **§3 Shared foundation F1–F8** with per-item state: F1 generated DB types in `packages/shared` (not built; "pages hand-type their rows"), F2 typed RPC client over `lib/rpc.ts` (untyped today; one error mapping for `42501`, `22023`, `55000`, `23505`), F3 shared design system, F4 data-table pattern (keyset paging, URL filters, row actions, five states), F5 navigation shells (office grouped, rep/salon none at writing), F6 invoice/receipt/statement views over `app.invoice_document`/`app.receipt_document` (was "no page calls either function"; since built for office + salon invoices per the P1-28/P1-31 progress notes), F7 rep offline outbox (not built; P1-09), F8 test helpers (`apps/web/e2e-stack/`, `scripts/e2e-stack-seed.mjs`). Ordering: "F8 comes first, then F1 and F2, then F3 to F5."
- **§4 Office sidebar** groups (Overview; Customers and Salons; Orders and Deliveries; Inventory and Stock; Money and Collections; Field Team; Controls and Approvals; Reports and Analytics; Administration and Settings) with not-built items bracketed; owner-only items hidden from the manager and refused by the database.
- **§5 Delivery approval as "the security boundary"** (S-D first item): rep submits evidence, never marks delivered; only owner/manager approves in one PostgreSQL transaction (delivery, sale movement, invoice, installments, status, commission stamp); stack test required that proves no invoice/movement exists until approval and that a replayed approval creates nothing twice.
- **§6 Rep-detail page** (`/office/reps/[id]`) section spec, including "where no read exists for a section, that section waits for a read function written in its own slice, never a browser-side join of raw tables".
- **§7 Work packages** with dependencies: WP-0 in-flight slices; F8/F1/F2; F3–F5; S-D1 delivery-approval boundary; S-A stock; S-B money; S-C routes; S-D2 control layer (approvals queue needing a `control.approval_request` read, daily digest reads, settings, offboarding screen); Rep-detail; S-E dashboards ("built only from verified reporting functions... No browser-side balance or stock arithmetic"); S-F offline client.
- **§8 Screen catalogue** with status key BUILT / IN FLIGHT / PARTIAL / NO PAGE / NOT STARTED, per route for Office, Rep and Salon portal — including explicit NO PAGE rows (e.g. `office_deliver` "NO PAGE" at writing, later built per P1-25; invoice/receipt views, then built per P1-31). Note: its own header says "Status cells in section 8 are not rewritten here", and the README calls the header stale: "Its header still says DRAFT FOR REVIEW and its screen catalogue keeps older status words. It is a roadmap, not step-level: F1 to F4 and F8 need their own plan before anyone builds them."
- **§9 Per-screen definition template** — Route; Roles allowed and what each other role or an anonymous visitor sees; Functions read and written (exact names and arguments); Data dependencies; Fields and columns (label, source, format); Filters and sort; Actions; States with exact wording; Money shown (paisa source; no browser arithmetic); Offline behaviour; Acceptance criteria; Test (stack spec name; positive path; wrong role; other territory or salon; replay). **This template is the closest existing precursor to the requested feature-to-interface coverage matrix.** [E2]
- **§11 Open points for MJ:** commission basis/payout policy; rep-less order delivery page (A-18); separate rep Route page (answered by slice 11: `/app/route` built, `/app/day` handling stays).

**What it does NOT cover — the gaps the new "Complete Frontend, Backend Alignment and Data Presentation" plan fills** [E2]:
1. **Requirement-ID mapping.** The catalogue maps routes → functions, never doc 03 requirement IDs → routes. No existing artifact joins SAL/ORD/PAY/… IDs to pages, which is exactly the requested matrix's first column. (The execution map's four requirement tables in `docs/audit-2026-10-31/` are the raw material: `salons-map-routes.md`, `stock-orders-agents.md`, `money-controls-vault.md`, `security-nfr-webapp.md` — cited at execution-map.md:12.)
2. **Backend-alignment completeness check** — a systematic pass that every Phase 1 `app.*` function has a caller (the frontend plan did this ad hoc per page: a function with no caller is marked "no page"), and that no page calls a function outside its role's allow-list. `packages/shared` types (F1) and the typed client (F2) are still unbuilt, so the alignment layer itself is a prerequisite.
3. **Data presentation & explanation layer.** The nine rules ban browser arithmetic and fake figures, but no document specifies per-metric provenance (which function/column), format (paisa → display, dates in Karachi time), or the "explains every metric and action" wording. Doc 11's exit criterion 4 (owner answers receivables from the phone in < 10 s) is the only stated presentation performance requirement.
4. **Role × page × requirement tabulation** — SEC-01's permission matrix rendered as a checkable table per screen (the §9 template asks for it per screen but no consolidated matrix exists).
5. **Coverage-matrix gating** — "gated by a feature-to-interface coverage matrix (… → status)" is a new governance artifact; the nearest existing hooks are the execution map's deliverables B (traceability matrix with Frontend/E2E columns) and C (frontend report, route list per slice), plus ACTIVITY's status words. The new plan should define the matrix as the gate and feed it from those existing tables rather than replacing them.
6. **The 2026-11-20 rep-area narrowing** (no bag, no rep delivery, no money handling — doc 16) and the investor-return calculation (A-25) postdate the frontend plan; its Rep catalogue rows (`/app` bag, deliver, cash surfaces) and Investors rows need re-deriving from the new decisions in `docs/log/2026-11-20-mj-rep-scope-stock-investors.md` (that log file was not read in this pass — unknown).

## 9. Conflicts and stale-text register (write into the new plan as flagged conflicts, do not silently reconcile)

- **C1 — Urdu vs English.** `execution-map.md` §12 slice 8 says the offline client has "Urdu strings throughout"; doc 03 NFR-03 says "English-only UI (D-42, supersedes the bilingual wording). No Urdu labels and no i18n layer", and the frontend plan §1 records D-42 (PR 60) with the same effect. D-42 postdates the map (2026-11-05 vs 2026-11-01). Reading: D-42/NFR-03 govern; the map line is stale. If the new plan touches rep offline screens, treat this as settled by D-42 unless MJ says otherwise. [E1 both sides]
- **C2 — Investor calculation.** Doc 11's Phase 1 investor row still reads "basic office ledger, no calculation or distribution engine, no investor login (D-40)"; doc 16's 2026-11-20 amendment supersedes it ("the system calculates [the promised recurring percentage return] from the invested amount and the percentage... this supersedes the earlier no-automated-calculation rule"; "There is no batch profit-sharing or distribution engine"). Doc 16 declares itself authoritative ("Where it conflicts with an older document or decision, this file wins"). The frontend must therefore present a calculated accrual per investment (A-25 default monthly), while doc 11's text still says otherwise. [E1 both sides]
- **C3 — Rep scope.** Doc 16's pre-amendment text (deliver and collect, payment history) vs the 2026-11-20 narrowing (no bag, no rep delivery, no money handling) coexist inside doc 16 itself; the narrowing is "a separate slice". A complete-frontend matrix must show both: current built surfaces and the decided-but-unbuilt rep-area cleanup, with the cleanup's log entry cited. [E1]
- **C4 — Stale headers.** Frontend-structure plan header "DRAFT FOR REVIEW" with a catalogue that "keeps older status words" (README); plan-A storefront header "Nothing here has been built" vs merged PR 105; delivery-approval plan's internal "NOT STARTED" kept as history. Status of record is always the ACTIVITY §12 board; plan headers are snapshots. [E1/E3]
- **C5 — Folder placement lag.** `khsalon-storefront-plan-a-decisions.md` (merged per README/PR 105) and `plan-g` (built on branch) still sit in `will-be-implemented/`; README's move rule says a `git mv` should have accompanied the state change. [E3]
- **C6 — Numbering fragility.** Execution map cites master-prompt §-numbers from an older revision; the master prompt header documents the drift. Any renumbering caused by inserting the new section must sweep these citations (see §2). [E1]

## 10. Unknowns (not verified in this pass) and suggested next look

1. **`docs/06-security-plan.md` §10 and `docs/07-*` §5** — the named security/vault acceptance lists behind doc 11 exit criteria 1 and 5. Not read; needed before the coverage matrix can carry "test evidence" columns for SEC/VLT rows.
2. **`docs/requirements/README.md` and the `docs/contexts/*/CONTEXT.md` module documents** — doc 03 names them as the per-requirement source (actor, preconditions, `AC-<ID>-<n>` acceptance criteria, tests, evidence). Not read; they are the input for per-requirement acceptance criteria in the matrix.
3. **ACTIVITY §12 board rows P1-18…P1-38** — only spot-checked (P1-25 IN PROGRESS seen at ACTIVITY.md:373; B-60/B-61/B-62 rows and §15 read). Current per-slice VERIFIED/not-verified states not row-verified. The board is the status of record for the matrix's status column.
4. **`docs/log/2026-11-20-mj-rep-scope-stock-investors.md`** — the 2026-11-20 rep-narrowing + investor-return decision log. Not read; its exact wording constrains which rep surfaces remain and how the investor accrual is displayed.
5. **The four requirement tables in `docs/audit-2026-10-31/`** (`salons-map-routes.md`, `stock-orders-agents.md`, `money-controls-vault.md`, `security-nfr-webapp.md`) — named by the execution map as the requirement-level matrix evidence; not read here.
6. **Whether `packages/shared` exists yet** — CLAUDE.md says "Planned, not built yet"; not re-verified on this branch. One `ls packages/shared` settles it before planning F1/F2 work.

## 11. Source index

- `docs/audit-2026-10-31/master-prompt-2026-11-01.md` (full read)
- `docs/audit-2026-10-31/execution-map.md` (full read; lines 5, 40, 68, 93 cited from grep)
- `docs/16-project-completion-goal.md` (full read)
- `docs/03-requirements.md` (full read; lines 74, 94 cited from grep)
- `docs/11-roadmap.md` (full read)
- `docs/ACTIVITY.md` (lines ~495–560 read: end of §14 blockers incl. B-54–B-62, §15 assumptions register, §16 note, Appendices A–C; rows A-08 at :522 and A-16 at :530 located via grep; P1-25 row at :373)
- `docs/plans/README.md` (full read)
- `docs/plans/in-progress/2026-11-05-frontend-structure.md` (full read)
- All 13 remaining plan files (headers via grep `^(# |Status|STATUS|\*\*Status)` and targeted reads: storefront overview and remaining-implementation first 30 lines)
- Git: `git branch --show-current` → `integration/single-repo-consolidation`; `git log -1` → `77b34f8 2026-11-21` (read-only)
