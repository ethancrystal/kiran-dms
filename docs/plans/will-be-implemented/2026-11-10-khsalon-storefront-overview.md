# khsalon.com storefront: plan set overview

**Status:** DRAFT FOR MJ REVIEW. Written 10 Nov 2026 against `ethancrystal/kiran-dms` `main` at `8b80918`; revised the same day against `77006e3` with MJ's answers on who the shop serves and on prices (section 3). Nothing here has been built or run. The schema facts come from reading the migrations in the repo; the live database was not queried. Task status lives only on the board (`docs/ACTIVITY.md` section 12).

**Level of detail:** these are task-level plans. Before coding, each executor expands its plan to step level (exact files, SQL, tests) and commits that as the first change of its pull request, as the repo requires.

## 1. Goal

A public shop at khsalon.com, served by the same Next.js + Supabase app as the DMS, where:

1. every category, product and shade has its own ID, slug, meta title and meta description, edited in the office and shown on a unique, indexable page;
2. every button, link and scroll on the shop has a registered meaning and is recorded as first-party data that a person or an AI can read without a decoder;
3. a direct buyer's cart and payment run on Shopify, and the paid order comes back into the DMS office review queue;
4. a client salon can go from any product page to its own order request inside the salon portal, at the default price or, where the manager has set one for that salon, at its own price;
5. no per-salon price, stock figure, cost or supply source can reach a visitor.

## 2. What MJ decided in chat (10 Nov 2026)

| # | Question | MJ's answer (quoted) |
|---|---|---|
| 1 | Who buys and at what price | "Consumers, retail price" |
| 2 | Where the order and payment are taken | "Shopify checkout" |
| 3 | What KH Enterprises is | "Our own trading name"; later: "KH Enterprises is the trading name. KH Salon is a physical salon where we offer services." |
| 4 | Brands on public pages | "Yes all 3" (Musk, Lunex and Kemon). MJ added a remark about the distribution arrangement; it is not repeated in this public repository until he gives the wording he wants printed (B-59) |
| 5 | Catalogue master | "Yes 1" (DMS is master; Shopify receives the catalogue) |
| 6 | Tracking | "every single button and scroll should derive a meaning, and that meaning will be translated to analytical data that in turn could be fed into an AI or human can read it easily" |
| 7 | Who the shop serves | "products on the page is for direct purchase and for Client Salon to order too" |
| 8 | Order of work | "first update plans then do implementation" |
| 9 | Prices | "yes public pages shows the default price for the product and unless the price is not explicitly set for a Client Salon (dedicatedly for them only) they order at the same default rate, but if the manager sets customer plan and pricing for a Client Salon then after reaching that inside of their Client Salon Area the prices will get updated before checkout." |
| 10 | Order processing | "The order for processing will be divided into 1, Regular User 2, Client Salon. The Manager will see the review ques, Manager and Owner too as they will be responsible for relasing the product and delivery and completing and marking it delivered" |

## 3. Who the shop serves, and how prices work

**Two buyers (D-57).** A direct buyer pays through Shopify. A client salon orders the same product through its own salon area.

**One default price, shown publicly (D-58).** Every SKU has one default price, and the public page shows it. It is the existing `sku.list_price_paisa`; no second "retail" price is stored. A direct buyer pays the default price. A client salon pays the default price too, unless the manager has set a price for that salon alone (the existing `salon_sku_price`), in which case the salon sees its own price inside its salon area before it sends the order request.

**What stays private.** A price set for one salon is shown to that salon only, inside the portal, never on a public page and never to another salon. Stock quantities, cost and the supply source stay private as before.

**How a client salon orders from a product page (A-23, confirmed by MJ as amended by D-58).** The page carries a second action, "Salon client? Order at your price", which opens the existing salon portal on the DMS host with that product already in a new order request. The price shown there, the request and everything after it use the existing portal path (`app.salon_submit_request`, the office review queue). A parlor with no account uses the "Become a client salon" enquiry page.

**Two kinds of order in one queue (D-59).** Every order for processing is one of two kinds: Regular User (a direct buyer's paid order from the shop) or Client Salon (a salon's order request). Both sit in the existing office review queue, marked with their kind and filterable by it. The manager and the owner see the queue and are the ones who release the goods, arrange delivery, complete the order and mark it delivered. No new role and no second queue.

**One reading to confirm:** MJ's words are read as one default price for direct buyers and salons alike. If direct buyers should pay a different price from the salons' default, plan B gains a separate retail price per SKU; say so before plan B is built.

## 4. Rules these plans change, and how

| Rule | Today | Change (needs a DECISION entry quoting section 2) |
|---|---|---|
| H-22, Phase 1 only | A public shop is not in Phase 1 | D-51: MJ adds the public shop to Phase 1 as rows P1-32 to P1-37 |
| D-41, catalogue by invitation only | No anonymous access to anything | D-52: visitors may read published storefront rows, with each SKU's default price, through two functions only; D-41 stays as is for the salon portal and per-salon prices |
| H-21, no new third party | Shopify is not approved | D-53: Shopify approved for cart, checkout and payment, reached only through one adapter |
| Doc 16, one catalogue | One catalogue in the DMS | D-54: unchanged and reinforced; Shopify is a copy, never a source |
| Doc 07, public labels | `brand_label` is Kiran's public label | D-55: Musk, Lunex and Kemon are public brand names; KH Enterprises is the trading name; KH Salon is the salon. The supply source, cost and terms stay vault-only |
| H-21, analytics | No analytics allowed without approval | D-56: first-party tracking stored in the DMS database; no outside analytics, pixel or session replay |
| D-41, salon ordering | A salon orders only inside the portal | D-57: the shop serves direct buyers and client salons; the salon still orders inside the portal, reached from the product page (A-23) |
| Review queue (D-34) | One queue for rep and salon requests | D-59: the same queue also carries Regular User orders; each item shows its kind, Regular User or Client Salon; manager and owner release, deliver and mark delivered |
| Price visibility | Every price sits behind a login | D-58: the default price of a published SKU is public; a price set for one salon stays visible to that salon only |

## 5. Questions still open (to log as blockers; defaults in brackets)

| Ref | Question | Blocks | Default until answered |
|---|---|---|---|
| B-54 | The default price of every SKU, entered by MJ or the manager in the office and not written in the repository; reorder cycle days per category | C (publishing) | SKUs without a price stay unsold and unpublished; cycle days use the existing `[default-unconfirmed]` values |
| B-55 | Confirm the shade numbers as printed on the bill, including the ones with a leading dot; the pack artwork reads "Leather Textured Sulfate Free Shampoo" (is "Lather" meant?) | C | Enter as printed; do not publish the shampoo until confirmed |
| B-56 | How does a consumer's online order enter the one order engine, which needs a salon on every order? | F | One internal customer account named for the online shop; Shopify keeps the buyer's name, phone and address, the DMS stores only the Shopify order number |
| B-57 | Does the Shopify store exist? Plan, payment methods (cash on delivery?), delivery areas | F | Nothing built against a live store |
| B-58 | Wording of the tracking notice, and how long raw events are kept | E | Short notice in the footer; raw events 12 months, daily totals kept |
| B-59 | May the site state the distribution arrangement for these brands, and in what words? | D | Nothing about it is printed, here or on the site, until MJ gives the wording |
| B-60 | D-49 says an order is completed and invoiced only with the customer's signed acknowledgement plus the office's approval. A Regular User order is delivered to a member of the public, often by courier. May the manager or owner mark a Regular User order delivered without that signature, and what proof replaces it (courier reference, Shopify fulfilment)? | F (completing a Regular User order) | Plan F stops at putting the paid order in the queue as Regular User; completing it is not built until MJ answers. Client Salon orders keep D-49 unchanged |

## 6. MJ's own actions (no agent may do these)

- Approve each migration before it is applied to the Kiran Supabase project (H-19).
- Create the Shopify store and its app, and set every Shopify secret himself.
- Point khsalon.com at the deployment (DNS).
- Enter the default prices in the office, supply final product pictures and approve the page copy.
- Say in chat, per pull request, when it may merge.

## 7. Build order

| Order | Board row | Plan | Depends on |
|---|---|---|---|
| 1 | P1-32 | A. Decisions and records | nothing |
| 2 | P1-33 | B. Public catalogue data | A |
| 3 | P1-34 | C. Catalogue load from the bill and photos | B, B-55 |
| 4 | P1-35 | D. Storefront pages and SEO | B (C for real content) |
| 5 | P1-36 | E. Meaningful tracking | D |
| 6 | P1-37 | F. Shopify link | B, D, E, B-56, B-57 (B-60 for completing a Regular User order) |

One branch, one pull request and one log entry per plan. D and E may be built by the same agent back to back; they are separate pull requests.

## 8. Systems and domains

One app, one database, one deployment. Not one system per role.

| Who | Where | What it is |
|---|---|---|
| Public visitor | `khsalon.com` | The shop (plan D). New. |
| Owner and manager | `dms.khsalon.com/office` | One office area. The owner sees the governance screens (bank details, write-offs, settings, audit log); the manager does not. Product upload lives here in `/office/products`, so this is the CMS; no separate CMS is built. Exists. |
| Rep | `dms.khsalon.com/app` | The rep app, installable on the phone as a PWA, with offline work in progress (P1-09). Exists. |
| Salon or parlor client | `dms.khsalon.com/salon` | The salon portal, by invitation. Exists. Product pages on the shop link into it (D-57). |
| Buyer paying | Shopify's checkout | Hosted by Shopify (plan F). |

- **Domains needed:** one registered domain, khsalon.com, plus one subdomain for the DMS. The name `dms.khsalon.com` is a proposal; MJ picks it. The app serves the shop or the DMS by host name. Plan D's executor adds that host rule and keeps `/office`, `/app`, `/salon` and `/invite` off the public host.
- **PWA and hosting are not alternatives.** The PWA is how the rep app installs on a phone. Hosting is where the app runs: the log entry `2026-11-10-mj-railway-deploy` records it on Railway today; older docs name Vercel. Nothing in this plan set needs a move.
- **Accounting:** the DMS already holds invoices, payments, receivables, commission and the investor ledger. It is not a full accounting package; accountant exports are a Phase 3 row (P3-03).
- **Blog:** not in this plan set. If MJ wants one, it is a small office section plus `/blog` pages on the shop, planned after plan D.

## 9. Files of this plan set

- `2026-11-10-khsalon-storefront-plan-a-decisions.md`
- `2026-11-10-khsalon-storefront-plan-b-catalogue-data.md`
- `2026-11-10-khsalon-storefront-plan-c-catalogue-load.md`
- `2026-11-10-khsalon-storefront-plan-d-pages-seo.md`
- `2026-11-10-khsalon-storefront-plan-e-tracking.md`
- `2026-11-10-khsalon-storefront-plan-f-shopify.md`
- `2026-11-10-khsalon-storefront-agent-prompts.md`

## 10. Not in this plan set

Consumer accounts on khsalon.com, reviews, discount codes, a blog, Urdu pages, paid-ads pixels, salon service booking, and any change to how parlors order. Each is a new question for MJ, not code.
