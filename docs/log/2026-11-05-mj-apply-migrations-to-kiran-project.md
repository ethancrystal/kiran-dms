# 2026-11-05 03:24 PKT · Claude · Sonnet 5.5 · branch claude/log-staging-migrations · DECISION
**Task:** H-19 approval for the Kiran Supabase project (iurvazdyxzlspegygldo)
**What / why:** MJ approved applying the missing migrations in chat on 2026-11-05. Asked "Approve applying migrations to staging, and turn on email signup and picture storage there", MJ answered "do it". MJ then said of the project "its Kiran and do production", so this project is treated as production from now on (H-19): later changes reach it only on MJ's say-so for that change, as forward-only migrations.
The approval covers applying the 12 migrations that main had and the project lacked, and nothing else. It does not cover email signup or the storage bucket, which wait for the slices that use them, and it does not cover creating the owner account, which MJ does by hand (section 10).
**Evidence:** MJ's two chat messages quoted above.
**Next / needs:** MJ: create the owner account and TOTP (docs/runbooks/owner-bootstrap.md); rotate the service-role and secret keys and the database password (B-25); turn off Vercel deployment protection when salons and reps should reach the site.
