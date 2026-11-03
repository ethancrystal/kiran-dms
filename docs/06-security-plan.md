# 06 — Security Plan

Security here means three things, in order of how likely they are to hurt Kiran:

1. **Insider misuse** — a rep or manager taking cash, stock, the salon list, or the supplier's identity. Covered jointly by this document and doc 13.
2. **Data leakage** — the salon list (with phones) or the supplier compartment reaching a competitor.
3. **External compromise** — stolen phone, phished owner account, a bug exposing data.

Target baseline: OWASP ASVS Level 2. Everything below is a launch requirement unless marked otherwise.

## 1. Threat model

| Actor | Motivation | Capabilities | Highest-impact attacks |
|---|---|---|---|
| **Rep** (insider, low trust) | Pocket cash; sell stock off-book; take salons to a competitor; inflate commission | Own phone with approved device; sees own territories; can be offline; may collude with salons | Skim collections; under-record payments; off-book sales; fake salons/visits; list exfiltration via screenshots |
| **Manager** (insider, high trust, same operational power as owner) | Cover a rep's or own theft; divert bank transfers; erase debts of friends; leak supplier | Full operational access; approves rep actions; counts cash; handles stock adjustments | Fake handover counts; adjustments/write-offs; credit-note abuse; price overrides; changing bank details; vault leak |
| **Salon** (external counterparty) | Avoid paying; claim non-delivery; collude with rep | Receives goods, pays cash | Dispute paid amounts; fake returns with rep |
| **Competitor** | Get the salon list, prices, supplier | Bribe a rep or manager; buy a leaked export | Exfiltration via insider |
| **Thief / finder of a lost phone** | Opportunistic | Physical device | Session reuse; cached data |
| **Internet attacker** | Data, ransom, defacement | Scanning, phishing, credential stuffing | Owner/manager account takeover; API abuse; misconfigured storage |
| **Developer / operator (MJ, contractors)** | Usually benign; must still be bounded | Production access | Accidental exposure; a contractor with service keys |

## 2. Roles and the permission matrix

Three roles at launch. **Manager = Owner for operations; Owner alone holds governance.** The split exists so that no single person below the owner can both commit and conceal (doc 13).

| Capability | Rep | Manager | Owner |
|---|---|---|---|
| See salons | Own territories only; phones masked in lists | All | All |
| Create/edit salon, pins, notes | Own territories | All | All |
| Change salon stage manually | — | With reason | With reason |
| Log visits, deliveries, payments | Own | Own + on behalf (flagged) | Same as manager |
| Create official sales orders (D-30) | — (records order-intake cards; reads its territories' orders) | Yes; converts a rep's card into an order | Same as manager |
| Discount below list price | — (no orders, D-30) | Approve (not own requests) | Approve |
| Credit limit override / unblock salon | — | Yes, logged, capped per salon/month | Yes |
| Handover count | Acknowledge only | Enter count | Enter count |
| Bank deposit recording | — | Yes | Yes |
| Bank statement import & matching | — | Yes | Yes |
| Stock issue to rep / receive from rep | — | Yes | Yes |
| Stock adjustment / write-off | — | Request; approve below threshold if not maker | Approve above threshold |
| Returns acceptance | Request | Accept at warehouse | Accept |
| Credit note (return/price correction) | — | Below threshold, not own | Any |
| **Receivable write-off** | — | — | **Owner only** |
| **Price lists** | — | View | **Owner only** |
| **Installment templates, credit rules, config** | — | View | **Owner only** |
| **Company bank account details** | — | View | **Owner only (MFA re-auth)** |
| **Users: create, role, suspend, offboard** | — | — | **Owner only** |
| Device approval for reps | — | Yes | Yes |
| Territories, route days | — | Yes | Yes |
| Commission plans / payout approval | — | View | **Owner only** |
| **Vault (supplier, costs, POs, receipts)** | — | If granted by owner (default: granted) | Yes; grants are owner-only |
| Exports (watermarked) | — | Operational reports | All |
| **Audit log, anomaly flags, cases** | — | Read own-team flags | **Owner: read all; nobody can write** |
| Daily exception digest | — | Receives a team copy | Receives full digest |
| Break-glass SQL | — | — | Owner + developer, two-person, logged |

The permission matrix above remains the approved business requirement. **Payments as built (B-37 resolved by MJ, ACTIVITY L-0362):** a rep records its own collections at the salon (`app.rep_record_payment`); the owner or manager records cash collected from a salon (`app.office_record_cash`, migration 0024; the cash enters the office pool, never a rep's ledger, flagged `office_collected`) and a bank transfer on behalf (`app.office_record_payment`, flagged `on_behalf`). Who may place an order follows D-30 (ACTIVITY L-0363): the office and the salon portal only; reps record order-intake cards. That rework is not built yet: until it lands, the code still lets a rep create an order (`app.create_order`) and does not let the office.

Permissions are enforced in three places that must agree: RLS policies (data), `SECURITY DEFINER` functions (actions), and UI (convenience only — never the control).

### 2.1 Salon customer identity and authorization boundary

A Salon Customer is an external customer membership, not a fourth internal staff role. Do not add salon to user_profile.role or infer a portal identity from salon_contact.phone. Use a separately auditable membership linking an authenticated auth user to an explicitly authorized salon. The owner or manager creates and revokes salon accounts (D-30, ACTIVITY L-0363); access is invitation-only (the owner or manager invites; no public sign-up) and one salon per login (D-30, ACTIVITY L-0376); salon staff do not get their own logins: one login per salon (ACTIVITY L-0379). Default one membership to one salon; multiple-salon membership requires an explicit decision and additional RLS tests.

| Capability | Salon customer | Enforcement boundary |
|---|---|---|
| View catalogue | Shared active products/SKUs | Allow-listed customer read function |
| View prices | Only own salon's effective approved prices | Server derives salon membership; never accepts salon_id as authority |
| View stock | Safe aggregate on-hand/available quantity only | Sanitized stock projection; no raw stock tables or locations |
| Submit order | Own salon only | Dedicated customer RPC; common canonical order engine; idempotency |
| View orders/documents | Own salon's records only | Membership-scoped reads and private signed document access |
| View reps/visits | No rep GPS or internal visit notes | No access to field-workforce functions |
| Manage salon or users | No; correction request only | Office workflow; no direct master-data writes |
| View supplier/cost/margin | Never | No schema/table/function exposure |

Customer RLS/RPC tests must prove that Salon A cannot read, update, create an order for or download documents for Salon B by changing IDs, URLs, query filters, RPC arguments or object-storage paths. Revoked/suspended memberships must fail immediately. Salon functions must not call rep functions under the salon user's identity and must not grant access to internal CRM notes, rep location, cash/bag custody, price governance, credit decision internals or other salons.

The existing staff roles and office permission matrix below remain unchanged.

## 3. Authentication and sessions

| Control | Owner / Manager | Rep |
|---|---|---|
| Primary factor | Email + password (≥ 12 chars, breached-password check) | Email + one-time code (MJ decision, ACTIVITY L-0101; was phone number + SMS/WhatsApp OTP) |
| Second factor | **TOTP mandatory**; recovery codes stored offline by owner | Device binding (below); optional PIN for app open |
| Device binding | Recommended (remembered devices list, alerts on new) | **Mandatory**: first device auto-registered; any new device → `pending` until a manager/owner approves; max 1 active device per rep by default |
| Session lifetime | 12 h; re-auth (MFA) for: bank details, price lists, user management, vault, write-offs, exports | 14 days rolling; re-auth (OTP) for: payment reversal request, viewing a phone number outside today's route |
| Step-up | AAL2 required in RLS for governance tables (`auth.jwt()->>'aal' = 'aal2'`) | — |
| Revocation | Owner can kill any session/device instantly; takes effect on next request and on next sync for cached data | Same; plus automatic revoke at offboarding |
| Lockout | 5 failed attempts → 15 min; alert owner on 10 | OTP rate-limited per email address and per device |
| Shared logins | Prohibited by policy; detected by concurrent sessions from distinct device fingerprints → anomaly | Same |

## 4. Data access — Row-Level Security strategy

- **Deny by default.** `ALTER TABLE … ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` on every table in `public`, `control`, `vault`. No policy → no access, including for table owners.
- **Role from the database, not the token.** A stable function `app.current_role()` (implemented as `app.user_role()`, because `CURRENT_ROLE` is a reserved SQL keyword) reads `user_profile.role` for `auth.uid()`; policies call it. Changing a role is an owner action with an audit event; it takes effect immediately.
- **Territory scoping for reps.** Example policy (illustrative only: the salon tables are office-only at the table and reps read them through functions, see below):

```sql
create policy rep_select_salon on public.salon
for select to authenticated
using (
  app.current_role() in ('owner','manager')
  or (
    app.current_role() = 'rep'
    and salon.is_honeytoken = false  -- honeytokens are handled by a separate policy
    and exists (
      select 1 from public.rep_territory rt
      join public.area a on a.territory_id = rt.territory_id
      where rt.rep_id = auth.uid()
        and rt.to_date is null
        and a.id = salon.area_id
    )
  )
);
```

- **Write paths are functions.** Application roles get `INSERT`/`UPDATE` on almost nothing. For payments, a rep calls `app.rep_record_payment(...)`; the office calls `app.office_record_cash(...)` for cash it collected and `app.office_record_payment(...)` for an on-behalf bank transfer. All three use internal `app.record_payment(...)`, which is not executable by application roles. Each wrapper validates its actor-specific conditions; the shared function pins `search_path`, validates payment rules, writes the rows and lets triggers write `audit_event`. Other sensitive writes use their documented `app.*` functions. Append-only tables have no `UPDATE`/`DELETE` policies at all.
- **Read functions for reps** (built as functions, not views; DEVIATION in ACTIVITY, P1-02 part a). Reps read salon data only through `app.*` functions that check the rep's current territories, limit columns, mask phone numbers and cap a page at 50 rows **in the database**, not only in the API layer (`app.my_areas`, `app.my_bag` and `app.warehouse_availability` return the whole, small list; `app.my_route` and `app.order_remaining` are bounded by the 50-stop and 50-line limits): `app.my_salons`, `app.my_areas`, `app.salon_notes`, `app.salon_stages` (migration 0009), `app.salon_visits`, `app.my_day` (migration 0010), `app.due_list`, `app.my_route` (migration 0011), `app.salon_credit_status`, `app.my_orders` (migration 0012), `app.order_remaining` (migration 0013), `app.invoice_document` (migration 0014: one invoice of the rep's own orders, from `public` only, doc 07 §3), `app.my_bag`, `app.warehouse_availability` (migration 0008), `app.salon_installments`, `app.salon_balance`, `app.my_cash_position` and `app.receipt_document` (migration 0021). The office reads a rep's cash position through `app.office_rep_cash_position`. Reps may read only their own `payment`, `receipt` and `cash_ledger_entry` rows directly; `installment` and `payment_allocation` remain office-only at the table. Reps also read a few tables directly, own rows only: their `rep_day`, `route`, `sales_order` and its lines, deliveries, delivery lines and invoices (migrations 0010 to 0013), and the active catalogue, their own bag's stock rows and daily closes, and their own demand signals (migration 0008). Salon data is reachable only through the functions above. Every security-relevant view would otherwise need `security_invoker` and its own matrix rows; a function also lets the page cap be enforced where no client can raise it.
- **Salon tables are office-only at the table.** `salon`, `salon_contact`, `salon_note` and `stage_event` have RLS policies that show rows only to AAL2 office users, so a rep's direct query returns nothing. `app.reveal_phone(salon_id)` returns one salon's phone to a rep in that territory and logs the reveal in `control.phone_reveal` (owner-readable).
- **Governance tables** (`price_list`, `plan_template`, `company_bank_account`, `user_profile` writes, `commission_plan`) require `owner` **and** AAL2.
- **Storage policies** mirror table policies: a rep can read a receipt PDF only for an invoice they can see; `vault-docs` is readable only by vault grantees via 5-minute signed URLs generated server-side.
- **Policy tests in CI** (NFR-12): a matrix test logs in as each role (and as a rep in territory A vs. B) and asserts, per table and function, exactly what is allowed. A failing test blocks deploy.

## 5. Data protection

| Data | Protection |
|---|---|
| Supplier identity, terms, costs, lot numbers | `vault` schema; column encryption with keys in Supabase Vault / `pgsodium`, decrypted only inside grantee-checked functions; separate access log; private bucket; no API exposure (doc 07) |
| CNIC numbers (reps) | Encrypted column; shown last-4 only; full value owner-only with log |
| Salon phones | Masked in lists; reveal-per-record logged; never in exports available to reps |
| Photos (frontage, slips, visit) | Private buckets; signed URLs; EXIF stripped except GPS/time which are stored as fields and then removed from the file |
| Cached data on rep phones | Encrypted IndexedDB (WebCrypto, key in memory per session); wiped on logout/revoke/7 days offline |
| In transit | TLS everywhere; HSTS; no mixed content |
| At rest | Provider-managed disk encryption + column encryption for the sensitive fields above |
| Backups | Provider PITR (7–28 days) + weekly `pg_dump` encrypted with an owner-held key to a separate cloud account; vault tables included (encrypted columns stay encrypted) |
| Exports | Owner/manager only; generated server-side; watermarked (user, timestamp, purpose) on every page/sheet; row-count limits; 15-minute link expiry; logged |
| Logs | No secrets or full phone numbers in application logs |

## 6. Audit and tamper evidence

- Triggers on every table in `public` and `vault` write to `control.audit_event` (actor, role, device, IP, before/after JSON, purpose when supplied).
- `audit_event` is **insert-only for triggers** — no application role, not even owner, has `INSERT`/`UPDATE`/`DELETE` on it.
- Each row stores `prev_hash` and `hash = sha256(prev_hash || canonical_json(row))`. A nightly job verifies the chain and mirrors new rows to **owner-controlled, write-only object storage** in a separate cloud account. If the database were ever altered by someone with superuser access, the mirror and the broken chain would show it.
- Vault reads are logged separately in `vault.vault_access_log` and surfaced in the owner digest.
- Retention: audit events kept for 7 years (financial records practice); salon personal data deleted on request with ledger rows anonymised.

## 7. Application and API hardening

- Input validation server-side (database constraints + function argument checks); client validation is UX only.
- Rate limits per user and per IP on auth, OTP, list endpoints, discovery calls, and exports.
- Security headers (CSP, frame-ancestors none, referrer-policy), CSRF protection on office forms, no `dangerouslySetInnerHTML` with user content.
- Dependency scanning and lockfile pinning; renovate PRs reviewed.
- Supabase **service-role key** only in Edge Functions and CI secrets; rotated quarterly or on any suspicion; never in Next.js server env for routes reachable by users without an explicit allow-list.
- Edge Functions verify the caller's JWT and role before doing anything privileged.
- Third-party keys (maps/places, WhatsApp, SMS) live in server env only; discovery and messaging run server-side.
- Staging uses anonymised data and dummy vault rows; production data never leaves production except as encrypted backups.

## 8. Operational security

- **Phones:** reps use a company-provided or approved personal Android with screen lock enforced by the app (refuses to run without device lock + up-to-date OS); mock-location setting detected and flagged; app refuses to work on rooted devices where detectable.
- **Rep email:** rep login addresses are company mailboxes where possible, so a departing rep cannot keep receiving sign-in codes (ACTIVITY L-0101; was company SIMs for phone OTP).
- **Offboarding runbook (SEC-08):** suspend user → revoke sessions and devices → snapshot and transfer bag stock and cash position → reassign territories → notify assigned salons of the new rep (from the system, so the old rep cannot "introduce" themselves as still with Kiran) → archive. Target: under 10 minutes, all in one owner screen.
- **Break-glass:** direct SQL in production requires owner approval recorded in a `case`, a time-boxed credential, and the session log attached to the case afterwards.
- **Owner account recovery:** recovery codes printed and kept offline; a second owner-role account for continuity, disabled by default, enable requires the first owner or the documented recovery process.
- **Vendor list and review:** Supabase, Vercel, maps/places provider, WhatsApp BSP, SMS gateway, email provider, error tracking — reviewed yearly for data-handling terms.

## 9. Incident response (short form)

| Scenario | First 30 minutes | Then |
|---|---|---|
| Lost/stolen rep phone | Owner/manager revokes device + sessions; cache becomes unreadable on next contact and auto-wipes after 7 days | Reissue device; review that rep's day for gaps |
| Suspected cash skimming | Freeze rep's ability to take orders; pull salon statements for the rep's salons; run balance confirmations on all | Case opened; doc 13 investigation steps |
| Suspected list leak | Check honeytoken contact attempts; review reveal-phone logs and export logs by user | Rotate honeytokens; disciplinary/legal |
| Owner/manager account compromise | Kill all sessions; reset MFA; review audit for governance changes (bank details, price lists, users) | Restore from audit evidence; rotate keys |
| Vault exposure suspected | Review `vault_access_log`; revoke manager grant if needed | Assess what was visible; inform supplier if terms require |
| Data corruption / bad deploy | Roll back deploy; PITR to before the incident if needed | Post-mortem recorded in doc 12 |

## 10. Security acceptance criteria for launch

1. RLS matrix tests pass for every table × role, including a rep in territory A failing to read territory B.
2. No application role can `UPDATE`/`DELETE` on any append-only table (tested).
3. Owner/manager cannot log in without TOTP; rep cannot operate from an unapproved device (tested).
4. Vault columns are unreadable via the REST API with any user token (tested); vault reads appear in the access log and the digest.
5. Audit hash chain verifies; mirror receives rows nightly.
6. A full offboarding completes from one screen in under 10 minutes (rehearsed).
7. Backup restore drill performed once before go-live, documented.
8. Dependency and secret scans clean; service-role key absent from all client bundles (checked in CI).
