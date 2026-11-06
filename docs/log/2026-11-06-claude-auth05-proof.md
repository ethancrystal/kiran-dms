# 2026-11-06 15:25 PKT · Claude · Sonnet 5.5 · branch claude/auth05-proof · TASK
**Task:** H5 of the Hermes work order (remaining-implementation plan C2, AUTH-05 residual; areas: supabase/tests/audit-fixes.test.ts only)
**What / why:** The plan said a password token of an invited rep could still read its own profile and device rows. Reading the code, both policies call app.self_ok(), which fails for that token since migration 20261105230000, and nothing pinned it. Two assertions now do: inside the test about a password token after redemption, the token's count of rows in public.user_profile and in public.device is 0. Both pass, so the earlier note in 2026-11-05-claude-p1-30-audit-fixes that this residual was open was inaccurate. No policy, migration or page changed.
**Evidence:** `pnpm db:test audit-fixes`: 1 file, 60 tests pass with the two new assertions. Nothing else run: no code outside the test file changed.
**Next / needs:** CI on the pull request; MJ's OK to merge.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (two assertions added; no policy touched)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (no mutation)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
