# Field Operations — module document (context `field-operations`)

This document is derived reference material written by the 2026-11-19 documentation audit. It never overrides the numbered planning documents, doc 16 or `docs/ACTIVITY.md` (ACTIVITY §1); doc 03 stays the index of requirement IDs and the source of every statement quoted here. Status is derived from the ACTIVITY §12 board and the evidence named, using the vocabulary in [docs/requirements/README.md](../../requirements/README.md#status-vocabulary).

## 1. Purpose and boundaries

The rep's working day: territories and their areas, rep assignment to territories, check-in and check-out, visits, routes and stops, the rep profile and, later, scorecards and location. It answers "where is each rep supposed to be and what did they do".

**Outside this module:** Salon records (salon-pipeline); order requests (orders-delivery); cash and commission (money-credit); bag stock (inventory).

## 2. Glossary

- **Rep day:** One working day of a rep, opened by check-in and closed by check-out or by the office's force-close with a reason.
- **Visit:** An append-only record of a rep at a salon with server time and GPS (PIP-02).
- **Route:** An ordered list of stops with reasons for one rep and day (PIP-03).

## 3. Actors and permissions

Owner and manager: territories, routes, force-close, device approval. Rep: own day, own visits, own route. Matrix: doc 06 §2 rows "Log visits, deliveries, payments", "Territories, route days", "Device approval for reps".

## 4. Owned entities and data

Tables owned (from the migrations on `main` at `d4b47ca`): `territory`, `area`, `rep_territory`, `rep_day`, `visit`, `route`, `route_stop`. Ownership follows CONTEXT-MAP.md; no table is owned by two modules.

## 5. Functional requirements

13 requirements, in doc 03 order. Phase 1 requirements carry a full record; later-phase requirements carry their statement and status.

#### PIP-01

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Define territories as named sets of areas; assign one or more territories to a rep
- **Actor:** Owner or manager
- **Preconditions:** —
- **Expected behaviour:** Territories are named sets of areas; a rep is assigned one or more territories
- **Business rules:** —
- **Permissions:** Office
- **Failure and exceptions:** A rep cannot change territories
- **Acceptance criteria:**
  - AC-PIP-01-1: The office creates a territory with areas and assigns it to a rep
  - AC-PIP-01-2: A rep's reachable salons change when its territories change (SAL-14)
- **Tests:** citing this ID: `e2e-stack/office.spec.ts`, `b33-decisions.test.ts`, `reverify-slices-1-3.test.ts`, `salons.test.ts`; through its board task: `b33-decisions.test.ts`, `create-salon-blanks.test.ts`, `crm-attacks.test.ts`, `salons.test.ts`, `visits.test.ts`
- **Implementation evidence:** board: P0-03 (NOT STARTED); P1-02 (IN PROGRESS); `/office/territories`; `supabase/tests/b33-decisions.test.ts`
- **Open blocker B-09:** Pilot territory and rep (OQ-13). On main: PENDING; in PR 115 (not merged): interim: dummy data
- **Open blocker B-34:** Re-verifier findings on slices 1 and 3: territory and offboarding races, address whitespace. On main: FIXED, awaiting re-verification; in PR 115 (not merged): no change
- **Open or related decisions:** B-09, B-34

#### PIP-02

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Log a visit: salon, rep, arrival time, GPS at arrival, outcome code, optional notes/photo (the photo is stored once storage exists, ACTIVITY L-0152). Visits are append-only
- **Actor:** Rep
- **Preconditions:** Open rep day; salon reachable
- **Expected behaviour:** A visit records salon, rep, server arrival time, GPS, outcome code and optional note or photo; append-only
- **Business rules:** Server time authoritative (H-09); client time kept as evidence
- **Permissions:** Rep (own); office on behalf, flagged
- **Failure and exceptions:** Visit to an unreachable salon or without an open day is refused
- **Acceptance criteria:**
  - AC-PIP-02-1: `app.log_visit` writes one visit with server time
  - AC-PIP-02-2: UPDATE or DELETE on `visit` fails for every role
  - AC-PIP-02-3: A replay with the same client id writes one visit (H-08)
- **Tests:** citing this ID: `verify-slices-1-3.test.ts`, `visits.test.ts`; through its board task: `b33-decisions.test.ts`, `create-salon-blanks.test.ts`, `crm-attacks.test.ts`, `salons.test.ts`, `visits.test.ts`
- **Implementation evidence:** board: P1-02 (IN PROGRESS); `supabase/tests/visits.test.ts`
- **Open blocker B-14:** How reps get plan lists and taxonomies. On main: PENDING (moot under D-30); in PR 115 (not merged): no change
- **Open blocker B-31:** Audit questions (a) to (g): pin moves, phone reveals, midnight, invoices per delivery, delivery mode, low stock, agents. On main: PENDING; in PR 115 (not merged): decided in part ((c) 1-hour offline window; pin answer)
- **Open or related decisions:** B-14, B-31

#### PIP-03

**Priority:** M · **Phase:** 1 (manual build) / S|2 (auto-generated) · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Daily route for a rep: ordered list of stops with reason (reorder due, collection due, at-risk, prospect, delivery)
- **Actor:** Owner or manager (build); rep (read)
- **Preconditions:** Due list (PIP-06)
- **Expected behaviour:** A rep's daily route is an ordered list of stops each with a reason
- **Business rules:** Phase 1 manual build; automatic Phase 2
- **Permissions:** Office builds; rep reads own
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-PIP-03-1: `app.office_set_route` saves ordered stops with reasons
  - AC-PIP-03-2: `app.my_route` returns only the caller's route
- **Tests:** citing this ID: `routes.test.ts`; through its board task: `crm-attacks.test.ts`, `deliveries.test.ts`, `invoice-document.test.ts`, `orders.test.ts`, `rep-blind-stock-issues.test.ts`, `routes.test.ts`
- **Implementation evidence:** board: P1-06 (IN PROGRESS); P1-16 (DONE); P1-29 (IN PROGRESS); `/office/routes`, `/app/route`; `supabase/tests/routes.test.ts`

#### PIP-04

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Route days per territory (which salons fall on which weekday)
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### PIP-09

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Rep daily check-in / check-out gating: no order requests or payments without check-in; unreconciled handover blocks next day with Mg override. Phase 1 so far (P1-02 part b): an earlier day left open blocks check-in until the office force-closes it with a reason; the handover condition joins with P1-07
- **Actor:** Rep; office (force-close)
- **Preconditions:** Rep on approved device
- **Expected behaviour:** No order request or payment without check-in; an earlier open day blocks check-in until the office force-closes it with a reason; an unreconciled handover blocks the next day with manager override
- **Business rules:** B-31(c) offline window: 1 hour (MJ 2026-11-19, PR 115, not merged; docs not amended)
- **Permissions:** Rep checks in and out; office force-closes
- **Failure and exceptions:** Payment or request without an open day is refused
- **Acceptance criteria:**
  - AC-PIP-09-1: `app.rep_record_payment` without an open day is refused
  - AC-PIP-09-2: With yesterday's day open, `app.rep_check_in` is refused until `app.office_force_close_rep_day` closes it with a reason
  - AC-PIP-09-3: Force-close without a reason is refused
- **Tests:** citing this ID: `e2e-stack/office.spec.ts`, `e2e/outbox-classify.spec.ts`, `e2e/outbox-drain.spec.ts`, `e2e/outbox-history.spec.ts`, `verify-slices-1-3.test.ts`, `visits.test.ts`; through its board task: `audit-fixes.test.ts`, `b33-decisions.test.ts`, `create-salon-blanks.test.ts`, `crm-attacks.test.ts`, `e2e-stack/p130-screens.spec.ts`, `e2e/list-cap-note.spec.ts`, `e2e/time.spec.ts`, `salons.test.ts`, `visits.test.ts`
- **Implementation evidence:** board: P1-02 (IN PROGRESS); P1-30 (IN PROGRESS); `components/open-rep-days.tsx`
- **Known gap:** The unreconciled-handover block and the 1-hour offline window are not built
- **Open blocker B-31:** Audit questions (a) to (g): pin moves, phone reveals, midnight, invoices per delivery, delivery mode, low stock, agents. On main: PENDING; in PR 115 (not merged): decided in part ((c) 1-hour offline window; pin answer)
- **Open blocker B-35:** Close-day submit callback defect, slice 2. On main: FIXED, awaiting re-verification; in PR 115 (not merged): no change
- **Open or related decisions:** B-31, B-35

#### PIP-10

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Visit outcome taxonomy editable by O/Mg
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### PIP-11

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Geofence warning when "arrived" is tapped > 300 m from salon pin (logged, not blocking)
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### PIP-12

**Priority:** M · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Active-workday representative location samples linked to an open rep_day; validate caller/device/coordinates/accuracy/time, expose current/stale state only to authorized office roles, and stop accepting samples after close/revocation
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### PIP-13

**Priority:** M · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Office map shows permitted current representative positions and approved history; salon users never see rep GPS. Ping cadence, background mode and retention follow OQ-32
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none
- **Open or related decisions:** OQ-32

#### FLD-01

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Rep profile: name, phone, CNIC number (encrypted), photo, emergency contact, start date, territories, default commission rate (D-31, D-38)
- **Actor:** Owner (create user); office (profile)
- **Preconditions:** User exists
- **Expected behaviour:** Rep profile holds name, phone, encrypted CNIC, photo, emergency contact, start date, territories, default commission rate
- **Business rules:** CNIC encrypted (NFR-08; see DA-035)
- **Permissions:** Office; rep reads own
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-FLD-01-1: The office sees and edits the rep profile fields
  - AC-FLD-01-2: CNIC is never stored in plain text
- **Tests:** citing this ID: `commission.test.ts`; through its board task: `commission.test.ts`
- **Implementation evidence:** board: P1-11 (NOT STARTED); P1-22 (IN PROGRESS)
- **Known gap:** Rep profile screen and CNIC storage not built (P1-11)

#### FLD-02

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Rep scorecard (doc 02 KPIs) daily/weekly/monthly
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### FLD-04

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Rep onboarding checklist in-app (doc 08)
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### FLD-05

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Live map of today's visits per rep (O/Mg)
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

## 6. Business rules

Rules cited by this module's requirements: D-30, D-31, D-38, H-08, H-09, H-22. Their text and single source are in [business-rules.md](../../requirements/business-rules.md); thresholds are doc 13 §9, permissions are doc 06 §2.

## 7. User journeys

- J-FO-1 Day start (PIP-09): check-in on the approved phone; an earlier open day blocks it until the office force-closes it.
- J-FO-2 Visit (PIP-02): arrive, record outcome, optional note; feeds the salon timeline.
- J-FO-3 Route (PIP-03): office builds the next day's stops from the due list.

Full journeys with steps: [journeys-and-workflows.md](../../requirements/journeys-and-workflows.md).

## 8. Cross-module interactions

Payments and order requests need an open rep day (PIP-09). Reachability comes from salon-pipeline (SAL-14). The bag close (inventory INV-05) and the handover (money-credit PAY-05) close the day's custody.

## 9. Security requirements

Device binding (SEC-03); server time authoritative (H-09); visits append-only; rep location tracking is Phase 2 and its policy is OQ-32.

## 10. Failure scenarios

- Rep loses connectivity: visits must queue offline (NFR-01); not wired yet (P1-09).
- Day left open past midnight: office force-close with a reason; the 1-hour offline window is decided (PR 115, not merged; docs not amended) but not built.
- Phone lost: office revokes the device (SEC-04).

## 11. Acceptance criteria

12 criteria (IDs `AC-<requirement>-<n>`) are in the records above and in the [acceptance criteria matrix](../../audit/2026-11-19/05-acceptance-criteria-matrix.md).

## 12. Dependencies

Offline outbox (P1-09); pilot rep and territory (B-09).

## 13. Implementation status and evidence

| Requirement | Phase | Status | Board tasks | Tests citing the ID |
|---|---|---|---|---|
| PIP-01 | 1 | PARTIALLY IMPLEMENTED | P0-03, P1-02 | 4 |
| PIP-02 | 1 | PARTIALLY IMPLEMENTED | P1-02 | 2 |
| PIP-03 | 1 (manual build) / S|2 (auto-generated) | IMPLEMENTED — NOT VERIFIED | P1-06, P1-16, P1-29 | 1 |
| PIP-04 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| PIP-09 | 1 | PARTIALLY IMPLEMENTED | P1-02, P1-30 | 6 |
| PIP-10 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| PIP-11 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| PIP-12 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| PIP-13 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| FLD-01 | 1 | PARTIALLY IMPLEMENTED | P1-11, P1-22 | 1 |
| FLD-02 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| FLD-04 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| FLD-05 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
