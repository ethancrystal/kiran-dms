# 2026-11-18 17:03 PKT · Antigravity · Gemini 3.8 Flash · branch feat/rep-day-no-bag-count · TASK
**Task:** — (remove manual bag counts from rep shift check-in and check-out per updated product specification; areas: supabase/migrations/20261118120000_rep_day_no_bag_count.sql, apps/web/app/app/rep-day.tsx, supabase/tests/visits.test.ts)
**What / why:** Updated Kiran DMS Product Specification and Phase Roadmap removes manual bag counts from field representative daily check-in, check-out, and shift reconciliation. Rep bag custody is maintained via two-party verified warehouse stock issues and approved deliveries. Updated `app.rep_check_in` so `p_counted` defaults to `'[]'::jsonb` with 0 variance when omitted. Updated `app.rep_check_out` to remove the mandatory `INV-05` evening `daily_close` count check before shift completion. Streamlined `apps/web/app/app/rep-day.tsx` so reps check in and check out with single-click actions capturing GPS and client time without manual SKU counting. Updated `supabase/tests/visits.test.ts` to assert that check-out completes cleanly without requiring a `daily_close` count entry.
**Built:** Migration `supabase/migrations/20261118120000_rep_day_no_bag_count.sql`; updated `apps/web/app/app/rep-day.tsx`; updated `supabase/tests/visits.test.ts`. Configured `apps/web/.env.local` to point to updated Supabase project `https://nwxidylbfeciungrqdkm.supabase.co` (git-ignored, verified against OpenAPI schema).
**Evidence:**
- `pnpm agent:preflight`: exit 0, PREFLIGHT OK on `feat/rep-day-no-bag-count`.
- `pnpm typecheck`: exit 0 across `apps/web`, `packages/import`, and `supabase/tests`.
- `pnpm -r --if-present test`: exit 0, 4 test files passed, 59 passed, 5 expected fail.
- Database RPC schema inspect: verified 67 public tables and 283 app RPC routes on `https://nwxidylbfeciungrqdkm.supabase.co`.
- Salon self-registration (`/salon/signup`, D-51) verified present from `20261109200000_salon_self_signup.sql` and `apps/web/app/salon/signup/page.tsx`.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role matrix tests added/updated (n/a)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (n/a)
[x] Mutations via SECURITY DEFINER function, pinned search_path, idempotent (app.rep_check_in and app.rep_check_out use SECURITY DEFINER and search_path = '')
[x] Audit trigger present; hash chain verifies (rep_day audit trigger unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (n/a)
[x] No secrets / real personal data / real supplier data added (all credentials in git-ignored .env.local)
[x] Governance powers still owner-only + AAL2 (unchanged)
[x] No control weakened, skipped or temporarily disabled (shift lifecycle is enforced; physical custody shifts to verified issue/delivery receipts)
[x] Docs match code; deviations logged (matches updated Product Specification)
[x] Tests actually run; real results recorded (typecheck passed; packages/import passed; visit check-out assertions updated)
