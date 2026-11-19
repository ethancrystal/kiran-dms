# Supplier Vault — module document (context `supplier-vault`)

This document is derived reference material written by the 2026-11-19 documentation audit. It never overrides the numbered planning documents, doc 16 or `docs/ACTIVITY.md` (ACTIVITY §1); doc 03 stays the index of requirement IDs and the source of every statement quoted here. Status is derived from the ACTIVITY §12 board and the evidence named, using the vocabulary in [docs/requirements/README.md](../../requirements/README.md#status-vocabulary).

## 1. Purpose and boundaries

The classified supplier compartment: supplier records, purchase orders, goods receipts, costs, documents, grants and the vault access log. This document defines vocabulary, rules and status only. It never holds supplier data (H-01, H-02); real supplier data is entered by MJ in production by hand.

**Outside this module:** Public stock movements (inventory receives a cost-free movement from a goods receipt); prices (orders-delivery).

## 2. Glossary

- **Vault:** Database schema `supplier_vault`, not exposed through the API (D-13).
- **Vault grant:** A revocable per-user permission, owner-set, default on for owner and manager (VLT-06, D-03).
- **Goods receipt:** The vault record of goods arriving; it creates a public movement with no cost or supplier reference (VLT-02).

## 3. Actors and permissions

Owner: full, sets grants. Manager: only with a grant (default granted). Rep, salon, agent, anon: nothing. Matrix: doc 06 §2 row "Vault" and doc 07. MJ's standing rule: the classified supplier is visible only to the owner and the manager.

## 4. Owned entities and data

No table exists yet: the `supplier_vault` and `vault_api` schemas are empty (P1-05 not started).

## 5. Functional requirements

7 requirements, in doc 03 order. Phase 1 requirements carry a full record; later-phase requirements carry their statement and status.

#### VLT-01

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Supplier records (identity, contacts, terms, documents) stored in a separate database schema with no direct API exposure; readable only via role-checked functions available to O/Mg
- **Actor:** Owner; manager with a vault grant
- **Preconditions:** P1-05 built; vault grant (VLT-06); AAL2
- **Expected behaviour:** Supplier records in a separate schema with no API exposure, readable only through grant-checked functions
- **Business rules:** H-01, H-02, H-05; real supplier data entered only by MJ
- **Permissions:** Owner or granted manager at AAL2
- **Failure and exceptions:** Any other caller gets nothing, with no error that reveals data
- **Acceptance criteria:**
  - AC-VLT-01-1: No `supplier_vault` table is reachable through the Data API
  - AC-VLT-01-2: A rep and an un-granted manager get nothing from vault functions
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-05 (NOT STARTED); `supabase_vault` schema exists and is revoked from all API roles (`supabase/tests/schema-hygiene.test.ts`)
- **Known gap:** Not built (P1-05); audit of vault rows open (DA-033)

#### VLT-02

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Purchase orders and goods receipts (cost prices, quantities, dates) stored in the vault; goods receipt creates the public stock movement without cost or supplier reference
- **Actor:** Owner; manager with a vault grant
- **Preconditions:** P1-05 built; vault grant (VLT-06); AAL2
- **Expected behaviour:** POs and goods receipts in the vault; a goods receipt creates the public stock movement with no cost or supplier reference
- **Business rules:** H-01, H-02, H-05; real supplier data entered only by MJ
- **Permissions:** Owner or granted manager at AAL2
- **Failure and exceptions:** Any other caller gets nothing, with no error that reveals data
- **Acceptance criteria:**
  - AC-VLT-02-1: The public movement from a goods receipt carries no cost or supplier field
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-05 (NOT STARTED); `supabase_vault` schema exists and is revoked from all API roles (`supabase/tests/schema-hygiene.test.ts`)
- **Known gap:** Not built (P1-05); audit of vault rows open (DA-033)

#### VLT-03

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Cost price and margin visible only to O/Mg, only on vault screens; never joined into any view, report or export a rep can reach
- **Actor:** Owner; manager with a vault grant
- **Preconditions:** P1-05 built; vault grant (VLT-06); AAL2
- **Expected behaviour:** Cost and margin only on vault screens, never in any view, report or export a rep can reach
- **Business rules:** H-01, H-02, H-05; real supplier data entered only by MJ
- **Permissions:** Owner or granted manager at AAL2
- **Failure and exceptions:** Any other caller gets nothing, with no error that reveals data
- **Acceptance criteria:**
  - AC-VLT-03-1: No public view, report or export returns cost or margin
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-05 (NOT STARTED); `supabase_vault` schema exists and is revoked from all API roles (`supabase/tests/schema-hygiene.test.ts`)
- **Known gap:** Not built (P1-05); audit of vault rows open (DA-033)

#### VLT-04

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Every vault read is audit-logged with user, time, record, and purpose
- **Actor:** Owner; manager with a vault grant
- **Preconditions:** P1-05 built; vault grant (VLT-06); AAL2
- **Expected behaviour:** Every vault read is logged with user, time, record and purpose
- **Business rules:** H-01, H-02, H-05; real supplier data entered only by MJ
- **Permissions:** Owner or granted manager at AAL2
- **Failure and exceptions:** Any other caller gets nothing, with no error that reveals data
- **Acceptance criteria:**
  - AC-VLT-04-1: Each vault read adds one access-log row
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-05 (NOT STARTED); `supabase_vault` schema exists and is revoked from all API roles (`supabase/tests/schema-hygiene.test.ts`)
- **Known gap:** Not built (P1-05); audit of vault rows open (DA-033)

#### VLT-05

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Vault documents (supplier invoices, contracts) in a private storage bucket, signed URLs ≤ 5 minutes, O/Mg only
- **Actor:** Owner; manager with a vault grant
- **Preconditions:** P1-05 built; vault grant (VLT-06); AAL2
- **Expected behaviour:** Vault documents in a private bucket, signed URLs of 5 minutes or less, owner or granted manager only
- **Business rules:** H-01, H-02, H-05; real supplier data entered only by MJ
- **Permissions:** Owner or granted manager at AAL2
- **Failure and exceptions:** Any other caller gets nothing, with no error that reveals data
- **Acceptance criteria:**
  - AC-VLT-05-1: A signed URL expires within 5 minutes
  - AC-VLT-05-2: A rep cannot list the bucket
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-05 (NOT STARTED); `supabase_vault` schema exists and is revoked from all API roles (`supabase/tests/schema-hygiene.test.ts`)
- **Known gap:** Not built (P1-05); audit of vault rows open (DA-033)

#### VLT-06

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Vault access is a revocable grant per user (default on for O/Mg), not an implied property of the role
- **Actor:** Owner; manager with a vault grant
- **Preconditions:** P1-05 built; vault grant (VLT-06); AAL2
- **Expected behaviour:** Vault access is a revocable grant per user, default on for owner and manager
- **Business rules:** H-01, H-02, H-05; real supplier data entered only by MJ
- **Permissions:** Owner or granted manager at AAL2
- **Failure and exceptions:** Any other caller gets nothing, with no error that reveals data
- **Acceptance criteria:**
  - AC-VLT-06-1: Revoking a manager's grant makes vault functions return nothing to that manager
- **Tests:** citing this ID: `foundation.test.ts`; through its board task: none
- **Implementation evidence:** board: P1-05 (NOT STARTED); `supabase_vault` schema exists and is revoked from all API roles (`supabase/tests/schema-hygiene.test.ts`)
- **Known gap:** Not built (P1-05); audit of vault rows open (DA-033)

#### VLT-07

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Sensitive fields encrypted at the column level with a key held outside the database (see doc 07)
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

## 6. Business rules

Rules cited by this module's requirements: H-01, H-02, H-05, H-22. Their text and single source are in [business-rules.md](../../requirements/business-rules.md); thresholds are doc 13 §9, permissions are doc 06 §2.

## 7. User journeys

- J-SV-1 Record a purchase order and its goods receipt (VLT-02): not built.
- J-SV-2 Grant or revoke a manager's vault access (VLT-06): `app.owner_set_vault_grant` exists, no screen.

Full journeys with steps: [journeys-and-workflows.md](../../requirements/journeys-and-workflows.md).

## 8. Cross-module interactions

Goods receipts feed inventory. Supplier fill rate for lost demand is shown only in the vault (DEM-03). The audit trigger on vault tables must not copy supplier data into `control` (DA-033).

## 9. Security requirements

Schema revoked from anon, authenticated and service_role (pinned by `supabase/tests/schema-hygiene.test.ts`); functions check grant and AAL2; every read logged (VLT-04); documents in a private bucket with 5-minute signed URLs; no supplier wording in code outside vault paths (Appendix C rule 5).

## 10. Failure scenarios

- Un-granted manager calls a vault function: nothing returned.
- Audit trigger copies a vault row into `control.audit_event`: open design gap (DA-033).
- A future `app` vault read must be revoked from anon explicitly while B-62 stands.

## 11. Acceptance criteria

8 criteria (IDs `AC-<requirement>-<n>`) are in the records above and in the [acceptance criteria matrix](../../audit/2026-11-19/05-acceptance-criteria-matrix.md).

## 12. Dependencies

P1-05 not started; B-04 (packaging), B-15(a) owner-term secret; DA-033 decision before building.

## 13. Implementation status and evidence

| Requirement | Phase | Status | Board tasks | Tests citing the ID |
|---|---|---|---|---|
| VLT-01 | 1 | NOT STARTED | P1-05 | 0 |
| VLT-02 | 1 | NOT STARTED | P1-05 | 0 |
| VLT-03 | 1 | NOT STARTED | P1-05 | 0 |
| VLT-04 | 1 | NOT STARTED | P1-05 | 0 |
| VLT-05 | 1 | NOT STARTED | P1-05 | 0 |
| VLT-06 | 1 | NOT STARTED | P1-05 | 1 |
| VLT-07 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
