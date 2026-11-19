/**
 * Public catalogue data (migration 20261111010000, P1-33, D-52, D-54, D-58).
 * Tested as real signed-in roles. The public price is sku.list_price_paisa.
 * A per-salon price must not come back from the visitor reads.
 * Synthetic prices and names only (H-03, H-04).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { errorOf, fx, MANAGER, MANAGER_AAL1, OWNER, REP_A, run, sqlstate, type Who } from "./helpers/db";
import { asLoginRows, type Login, newLogin, quote } from "./helpers/invite";
import { claims, type PersonaKey } from "./setup/fixtures";

const C = { commit: true };
const id = () => randomUUID();
const TAG_LENGTH = 8;
const tag = () => randomUUID().slice(0, TAG_LENGTH);
/** Runs the checks one after another: the tests share one database and one small pool. */
const each = <T>(items: readonly T[], check: (item: T) => Promise<void> | void) =>
  items.reduce(async (done, item) => {
    await done;
    await check(item);
  }, Promise.resolve());
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];

const DENIED = "42501";
const BAD_INPUT = "22023";
const WRONG_STATE = "55000";
const DUPLICATE = "23505";
const LIST = 100000;
const LIST2 = 50000;
const SALON_PRICE = 90000;
const FIVE_MB = 5_242_880;
// Counts the tests expect, named for what they count.
const PUBLISHED_SHADES = 2; // SKU1 and SKU2 of the first product
const SHADES_OF_FIRST_PRODUCT = 3; // those two and the unpriced one
const SEEDED_PICTURES = 2; // image and image2 in the stand-in bucket
const MIN_AUDIT_ROWS = 8; // the seeded office writes on the first product, its group and its first shade
const ONE_BLOCK_SPLITS_IN = 2; // a text holding the marker once splits into two parts
const MIN_BLOCK_LENGTH = 500; // the storage block is far longer; an empty slice would be a broken test

const T = id();
const AREA = id();
const SALON = id();
const GROUP = id();
const PRODUCT = id();
const SKU1 = id();
const SKU2 = id();
const UNPRICED = id();
const WH = id();
const PAGE_CLIENT = id();
// A second product whose page is saved with no picture and whose one priced shade is not published.
const PRODUCT2 = id();
const SKU3 = id();
const slug2 = `plain-${tag()}`;
const title2 = `Dummy plain ${tag()} page`;
const groupName = `[Test] Shop group ${tag()}`;
const slug = `shade-${tag()}`;
const catSlug = `group-${tag()}`;
const title = `Dummy shade ${tag()} page`;
const catTitle = `Dummy group ${tag()} page`;
const blurb = (n: string) => `[Dummy] A public page used only by the database test ${n} today.`;
const desc = blurb(tag());
const catDesc = blurb(tag());
const image = `storefront/${PRODUCT}/${id()}.png`;
const code1 = `T-SF1-${tag().toUpperCase()}`;
const code2 = `T-SF2-${tag().toUpperCase()}`;
const code3 = `T-SF3-${tag().toUpperCase()}`;
const desc2 = blurb(tag());
const image2 = `storefront/${PRODUCT2}/${id()}.webp`;

let salonLogin: Login;

const asManager = () => `reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.manager.id, role: "authenticated", aal: "aal2" })}', true),
         set_config('request.headers', '${JSON.stringify({ "x-kiran-device": fx.manager.device })}', true);
  set local role authenticated;`;

/** Switches the open transaction to a seeded persona, the way PostgREST would. */
const asPersona = (key: PersonaKey, aal: "aal1" | "aal2") => `reset role;
  select set_config('request.jwt.claims', '${claims(fx[key].id, aal)}', true),
         set_config('request.headers', '${JSON.stringify(fx[key].device ? { "x-kiran-device": fx[key].device } : {})}', true);
  set local role authenticated;`;
const asAnon = `reset role;
  select set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('request.headers', '{}', true);
  set local role anon;`;

type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
/** Runs several statements in one transaction that is rolled back; returns the last statement's rows. */
const last = async (sql: string) => ((await run("postgres", sql)) as unknown as Multi).at(-1)?.rows ?? [];
/** What a visitor gets for the first product after the given office statements, in one rolled-back transaction. */
const visitorAfter = async (officeSql: string) =>
  (
    await last(`${asManager()}
      ${officeSql}
      ${asAnon}
      select (select count(*)::int from app.storefront_catalogue() where product_id = '${PRODUCT}') as catalogue,
             (select count(*)::int from app.storefront_product('${slug}')) as page;`)
  )[0];

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T, `[Test] Shop ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Shop area')", [AREA, T]);
  await one(MANAGER, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'manual')", [
    SALON,
    `[Test] Shop salon ${tag()}`,
    AREA,
  ]);
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, 21)", [GROUP, groupName]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Shop colour')", [PRODUCT, GROUP]);
  await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100, null, null, true)", [
    SKU1,
    PRODUCT,
    code1,
  ]);
  await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100, null, null, true)", [
    SKU2,
    PRODUCT,
    code2,
  ]);
  await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100, null, null, true)", [
    UNPRICED,
    PRODUCT,
    `T-SF0-${tag().toUpperCase()}`,
  ]);
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU1, LIST]);
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU2, LIST2]);
  await one(MANAGER, "select app.office_set_salon_price($1, $2, $3, $4, 'dummy salon price')", [id(), SALON, SKU1, SALON_PRICE]);
  await one(MANAGER, "select app.office_upsert_storefront_category($1, $2, $3, $4, $5, null)", [
    id(),
    GROUP,
    catSlug,
    catTitle,
    catDesc,
  ]);
  await one(MANAGER, "select app.office_upsert_storefront_product($1, $2, $3, $4, $5, null, null, $6)", [
    PAGE_CLIENT,
    PRODUCT,
    slug,
    title,
    desc,
    image,
  ]);
  await one(MANAGER, "select app.office_set_storefront_published($1, 'sku', $2, true)", [id(), SKU1]);
  await one(MANAGER, "select app.office_set_storefront_published($1, 'sku', $2, true)", [id(), SKU2]);
  await one(MANAGER, "select app.office_set_storefront_published($1, 'product', $2, true)", [id(), PRODUCT]);
  await one(MANAGER, "select app.office_set_storefront_published($1, 'category', $2, true)", [id(), GROUP]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Shop plain')", [PRODUCT2, GROUP]);
  await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100, null, null, true)", [
    SKU3,
    PRODUCT2,
    code3,
  ]);
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU3, LIST]);
  await one(MANAGER, "select app.office_upsert_storefront_product($1, $2, $3, $4, $5, null, null, null)", [
    id(),
    PRODUCT2,
    slug2,
    title2,
    desc2,
  ]);
  await one(MANAGER, "select app.office_create_location($1, 'warehouse', $2)", [WH, `[Test] Shop store ${tag()}`]);
  await run(
    "postgres",
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, 4, $2, 'receipt', $3)`,
    [SKU1, WH, fx.manager.id],
    C,
  );
  const inv = (
    await run(
      MANAGER,
      `select app.office_invite($1, 'salon', '[Test] Shop login', $2, $3, null, null, null, null) as r`,
      [id(), `shop.${tag()}@example.test`, SALON],
      C,
    )
  ).rows[0].r as { email: string; token: string };
  salonLogin = await newLogin({ email: inv.email });
  await run("postgres", `${asLogin(salonLogin)} select app.redeem_invitation(${quote(inv.token)})`, [], C);
});

function asLogin(l: Login) {
  const claims = JSON.stringify({
    sub: l.id,
    role: "authenticated",
    aal: "aal1",
    session_id: l.session,
    email: l.email,
    amr: [{ method: "otp", timestamp: 1 }],
  });
  return `reset role;
    select set_config('request.jwt.claims', '${claims}', true), set_config('request.headers', '{}', true);
    set local role authenticated;`;
}

describe("visitor reads return the default price and nothing else", () => {
  it("a visitor and the salon both see the default price, not the salon price", async () => {
    const anonCat = await run(
      "anon",
      "select lowest_default_price_paisa::text p from app.storefront_catalogue() where product_id = $1",
      [PRODUCT],
    );
    expect(anonCat.rows).toHaveLength(1);
    expect(anonCat.rows[0].p).toBe(String(LIST2));

    const anonPage = await run(
      "anon",
      "select code, default_price_paisa::text p, available from app.storefront_product($1) order by code",
      [slug],
    );
    expect(anonPage.rows.map((r) => [r.code, r.p, r.available])).toEqual([
      [code1, String(LIST), true],
      [code2, String(LIST2), false],
    ]);

    const asSalon = await asLoginRows(
      salonLogin,
      `select code, default_price_paisa::text p from app.storefront_product('${slug}') order by code`,
    );
    expect(asSalon.map((r) => [r.code, r.p])).toEqual([
      [code1, String(LIST)],
      [code2, String(LIST2)],
    ]);
    expect(asSalon.some((r) => String(r.p) === String(SALON_PRICE))).toBe(false);

    // The catalogue too: the salon that has its own price for the first shade still gets the default.
    const salonCat = await asLoginRows(
      salonLogin,
      `select lowest_default_price_paisa::text p from app.storefront_catalogue() where product_id = '${PRODUCT}'`,
    );
    expect(salonCat).toEqual([{ p: String(LIST2) }]);
  });

  it("an unknown address, a blank one and a page that was never published return no row", async () => {
    await each(["not-a-page", "", slug2], async (address) => {
      expect((await run("anon", "select * from app.storefront_product($1)", [address])).rows).toEqual([]);
    });
    expect((await run("anon", "select * from app.storefront_product(null)")).rows).toEqual([]);
    expect((await run("anon", "select * from app.storefront_catalogue() where product_id = $1", [PRODUCT2])).rows).toEqual([]);
  });

  it("the published page is there before any change (the baseline the next tests take away)", async () => {
    expect(await visitorAfter("")).toEqual({ catalogue: 1, page: PUBLISHED_SHADES });
  });

  it("an unpublished product returns nothing by its address and leaves the catalogue", async () => {
    expect(await visitorAfter(`select app.office_set_storefront_published('${id()}', 'product', '${PRODUCT}', false);`)).toEqual({
      catalogue: 0,
      page: 0,
    });
  });

  it("unpublishing the category page takes its product pages down too", async () => {
    expect(await visitorAfter(`select app.office_set_storefront_published('${id()}', 'category', '${GROUP}', false);`)).toEqual({
      catalogue: 0,
      page: 0,
    });
  });

  it("a product, or a category, made inactive after publishing is hidden from both reads", async () => {
    expect(
      await visitorAfter(
        `select app.office_upsert_product('${PRODUCT}', '${GROUP}', '[Dummy] Kiran', '[Dummy] Shop colour', false);`,
      ),
    ).toEqual({ catalogue: 0, page: 0 });
    expect(await visitorAfter(`select app.office_upsert_product_group('${GROUP}', '${groupName}', 21, false);`)).toEqual({
      catalogue: 0,
      page: 0,
    });
  });

  it("a shade made inactive after publishing leaves the page, and the lowest price follows", async () => {
    const rows = await last(`${asManager()}
      select app.office_upsert_sku('${SKU2}', '${PRODUCT}', '${code2}', '[Dummy] shade', 'ml', 100, null, null, false);
      ${asAnon}
      select (select array_agg(code order by code) from app.storefront_product('${slug}')) as codes,
             (select lowest_default_price_paisa::text from app.storefront_catalogue() where product_id = '${PRODUCT}') as lowest;`);
    expect(rows[0]).toEqual({ codes: [code1], lowest: String(LIST) });
  });

  it("the read functions name no salon, cost, margin, supplier, quantity or stock column", async () => {
    const { rows } = await run<{ proname: string; attname: string }>(
      "postgres",
      `select p.proname, cols.attname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       join unnest(p.proargnames, p.proargmodes) with ordinality as cols(attname, mode, ord) on true
       where n.nspname = 'app' and p.proname in ('storefront_catalogue', 'storefront_product')
         and cols.mode in ('t', 'o')
       order by 1, cols.ord`,
    );
    expect(rows.length).toBeGreaterThan(0);
    // A column whose name holds one of these words would carry private data (the plan's own list).
    const leakWords = ["salon", "cost", "margin", "supplier", "qty", "stock"];
    expect(rows.filter((r) => leakWords.some((word) => r.attname.toLowerCase().includes(word)))).toEqual([]);
    const bodies = await run<{ def: string }>(
      "postgres",
      `select pg_get_functiondef(p.oid) def from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname in ('storefront_catalogue', 'storefront_product')`,
    );
    await each(bodies.rows, async (r) => {
      expect(r.def.includes("salon_sku_price")).toBe(false);
      expect(r.def.includes("warehouse_availability")).toBe(false);
    });
  });
});

describe("office writes", () => {
  it("a replayed client_id writes once", async () => {
    await run(MANAGER, "select app.office_upsert_storefront_product($1, $2, $3, $4, $5, null, null, $6)", [
      PAGE_CLIENT,
      PRODUCT,
      slug,
      title,
      desc,
      image,
    ]);
    const n = await run("postgres", "select count(*)::int n from public.storefront_write where client_id = $1", [PAGE_CLIENT]);
    expect(n.rows[0].n).toBe(1);
  });

  it("the same client_id with different content is refused", async () => {
    expect(
      await sqlstate(MANAGER, "select app.office_upsert_storefront_product($1, $2, $3, $4, $5, null, null, $6)", [
        PAGE_CLIENT,
        PRODUCT,
        slug,
        "Different dummy title",
        desc,
        image,
      ]),
    ).toBe(DUPLICATE);
    expect(
      await errorOf(MANAGER, "select app.office_upsert_storefront_product($1, $2, $3, $4, $5, null, null, $6)", [
        PAGE_CLIENT,
        PRODUCT,
        slug,
        "Different dummy title",
        desc,
        image,
      ]),
    ).toContain("client_id already used with different content");
  });

  it("a published address cannot change", async () => {
    expect(
      await sqlstate(MANAGER, "select app.office_upsert_storefront_product($1, $2, $3, $4, $5, null, null, $6)", [
        id(),
        PRODUCT,
        `other-${tag()}`,
        title,
        desc,
        image,
      ]),
    ).toBe(BAD_INPUT);
    expect(
      await errorOf(MANAGER, "select app.office_upsert_storefront_product($1, $2, $3, $4, $5, null, null, $6)", [
        id(),
        PRODUCT,
        `other-${tag()}`,
        title,
        desc,
        image,
      ]),
    ).toContain("published address cannot change");
  });

  it("a second page cannot repeat an address, a meta title or a meta description, and is told which in plain words", async () => {
    // The second product's page (never published, so its address may still change) tries each of the first page's values.
    const save = "select app.office_upsert_storefront_product($1, $2, $3, $4, $5, null, null, null)";
    const repeats: Array<[string, string[]]> = [
      ["another page already uses this address", [slug, title2, desc2]],
      ["another page already uses this meta title", [slug2, title, desc2]],
      ["another page already uses this meta description", [slug2, title2, desc]],
    ];
    await each(repeats, async ([message, fields]) => {
      expect(await sqlstate(MANAGER, save, [id(), PRODUCT2, ...fields])).toBe(DUPLICATE);
      expect(await errorOf(MANAGER, save, [id(), PRODUCT2, ...fields])).toBe(message);
    });
    // The refusal wrote nothing: the second page still has its own values, and no write was recorded for the attempt.
    const key = id();
    expect(await sqlstate(MANAGER, save, [key, PRODUCT2, slug, title2, desc2])).toBe(DUPLICATE);
    const { rows } = await run(
      "postgres",
      `select s.slug, s.meta_title, (select count(*)::int from public.storefront_write w where w.client_id = $2) as written
       from public.storefront_product s where s.product_id = $1`,
      [PRODUCT2, key],
    );
    expect(rows).toEqual([{ slug: slug2, meta_title: title2, written: 0 }]);
    // A category page is told the same way.
    const otherGroup = id();
    const category = `${asManager()}
      select app.office_upsert_product_group('${otherGroup}', '[Test] Shop group two ${tag()}', 21);
      select app.office_upsert_storefront_category('${id()}', '${otherGroup}', '${catSlug}', 'Dummy second group page', '${blurb(tag())}', null);`;
    expect(await sqlstate("postgres", category)).toBe(DUPLICATE);
    expect(await errorOf("postgres", category)).toBe("another page already uses this address");
  });

  it("a published category address cannot change either", async () => {
    const sql = "select app.office_upsert_storefront_category($1, $2, $3, $4, $5, null)";
    const params = () => [id(), GROUP, `other-${tag()}`, catTitle, catDesc];
    expect(await sqlstate(MANAGER, sql, params())).toBe(BAD_INPUT);
    expect(await errorOf(MANAGER, sql, params())).toContain("published address cannot change");
    // Still refused after the page is unpublished: published_at is never cleared.
    expect(
      await errorOf(
        "postgres",
        `${asManager()}
         select app.office_set_storefront_published('${id()}', 'category', '${GROUP}', false);
         select app.office_upsert_storefront_category('${id()}', '${GROUP}', 'other-${tag()}', '${catTitle}', '${catDesc}', null);`,
      ),
    ).toContain("published address cannot change");
  });

  it("a product with no picture, or with no published priced shade, cannot be published", async () => {
    const publish = "select app.office_set_storefront_published($1, 'product', $2, true)";
    expect(await sqlstate(MANAGER, publish, [id(), PRODUCT2])).toBe(WRONG_STATE);
    expect(await errorOf(MANAGER, publish, [id(), PRODUCT2])).toContain("needs a picture");
    const savePicture = `select app.office_upsert_storefront_product('${id()}', '${PRODUCT2}', '${slug2}', '${title2}', '${desc2}', null, null, '${image2}');`;
    const withPicture = `${asManager()} ${savePicture}
      select app.office_set_storefront_published('${id()}', 'product', '${PRODUCT2}', true);`;
    expect(await sqlstate("postgres", withPicture)).toBe(WRONG_STATE);
    expect(await errorOf("postgres", withPicture)).toContain("needs a published shade with a default price");
    // With the picture and the shade published it goes through: the checks above were the only obstacle.
    const rows = await last(`${asManager()} ${savePicture}
      select app.office_set_storefront_published('${id()}', 'sku', '${SKU3}', true);
      select published from app.office_set_storefront_published('${id()}', 'product', '${PRODUCT2}', true);`);
    expect(rows).toEqual([{ published: true }]);
  });

  it("an inactive product, shade or category cannot be published", async () => {
    const product = `${asManager()}
      select app.office_upsert_product('${PRODUCT2}', '${GROUP}', '[Dummy] Kiran', '[Dummy] Shop plain', false);`;
    expect(
      await errorOf("postgres", `${product} select app.office_set_storefront_published('${id()}', 'sku', '${SKU3}', true);`),
    ).toContain("this product is inactive");
    expect(
      await errorOf(
        "postgres",
        `${product} select app.office_set_storefront_published('${id()}', 'product', '${PRODUCT2}', true);`,
      ),
    ).toContain("this product is inactive");
    const shade = `${asManager()}
      select app.office_upsert_sku('${SKU3}', '${PRODUCT2}', '${code3}', '[Dummy] shade', 'ml', 100, null, null, false);
      select app.office_set_storefront_published('${id()}', 'sku', '${SKU3}', true);`;
    expect(await sqlstate("postgres", shade)).toBe(WRONG_STATE);
    expect(await errorOf("postgres", shade)).toContain("this shade is inactive");
    const category = `${asManager()}
      select app.office_upsert_product_group('${GROUP}', '${groupName}', 21, false);
      select app.office_set_storefront_published('${id()}', 'category', '${GROUP}', true);`;
    expect(await sqlstate("postgres", category)).toBe(WRONG_STATE);
    expect(await errorOf("postgres", category)).toContain("this category is inactive");
  });

  it("publish refuses a missing key, an unknown kind, an unknown row and a page that was never saved", async () => {
    const publish = "select app.office_set_storefront_published($1, $2, $3, true)";
    expect(await sqlstate(MANAGER, publish, [null, "sku", SKU1])).toBe(BAD_INPUT);
    expect(await sqlstate(MANAGER, publish, [id(), "price", SKU1])).toBe(BAD_INPUT);
    expect(await errorOf(MANAGER, publish, [id(), "sku", id()])).toContain("unknown shade");
    expect(await errorOf(MANAGER, publish, [id(), "product", id()])).toContain("unknown product");
    expect(await errorOf(MANAGER, publish, [id(), "category", id()])).toContain("unknown category");
    // A product that exists but has no saved page: made and published in one rolled-back transaction.
    const fresh = id();
    expect(
      await errorOf(
        "postgres",
        `${asManager()}
         select app.office_upsert_product('${fresh}', '${GROUP}', '[Dummy] Kiran', '[Dummy] Shop unsaved ${tag()}');
         select app.office_set_storefront_published('${id()}', 'product', '${fresh}', true);`,
      ),
    ).toContain("save the page before publishing");
  });

  it("a replayed publish writes once and does not undo a later change", async () => {
    const key = id();
    const rows = await last(`${asManager()}
      select app.office_set_storefront_published('${key}', 'sku', '${SKU2}', false);
      select app.office_set_storefront_published('${key}', 'sku', '${SKU2}', false);
      select app.office_set_storefront_published('${id()}', 'sku', '${SKU2}', true);
      select r.published as replayed,
             (select count(*)::int from app.office_storefront_sheet() s, jsonb_array_elements(s.skus) k
               where k ->> 'id' = '${SKU2}' and (k ->> 'published')::boolean) as still_on
      from app.office_set_storefront_published('${key}', 'sku', '${SKU2}', false) r;`);
    // The replay answers with the row as it is now (on again) and changes nothing.
    expect(rows).toEqual([{ replayed: true, still_on: 1 }]);
    const written = await last(`${asManager()}
      select app.office_set_storefront_published('${key}', 'sku', '${SKU2}', false);
      select app.office_set_storefront_published('${key}', 'sku', '${SKU2}', false);
      reset role;
      select count(*)::int n from public.storefront_write where client_id = '${key}';`);
    expect(written).toEqual([{ n: 1 }]);
    // The same key for a different switch is refused.
    expect(
      await sqlstate(
        "postgres",
        `${asManager()}
         select app.office_set_storefront_published('${key}', 'sku', '${SKU2}', false);
         select app.office_set_storefront_published('${key}', 'sku', '${SKU1}', false);`,
      ),
    ).toBe(DUPLICATE);
  });

  it("a shade with no default price cannot be published", async () => {
    expect(await sqlstate(MANAGER, "select app.office_set_storefront_published($1, 'sku', $2, true)", [id(), UNPRICED])).toBe(
      WRONG_STATE,
    );
    expect(await errorOf(MANAGER, "select app.office_set_storefront_published($1, 'sku', $2, true)", [id(), UNPRICED])).toContain(
      "this shade has no default price",
    );
  });

  it("clearing the picture of a published product is refused", async () => {
    expect(
      await sqlstate(MANAGER, "select app.office_upsert_storefront_product($1, $2, $3, $4, $5, null, null, null)", [
        id(),
        PRODUCT,
        slug,
        title,
        desc,
      ]),
    ).toBe(WRONG_STATE);
  });

  it("unpublishing the only remaining published shade of a published product is refused", async () => {
    expect(
      await sqlstate(
        "postgres",
        `${asManager()}
         select app.office_set_storefront_published('${id()}', 'sku', '${SKU2}', false);
         select app.office_set_storefront_published('${id()}', 'sku', '${SKU1}', false);`,
      ),
    ).toBe(WRONG_STATE);
  });

  it("a rep, a manager without MFA, anon and the salon cannot write", async () => {
    const sql = "select app.office_upsert_storefront_category($1, $2, $3, $4, $5, null)";
    const params = [id(), GROUP, catSlug, catTitle, catDesc];
    expect(await sqlstate(REP_A, sql, params)).toBe(DENIED);
    expect(await sqlstate(MANAGER_AAL1, sql, params)).toBe(DENIED);
    expect(await sqlstate("anon", sql, params)).toBe(DENIED);
    const asSalon = `select app.office_upsert_storefront_category('${id()}', '${GROUP}', '${catSlug}', '${catTitle}', '${catDesc}', null)`;
    expect(await sqlstate("postgres", `${asLogin(salonLogin)} ${asSalon}`)).toBe(DENIED);
  });

  it("the office sheet is for the office only, and shows what was written", async () => {
    const sheet = "select * from app.office_storefront_sheet()";
    expect(await sqlstate(REP_A, sheet)).toBe(DENIED);
    expect(await sqlstate(MANAGER_AAL1, sheet)).toBe(DENIED);
    expect(await sqlstate({ as: "owner", aal: "aal1" }, sheet)).toBe(DENIED);
    expect(await sqlstate("anon", sheet)).toBe(DENIED);
    expect(await sqlstate("service_role", sheet)).toBe(DENIED);
    expect(await sqlstate("postgres", `${asLogin(salonLogin)} ${sheet}`)).toBe(DENIED);
    expect(await sqlstate(OWNER, sheet)).toBeNull();
    const { rows } = await run(
      MANAGER,
      `select category_slug, category_published, slug, image_path, published, skus
       from app.office_storefront_sheet() where product_id = $1`,
      [PRODUCT],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category_slug: catSlug, category_published: true, slug, image_path: image, published: true });
    const shades = (rows[0].skus as Array<{ id: string; published: boolean; list_price_paisa: number | null }>).map((k) => [
      k.id,
      k.published,
      k.list_price_paisa === null ? null : Number(k.list_price_paisa),
    ]);
    expect(shades).toHaveLength(SHADES_OF_FIRST_PRODUCT);
    expect(shades).toEqual(
      expect.arrayContaining([
        [SKU1, true, LIST],
        [SKU2, true, LIST2],
        [UNPRICED, false, null],
      ]),
    );
  });

  it("every application role is refused the helper functions", async () => {
    await each(["anon", REP_A, MANAGER, OWNER, "service_role"] as Who[], async (who) => {
      expect(await sqlstate(who, "select app.storefront_shade_available($1)", [SKU1])).toBe(DENIED);
      expect(await sqlstate(who, "select app.storefront_duplicate('storefront_product_slug_key')")).toBe(DENIED);
      expect(await sqlstate(who, "select app.storefront_hash(array['a'])")).toBe(DENIED);
      expect(await sqlstate(who, "select app.storefront_seen($1, 'sku', $2, repeat('0', 64))", [id(), SKU1])).toBe(DENIED);
      expect(await sqlstate(who, "select app.storefront_record($1, 'sku', $2, repeat('0', 64))", [id(), SKU1])).toBe(DENIED);
    });
  });

  it("anon cannot read the price, stock or shop tables", async () => {
    await each(
      [
        "public.sku",
        "public.salon_sku_price",
        "public.sku_price_change",
        "public.stock_movement",
        "public.stock_location",
        "public.stock_count",
        "public.stock_issue",
        "public.product",
        "public.product_group",
        "public.storefront_category",
        "public.storefront_product",
        "public.storefront_sku",
        "public.storefront_write",
      ],
      async (table) => {
        expect(await sqlstate("anon", `select * from ${table}`)).toBe(DENIED);
      },
    );
  });

  it("the shop tables cannot be deleted or the write log changed", async () => {
    expect(await sqlstate("postgres", "delete from public.storefront_product where product_id = $1", [PRODUCT])).toBe(DENIED);
    expect(await sqlstate("postgres", "update public.storefront_write set kind = kind")).toBe(DENIED);
    expect(await sqlstate(MANAGER, "delete from public.storefront_sku where sku_id = $1", [SKU1])).toBe(DENIED);
  });

  it("the write log is append-only for every application role and for the table owner (H-06)", async () => {
    const seeded = await run("postgres", "select count(*)::int n from public.storefront_write");
    expect(seeded.rows[0].n).toBeGreaterThan(0);
    await each(["anon", REP_A, MANAGER_AAL1, MANAGER, OWNER, "service_role"] as Who[], async (who) => {
      expect(await sqlstate(who, "update public.storefront_write set kind = kind")).toBe(DENIED);
      expect(await sqlstate(who, "delete from public.storefront_write")).toBe(DENIED);
      expect(
        await sqlstate(
          who,
          `insert into public.storefront_write (client_id, kind, subject_id, payload_hash, actor_id)
           values (gen_random_uuid(), 'sku', $1, repeat('0', 64), $2)`,
          [SKU1, fx.manager.id],
        ),
      ).toBe(DENIED);
    });
    // The table owner is stopped by the trigger, not by a missing grant.
    expect(await errorOf("postgres", "update public.storefront_write set kind = kind")).toContain("append-only");
    expect(await errorOf("postgres", "delete from public.storefront_write")).toContain("append-only");
  });

  it("no shop table can be emptied, by a delete or by a truncate (H-07)", async () => {
    await each(["storefront_category", "storefront_product", "storefront_sku", "storefront_write"], async (table) => {
      expect(await sqlstate("postgres", `truncate public.${table}`)).toBe(DENIED);
      expect(await sqlstate("postgres", `delete from public.${table}`)).toBe(DENIED);
      await each([MANAGER, OWNER, "service_role"] as Who[], async (who) => {
        expect(await sqlstate(who, `truncate public.${table}`)).toBe(DENIED);
        expect(await sqlstate(who, `delete from public.${table}`)).toBe(DENIED);
        expect(await sqlstate(who, `update public.${table} set created_at = created_at`)).toBe(DENIED);
      });
    });
  });
});

describe("audit (H-17)", () => {
  const STOREFRONT_AUDIT = "select count(*)::int n from control.audit_event where table_name like 'public.storefront_%'";

  it("each office write left an audit row with the session's actor and a purpose, and the chain verifies", async () => {
    const { rows } = await run(
      "postgres",
      `select table_name, action, actor_id::text actor, actor_role, purpose,
              coalesce(after ->> 'product_id', after ->> 'product_group_id', after ->> 'sku_id', after ->> 'client_id') as key
       from control.audit_event
       where table_name like 'public.storefront_%'
         and coalesce(after ->> 'product_id', after ->> 'product_group_id', after ->> 'sku_id', after ->> 'subject_id')
             in ($1, $2, $3)
       order by seq`,
      [PRODUCT, GROUP, SKU1],
    );
    const seen = rows.map((r) => `${r.table_name} ${r.action} ${r.purpose}`);
    expect(seen).toEqual(
      expect.arrayContaining([
        "public.storefront_category INSERT storefront category",
        "public.storefront_product INSERT storefront product",
        "public.storefront_sku INSERT storefront shade published",
        "public.storefront_product UPDATE storefront product published",
        "public.storefront_category UPDATE storefront category published",
      ]),
    );
    // The idempotency record is audited too, in the same write.
    expect(rows.some((r) => r.table_name === "public.storefront_write" && r.action === "INSERT")).toBe(true);
    // The actor comes from the session, never from an argument: every row is the manager who wrote it.
    expect(rows.length).toBeGreaterThanOrEqual(MIN_AUDIT_ROWS);
    expect(new Set(rows.map((r) => r.actor))).toEqual(new Set([fx.manager.id]));
    expect(new Set(rows.map((r) => r.actor_role))).toEqual(new Set(["manager"]));
    expect(rows.every((r) => r.key !== null)).toBe(true);
    const chain = (await run("postgres", "select ok, first_bad_seq from control.verify_audit_chain()")).rows[0];
    expect(chain).toEqual({ ok: true, first_bad_seq: null });
  });

  it("a refused write leaves no audit row and no page change", async () => {
    const before = (await run("postgres", STOREFRONT_AUDIT)).rows[0].n;
    expect(await sqlstate(MANAGER, "select app.office_set_storefront_published($1, 'sku', $2, true)", [id(), UNPRICED])).toBe(
      WRONG_STATE,
    );
    expect(await sqlstate(REP_A, "select app.office_set_storefront_published($1, 'sku', $2, false)", [id(), SKU1])).toBe(DENIED);
    expect((await run("postgres", STOREFRONT_AUDIT)).rows[0].n).toBe(before);
    expect(
      (await run("postgres", "select count(*)::int n from public.storefront_sku where sku_id = $1", [UNPRICED])).rows[0].n,
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The picture bucket. The embedded test database has no storage schema, so the migration's storage
// block did nothing there. To still run that block, the test builds a stand-in storage schema (the
// two tables and the columns the block touches) inside a transaction that is rolled back, executes
// the block exactly as the migration file has it, and then acts as each role against the policies.
// On a real Supabase database (CI) the block already ran, and the test reads what it made.
const MIGRATION = readFileSync(join(import.meta.dirname, "..", "migrations", "20261111010000_storefront_catalogue.sql"), "utf8");
const BLOCK_END = "end $storage$;";
const STORAGE_BLOCK = MIGRATION.slice(MIGRATION.indexOf("do $storage$"), MIGRATION.indexOf(BLOCK_END) + BLOCK_END.length);
const STAND_IN = `
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean default false,
                                file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(),
                                bucket_id text references storage.buckets (id), name text not null);
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  ${STORAGE_BLOCK}
  insert into storage.objects (bucket_id, name) values ('storefront-images', '${image}'), ('storefront-images', '${image2}');`;

describe("pictures: the storefront-images bucket", () => {
  const hasStorage = async () =>
    (
      await run<{ has: boolean }>(
        "postgres",
        "select to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null as has",
      )
    ).rows[0].has;
  const POLICIES = `select policyname, cmd, roles::text roles, coalesce(qual, '') || ' ' || coalesce(with_check, '') body
    from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'storefront_images_%' order by 1`;
  const expectPolicies = (pol: Array<Record<string, unknown>>) => {
    // No policy names anon, and there is no UPDATE policy: an uploaded public picture is never overwritten.
    expect(pol.map((p) => [p.policyname, p.cmd, p.roles])).toEqual([
      ["storefront_images_delete", "DELETE", "{authenticated}"],
      ["storefront_images_insert", "INSERT", "{authenticated}"],
      ["storefront_images_read", "SELECT", "{authenticated}"],
    ]);
    expect(pol.every((p) => String(p.body).includes("storefront-images"))).toBe(true);
    expect(pol.every((p) => String(p.body).includes("is_office()"))).toBe(true);
    expect(pol.filter((p) => p.cmd === "DELETE").every((p) => String(p.body).includes("storefront_image_published"))).toBe(true);
  };

  it("the migration has exactly one storage block, and it names no anon policy and no UPDATE policy", () => {
    expect(MIGRATION.split("do $storage$").length).toBe(ONE_BLOCK_SPLITS_IN);
    expect(STORAGE_BLOCK.length).toBeGreaterThan(MIN_BLOCK_LENGTH);
    expect(STORAGE_BLOCK).not.toContain("to anon");
    expect(STORAGE_BLOCK).not.toContain("for update");
  });

  it("where there is no storage schema the migration made no bucket and no policy", async () => {
    if (await hasStorage()) return;
    const { rows } = await run("postgres", "select count(*)::int n from pg_policies where policyname like 'storefront_images_%'");
    expect(rows[0].n).toBe(0);
  });

  it("the block makes a public bucket with the picture types and 5 MB, and three office-only policies", async () => {
    if (await hasStorage()) {
      const bucket = (await run("postgres", "select to_jsonb(b) b from storage.buckets b where id = 'storefront-images'")).rows[0]
        ?.b;
      expect(bucket).toBeTruthy();
      if ("public" in bucket) expect(bucket.public).toBe(true);
      if ("file_size_limit" in bucket) expect(Number(bucket.file_size_limit)).toBe(FIVE_MB);
      if ("allowed_mime_types" in bucket)
        expect([...bucket.allowed_mime_types].sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
      expectPolicies((await run("postgres", POLICIES)).rows);
      const name = `storefront/${PRODUCT}/${id()}.png`;
      expect(
        await sqlstate(REP_A, "insert into storage.objects (bucket_id, name) values ('storefront-images', $1)", [name]),
      ).toBe(DENIED);
      return;
    }
    const made = await last(`${STAND_IN} select to_jsonb(b) b from storage.buckets b where id = 'storefront-images';`);
    expect(made[0].b).toMatchObject({
      id: "storefront-images",
      public: true,
      file_size_limit: FIVE_MB,
      allowed_mime_types: ["image/png", "image/jpeg", "image/webp"],
    });
    expectPolicies(await last(`${STAND_IN} ${POLICIES};`));
  });

  it("run against the stand-in: a visitor, a rep and a salon cannot list, write or delete; the office can upload and list", async () => {
    if (await hasStorage()) return; // the stand-in cannot be built beside a real storage schema
    const fresh = () => `storefront/${PRODUCT}/${id()}.png`;
    const count = "select count(*)::int n from storage.objects where bucket_id = 'storefront-images'";
    const insert = (name: string) => `insert into storage.objects (bucket_id, name) values ('storefront-images', '${name}')`;

    // A visitor: no object name can be listed (the public URL is how a picture is served), nothing written.
    expect(await last(`${STAND_IN} ${asAnon} ${count};`)).toEqual([{ n: 0 }]);
    expect(await sqlstate("postgres", `${STAND_IN} ${asAnon} ${insert(fresh())};`)).toBe(DENIED);
    expect(await last(`${STAND_IN} ${asAnon} delete from storage.objects; reset role; ${count};`)).toEqual([
      { n: SEEDED_PICTURES },
    ]);

    // A rep, a manager who has not passed MFA, and the salon login: the same.
    await each([asPersona("repA", "aal1"), asPersona("manager", "aal1"), asLogin(salonLogin)], async (who) => {
      expect(await last(`${STAND_IN} ${who} ${count};`)).toEqual([{ n: 0 }]);
      expect(await sqlstate("postgres", `${STAND_IN} ${who} ${insert(fresh())};`)).toBe(DENIED);
      expect(await last(`${STAND_IN} ${who} delete from storage.objects; reset role; ${count};`)).toEqual([
        { n: SEEDED_PICTURES },
      ]);
    });

    // The office at AAL2: lists both, uploads under the name shape, and nowhere else.
    await each([asPersona("manager", "aal2"), asPersona("owner", "aal2")], async (who) => {
      expect(await last(`${STAND_IN} ${who} ${count};`)).toEqual([{ n: SEEDED_PICTURES }]);
      expect(await last(`${STAND_IN} ${who} ${insert(fresh())}; ${count};`)).toEqual([{ n: SEEDED_PICTURES + 1 }]);
      expect(await sqlstate("postgres", `${STAND_IN} ${who} ${insert("storefront/not-a-product/x.png")};`)).toBe(DENIED);
      expect(await sqlstate("postgres", `${STAND_IN} ${who} ${insert(`${PRODUCT}/${id()}.png`)};`)).toBe(DENIED);
      expect(await sqlstate("postgres", `${STAND_IN} ${who} ${insert(`storefront/${PRODUCT}/${id()}.svg`)};`)).toBe(DENIED);
    });
  });

  it("run against the stand-in: nobody overwrites a picture, and the office deletes only one no published page shows", async () => {
    if (await hasStorage()) return;
    const office = asPersona("manager", "aal2");
    const names = "select array_agg(name order by name) names from storage.objects where bucket_id = 'storefront-images'";
    // No UPDATE policy: the rename touches no row, for the office as for anyone.
    const renamed = await last(`${STAND_IN} ${office}
      update storage.objects set name = 'storefront/${PRODUCT}/${id()}.png' where bucket_id = 'storefront-images';
      reset role; ${names};`);
    expect(renamed[0].names).toEqual([image, image2].sort());
    // image is the picture of the published first product; image2 belongs to no published page.
    const left = await last(
      `${STAND_IN} ${office} delete from storage.objects where bucket_id = 'storefront-images'; reset role; ${names};`,
    );
    expect(left[0].names).toEqual([image]);
    // Once the product is unpublished its picture can go.
    const gone = await last(`${STAND_IN} ${office}
      select app.office_set_storefront_published('${id()}', 'product', '${PRODUCT}', false);
      delete from storage.objects where name = '${image}';
      reset role; ${names};`);
    expect(gone[0].names).toEqual([image2]);
  });

  it("the helper says only whether a name is a published page's picture", async () => {
    const ask = "select app.storefront_image_published($1) as shown";
    expect((await run(MANAGER, ask, [image])).rows[0].shown).toBe(true);
    expect((await run(MANAGER, ask, [image2])).rows[0].shown).toBe(false);
    expect((await run(REP_A, ask, [`storefront/${PRODUCT}/${id()}.png`])).rows[0].shown).toBe(false);
    expect(await sqlstate("anon", ask, [image])).toBe(DENIED);
    expect(await sqlstate("service_role", ask, [image])).toBe(DENIED);
  });
});
