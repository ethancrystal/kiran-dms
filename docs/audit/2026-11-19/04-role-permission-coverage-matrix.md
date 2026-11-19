# Role and permission coverage matrix

Generated on 2026-11-19 from `main` at `d4b47ca` by the documentation audit (scripts kept outside the repository; the method is in [01-findings-register.md](01-findings-register.md)). Status words: [docs/requirements/README.md](../../requirements/README.md#status-vocabulary).

Rows follow the capabilities of doc 06 §2, the permission matrix of record (H-26: only MJ changes it). Columns are the actors in [roles-and-permissions.md](../../requirements/roles-and-permissions.md). **Enforcement** names the database object that enforces the rule (RLS or SECURITY DEFINER function); the UI is never the control (doc 06 §2). **Status** is for the enforcement, using the requirement status words.

| Capability | Anonymous | Rep | Salon member | Manager | Owner | Enforcement (database) | Test evidence | Status |
|---|---|---|---|---|---|---|---|---|
| Sign in (office) | no | no | no | password + TOTP, AAL2 | password + TOTP, AAL2 | `app.is_office()` requires AAL2 (D-14) | `audit-fixes.test.ts` (AAL1 refusals), `foundation.test.ts` | IMPLEMENTED — NOT VERIFIED (P1-01 VERIFIED, P0-05 in progress) |
| Sign in (rep) | no | e-mail code + approved device | no | — | — | `app.rep_device_ok`, `register_device` | `foundation.test.ts`, `device-guard.test.ts`; `e2e/rep-login.spec.ts` (page only) | VERIFIED (P1-01, L-0116) |
| Sign in (salon) | no | no | e-mail code, active membership | — | — | `app.salon_me`, table `salon_membership` | `invitations.test.ts`; `e2e/salon-login.spec.ts` (page only) | IMPLEMENTED — NOT VERIFIED |
| See salons | no | reachable only, masked, 50 rows | own only | all | all | `app.my_salons`, RLS on table `salon` | `crm-attacks.test.ts`, `rls-matrix.test.ts` | IMPLEMENTED — NOT VERIFIED |
| Edit a salon | no | no | no | yes | yes | `app.update_salon` refuses reps | `rep-readonly-timelines.test.ts` | IMPLEMENTED — NOT VERIFIED |
| Propose a salon | no | yes, pending | apply (sign-up) | adds approved | adds approved | `app.create_salon`, `app.salon_apply` | `salon-approval.test.ts`, `salon-self-signup.test.ts` | IMPLEMENTED — NOT VERIFIED |
| Approve salon, assign rep | no | no | no | yes | yes | `app.office_decide_salon`, `app.office_assign_salon_rep` | `salon-approval.test.ts` | IMPLEMENTED — NOT VERIFIED |
| Submit order request | no | reachable salons | own salon | — | — | `app.rep_create_card`, `app.salon_submit_request` | `order-cards.test.ts`, `requests-portal.test.ts` | IMPLEMENTED — NOT VERIFIED |
| Create official order | no | no (tombstone refuses) | no | yes | yes | `app.office_create_order`; `app.create_order` refuses all | `office-orders.test.ts`, `crm-attacks.test.ts` | IMPLEMENTED — NOT VERIFIED |
| Approve delivery | no | submits only | no | yes, never own | yes, never own | `app.office_approve_delivery` | `delivery-approval.test.ts` | IMPLEMENTED — NOT VERIFIED |
| Discount below list | no | no | no | approve, not own | approve; own discount needs none | approval framework | `office-approvals.test.ts` | IMPLEMENTED — NOT VERIFIED |
| Credit eligibility and limit | no | no | no | raise within cap, block | set | `app.owner_set_credit`, `app.office_raise_limit` | `audit-fixes.test.ts` | IMPLEMENTED — NOT VERIFIED |
| Record payment | no | own, at salon, open day | no | on behalf (flagged), office cash | same | `app.rep_record_payment`, `app.office_record_cash` | `payments.test.ts`, `office-cash.test.ts` | IMPLEMENTED — NOT VERIFIED |
| Reverse payment | no | no | no | yes, never own (D-48) | yes | `app.office_reverse_payment` | `audit-fixes.test.ts` | IMPLEMENTED — NOT VERIFIED |
| Handover | no | acknowledge | no | count | count, settle disputes | `app.office_count_handover`, `app.owner_settle_handover` | `handovers.test.ts` | IMPLEMENTED — NOT VERIFIED |
| Bank deposit | no | no | no | yes | yes | none | none | NOT STARTED |
| Stock issue and return | no | confirm own | no | yes | yes | `app.office_propose_stock_issue`, `app.rep_confirm_stock_issue` | `inventory.test.ts`, `rep-blind-stock-issues.test.ts` | IMPLEMENTED — NOT VERIFIED |
| Stock adjustment / write-off | no | no | no | see DA-013 | see DA-013 | `app.owner_adjust_stock`, `app.office_post_adjustment` | `inventory.test.ts` | PARTIALLY IMPLEMENTED (write-off approvals P1-08) |
| Receivable write-off | no | no | no | no | owner only (MJ 2026-11-19) | none | none | NOT STARTED |
| Products, pictures, prices | catalogue reads only via storefront (B-62) | read | own prices | manage | manage | `app.office_set_sku_price`, `app.office_set_salon_price` | `catalogue-prices.test.ts`, `storefront-catalogue.test.ts` | IMPLEMENTED — NOT VERIFIED |
| Config (templates, credit rules) | no | no | no | view (DA-014) | owner only | `app.owner_set_config` | `foundation.test.ts`, `payments.test.ts` | IMPLEMENTED — NOT VERIFIED |
| Bank account details | no | no | no | view | owner, MFA re-auth | none | none | NOT STARTED (P1-08) |
| Invite, suspend, revoke reps and salons | no | no | no | yes | yes | `app.office_invite`, `app.office_set_member_status` | `invitations.test.ts` | IMPLEMENTED — NOT VERIFIED |
| Create or promote owner or manager | no | no | no | refused | owner only | `app.owner_create_user`, `app.owner_set_role` | `invitations.test.ts`, `foundation.test.ts` | IMPLEMENTED — NOT VERIFIED (no role-change screen) |
| Device approval | no | no | no | yes | yes | `app.approve_device`, `app.revoke_device` | `foundation.test.ts`, `device-guard.test.ts` | VERIFIED (P1-01, L-0116) |
| Commission rates and payments | no | read own | no | set, record | set, record | `app.office_set_commission_rate`, `app.my_commission` | `commission.test.ts` | IMPLEMENTED — NOT VERIFIED |
| Investor ledger | no | no | no | yes, AAL2 | yes, AAL2 | `app.office_investor*` functions | `investors.test.ts` | IMPLEMENTED — NOT VERIFIED |
| Salon and order timelines | no | reachable salons (rep view) | own order steps | yes, AAL2 | yes, AAL2 | `app.office_salon_timeline`, `app.salon_order_steps` | `rep-readonly-timelines.test.ts`, `order-steps-reminders.test.ts` | IMPLEMENTED — NOT VERIFIED |
| Vault | no | no | no | only with grant | yes; grants owner-only | schema revoked; `app.owner_set_vault_grant` | `schema-hygiene.test.ts` (schema), `foundation.test.ts` (grant) | NOT STARTED (P1-05) |
| Full audit log, anomalies | no | no | no | own-team flags | read all; nobody writes | triggers only write `control.audit_event` | `foundation.test.ts` | PARTIALLY IMPLEMENTED (no viewer) |
| Exports (watermarked) | no | none | no | operational | all | none | none | NOT STARTED |
| Storefront catalogue read | 2 functions (B-62) | yes | yes | yes | yes | `app.storefront_catalogue`, `app.storefront_product` | `function-gates.test.ts`, `storefront-catalogue.test.ts` | IMPLEMENTED — NOT VERIFIED (schema move decided, PR 115) |
| Reminder job | — | — | — | — | — | `app.approval_reminders_due`, `app.record_approval_reminders` (service role only) | `order-steps-reminders.test.ts` | PARTIALLY IMPLEMENTED (no runner, B-61) |

**Agent** (AGT-01) and **investor** have no row: the agent role is not built (`app_role` has no agent value) and investors have no login (CAP-01). **Reminder job** is a non-human actor with service-role-only functions and no runner (B-61).

Coverage checks: every capability row names a database enforcement point or says none; rows with none are NOT STARTED. Rows marked VERIFIED rest on L-0116 (P1-01). The anon row exists in code but not in doc 06 §2 (finding DA-031).
