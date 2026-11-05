# 2026-11-05 17:01 PKT · Claude · Opus 5.5 · branch claude/p1-30-audit-fixes · TASK
**Task:** P1-30 (fixes from the backend-to-screen wiring audit; D-45 to D-48; CTL-07, CTL-08, CTL-17, PAY-05, PAY-10, CTL-03, INV-03, ORD-02, SEC-13, SEC-16, RPT-01 thin; areas: one forward migration 20261105210000_audit_fixes.sql, its tests, and the screens /office/stock, /office/approvals, /office/deliveries, /office/handovers, /office (home), /office/salons/[id], /app/handovers, the rep money section, the order form and convert, the rep month block)
**What / why:** Session start and claim. Read first: CLAUDE.md, docs/ACTIVITY.md (rules, board, blockers, assumptions; docs/AGENT-COMPLIANCE-PROTOCOL.md does not exist on this tree, as the P1-29 entry also noted), the newest log entries, and the wiring audit (sections Office, Rep app, Salon portal and sign-in, Order-to-money flow). Branch claude/p1-30-audit-fixes from origin/main at 1a053ba, then origin/claude/p1-26-overviews and claude/p1-29-routes-stock merged in (both unmerged slices; one conflict each in docs/ACTIVITY.md and SPEC.md, resolved by keeping both rows). Baseline: pnpm agent:preflight OK, worktree clean.

Not in this slice, by the brief: a product-group screen (audit H5, FLOW-01; another session holds it on claude/product-group-screen); the grouped sidebar, /office/reps/[id], and the invoice and receipt views (slice 10).

Plan, one migration (20261105210000_audit_fixes.sql), tests first for each rule:
1. D-45 (H1, M1, B-42): the owner's own discount takes effect whatever the order's source; the owner's own stock adjustment posts at once through a new append-only record; Withdraw for a pending request by its maker (app.cancel_approval).
2. H2, M8 and the second reader's two dead ends: an adjustment request on a stock location goes to the owner above the threshold; a refused request stays visible with its reason; the missing-goods row shows the right quantity.
3. H4, FLOW-03: credit exposure is what is still owed on installment invoices plus the undelivered value of open installment orders.
4. H7: the stage unblock respects the CTL-08 cap and writes its credit event.
5. D-46: settlement of a disputed handover (owner only), withdrawal of an unanswered one.
6. D-47: the intraday cash cap in the rep's collection; reps over the cap on the office home.
7. D-48: payment reversal, with the payments list on the office salon page (FLOW-13).
8. AUTH-05 and AUTH-01.
9. FLOW-09, FLOW-10, FLOW-11.
**Evidence:** Claim only; evidence follows in additions to this entry.
**Next / needs:** the build.
