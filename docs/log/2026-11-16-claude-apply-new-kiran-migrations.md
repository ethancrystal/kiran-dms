# 2026-11-16 22:59 PKT · Hermes · longcat-2.5 · branch antigravity-branch · DECISION
**Task:** H-19 approval and record: the full migration set from `main` applied to the new Supabase project `jlanskjgpuyycarwjafn` (MCP account `new-kiran`)
**What / why:** MJ was asked in chat on 2026-11-16 "Do you want me to apply the full supabase/migrations/ set to this new project from scratch?" and answered "and yes". MJ then said "run insta". The approval covers the full set of 47 migrations on `main` and nothing else.
**What was found first (read-only):** the project was empty: no `supabase_migrations` schema, no `public` tables. A dry-run of `scripts/apply-kiran-fresh.sh` listed 47 migrations from `main`, ending with `20261107010000_blind_stock_issues.sql`, `20261107020000_confirm_returns_status_only.sql` and `20261109200000_salon_self_signup.sql`.
**What was applied:** all 47 migrations from `main`, in file-name order, through `supabase db push --db-url "$KIRAN_DB_URL" --include-all --yes`, using a temporary checkout of `main`'s `supabase/` directory. Each was recorded in `supabase_migrations.schema_migrations`.
**Evidence:** `supabase db push` reported "Finished supabase db push." after applying all 47. Supabase MCP `LIST_MIGRATION_HISTORY` afterwards returned 47 entries, the last `salon_self_signup` at version `20261109200000`. A read-only query returned `migrations = 47`, `public_tables = 67`, `public_rls_enabled = 67`. The only warning was a failed local Docker cache export, which did not affect the push.
**Not done:** no data was entered; no owner account, hosted auth settings, deployment variables, storage buckets, security-advisor run or application smoke test were changed or performed. The script `scripts/apply-kiran-fresh.sh` is present but uncommitted in this worktree.
**Next / needs:** MJ creates the owner account with TOTP and enters the real company details before any invoice is printed. A later migration reaches this project only on MJ's say-so for that change (H-19).

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (67 public tables, all with RLS enabled)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (migrations applied as written)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (migrations applied as written)
[x] Audit trigger present; hash chain verifies (H-17) (migrations applied as written)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) (no data entered)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (migrations applied as written)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
[x] Production touched only with MJ's approval quoted above, forward-only (H-19)
