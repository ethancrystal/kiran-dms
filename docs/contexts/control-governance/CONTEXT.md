# Control and Governance — module document (context `control-governance`)

This document is derived reference material written by the 2026-11-19 documentation audit. It never overrides the numbered planning documents, doc 16 or `docs/ACTIVITY.md` (ACTIVITY §1); doc 03 stays the index of requirement IDs and the source of every statement quoted here. Status is derived from the ACTIVITY §12 board and the evidence named, using the vocabulary in [docs/requirements/README.md](../../requirements/README.md#status-vocabulary).

## 1. Purpose and boundaries

What the owner reads and decides, and the identity layer: staff roles and users, devices and sessions, invitations and salon memberships, the approval framework (maker is never checker), the audit log and its hash chain, write-off and adjustment approvals, the daily digest, balance confirmations, bank-detail lock, offboarding, backups and the security acceptance suite.

**Outside this module:** Controls that live inside the context they guard (for example the cash cap in money-credit, the bag cap in inventory), per CONTEXT-MAP.md.

## 2. Glossary

- **AAL2:** An MFA-verified session; required at the database for office powers (D-14).
- **Approval request:** A row in `control.approval_request`; the checker can never be the maker (H-12).
- **Digest:** The owner's daily list of exceptions (CTL-15).
- **Timeline:** A scoped, allow-listed read of the audit log for one salon or order; not the audit log (D-39).

## 3. Actors and permissions

Owner: governance powers (H-15) and the full audit log. Manager: operational access, invitations and suspensions of reps and salons (D-39), device approval, team digest. Rep, salon member: their own session and device only. Anonymous visitor and the reminder job: see the role catalogue. Matrix: doc 06 §2.

## 4. Owned entities and data

Tables owned (from the migrations on `main` at `d4b47ca`): `user_profile`, `device`, `app_config`, `invitation`, `salon_membership`, `control.approval_request`, `control.audit_event`, `control.audit_chain_head`, `control.doc_counter`, `control.approval_reminder_log`. Ownership follows CONTEXT-MAP.md; no table is owned by two modules.

## 5. Functional requirements

22 requirements, in doc 03 order. Phase 1 requirements carry a full record; later-phase requirements carry their statement and status.

#### SEC-01

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Roles: owner, manager, rep. Manager = full operational access; owner = operational + governance (users, bank details, write-offs/credit notes, price lists, commission plans, vault grants, audit log, configuration; commission rates: owner or manager, D-31, MJ L-0385; reps and salons (invite, suspend, revoke), products, pictures, descriptions and SKU and per-salon prices: owner or manager, D-39). A manager never creates or promotes an owner or manager. Permission matrix in doc 06 enforced by RLS and server-side checks
- **Actor:** Owner; manager; rep; salon member (separate)
- **Preconditions:** —
- **Expected behaviour:** Three staff roles; manager has operational access; owner holds governance, with the D-31 and D-39 exceptions
- **Business rules:** Doc 06 §2 is the matrix of record
- **Permissions:** —
- **Failure and exceptions:** Manager calls to owner-only functions are refused
- **Acceptance criteria:**
  - AC-SEC-01-1: Every owner-only function refuses a manager
  - AC-SEC-01-2: The role test matrix covers owner, manager, rep, salon member and anon
- **Tests:** citing this ID: `crm-attacks.test.ts`; through its board task: `device-guard.test.ts`, `e2e/rep-login.spec.ts`, `foundation.test.ts`, `reverify-attacks.test.ts`, `reverify10-attacks.test.ts`, `reverify11-attacks.test.ts`, `reverify2-attacks.test.ts`, `reverify3-attacks.test.ts`, `reverify4-attacks.test.ts`, `reverify5-attacks.test.ts`, `reverify6-attacks.test.ts`, `reverify7-attacks.test.ts`, `reverify9-attacks.test.ts`, `verifier-attacks.test.ts`
- **Implementation evidence:** board: P1-01 (VERIFIED); `supabase/tests/rls-matrix.test.ts`, `foundation.test.ts`; P1-01 VERIFIED in L-0116 covers the three-role split only
- **Known gap:** The D-31 and D-39 exceptions were built later (P1-18, P1-19, P1-22) and are not verified

#### SEC-02

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** O/Mg login: email + password + TOTP MFA mandatory
- **Actor:** Owner, manager
- **Preconditions:** Account exists
- **Expected behaviour:** Email, password and TOTP MFA; office functions require AAL2
- **Business rules:** D-14
- **Permissions:** —
- **Failure and exceptions:** An AAL1 office call is refused
- **Acceptance criteria:**
  - AC-SEC-02-1: An office function called at AAL1 is refused
- **Tests:** citing this ID: `handovers.test.ts`, `receivables-ageing.test.ts`; through its board task: `device-guard.test.ts`, `e2e/rep-login.spec.ts`, `foundation.test.ts`, `reverify-attacks.test.ts`, `reverify10-attacks.test.ts`, `reverify11-attacks.test.ts`, `reverify2-attacks.test.ts`, `reverify3-attacks.test.ts`, `reverify4-attacks.test.ts`, `reverify5-attacks.test.ts`, `reverify6-attacks.test.ts`, `reverify7-attacks.test.ts`, `reverify9-attacks.test.ts`, `verifier-attacks.test.ts`
- **Implementation evidence:** board: P0-05 (IN PROGRESS); P1-01 (VERIFIED); `/office/mfa`; `supabase/tests/foundation.test.ts`

#### SEC-03

**Priority:** M · **Phase:** 1 · **Status:** VERIFIED

- **Statement (doc 03, verbatim):** Rep login: email one-time code (MJ decision, ACTIVITY L-0101; was phone OTP), after joining by invitation (SEC-16); device binding — first device auto-registered, new device requires Mg approval
- **Actor:** Rep
- **Preconditions:** Invitation redeemed
- **Expected behaviour:** Email one-time code; first device auto-registered; a new device needs manager approval
- **Business rules:** L-0101
- **Permissions:** Office approves devices
- **Failure and exceptions:** A call from an unapproved device is refused
- **Acceptance criteria:**
  - AC-SEC-03-1: A rep call from an unapproved device is refused
- **Tests:** citing this ID: `e2e-stack/office.spec.ts`, `crm-attacks.test.ts`, `foundation.test.ts`, `handovers.test.ts`, `invitations.test.ts`, `verifier-attacks.test.ts`, `verify-slices-1-3.test.ts`; through its board task: `device-guard.test.ts`, `e2e/rep-login.spec.ts`, `foundation.test.ts`, `reverify-attacks.test.ts`, `reverify10-attacks.test.ts`, `reverify11-attacks.test.ts`, `reverify2-attacks.test.ts`, `reverify3-attacks.test.ts`, `reverify4-attacks.test.ts`, `reverify5-attacks.test.ts`, `reverify6-attacks.test.ts`, `reverify7-attacks.test.ts`, `reverify9-attacks.test.ts`, `verifier-attacks.test.ts`
- **Implementation evidence:** board: P1-01 (VERIFIED); `/app/login`; `supabase/tests/device-guard.test.ts`; `apps/web/e2e/rep-login.spec.ts`

#### SEC-04

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Sessions: rep 14 days with re-auth on sensitive actions; O/Mg 12 hours; immediate revoke by O/Mg
- **Actor:** System; office (revoke)
- **Preconditions:** —
- **Expected behaviour:** Rep sessions 14 days with re-auth on sensitive actions; office 12 hours; immediate revoke
- **Business rules:** —
- **Permissions:** Office revokes
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-SEC-04-1: After revocation the next call is refused
- **Tests:** citing this ID: `e2e-stack/office.spec.ts`, `foundation.test.ts`; through its board task: `device-guard.test.ts`, `e2e/rep-login.spec.ts`, `foundation.test.ts`, `reverify-attacks.test.ts`, `reverify10-attacks.test.ts`, `reverify11-attacks.test.ts`, `reverify2-attacks.test.ts`, `reverify3-attacks.test.ts`, `reverify4-attacks.test.ts`, `reverify5-attacks.test.ts`, `reverify6-attacks.test.ts`, `reverify7-attacks.test.ts`, `reverify9-attacks.test.ts`, `verifier-attacks.test.ts`
- **Implementation evidence:** board: P0-05 (IN PROGRESS); P1-01 (VERIFIED); `supabase/tests/device-guard.test.ts`
- **Known gap:** Session lengths are auth configuration; not evidenced by a test

#### SEC-05

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Append-only audit log of all writes to money, stock, salon, user and vault tables, plus all vault reads
- **Actor:** System
- **Preconditions:** —
- **Expected behaviour:** Append-only audit of writes to money, stock, salon, user and vault tables, plus vault reads
- **Business rules:** H-17
- **Permissions:** No application role writes it
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-SEC-05-1: Every audited write adds one `control.audit_event` row
  - AC-SEC-05-2: `control.verify_audit_chain` verifies the chain
- **Tests:** citing this ID: `foundation.test.ts`; through its board task: `device-guard.test.ts`, `e2e/rep-login.spec.ts`, `foundation.test.ts`, `reverify-attacks.test.ts`, `reverify10-attacks.test.ts`, `reverify11-attacks.test.ts`, `reverify2-attacks.test.ts`, `reverify3-attacks.test.ts`, `reverify4-attacks.test.ts`, `reverify5-attacks.test.ts`, `reverify6-attacks.test.ts`, `reverify7-attacks.test.ts`, `reverify9-attacks.test.ts`, `verifier-attacks.test.ts`
- **Implementation evidence:** board: P1-01 (VERIFIED); `supabase/tests/foundation.test.ts`, `append-only-sweep.test.ts`
- **Known gap:** Vault read logging waits for P1-05

#### SEC-06

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** No bulk export, copy-all, or list-download for reps; O/Mg exports watermarked with user + timestamp and logged
- **Actor:** Rep (none); office
- **Preconditions:** —
- **Expected behaviour:** No bulk export for reps; office exports watermarked and logged
- **Business rules:** —
- **Permissions:** Office
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-SEC-06-1: No rep screen or function returns more than a page of rows
  - AC-SEC-06-2: Each office export is watermarked and logged
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-08 (NOT STARTED)
- **Known gap:** No export feature exists, so the watermark is not built

#### SEC-07

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Rate limits on list endpoints; page size caps for reps
- **Actor:** System
- **Preconditions:** —
- **Expected behaviour:** Rate limits on list endpoints; page caps for reps
- **Business rules:** H-14 caps of 50
- **Permissions:** —
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-SEC-07-1: Rep list functions return at most 50 rows
- **Tests:** citing this ID: none; through its board task: `device-guard.test.ts`, `e2e/rep-login.spec.ts`, `foundation.test.ts`, `reverify-attacks.test.ts`, `reverify10-attacks.test.ts`, `reverify11-attacks.test.ts`, `reverify2-attacks.test.ts`, `reverify3-attacks.test.ts`, `reverify4-attacks.test.ts`, `reverify5-attacks.test.ts`, `reverify6-attacks.test.ts`, `reverify7-attacks.test.ts`, `reverify9-attacks.test.ts`, `verifier-attacks.test.ts`
- **Implementation evidence:** board: P1-01 (VERIFIED); `apps/web/e2e/list-cap-note.spec.ts`; `supabase/config.toml` auth rate limits
- **Known gap:** List-endpoint rate limits not built (DA-026)

#### SEC-08

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** One-click offboarding: disable user, revoke sessions and devices, reassign territories, snapshot their bag stock and cash position
- **Actor:** Owner
- **Preconditions:** User exists
- **Expected behaviour:** One-click offboarding disables the user, revokes sessions and devices, reassigns territories, snapshots bag and cash
- **Business rules:** —
- **Permissions:** Owner only
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-SEC-08-1: After offboarding the user's calls are refused and a snapshot exists
- **Tests:** citing this ID: `b33-decisions.test.ts`, `reverify-slices-1-3.test.ts`; through its board task: none
- **Implementation evidence:** board: P1-08 (NOT STARTED); `app.owner_set_status`; `supabase/tests/b33-decisions.test.ts`
- **Known gap:** One-screen offboarding not built (P1-08)

#### SEC-09

**Priority:** C · **Phase:** 3 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Honeytoken salons (fake records visible only to one rep each) to detect list leakage
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### SEC-10

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Backups: PITR + weekly encrypted off-site export; restore drill quarterly
- **Actor:** Owner (human-only off-site key)
- **Preconditions:** —
- **Expected behaviour:** PITR plus weekly encrypted off-site export; quarterly restore drill
- **Business rules:** ACTIVITY §10
- **Permissions:** —
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-SEC-10-1: A restore drill restores the latest backup and the audit chain verifies
- **Tests:** citing this ID: none; through its board task: `append-only-sweep.test.ts`, `function-gates.test.ts`, `launch-acceptance.test.ts`, `schema-hygiene.test.ts`
- **Implementation evidence:** board: P1-12 (NOT STARTED; board says NOT STARTED; plan PR B merged in PR 108 at 7774620 (DA-023))
- **Known gap:** Not built (P1-12 part C)

#### SEC-11

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Maker-checker: the user who initiates an approval-gated action can never approve it; approvals are recorded with approver, time and reason
- **Actor:** Any office user
- **Preconditions:** Approval-gated action
- **Expected behaviour:** The initiator never approves; approvals record approver, time and reason
- **Business rules:** H-12 database constraint
- **Permissions:** —
- **Failure and exceptions:** Self-approval refused
- **Acceptance criteria:**
  - AC-SEC-11-1: An approval by its maker is refused by a database constraint
- **Tests:** citing this ID: `audit-fixes.test.ts`, `crm-attacks.test.ts`, `foundation.test.ts`, `orders.test.ts`; through its board task: `device-guard.test.ts`, `e2e-stack/office.spec.ts`, `e2e/rep-login.spec.ts`, `foundation.test.ts`, `office-approvals.test.ts`, `office-orders.test.ts`, `reverify-attacks.test.ts`, `reverify10-attacks.test.ts`, `reverify11-attacks.test.ts`, `reverify2-attacks.test.ts`, `reverify3-attacks.test.ts`, `reverify4-attacks.test.ts`, `reverify5-attacks.test.ts`, `reverify6-attacks.test.ts`, `reverify7-attacks.test.ts`, `reverify9-attacks.test.ts`, `verifier-attacks.test.ts`
- **Implementation evidence:** board: P1-01 (VERIFIED); P1-25 (IN PROGRESS); `supabase/tests/foundation.test.ts`, `office-approvals.test.ts`

#### SEC-12

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Audit log lives in a schema no application role can write to directly (populated by triggers), is hash-chained, and is mirrored nightly to write-only storage controlled by the owner
- **Actor:** System; owner (storage)
- **Preconditions:** —
- **Expected behaviour:** Audit in a schema no app role writes, hash-chained, mirrored nightly to owner-controlled write-only storage
- **Business rules:** H-17
- **Permissions:** Nobody writes
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-SEC-12-1: No application role can INSERT into `control.audit_event`
  - AC-SEC-12-2: A nightly mirror file exists for each day
- **Tests:** citing this ID: `foundation.test.ts`; through its board task: `device-guard.test.ts`, `e2e/rep-login.spec.ts`, `foundation.test.ts`, `reverify-attacks.test.ts`, `reverify10-attacks.test.ts`, `reverify11-attacks.test.ts`, `reverify2-attacks.test.ts`, `reverify3-attacks.test.ts`, `reverify4-attacks.test.ts`, `reverify5-attacks.test.ts`, `reverify6-attacks.test.ts`, `reverify7-attacks.test.ts`, `reverify9-attacks.test.ts`, `verifier-attacks.test.ts`
- **Implementation evidence:** board: P1-01 (VERIFIED); `supabase/tests/foundation.test.ts`
- **Known gap:** Nightly mirror not built (DA-026)

#### SEC-13

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Salon portal identity is a separate customer membership linked to specific salon IDs, never an internal staff role; accounts are created, suspended and revoked by the owner or manager and audited (D-30): by office invitation, or by the salon's own sign-up once the office approves it (D-51, MJ 2026-11-09; reps stay invitation-only), one salon per login (ACTIVITY L-0376); one login per salon for now, no staff sub-accounts (ACTIVITY L-0382). Phase moved by D-41
- **Actor:** Owner or manager
- **Preconditions:** —
- **Expected behaviour:** Salon identity is a separate membership linked to one salon, never a staff role; created by invitation or approved sign-up
- **Business rules:** D-30, D-51 (2026-11-09)
- **Permissions:** Office
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-SEC-13-1: `user_profile.role` has no salon value
  - AC-SEC-13-2: One login maps to one salon
- **Tests:** citing this ID: none; through its board task: `audit-fixes.test.ts`, `b33-decisions.test.ts`, `e2e-stack/p130-screens.spec.ts`, `e2e/list-cap-note.spec.ts`, `e2e/salon-signup.spec.ts`, `e2e/time.spec.ts`, `invitations.test.ts`, `reverify-slices-1-3.test.ts`, `salon-approval.test.ts`, `salon-self-signup.test.ts`, `verify-slices-1-3.test.ts`
- **Implementation evidence:** board: P1-18 (IN PROGRESS); P1-30 (IN PROGRESS); `supabase/tests/invitations.test.ts`, `salon-self-signup.test.ts`

#### SEC-14

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Salon portal RLS/RPCs enforce own-salon-only access to profile, price, requests, orders and customer documents (aggregate stock too when INV-12 arrives); cross-salon ID tampering and revoked membership are denied by database tests. Phase moved by D-41
- **Actor:** System
- **Preconditions:** Active membership
- **Expected behaviour:** Portal RLS and functions enforce own-salon-only access; tampering and revoked membership denied by database tests
- **Business rules:** —
- **Permissions:** —
- **Failure and exceptions:** Denied
- **Acceptance criteria:**
  - AC-SEC-14-1: A salon id swapped in a call returns no other salon's data
  - AC-SEC-14-2: A revoked member reads nothing
- **Tests:** citing this ID: none; through its board task: `e2e/salon-login.spec.ts`, `office-order-access.test.ts`, `office-orders.test.ts`, `order-cards.test.ts`, `requests-portal.test.ts`
- **Implementation evidence:** board: P1-23 (IN PROGRESS); `supabase/tests/requests-portal.test.ts`

#### SEC-15

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Salon/customer functions expose only allow-listed catalogue/price/customer-document data (aggregate stock too when INV-12 arrives); no supplier, cost, margin, internal inventory location, rep GPS or internal CRM notes. Phase moved by D-41
- **Actor:** System
- **Preconditions:** —
- **Expected behaviour:** Salon functions return only allow-listed fields; no supplier, cost, margin, location, rep GPS or CRM notes
- **Business rules:** H-05
- **Permissions:** —
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-SEC-15-1: No salon function returns a field outside its allow-list
- **Tests:** citing this ID: none; through its board task: `e2e/salon-login.spec.ts`, `office-order-access.test.ts`, `office-orders.test.ts`, `order-cards.test.ts`, `requests-portal.test.ts`
- **Implementation evidence:** board: P1-23 (IN PROGRESS); `supabase/tests/requests-portal.test.ts`

#### SEC-16

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Invitations (D-39): the office creates an invitation for a rep or a salon and shares the link. The token is random, stored hashed, single use, expires in 7 days and is bound to the invited email. The invitee confirms that email with the one-time code and the database redeems the token, creating the rep profile or the salon membership. No service-role key in the app (H-18). The invite page is the only page that creates a login; a login with nothing redeemed has no profile and RLS shows it nothing. A rep still needs phone approval (SEC-03)
- **Actor:** Owner or manager (invite); invitee
- **Preconditions:** —
- **Expected behaviour:** Random, hashed, single-use, 7-day token bound to the invited email; redeemed by the database after email OTP
- **Business rules:** No service-role key (H-18)
- **Permissions:** Office
- **Failure and exceptions:** Expired, used or wrong-email token refused
- **Acceptance criteria:**
  - AC-SEC-16-1: A token older than 7 days is refused
  - AC-SEC-16-2: A second redemption is refused
  - AC-SEC-16-3: The token is stored only as a hash
- **Tests:** citing this ID: none; through its board task: `audit-fixes.test.ts`, `b33-decisions.test.ts`, `e2e-stack/p130-screens.spec.ts`, `e2e/list-cap-note.spec.ts`, `e2e/salon-signup.spec.ts`, `e2e/time.spec.ts`, `invitations.test.ts`, `reverify-slices-1-3.test.ts`, `salon-approval.test.ts`, `salon-self-signup.test.ts`, `verify-slices-1-3.test.ts`
- **Implementation evidence:** board: P1-18 (IN PROGRESS); P1-30 (IN PROGRESS); `/invite/[token]`; `supabase/tests/invitations.test.ts`

#### SEC-17

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** The manager may invite, suspend and revoke reps and salons; only the owner creates or promotes an owner or manager, and agent accounts stay owner-created (AGT-01). The database refuses a manager who tries, as a role test (D-39)
- **Actor:** Owner; manager
- **Preconditions:** —
- **Expected behaviour:** The manager invites, suspends and revokes reps and salons; only the owner creates or promotes an owner or manager
- **Business rules:** D-39
- **Permissions:** —
- **Failure and exceptions:** A manager creating an owner or manager is refused
- **Acceptance criteria:**
  - AC-SEC-17-1: A manager call to create or promote an owner or manager is refused
- **Tests:** citing this ID: none; through its board task: `e2e/salon-signup.spec.ts`, `invitations.test.ts`, `reverify-slices-1-3.test.ts`, `salon-approval.test.ts`, `salon-self-signup.test.ts`, `verify-slices-1-3.test.ts`
- **Implementation evidence:** board: P1-18 (IN PROGRESS); `supabase/tests/invitations.test.ts`

#### CTL-06

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Stock adjustments and write-offs require a reason and photo; any adjustment, write-off, credit note or receivable write-off above a configurable threshold requires owner approval; all are in the daily digest
- **Actor:** Manager (request); owner or manager (approve, see DA-013)
- **Preconditions:** Reason and photo
- **Expected behaviour:** Adjustments and write-offs need a reason and photo; above a threshold owner approval; all in the digest
- **Business rules:** MJ 2026-11-19: salon debt write-offs owner only; owner and manager approve other write-offs (PR 115)
- **Permissions:** See DA-013
- **Failure and exceptions:** Missing reason or photo refused
- **Acceptance criteria:**
  - AC-CTL-06-1: An adjustment without a reason is refused
  - AC-CTL-06-2: A receivable write-off by a manager is refused
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-08 (NOT STARTED); `app.owner_adjust_stock`, `app.office_post_adjustment`
- **Known gap:** Write-off approvals and digest not built (P1-08)

#### CTL-11

**Priority:** M · **Phase:** 1 (manual list) / S|2 (automated WhatsApp confirm) · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Weekly random balance-confirmation sample: the system picks N salons per rep; owner or manager calls and records the salon's stated balance; mismatches open a case
- **Actor:** Owner or manager
- **Preconditions:** —
- **Expected behaviour:** Weekly random sample of N salons per rep; the office records the salon's stated balance; mismatches open a case
- **Business rules:** Manual list in Phase 1
- **Permissions:** Office
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-CTL-11-1: The sample lists N salons per rep each week
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-08 (NOT STARTED)
- **Known gap:** Not built (P1-08)

#### CTL-14

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Anomaly detection jobs (doc 13 §7) run nightly and feed the owner digest: location/time anomalies, burst-recording, round-number patterns, repeated variances, rep-change churn, duplicate devices, mock-location signals
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### CTL-15

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Daily owner exception digest (in-app and WhatsApp): every override, adjustment, variance, discount, credit note, unblock, new device, failed sync, vault read, anomaly flag, agent purchase (with a flag on unusually large ones, D-22, OQ-22), invitation, manager price change, commission rate change, commission payment and investor payout (D-38 to D-40) from the last 24 h
- **Actor:** System; owner (reads)
- **Preconditions:** —
- **Expected behaviour:** Daily owner exception digest of the listed events from the last 24 h
- **Business rules:** Channel see DA-016
- **Permissions:** Owner full; manager team copy
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-CTL-15-1: Each listed event type in the last 24 h appears in the digest
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-08 (NOT STARTED)
- **Known gap:** Not built (P1-08)
- **Open or related decisions:** OQ-22

#### CTL-16

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Company bank account details used on invoices are owner-only to change, require MFA re-authentication, and trigger a notification to all owner contacts
- **Actor:** Owner
- **Preconditions:** AAL2 re-authentication
- **Expected behaviour:** Company bank details are owner-only to change, need MFA re-auth and notify all owner contacts
- **Business rules:** —
- **Permissions:** Owner only
- **Failure and exceptions:** A manager change is refused
- **Acceptance criteria:**
  - AC-CTL-16-1: A manager call is refused
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-08 (NOT STARTED)
- **Known gap:** Not built (P1-08)

## 6. Business rules

Rules cited by this module's requirements: D-14, D-22, D-30, D-31, D-38, D-39, D-40, D-41, D-51, H-05, H-12, H-14, H-17, H-18, H-22. Their text and single source are in [business-rules.md](../../requirements/business-rules.md); thresholds are doc 13 §9, permissions are doc 06 §2.

## 7. User journeys

- J-CG-1 Invite a rep or salon (SEC-16): link, e-mail code, redemption.
- J-CG-2 Approve a device (SEC-03).
- J-CG-3 Approve a write-off or adjustment (CTL-06): not built.
- J-CG-4 Read the daily digest (CTL-15): not built.
- J-CG-5 Offboard a user (SEC-08): status change exists, one-screen offboarding not built.

Full journeys with steps: [journeys-and-workflows.md](../../requirements/journeys-and-workflows.md).

## 8. Cross-module interactions

Every context writes audit rows through triggers; approvals gate discounts (orders-delivery), adjustments (inventory) and write-offs (money-credit); reminders (P1-38) read pending approvals.

## 9. Security requirements

Audit schema writable by triggers only, hash-chained (H-17); maker-checker as a constraint (H-12); governance owner-only at AAL2 (H-15); no service-role key in the app (H-18, scanned in CI); `control.audit_event` stores full-row images, so any audit reader must be owner-only and redact vault rows (DA-033).

## 10. Failure scenarios

- Manager tries to create an owner: refused (SEC-17).
- Approval by its maker: refused by constraint.
- Audit chain break: `control.verify_audit_chain` reports it; nightly mirror not built (DA-026).
- Backup restore: not built (SEC-10).

## 11. Acceptance criteria

29 criteria (IDs `AC-<requirement>-<n>`) are in the records above and in the [acceptance criteria matrix](../../audit/2026-11-19/05-acceptance-criteria-matrix.md).

## 12. Dependencies

Mail service for reminders (B-61); messaging (B-08) for the digest channel; owner continuity (B-03); off-site backup account (human-only, ACTIVITY §10).

## 13. Implementation status and evidence

| Requirement | Phase | Status | Board tasks | Tests citing the ID |
|---|---|---|---|---|
| SEC-01 | 1 | IMPLEMENTED — NOT VERIFIED | P1-01 | 1 |
| SEC-02 | 1 | IMPLEMENTED — NOT VERIFIED | P0-05, P1-01 | 2 |
| SEC-03 | 1 | VERIFIED | P1-01 | 7 |
| SEC-04 | 1 | PARTIALLY IMPLEMENTED | P0-05, P1-01 | 2 |
| SEC-05 | 1 | PARTIALLY IMPLEMENTED | P1-01 | 1 |
| SEC-06 | 1 | NOT STARTED | P1-08 | 0 |
| SEC-07 | 1 | PARTIALLY IMPLEMENTED | P1-01 | 0 |
| SEC-08 | 1 | NOT STARTED | P1-08 | 2 |
| SEC-09 | 3 | DEFERRED — FUTURE PHASE | — | 0 |
| SEC-10 | 1 | NOT STARTED | P1-12 | 0 |
| SEC-11 | 1 | IMPLEMENTED — NOT VERIFIED | P1-01, P1-25 | 4 |
| SEC-12 | 1 | PARTIALLY IMPLEMENTED | P1-01 | 1 |
| SEC-13 | 1 | IMPLEMENTED — NOT VERIFIED | P1-18, P1-30 | 0 |
| SEC-14 | 1 | IMPLEMENTED — NOT VERIFIED | P1-23 | 0 |
| SEC-15 | 1 | IMPLEMENTED — NOT VERIFIED | P1-23 | 0 |
| SEC-16 | 1 | IMPLEMENTED — NOT VERIFIED | P1-18, P1-30 | 0 |
| SEC-17 | 1 | IMPLEMENTED — NOT VERIFIED | P1-18 | 0 |
| CTL-06 | 1 | NOT STARTED | P1-08 | 0 |
| CTL-11 | 1 (manual list) / S|2 (automated WhatsApp confirm) | NOT STARTED | P1-08 | 0 |
| CTL-14 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| CTL-15 | 1 | NOT STARTED | P1-08 | 0 |
| CTL-16 | 1 | NOT STARTED | P1-08 | 0 |
