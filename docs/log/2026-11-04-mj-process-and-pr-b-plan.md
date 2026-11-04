# 2026-11-04 23:45 PKT · Claude · Opus 5.5 · branch claude/slim-docs-process · DECISION
**Task:** P0-09 (build protocol); P1-06 (PR B plan, D-32)
**What / why:** MJ decided the following in chat on 2026-11-04. Recorded here because a decision is its own entry kind (ACTIVITY section 4).

(a) Process change. MJ chose "All five cuts" and asked to "build more talk less". The five cuts:

1. The log is archived: section 16's entries moved byte for byte to docs/log/archive.md, which is frozen. ACTIVITY.md keeps the rules, status board, blockers, assumptions and appendices. Agents read those plus the 20 newest entries in docs/log/, and never the archive unless searching. Old L-nnnn citations stay valid.
2. One log entry per task or pull request (kind TASK), updated by adding to it until merged, replaces the session-start, claim, claim-release, progress, done and handoff entries. DECISION, BLOCKER, ASSUMPTION, DEVIATION, CORRECTION and SECURITY-INCIDENT stay distinct kinds. A self-verified VERIFIED still needs its Self-verification line (L-0401). The branch and its open pull request are the claim; the claims tables are removed and their history stays in the archive.
3. One file per entry, docs/log/YYYY-MM-DD-slug.md, with no sequential number. New citations use the file name stem. The renumbering procedure is removed.
4. Status lives in one place, the ACTIVITY section 12 board. SPEC.md, the execution map and the Gate 0 checklist stop stating status and link to it.
5. The agent compliance protocol is merged into ACTIVITY.md's rules and its file deleted.

Not weakened, at MJ's instruction: hard rules H-01 to H-27; database controls; the log check's secret patterns, owner terms, .env rule, sensitive-file and supplier heuristics, which now also scan new docs/log files; append-only (a merged docs/log file may not be changed or deleted, the archive is frozen); a pull request that changes code must add or update a docs/log entry with a non-empty Evidence section; the merge rule (MJ's OK in chat, required checks green, pinned merge commit). MJ approved changing verifier-authored tests for this restructure, keeping each one's intent where the mechanism survives.

(b) PR B plan decisions (delivery approval, D-32), accepted by MJ on 2026-11-04.

- Cash at the door: the rep collects after approval. No payment code changes. Advances are out of scope.
- The other 12 recommended defaults are accepted:

1. Partial approval means a submission for part of the order; approval itself is all-or-nothing.
2. Missing goods are handled through the existing adjustment kind.
3. Return to bag is recorded by the office with a count note.
4. Delivered, invoice and installment dates follow approval time.
5. Legacy rep_visit orders: the order's own rep may submit, with commission_rep_id null.
6. Two migration files.
7. No backfill of old invoices.
8. A moved rep's submission is still approvable.
9. office_deliver is allowed on an assigned order unless a submission is undecided.
10. Flags are mock_location and distance_unknown only.
11. A rep reads their own submissions, decisions and settlements.
12. Pending stock is excluded from the bag value limit.

**Evidence:** MJ's messages in chat on 2026-11-04, relayed to this session by the coordinating agent with the quoted words above. The session did not see MJ's messages directly.
**Next / needs:** PR B builds on (b) with its own plan and pull request. No board row changes for (b).
