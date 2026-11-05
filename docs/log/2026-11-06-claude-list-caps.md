# 2026-11-06 14:00 PKT · Claude · Sonnet 5.5 · branch claude/list-caps · TASK
**Task:** say so when a capped list is at its cap (remaining-implementation plan C4, AUTH-15 and FLOW-19 "showing N of M" part; areas: apps/web/lib/list-cap.ts, apps/web/components/list-cap-note.tsx, the rep cards, deliveries and orders pages, the office order list, apps/web/e2e/list-cap-note.spec.ts)
**What / why:** Four lists are read newest-first with a fixed cap in the database: the rep's cards, deliveries and orders (50 each: `app.my_cards`, `app.my_submissions`, `app.my_territory_orders`) and the office order list (200: `app.office_orders`). A list at its cap could hold older rows with nothing saying so. Each now shows "Showing the newest N …. Older ones are not listed here." when it has exactly reached the cap, and nothing below it. The caps were read from the migrations, not from the page comments.
**Deliberately not done:** the plan says "showing N of M". The four reads return no total, so an M would need a new count read (a migration) on each. The note says only what is true without one. If MJ wants the exact total, that is a separate database change; other capped lists (stock levels, people, salons) are not touched here because their caps are chosen on the page and are well above what a pilot holds.
**Evidence:** `pnpm typecheck` passes; `biome ci` passes. `apps/web/e2e/list-cap-note.spec.ts` (2 tests, Node only, on the wording function) passes. Not tested: the pages themselves showing the note (the rep pages need a signed-in rep and the office page the stack; CI's journeys do not fill a list to its cap). Not run locally: the stack journeys; CI is the first run. No migration, function, policy or permission changed.
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
