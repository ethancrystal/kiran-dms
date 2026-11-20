# MJ decisions, 2026-11-20 07:20 PKT

> **Consolidation note (2026-11-20):** copied from `integration/single-repo-consolidation`
> into the active `feat/rep-day-no-bag-count` line as the authoritative record of MJ's
> write-off override. The matching migration `20261120020000_writeoff_checker_role.sql`
> and the doc 06/12/13 matrix changes are on the **integration line only** and are not on
> this branch. This record does not claim the permission change is implemented here;
> porting it needs its migration, tests and matrix docs together (H-25, H-26).

Recorded from MJ's own chat answers after the consolidation report. The protocol entry is `docs/log/2026-11-20-writeoff-approval-and-branch-cleanup.md`.

These answers authorise the write-off permission change and the deletion of already-merged local branches. They do not authorise a hosted migration, a merge to main, or any change to production.

## Write-off approval — override of the 2026-11-19 ruling

**Asked:** confirm or overturn the recorded rule that salon-debt write-offs stay owner-only and that the owner or manager may approve every other write-off.

**MJ:** "1 Owner and Manager both"

**Earlier rule (2026-11-19 08:04 PKT):** "Keep salon debt write-offs owner only; owner and manager approve all other write-offs", recorded in `docs/decisions/2026-11-19-mj-answers.md`.

**Decision:** the earlier split is overridden. An owner or a manager may decide **every** write-off — receivable (salon debt) and stock — at any amount, with no threshold.

Controls that stay: the decision needs AAL2, the checker can never be the maker (H-12, database constraint), the request keeps its idempotency key, reps still cannot request write-offs, and the decision is audited. This is MJ's current explicit instruction, which outranks the earlier decision and the stricter row in ACTIVITY H-15 under ACTIVITY §1; the permission-matrix change required by H-26 is approved by this quoted instruction. Only the write-off checker floor changes; every other owner-only governance power is untouched.

Carried in `supabase/migrations/20261120020000_writeoff_checker_role.sql`, docs 06 section 2, docs 12 D-08, docs 13 section 5 M4 and section 9, and ACTIVITY B-39.

## Hosted secrets (B-25, B-53 a)

**MJ:** "2 delete merged branches, I rotated all secrets"

**Recorded:** MJ states that all secrets were rotated. An agent did not inspect the hosted dashboard or verify the rotation; no secret value was read or printed. B-25 and B-53(a) are marked accordingly in ACTIVITY §14. B-53(b) Site URL and redirect URLs, B-53(c) hosted auth settings, B-53(d) owner creation with real company details, and B-47(a) confirm-email were not confirmed and stay pending.

## Already-merged branch cleanup (item 14)

**MJ:** "2 delete merged branches, I rotated all secrets"

**Recorded:** local branches with zero commits ahead of `origin/main`, not checked out in any worktree, not the current or protected branch, and with no open pull request were deleted. 94 branches were removed (91 with `git branch -d`, 3 with `-D` after a second proof of zero commits ahead). Branches holding unique work, live worktrees, open PR heads, `main` and the integration branch were kept. Remote branches were not deleted.

## Build choice

**MJ:** "3 anything"

Chosen: implement the write-off decision above, because it is the explicit permission change and was the only newly answered control in this exchange. The other settled slices remain queued.

## Not changed by these answers

- No migration was applied to any hosted database. The 2026-11-19 approval to apply pending migrations to kiran still belongs to Code Deployer after a manual backup.
- The repository visibility was not answered in this exchange.
- B-48 to B-51 amounts, B-31 (a), (b), (d), (e), (f), (g), B-39 (b) to (g), B-45's fully-delivered question, B-46(e), B-47, B-56 to B-59, B-38 and B-52 stay open.
