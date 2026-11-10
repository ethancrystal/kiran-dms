# khsalon.com storefront, plan G (P1-38): order timeline and approval reminders

**Status:** DRAFT FOR MJ REVIEW, task level. Nothing here has been built or run. Read `2026-11-10-khsalon-storefront-overview.md` first: it holds MJ's decisions, the open questions and the build order. The prompt for the executor is in `2026-11-10-khsalon-storefront-agent-prompts.md`. Status lives only on the board (`docs/ACTIVITY.md` section 12, row P1-38).

**Goal:** every step of an order, from request to delivered, is one tracked event with who did it and when; steps that need no human judgment happen by themselves; anything waiting on the manager or owner sends them e-mail reminders until it is done. Applies to both kinds of order, Regular User and Client Salon.

**What exists (reuse, do not rebuild):** `app.office_order_timeline` and `app.office_salon_timeline` (timelines read from the append-only records), `order_status` (draft, confirmed, partially_delivered, delivered, closed, cancelled), the approval records with `approval_status`, and the office's waiting lists `app.office_pending_approvals`, `app.office_pending_deliveries`, `app.office_pending_stock`, `app.office_pending_salons`. There is no e-mail adapter and no scheduled job today.

**1. Atomic steps**
- A fixed registry of order steps: key, plain-language meaning, who performs it (system, manager or owner, rep, salon, direct buyer), and whether it needs an approval.
- Proposed steps: request received; request reviewed; official order created; price or credit approval (only when needed); goods released; out for delivery; delivery submitted; customer acknowledged (Client Salon); delivery approved; invoice issued; delivered; closed. A Regular User order starts at "paid on Shopify" and ends at "dispatched with a rider and marked delivered by the manager or owner" (D-61), with no customer acknowledgement step.
- The order timeline returns every step for an order: done steps with actor and time, the step it is on now, and the steps still to come. One step is one record; a step is never edited, only followed by the next or reversed by a reversing record.
- First task of the executor: map each step to the record that already proves it and list the gaps. A gap is closed by writing the missing record through the existing function for that operation, not by a second history table.

**2. What runs by itself**
- Only steps with no human judgment and no control: a paid Shopify order entering the queue, a status that follows from records (delivered once every line is delivered and approved), issuing the invoice inside the existing delivery approval.
- Never automated: any approval, any release of goods, any price or credit decision. The maker is never the checker, and the manager and owner still act signed in with MFA. An e-mail contains a link to the office page, never a link that approves.

**3. Reminders until done**
- A scheduled job reads the existing waiting lists. For every item waiting on a manager or owner, it e-mails the people who may act on it, and repeats until the item is no longer waiting. It stops the moment the item is approved, refused or cancelled.
- One e-mail per person per round, listing everything waiting on them, so ten waiting items are one message, not ten.
- The person who raised an item is not reminded to approve it.
- `approval_reminder_log` (append-only, office read only): item, recipient, round, sent at, result. The job is idempotent per item, recipient and round, so a rerun never double-sends.
- E-mail content: kind of item, order reference, how long it has waited, link. No price, no customer name or phone, nothing about the supply source.
- E-mail goes through one adapter (H-21). The service and its secret are MJ's (B-61).
- Owner-only settings in `/office/settings`: reminders on or off per kind of item, the interval, the sending hours.

**Tests:** each step appears once, in order, with the right actor, for a Client Salon order taken end to end on the local stack; a waiting item produces one send through a fake adapter; a second run in the same round sends nothing; the next round sends again; a resolved item sends nothing more; the maker is not a recipient of their own item; the e-mail body contains no price and no phone number; a rep and a salon cannot read the reminder log; a manager cannot change the reminder settings.

Done when: the timeline shows every step for both order kinds, and the reminder job is proven against the fake adapter. Real e-mail is IMPLEMENTED - NOT VERIFIED until MJ has set the service and received one reminder.
