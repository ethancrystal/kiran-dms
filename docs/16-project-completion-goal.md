# Kiran DMS: project completion goal

**This file is the authoritative business specification.** Where it conflicts with an older document or decision, this file wins and the older one is amended. Existing architecture and naming stay the implementation source of truth wherever they do not conflict. Design and rulings: `docs/superpowers/specs/2026-11-05-reps-salons-catalogue-investors-design.md`.

Recorded from MJ on 2026-11-04 and 2026-11-05. The goal is verbatim, with MJ's spelling; the requirements below are the master task's business sections.

## MJ's goal

goal is to complete this system where I can have some basic features where I dont have to calculate progfit from each investor and all of their investments and how much money they will get on it will be decided by manager/owner. Then Sales Rep should signup and have their own dashboard area where they could see just how much they have earned in commission, only guarded account info will be available to them to which they cannot change or edit abythign, they can only take notes and send it to manager for approval and manager will create an order from 1 click changing the notepad to an order or she could just choose the products or (Manager) can only add products too deciding price and name and pictures of it so it will be listed when creating new orders. Cient Salon will be able to create new orders too and could only see the upodated list of products to make order from that manager maintains. Manager/Owner should have their area where they can invite Rep to signup for their account and also to Client Salon for getting signed up and place orders.

## Master task: business requirements

### Manager and Owner
The Office workspace provides: Rep and Salon account invitations and management; product catalogue management; product images and descriptions; product pricing; official order creation and approval; a central order-request review workflow; payments and outstanding balances; Rep commission management; investor-related financial decisions without automated investor profit calculations.

The Manager performs the specified account, product and pricing operations. Permissions go no further: for example, a Manager cannot promote a user to Owner.

### Sales Representatives
Reps access only their assigned Salons; view permitted Salon information in read-only mode; add Salon notes; submit New Order Details and order requests; view their requests and relevant official orders; deliver and collect according to the approved workflow; view their own commission information and payment history. Reps must not create, approve or modify official orders. SAL-09 is reconciled with this read-only requirement.

### Salon Customers
The Salon Portal uses the existing membership and authorization architecture. Salons log in through an invitation; view their own Salon account; browse the shared active product catalogue; see their own approved prices; submit order requests; view and track their orders; view permitted payment and account information. Strict Salon-to-Salon data isolation. Salon Customers are not an internal `user_profile.role`.

### Unified order workflow
One coherent Office review experience for Rep and Salon submissions. A Rep submission is an order request, not an official order. A Salon submission is also subject to Office approval. The Office can convert a Rep submission into an official order, create official orders directly, and approve or reject customer submissions. The canonical `sales_order` and `sales_order_line` model is reused, with no second order ledger. Requested order statuses are reconciled with the existing data model, keeping the business meaning without duplicate order systems or blindly added enum values.

### Delivery approval
The Manager-controlled delivery approval workflow (D-32). A Rep submission must not finalize stock movements, invoicing or order completion before the required Office approval.

### Commission and investor finances
Commission visibility, management and payment history as above, superseding the earned-only part of D-31. Investor finances stay separate from Rep commissions, with no automated investor profit-calculation or distribution engine.

### Safeguards
Forward-only migrations; reuse of canonical entities; no duplicate tables, RPCs, dashboards, order engines, product catalogues, payment ledgers or CRM systems; permissions enforced in RLS and server-side RPCs, not only by hiding UI; historical records and audit trails preserved; idempotency and maker-checker preserved; integer paisa for money; supplier, cost and margin data never exposed to unauthorized users; no hard deletes of business records; offline Rep functionality preserved; branch and pull-request workflow; no direct push to `main` and no production data changes without authorization.
