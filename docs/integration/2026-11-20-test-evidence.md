# 2026-11-20 test evidence

| Check | Environment | Result | Evidence |
|---|---|---|---|
| `pnpm agent:preflight` | Integration worktree | PASS | PREFLIGHT OK |
| `pnpm lint` | Integration worktree before recovery | PASS | 230 files, 0 errors, 40 warnings, 43 infos |
| `pnpm typecheck` | Integration worktree before recovery | PASS | Supabase and workspace typechecks |
| `pnpm -r --if-present test` | Integration worktree before recovery | PASS | 4 files, 59 passed, 5 expected failures |
| `pnpm service-role:scan` | Integration worktree before recovery | PASS | 155 files |
| `pnpm activity:check origin/main HEAD` | Integration worktree before recovery | PASS | 2 new log entries, 16 changed files |
| `pnpm backup:test` | Integration worktree after backup recovery | PASS | 9 passed, 0 failed |
| Focused Playwright outbox specs | Pure Node test config, no web server | PASS | 48 passed, 0 failed |
| `pnpm -C apps/web build` | Integration worktree | PASS | Next.js production build, 22 static pages plus dynamic routes |
| `pnpm db:test` | Embedded/test database | PENDING FINAL-RERUN | Exact final integration head not yet recorded |
| Full rep PWA Playwright suite | Placeholder app build | PENDING/RE-RUN | Exact final integration head not yet recorded |
| Hosted Supabase migration/RLS smoke | Hosted environment | NOT RUN | H-19: MJ approval and project/backup verification required |

## Limitations

- The first combined Playwright run timed out while the Next.js web server was building. The pure sign-out specs were then run independently and passed.
- The database suite was started, but its exact final result was not available during the inventory pass and must be rerun on the exact final integration head.
