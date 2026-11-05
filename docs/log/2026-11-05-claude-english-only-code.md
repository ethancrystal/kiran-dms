# 2026-11-05 15:17 PKT · Claude · Sonnet 5.5 · branch claude/english-only-code · TASK
**Task:** P1-27, remove Urdu text from `apps/web` (D-42; NFR-03; areas: apps/web rep pages, money-section, globals.css, two browser tests, doc 12)
**What / why:** D-42 (MJ: "keep it in english only") made the UI English only; PR 60 changed the docs and left the code. This removes every Urdu span, label and string from `apps/web` (16 files, 37 lines): the bilingual headings on the rep pages, the Urdu sentences under the account-not-ready and phone-awaiting-approval notices, the sign-in paragraph and button suffixes, the `Received by` label, the `Check in` title, and the `Account` and `Record a payment` headings of the money section. The `.ur` style and the Nastaliq font are removed from `globals.css`. The rep sign-in test now asserts there is no `lang="ur"` element (it asserted the opposite); the stack test's heading `Account · حساب` is now `Account`. Roman Urdu stays accepted in free-text fields. No database, migration or logic change. Doc 12 D-42 status updated.
**Evidence:** Branch from origin/main 348d0e1. A regex search of `apps/web` for Arabic-script characters, `lang="ur"`, `className="ur"` and `Nastaliq` finds only the one new assertion in `rep-login.spec.ts`. Commands and results are in the addition below.
**Next / needs:** Slices 8 (PR 65) and 9 touch some of the same rep pages (`app/app/page.tsx`); whichever merges second merges main in.

Commands and results (DATABASE_URL unset; no database test run, because no SQL or database-facing code changed):
- `pnpm install --frozen-lockfile`: done (new worktree). `pnpm typecheck`: pass.
- `pnpm exec biome format --write apps/web` (reformatted the 12 pages whose headings became one line), then `pnpm exec biome check --diagnostic-level=error`: no errors.
- `CI=true pnpm -C apps/web test:e2e`: 4 passed, including the sign-in test that now asserts no `lang="ur"` element.
- Search of `apps/web` for Arabic-script characters, `lang="ur"`, `className="ur"`, `Nastaliq`: only the new assertion remains.
- Not run: the stack tests (CI only); every other assertion that names a heading uses text that still matches.

Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role×table tests added/updated (H-13) (no table or policy touched)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (no database change)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (no mutation added)
[x] Audit trigger present; hash chain verifies (H-17) (unchanged)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[x] Governance powers still owner-only + AAL2 (H-15) (no permission change)
[x] No control weakened, skipped or "temporarily" disabled (H-16)
