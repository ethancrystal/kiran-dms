# External review of the alignment plan and route supplement — MJ attachment, 2026-11-21

> Evidence copy, preserved verbatim. MJ attached this text twice on 2026-11-21 (17:29 and 17:44 UTC); the two copies are byte-identical (7,626 bytes). The review examined `derived/fe-plan/frontend-inventory-office-routes.md` and `docs/plans/will-be-implemented/2026-11-21-frontend-backend-alignment.md` against the local repository. Its corrections were verified and applied in the plan's second revision; the disposition mapping is §12 of the plan.

---

**My verdict: the assessment is mostly correct, and the plan is directionally good, but I would not approve either as the final source of truth without some corrections.**

I checked the uploaded Office route inventory against the actual local `K` repository and also read its companion execution plan, `2026-11-21-frontend-backend-alignment.md`.

## **1. What is correct**

Verified

**The 30 Office routes**

I independently checked the directory. There are exactly 30 Office `page.tsx` routes, and all 30 paths in your uploaded table match the checkout at `77b34f8`.

The count is:

- 28 protected Office application pages.
- 1 sign-in page.
- 1 MFA page.

The Office shell correctly checks for an active Owner or Manager profile. The plan also correctly identifies several genuine gaps:

- No Office goods-receipt or restock-suggestion interface.
- No existing-user role-change control on the Team page.
- Rep offline outbox not connected to actual writes.
- Missing public storefront pages.
- Missing Salon receipt view and some document capabilities.
- Incomplete accessibility and responsive testing.

The proposed feature-to-interface coverage matrix is a good idea. I agree with using actual database calculations as the source of displayed figures and requiring real test evidence before marking a feature complete.

## **2. Corrections needed in the assessment**

There are some specific errors.

**A. Office authorization wording is too broad.**

The document says all Office pages require AAL2 and an active Owner/Manager profile.

That is not quite true:

- `/office/login` is intentionally accessible without an existing session.
- `/office/mfa` requires a signed-in user but must allow an AAL1 session while MFA is being completed.
- The 28 protected Office application routes require AAL2 and pass through the active Owner/Manager layout.

This distinction matters for the security matrix.

**B. The Salon route has incorrect function attribution.**

The uploaded table puts `update_salon` and `office_salon_timeline` under `/office/salons`.

I inspected the actual files:

- `/office/salons` reads the `salon` and `salon_approval_decision` tables directly and uses `OfficeAddSalon` and `DuplicatePhones`.
- `update_salon` and `office_salon_timeline` belong to `/office/salons/[id]`.
- The detail page also uses `office_override_stage`, area/contact reads, and the Timeline component.

These functions and dependencies need to be moved into the correct route rows.

**C. The Stock routes need correction.**

The assessment puts `stock_on_hand` under `/office/stock/levels`. The actual code calls it on `/office/stock`.

The Stock levels page uses `warehouse_availability` and `low_stock`, plus direct reads from `sku`, `reorder_rule`, `stock_location`, `stock_count` and `user_profile`.

The table currently omits several direct table reads and imported component dependencies. It should be a complete route-to-data map, not just a list of selected RPC names.

## **3. Problems in the companion execution plan**

These are more important because they affect implementation.

Needs correction

**A. Its PR status is stale.**

The plan still says PR #118 is open and schedules merging it as Wave 0.

That is outdated. PRs #118 and #119 have both merged. The latest remote `main` is `0dfb9fb`.

The plan must start from the current `main`, not schedule another consolidation merge.

Also, the CI run on the consolidated PR head `77b34f8` failed two jobs:

- Gitleaks secret scan.
- Office Playwright role-isolation test.

The other major checks passed, but those failures still need proper resolution and verification against the current main state.

**B. It misses important implementation already in progress.**

This is the biggest planning omission I found.

**Active** `vault` **worktree**

Uncommitted implementation

Already contains a supplier directory screen, migration, vault API, access-grant functionality and database tests.

The plan should tell the agent to review and finish this work, not design the same feature again.

**Active** `sheet` **worktree**

Uncommitted implementation

Already contains the CSV importer, upload page, catalogue matching, stock receipt integration and tests.

The plan must explicitly include finishing this importer. Your November 20 decision called for Excel or CSV; the current implementation is CSV-only.

There is also a concrete issue to resolve in the sheet importer: selecting the file generates a new batch UUID. Re-selecting the same file can therefore generate a new receipt identity. The agent must verify and correct the stock-receipt retry behaviour so the same shipment cannot accidentally be received twice.

The Vault work also needs a security review against the actual encryption requirements. The unfinished migration currently defines supplier fields as text columns; restricted access and RLS are not proof of encryption.

**C. The route-completeness CI check is proposed, not implemented.**

The plan mentions `scripts/coverage/check.mjs`, but that script and the `scripts/coverage` directory do not currently exist in the primary checkout.

That is fine as a planned deliverable, but the assessment should not imply that route completeness is already permanently enforced.

**D. The reports need a consistent counting method.**

The frontend inventory reports 171 called functions, while the backend inventory reports 177 names found in the frontend source. This may be a difference between actual call sites and string matches, but it needs to be explained before the coverage matrix is trusted.

Also, a static search finding no TODOs or obvious placeholders does not establish that every button and workflow works. That needs behavioural testing.

## **4. My recommended disposition**

| Document or workstream                     | Decision                               |
| ------------------------------------------ | -------------------------------------- |
| 30-route Office inventory                  | Keep, with corrections                 |
| Frontend/backend coverage matrix           | Keep as the main completion gate       |
| Data-presentation standard                 | Keep                                   |
| Responsive, accessibility and role testing | Keep and implement                     |
| PR #118 merge step                         | Remove; already merged                 |
| Office goods-in/restock UI                 | Keep as unfinished implementation      |
| Vault worktree                             | Preserve, review and finish            |
| Sheet-import worktree                      | Preserve, finish and add Excel support |
| Rep cleanup and offline wiring             | Keep                                   |
| Coverage CI script                         | Build; do not claim it already exists  |

## **Final conclusion**

Good foundation

The assessment has correctly identified the number of Office pages and many of the genuine frontend gaps. The execution plan also has the right overall approach: connect requirements, database capabilities, user interfaces and test evidence.

However, it currently describes an earlier project state and misses two significant pieces of active work. Its route-to-function mapping also contains errors.

**I recommend one correction pass before giving this plan to the coding agent.** The agent should start from `main` at `0dfb9fb`, preserve the active `sheet` and `vault` implementations, correct the route matrix, and then execute the remaining work. It should not repeat the planning exercise or recreate existing features.
