# 2026-11-06 18:10 PKT · Claude · Sonnet 5.5 · branch claude/invite-picker-note · TASK
**Task:** H13 of the Hermes work order (remaining-implementation plan C4, L7, the note only; areas: apps/web/app/office/(shell)/people/page.tsx)
**What / why:** The invitation form's salon picker reads at most 500 salons by name and said nothing when a salon further down could not be picked. When the list holds exactly the limit, a note under the picker now says "Showing the first 500 salons by name. A salon further down the list cannot be picked here yet." The wording follows the order form's, not the list-cap note, whose words are about newest rows. A search in the picker stays for MJ.
**Evidence:** `pnpm typecheck` passes; `biome ci` on the changed file passes. Not exercised in a browser (no fixture holds 500 salons). LIST_LIMIT also caps the areas list on the page, which is not touched. Not run locally: the stack journeys; CI is the first run.
**Next / needs:** CI on the pull request; MJ's OK to merge.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no database change)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (no mutation)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (unchanged)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
