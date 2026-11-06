# Not yet planned: what remains with no step-level plan

Written 2026-11-06 against `main` at `c2348fb`. This is a register, not a plan. Nothing here may be
built from this file. An item leaves it when MJ has answered its question and a step-level plan for it
exists in `docs/plans/in-progress/`.

Source: `docs/plans/in-progress/2026-11-05-remaining-implementation.md`, the board and blockers in
`docs/ACTIVITY.md`, and a reading of the code on the date above.

## 1. Waiting for a decision of MJ's

| Item | The question | As built today |
|---|---|---|
| Unreconciled handover blocks the next check-in (PIP-09) | What counts as unreconciled: any open handover, only an unanswered one, only one from an earlier day? Does a dispute block? Doc 08 says no exceptions, doc 03 says a manager override: which wins, and is the override the existing withdraw and settle, or a new record? | Check-in is blocked only by an earlier day left open |
| Close a part-delivered order (M6, B-45) | May the office close the undelivered rest with a reason, and when does a delivered order become closed? | No way to close it |
| Receivables by rep (M4, A-14) | Territory, or direct assignment? | Territory |
| Blind stock issue count (REP-05) | Approve narrowing the `stock_issue_select` policy so a rep cannot read a pending issue's quantities; should a disputed issue stay hidden too? | The office's quantities reach the rep's browser |
| Mock-location flag (REP-19) | Where does the flag come from? A browser cannot read the phone's setting; a native wrapper or a heuristic would be needed | All three forms send false |
| Office messages that quote paisa (REP-16, L3) | Change all eight office-only messages too? Which format? | Quoted in paisa |
| Office user on the rep page gets a phone row (AUTH-12) | Refuse only emailed-code office sessions, or every office session? Should office powers require a password session at all? | A row is created |
| Request lines keep the price (AUTH-14) | The price of the order made from the request, or the price when the request was sent? The second puts a price on a table whose rule is "never a price" | Today's price is shown |
| Searching salon pickers past 500 (L7) | Type-to-filter above the list or a combobox; one cap or three | Capped at 500, 500 and 200 |
| Salon receipt view, a payments list, a receipt link in the rep's list (C5) | What is the payments list and for whom; may a salon see the bank reference and the office's reversal reason? The link needs a new field on `app.my_collections` | Office view; the rep's view is H12 of `hermes.md` |
| Salon statement (C5) | A period statement with opening and closing balance, or a printable current position? SAL-12 is Phase 1; the monthly sent statement (CTL-10) is Phase 2 | Balance, invoices and payments on the portal |
| Correction from a count variance (C5) | Post the difference at count time or against stock now; one correction per count line; who checks | Counts are stored; no link to an adjustment |
| Timelines for commission and handover settlements | Neither names a salon or an order. A rep timeline would be new | Not shown |
| Cash of a rep who cannot answer a count (M7 follow-up) | How is it brought in? | Listed for the office (pull request 78), not countable |
| Reversal threshold and short handovers (B-48), dispute variance (B-49), D-45 wording (B-50), cash cap list (B-51) | As worded in `docs/ACTIVITY.md` section 14 | As built |
| Server-side invoice PDF, logo, batch and expiry, signature pictures in Storage (B-46) | As worded in section 14 | None built |
| Lost authenticator and password recovery (B-47) | In-app recovery, or the dashboard steps | Dashboard steps |
| Role change in the app | Should the owner change a person's role on a screen? | No screen |
| Sending receipts by SMS or WhatsApp | Provider and number (OQ-11, B-08) | Adapter stubbed |
| Credit notes and invoice corrections | Phase 2 decision | Not built |

## 2. Decided or unblocked, but no step-level plan is written

Each needs a plan of its own before an implement-only agent can take it.

| Board row | What | Why it matters |
|---|---|---|
| P1-02 part d | The real Excel import (SAL-10). `packages/import` is a dry run and writes nothing; it also needs MJ's file (OQ-01) | Until it exists, every salon is entered by hand; plan section A8 cannot be done as written |
| P1-09 | Offline rep app: outbox, idempotent sync, rejection display | Needed before the field pilot |
| P1-08 | Approval registry (`control.approval_use`, D-25), daily owner digest, bank-detail lock, offboarding in one screen | Before Gate 1; part of it waits on B-39 |
| P1-12 | Security acceptance suite and a backup restore drill | Before Gate 1 |
| P1-05 | Supplier vault: purchase orders, goods receipts, grants | Brings batch and expiry |
| P1-03 | Rep map with pins | |
| P1-10 | In-app notifications | The dashboard part is built |
| P1-17 | Office view of lost demand; bag load suggestion | The rep tap is built |
| P1-15 | Independent agents | Waits on how an agent is represented (B-31 g) |
| P1-11 | The rest of admin config and the rep profile | |
| Frontend foundation | F8 test helpers, F1 generated types, F2 typed RPC client, F3 one component set, F4 one table pattern (`in-progress/2026-11-05-frontend-structure.md` section 3) | Convert a page when its slice touches it |
| Bank deposits with slip photo (CTL-04) | Cash ledger plus storage | |
| Board clean-up, the rest (C8) | Work packages S-A to S-F are not on the board; D-44 is reserved and unused. The "awaiting CI" rows are H15 of `hermes.md` | Records only |

## 3. MJ's own actions before go-live (no agent may do these)

Unchanged from `in-progress/2026-11-05-remaining-implementation.md` section A: approve applying the
migrations to the Kiran project, create the owner account with TOTP, hosted sign-in settings, the two
web deployment variables, rotate the keys (B-25), set the `KIRAN_SENSITIVE_TERMS` secret, enter the
real company details, products and salons, and take advice on investor terms.
