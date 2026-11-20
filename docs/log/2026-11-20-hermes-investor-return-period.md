# 2026-11-20 05:14 PKT · Hermes · qwen4-max · branch feat/rep-day-no-bag-count · ASSUMPTION
**Task:** — (investor recurring return period; assumption A-24)
**What / why:** MJ ruled the investor return is recurring ("lets assume its recurring") but did not name the period. To proceed without guessing a business rule silently, the build defaults the recurring period to MONTHLY: an investment of amount A at a promised percentage P accrues floor(A times P / 100) each whole calendar month from its invested_on date. The office may choose YEARLY per investment instead (whole calendar years). This is recorded as assumption A-24 in ACTIVITY section 15. If MJ meant yearly as the default, only the default changes; the calculation already supports both periods, so no schema change is needed.
**Evidence:** The recurring-return migration and tests support both monthly and yearly periods; the default offered in the office form is monthly. Baseline investor suite before the change: pnpm db:test investors.test, 39 passed (recorded in the build TASK entry).
**Next / needs:** MJ confirms monthly as the default, or names yearly. The whole-month and whole-year counts use Postgres age(), so a part period does not accrue.
Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role x table tests added/updated (H-13) (n/a: assumption only)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (n/a)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (n/a)
[x] Audit trigger present; hash chain verifies (H-17) (n/a)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) (n/a)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20) (none)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or temporarily disabled (H-16) (unchanged)
[x] Docs match code; deviations logged (H-25) (assumption recorded here and in ACTIVITY section 15)
[x] Tests actually run; real results recorded (H-23, H-24) (in the build TASK entry)
