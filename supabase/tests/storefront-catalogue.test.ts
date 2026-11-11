/**
 * Public catalogue data (migration 20261111010000, P1-33, D-52, D-54, D-58).
 * Tested as real signed-in roles. The public price is sku.list_price_paisa.
 * A per-salon price must not come back from the visitor reads.
 * Synthetic prices and names only (H-03, H-04).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { errorOf, fx, MANAGER, MANAGER_AAL1, OWNER, REP_A, run, sqlstate, type Who } from "./helpers/db";
import { asLoginRows, type Login, newLogin, quote } from "./helpers/invite";

const C = { commit: true };
const id = () => randomUUID();
const tag = () => randomUUID().slice(0, 8);
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];

const DENIED = "42501";
const BAD_INPUT = "22023";
const WRONG_STATE = "55000";
const DUPLICATE = "23505";
const LIST = 100000;
const LIST2 = 50000;
const SALON_PRICE = 90000;

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

let salonLogin: Login;

const asManager = () => `reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.manager.id, role: "authenticated", aal: "aal2" })}', true),
         set_config('request.headers', '${JSON.stringify({ "x-kiran-device": fx.manager.device })}', true);
  set local role authenticated;`;

type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
const last = async (sql: string) => ((await run("postgres", sql)) as unknown as Multi).at(-1)?.rows ?? [];

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T, `[Test] Shop ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Shop area')", [AREA, T]);
  await one(MANAGER, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'manual')", [
    SALON,
    `[Test] Shop salon ${tag()}`,
    AREA,
  ]);
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, 21)", [GROUP, `[Test] Shop group ${tag()}`]);
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
  });

  it("an unpublished or unknown address returns no row", async () => {
    expect((await run("anon", "select * from app.storefront_product($1)", ["not-a-page"])).rows).toEqual([]);
  });

  it("a product page still resolves when its category is not published, and the catalogue omits it", async () => {
    const rows = await last(`${asManager()}
      select app.office_set_storefront_published('${id()}', 'category', '${GROUP}', false);
      reset role;
      select set_config('request.jwt.claims', '{"role":"anon"}', true);
      set local role anon;
      select (select count(*)::int from app.storefront_catalogue() where product_id = '${PRODUCT}') as catalogue,
             (select count(*)::int from app.storefront_product('${slug}')) as page;`);
    expect(rows[0]).toEqual({ catalogue: 0, page: 2 });
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
    const leak = /salon|cost|margin|supplier|qty|stock/i;
    expect(rows.filter((r) => leak.test(r.attname))).toEqual([]);
    const bodies = await run<{ def: string }>(
      "postgres",
      `select pg_get_functiondef(p.oid) def from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname in ('storefront_catalogue', 'storefront_product')`,
    );
    for (const r of bodies.rows) {
      expect(r.def.includes("salon_sku_price")).toBe(false);
      expect(r.def.includes("warehouse_availability")).toBe(false);
    }
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
    ).toMatch(/client_id already used with different content/);
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
    ).toMatch(/published address cannot change/);
  });

  it("a shade with no default price cannot be published", async () => {
    expect(await sqlstate(MANAGER, "select app.office_set_storefront_published($1, 'sku', $2, true)", [id(), UNPRICED])).toBe(
      WRONG_STATE,
    );
    expect(await errorOf(MANAGER, "select app.office_set_storefront_published($1, 'sku', $2, true)", [id(), UNPRICED])).toMatch(
      /this shade has no default price/,
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

  it("anon cannot read the price, stock or shop tables", async () => {
    for (const table of [
      "public.sku",
      "public.salon_sku_price",
      "public.sku_price_change",
      "public.stock_movement",
      "public.storefront_category",
      "public.storefront_product",
      "public.storefront_sku",
      "public.storefront_write",
    ]) {
      expect(await sqlstate("anon", `select * from ${table}`)).toBe(DENIED);
    }
  });

  it("the shop tables cannot be deleted or the write log changed", async () => {
    expect(await sqlstate("postgres", "delete from public.storefront_product where product_id = $1", [PRODUCT])).toBe(DENIED);
    expect(await sqlstate("postgres", "update public.storefront_write set kind = kind")).toBe(DENIED);
    expect(await sqlstate(MANAGER, "delete from public.storefront_sku where sku_id = $1", [SKU1])).toBe(DENIED);
  });
});
