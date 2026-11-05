# 2026-11-06 13:00 PKT · Claude · Sonnet 5.5 · branch claude/auth-dead-ends · TASK
**Task:** the two sign-in dead ends (remaining-implementation plan C4, AUTH-16; areas: apps/web/app/salon/login/page.tsx, apps/web/app/invite/[token]/page.tsx, apps/web/e2e/salon-login.spec.ts)
**What / why:** (1) On the salon sign-in, once the code was sent there was no way back to fix a mistyped email. It now has the same "Use a different email" button the rep sign-in and the invitation page already have. (2) An invitation that was already accepted showed only "This invitation has already been accepted." Now it also shows a button to the account it made: the rep app for a rep, the salon portal for a salon. Both are page-only changes. No migration, function, policy or permission changed.
**Evidence:** `pnpm typecheck` passes; `biome ci` passes. `apps/web/e2e/salon-login.spec.ts` (new; intercepts the one auth request) passes locally against a production build, together with `time.spec.ts` (4 tests, 2.9 min). Not tested: the accepted-invitation button has no test of its own (it needs an accepted invitation, i.e. the CI stack journey); it is a plain link to `/app` or `/salon`. Not run locally: the stack journeys; CI is the first run.
**Next / needs:** CI on the pull request; MJ's OK to merge.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no table or policy touched)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (no database change)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (no function added)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
