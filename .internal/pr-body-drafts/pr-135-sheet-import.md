## What and why

The previous session left the office sheet import uncommitted in `.worktrees/sheet`. Commit 1 (`ac384b0`) preserves that work verbatim (snapshot, so nothing can be lost); commit 2 is the one code fix the C0 work order asks for (docs/plans/in-progress/2026-11-21-execution-handoff.md section 2 C0; board P1-43).

`onFile` minted `crypto.randomUUID()` per file selection. Within one selection every id derives from the batch, so a retry was safe — but re-selecting the same file opened a NEW batch, so the database replay guard (the H-08 idempotency `client_id`) was defeated and only a UI notice stood between the office and a second receipt of the same stock.

The batch id now derives from the file content: sha-256 of the exact file bytes (WebCrypto), first 32 hex characters formatted as a uuid (version nibble 8, variant bits 10 — uuid v8 shape, valid for the `client_id` uuid columns). Same bytes = same batch = same receipt `client_id`, so the database answers "stock for this file was already received (replay: nothing added)" on its own authority. A changed file = a new batch. The page's closing sentence (which claimed a re-upload would receive the units again) and the affected comments were updated to the new true behaviour; everything else is untouched.

## MJ ruling 5 — CSV, not Excel (recorded, not built)

The suggestion to add Excel support this wave over-reads the ruling the files cite. `lib/sheet-import.ts` line 1 quotes MJ, 2026-11-20, ruling 5 as: "a way in which we can upload sheet and it automatically gets all the products and upload them", and the upload page header records the reading the office took: "the office uploads a CSV of products and unit counts", with Excel .xlsx deferred and logged as a deviation in code. No decision file in `docs/decisions` or the 2026-11-19/20 `docs/log` entries carries ruling 5 itself. CSV-only is therefore treated as the ruling and NO Excel support was added. If MJ intended Excel, say so in chat and it becomes its own slice.

## Evidence (run locally in .worktrees/sheet, branch feat/office-sheet-import)

- `pnpm -C apps/web test`: 24 passed, 0 failed — 21 existing plus 3 new: same-file-same-batch, changed-file-new-batch, and the uuid-format case pinning the template's known answer `d46b2eea-b93e-82cb-a4ff-0b7b33106b28`.
- `pnpm -C apps/web typecheck`: exit 0.
- `pnpm lint` (biome ci): exit 0; 253 files, 42 warnings and 38 infos — the pre-existing baseline.
- `node scripts/agent-preflight.mjs`: OK.

## Not run here (by rule or environment)

- `pnpm db:test` and `supabase/tests/sheet-import-rpcs.test.ts` — forbidden locally per the handoff; CI runs them on this PR.
- `apps/web/e2e-stack/sheet-upload.spec.ts` — needs the local stack (no Docker on this host); CI runs it.
- The `office browser tests` job is expected red on this base until C0a merges (pre-existing on main, run 44930031088) — not this diff.

## Traceability, risks, rollback

- P1-43; H-08 (idempotency `client_id`). The branch base `bac779e` is contained in origin/main, so the PR carries the snapshot and the fix only.
- Behaviour note (intended): uploading the same file after choosing a DIFFERENT warehouse is now a replay as well — the database returns replay and adds nothing, and the UI says so. The record of a delivery is the sheet itself.
- Rollback: revert the work commit; the snapshot commit stays as preservation.
