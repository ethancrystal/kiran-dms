# Runbook — creating the first owner account (human-only, ACTIVITY §10)

Who: **MJ or the owner, never an agent.** Where: the Supabase dashboard of the Kiran project.

## Before the first login: configure the hosted project

`supabase/config.toml` configures only the local CLI stack. A hosted project needs the same settings in the dashboard, or `supabase link` followed by `supabase config push`:

1. **Settings → API → Exposed schemas:** add `app` and `vault_api` next to `public`. Without this, every `app.*` RPC (for example `register_device`) returns 404.
2. **Authentication → Sign In / Providers:** turn **off** "Allow new users to sign up" (email and phone). The owner creates every account.
3. **Authentication → Multi-Factor:** enable TOTP enrolment and verification. Check that the project's plan includes it.
   **Authentication → Passwords:** minimum length 12 and leaked-password protection on (doc 06 §3).
4. **Authentication → Phone:** connect the SMS provider for rep OTPs once the sender ID is registered (B-08). Until then, use test phone numbers with fixed OTPs for the pilot rep only.
5. After the migration is applied, make one authenticated call to an `app.*` RPC through the API. The local test suite cannot check PostgREST schema exposure.


## Creating the owner

1. **Auth → Users → Add user.** Enter the owner's email and a password of at least 12 characters. Tick "Auto confirm".
2. Copy the new user's UUID.
3. **SQL editor** (runs as `postgres`), replacing both values:

   ```sql
   select app.bootstrap_owner('<owner-uuid>', '<Owner full name>');
   ```

   This works exactly once. A second call fails with "an owner already exists".
4. Sign in at `/office/login` and enrol TOTP on the next screen. Store the authenticator's recovery codes offline.
5. From then on, the owner creates every other account through the app (`app.owner_create_user`). Each one needs an auth user first: email + password for a manager, phone number for a rep.
6. A second owner account for continuity (OQ-03): create it the same way through `app.owner_create_user` with role `owner`, then suspend it with `app.owner_set_status` until needed.

What the database guarantees afterwards: only the owner, at AAL2, can create users, change roles, suspend accounts, grant vault access, or change configuration. Each of those actions writes an audit row.
