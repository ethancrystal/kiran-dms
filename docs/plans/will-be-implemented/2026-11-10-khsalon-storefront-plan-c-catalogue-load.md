# khsalon.com storefront, plan C (P1-34): catalogue load from the bill and photos

**Status:** DRAFT FOR MJ REVIEW, task level. Nothing here has been built or run. Read `2026-11-10-khsalon-storefront-overview.md` first: it holds MJ's decisions, the open questions and the build order. The prompt for the executor is in `2026-11-10-khsalon-storefront-agent-prompts.md`. Status lives only on the board (`docs/ACTIVITY.md` section 12, row P1-34).

**Goal:** the products MJ has shown are in the catalogue with their public fields drafted, through the office functions, as a seed that can be run twice without duplicates.

**Source:** one scanned bill dated 2 Nov 2026 and two product photos, shown by MJ in chat. The buyer named on the bill is not entered anywhere.

**Prices are entered in the office, not in the repository.** No real price is written in this plan, the seed, a test or a log (H-04; a price set for one salon must never be in a public repository). The seed creates categories, products and SKUs with no price; the owner or manager enters each default price in `/office/products`. A SKU with no price cannot be sold or published, which is the existing rule.

| Category | Product | SKUs |
|---|---|---|
| Hair Colour | Musk Hair Colour 100 ml | 14 shades: 66/0, 77/0, 0.11, 9.11, 8.11, 6.11, 8 B.P, .6/2, .8/71, .7/71, .8/31, .7/77, .6/77, .7/75 |
| Bleach and Lightener | Musk Blonder 600 g | 1 |
| Keratin and Treatments | Lunex Botox / Strong Keratin 1000 ml | 1 |
| After Care (Kemon Lunex Keratin System) | After Care Shampoo 300 ml | 1 |
| After Care | After Care Conditioner 300 ml | 1 |
| After Care | Keratin Refill 100 ml | 1 |

Tasks
- [ ] Get MJ's answer to B-55 (shade numbers, label wording) first. Do not guess a shade number, and write no price anywhere.
- [ ] SKU codes must match `^[A-Z0-9][A-Z0-9-]{1,39}$`. Proposed rule: `MUSK-HC-100-` plus the shade with `/` written as `-` and `.` written as `D` (so 66/0 becomes `MUSK-HC-100-66-0`, 9.11 becomes `MUSK-HC-100-9D11`). The printed shade number stays in `variant` exactly as on the pack.
- [ ] Write the seed as calls to the office functions with fixed `client_id` values and no price. No raw inserts.
- [ ] Draft a unique slug, meta title, meta description and page text per product and per category. No medical or result claims that the pack does not make. MJ approves the copy before publish.
- [ ] Run on the local stack twice; row counts must match after the second run.
- [ ] Mark every row published = false. Publishing is done in the office by MJ or the manager.

Done when: the seed is merged and proven rerunnable locally. Running it on the hosted project is a separate, explicit OK from MJ.
