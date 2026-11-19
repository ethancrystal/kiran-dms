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

## B-39 — who may approve write-offs

**Asked:** owner approves above a threshold, manager below it? MJ was offered that split and answered about who approves "all of it".

**MJ:** "owner and manager approves all of it"

**Decision:** owner and manager may both approve write-offs of any amount. There is no threshold split.

**Still open on B-39:** (b) who may use an approval, and whether the checker may run the gated action; (c) use-time rule and whether `adjustment` moves onto `authorize_action`; (d) whether one owner may suspend or demote another; (e) `credit_override`; (f) a second call for the same kind and consumer with different facts; (g) expiry and a checker offboarded before use.

## B-41 — may a manager edit product groups

**Asked:** may a manager edit product groups?

**MJ:** "yes"

**Decision:** a manager may add and change product groups (and default cycles, as the blocker asked). Assumption A-19 (controls shown to the owner only) is rejected by this answer.

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

## B-48 to B-51 — money controls (amounts)

**Asked:** the threshold for reversing a payment, the allowed settlement gap, and the cash limit (B-48 to B-51). MJ was asked to name the amounts.

**MJ:** "no refund if necessary salon will request refund and once approved by owner then will be refunded"

**Decision for B-48:** there is no reversal or refund amount threshold. A refund happens only when the salon requests it and the owner approves it. A manager does not approve refunds under this rule.

**Not independently answered:** B-49 (handover settlement: label versus a ledger variance, and who may withdraw a count), B-50 (whether every manager adjustment request needs the owner, and a reason on the owner's discounted orders), and B-51 (what the manager sees about reps refused by the cash cap). MJ did not name a numeric settlement gap or cash cap. Those three rows stay open, with this refund rule on record.

## B-31 (rest) — pin, map, and deliveries

**Asked:** the rest of B-31 (pin moves, the reveal limit, one invoice per delivery, delivery mode, how agents are set up), offered as a short separate list.

**MJ:** "the only reason of this feature is to keep eye on the sales rep thats it, we will not use it for deliveries"

**Decision:** the pin and map feature exists only to monitor the sales rep's field activity. It is not used for deliveries. `delivery_mode`, reveal-for-delivery, and related behaviour must not be designed around deliveries. Together with B-31(c) above, this is what MJ settled of B-31 in this exchange.

**Still open on B-31:** (a) may a rep move a salon's pin; (b) a daily cap on `reveal_phone`; (f) whether `low_stock` counts the warehouse only; (g) how an independent agent is represented.

## B-02, B-09, B-10, B-54 to B-61 — dummy data until MJ supplies originals

**Asked (B-02, B-09, B-10):** the real Excel salon list, the pilot area and rep, and the real product catalogue. Until then, ABD Salon test data had been standing in.

**MJ:** "Yes I will provide but for now everything can be dummy and of your choosing so do noto hesitate to like invent a compay , product or a client so we can test things"

**Asked (B-54, B-55, and the other shop questions B-56 to B-61):** shop prices and shade confirmation, plus the remaining shop questions.

**MJ:** "dummy for now I will give original later"

**Decision:** until MJ supplies the real Excel, pilot area and rep, catalogue, prices, shades and other shop originals, agents may invent dummy company, salon, product, price, shade and client data to test with. Dummy rows in `supabase/seed.sql` are marked `[Dummy]`. Do not invent real-looking branded products as if they were the live catalogue, and do not put real personal data or real supplier data in the repo (H-01 to H-04). The products MJ already showed on 2026-11-10 remain on the record under B-10; prices stay B-54.

**Scope notes:**

- B-60 was already resolved on 2026-11-10 (Regular User orders marked delivered at dispatch, no signature; Client Salon orders keep D-49). That resolution is unchanged.
- B-61 still needs MJ to name the e-mail service and sender before any reminder is sent. Dummy or default wording may be used in the meantime; nothing is sent until the service is named.
- B-56, B-57, B-58 and B-59 may proceed against the documented defaults and dummy or placeholder copy until MJ gives originals. Creating a live Shopify store, pointing khsalon.com, and setting secrets remain MJ's own actions (section 10).

## Item 15 — pending migrations on kiran

**Asked:** apply the pending migrations to kiran after a manual backup.

**MJ:** "yes"

**Decision:** MJ approved applying the pending migrations to the kiran staging database (project "Kiran Company", ref `iurvazdyxzlspegygldo`) after a manual backup. Execution belongs to Code Deployer, not Developer. This entry records the approval only. No migration is applied in this change.

## Not answered in this exchange

From the list put to MJ on 2026-11-19, these were not answered here and stay as they were:

1. Make the repository private.
2. Rotate the leaked keys and set the login addresses on kiran (B-53, B-25).
14. Delete old branches that are already merged.
