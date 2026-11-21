# Role isolation trace — what a salon-authenticated session sees on GET /app (Kiran DMS)

Task: trace the guard chain for GET /app (rep PWA) for a salon session (self-signup approved, salon membership, signed in by email code) and explain why the Playwright regex `/not authorised|no access|sign in/i` found nothing on both /app and /office.

**Repo state note (important).** I worked read-only on `main`. At trace start HEAD was `0b4955b`; during the trace a concurrent commit **`675e768`** ("test(e2e): the role-isolation journey asserts the documented salon refusal", 2026-11-21 22:10 +05) landed from another batch task. It changed **only** `apps/web/e2e-stack/roles-coverage.spec.ts`, `docs/log/2026-11-21-roles-coverage-salon-refusal.md`, and `railway.toml` (git show --stat 675e768) — **no app code in the /app or /office guard chain changed**. Before that commit I had read the old spec block directly (old regex at lines 252/254 of `0b4955b`), so both versions are documented below from direct observation. Uncommitted edits by other agents (`.env.example`, `docs/deploy/railway-kiran-dms.md`, untracked files) were left untouched. I changed nothing except this file.

---

## 1. The guard chain in order — every session/role decision point and its wrong-role behavior

### 1.1 `apps/web/proxy.ts` (Next.js 16 proxy = middleware; matcher `["/office/:path*", "/app/:path*", "/salon/:path*", "/invite/:path*"]` — proxy.ts:53)

- **D1 (the only /app gate).** proxy.ts:45:
  `if (path.startsWith("/app") && path !== "/app/login" && !user) return redirect("/app/login");`
  It checks **authentication only** (`sb.auth.getUser()`). No role check, no device check, no AAL check on `/app`. The header comment (proxy.ts:9-17) states this deliberately: device approval is enforced by the database on every call (`app.rep_device_ok`), "not here"; the control is RLS and `app.*` functions.
  **Wrong-role (salon) behavior: passes through.** A salon session has a valid user → no redirect → the `/app` page renders.
- **Contrast, /office.** proxy.ts:40-43: `/office/*` except `/office/login` requires a user **and** `mfa.getAuthenticatorAssuranceLevel().currentLevel === "aal2"`. A salon's email-code session is AAL1 → `302 redirect("/office/mfa")` (the `path !== "/office/mfa"` guard makes the MFA page itself reachable). **The salon session never renders the office home.**
- **Contrast, /salon.** proxy.ts:47-49: signed-in user only; membership is the database's job (`app.salon_me`).

### 1.2 `apps/web/app/app/layout.tsx` (client wrapper for `/app/*`)

- **D2.** layout.tsx:11 `const UNGATED = new Set(["/app", "/app/login"])`; :39 `const open = UNGATED.has(path)`; :65 `if (open || gate.kind === "ok") return <>{children}</>;`.
  **On GET /app the account gate never runs** — `children` render immediately, before any RPC. The gate's wrong-role messages can therefore never appear on `/app` itself; they apply only to `/app/*` subpages (REP-04, P1-30).
- **D2a (subpages only, for contrast).** `lib/outbox/gate.ts` `verdict()`:
  - gate.ts:55 — salon login (no staff session, `salon_me` truthy) → `{kind:"stop", salon:true, message:"This is a salon's login, not a rep's. Your account is in the salon portal."}`; layout.tsx:82-86 renders that message plus an "Open the salon portal" link.
  - gate.ts:59 — `session.role !== "rep"` → `"These pages are for reps. Owners and managers work in the office."`
  - gate.ts:60-70 — status/device messages ("Your account is not active…", "This phone is waiting for your manager's approval…").
  None of these say "not authorised", "no access" or "Sign in".

### 1.3 `apps/web/app/app/page.tsx` (RepHome, "use client") — the only role-aware step on /app

State machine (`State`, page.tsx:20-26): loading → error | unregistered | salon | ready.

- **D3.** page.tsx:35-36 — `auth.getUser()`; no user → error `"Not signed in."` (unreachable behind the proxy).
- **D4.** page.tsx:37-38 — `app.my_session` RPC. For a salon login it returns **null** (no staff profile; the layout's `ask()` comment, layout.tsx:21-30, confirms the same pairing). RPC error → error `"Could not load your session."` (page.tsx:38).
- **D5 (the salon branch, AUTH-07).** page.tsx:39-41:
  `if (!s0) { // AUTH-07 (P1-30): a salon's login is not "not set up"; it belongs in the salon portal.` then `salon_me`; if `!salon.error && salon.data` → `setState({ kind: "salon" })`.
  **Wrong-role behavior: render in place — no redirect, no error.** The page stays on /app.
- **D6.** page.tsx:42-43 — `salon_me` failed/falsy → `{kind:"unregistered"}` → "Your account is not set up yet. Give this sign-in code to the owner:" + code (page.tsx:79-81). Note this string contains the **hyphenated** "sign-in", which does not match the test's `/sign in/` (space).
- **D7.** page.tsx:45-47 — staff session with `status !== "active"` → "Your account is not active. Contact your manager."
- **D8.** page.tsx:49-56 — `device_status` null/revoked → register/rotate this device (`lib/supabase/browser.ts` `ensureDeviceRegistered`, SEC-03; migration 0006: revoked ids are dead). Device approval, not a role check.
- **D9.** page.tsx:58-60 — `ready` → "Salaam, {full_name}." **Today does not check role for staff sessions**: an owner/manager with a staff profile would get the rep dashboard here. The only client-side rep-only role check lives in the layout gate for subpages (D2a); the database decides everything behind this.

### 1.4 `apps/web/app/app/login/page.tsx`

No session or role check at all — a pure email + 6-digit-code form (`shouldCreateUser: false`). Renders `<h1>Sign in</h1>` (page.tsx:39) and the submit button `"Sign in"` (page.tsx:51). The proxy exempts `/app/login` from its redirect even for signed-in users (proxy.ts:45), so it renders for anyone navigating there directly.

### 1.5 Helpers in `apps/web/lib/supabase` (and the RPC helpers they feed)

- `lib/supabase/browser.ts` — browser client bound to a per-install device id sent as `x-kiran-device` (SEC-03); `deviceId()` / `ensureDeviceRegistered()`. **No session/role decision.**
- `lib/supabase/server.ts` — server client + `assurance()` for Server Components (used by the office RSCs). **Not used in the /app client chain.**
- `lib/rpc.ts` — `rpc()` / `messageOf()` wrappers (the layout's `ask()` uses `rpc("salon_me")`, layout.tsx:30). Passes the database's messages; no decision logic.

## 2. Exact UI text/components the salon session gets on GET /app

Brief `"Loading…"` (state "loading"), then, with no navigation away:

```
<main>
  <h1>Today</h1>
  <div className="card">
    <p className="error" role="alert">
      This is a salon's login, not a rep's. Your account is in the salon portal.   (page.tsx:67)
    </p>
    <p><a className="btn" href="/salon">Open the salon portal</a></p>              (page.tsx:69-73)
  </div>
  <p><RepSignOut /></p>                                                            (page.tsx:144-146)
</main>
```

`RepSignOut` renders `<button>Sign out</button>` initially (components/rep-sign-out.tsx:49-53; busy: "Signing out…"; confirm/discard variants only after a click). The root layout adds only `<html>/<body>` + metadata (apps/web/app/layout.tsx:15-23). If `my_session`/`salon_me` fail, the error state shows `"Could not load your session."` — still no regex match.

## 3. Where 'not authorised', 'no access', 'Sign in' appear in apps/web (git grep over tracked files)

- **'not authorised' / 'not authorized'** — rendered by **no route**. It existed only inside the test's own regex (`roles-coverage.spec.ts` old lines 252/254 at `0b4955b`); after commit `675e768` the only remaining hit is roles-coverage.spec.ts:374 (`/not found|not authorised|no access/i`, journey 2 — primarily expecting "not found"). No app code contains the phrase.
- **'no access'** — same: test file only (line 374). No app code.
- **'sign in' (with space, case-insensitive)** — rendered by these routes only:
  - `/app/login`: h1 + button (app/login/page.tsx:39, 51)
  - `/app/orders` error path (app/orders/page.tsx:54); `/app/outbox` auth states (app/outbox/page.tsx:10, 16); `lib/outbox/access.ts:25-26` (`NOT_SIGNED_IN`, `SIGN_IN_TO_VIEW` — outbox-related views)
  - `/invite/[token]` (app/invite/[token]/page.tsx:86); `components/email-code.tsx:92` ("Sign in" button used by `/salon/signup` and `/invite`); `components/acknowledgement.tsx:76`
  - `/office` home `LOAD_FAILED` (app/office/(shell)/page.tsx:20) and shell-layout profile error (app/office/(shell)/layout.tsx:34); `/office/team` hint (app/office/(shell)/team/page.tsx:173); `/office/mfa` error state only (app/office/mfa/page.tsx:52)
  - `/salon` pending message (app/salon/page.tsx:186); `/salon/login` button (app/salon/login/page.tsx:82); `/salon/signup` link (app/salon/signup/page.tsx:61)
- Hyphenated 'sign-in' ("Office sign-in" app/office/login/page.tsx:27, "Salon sign-in" app/salon/login/page.tsx:25, "sign-in code" app/office/(shell)/layout.tsx:51 and team page, gate copy lib/outbox/gate.ts:31,56) does **not** match the test's `/sign in/` (space).
- **None of these render anywhere in the salon-session path on /app or /office** (see §2 and §4).

## 4. The /office leg of the same journey (old lines 253-254; never reached in the failing run)

- proxy.ts:40-43 sends the AAL1 salon session to `/office/mfa`.
- `app/office/mfa/page.tsx` (AUTH-06, :29): `my_session` null → `salon_me` truthy → step `"elsewhere"` (:44-49) rendering h1 `"Two-step verification"` (:77), the error alert `"This is a salon's login. The office is for the owner and managers; your account is in the salon portal."` (:46), the link `"Open the salon portal"` (:49), and `SignOut` → button `"Sign out"` (app/office/(shell)/sign-out.tsx:20).
- Inference (marked as such — not executed here): under the **old** regex this page also matched nothing, so the second assertion would have failed too; the old run never reached it because the /app assertion failed first.

## 5. Conclusion — what rendered, and why the regex found nothing

1. **On GET /app** the salon session was never redirected and never blocked: the proxy checks authentication only (proxy.ts:45), the layout exempts `/app` from its account gate (layout.tsx:11, 39, 65), and page.tsx's AUTH-07 salon branch renders the refusal in place: **"Today" / "This is a salon's login, not a rep's. Your account is in the salon portal." / "Open the salon portal" / "Sign out"**.
2. **The failing regex was unsatisfiable by construction.** `/not authorised|no access|sign in/i` matches no element of that page: the refusal says "not a rep's" (not "not authorised"), "salon's login" (not "sign in"), and the only sign-related text is the "Sign out" button. `getByText` therefore found no element → `toBeVisible()` failed with "element(s) not found". Git grep proves no route in `apps/web` renders 'not authorised' or 'no access' at all, and no 'sign in' text renders on either surface the journey visits.
3. **The same holds for /office**: the proxy AAL1-redirects to `/office/mfa`, whose AUTH-06 refusal ("This is a salon's login. The office is for the owner and managers…") also contains none of the three phrases.
4. **Already fixed in tree by the concurrent commit `675e768`**: both assertions now expect `/This is a salon's login/` (roles-coverage.spec.ts:255-258) with a comment citing AUTH-06/AUTH-07 and doc 06 — that substring matches both actual refusal texts, isolation intent unchanged, no app code changed. The updated journey should pass.

## 6. The webserver log lines ("office home: counts read failed", …)

All five messages are `console.error` calls in `app/office/(shell)/page.tsx:70-77` (counts, lists, cash cap, approvals, pending stock), emitted only when the **office home RSC actually renders** (`dynamic = "force-dynamic"`, :18) for a session the proxy passed (user + AAL2) and its `office_*` RPC reads fail. The salon session can never render that page (AAL1 → /office/mfa redirect), so **these logs are a separate symptom from elsewhere in the run, not part of the /app path**. Their cause was not investigated (out of scope, unverified).

## 7. Evidence tiers

- **Verified (direct reads + git grep at the working tree; app code identical across `0b4955b` → `675e768`):** every file:line above.
- **Observed during session (transient; superseded by `675e768`):** the old spec block at `0b4955b` — comment at line 250, `goto("/app")`/expect at 251-252, `goto("/office")`/expect at 253-254, regex `/not authorised|no access|sign in/i` — read before the concurrent commit landed. The CI report's "around lines 239-243" refers to a slightly older revision; immaterial to the cause.
- **Inference:** the /office leg would also have failed under the old regex (§4). Not run: no tests, no installs (read-only task).
- **Unknown:** why the office overview RPC reads failed during the run (§6).

## 8. Suggested next steps

1. Re-run the office-stack suite on a tree containing `675e768` to confirm the journey passes end to end (this trace ran no tests).
2. `roles-coverage.spec.ts:374` still offers `/not authorised|no access/` as alternatives — check what that page actually renders (likely a "not found" message) and align if needed.
3. Separately investigate why the office home's `office_*` RPC reads failed during the run (sources: `app/office/(shell)/page.tsx:70-77`).
