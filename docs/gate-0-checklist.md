# Gate 0 checklist — Phase 0 exit (for MJ)

Status as of 2026-10-25, staging project `iurvazdyxzlspegygldo` ("Supabase Kiran"). Gate 0 is signed only by MJ (ACTIVITY §8). The exit criteria come from `docs/11-roadmap.md`. The independent end-to-end check of the same day is in `docs/test-report-2026-10-25.md`.

## Your human-only actions, in order

| # | Action | Why | Done when |
|---|---|---|---|
| 1 | **Expose schemas `app` and `vault_api` on staging** (F-2, B-18): Project Settings → Data API → Exposed schemas → add `app` and `vault_api`. **Keep `control` and `supplier_vault` unexposed.** | Login and device registration call `app.*`; today every such call gets 406 "Invalid schema: app" | `pnpm staging:smoke` prints "All checks passed" (see below) |
| 2 | **Auth settings on staging:** Authentication → Sign In / Providers: turn sign-up off (email and phone). Authentication → Multi-Factor: enable TOTP. Authentication → Passwords: minimum 12 characters, leaked-password protection on. | H-15 (the owner creates every account); SEC-02 (mandatory TOTP); doc 06 §3 | `/auth/v1/settings` shows `disable_signup: true` |
| 3 | **Create the owner account and TOTP** by following `docs/runbooks/owner-bootstrap.md` (Auth → Add user; then `select app.bootstrap_owner('<uuid>', '<name>');` in the SQL editor; sign in at `/office/login`; enrol TOTP; keep the recovery codes offline). | ACTIVITY §10: human-only; Gate 0 criterion 1 | You reach `/office` after the 6-digit code |
| 4 | **Branch protection on `main`** (B-13): require `activity-log-check`, `db-tests` and `typecheck`, plus one reviewer who is not the author. | Makes the protocol binding, not advisory | Settings → Branches shows the rule |
| 5 | **Add the `KIRAN_SENSITIVE_TERMS` Actions secret** (B-15a), with supplier identifiers one per line. | The real control that keeps supplier names out of the repo | Secret listed under Settings → Secrets → Actions |
| 6 | **Answer the open decisions** in ACTIVITY §14: D-08 / B-01 (governance split), B-02 (Excel file), B-03 (owner identity, second owner), B-04 to B-11, B-14 (rep access to lists), B-16b (pending-device cap), B-17 (TRUNCATE guards; suspended maker), B-19 (F-3 visibility). | Phase 0 decisions must be logged before Gate 0 | Each has a DECISION entry |

**Never forget item 1 again:** `supabase/config.toml` lists `app` and `vault_api` under `[api] schemas`, but that file configures only the local CLI stack. Every hosted project (staging now, production later) needs the same two schemas exposed by hand in the dashboard. Run `pnpm staging:smoke` after any project is created or restored.

## Checking staging (read-only)

```bash
KIRAN_STAGING_URL=https://iurvazdyxzlspegygldo.supabase.co KIRAN_STAGING_ANON_KEY=<anon or publishable key> pnpm staging:smoke
```

It uses only the public anon key, never prints it, and writes nothing. It passes only when `app.my_session` and `app.register_device` are reachable (an auth refusal counts as reachable), `control` and `supplier_vault` answer 406, and an anonymous read of `user_profile` is refused. Result on 2026-10-25: the two `app` checks fail with 406 (item 1 not done yet); the other three pass.

## Exit criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Owner and manager can log in with MFA to an empty office app | **Not yet.** Screens built; gating correct when signed out. Needs actions 1–3 |
| 2 | Excel import dry-run shows clean data | **Blocked** (B-02): needs your Excel file and the P1-02 salon tables |
| 3 | Phase 0 decisions logged | **Partly.** Logged: stack, staging (L-0019), verifier independence (L-0029), config defaults (L-0024, unconfirmed), B-16a (L-0040). Open: action 6 |
| 4 | ACTIVITY enforcement active in CI | **Yes**, except branch protection (action 4) and the term list (action 5). Latest CI on this branch is green |

Tasks: P0-06 VERIFIED, P0-08 VERIFIED; P1-01 and P0-09 DONE (self-reported), awaiting re-verification by a different agent; P0-04 and P0-05 IN PROGRESS (need actions 1–3); P0-01, P0-02, P0-03, P0-07 need you.

## After Gate 0

Phase 1 starts with P1-02 (territories, salons, stage machine, Excel import) and P1-03 (rep map), per ACTIVITY §12.1. Nothing from P1-02 on has been started.
