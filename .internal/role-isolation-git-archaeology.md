# Git archaeology: role-isolation failure, 2d0f6a4 → 0b4955b

Task: determine (1) whether `apps/web/e2e-stack/roles-coverage.spec.ts` existed at old main 2d0f6a4 (is the failing role-isolation journey brand-new or a regression), and (2) which commits in `2d0f6a4..0b4955b` touched the auth/guard surface and could have changed what a salon session sees on `/app` and `/office`. Read-only git investigation; no repo files were modified by this task.

Confidence legend: **[确定]** = verified against the repository (commands + outputs in evidence); **[高置信]** = strong inference from verified facts; **[待证]** = noted, not verified.

---

## 1. Conclusion summary

1. **The failing test is brand new, not a regression.** [确定] `roles-coverage.spec.ts` does not exist at 2d0f6a4; it was added inside the range on 2026-11-21 (4bff9bf) and amended twice more the same day. No earlier version and no equivalent role-isolation assertion exists anywhere in the old tree. On every main-based head since, the journey fails at its role-isolation block because it expects `/not authorised|no access|sign in/i` — wording the app has **never** rendered at any commit in the range.
2. **The app-side guard surface is unchanged across the whole range.** [确定] `apps/web/proxy.ts`, `apps/web/lib/supabase`, the office login/MFA pages, and the office shell layout + home page have **zero commits** in `2d0f6a4..0b4955b`; the salon refusals on `/app` (`app/app/page.tsx`, AUTH-07) and `/office` (proxy AAL2 redirect → `office/mfa/page.tsx`, AUTH-06) say "This is a salon's login …" identically at both endpoints.
3. **The fix already exists but is not merged.** [确定] 675e768 ("test(e2e): the role-isolation journey asserts the documented salon refusal", child commit of 0b4955b) rewrites the two assertions to `/This is a salon's login/` with **no app code changes**; it sits on branch `fix/roles-coverage-salon-refusal` (pushed to origin, not on main).
4. Bottom line: test-side defect (regex written against imagined wording), not an app regression; the merge range did not change what a salon session sees on `/app` or `/office`.

---

## 2. Findings

### F1 — The spec file is new with the merge range [确定]

- `git ls-tree 2d0f6a4 -- apps/web/e2e-stack/roles-coverage.spec.ts` → **empty output** (file absent at 2d0f6a4).
- `git ls-tree --name-only 2d0f6a4 -- apps/web/e2e-stack/` → only `office.spec.ts`, `overviews.spec.ts`, `p130-screens.spec.ts`, `rep-detail-documents.spec.ts`. At 0b4955b the same dir adds `roles-coverage.spec.ts`.
- `git log --format="%h %ad %s" --date=short --diff-filter=ADR -- apps/web/e2e-stack/roles-coverage.spec.ts` → exactly one Add in all history:
  - **4bff9bf 2026-11-21** "test: one-command e2e-stack runner, WSL Supabase CLI installer, and 4-role coverage spec"
- File's complete history (4 commits, all inside `2d0f6a4..0b4955b`):
  1. **4bff9bf** — added (role-isolation block originally at lines 183/185 with `/not authorised|no access|sign in/i`; per `git grep -n "not authorised" 4bff9bf -- <spec>`)
  2. **45bd4b7 2026-11-21** "fix(tests): align the no-bag, investor and salon-signup journeys with the built screens" — rewrote journey 1 to the real self-signup model (`salon_signup_request`, approval cards) but **kept** the same regex on the new `approved` page object
  3. **2ec2342 2026-11-21** — TOTP factor-reading helper (+12 lines before journey 1; shifts the isolation expects to lines ~241/243 — matching the batch's quoted "around lines 239-243")
  4. **77b34f8 2026-11-21** "fix(ci): … give the salon-proposal journey its own fixture" — replaces the shared seeded pending salon with the journey's own (+11 lines; moves the isolation expects to **252/254**, where they still sit on main 0b4955b, verified by `git grep -n "not authorised" 0b4955b -- <spec>`)
- No precedent in the old tree: `git grep -n -i -e "role isolation" -e "not authorised" -e "no access" 2d0f6a4 -- apps/web/e2e-stack apps/web/e2e` → **empty**. Nothing ever asserted this wording before 4bff9bf.
- 2d0f6a4 and 0b4955b are merge commits; `git merge-base 2d0f6a4 0b4955b` = 2d0f6a4, so the range is well-defined and 2d0f6a4 is an ancestor of 0b4955b.

### F2 — The expected refusal wording never existed in the app at either endpoint [确定]

- `git grep -n -i "not authorised" 0b4955b -- apps/web/app apps/web/components` → **empty**; same at 2d0f6a4 → **empty**. The only "not authorised" occurrences in apps/web at 0b4955b are inside the spec itself (lines 252, 254, 370).
- Where a salon session is actually refused (identical at 2d0f6a4 and 0b4955b):
  - `/app` → proxy lets any signed-in user through (`/app` requires only a user, and the layout's `UNGATED` set contains `/app` itself — `apps/web/app/app/layout.tsx`, both endpoints); the refusal comes from the **page**, not the layout: `apps/web/app/app/page.tsx` — `my_session` returns null → `salon_me` → renders "This is a salon's login, not a rep's. Your account is in the salon portal." with a link to `/salon` (2d0f6a4 lines 63-70; 0b4955b lines 64-71; AUTH-07 comment at 38/39).
  - `/office` → `apps/web/proxy.ts` requires a signed-in user **and AAL2** on `/office/*`; a salon email-OTP session is AAL1, so the proxy redirects to `/office/mfa`, where the MFA page detects a salon login and renders "This is a salon's login. The office is for the owner and managers; your account is in the salon portal." (`apps/web/app/office/mfa/page.tsx:46` at both endpoints; AUTH-06 comment at line 29).
- Neither string matches `/not authorised|no access|sign in/i` (no "sign in" text is rendered in either refusal; the portal link reads "Open the salon portal").

### F3 — Guard-surface commit inventory for 2d0f6a4..0b4955b [确定]

Pathspec logs (`git log --format="%h %ad %s" --date=short 2d0f6a4..0b4955b -- <paths>`):

| Path | Commits in range |
|---|---|
| `apps/web/proxy.ts` | **none** (and `git diff 2d0f6a4 0b4955b --stat -- apps/web/proxy.ts` → empty: byte-identical) |
| `apps/web/lib/supabase` | **none** |
| `apps/web/app/office/login`, `apps/web/app/office/mfa` | **none** |
| `apps/web/app/office/(shell)/layout.tsx`, `(shell)/page.tsx` | **none** |
| `apps/web/lib/rpc.ts` | **none** |
| `apps/web/app/layout.tsx`, `apps/web/lib/office-nav.ts` | none (only components/rep-sign-out.tsx via e09fbfd and office components via 866b366 hit the combined pathspec) |

`apps/web/app/app` (7 + the carrying merge):

- **e09fbfd 2026-11-14** (P1-09) — rewrote the `/app` client-side gate in `apps/web/app/app/layout.tsx`: old inline gate (which had the salon "stop" branch for `/app/*` subpages) replaced by `lib/outbox/gate.decideGate`/`checkAccount`; `my_session` classification moved into `ask()`. `/app` itself stays in `UNGATED` both before and after. Affects what a salon session sees on **/app subpages** only, not on `/app` or `/office`.
- **dce6870 2026-11-14** (P1-09 review fix-up) — gate now asks `my_session` with the held session's own `Authorization` header; sign-out wipes only the signing-out login. Same scope limitation as e09fbfd.
- **3b00fe0 2026-11-20** — "hide office-only links from rep dashboard": removes the Cash handover / My deliveries / My bag links from `apps/web/app/app/page.tsx` (visible only in the `state.kind === "ready"` branch — i.e., for approved reps; a salon session gets the refusal card instead, untouched by this commit).
- **345c547 2026-11-20** (investor), **4dc0233 / e6abe36 2026-11-18** (no-bag rep day) — content changes to the rep surfaces; none touch the salon refusal block (net diff of `app/app/page.tsx` 2d0f6a4↔0b4955b shows only the link hiding, the `RepSignOut` swap for the inline sign-out button, and an import).
- **2e216d5 2026-11-21** — the merge that carries the above plus the e2e-stack tooling.

`apps/web/app/office` (5):

- **866b366 2026-11-19** — new office screens (duplicate phones, opening last purchase, reminder history); **a2ee5f5 2026-11-20** — investor recurring return; **45bd4b7 2026-11-21** — investors/[id] wording + test alignment; merges **2e216d5**, **a9c782e**. None touch the shell guard, login, MFA, or home page.

**fe25c40 2026-11-21** ("feat(web): Next.js 16.4.6 security upgrade") — full file list via `git diff-tree --name-status -r`: only `apps/web/next.config.ts` (adds `experimental: { agentUpgrade: "security" }`), `apps/web/package.json` (`next ^16.2.0` → `^16.4.6`), `pnpm-lock.yaml`. **No proxy, no app code, no lib code.** Its guard relevance is framework-runtime-only (proxy execution, client router). Parent is a9c782e (merge of origin/main into feat/rep-day-no-bag-count); merged to main via 8ebd39e ("Merge worktree/next-upgrade into the consolidated integration line") and 2e216d5.

### F4 — The failing assertion and the existing fix [确定]

- On main 0b4955b the journey's isolation block (roles-coverage.spec.ts:250-258) reads `await expect(approved.getByText(/not authorised|no access|sign in/i)).toBeVisible();` after `goto("/app")` and after `goto("/office")` (lines 252/254; line 370 has a different regex for journey 3's cross-salon invoice denial).
- **675e768** (2026-11-21 22:10 +0500, parent = 0b4955be) "test(e2e): the role-isolation journey asserts the documented salon refusal" — rewrites both expectations to `/This is a salon's login/` and states in its message: "The spec file is new with the consolidation merge and its regex was written against an imagined wording … The journey now asserts the real refusal on both surfaces — the isolation intent is unchanged — and no app code changes."
- Branch topology: `git branch -a --contains 675e768` → `fix/roles-coverage-salon-refusal` and `origin/fix/roles-coverage-salon-refusal` only. `git diff 0b4955b 675e768 --stat` → the spec (10 lines) + new log entry `docs/log/2026-11-21-roles-coverage-salon-refusal.md` + (on later commits eb8cc29/4b79237) railway.toml consolidation.
- The fix's own log entry (in 675e768) independently corroborates: CI run 44920176444 (head 77b34f8) failed exactly this way, as did runs 44921012338 / 44921022937 on the dependabot heads; 49 other office-job tests passed; the earlier failure (shared seeded salon timeout) was fixed by 77b34f8 → PR 118. It also records that `pnpm typecheck`/`pnpm lint` pass on the fix branch and that the office stack itself was not runnable locally (no Docker) — CI on the PR head is the pending proof. Merge gate: CI green + MJ's approval in chat (ACTIVITY.md §10).

### F5 — The "office home: counts read failed …" CI log lines [确定 source / 高置信 attribution]

- The lines are the office home's designed degradation logging: `apps/web/app/office/(shell)/page.tsx:70-77` — `console.error("office home: counts read failed", countsRes.error)` and siblings for the five RPC/table reads, each non-fatal (the page then shows the "Some figures could not be loaded" alert). They do not indicate that the salon session reached office home: the proxy's AAL2 gate (unchanged) redirects a salon session to `/office/mfa` before the shell renders, and the shell layout itself re-checks user + AAL2 + owner/manager profile.
- Attribution to "a first-load cookie handoff after sign-in rather than a permission problem" comes from the fix branch's log entry (675e768), which observed the same lines even in passing runs, including the owner's first home load. That attribution is the author's inference, not machine-verified here. [高置信]

### F6 — Workspace state changed during this batch (observation, not a finding about git history) [确定]

- At task start: HEAD = 0b4955be on `main`, clean tree, synced with origin/main.
- During the batch the checkout moved to `fix/roles-coverage-salon-refusal` (now at 4b79237 "fix: restore railway.toml", with eb8cc29 and 675e768 beneath). Revision-based queries (2d0f6a4, 0b4955b, 675e768) are unaffected; file-content reads of `apps/web/e2e-stack/roles-coverage.spec.ts` after the switch show the **fixed** version, which is why direct reads and 0b4955b-blob greps initially looked contradictory. Anyone continuing in this working copy is on the fix branch, not main.

### F7 — CI run line-number mapping [确定]

- The batch's quoted error location ("around lines 239-243") matches the **2ec2342** snapshot (isolation expects at ~241/243); after 77b34f8 (+11 lines) they sit at 252/254 on main 0b4955b. Same regex, same assertion, same failure at every main-based head since 4bff9bf.

---

## 3. 待证项 (open items)

1. Whether the "counts read failed" first-load pattern is a cookie-handoff race: pin by running the office stack locally and reading the five reads' error payloads on a first load after sign-in (needs the WSL/Docker stack this host lacks — same blocker the fix-branch log entry records).
2. The PR from `fix/roles-coverage-salon-refusal` to main: not yet open/merged at investigation time; its CI run is the outstanding verification of 675e768.

## 4. Suggested next steps

1. Merge path for the fix: open PR `fix/roles-coverage-salon-refusal` → main, get CI green on its head, then MJ's merge approval in chat (ACTIVITY.md §10) — no other commit is needed; the app needs no change.
2. If MJ wants belt-and-braces before merge: cherry-pick-free sanity check = run only journey 1 of roles-coverage on the fix branch against the local stack once it exists.

## 5. Method / commands ledger (all read-only)

`git rev-parse/status/log/ls-tree/merge-base/diff/diff-tree/show/grep` with explicit revisions; `--full-history` and `-S` (pickaxe) used to bypass merge-history simplification when the simplified pathspec log under-reported 675e768. No checkout, no stash, no pnpm, no writes outside this file. docs/ACTIVITY.md head + `docs/log/2026-11-21-autoclaw-consolidation.md` were read per the build protocol; per the batch's explicit read-only constraint ("do not edit or create repo files except your one details file under .internal/"), no `docs/log/` entry was created for this task — recorded here instead.
