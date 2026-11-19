# Non-functional requirements

This document is derived reference material written by the 2026-11-19 documentation audit. It never overrides the numbered planning documents, doc 16 or `docs/ACTIVITY.md` (ACTIVITY §1); doc 03 stays the index of requirement IDs and the source of every statement quoted here. Status is derived from the ACTIVITY §12 board and the evidence named, using the vocabulary in [docs/requirements/README.md](README.md#status-vocabulary).

Doc 03 gives NFRs no priority or phase column; which of them are Gate 1 acceptance requirements is open (finding DA-010). Each record adds a measurement method so the numbers can be accepted objectively.

#### NFR-01

**Priority:** — · **Phase:** not stated (DA-010) · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** **Offline-first rep app.** Visits, rep order requests, payments, prospects can be captured with no connectivity and sync within 60 s of reconnecting; conflicts resolved server-side with the rep notified of any rejection
- **Actor:** Rep app (system)
- **Preconditions:** Rep signed in on its approved device; outbox store available
- **Expected behaviour:** Visits, order requests, payments and prospects are captured with no network, queued with a client id, and synced within 60 s of reconnecting; the server decides conflicts and the rep sees every rejection
- **Business rules:** —
- **Permissions:** As the underlying action
- **Failure and exceptions:** Rejected after sync: shown to the rep with the server's reason; storage blocked: the app says so and does not pretend to save
- **Measurement method:** Browser test with the network switched off, then on; timer from reconnect to server row
- **Acceptance criteria:**
  - AC-NFR-01-1: With the network off, a visit is saved locally and reaches the server within 60 s of reconnecting
  - AC-NFR-01-2: A replay of the same queued item creates one row (idempotency key)
  - AC-NFR-01-3: A server rejection after sync appears in `/app/outbox` with its reason
- **Tests:** citing this ID: `e2e-stack/office.spec.ts`, `e2e/outbox-classify.spec.ts`, `e2e/outbox-drain.spec.ts`, `e2e/outbox-history.spec.ts`, `e2e/outbox-queue.spec.ts`, `e2e/rep-login.spec.ts`; through its board task: `e2e/outbox-classify.spec.ts`, `e2e/outbox-crypto.spec.ts`, `e2e/outbox-drain.spec.ts`, `e2e/outbox-history.spec.ts`, `e2e/outbox-queue.spec.ts`
- **Implementation evidence:** board: P1-09 (IN PROGRESS; outbox core merged (PR 103) and history page (PR 107); no page calls submit()); `apps/web/lib/outbox/`; `/app/outbox`; `apps/web/e2e/outbox-*.spec.ts`
- **Known gap:** No page calls `submit()`; no service worker or read cache (P1-09)

#### NFR-02

**Priority:** — · **Phase:** not stated (DA-010) · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** **Performance on low-end Android.** First load ≤ 3 s on 3G after install; interactions ≤ 200 ms locally; bundle under 300 KB gzipped for the rep app shell
- **Actor:** System
- **Preconditions:** Low-end Android profile (doc 01)
- **Expected behaviour:** First load 3 s or less on 3G after install; local interactions 200 ms or less; rep shell bundle under 300 KB gzipped
- **Business rules:** —
- **Permissions:** —
- **Failure and exceptions:** Over budget: CI reports it (not built)
- **Measurement method:** Build output size; Lighthouse or Playwright trace on emulated 3G
- **Acceptance criteria:**
  - AC-NFR-02-1: Rep shell JavaScript is under 300 KB gzipped in the production build
  - AC-NFR-02-2: First load on an emulated 3G low-end profile is 3 s or less
- **Tests:** citing this ID: `e2e/rep-login.spec.ts`; through its board task: `e2e/outbox-classify.spec.ts`, `e2e/outbox-crypto.spec.ts`, `e2e/outbox-drain.spec.ts`, `e2e/outbox-history.spec.ts`, `e2e/outbox-queue.spec.ts`
- **Implementation evidence:** board: P1-09 (IN PROGRESS; outbox core merged (PR 103) and history page (PR 107); no page calls submit()); Playwright rep tests run on a low-end phone profile (`apps/web/e2e`)
- **Known gap:** No bundle-size or load-time check exists

#### NFR-03

**Priority:** — · **Phase:** not stated (DA-010) · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** **English-only UI** (D-42, supersedes the bilingual wording). No Urdu labels and no i18n layer; Roman Urdu is still accepted in free-text fields
- **Actor:** System
- **Preconditions:** —
- **Expected behaviour:** All UI text is English; no Urdu labels, no i18n layer; Roman Urdu accepted in free text
- **Business rules:** —
- **Permissions:** —
- **Failure and exceptions:** —
- **Measurement method:** Source scan for Arabic-script characters in `apps/web`
- **Acceptance criteria:**
  - AC-NFR-03-1: No Urdu script appears in `apps/web` UI strings
  - AC-NFR-03-2: Free-text fields accept Roman Urdu
- **Tests:** citing this ID: none; through its board task: `e2e/outbox-classify.spec.ts`, `e2e/outbox-crypto.spec.ts`, `e2e/outbox-drain.spec.ts`, `e2e/outbox-history.spec.ts`, `e2e/outbox-queue.spec.ts`
- **Implementation evidence:** board: P1-09 (IN PROGRESS; outbox core merged (PR 103) and history page (PR 107); no page calls submit()); D-42; P1-27 removed Urdu spans

#### NFR-04

**Priority:** — · **Phase:** not stated (DA-010) · **Status:** UNVERIFIED (no board task)

- **Statement (doc 03, verbatim):** **Availability.** 99.5% monthly for the back office; rep app usable offline regardless
- **Actor:** System
- **Preconditions:** Hosting chosen (DA-018)
- **Expected behaviour:** Back office available 99.5% per month; the rep app usable offline regardless
- **Business rules:** —
- **Permissions:** —
- **Failure and exceptions:** Outage: rep app keeps working offline (NFR-01)
- **Measurement method:** External uptime monitor over a calendar month
- **Acceptance criteria:**
  - AC-NFR-04-1: Monthly uptime of the office app measured by an external check is at least 99.5%
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none
- **Known gap:** No uptime monitoring exists

#### NFR-05

**Priority:** — · **Phase:** not stated (DA-010) · **Status:** UNVERIFIED (no board task)

- **Statement (doc 03, verbatim):** **Data integrity.** Money and stock tables append-only; all balances derivable by replaying movements; nightly integrity job compares derived vs. stored balances
- **Actor:** System
- **Preconditions:** —
- **Expected behaviour:** Money and stock tables append-only; balances derivable by replaying movements; a nightly job compares derived and stored figures
- **Business rules:** —
- **Permissions:** No application role updates or deletes append-only rows
- **Failure and exceptions:** Mismatch: owner alert (not built)
- **Measurement method:** Database tests; job log
- **Acceptance criteria:**
  - AC-NFR-05-1: UPDATE and DELETE fail on every append-only table for every role
  - AC-NFR-05-2: A nightly integrity job runs and reports zero mismatches
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none; `supabase/tests/append-only-sweep.test.ts`
- **Known gap:** No nightly integrity job

#### NFR-06

**Priority:** — · **Phase:** not stated (DA-010) · **Status:** UNVERIFIED (no board task)

- **Statement (doc 03, verbatim):** **Auditability.** Any record can answer who/when/what-before/what-after
- **Actor:** System
- **Preconditions:** —
- **Expected behaviour:** Any record answers who, when, what before and what after
- **Business rules:** —
- **Permissions:** Owner reads the full audit log; others read scoped timelines
- **Failure and exceptions:** —
- **Measurement method:** Database tests
- **Acceptance criteria:**
  - AC-NFR-06-1: An update to an audited table writes one audit row with actor, time, before and after
  - AC-NFR-06-2: The hash chain verifies after the change
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none; `control.audit_event`; `supabase/tests/foundation.test.ts`
- **Known gap:** No owner audit viewer; full-row images raise DA-033 and DA-036

#### NFR-07

**Priority:** — · **Phase:** not stated (DA-010) · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** **Security baseline.** OWASP ASVS Level 2 as the target; RLS on every table; no service-role key in any client; secrets in environment/secret manager only
- **Actor:** System
- **Preconditions:** —
- **Expected behaviour:** OWASP ASVS Level 2 target; RLS on every table; no service-role key in any client; secrets only in environment or secret manager
- **Business rules:** —
- **Permissions:** —
- **Failure and exceptions:** A table without RLS or a key in client code fails CI
- **Measurement method:** CI checks; ASVS checklist review
- **Acceptance criteria:**
  - AC-NFR-07-1: Every table has RLS enabled and forced (RLS matrix test)
  - AC-NFR-07-2: The service-role scan finds no key name in `apps/` or `packages/` and no key value in the client bundle
- **Tests:** citing this ID: none; through its board task: `append-only-sweep.test.ts`, `function-gates.test.ts`, `launch-acceptance.test.ts`, `schema-hygiene.test.ts`
- **Implementation evidence:** board: P1-12 (NOT STARTED; board says NOT STARTED; plan PR B merged in PR 108 at 7774620 (DA-023)); `supabase/tests/rls-matrix.test.ts`, `schema-hygiene.test.ts`; `scripts/service-role-scan.mjs`; P1-12 part B (PR 108)
- **Known gap:** ASVS review, dependency and secret scans not built (P1-12 parts A and D)

#### NFR-08

**Priority:** — · **Phase:** not stated (DA-010) · **Status:** UNVERIFIED (no board task)

- **Statement (doc 03, verbatim):** **Privacy.** Collect minimum personal data; CNIC encrypted; salon contact deletion on request with ledger retained in anonymised form
- **Actor:** System; owner (requests)
- **Preconditions:** —
- **Expected behaviour:** Minimum personal data; CNIC encrypted; contact deletion on request with the ledger kept anonymised
- **Business rules:** —
- **Permissions:** Owner decides deletion requests
- **Failure and exceptions:** See DA-036: audit images keep old values
- **Measurement method:** Schema inspection; database test
- **Acceptance criteria:**
  - AC-NFR-08-1: No CNIC is stored in plain text
  - AC-NFR-08-2: A deletion request anonymises the contact and keeps ledger totals unchanged
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none
- **Known gap:** No encryption design (DA-035); deletion conflicts with H-07 (DA-036)

#### NFR-09

**Priority:** — · **Phase:** not stated (DA-010) · **Status:** UNVERIFIED (no board task)

- **Statement (doc 03, verbatim):** **Cost.** ≤ USD 60/month infrastructure at launch scale (≤ 10 reps, ≤ 3,000 salons)
- **Actor:** MJ (spend)
- **Preconditions:** Hosting chosen (DA-018)
- **Expected behaviour:** Infrastructure costs USD 60 or less per month at launch scale (10 reps, 3,000 salons)
- **Business rules:** —
- **Permissions:** Spend is MJ's (ACTIVITY §9)
- **Failure and exceptions:** —
- **Measurement method:** Monthly invoices
- **Acceptance criteria:**
  - AC-NFR-09-1: The monthly invoices of all infrastructure services total USD 60 or less at launch scale
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none
- **Known gap:** Not measured

#### NFR-10

**Priority:** — · **Phase:** not stated (DA-010) · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** **Recoverability.** RPO ≤ 24 h (PITR gives minutes), RTO ≤ 4 h
- **Actor:** System; owner (off-site key)
- **Preconditions:** Backups configured (SEC-10)
- **Expected behaviour:** RPO 24 h or less, RTO 4 h or less
- **Business rules:** —
- **Permissions:** —
- **Failure and exceptions:** —
- **Measurement method:** Timed restore drill
- **Acceptance criteria:**
  - AC-NFR-10-1: A restore drill restores data no older than 24 h within 4 h
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none
- **Known gap:** Not built (P1-12 part C)

#### NFR-11

**Priority:** — · **Phase:** not stated (DA-010) · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** **Observability.** Error tracking, sync failure dashboard, audit log search
- **Actor:** System; office
- **Preconditions:** —
- **Expected behaviour:** Error tracking, a sync-failure dashboard and audit log search
- **Business rules:** —
- **Permissions:** Office
- **Failure and exceptions:** —
- **Measurement method:** Inspection
- **Acceptance criteria:**
  - AC-NFR-11-1: A client error appears in the error tracker
  - AC-NFR-11-2: Failed syncs are listed for the office
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none
- **Known gap:** Not built; an error tracker is a new processor (H-21)

#### NFR-12

**Priority:** — · **Phase:** not stated (DA-010) · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** **Testability.** Automated tests for RLS policies (every role × every table), money arithmetic, and the stage machine
- **Actor:** CI
- **Preconditions:** —
- **Expected behaviour:** Automated tests for RLS (every role by every table), money arithmetic and the stage machine
- **Business rules:** —
- **Permissions:** —
- **Failure and exceptions:** A table with no matrix row fails the suite
- **Measurement method:** CI
- **Acceptance criteria:**
  - AC-NFR-12-1: The RLS matrix test fails when a table has no row in it
  - AC-NFR-12-2: Money tests cover rounding in paisa
- **Tests:** citing this ID: `rls-matrix.test.ts`; through its board task: `append-only-sweep.test.ts`, `function-gates.test.ts`, `launch-acceptance.test.ts`, `rls-matrix.test.ts`, `schema-hygiene.test.ts`
- **Implementation evidence:** board: P0-06 (IN PROGRESS); P1-12 (NOT STARTED; board says NOT STARTED; plan PR B merged in PR 108 at 7774620 (DA-023)); `supabase/tests/rls-matrix.test.ts` (coverage guard); CI job "migrations + RLS matrix"
