# 2026-11-21 23:20 PKT · AutoClaw (cluster agent, slice C0) · AutoClaw runtime · branch feat/office-sheet-import · TASK
**Task:** P1-43, the sheet half (adoption of the office sheet import workstream per docs/plans/in-progress/2026-11-21-execution-handoff.md section 2 C0; areas: apps/web upload page, lib sheet-import and its tests, docs/log, docs/ACTIVITY.md board)

**What / why:** Adopt the sheet worktree, preserve the previous session's uncommitted work, and make the receipt batch id derive from the file content so re-selecting the same file replays the same client ids (H-08).

Guards (before any touch): git status showed exactly the uncommitted set the handoff expects (products page and package.json modified; the upload page, lib sheet-import and its test, vitest.config.ts, the sheet-import-rpcs db test and the e2e spec untracked; pnpm-lock.yaml from the session's own install). The three newest file mtimes were the turbopack dev cache under apps/web/.next at 2026-11-21 09:07:01 PKT, about 14 hours before the guard ran (23:07 to 23:11 PKT); no file in the worktree was modified within the last 3 hours, so the worktree was cold and the snapshot went ahead.

Snapshot: commit ac384b0 "snapshot: uncommitted work found in the worktree, 2026-11-21 (preserved before continuation)", 9 files, 1417 insertions and 1 deletion, pushed as origin/feat/office-sheet-import; the branch did not exist on origin before, so nothing of the previous session can now be lost.

The one code fix this wave: onFile in apps/web/app/office/(shell)/products/upload/page.tsx minted a random crypto.randomUUID() per file selection. Within one selection every id derives from the batch, so a retry was safe; but a re-selection of the same file opened a new batch, defeated the database replay guard and left only a UI notice between the office and a second receipt of the same stock. The batch id is now batchIdOf: sha-256 of the exact file bytes (WebCrypto), the first 32 hex characters formatted as a uuid with version nibble 8 and variant bits 10 (uuid v8 shape, valid for the client_id uuid columns). The same bytes give the same batch; a changed file opens a new one. The page's closing sentence, which told the office that uploading the same file again would receive its units again, was rewritten to the new true behaviour (a replay adds nothing twice); the two comments that described the old rule were updated with it. Everything else in the page and the lib is untouched.

MJ ruling 5 (Excel or CSV): the ruling survives in this workstream only as the text its files cite. lib/sheet-import.ts line 1 quotes MJ, 2026-11-20, ruling 5: "a way in which we can upload sheet and it automatically gets all the products and upload them", and the upload page header records the reading the office took: the office uploads a CSV of products and unit counts, with Excel .xlsx deferred and logged as a deviation in code. No decision file in docs/decisions or the 2026-11-19 and 2026-11-20 docs/log entries records ruling 5 itself. CSV-only is the recorded reading, so no Excel support was added this wave; the reading is recorded in the pull request body for MJ to confirm or overrule.

**Evidence:**
- pnpm -C apps/web test (vitest run): 1 file, 24 tests, 24 passed, 0 failed (21 existing plus 3 new batchIdOf cases: the same bytes twice give the same id and a changed file gives a new one; the uuid format with version 8 and variant 89ab, pinning the template's known answer d46b2eea-b93e-82cb-a4ff-0b7b33106b28; a short hex input is refused).
- pnpm -C apps/web typecheck: exit 0. The first version failed tsc (TS 5.9 typed-array generics on the digest input); fixed by normalising the input to a plain ArrayBuffer inside batchIdOf before the digest.
- pnpm lint (biome ci): exit 0, 253 files, 42 warnings and 38 infos, all pre-existing baseline. biome check --write on the three touched files applied formatting once, then reported no further fixes.
- node scripts/agent-preflight.mjs: PREFLIGHT OK, governance files and references in place.
- Not run: pnpm db:test (forbidden on this host per the handoff); supabase/tests/sheet-import-rpcs.test.ts (needs the embedded database); apps/web/e2e-stack/sheet-upload.spec.ts (needs the local stack; no Docker on this host). CI runs the database and browser jobs on the pull request; the office browser job is expected red on this base until C0a merges (pre-existing on main, run 44930031088, not caused by this diff).

**Next / needs:** the pull request from this branch carries the snapshot, the fix and this entry; the board row P1-43 goes into docs/ACTIVITY.md section 12 after P1-14 with the PR number (receipt below); MJ reviews and merges in chat (section 10). The vault half of C0, its BLOCKER B-63 and the encryption options brief live on feat/p1-05-vault-foundation.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies and role x table tests added/updated (H-13) - n/a, no database object touched
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) - n/a, no table touched
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) - no new write path; the client-side idempotency key is now content-derived, the database contract unchanged
[x] Audit trigger present; hash chain verifies (H-17) - n/a, no database write
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) - n/a, fixtures stay [Dummy]
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) - n/a, no permission touched
[x] No control weakened, skipped or temporarily disabled (H-16) - the change strengthens the replay guard, no control touched
[x] Docs match code; deviations logged (H-25) - the page's own wording and comments updated with the behaviour; the Excel deferral stays recorded in code as it was
[x] Tests actually run; real results recorded (H-23, H-24) - the counts and exit codes above; the not-run list is explicit
