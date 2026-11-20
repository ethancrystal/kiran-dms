# 2026-11-20 05:14 PKT · Hermes · qwen4-max · branch feat/rep-day-no-bag-count · DECISION
**Task:** — (MJ product direction: rep scope, stock and catalogue, investors; recorded verbatim from chat)
**What / why:** MJ gave a new product direction in chat on 2026-11-20 that outranks doc 16 and the older fixed decisions under ACTIVITY section 1 (MJ's current explicit instruction). This entry records it so the build and the doc amendments have an authority to cite. The words below are MJ's, quoted; the rulings are the plain reading of them.

MJ on the sales rep (2026-11-20): "We do not give our sales rep the product for testing so there is no need foe this bag functionality I only need checkin check out and the route planning and notes taking inside the Rep area where they can take order notes from potential Salon client in a dedicated Order Notes area". And: "No reps do not deliver the order the order delivery will be done by other employees but we do not need anything for that". And: "these are most imporatant things and one more that is the Sales Rep activity their visits, followups and order notes."

MJ on stock and catalogue (2026-11-20): the office (his mother-in-law and wife) manage all stock and initially add every product, variant and unit count themselves; the same stock feeds the frontend catalogue without exact numbers, showing only "not available" when stock ends; a salon client signs up themselves, clicks Create New Order and sees the catalogue first. On when stock moves he ruled: "Deduct only when it is marked delivered". On the catalogue: salon portal first ("Yes exactly"). On loading stock: "a way in which we can upload sheet and it automatically gets all the products and upload them".

MJ on investors (2026-11-20): "Owner and Manager will have Investor area where they each can create an investor's profile, how much money they have paid and what commission or return is promised ... every investor gets a return promised in percentage so I want that calculation to be easy for them and mostly automated or just 1 or 2 data points like investor amount and percentage that they need to only add". On the period he ruled: "lets assume its recurring."

Rulings recorded:
1. Rep area becomes check-in and check-out, route planning, notes, and a dedicated Order Notes area for potential salons. No bag, no rep delivery, no rep money handling. Delivery is done by other employees and nothing is built for them. This supersedes the rep deliver-and-collect wording of doc 16 and B-40(a) for the rep area; the office order and delivery-approval path stays.
2. Investor return is a promised percentage, recurring, calculated by the system from the invested amount and the percentage. This supersedes doc 16 lines 14 and 31 and D-40 and D-43 ("no automated investor profit-calculation"). It is a simple fixed recurring return, not the batch profit-sharing engine D-40 avoided. The period defaults to monthly (ASSUMPTION 2026-11-20-hermes-investor-return-period); MJ may set yearly.
3. Stock shown to salons as availability only (in stock, or "not available" at zero), never unit counts; the office sees real numbers. This pulls INV-12 into the work (it was deferred by D-41).
4. Stock deducts only when an order is marked delivered, which matches the existing delivery path; it does not deduct at order placement.
5. Initial stock and products load by sheet upload (Excel or CSV) that reads the products and units automatically, extending the existing importer.

**Next / needs:** Build in slices: investor recurring return first, then catalogue availability, then sheet upload, then the rep Order Notes area and rep-area cleanup. Doc 16 is amended in this same work to match (H-25). The rep-scope and stock and catalogue slices follow this decision; this entry is their authority.
Security checklist (tick honestly):
[x] RLS enabled+forced; policies + role x table tests added/updated (H-13) (n/a: this entry records a decision; the build entries carry the tests)
[x] Append-only respected; UPDATE/DELETE denied for all app roles (H-06, H-07) (n/a here)
[x] Mutations via SECURITY DEFINER fn, pinned search_path, idempotent (H-08) (n/a here)
[x] Audit trigger present; hash chain verifies (H-17) (n/a here)
[x] No vault/supplier/cost data outside vault; leakage tests pass (H-01, H-05) (n/a)
[x] No secrets / real personal data / real supplier data in the diff (H-02, H-03, H-20) (no real data quoted)
[x] Governance powers still owner-only + AAL2 (H-15) (investor area stays office only)
[x] No control weakened, skipped or temporarily disabled (H-16) (the investor change adds a calculation; it does not remove a control)
[x] Docs match code; deviations logged (H-25) (doc 16 amended in this work)
[x] Tests actually run; real results recorded (H-23, H-24) (recorded in the build TASK entries)
