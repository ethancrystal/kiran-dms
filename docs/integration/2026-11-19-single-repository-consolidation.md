# Single-repository consolidation audit

**Audit date:** 2026-11-19<br>
**Canonical repository:** `ethancrystal/kiran-dms`<br>
**Canonical local checkout:** `C:\Users\moizjmj\K`<br>
**Integration worktree:** `C:\Users\moizjmj\K\.worktrees\single-repo-consolidation`<br>
**Audit base:** `origin/main` at `2d0f6a4c7629480aa09bfcbd70f29ef2accef865`

## 1. Repository decision

- `ethancrystal/kiran-dms` is the only canonical application repository.
- `ethancrystal/kiran` is a donor/reference codebase. Selectively port useful code into `kiran-dms`; do not add it as a Git submodule, preserve a second application checkout as a production dependency, or copy its dual-database routing.
- The user explicitly excluded the separate local `C:\Users\moizjmj\kiran-dms` folder. It was not inspected or modified.
- The existing local checkout `K` was not switched or reset. The integration worktree is a separate worktree of the same Git repository, created from the fetched `origin/main`.

## 2. Repository and worktree state

| Item | Observed state |
|---|---|
| `kiran-dms` main | `2d0f6a4` — PR #116 docs-audit merge |
| `kiran` main | `2e85b3d` — auth OIDC callback commit |
| Local `K` checkout | Clean; branch `feat/rep-day-no-bag-count`; HEAD `6541a5f` |
| Existing feature branch | 2 commits ahead of its remote; 22 commits behind current `origin/main` |
| Local branch refs | 139 |
| Cached remote refs | 103 |
| Linked worktrees | 20; all were clean at inspection |
| Integration branch | `integration/single-repo-consolidation`, based directly on `origin/main` |
| Integration worktree | Clean immediately after creation |

Do not treat local `main` as current; it is stale. Use fetched `origin/main` as the integration baseline. Preserve all existing worktrees until their contents and ownership have been explicitly reconciled.

## 3. GitHub pull requests

| PR | Subject | Current disposition |
|---|---|---|
| #111 | `delete` | **Reject / do not merge.** Removes most of the application and replaces it with a `kiran` submodule. Also changes a hard-coded Supabase project ref. It is destructive and contradicts the single-repository goal. Preserve evidence, then close only with explicit owner direction. |
| #112 | Rep day no bag count | **Do not merge the PR branch wholesale.** Its base is the stale `claude/p1-12-acceptance-guards` branch. A net tree comparison against current main shows large rollbacks/deletions, including current storefront/timeline/docs work. The no-bag-count commit was tested as a candidate and then removed from this integration branch because current `SPEC.md`, `docs/04-domain-model.md` and `docs/08-field-sales-and-rep-controls.md` still require bag counts and daily stock close. Keep the feature parked until the governing business rule is explicitly reconciled. Backup-manifest work remains a separate salvage candidate. |
| #113 | Board sync | **Park and refresh.** Docs-only, but overlaps `ACTIVITY.md` with #115 and some status text predates the latest docs audit. Reconcile each status against current evidence before carrying forward. |
| #114 | Office screens | **Integrated into local consolidation branch** (merge commit `89f4cc8`). Adds duplicate-phone, opening-last-purchase and reminder-log UI. All substantive latest-head GitHub checks passed. It is not merged to GitHub main; perform local typecheck/browser/database verification before proposing a main PR. |
| #115 | MJ decisions | **Integrated into local consolidation branch** (merge commit `7a1be67`). Docs-only, records B-62, B-61, D-62 and the follow-up B-39a resolution. Ensure the role/governance model reflects latest Owner direction; do not silently erase D-62. It is not merged to GitHub main. |
| #116 | Documentation audit | **Already merged. Keep it.** Its audit, requirement, context and traceability documents are part of current main. Do not restore older documentation trees over it. |

The open PR list was rechecked on 2026-11-19: #111–115 remain open and #116 is merged. No remote PR has been merged, closed, retargeted or force-pushed during this audit.

### PR #112: selective salvage map

The local feature branch contains useful work but is not a safe merge unit:

- `e6abe36` — rep check-in/check-out no longer requires a manual bag count. This is a discrete feature commit. Its migration and UI/test changes can be evaluated independently.
- `e6abe36` also changes `scripts/apply-kiran-migrations.mjs` from Supabase ref `iurvazdyxzlspegygldo` to `nwxidylbfeciungrqdkm`. **Do not port that ref change** until the canonical hosted project is explicitly verified.
- `d44e8b5` — adds backup-manifest code and tests, but also adds a `kiran` gitlink. Do not carry the gitlink.
- `5c277e2` — deletes the `kiran` gitlink and adds P1-33/P1-38 evidence logs. Preserve the gitlink deletion and inspect the log claims before porting them.
- `6541a5f` — updates manifest tests/implementation and adds CI gating. Re-run its checks against current main before adopting.
- `36d17a7` (subject `kkk`) and `5a17964` (subject `new`) are poorly named base-history commits. Do not merge these commits as a bundle. Inspect any uniquely useful files and re-home them with attributable commits.

At the remote PR head `d44e8b5`, CI had failures in office browser tests, activity-log-check, migrations/RLS and lint. Rep browser tests, typecheck/service-role scan, dependency audit, agent-policy and secret scan passed. The two local commits `5c277e2` and `6541a5f` are not on the remote PR head and need independent validation.

## 4. Donor repository comparison

At the audited snapshots:

- `kiran` main: `2e85b3d48800b3ec8952853393c4c6a5f3ac5efd`
- `kiran-dms` main: `2d0f6a4c7629480aa09bfcbd70f29ef2accef865`
- Shared paths: 381 identical blobs, 69 shared paths with different contents.
- Only in `kiran`: 15 paths.
- Only in `kiran-dms`: 28 paths.

The 15 `kiran`-only paths are:

```
.env.example
apps/web/app/api/health/route.ts
apps/web/app/auth/callback/route.ts
apps/web/app/shop/page.tsx
apps/web/app/shop/[slug]/page.tsx
apps/web/app/unavailable/page.tsx
apps/web/components/feedback.tsx
apps/web/lib/env.test.ts
apps/web/lib/rpc-availability.ts
apps/web/lib/rpc-availability.test.ts
apps/web/lib/storefront-public.ts
apps/web/pnpm-lock.yaml
docs/log/2026-11-18-gemini-railway-dualdb-e2e.md
metadata.json
railway.toml
```

### Donor-port rules

- Port the public storefront, auth callback, availability RPC helper and focused tests selectively.
- Do not overwrite entire `env.ts`, `proxy.ts`, Supabase server/client setup or other shared files; adapt to the canonical DMS conventions.
- The DMS root uses `pnpm@10.33.4`; the donor's nested web lockfile is not canonical. Keep the DMS root package manager and root lockfile.
- Do not import Railway-only configuration unless Railway is explicitly retained as a deployment target.
- Keep one canonical Supabase project and one authoritative source of truth. Do not transplant the donor's dual-DB routing.
- Respect B-62: move visitor/public read functions out of schema `app`; adapt all callers to the new public-read schema rather than preserving stale `.schema("app")` calls.
- Public and Salon Portal catalogue cards should expose only a Boolean-style **Available / Sold Out** value. Never expose numeric stock quantities to the browser, even as hidden data. Revalidate availability on request submission and again when the Manager officializes an order.
- The existing product-detail availability Boolean is not enough by itself; catalogue listings and Salon Portal need the same safe availability state.

The 28 DMS-only paths—including the merged docs audit, role-specific context files, requirements, and root lockfile—must be preserved.

## 5. Other branch work: keep, continue, or archive

| Branch / family | Recommendation |
|---|---|
| `claude/p1-09-signout-wipe` | Continue review on a clean base. Its sign-out wipe/outbox safeguards and tests are substantive; check overlap with merged outbox work and re-run security/browser tests before proposing a merge. |
| `claude/blind-stock-issues` | Preserve the logic, but do not edit a historical migration in place. Extract the intended change to a new forward-only migration and test it. |
| `feat/p0-foundation` | Inspect the unique launch-security and import-reverification tests; selectively port if still absent and passing. |
| `claude/tla-spec-verification-on-main` | Keep as formal verification research/evidence; do not merge blindly into application runtime. |
| `claude/architecture-rfc` | Preserve as architecture research; reconcile decisions into canonical docs before considering any code. |
| `claude/p1-08-control-layer-plan`, `claude/p1-09-plan`, `claude/p1-12-plan`, `claude/plan-pr-b-delivery-approval` | Keep as planning references; close gaps against the current SPEC/requirements before implementation. |
| `antigravity-branch` | Preserve migration-application evidence and inspect its script. Do not execute or adopt the hard-coded project ref `jlanskjgpuyycarwjafn`. |
| `claude/root-readme`, `swarm-p108-author-94cd5daf`, `swarm-p109-author-2e9000ff`, `swarm-p112-author-c502b273` | Same README work; retain one canonical copy, archive duplicate refs only after checking no unique commits remain. |
| `clean` | Overlaps the no-bag-count work; do not merge independently. |
| `claude/continue-2dd666`, `claude/kiran-dms-remaining-items-636d01` | Duplicate-looking refs at `dda9074`; verify whether commits are empty/redundant before archiving. |
| `backup/*` branches | Preserve as backups; never merge them as feature branches. |
| Old stacked PR branches (including earlier P1 slices) | Do not merge solely because Git reports them as unmerged-by-ancestry. Check PR history and content equivalence first. |
| `claude/hermes-closeout`, `claude/hermes-handoff`, `claude/gifted-mestorf-be2a40`, `claude/timeline-coverage`, `codex/align-plans-with-expanded-scope` | Selectively compare against current main and PR #116; do not merge wholesale. |

**Important:** “Not merged by ancestry” does not mean the feature is missing. Several old branches are squash-merged, stacked PR bases, backups, or duplicated by newer work.

## 6. Decisions and safety constraints to retain

1. Owner is the highest authority. Manager executes operations within Owner-delegated permissions. Reconcile D-62 (Manager can add/change product groups/default cycles) against that governance rule without silently reversing the recorded decision.
2. Sales Rep and Salon Client submissions are requests, not official orders. Manager/Owner review and officialize them through the same canonical order workflow.
3. Maintain one stock-movement ledger and one authoritative product/SKU catalogue.
4. Salon/rep/customer-facing stock availability is only Available or Sold Out. Do not leak quantity, supplier data or costs.
5. Supplier vault data remains separately permissioned.
6. Do not send email/WhatsApp reminders until a provider and sender are configured (B-61). In-app reminders can be developed independently.
7. Do not run or deploy migrations until the current Supabase project is confirmed and its migration history/backup is checked. Historical scripts/branches contain conflicting project refs: `iurvazdyxzlspegygldo`, `nwxidylbfeciungrqdkm`, and `jlanskjgpuyycarwjafn`.

## 7. Immediate integration sequence

1. Keep this worktree based on current `origin/main`; never rebase or reset the original `K` checkout.
2. Bring PR #114 into this worktree as a candidate and rerun its browser/type/database checks.
3. Reconcile PR #115 decisions, especially D-62/B-62/B-61, against the latest Owner role direction; do not lose decision provenance.
4. Salvage PR #112 in separate, attributable commits: no-bag-count feature first; then backup manifest and CI gating only after their tests pass. Exclude all stale branch history, gitlinks and unverified Supabase project refs.
5. Port donor storefront/auth/availability code path-by-path, preserving the DMS schema/API and lockfile conventions.
6. Run typecheck, lint, unit tests, migrations/RLS tests and browser/e2e tests. Record exact commands and results in the repository log.
7. Only after the integration is reviewed should a PR be proposed against `main`. No branch deletion, remote push, PR merge/close, or hosted migration is part of this local audit.

## 8. Audit boundary

This document records findings and a safe integration plan. It does not claim every historical branch has had a full code review, and it does not claim any candidate feature has passed a fresh test run on current main. The remote PR statuses and refs were read; the original local `K` checkout remains clean.

## 9. Actions completed in the integration worktree

- Created branch `integration/single-repo-consolidation` from `origin/main` and worktree `K\.worktrees\single-repo-consolidation`.
- Merged PR #114 locally as merge commit `89f4cc8`; no remote merge or push occurred.
- Merged PR #115 locally as merge commit `7a1be67`; no remote merge or push occurred.
- Rechecked latest GitHub checks for both PR heads: all substantive CI checks passed; CodeRabbit was skipped.
- `git diff --check` passed after the local merges.
- `node scripts/activity-log-check.mjs` passed: 2 new log entries, 17 changed files. The optional `KIRAN_SENSITIVE_TERMS` setting is empty, so the script checked 0 owner-specific terms.
- The no-bag-count change was applied only as a temporary review candidate and then reverted from this branch. The local feature branch in `K` and the GitHub PR were not changed. Current specifications still require bag count/daily close, so do not adopt the code until the user resolves that business-rule conflict.
- Local dependency installation has not been run; this worktree has no `node_modules`. Docker is not installed/available in the connected Windows shell, so local Supabase, migration/RLS and stack browser tests cannot currently run. Do not report those suites as passing locally.

The integration branch is intentionally not pushed. The original `K` checkout remains clean on its prior feature branch.
