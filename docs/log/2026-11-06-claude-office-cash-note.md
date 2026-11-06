# 2026-11-06 16:45 PKT · Claude · Sonnet 5.5 · branch claude/office-cash-note · TASK
**Task:** H9 of the Hermes work order (remaining-implementation plan C4, L6; areas: apps/web/app/office/(shell)/handovers/page.tsx)
**What / why:** The note beside the Office cash figure said it held handed-over cash and cash the office collected, and that bank deposits are not built yet. It now also says that reversed cash payments are taken off, and that the figure does not go down when cash is banked because deposits are not recorded here yet. One sentence changed; the element with data-testid office-cash is untouched.
**Evidence:** `pnpm typecheck` passes; `biome ci` on the changed file passes (Biome wrapped the long sentence over two lines). No test reads the old wording (searched apps and supabase). Page not exercised in a browser; CI is the first run of the journeys.
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
