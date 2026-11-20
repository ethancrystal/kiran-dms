# User roles and permissions

Derived reference (see [README.md](README.md)). The permission matrix of record is **doc 06 §2**; this file catalogues the actors and summarises the rules. It changes no permission (H-26). Coverage of each capability by a database control is in the [role and permission coverage matrix](../audit/2026-11-19/04-role-permission-coverage-matrix.md).

## 1. Actor catalogue

| Actor | Kind | How it signs in | Source | Built |
|---|---|---|---|---|
| Owner | Staff role `owner` | Email, password, TOTP; office powers at AAL2 | SEC-01, SEC-02, D-14 | Yes (P1-01); real account creation is human-only (ACTIVITY §10) |
| Manager | Staff role `manager` | Same as owner | SEC-01, D-08 as amended by D-31, D-39 | Yes |
| Rep (salaried representative) | Staff role `rep` | Email one-time code, invitation only, approved device | SEC-03, SEC-16 | Yes |
| Salon member | Customer membership linked to one salon, not a staff role | Email one-time code after invitation or approved sign-up | SEC-13, doc 06 §2.1, D-51 (2026-11-09) | Yes |
| Independent agent | Planned role | Like a rep (AGT-01) | D-15 to D-17 | No: `app_role` has no agent value (P1-15) |
| Investor | Record only, no login | — | CAP-01, D-40 | Ledger yes, no login by design |
| Anonymous visitor | Postgres `anon` | None | D-52; B-62 | Two storefront reads since PR 109; not in doc 06 §2 (DA-031) |
| Regular User (shop buyer) | External buyer, no DMS login | Shopify checkout (planned) | D-53, D-59 | No (P1-37) |
| Reminder job | Non-human, service role | Server secret only (H-18) | D-60 | Functions yes, no runner (B-61) |
| Developer or operator | Human | Break-glass only (doc 06 §8) | doc 06 §1 | — |

## 2. Rules that hold for every actor

1. The database is the security boundary: RLS on every table, enabled and forced (H-13); writes to money, stock, stage, credit, approval and vault data only through SECURITY DEFINER functions with a pinned search path and idempotency (H-08). Hiding a button is convenience, never the control.
2. Office powers need AAL2 at the database (D-14).
3. Governance is owner-only at AAL2: users, bank details, write-offs, dated price lists, vault grants, configuration, audit log (H-15), with the recorded exceptions: commission rates (D-31) and inviting, suspending and revoking reps and salons and managing products and prices (D-39) are owner or manager. A manager never creates or promotes an owner or manager.
4. Write-offs: **who approves** is partly decided. MJ said on 2026-11-19 "Keep salon debt write-offs owner only; owner and manager approve all other write-offs" (B-39 a; PR 115, not merged; docs not amended). **The amount threshold** for the other write-offs, and whether doc 13 §9 "always owner" for stock write-offs still holds, is open (DA-013). Until a DECISION amends doc 06 §2 and doc 13 §9, those two documents are the rule of record.
5. Maker is never checker on any approval, as a database constraint (H-12).
6. Reps read through territory-scoped functions with masked phones and at most 50 rows, with no export (H-14).
7. A salon member reaches only its own salon's data; the salon id always comes from the server-side membership (SEC-14).
8. The classified supplier is visible only to the owner and a granted manager (D-03, VLT-06).

## 3. Open permission questions

| Question | Finding | Options |
|---|---|---|
| Write-off threshold amount (who approves is partly decided in PR 115, not merged) | DA-013, B-39 | see the findings register |
| Payment reversal amount limit: doc 13 §9 sends a manager's reversal above Rs 10,000 to the owner; D-48 and the build set no amount | DA-052, B-48 (PENDING on `main` and in PR 115) | keep as built; refuse above the threshold; send to the owner as an approval |
| Office cash after reversing short-handed cash | DA-052, B-48 (b) | who carries the shortage; refuse a reversal that takes office cash below zero or not |
| Handover settlement and who withdraws a count | B-49 | label only or a ledger amount; owner only, or a manager who did not make the count |
| Manager adjustment requests within the threshold; reason on owner discounts | B-50 | threshold as doc 13 says, or owner for every manager request; add a reason field or not |
| What the manager sees of collections refused by the cash cap | B-51 | as built; list reps near the cap; record refused attempts |
| Reps parking salons against "reps cannot change a stage" | B-28 | keep rep parking (doc 02); remove it |
| Who configures installment templates and visit outcomes | DA-014 | owner only, or owner and manager |
| Commission payout authority | DA-019 (OQ-34) | no second person; owner approves all; owner above a threshold |
| Anonymous visitor row in doc 06 §2 | DA-031 | add with the B-62 schema move, or now |
