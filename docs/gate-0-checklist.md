# Gate 0 checklist — Phase 0 exit (for MJ)

Status as of 2026-10-25, staging project `iurvazdyxzlspegygldo` ("Supabase Kiran"). Gate 0 is signed only by MJ (ACTIVITY §8). The exit criteria come from `docs/11-roadmap.md`. Each line below says whether it is done and who does what is left.

## Exit criteria

| # | Criterion | Status | What is left, and who |
|---|---|---|---|
| 1 | Owner and manager can log in with MFA to an empty office app | **Not yet.** The office screens (`/office/login`, `/office/mfa`, `/office`) are built and gate correctly when signed out. They cannot work against staging until the dashboard settings below are made. | MJ: dashboard settings A1–A4, then owner bootstrap B1–B3, then sign in once with TOTP |
| 2 | Excel import dry-run shows clean data | **Blocked** (B-02). The importer needs the salon tables from P1-02 and your Excel file. | MJ: share the Excel file (OQ-01). The dry-run is built in P1-02. |
| 3 | Phase 0 decisions logged | **Partly.** Logged: stack, staging project (L-0019), verifier independence (L-0029), config defaults (L-0024, unconfirmed). Open: B-01 (D-08 governance split), B-03 (owner identity), B-04 to B-11, B-14, B-15a, B-16. | MJ: answer the open items in ACTIVITY §14 |
| 4 | ACTIVITY enforcement active in CI | **Mostly.** `activity-log-check`, `db-tests` and `typecheck` run on every PR. `db-tests` is red only on the verifier tests in B-16. | MJ: branch protection on `main` (C1), the `KIRAN_SENSITIVE_TERMS` secret (C2), and the B-16 decision |

Tasks: P0-04 IN PROGRESS, P0-05 IN PROGRESS, P0-06 VERIFIED, P0-08 VERIFIED, P0-09 DONE (self-reported; awaiting re-verification), P1-01 DONE (self-reported; awaiting re-verification). P0-01, P0-02, P0-03 and P0-07 need MJ.

## A. Supabase dashboard settings (staging) — MJ

Checked from outside on 2026-10-25: sign-up is open and schema `app` is not exposed. The Supabase tools available to the agent cannot change auth or API settings.

1. **Settings → API → Exposed schemas:** add `app` and `vault_api`. Today every `app.*` call returns "Invalid schema: app".
2. **Authentication → Sign In / Providers:** turn off "Allow new users to sign up" for email and phone. Today `disable_signup` is `false`. The impact is limited, because a login without an owner-created profile sees nothing, but it breaks H-15.
3. **Authentication → Multi-Factor:** enable TOTP.
4. **Authentication → Passwords:** minimum length 12, leaked-password protection on.
5. Later, for reps: **Authentication → Phone** with the SMS provider (B-08).

## B. Owner account — MJ only (ACTIVITY §10)

Follow `docs/runbooks/owner-bootstrap.md`:

1. Auth → Users → Add user (owner email, password of 12+ characters, auto-confirm).
2. SQL editor: `select app.bootstrap_owner('<uuid>', '<name>');`
3. Sign in at `/office/login`, enrol TOTP, and keep the recovery codes offline.

Running the app locally against staging: `apps/web/.env.local` already points at staging with the publishable key (git-ignored). Start it with `pnpm -C apps/web dev`.

## C. GitHub — MJ

1. Settings → Branches → protect `main`: require `activity-log-check`, `db-tests` and `typecheck`, plus one reviewer who is not the author.
2. Settings → Secrets → Actions: add `KIRAN_SENSITIVE_TERMS`, with supplier identifiers one per line.

## D. Decisions waiting on MJ (ACTIVITY §14)

- **B-16:** three verifier tests encode behaviour the fixes deliberately removed (L-0034, L-0039). Approve replacing their stale assertions, or name another approach.
- **B-14:** how reps receive plan lists and taxonomies.
- **B-01 to B-11:** governance split, owner identity, packaging, installment shape and credit limits, bank accounts, phones and SIMs, WhatsApp/SMS, pilot territory, catalogue.

## After Gate 0

Phase 1 starts with P1-02 (territories, salons, stage machine, Excel import) and P1-03 (rep map), per ACTIVITY §12.1.
