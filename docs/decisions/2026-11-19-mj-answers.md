# MJ answers, 2026-11-19 07:36 PKT

Recorded from MJ's own answers in chat on 2026-11-19 at 07:36 PKT (Asia/Karachi). Each answer is quoted, then mapped to the blocker or item it settles. The protocol log entry for this record is `docs/log/2026-11-19-dev-mj-decisions.md`.

These answers unblock design and dummy-data work. They do not authorise a merge, a push, or a change to the hosted kiran database, except the separate migration approval in item 15, which Code Deployer executes after a manual backup.

## B-62 — storefront reads and schema `app`

**Asked:** move the two shop reads into their own area (safer than leaving signed-out visitors with `USAGE` on schema `app`).

**MJ:** "yes"

**Decision:** move `storefront_catalogue` and `storefront_product` out of schema `app` into their own schema, and revoke anon `USAGE` on `app`. Applying the matching change to the hosted project's exposed schemas remains MJ's (H-21 / hosted settings).

## P1-09 task 1 / B-31(c) — how long an offline check-in stays valid

**Asked:** how long an offline rep action stays valid after it is recorded, including a rep working past midnight.

**MJ:** "a check will stay valid for an hour"

**Decision:** an offline check-in stays valid for 1 hour after capture, not 48 hours. This unblocks P1-09 plan task 1 (rep day from captured time).

## H-21 — map provider (P1-03)

**Asked:** use a free provider first, such as OpenStreetMap.

**MJ:** "yes"

**Decision:** the rep map uses OpenStreetMap first, reached only through an adapter (H-21). There is no B-id for the provider itself.

## B-39 — who may approve write-offs (a DECIDED)

**Asked:** owner approves above a threshold, manager below it? MJ was offered that split and answered about who approves "all of it".

**MJ:** "owner and manager approves all of it"

That first answer was about write-off approvals in general and conflicted with the M4 control (doc 06 section 2; doc 13 line 61 and section 9 line 138), so it was put back to MJ for confirmation.

**MJ (confirmation, 08:04 PKT):** "Keep salon debt write-offs owner only; owner and manager approve all other write-offs"

**Decision on (a):** a receivable (salon debt) write-off stays owner only. The M4 control in doc 06 section 2 and doc 13 is unchanged. Every other write-off (for example a stock write-off) may be approved by the owner or a manager, at any amount, with no threshold split.

**Not yet reflected in the documents or code:** doc 13 section 9 (line 138: stock write-off, manager requests, owner approves, always) and doc 06 section 2 (stock adjustment or write-off: manager approves below a threshold, owner above) still describe the stricter rule, and so does the built behaviour. Changing them loosens a maker-checker control, so it is done with the code, not in this record, and keeps the not-the-maker rule (a manager never approves their own request) unless MJ says otherwise. Follow-up 6 below.

**Still open on B-39:** (b) who may use an approval, and whether the checker may run the gated action; (c) use-time rule and whether `adjustment` moves onto `authorize_action`; (d) whether one owner may suspend or demote another; (e) `credit_override`; (f) a second call for the same kind and consumer with different facts; (g) expiry and a checker offboarded before use.

## B-41 — may a manager edit product groups

**Asked:** may a manager edit product groups?

**MJ:** "yes"

**Decision:** a manager may add and change product groups (and default cycles, as the blocker asked). Assumption A-19 (controls shown to the owner only) is rejected by this answer. Recorded as D-62 in doc 12; doc 06 section 2 and doc 03 ADM-01 are updated in this change (H-25). The database already allows it (`app.office_upsert_product_group`, any office role at AAL2); the Products page still shows the group controls to the owner only until a code change follows (follow-up 1 below).

## B-45 — closing the rest of a part-delivered order

**Asked:** may the office close the remainder of a part-delivered order (owner or manager, with a reason)?

**MJ:** "yes"

**Decision:** owner or manager may close the remainder of a part-delivered order, with a mandatory reason.

**Still open on B-45:** when a fully delivered order becomes `closed` (for example once installments are fully paid). That question was in the blocker and was not asked in this exchange.

## B-46 — invoice PDF, logo, batch and expiry

**Asked:** should the server make a PDF with the company logo now, and should products carry batch and expiry later with stock?

**MJ:** "yes"

**Decision:** build a server-side invoice PDF with the logo now. Batch and expiry are deferred until stock work (P1-05 / goods receipt).

**Still open on B-46:** (d) is already as built (company profile keys). (e) whether the business wants a documented exception for a salon that cannot sign (for example a closed shop) was not answered here.

## B-48 to B-51 — money controls (amounts): still PENDING

**Asked:** the threshold for reversing a payment, the allowed settlement gap, and the cash limit (B-48 to B-51). MJ was asked to name the amounts.

**MJ:** "no refund if necessary salon will request refund and once approved by owner then will be refunded"

**Status:** B-48 stays PENDING. Its question is the doc 13 section 9 limit (a manager checks a payment reversal up to Rs 10,000 and the owner above) and what happens to a short handover that is reversed. MJ's answer does not name an amount and is about refunds, which are a different thing from reversing a wrongly recorded payment, so it is recorded as note N-1 below and does not settle B-48. B-49, B-50 and B-51 were not answered and stay PENDING.

### Note N-1 — refunds (MJ, 2026-11-19)

A refund to a salon happens only when the salon requests one and the owner approves it. Source: MJ's words quoted above. No refund function exists today; this note is the rule a future refund feature must follow. It does not change payment reversal (D-48) or any built control.

## B-31 (rest) — pin, map, and deliveries

**Asked:** the rest of B-31 (pin moves, the reveal limit, one invoice per delivery, delivery mode, how agents are set up), offered as a short separate list.

**MJ:** "the only reason of this feature is to keep eye on the sales rep thats it, we will not use it for deliveries"

**Reading:** this covers the purpose of the pin and map feature only: it exists to monitor the sales rep's field activity and is not used for deliveries. It does not answer (d) one invoice per delivery or (e) what `delivery_mode` should change; those are about invoicing and stock, not the map.

**Still open on B-31:** (a) may a rep move a salon's pin; (b) a daily cap on `reveal_phone`; (d) one invoice per delivery or one per order; (e) `delivery_mode`; (f) whether `low_stock` counts the warehouse only; (g) how an independent agent is represented. Settled in this exchange: (c), above.

## B-02, B-09, B-10, B-54 to B-61 — dummy data until MJ supplies originals

**Asked (B-02, B-09, B-10):** the real Excel salon list, the pilot area and rep, and the real product catalogue. Until then, ABD Salon test data had been standing in.

**MJ:** "Yes I will provide but for now everything can be dummy and of your choosing so do noto hesitate to like invent a compay , product or a client so we can test things"

**Asked (B-54, B-55, and the other shop questions B-56 to B-61):** shop prices and shade confirmation, plus the remaining shop questions.

**MJ:** "dummy for now I will give original later"

**Decision:** until MJ supplies the real Excel, pilot area and rep, catalogue, prices, shades and other shop originals, agents may invent dummy company, salon, product, price, shade and client data to test with. Dummy rows in `supabase/seed.sql` are marked `[Dummy]`. Do not invent real-looking branded products as if they were the live catalogue, and do not put real personal data or real supplier data in the repo (H-01 to H-04). The products MJ already showed on 2026-11-10 remain on the record under B-10; prices stay B-54.

**Scope notes:**

- B-60 was already resolved on 2026-11-10 (Regular User orders marked delivered at dispatch, no signature; Client Salon orders keep D-49). That resolution is unchanged.
- B-61 still needs MJ to name the e-mail service and sender before any reminder is sent. Dummy or default wording may be used in the meantime; nothing is sent until the service is named.
- B-56, B-57, B-58 and B-59 stay PENDING on their existing defaults in `docs/ACTIVITY.md` section 14. MJ's "dummy for now I will give original later" allows dummy or placeholder data meanwhile; it is not a decision on any of those four questions. Creating a live Shopify store, pointing khsalon.com, and setting secrets remain MJ's own actions (section 10).

## Item 15 — pending migrations on kiran

**Asked:** apply the pending migrations to kiran after a manual backup.

**MJ:** "yes"

**Decision:** MJ approved applying the pending migrations to the kiran staging database (project "Kiran Company", ref `iurvazdyxzlspegygldo`) after a manual backup. Execution belongs to Code Deployer, not Developer. This entry records the approval only. No migration is applied in this change.

## Documents still to update (H-25 follow-ups)

Docs are changed in this record only where MJ's decision is clear (B-41). The rest are follow-ups, each for the task that builds it:

1. **B-41, code:** open the product group controls on `/office/products` to the manager (A-19 rejected); the database needs no change.
2. **B-62:** doc 06 section 4 (public shop catalogue row) still says `anon` holds USAGE on schema `app`. Update it with the migration that moves the two reads to their own schema; the hosted exposed-schemas setting is MJ's.
3. **B-31(c):** the P1-09 plan (`docs/plans/in-progress/2026-11-08-p1-09-offline-rep-app.md`, decision 5) still proposes 48 hours; change it to 1 hour with plan task 1.
4. **B-45:** doc 04 (order states) and doc 09 gain the office's close-the-remainder action with a reason when the function is built; when a delivered order becomes `closed` is still open.
5. **B-46:** ORD-05 in doc 03 and the P1-31 notes gain the server-side PDF with logo when built; batch and expiry move with P1-05.
6. **B-39(a):** M4 (receivable write-off, owner only) is unchanged. When stock write-off approval is built to MJ's rule, update doc 13 section 9 (stock write-off row), doc 06 section 2 (stock adjustment or write-off row) and the matching code together, keeping the not-the-maker rule.
7. **Note N-1 (refunds):** doc 09 and doc 13 section 9 gain the refund rule when a refund feature is designed; B-48 must be answered first.

## Not answered in this exchange

From the list put to MJ on 2026-11-19, these were not answered here and stay as they were:

1. Make the repository private.
2. Rotate the leaked keys and set the login addresses on kiran (B-53, B-25).
14. Delete old branches that are already merged.
