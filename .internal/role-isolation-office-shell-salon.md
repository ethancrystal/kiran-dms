# Role isolation trace — what a salon session sees on GET /office, and the "office home: … read failed" log spam

Date: 2026-11-21 · Investigator: AutoClaw research agent · READ-ONLY task (no repo edits except this file)
Repo: C:\Users\moizjmj\K · **Actual checkout state: branch `fix/roles-coverage-salon-refusal` at HEAD 4b79237** — three commits ahead of the batch-stated 0b4955b (0b4955b → 675e768 → eb8cc29 → 4b79237). The app code is identical to 0b4955b across those commits (spec + docs/log + railway docs only), so every code citation below holds for the CI-failing head too.

---

## Bottom line

A salon-authenticated session **never reaches the office shell**. The Next.js proxy (middleware) redirects any signed-in AAL1 session from `/office` to `/office/mfa` before the `(shell)` layout runs; the MFA page then shows AUTH-06's refusal — *"This is a salon's login. The office is for the owner and managers; your account is in the salon portal."* — which does not match the failing test's regex `/not authorised|no access|sign in/i`. Every string on /office that *would* match that regex lives behind gates the salon session cannot pass. The five `office home: … read failed` console lines are logged only by the office home page (`(shell)/page.tsx:70-77`) when one of its five `app.*` RPC reads errors; they fire only for owner/manager-at-AAL2 renders (provably *not* authorization failures, and never the salon session). **The app is correct; the test expectation was the defect, already fixed in commit 675e768** (spec now asserts "This is a salon's login" on both surfaces). Overall confidence: **high** for the guard chain, render paths and regex diagnosis (all first-hand code + repo log); **medium** for the spam's precise runtime cause (error bodies live only in the CI log).

---

## 1. The guard decision chain for GET /office, and what a salon session passes

Four gates in order; a salon session passes only the first and is refused at the second:

**Gate 1 — proxy (middleware), `apps/web/proxy.ts:40-43`** (matcher `/office/:path*`, proxy.ts:52-54):

```ts
if (path.startsWith("/office") && path !== "/office/login") {
  if (!user) return redirect("/office/login");
  const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (data?.currentLevel !== "aal2" && path !== "/office/mfa") return redirect("/office/mfa");
}
```

- The salon session (created by self-signup approval, signed in by 6-digit **email code**, no TOTP factor enrolled) has a valid user, so the `!user` branch is skipped.
- `getAuthenticatorAssuranceLevel()` returns `currentLevel: "aal1"` for an email-OTP session with no MFA factors (gotrue-js derives this from the access token's `aal` claim). Corroborated by the repo's own CI evidence: the fix commit's log entry calls the MFA page "where the proxy sends an AAL1 session" (docs/log/2026-11-21-roles-coverage-salon-refusal.md).
- Result: **HTTP redirect to `/office/mfa`. `(shell)/layout.tsx` and the home page never run for this request.**

**Gate 2 — the office MFA page, `apps/web/app/office/mfa/page.tsx` (client component, outside `(shell)`)**:
- Client-side aal check: not aal2 → continues (line ~27).
- Calls `app.my_session`: the function selects from `public.user_profile` where `p.id = auth.uid()` (migration 20261105230000_audit_fixes.sql:143-153). A salon login has **no user_profile row** → returns NULL, no error.
- Role is not `rep`; `!me.error && !me.data` is true → calls `app.salon_me` (migration 20261105100000_invitations_salon_approval.sql:884), which returns the salon membership created by the self-signup approval → renders the "elsewhere" card (mfa/page.tsx:41-49, 93-100):

  > **"This is a salon's login. The office is for the owner and managers; your account is in the salon portal."** + link **"Open the salon portal"** → `/salon`

- This is the documented AUTH-06 behavior: "The office MFA page enrols no authenticator for a rep's or a salon's login (audit AUTH-06)" — docs/06-security-plan.md:74. No TOTP enrolment is offered; no office content renders.

**Gate 3 — the shell layout, `apps/web/app/office/(shell)/layout.tsx` (unreachable for the salon session, cited for completeness):**
- layout.tsx:17 `if (!user) redirect("/office/login")`
- layout.tsx:19 `if (current !== "aal2") redirect("/office/mfa")` — a second, independent AAL2 gate
- layout.tsx:21-26 reads `user_profile (full_name, role, status)` via RLS, `.maybeSingle()`
- layout.tsx:41 `const office = profile && (role === "owner" || role === "manager") && status === "active"`
- layout.tsx:42-55 — not office → card: **"This login has no active owner or manager profile. Ask the owner to add you."** + `Your sign-in code: <code>{user.id}</code>` + SignOut. **No redirect** — the card replaces `children`.
- Children (the home page) render only at layout.tsx:57-68, after all three checks pass.

**Gate 4 — the database.** Every office read/write re-decides in the DB (see §2). The layout's own comment (layout.tsx:9-10) calls the shell "convenience: every read and write below is decided again by RLS and the app.\* functions".

**What a salon session passes:** gate 1's user check only. It is redirected at the AAL2 check and ends on `/office/mfa` with the AUTH-06 card. It never renders office content; it never invokes an office RPC from /office.

**Same chain on /app (the block's first assertion):** proxy.ts:45 requires only a signed-in user → passes; `/app` itself is in the layout's `UNGATED` set (apps/web/app/app/layout.tsx:10), so apps/web/app/app/page.tsx runs: `my_session` → NULL → `salon_me` → data → state `"salon"` → card **"This is a salon's login, not a rep's. Your account is in the salon portal."** (AUTH-07, page.tsx ~66-74). No rep content.

---

## 2. Which server reads execute for the salon session, and why the office reads fail (when they fail)

**For the salon session on GET /office:** zero office home reads execute (proxy redirect). The reads that DO execute are the two client-side RPCs on `/office/mfa` — `app.my_session` (returns NULL, no error) and `app.salon_me` (returns the membership) — both succeed.

**The five spamming reads** (office home, `apps/web/app/office/(shell)/page.tsx:43-57`, one `Promise.all`): `app.office_overview_counts`, `app.office_overview_rows`, `app.office_cash_cap_reps`, `app.office_pending_approvals`, `app.office_pending_stock` (plus six RLS table head-counts: stock_issue, rep_day, device, user_profile, territory, salon, and `app.my_session`).

**Why they error when they do** — all five are `security definer`, granted to `authenticated`, and begin with `perform app.assert_office()`:
- `app.assert_office` — 20261024223304_foundation.sql:249-257
- `app.assert_actor_ready` — foundation.sql:235-253: raises **42501 "no active user profile for this session"** when `app.user_role()` (foundation.sql:162-166: `select p.role from user_profile p where p.id = auth.uid() and p.status = 'active'`) is NULL — the salon/newcomer case; raises **42501 "office actions require an MFA-verified (AAL2) session"** when `app.is_aal2()` (foundation.sql:168-170: `coalesce(auth.jwt() ->> 'aal', '') = 'aal2'`) is false for owner/manager.
- A salon session calling any of the five would get 42501 "no active user profile for this session" — **but it never calls them**, because the proxy prevents the home from rendering for AAL1 sessions.
- Grants verified intact: `revoke … from public, anon, authenticated, service_role; grant execute … to authenticated` for all five (20261105230000_audit_fixes.sql:1648-1682; 20261105170000_office_pending_approvals.sql:57-58; pending stock recreated 20261106030000_pending_stock_newest_request.sql:19-67). No migration after 2026-11-05 drops or re-grants any of the five (checked through 20261121130000_catalogue_availability.sql).

---

## 3. What the page renders on read failure (exact text/components)

Only reachable by an owner/manager-at-AAL2 session. `apps/web/app/office/(shell)/page.tsx`:

- line 20: `LOAD_FAILED = "Some figures could not be loaded (shown as —). Reload the page; if it persists, sign in again."`
- lines 78-82: `failed` = counts row missing OR any of rows/cap/approvals/goods errored OR any of the six head-counts NULL.
- lines 92-95: `<p className="error" role="alert">{LOAD_FAILED}</p>` — the only failure UI.
- With `c` null: no `home-summary` list; the "Needs your attention" card renders an **empty** `<ul className="plain">` (every item is gated on `c` or on a null count); the three order sections render their empty-state muted lines ("No orders this week yet. …", "Nothing is waiting to be delivered.", "Nothing delivered yet. …"); the four tiles render **"—"** (`show()`, lines ~84, ~320-345).
- The six table head-counts have no console.error of their own but set `failed` via the null checks.
- Note: LOAD_FAILED contains "sign in again" — it **would** satisfy the old regex — but only an office-eligible session ever renders it.

---

## 4. Where 'not authorised' / 'no access' / 'Sign in' could come from on /office — and why none appears

| Candidate text | Location | Reached by salon session? | Matches old regex? |
|---|---|---|---|
| "This login has no active owner or manager profile. Ask the owner to add you." | layout.tsx:48 | **No** — requires reaching the layout at AAL2 without an office profile; proxy redirects at AAL1 first (proxy.ts:43) | No ("no active owner" ≠ "no access") |
| "Your sign-in code: …" | layout.tsx:50 | No (same card) | No — "sign-in" is hyphenated, regex has a space |
| "Your profile could not be loaded. Reload the page; if it persists, **sign in** again." | layout.tsx:~31 | No — needs a user_profile **read error** at AAL2 (an error path, not the salon flow) | **Yes** — the one matching string on the shell |
| "Some figures could not be loaded … **sign in** again." | page.tsx:20 → 94 | No — owner/manager AAL2 renders only | **Yes** |
| "Office sign-in" / "Sign-in failed. …" | office/login/page.tsx | No — signed-out visitors only (proxy.ts:41) | No — hyphenated |
| "**This is a salon's login.** The office is for the owner and managers; your account is in the salon portal." | mfa/page.tsx:46 | **Yes — this is what it sees** | **No** — "login", never "sign in" |
| "Could not load your authenticator settings. Sign in again." | mfa/page.tsx error path | No — the salon branch returns before `listFactors` (mfa/page.tsx:41-49) | Yes, but unreachable |

**Why the refusal text does not appear:** the isolation is enforced (proxy AAL2 gate → AUTH-06 card → DB refusals behind it), but the only refusal wording the salon session receives is AUTH-06's, which the old regex never matched. The regex was "written against an imagined wording" (675e768 commit message).

---

## 5. The server log spam — evidence-graded

- **VERIFIED — source & trigger.** The five strings exist only in `(shell)/page.tsx:70,71,74,76,77` (`console.error("office home: … read failed", <PostgREST error>)`), firing iff the home Server Component renders and ≥1 of the five RPCs returns an error. Non-fatal by design: `failed=true` → LOAD_FAILED banner + "—" tiles; the tests asserting home content pass on loads where reads succeed.
- **VERIFIED — it is not the salon session.** The salon session is proxy-redirected before the shell renders; no profile-less session can render children (proxy + layout both gate AAL2, then role). It also cannot be a rep (rep hits the AUTH-06 rep-branch on /office/mfa, never the shell).
- **PROVEN — not an authorization refusal of the rendering session.** The layout's `assurance()` decodes the same request cookie JWT that the page's `supabaseServer()` sends as the RPC `Authorization` bearer (same request-scoped cookie store; both call the same helper, lib/supabase/server.ts). If the layout passed, `auth.jwt() ->> 'aal'` is 'aal2' and the profile is owner/manager-active — so `assert_actor_ready`'s two 42501 branches cannot fire for the same render that produced the spam. (A token expiring mid-render is also excluded: an expired token makes the proxy's `getUser()` refresh it before the render, or fail it to `/office/login`.)
- **VERIFIED — CI observation** (docs/log/2026-11-21-roles-coverage-salon-refusal.md, evidence bullet): the five lines appear "on some home loads even in runs whose office tests pass, **including the owner's first home load right after sign-in in a passing test**".
- **HYPOTHESIS (repo log entry, unverified):** "a first-load cookie handoff after sign-in rather than a permission problem"; pinning it "needs the local stack this Windows host cannot run (no Docker)".
- **HYPOTHESIS (this investigation, same evidence level):** transient PostgREST/pool/connection errors on the home's 12-concurrent-call burst (5 RPCs + 6 head-counts in one `Promise.all`) against a cold pool on the first load after sign-in — consistent with first-load-only, self-healing, all-five-at-once behavior. **Neither hypothesis is proven; the PostgREST error bodies (the `{…}` in the CI log) would settle it.** Explicitly *excluded* by the proof above: any 42501 AAL/role refusal, and any salon-session origin.
- **Also verified:** the spam is unrelated to the failing assertion — the role-isolation failure is purely the regex; the salon session ends on /office/mfa and never renders the home.

---

## 6. Fix state and CI facts (from the repo's own log, docs/log/2026-11-21-roles-coverage-salon-refusal.md)

- Failing runs: CI 44920176444 (head 77b34f8), 44921012338, 44921022937 (dependabot heads) — office browser job, "element(s) not found" at `getByText(/not authorised or no access or sign in/i)`, 49 other office tests passing.
- **Fix committed:** 675e768 "test(e2e): the role-isolation journey asserts the documented salon refusal" — spec lines 250-258 now assert `/This is a salon's login/` on both /app and /office; no app code changes. Present in this checkout (HEAD 4b79237).
- Earlier history of the same journey: it originally failed on a shared seeded salon (fixture defect), fixed by 77b34f8 (PR 118) — then the moved-to-last-block regex failure surfaced.

## 7. Evidence tiers

- **First-hand code (highest):** proxy.ts; (shell)/layout.tsx + page.tsx; mfa/page.tsx; app/page.tsx + app/layout.tsx; lib/supabase/server.ts + browser.ts; migrations foundation/audit_fixes/invitations/office_pending_approvals/overviews/pending_stock; office.spec.ts + overviews.spec.ts (other /office visitors).
- **Repo documentation (official):** docs/06-security-plan.md:74 (AUTH-06); docs/log/2026-11-21-roles-coverage-salon-refusal.md (CI runs, diagnosis, spam observation); git commits 675e768, 77b34f8.
- **Inference (labeled):** both spam-mechanism hypotheses in §5.
- **Not available:** CI log error bodies for the five reads; a live stack run (no Docker on this host, per the repo log — this task is also read-only by instruction).
