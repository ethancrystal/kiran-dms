# Duplicate and conflict register (Phase 1)

**Audit date:** 2026-11-19 (PKT), `main` at `d4b47ca`, read-only. Each row names every place a rule is stated, which source wins under `docs/ACTIVITY.md` §1, and whether the conflict is settled. "Settled by" names a decision already on record; nothing here is settled by this audit. Details and evidence are in [01-findings-register.md](01-findings-register.md).

Authority order (ACTIVITY §1): 1 MJ's current instruction and doc 16; 2 fixed decisions in doc 00 and doc 12; 3 numbered planning docs (03, 04, 06, 07, 13 strictest); 4 ACTIVITY.md; 5 judgment.

## Conflicts

| ID | Rule in conflict | Statement A (source) | Statement B (source) | Which source wins today | Settled by | Finding |
|---|---|---|---|---|---|---|
| C-01 | Who approves write-offs | Write-offs owner-only (D-08, H-15, SEC-01, doc 13 M4, doc 09 §4) | Manager approves a stock write-off below threshold (doc 06 §2); owner always (doc 13 §9); owner above threshold (CTL-06, doc 06 approval classes) | Level 1: MJ, 2026-11-19, "Keep salon debt write-offs owner only; owner and manager approve all other write-offs" (PR 115, not merged) | Partly: the threshold question in DA-013 is open | DA-013 |
| C-02 | Who configures installment templates and visit outcomes | O/Mg (PAY-01, PIP-10) | Owner only (doc 06 §2, D-08; as built in `app.owner_set_config`) | Level 2 (D-08) over level 3 (PAY-01) | No | DA-014 |
| C-03 | Receipt delivery to the salon's phone | Within 60 s by WhatsApp or SMS, Phase 1 (CTL-01) | Automatic sending Phase 2 (PAY-03, MSG-01) | Both level 3; ACTIVITY §1 says stop and ask | No (B-08 open) | DA-015 |
| C-04 | Owner digest channel | In-app and WhatsApp, Phase 1 (CTL-15) | WhatsApp and push Phase 2 (MSG-03) | Both level 3 | No | DA-016 |
| C-05 | Hosting | Vercel (D-05, doc 00 item 5, doc 05) | Railway, approved by MJ (`2026-11-10-mj-railway-deploy`) | Level 1 for the deployment; D-05 not amended | No | DA-018 |
| C-06 | Commission payout authority | Owner approves payout (doc 08 §3) | Owner or manager records, no second person (FLD-06, D-38) | Level 2 (D-38) | No (OQ-34 open) | DA-019 |
| C-07 | Task status words | Master-prompt words (AGENTS.md) | Board lifecycle (ACTIVITY §7) | AGENTS.md defers to ACTIVITY.md | No | DA-022 |
| C-08 | Contact deletion on request | Allowed, ledger anonymised (NFR-08) | No hard deletes; full-row audit images (H-07, H-17) | Hard rules (ACTIVITY §5) are non-negotiable | No | DA-036 |
| C-09 | Priority against phase | M means MVP (doc 03 key) | PIP-12, PIP-13, INV-12 M in Phase 2; AGT-04 S in Phase 1 | Doc 03 itself | No | DA-011 |
| C-10 | Per-salon price below list | Office-set price copied onto the line (ORD-01, D-37) | Any price below list needs approval (CTL-07) | Open | No (OQ-33 open) | DA-041 |
| C-11 | Delivery acknowledgement | Signed acknowledgement on every delivery (D-49) | Regular User order delivered at dispatch, no signature (D-61) | Level 2: D-61 is the later decision and names the exception; Client Salon orders keep D-49 | Yes, D-61 (B-60 RESOLVED on `main`; corrected after review) | DA-042 |
| C-12 | Phase gate order | No Phase N+1 task before Gate N (ACTIVITY §8) | Phase 1 started before Gate 0 (D-20) | Level 2 (D-20) | Yes, D-20 | DA-047 |
| C-13 | Returns in Phase 1 | Return movements exist (INV-03, doc 06 §2 "Returns acceptance") | Return workflow is Phase 2 (ORD-06, P2-04) | Both level 3 | No | DA-028 |
| C-14 | Supplier data only in the vault | H-01 | H-17 audit trigger copies full rows into `control.audit_event` | Hard rules both; design gap | No | DA-033 |
| C-15 | Offline check-in window | "B-31 (c) is still MJ's" (PIP-09 note) | 1 hour (MJ, 2026-11-19, PR 115) | Level 1 once PR 115 merges | Yes, pending merge | DA-029 |
| C-16 | Payment reversal limit | Manager checks a reversal up to Rs 10,000, owner above (doc 13 §9, key `approval.payment_reversal.owner_above_paisa`) | Owner or manager reverses with a reason, never the manager's own payment; no amount (D-48; built so, key shown as not used) | Not settled: D-48 (level 2) is silent on the amount, doc 13 §9 (level 3) states one, and the build follows D-48; this audit picks neither | No (B-48 PENDING on `main` and in PR 115) | DA-052 |

## Duplicates and overlaps

| ID | Concept | Stated in | Single source to keep | Finding |
|---|---|---|---|---|
| U-01 | Owner-only powers and approval thresholds | H-15, D-08, SEC-01, CTL-06, doc 06 §2, doc 13 §9 | Permissions: doc 06 §2. Thresholds: doc 13 §9 | DA-039 |
| U-02 | Build status | ACTIVITY §12, doc 03 rows, doc 06 §2 cells, SPEC.md, CONTEXT-MAP.md, execution map, plan README | ACTIVITY §12 for tasks; the generated traceability matrix for requirements | DA-012, DA-038 |
| U-03 | Roles, workflows and permissions | docs 03, 06, 13, 16 and again docs 14, 15, SPEC.md | docs 06 and 16 | DA-037 |
| U-04 | The order request | "order request", "order-intake card", "New Order Details card", "card" | Term "order request"; table `order_intake_card` | DA-040 |
| U-05 | Decision D-51 | two rows in doc 12 | one ID each | DA-005 |
| U-06 | Setting a SKU price | `app.owner_set_sku_price`, `app.office_set_sku_price` | `app.office_set_sku_price` (used by the UI) | DA-050 |
| U-07 | Root instructions | AGENTS.md, CLAUDE.md, ACTIVITY Appendix A | identical by preflight; no conflict | DA-051 |
