# 2026-11-20 mainline integration report

**Integration branch:** `integration/single-repo-consolidation`  
**Base:** `origin/main` at `2d0f6a4c7629480aa09bfcbd70f29ef2accef865`  
**Canonical repository:** `ethancrystal/kiran-dms`

## Integrated feature sources

| Feature | Source | Result |
|---|---|---|
| Office duplicate phone detection, opening last purchase, reminder history | PR #114, merge commit `89f4cc8`, latest head `bece511` | MERGED LOCALLY; included in integration branch |
| MJ decision reconciliation and latest follow-up decisions | PR #115, merge commit `7a1be67`, latest head `e8c098e` | MERGED LOCALLY; included in integration branch |
| Rep day without mandatory manual bag counts | PR #112 commit `e6abe36` | RECOVERED; forward migration, UI, and visit test changes cherry-picked |
| Backup manifest and compliance comparison | PR #112 commits `d44e8b5` and `6541a5f` | RECOVERED; unit-tested and GitHub agent-compliance gated; no `kiran` gitlink retained |
| Sign-out wipe and offline outbox safety | `claude/p1-09-signout-wipe` commits `3ed1bb4` and `b07134b` | RECOVERED; focused 48-spec Playwright run passed |
| Board/status reconciliation | PR #113 | APPLIED SELECTIVELY; stale branch-wide deletion diff is rejected |

## Donor review

The public catalog, auth callback, health and feedback candidates remain limited to the donor comparison. The DMS already contains the canonical public catalogue, auth and salon portal surfaces. No donor dual-Supabase routing, nested lockfile or `kiran` submodule was introduced. Public availability remains boolean-style and numeric stock quantities remain outside the public browser path.

## Hosted safety

No hosted Supabase migration, staging SQL, production SQL or data read was performed. The stale project-reference change in PR #112 was reverted. Existing hosted project identity and migration-history/backup approval remain external blockers.

## Remaining integration work

- Run and record database/RLS suite from the exact final integration head.
- Run production build, browser suites and full lint/typecheck on the exact head.
- Open final PR to `main`, inspect every required status check on that exact commit, and merge under the repository ruleset only if MJ has approved the specific PR.
