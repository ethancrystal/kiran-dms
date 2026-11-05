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
| **Manager** (insider, high trust, same operational power as owner) | Cover a rep's or own theft; divert bank transfers; erase debts of friends; leak supplier | Full operational access; approves rep actions; counts cash; handles stock adjustments; invites reps and salons and sets prices (D-39) | Fake handover counts; adjustments/write-offs; credit-note abuse; price overrides; a ghost rep; changing bank details; vault leak |
| **Salon** (external counterparty) | Avoid paying; claim non-delivery; collude with rep | Receives goods, pays cash | Dispute paid amounts; fake returns with rep |
| **Competitor** | Get the salon list, prices, supplier | Bribe a rep or manager; buy a leaked export | Exfiltration via insider |
| **Thief / finder of a lost phone** | Opportunistic | Physical device | Session reuse; cached data |
| **Internet attacker** | Data, ransom, defacement | Scanning, phishing, credential stuffing | Owner/manager account takeover; API abuse; misconfigured storage |
| **Developer / operator (MJ, contractors)** | Usually benign; must still be bounded | Production access | Accidental exposure; a contractor with service keys |

## 2. Roles and the permission matrix

Three roles at launch. **Manager = Owner for operations; Owner alone holds governance.** The split exists so that no single person below the owner can both commit and conceal (doc 13).

**Amended by MJ on 2026-11-05 (D-33 to D-41; decision file `2026-11-05-mj-reps-salons-orders`, H-26).** A row marked "approved, not built" states the approved rule; until its slice ships, the database still behaves as the earlier rule said (for example, before slice 7, a rep could edit a salon). Do not read such a row as current behaviour; the status board says what exists.

| Capability | Rep | Manager | Owner |
|---|---|---|---|
| See salons | Reachable salons only, read-only (a direct assignment, else territory coverage, D-36; built in slice 1, migration 20261105100000, not verified); phones masked in lists | All | All |
| Edit a salon | No, read-only (D-35; built in slice 7: `app.update_salon` refuses every rep, migration 20261105160000, not verified) | All | All |
| Salon notes | Reachable salons | All | All |
| Propose a new salon, pin included | Yes, stays pending (D-35; built in slice 7: `app.create_salon` by a rep makes a pending salon with no assignment, reachable under D-36 territory coverage meanwhile; no card or order until approved, migration 20261105160000, not verified) | Adds approved salons directly | Same as manager |
| Approve or reject a proposed salon; assign or change a rep; set the rate | — | Yes (D-35, D-36; built in slice 1: `app.office_decide_salon`, `app.office_assign_salon_rep`, not verified) | Yes |
| Change salon stage manually | — | With reason | With reason |
| Log visits, deliveries, payments | Own | Own + on behalf (flagged) | Same as manager |
| Create official sales orders (D-30, D-34) | — (submits order requests; reads relevant orders) | Yes; converts, approves or rejects rep and salon requests (built in slice 6, migration 20261105150000, not verified: one-click `app.office_create_order` with the request's lines and the version seen, `app.office_dismiss_card`; prices from the database only) | Same as manager |
| Submit an order request; edit or cancel it before review | Reachable salons; own requests (D-34) | — | — |
| Approve a delivery | — (submits; collects as approved, D-32) | Yes, never its own (D-32; built in slice 4: `app.office_approve_delivery`, `app.office_reject_delivery`, `app.office_resolve_pending`, migration 20261105130100, not verified) | Yes |
| Discount below list price | — (no orders, D-30) | Approve (not own requests) | Approve; the owner's own discount on an office order the owner creates needs no approval and is recorded on the order (MJ, ACTIVITY L-0390) |
| Credit limit override / unblock salon | — | Yes, logged, capped per salon/month | Yes |
| Handover count | Acknowledge only | Enter count | Enter count |
| Bank deposit recording | — | Yes | Yes |
| Bank statement import & matching | — | Yes | Yes |
| Stock issue to rep / receive from rep | — | Yes | Yes |
| Stock adjustment / write-off | — | Request; approve below threshold if not maker | Approve above threshold |
| Returns acceptance | Request | Accept at warehouse | Accept |
| Credit note (return/price correction) | — | Below threshold, not own | Any |
| **Receivable write-off** | — | — | **Owner only** |
| **Dated price lists** (ORD-07, Phase 2) | — | View | **Owner only** |
| Products, pictures, descriptions, SKU prices, per-salon prices | Read | Manage; a price needs a reason and is kept in `sku_price_change` or `salon_sku_price` for the owner's digest (D-37, D-39; built in slice 2, migration 20261105110000, not verified; the digest itself is P1-08, not built) | Manage |
| **Installment templates, credit rules, config** | — | View | **Owner only** |
| **Company bank account details** | — | View | **Owner only (MFA re-auth)** |
| Reps and salons: invite, suspend, revoke | — | Yes (D-39; built in slice 1: `app.office_invite`, `app.office_revoke_invitation`, `app.office_set_member_status`, not verified) | Yes |
| **Users: create or promote an owner or manager; role changes; agent accounts; offboarding** | — | No; the database refuses (D-39) | **Owner only** |
| Device approval for reps | — | Yes | Yes |
| Territories, route days | — | Yes | Yes |
| **Commission rates** (per rep and salon with a rep default, D-38; built in slice 5, not verified) | View own (D-31) | Set and change rates; view all (D-31; MJ, ACTIVITY L-0385) | Set and change rates; view all (D-31; MJ, ACTIVITY L-0385) |
| Commission payments and reversals (D-38, supersedes earned-only; built in slice 5, not verified) | View own earned, paid, owed and history, read-only | Record; view all | Record; view all |
| Investor ledger: investors, investments, typed profit decisions, payouts, reversals (D-40; built in slice 3: `app.office_create_investor`, `app.office_update_investor`, `app.office_add_investment`, `app.office_decide_profit`, `app.office_record_payout`, `app.office_reverse_investor_entry` and the `app.office_investor*` reads, at AAL2, not verified; no second person, OQ-34 default) | — (reads no row, refused by every function) | Yes | Yes |
| Salon and order timelines (scoped office functions over `control.audit_event`, D-39; built in slice 7: `app.office_salon_timeline`, `app.office_order_timeline` at AAL2, allow-listed fields only: when, actor name and kind, an action label, an enum detail or the names of changed salon fields, the entity and its id; never the row images, ip, device, purpose or hash; the phone-reveal log, stock, vault and investor tables are not read; migration 20261105160000, not verified) | — | Yes | Yes |
| Approvals queue read (`app.office_pending_approvals`, slice 8, migration 20261105170000, not verified: pending discount and adjustment requests and approved, unused adjustments on a warehouse or bag; allow-listed fields: kind, status, subject, maker name, required checker role, reason, time, whether the caller made it, the order's salon and amounts, the location, SKU code and quantity; never the raw payload; deciding stays `app.decide_approval`) | — | Yes | Yes |
| **Vault (supplier, costs, POs, receipts)** | — | If granted by owner (default: granted) | Yes; grants are owner-only |
| Exports (watermarked) | — | Operational reports | All |
| **Audit log, anomaly flags, cases** (the full log; timelines are the row above) | — | Read own-team flags | **Owner: read all; nobody can write** |
| Daily exception digest | — | Receives a team copy | Receives full digest |
| Break-glass SQL | — | — | Owner + developer, two-person, logged |

**Overview reads as built (slice 9, P1-26, migration 20261105180000; not verified):** they follow the rows above and add no permission. `app.office_overview_counts`, `app.office_overview_rows`, `app.office_investor_month` and `app.office_rep_month` call `app.assert_office` (owner or manager at AAL2); `app.my_month_orders` answers only a rep on its approved phone and takes no rep id, so a rep reads only its own orders (its commission stays `app.my_commission`). They return names, statuses, dates and order, invoice, commission and investor amounts: no credit snapshot or limit, stock, phone, pin, cost, margin or vault field. Salons get nothing new. Reading writes no row, not even an audit row.

**Invoice composer and customer acknowledgement as built (P1-31, D-49, migration 20261105220000; not verified):** no role gains a power; MJ's rule adds a condition. A delivery is final only with the salon's signed acknowledgement of exactly the goods and the owner's or manager's approval; the refusal is in PostgreSQL, on the invoice insert, so it holds for every path and not only the buttons. Who may do what: a rep on an approved phone records the acknowledgement of its own undecided submission only (`app.rep_attach_signature`) and sees its status without the picture (`app.my_signature_status`); the owner or manager at AAL2 prepares display text (`app.office_save_invoice_draft`), sees the draft (`app.office_invoice_preview`), reads an acknowledgement's status (`app.office_delivery_signature`), opens the picture (`app.office_signature_image`, which writes an access record each time) and records the acknowledgement for an order the office delivers itself (`app.office_attach_signature`); a salon login lists and opens its own invoices only (`app.salon_my_invoices`, `app.salon_invoice_document`), never another salon's, never the picture. `delivery_signature` and `delivery_signature_image` have no grant to any API role; the other new tables are office-readable and append-only. The picture is checked to be a PNG of at most 120,000 bytes, hashed, and bound to a hash of the salon, order and exact lines; a refusal is recorded honestly and does not count; one acknowledgement makes one delivery final, once. It is an electronic proof of receipt, not a legally qualified electronic signature. No supplier, cost or margin field is in any of the documents.

**Rep detail and document lists as built (slice 10, P1-28, migration 20261105190000; not verified):** they follow the rows above and add no permission. `app.office_rep_detail`, `app.office_invoices` and `app.office_receipts` are owner or manager at AAL2 (`app.assert_office`); anon, reps, salons and office sessions at AAL1 get 42501, a missing or unknown id or a non-rep id gets 22023. The rep JSON is allow-listed: a masked phone (`app.mask_phone`), no device fingerprint, no GPS, no bag value limit, no cost, credit snapshot or vault field. `app.invoice_document` and `app.receipt_document` are unchanged: null for an unknown id or a caller they do not serve. Hiding a sidebar item is convenience only; no office page is owner-only yet, so none is hidden from the manager (A-21).

The permission matrix above remains the approved business requirement. **Payments as built (B-37 resolved by MJ, ACTIVITY L-0362):** a rep records its own collections at the salon (`app.rep_record_payment`); the owner or manager records cash collected from a salon (`app.office_record_cash`, migration 0024; the cash enters the office pool, never a rep's ledger, flagged `office_collected`) and a bank transfer on behalf (`app.office_record_payment`, flagged `on_behalf`). Who may make an official order follows D-30 (ACTIVITY L-0363) as amended by D-34: the office only; reps and salons submit order requests. Its first part (PR A, ACTIVITY L-0391) is built on branch claude/orders-delivery-commission, awaiting an independent check: the owner or manager creates orders (`app.office_create_order`, with an optional assigned rep from the salon's territory reps, or none), reps record order cards (`app.rep_create_card`) that the office converts or dismisses, reps read orders read-only, and `app.create_order` refuses every caller. Delivery approval (D-32) is built in slice 4 (P1-21, migration 20261105130100, not verified): a rep's delivery is a submission (`app.rep_submit_delivery`) that moves the goods to the rep's pending location; only the owner's or manager's approval (`app.office_approve_delivery`, never the submitter, SEC-11) writes the delivery, the sale out of pending, the invoice and installments and the order status, through the one internal path `app.finalise_delivery`, which `app.office_deliver` also uses; `app.rep_deliver` refuses everyone and has no grant. A rejection keeps the submission and the goods stay in pending custody until the office settles them (`app.office_resolve_pending`: back to the bag, to a warehouse, or missing with an approved adjustment; `app.office_post_adjustment` refuses a pending location). The rep collects after approval (MJ, 2026-11-04, the plan's decision 1). Commission (D-31, D-38) is built in slice 5 (P1-22, migration 20261105140000, not verified): the owner or manager at AAL2 sets a rep's default rate (`app.office_set_commission_rate`) and a salon's rate with its rep (slice 1), records payments and full reversals (`app.office_record_commission_payment`, `app.office_reverse_commission_payment`, no checker under the OQ-34 default) and reads every rep (`app.office_commission`, `app.office_commission_reps`); a rep reads only its own statement on its approved phone (`app.my_commission`, no rep id taken), and has no read of the two tables; a salon login reads nothing. The rate is stamped on the invoice at approval and never moves.

**Approval classification (D-32, spec section 5; the owner's own discount, ACTIVITY L-0390):**

| Class | Operations |
|---|---|
| Rep submits, recorded and audited, no approval | visits, notes, salon sign-up, order cards, payments at the salon, delivery submissions, bag counts, handover answers |
| Office approval before the official state changes | delivery finalisation (invoice, stock sale, order status, commission input), card conversion into an order, discount below list (except the owner's own discount on an office order the owner creates, recorded on the order, L-0390), stock adjustment and write-off requests (P1-08) |
| Owner-only governance | users, price lists, bank details, write-offs above threshold, configuration, vault grants (D-08); commission rates are owner or manager (L-0385) |
| System-generated, immutable | invoices, receipt numbers, installments, audit events, stage events, cash ledger rows |

Permissions are enforced in three places that must agree: RLS policies (data), `SECURITY DEFINER` functions (actions), and UI (convenience only — never the control).

### 2.1 Salon customer identity and authorization boundary

A Salon Customer is an external customer membership, not a fourth internal staff role. Do not add salon to user_profile.role or infer a portal identity from salon_contact.phone. Use a separately auditable membership linking an authenticated auth user to an explicitly authorized salon. The owner or manager invites, suspends and revokes salon accounts (D-30, D-39, ACTIVITY L-0363); access is invitation-only (the owner or manager invites; no public sign-up) and one salon per login (D-30, ACTIVITY L-0376); one login per salon for now; salon staff do not get their own logins (ACTIVITY L-0382). Default one membership to one salon; multiple-salon membership requires an explicit decision and additional RLS tests.

| Capability | Salon customer | Enforcement boundary |
|---|---|---|
| View catalogue | Shared active products/SKUs | Allow-listed customer read function |
| View prices | Only own salon's approved prices, otherwise list price (D-37) | Server derives salon membership; never accepts salon_id as authority |
| View stock | Not in the current work (INV-12, Phase 2; D-41). Then safe aggregate on-hand/available quantity only | Sanitized stock projection; no raw stock tables or locations |
| Submit an order request; edit or cancel before review | Own salon only; a request, not an official order (D-34) | Dedicated customer RPC; idempotency; the office converts through the canonical order engine; no price taken from the submitter |
| Create, approve or modify an official order | No | Office only (D-34) |
| View requests, orders, documents, payments and balance | Own salon's records only | Membership-scoped reads and private signed document access |
| View reps/visits | No rep GPS or internal visit notes | No access to field-workforce functions |
| Manage salon or users | No; correction request only | Office workflow; no direct master-data writes |
| View supplier/cost/margin | Never | No schema/table/function exposure |

Customer RLS/RPC tests must prove that Salon A cannot read, update, create an order for or download documents for Salon B by changing IDs, URLs, query filters, RPC arguments or object-storage paths. Revoked/suspended memberships must fail immediately. Salon functions must not call rep functions under the salon user's identity and must not grant access to internal CRM notes, rep location, cash/bag custody, price governance, credit decision internals or other salons.

Built in slice 1 (migration 20261105100000, not verified): the membership, invitation-only, one salon per login, suspension and revocation that stop at once, and `app.salon_me` (own salon's name, address, approval and account status; it takes no salon id). Built in slice 6 (migration 20261105150000, not verified): the catalogue with the salon's own price else list (`app.salon_catalogue`), submit, edit and cancel of its own requests before review (`app.salon_submit_request`, `app.salon_edit_request`, `app.salon_cancel_request`), and its requests, orders, balance, installments still due and payments (`app.salon_my_requests`, `app.salon_my_orders`, `app.salon_my_account`). Each resolves the salon from the active membership with an emailed-code session and takes no salon id; another salon's request and an unknown id get the same refusal; the reps' cards are not shown to the salon (they are internal notes). Customer documents (invoice and receipt files) and stock (INV-12) are not built. The staff roles stay owner, manager and rep; the office permission matrix is section 2 above.

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

Approved, not built (D-39, SEC-16): reps and salons join by invitation only, with the invitation link and the email one-time code. Auth signup is on for the email code only and the invite page is the only page that creates a login; a login with nothing redeemed has no profile and RLS shows it nothing. Turning this on for a real project is MJ's (spec section 8); until then the project keeps sign-up off as in the Gate 0 checklist. Salon sessions are online only; no device binding is specified for them.

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
- **Read functions for reps** (built as functions, not views; DEVIATION in ACTIVITY, P1-02 part a). Reps read salon data only through `app.*` functions that check the rep's current territories, limit columns, mask phone numbers and cap a page at 50 rows **in the database**, not only in the API layer (`app.my_areas`, `app.my_bag` and `app.warehouse_availability` return the whole, small list; `app.my_route` and `app.order_remaining` are bounded by the 50-stop and 50-line limits): `app.my_salons`, `app.my_areas`, `app.salon_notes`, `app.salon_stages` (migration 0009), `app.salon_visits`, `app.my_day` (migration 0010), `app.due_list`, `app.my_route` (migration 0011), `app.salon_credit_status`, `app.my_orders` (migration 0012), `app.order_remaining` (migration 0013), `app.invoice_document` (migration 0014: one invoice of the rep's own orders, from `public` only, doc 07 §3), `app.my_bag`, `app.warehouse_availability` (migration 0008), `app.salon_installments`, `app.salon_balance`, `app.my_cash_position` and `app.receipt_document` (migration 0021), `app.my_cards` (the rep's newest 50 order cards and how each ended) and `app.my_territory_orders` (read-only, the newest 50 orders of salons in the rep's current territories, whoever made them) (migration 20261104090000, D-30, MJ L-0385). The office reads a rep's cash position through `app.office_rep_cash_position`. Reps may read only their own `payment`, `receipt` and `cash_ledger_entry` rows directly; `installment` and `payment_allocation` remain office-only at the table. Reps also read a few tables directly, own rows only: their `rep_day`, `route`, `sales_order` and its lines, deliveries, delivery lines and invoices (migrations 0010 to 0013; since migration 20261104090000 the order's rep or its assigned rep reads an order, its lines and deliveries), their own `order_intake_card` rows and the `order_intake_card_close` rows of those cards (migration 20261104090000, D-30), and the active catalogue, their own bag's stock rows and daily closes, and their own demand signals (migration 0008). Salon data is reachable only through the functions above. Every security-relevant view would otherwise need `security_invoker` and its own matrix rows; a function also lets the page cap be enforced where no client can raise it.
- **Salon tables are office-only at the table.** `salon`, `salon_contact`, `salon_note` and `stage_event` have RLS policies that show rows only to AAL2 office users, so a rep's direct query returns nothing. `app.reveal_phone(salon_id)` returns one salon's phone to a rep in that territory and logs the reveal in `control.phone_reveal` (owner-readable).
- **Governance tables** (`price_list`, `plan_template`, `company_bank_account`, `user_profile` writes, `commission_plan`) require `owner` **and** AAL2; the exceptions are the commission rate, which the owner or manager may set (D-31), and inviting, suspending and revoking reps and salons (built in slice 1) and managing products, pictures and SKU and per-salon prices (built in slice 2), which the owner or manager may do at AAL2 (D-39). A manager never creates or promotes an owner or manager.
- **Storage policies** mirror table policies: a rep can read a receipt PDF only for an invoice they can see; `vault-docs` is readable only by vault grantees via 5-minute signed URLs generated server-side.
- **Policy tests in CI** (NFR-12): a matrix test logs in as each role (and as a rep in territory A vs. B) and asserts, per table and function, exactly what is allowed. A failing test blocks deploy.

## 5. Data protection

| Data | Protection |
|---|---|
| Supplier identity, terms, costs, lot numbers | `vault` schema; column encryption with keys in Supabase Vault / `pgsodium`, decrypted only inside grantee-checked functions; separate access log; private bucket; no API exposure (doc 07) |
| CNIC numbers (reps) | Encrypted column; shown last-4 only; full value owner-only with log |
| Salon phones | Masked in lists; reveal-per-record logged; never in exports available to reps |
| Photos (frontage, slips, visit) | Private buckets; signed URLs; EXIF stripped except GPS/time which are stored as fields and then removed from the file |
| Product pictures | Private bucket `product-images` (migration 20261105110000): the owner or a manager at AAL2 inserts, updates and deletes only `products/{uuid}/{uuid}.png`, `.jpg`, `.jpeg` or `.webp`; an active staff profile (a rep on its approved device) or an active salon member who proved the email reads; an unredeemed login reads nothing. PNG, JPEG, WebP, 5 MB set on the bucket. Pages use signed URLs. Not exposed to anon |
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
| Suspected cash skimming | Freeze rep's ability to submit order requests and record payments; pull salon statements for the rep's salons; run balance confirmations on all | Case opened; doc 13 investigation steps |
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
