# 2026-11-05 07:14 PKT · Claude · Opus 5.5 · branch claude/p1-22-commission · TASK
**Task:** P1-22 (completion slice 5; CTL-13, FLD-01, FLD-03, FLD-06; D-31, D-38, OQ-34 default; areas: migration 20261105140000_commission.sql, tables rep_commission_rate and commission_payment, column invoice.commission_rate_bp, app.finalise_delivery stamping point, app.office_set_commission_rate, app.office_record_commission_payment, app.office_reverse_commission_payment, app.my_commission, app.office_commission and an office summary read; supabase/tests/commission.test.ts, rls-matrix rows, verifier-attacks allowlist; office page /office/commission and its nav entry; rep pages /app/commission and /app/account; the stack seed and stack test; docs 03, 04, 06, 10, 12, SPEC.md, board row P1-22)
**What / why:** Slice 5 of the project completion plan (docs/superpowers/plans/2026-11-05-project-completion.md, section Slice 5). Claim: this branch, stacked on claude/p1-21-delivery-approval (slice 4, local only), at 55c48f2. Checked before starting: git branch -r shows no other commission branch (origin/claude/orders-delivery-commission is PR A, merged); slices 2 and 3 (P1-19, P1-20) are not on this branch, so there is no investor ledger here to copy and migrations 20261105110000 and 20261105120000 do not exist yet.

Session start: read CLAUDE.md, docs/ACTIVITY.md in full, the ten newest docs/log entries, docs/16-project-completion-goal.md, the completion design spec (R7, R8), the completion plan, the slice 4 entry, doc 03 rows CTL-13, FLD-01, FLD-03, FLD-06, doc 06 section 2 commission rows, doc 04 and SPEC.md commission lines, doc 12 D-31, D-38 and OQ-34. The caller's brief names docs/AGENT-COMPLIANCE-PROTOCOL.md; that file does not exist on this branch: MJ's decision 2026-11-04-mj-process-and-pr-b-plan merged it into ACTIVITY.md and deleted it, and CLAUDE.md no longer names it.

Intent, as planned before code: the per rep and salon rate stays on salon_rep_assignment.rate_bp (slice 1; not duplicated); rep_commission_rate holds only the rep default, append-only and versioned; invoice.commission_rate_bp is stamped in the existing invoice insert of app.finalise_delivery; commission_payment is append-only with full reversals; earned is derived from invoices, never stored.
**Evidence:** Baseline on 55c48f2 in the new worktree, DATABASE_URL unset: pnpm install --frozen-lockfile done; pnpm agent:preflight PREFLIGHT OK, worktree clean; pnpm typecheck exit 0; pnpm lint exit 0 (123 files, 33 warnings, 42 infos). Results of the build follow as additions to this entry.
**Next / needs:** build the slice; then CI on a pull request when MJ decides to push.

Security checklist (tick honestly):
[ ] RLS enabled+forced; policies + role×table tests added/updated (H-13)
[ ] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07)
[ ] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08)
[ ] Audit trigger present; hash chain verifies (H-17)
[ ] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05)
[ ] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20)
[ ] Governance powers still owner-only + AAL2 (H-15)
[ ] No control weakened, skipped or "temporarily" disabled (H-16)
[ ] Docs match code; deviations logged (H-25)
[ ] Tests actually run; real results recorded (H-23, H-24)
