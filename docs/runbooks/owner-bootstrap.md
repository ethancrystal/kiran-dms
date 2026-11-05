# Runbook — creating the first owner account (human-only, ACTIVITY §10)

Who: **MJ or the owner, never an agent.** Where: the Supabase dashboard of the Kiran project, and the web deployment's settings.

## Before the first login: configure the hosted project

`supabase/config.toml` configures only the local CLI stack. A hosted project needs its settings made in the dashboard. **Do not use `supabase config push` for this**: the local file holds values that are wrong for a hosted project (for example `site_url = "http://127.0.0.1:3000"` and `email_sent = 2` emails an hour), and pushing it would copy them over (audit AUTH-04).

1. **Settings → API → Exposed schemas:** add `app` and `vault_api` next to `public`. Keep `control` and `supplier_vault` unexposed. Without this, every `app.*` RPC (for example `register_device`) fails.
2. **Authentication → Sign In / Providers:** keep **email sign-up on** and turn **phone (SMS) sign-up off**. Email sign-up must stay on because invitations (D-39) send a 6-digit code to a new address and that first code creates the login; with email sign-up off, no invited rep or salon can ever get a login (audit AUTH-02). A person who signs up without an invitation gets a login that sees and does nothing: every table and function refuses a login with no profile or membership.
3. **Authentication → Multi-Factor:** enable TOTP enrolment and verification. Check that the project's plan includes it.
   **Authentication → Passwords:** minimum length 12 and leaked-password protection on (doc 06 §3).
4. **Authentication → Emails:**
   - **Magic Link template:** reps and salons sign in with an emailed 6-digit code (ACTIVITY L-0101), so the template must contain `{{ .Token }}` (the code), for example "Your Kiran sign-in code is {{ .Token }}".
   - **Confirm email** and the **Confirm signup template** (audit AUTH-03): the local stack runs with confirmations off, and the invitation flow has only been tested that way. Whether the hosted project keeps "Confirm email" on is MJ's decision (ACTIVITY B-47). If it stays on, the Confirm signup template must also contain `{{ .Token }}`, or a brand-new invitee receives a link instead of the code the invitation page asks for. Check this on staging with one real invitation to an address never used before, with MJ's approval.
   - **SMTP:** Supabase's built-in email is rate-limited and meant for testing. Connect your own SMTP before the pilot (Authentication → Emails → SMTP) and set the email rate limit (Authentication → Rate Limits) high enough for every rep, salon and invitee sign-in code of a working day. The local value of 2 an hour is for the test stack only.
5. **The web deployment** (Vercel project `kiran-dms`) needs exactly two environment variables (audit AUTH-17):
   - `NEXT_PUBLIC_SUPABASE_URL`: the project's URL, `https://<project-ref>.supabase.co` (Settings → API).
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the project's anon (public) key, or its publishable key (Settings → API).
   Both are public values: the browser receives them, and the database decides every access. **Never** set the service-role key or any secret key in the web deployment (H-18). If the two variables are missing, the app shows "Supabase is not configured" and cannot sign anyone in.
6. After the migrations are applied, make one authenticated call to an `app.*` RPC through the API (or run `pnpm staging:smoke`, gate-0 checklist). The local test suite cannot check PostgREST schema exposure.

## Creating the owner

1. **Auth → Users → Add user.** Enter the owner's email and a password of at least 12 characters. Tick "Auto confirm".
2. Copy the new user's UUID.
3. **SQL editor** (runs as `postgres`), replacing both values:

   ```sql
   select app.bootstrap_owner('<owner-uuid>', '<Owner full name>');
   ```

   This works exactly once. A second call fails with "an owner already exists".
4. Sign in at `/office/login` and enrol TOTP on the next screen. The page shows a QR code and, under it, the setup key: **write the setup key down and keep it offline**. The app shows no recovery codes; if the phone is lost, follow "Lost authenticator" below.
5. From then on:
   - **Reps and salons** are invited from **People** in the office (the owner or a manager). The invitation link sends a 6-digit code to the invitee's email; no password is involved.
   - **A manager** needs a login first, which the app cannot create (audit H6): in the dashboard, **Auth → Users → Add user** with the manager's email and a password of at least 12 characters, "Auto confirm" ticked. The manager signs in at `/office/login`, enrols TOTP, and the page then shows their sign-in code. The owner opens **Team → Add a person**, pastes the code, and picks the role manager.
6. **A second owner for continuity (OQ-03, B-03): not possible from the app today.** Team offers only rep and manager, and no screen changes a role. Until MJ decides B-03, keep the setup key of the one owner account safe (step 4).

## Lost authenticator (human-only; audit AUTH-11)

The app has no self-service reset: a lost phone locks that owner or manager out of the office until their factor is removed.

1. In the dashboard, **Authentication → Users**, open the person's user and remove their TOTP factor (the dashboard's multi-factor section for that user). Check the exact steps on staging first, with MJ's approval.
2. The person signs in at `/office/login` again and enrols a new authenticator on the next screen.
3. Log what was done and why in a log entry (who, when, which login); the audit log does not see dashboard actions.

If the owner's own factor is lost, only someone with access to the Supabase dashboard (MJ) can do step 1.

## Forgotten password (owner or manager)

The app has no "forgot password" page. In the dashboard, **Authentication → Users**, open the user and send a password recovery email, or set a new password of at least 12 characters and tell the person by a separate channel. Reps and salons have no password: they sign in with an emailed code. Whether the app should get its own recovery page is open with MJ (ACTIVITY B-47).

What the database guarantees afterwards: only the owner, at AAL2, can create users, change roles, suspend accounts, grant vault access, or change configuration. Each of those actions writes an audit row.
