// P1-34 (public shop, plan C): the [Dummy] catalogue load shared by the seed script and its
// database test. Every product name, brand label, shade and price is invented (B-10, B-54, B-55,
// docs/decisions/2026-11-19-mj-answers.md; H-04). No real supplier, salon or price data belongs here.
//
// Rows carry deterministic ids, so a second run updates the same rows instead of adding new ones.
// Writes go through the existing office functions (H-08): app.office_upsert_product_group,
// app.office_upsert_product, app.office_upsert_sku and app.office_set_sku_price. The seed refuses
// any database whose host is not 127.0.0.1 or localhost (H-19).
import { createHash } from "node:crypto";

export const DUMMY = "[Dummy]";
// The one invented price, in paisa, for every shade (H-04). Rule for "no price looks real":
// all 19 SKUs carry this same repdigit amount (Rs 111.11) whatever their size, which no real
// trade price list would do, and its history reason and every label carry [Dummy].
export const DUMMY_PRICE_PAISA = 11_111;
export const DUMMY_PRICE_REASON = `${DUMMY} catalogue seed placeholder price (P1-34)`;
const DUMMY_BRAND_LABEL = `${DUMMY} Kiran`;
const CYCLE_DAYS = 30;
const ID_NAMESPACE = "kiran-dms/p1-34/dummy-catalogue";

/** A stable UUID for one seed slug, so reruns address the same row. */
function idOf(kind, slug) {
  const b = createHash("sha256").update(`${ID_NAMESPACE}/${kind}/${slug}`).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x80; // version 8 (custom, name-based)
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const groups = [
  { slug: "hair-colour", name: `${DUMMY} Hair Colour` },
  { slug: "bleach-lightener", name: `${DUMMY} Bleach and Lightener` },
  { slug: "keratin-treatments", name: `${DUMMY} Keratin and Treatments` },
  { slug: "after-care", name: `${DUMMY} After Care` },
].map((g) => ({ ...g, id: idOf("group", g.slug), cycleDays: CYCLE_DAYS, active: true }));

const products = [
  { slug: "musk-hair-colour", group: "hair-colour", name: `${DUMMY} Musk Hair Colour 100 ml` },
  { slug: "musk-blonder", group: "bleach-lightener", name: `${DUMMY} Musk Blonder 600 g` },
  { slug: "lunex-botox", group: "keratin-treatments", name: `${DUMMY} Lunex Botox / Strong Keratin 1000 ml` },
  { slug: "lunex-shampoo", group: "after-care", name: `${DUMMY} Lunex After Care Shampoo 300 ml` },
  { slug: "lunex-conditioner", group: "after-care", name: `${DUMMY} Lunex After Care Conditioner 300 ml` },
  { slug: "lunex-refill", group: "after-care", name: `${DUMMY} Lunex Keratin Refill 100 ml` },
].map((p) => ({
  ...p,
  id: idOf("product", p.slug),
  groupId: groups.find((g) => g.slug === p.group).id,
  brandLabel: DUMMY_BRAND_LABEL,
  active: true,
}));

const shadeSkus = Array.from({ length: 14 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return {
    slug: `musk-hair-colour-shade-${n}`,
    product: "musk-hair-colour",
    code: `DUMMY-MUSK-HC-100-${n}`,
    variant: `${DUMMY} Shade ${n}`,
    unit: "ml",
    size: 100,
  };
});

const singleSkus = [
  {
    slug: "musk-blonder-600",
    product: "musk-blonder",
    code: "DUMMY-MUSK-BLONDER-600",
    variant: `${DUMMY} 600 g`,
    unit: "g",
    size: 600,
  },
  {
    slug: "lunex-botox-1000",
    product: "lunex-botox",
    code: "DUMMY-LUNEX-BOTOX-1000",
    variant: `${DUMMY} 1000 ml`,
    unit: "ml",
    size: 1000,
  },
  {
    slug: "lunex-shampoo-300",
    product: "lunex-shampoo",
    code: "DUMMY-LUNEX-SHAMPOO-300",
    variant: `${DUMMY} 300 ml`,
    unit: "ml",
    size: 300,
  },
  {
    slug: "lunex-conditioner-300",
    product: "lunex-conditioner",
    code: "DUMMY-LUNEX-CONDITIONER-300",
    variant: `${DUMMY} 300 ml`,
    unit: "ml",
    size: 300,
  },
  {
    slug: "lunex-refill-100",
    product: "lunex-refill",
    code: "DUMMY-LUNEX-REFILL-100",
    variant: `${DUMMY} 100 ml`,
    unit: "ml",
    size: 100,
  },
];

const skus = [...shadeSkus, ...singleSkus].map((s) => ({
  ...s,
  id: idOf("sku", s.slug),
  productId: products.find((p) => p.slug === s.product).id,
  priceClientId: idOf("price", s.slug),
  active: true,
}));

export const DUMMY_CATALOGUE = Object.freeze({
  groups,
  products,
  skus,
  pricePaisa: DUMMY_PRICE_PAISA,
  priceReason: DUMMY_PRICE_REASON,
});

/** Refuses any database that is not on this machine (H-19); the seed never reaches a hosted project. */
export function assertLocalDatabaseUrl(url) {
  if (!url) throw new Error("KIRAN_STACK_DB_URL is not set (the seed never falls back to DATABASE_URL)");
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("KIRAN_STACK_DB_URL is not a valid connection URL");
  }
  if (!["127.0.0.1", "localhost"].includes(host)) {
    throw new Error(`refusing to seed a non-local database (${host || "no host"})`);
  }
}

async function readState(client) {
  const groupIds = groups.map((g) => g.id);
  const productIds = products.map((p) => p.id);
  const skuIds = skus.map((s) => s.id);
  const g = await client.query(
    "select id, name, default_cycle_days, active from public.product_group where id = any($1::uuid[])",
    [groupIds],
  );
  const p = await client.query(
    "select id, product_group_id, brand_label, name, active from public.product where id = any($1::uuid[])",
    [productIds],
  );
  const s = await client.query(
    "select id, product_id, code, variant, unit, size_value, list_price_paisa from public.sku where id = any($1::uuid[])",
    [skuIds],
  );
  return {
    groups: new Map(g.rows.map((r) => [r.id, r])),
    products: new Map(p.rows.map((r) => [r.id, r])),
    skus: new Map(s.rows.map((r) => [r.id, r])),
  };
}

function countsOf(state) {
  const seededSkus = [...state.skus.values()];
  return {
    groups: state.groups.size,
    products: state.products.size,
    skus: seededSkus.length,
    pricedSkus: seededSkus.filter((r) => r.list_price_paisa !== null).length,
  };
}

const same = (a, b) => (a ?? null) === (b ?? null);

/** What the run would change; a row that already matches is left untouched. */
function planFor(state) {
  const changes = [];
  const counts = {
    groups: { created: 0, updated: 0, unchanged: 0 },
    products: { created: 0, updated: 0, unchanged: 0 },
    skus: { created: 0, updated: 0, unchanged: 0 },
    prices: { created: 0, updated: 0, unchanged: 0 },
  };
  const add = (kind, action, label, detail) => {
    changes.push({ kind, action, label, ...(detail ? { detail } : {}) });
    counts[kind][action] += 1;
  };

  for (const g of groups) {
    const row = state.groups.get(g.id);
    if (!row) add("groups", "created", g.name);
    else if (!same(row.name, g.name) || Number(row.default_cycle_days) !== g.cycleDays || row.active !== g.active) {
      add("groups", "updated", g.name);
    } else add("groups", "unchanged", g.name);
  }

  for (const p of products) {
    const row = state.products.get(p.id);
    if (!row) add("products", "created", p.name);
    else if (
      !same(row.product_group_id, p.groupId) ||
      !same(row.brand_label, p.brandLabel) ||
      !same(row.name, p.name) ||
      row.active !== p.active
    ) {
      add("products", "updated", p.name);
    } else add("products", "unchanged", p.name);
  }

  for (const s of skus) {
    const row = state.skus.get(s.id);
    if (!row) add("skus", "created", `${s.code} ${s.variant}`);
    else if (
      !same(row.product_id, s.productId) ||
      !same(row.code, s.code) ||
      !same(row.variant, s.variant) ||
      !same(row.unit, s.unit) ||
      Number(row.size_value) !== s.size
    ) {
      add("skus", "updated", `${s.code} ${s.variant}`);
    } else add("skus", "unchanged", `${s.code} ${s.variant}`);
  }

  for (const s of skus) {
    const row = state.skus.get(s.id);
    const current = row?.list_price_paisa === null || row?.list_price_paisa === undefined ? null : Number(row.list_price_paisa);
    if (current === DUMMY_PRICE_PAISA) add("prices", "unchanged", s.code);
    else add("prices", row ? "updated" : "created", s.code, `${current ?? "none"} -> ${DUMMY_PRICE_PAISA} paisa`);
  }

  return { changes, counts };
}

/** Prices this seed did not write; refused rather than overwritten (a real price must never be replaced silently). */
function priceConflicts(state) {
  return skus
    .map((s) => ({ sku: s, current: state.skus.get(s.id)?.list_price_paisa }))
    .filter(({ current }) => current !== null && current !== undefined && Number(current) !== DUMMY_PRICE_PAISA)
    .map(({ sku, current }) => `${sku.code} (${current} paisa)`);
}

async function apply(client, actorId) {
  await client.query("select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)", [
    JSON.stringify({ sub: actorId, role: "authenticated", aal: "aal2" }),
    JSON.stringify({}),
  ]);
  await client.query("set local role authenticated");
  for (const g of groups) {
    await client.query("select app.office_upsert_product_group($1::uuid, $2, $3, $4)", [g.id, g.name, g.cycleDays, g.active]);
  }
  for (const p of products) {
    await client.query("select app.office_upsert_product($1::uuid, $2::uuid, $3, $4, $5)", [
      p.id,
      p.groupId,
      p.brandLabel,
      p.name,
      p.active,
    ]);
  }
  for (const s of skus) {
    await client.query("select app.office_upsert_sku($1::uuid, $2::uuid, $3, $4, $5, $6, null, null, $7)", [
      s.id,
      s.productId,
      s.code,
      s.variant,
      s.unit,
      s.size,
      s.active,
    ]);
  }
}

// The price loop needs the current value inside the same transaction; keeping it separate from
// apply() makes that read explicit.
async function applyPrices(client, state) {
  for (const s of skus) {
    const current = state.skus.get(s.id)?.list_price_paisa;
    if (current !== null && current !== undefined && Number(current) === DUMMY_PRICE_PAISA) continue;
    await client.query("select app.office_set_sku_price($1::uuid, $2::uuid, $3::bigint, $4)", [
      s.priceClientId,
      s.id,
      DUMMY_PRICE_PAISA,
      DUMMY_PRICE_REASON,
    ]);
  }
}

/**
 * Runs the catalogue seed against a local database. `dryRun` only reads and always rolls back;
 * `commit: false` applies and rolls back, for a caller that wants the result without persistence.
 */
export async function runDummyCatalogueSeed(client, { actorId, dryRun = false, commit = true } = {}) {
  if (!actorId) throw new Error("an owner or manager user id is required (the office functions check the actor)");
  await client.query("begin");
  try {
    const beforeState = await readState(client);
    const { changes, counts } = planFor(beforeState);
    const conflicts = priceConflicts(beforeState);
    const before = countsOf(beforeState);
    if (dryRun) {
      await client.query("rollback");
      return { dryRun: true, applied: false, conflicts, changes, counts, before, after: before };
    }
    if (conflicts.length > 0) {
      throw new Error(
        `refusing to overwrite a price that is not the ${DUMMY} placeholder: ${conflicts.join(", ")}; ` +
          "this seed only writes its invented price and never a real one (B-54, H-04)",
      );
    }
    await apply(client, actorId);
    await applyPrices(client, beforeState);
    await client.query("reset role");
    const after = countsOf(await readState(client));
    await client.query(commit ? "commit" : "rollback");
    return { dryRun: false, applied: true, conflicts, changes, counts, before, after };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  }
}
