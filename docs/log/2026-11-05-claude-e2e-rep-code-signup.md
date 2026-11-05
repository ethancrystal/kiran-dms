# 2026-11-05 23:27 PKT · Claude · Sonnet 5.5 · branch claude/e2e-rep-code-signup · TASK
**Task:** the rep joins by the real emailed code in the invitation journey (goal plan Verification: both invitees sign up); D-50 (areas: supabase/config.toml, apps/web/e2e-stack/office.spec.ts, docs/12)
**What / why:** The invitation journey joined the salon through the real page and the e-mailed code but redeemed the rep's link with a session made straight on the local database, because the local stack allowed 2 e-mails an hour. MJ (chat, 2026-11-05: "yes", to raising the local e-mail limit) approved raising it. Changed: supabase/config.toml auth rate_limit email_sent from 2 to 30 (local stack only; the hosted project's limits are set in its own dashboard and are untouched); the journey now opens the rep's link as a guest, asks for the code, reads it from the local mail catcher, checks the preview, accepts, and leaves the invitation page. The salon uses the same helper, and so do the rep and the salon in the full end-to-end journey (P1-25). The database-side redeem helper is removed from the spec. No migration, function, policy or page changed.
**D-50:** raising the local e-mail limit is a test-stack setting, not a control on any real project. H-16 names rate limits, so the change is recorded here by MJ's word; nothing on a hosted project changes.
**Evidence:** pnpm typecheck, Biome and the activity-log check are run before the commit (results in the commit and pull request). Not run locally: the stack journeys (no Docker on this host); CI is the first run, and a failure there will be fixed on this branch.
**Next / needs:** CI on the pull request; MJ's OK to merge.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no table or policy touched)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (no database change)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (no function added)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16) (local-stack e-mail limit raised on MJ's explicit yes; recorded as D-50; no hosted setting touched)
