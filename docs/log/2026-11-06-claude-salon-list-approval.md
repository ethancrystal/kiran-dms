# 2026-11-06 16:30 PKT · Claude · Sonnet 5.5 · branch claude/salon-list-approval · TASK
**Task:** H8 of the Hermes work order (remaining-implementation plan C4, L8; areas: apps/web/app/office/(shell)/salons/page.tsx)
**What / why:** The office salon list had no filter on approval and gave no reason for a rejected salon. It now has an Approval filter (All, Pending, Approved, Rejected), applied in the database query, and for the rejected salons on the page it reads their reason from salon_approval_decision (office users already may read it under its select policy) and shows it under the badge as "Rejected: reason" (data-testid rejection-reason). The control matches the Stage control beside it (a label wrapping the select). Page only: no database, policy or test change.
**Evidence:** `pnpm typecheck` passes; `biome ci` on the changed file passes. The page was not exercised in a browser locally; the existing journeys do not use the new control. Not run locally: the stack journeys; CI is the first run.
**Next / needs:** CI on the pull request; MJ's OK to merge.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no table or policy touched; an existing office select policy is used)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (read only)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
