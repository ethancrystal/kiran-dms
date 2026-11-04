# Gate 0 checklist — Phase 0 exit (for MJ)

Gate 0 is signed only by MJ (ACTIVITY §8). The exit criteria come from `docs/11-roadmap.md`. This page states what each action and criterion is, not whether it is done: task status is only on the ACTIVITY §12 board, and open decisions are in ACTIVITY §14. Staging project: `iurvazdyxzlspegygldo` ("Supabase Kiran").

## Your human-only actions, in order

| # | Action | Why | Done when |
|---|---|---|---|
| 1 | **Expose schemas `app` and `vault_api` on staging** (F-2, B-18): Project Settings → Data API → Exposed schemas → add `app` and `vault_api`. **Keep `control` and `supplier_vault` unexposed.** | Login and device registration call `app.*`; without this every such call gets 406 "Invalid schema: app" | `pnpm staging:smoke` prints "All checks passed" (see below) |
| 2 | **Auth settings on staging:** Authentication → Sign In / Providers: turn sign-up off (email and phone; D-39's invitations later need email sign-up on for the email code, which MJ turns on when going live, spec section 8). Authentication → Multi-Factor: enable TOTP. Authentication → Emails → Magic Link template: include `{{ .Token }}` so reps receive their 6-digit sign-in code (rep sign-in is by email code, ACTIVITY L-0101). Authentication → Passwords: minimum 12 characters, leaked-password protection on. | H-15 (the owner creates every account until D-39's invitations ship); SEC-02 (mandatory TOTP); doc 06 §3 | `/auth/v1/settings` shows `disable_signup: true` |
| 3 | **Create the owner account and TOTP** by following `docs/runbooks/owner-bootstrap.md` (Auth → Add user; then `select app.bootstrap_owner('<uuid>', '<name>');` in the SQL editor; sign in at `/office/login`; enrol TOTP; keep the recovery codes offline). | ACTIVITY §10: human-only; Gate 0 criterion 1 | You reach `/office` after the 6-digit code |
| 4 | **Branch protection on `main`** (B-13): require the five CI checks by their exact names (ACTIVITY L-0175): `activity-log-check (ACTIVITY.md Appendix C)`, `migrations + RLS matrix (local Supabase stack)`, `typecheck + service-role scan`, `lint + format (Biome)`, `rep PWA browser tests (Playwright)`. No approving review by a second person is required: MJ's OK in chat for each pull request is the merge approval (ACTIVITY section 10, MJ L-0401). | Makes the protocol binding, not advisory | Settings → Branches shows the rule |
| 5 | **Add the `KIRAN_SENSITIVE_TERMS` Actions secret** (B-15a), with supplier identifiers one per line. | The real control that keeps supplier names out of the repo | Secret listed under Settings → Secrets → Actions |
| 6 | **Answer the open decisions** in ACTIVITY §14: D-08 / B-01 (governance split; answered 2026-11-02, ACTIVITY L-0231), B-02 (Excel file), B-03 (owner identity, second owner), B-04 to B-11, B-14 (rep access to lists), B-16b (pending-device cap), B-17 (TRUNCATE guards; suspended maker), B-19 (F-3 visibility). | Phase 0 decisions must be logged before Gate 0 | Each has a DECISION entry |
| 7 | **Run the Excel dry-run on your file** (B-02, P0-02): keep the file outside the repo folder and run `pnpm -C packages/import dry-run "<path to your file>"`, following `docs/runbooks/excel-import-dry-run.md`. Fix the rows it lists until it prints "Result: CLEAN". | Gate 0 criterion 2; the area list it prints feeds the territory draft (P0-03). Real salon data must never enter the repo (H-03), so only you can run it | It exits 0 with "Result: CLEAN"; you log the summary lines (not the file) in the task's log entry |

**Never forget item 1 again:** `supabase/config.toml` lists `app` and `vault_api` under `[api] schemas`, but that file configures only the local CLI stack. Every hosted project (staging now, production later) needs the same two schemas exposed by hand in the dashboard. Run `pnpm staging:smoke` after any project is created or restored.

## Checking staging (read-only)

```bash
KIRAN_STAGING_URL=https://iurvazdyxzlspegygldo.supabase.co KIRAN_STAGING_ANON_KEY=<anon or publishable key> pnpm staging:smoke
```

It uses only the public anon key, never prints it, and writes nothing. It passes only when `app.my_session` and `app.register_device` are reachable (an auth refusal counts as reachable), `control` and `supplier_vault` answer 406, and an anonymous read of `user_profile` is refused.

## Exit criteria

| # | Criterion | Needs |
|---|---|---|
| 1 | Owner and manager can log in with MFA to an empty office app | Actions 1 to 3 on the staging web app (Vercel project `kiran-dms`, production from `main`). Rep sign-in by email code (L-0101) also needs the Magic Link template change in action 2 |
| 2 | Excel import dry-run shows clean data | The dry-run tool (P0-02) and your Excel file, run on your machine (action 7) |
| 3 | Phase 0 decisions logged | Action 6 |
| 4 | ACTIVITY enforcement active in CI | CI plus branch protection (action 4) and the term list (action 5) |

## After Gate 0

Phase 1 building started before Gate 0 on MJ's decision (D-20); the live status is ACTIVITY §12.
