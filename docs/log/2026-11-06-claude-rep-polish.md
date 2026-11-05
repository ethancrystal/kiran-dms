# 2026-11-06 12:00 PKT · Claude · Sonnet 5.5 · branch claude/rep-polish · TASK
**Task:** Karachi time on every rep, office and salon page (remaining-implementation plan C3, REP-20 and L2; areas: apps/web/lib/time.ts, the pages that showed a time, apps/web/e2e/time.spec.ts)
**What / why:** About two dozen pages and components each had their own copy of a `when` helper, and all but three formatted the time in the zone of the browser that opened the page. A rep or office user on a phone set to another zone saw a different date than the database's Karachi dates. There is now one formatter, `apps/web/lib/time.ts` (`when`, `whenOrDash`, `clock`, fixed to Asia/Karachi), and every copy is replaced by it; `lib/commission.ts` and `lib/overview.ts` re-export it so their importers are unchanged. The plan's other C3 item "Rep home has no Salons link" was already done (`/app/salons` is linked on the rep home), so nothing was added for it. No migration, function, policy or permission changed.
**Evidence:** `pnpm typecheck` passes. `pnpm exec biome ci` passes after formatting the touched files. `apps/web/e2e/time.spec.ts` (3 tests, run in Node with no page) passes under TZ=UTC, TZ=America/Los_Angeles and TZ=Asia/Karachi: 20:00 UTC on 5 November shows as the 6th at 1:00 am. Not run locally: the browser journeys (no local stack; CI is the first run). Salon page `day()` was left alone: it formats a date with no time, so it shows the same day in any zone.
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
