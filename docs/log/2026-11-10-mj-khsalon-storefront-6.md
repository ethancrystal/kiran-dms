# 2026-11-10 18:50 PKT · Claude · Fable 5.2 · branch claude/storefront-decisions · DECISION
**Task:** P1-32. D-61: marking a Regular User order delivered (answers B-60; an exception to D-49)
**What / why:** B-60 asked how a Regular User order is completed when D-49 requires the customer's signed acknowledgement. MJ was shown the question and answered in chat on 2026-11-10, quoted: "So we have riders for delivery so as soon as we dispatch it we will mark it delivered as we keep tabs on the riders too but manager or owner wil mark it delivered"
What it decides: the business's own riders deliver. When a Regular User order is dispatched with a rider, the manager or owner marks it delivered, with no customer signature. The record keeps who marked it, when and which rider.
Scope of the exception: Regular User orders only. D-49 is unchanged for Client Salon orders: the salon's signed acknowledgement plus the office's approval. The new office function must refuse a Client Salon order, so the exception cannot be used to skip a salon's signature. This is MJ lifting a control for one kind of order by his own explicit word (H-16 is about agents weakening controls; this is the owner's decision, recorded here).
What follows from it, for MJ to know: "delivered" on a Regular User order means dispatched with a rider, not confirmed received. A parcel that does not reach the buyer is corrected by a reversing record, never by editing.
**What this does not approve:** any change to Client Salon deliveries; any migration on the hosted project; a merge.
**Evidence:** row D-61 in docs/12-decisions-and-open-questions.md; B-60 marked RESOLVED in docs/ACTIVITY.md; plans F and G in docs/plans/will-be-implemented. Nothing is built.
**Next / needs:** none for this decision.
