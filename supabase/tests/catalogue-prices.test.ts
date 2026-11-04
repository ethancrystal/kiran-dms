/**
 * Catalogue pictures, descriptions, manager prices and per-salon prices (migration 20261105110000,
 * slice 2, P1-19; D-37, D-39; spec R6; OQ-33 at its default). Tested as real signed-in roles.
 *
 * - product.description and product.image_path through app.office_upsert_product (null keeps, an
 *   empty string clears; the path is an allowlisted storage object name under this product's id).
 * - app.office_set_sku_price (owner or manager at AAL2, reason, replay) and app.owner_set_sku_price
 *   (owner only, as before) both write public.sku_price_change.
 * - public.salon_sku_price through app.office_set_salon_price; app.office_salon_prices.
 * - app.build_order: a line with no price takes the salon's price; list price is the cap; the discount
 *   hold against list is unchanged.
 * - app.office_catalogue, the vault and cost leak checks, the product-images storage branch.
 *
 * Setup rows are committed with fresh ids; every order and change under test runs in a rolled-back
 * transaction unless the test commits it on purpose.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  errorOf,
  fx,
  MANAGER,
  MANAGER_AAL1,
  OWNER,
  OWNER_AAL1,
  REP_A,
  REP_A_WRONG_DEVICE,
  REP_B,
  run,
  SUSPENDED,
  sqlstate,
  type Who,
} from "./helpers/db";
import { asLoginRows, newLogin } from "./helpers/invite";

const C = { commit: true };
const id = () => randomUUID();
const TAG_LENGTH = 8;
const tag = () => randomUUID().slice(0, TAG_LENGTH);
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];

const DENIED = "42501";
const BAD_INPUT = "22023";
const WRONG_STATE = "55000";
const DUPLICATE = "23505";
const CHECK_VIOLATION = "23514";

const LIST = 100000; // Rs 1,000
const LIST2 = 50000; // Rs 500
const SALON_PRICE = 90000; // Rs 900: 10% under list, at the manager's discount threshold
const CEILING = 10000000; // app.price_ceiling_paisa(): Rs 100,000
const DESCRIPTION_MAX = 1000;
const GROUP_CYCLE_DAYS = 21;
const SKU_SIZE = 100;

const T = id(),
  AREA = id();
const SALON = id(),
  SALON2 = id(),
  SALON_MEMBER = id(),
  PENDING = id(),
  REJECTED = id();
const GROUP = id(),
  PRODUCT = id(),
  INACTIVE_PRODUCT = id(),
  SKU1 = id(),
  SKU2 = id(),
  UNPRICED = id(),
  INACTIVE_SKU = id();

const REFUSED: Array<[string, Who]> = [
  ["rep A", REP_A],
  ["rep B", REP_B],
  ["rep A on an unapproved device", REP_A_WRONG_DEVICE],
  ["a suspended rep", SUSPENDED],
  ["a manager without MFA", MANAGER_AAL1],
  ["the owner without MFA", OWNER_AAL1],
  ["anon", "anon"],
];

const img = (product: string, ext = "png") => `products/${product}/${id()}.${ext}`;
/** A SQL literal: null, a number as written, or a single-quoted string with its quotes doubled. */
function q(v: string | number | null) {
  if (v === null) return "null";
  if (typeof v === "number") return String(v);
  // Every single quote, doubled: "it's" becomes "it''s"; a string with no quote is unchanged.
  // https://regex101.com/?regex=%27&flavor=javascript&testString=it%27s
  return `'${v.replace(/'/g, "''")}'`;
}
/** Runs f on each item, one after another (the shared database takes one statement at a time here). */
const inTurn = <T>(items: readonly T[], f: (t: T) => Promise<unknown>) =>
  items.reduce<Promise<unknown>>(async (prev, t) => {
    await prev;
    return f(t);
  }, Promise.resolve());
const QTY = 2;
const PRICE_STEP = 1000; // Rs 10
const MIN_KEYS = 20; // the catalogue and the sheet have more keys than this; an empty read does not
const FIVE_MB = 5242880;
const NEGATIVE = -5;
// A key that names a cost, a party or a lot: "unit_cost" or "po_ref" match; "list_price_paisa" does not.
// https://regex101.com/?regex=cost%7Csupplier%7Cvendor%7Cmargin%7Clot%7Cpurchase%7C%5Epo_%7C_po%24%7Cbatch&flavor=javascript&flags=i
const LEAKY_KEY = /cost|supplier|vendor|margin|lot|purchase|^po_|_po$|batch/i;
// The stale-salon-price refusal: "this salon's price for T-CAT-1A2B is above its list price" matches; "unknown sku" does not.
// https://regex101.com/?regex=salon%27s+price+for+T-CAT-.*+is+above+its+list+price&flavor=javascript
const STALE_PRICE = /salon's price for T-CAT-.* is above its list price/;
// A write policy body naming the office check before the folder: "app.is_office() ... products/" matches; "true" does not.
// https://regex101.com/?regex=is_office%5C%28%5C%29.*products&flavor=javascript&flags=s
const OFFICE_UNDER_PRODUCTS = /is_office\(\).*products/s;
const upsertSql = (pid: string, description: string | null = null, image: string | null = null, name = "[Dummy] Catalogue colour") =>
  `select to_jsonb(app.office_upsert_product(${q(pid)}, ${q(GROUP)}, '[Dummy] Kiran', ${q(name)}, true, ${q(description)}, ${q(image)})) as r`;
const skuPriceSql = (cid: string, sku: string, price: number | null, reason = "dummy price change") =>
  `select app.office_set_sku_price(${q(cid)}, ${q(sku)}, ${q(price)}, ${q(reason)}) as r`;
const salonPriceSql = (cid: string, salon: string, sku: string, price: number | null, reason = "dummy salon price") =>
  `select app.office_set_salon_price(${q(cid)}, ${q(salon)}, ${q(sku)}, ${q(price)}, ${q(reason)}) as r`;

const listPrice = async (sku: string) =>
  Number((await run("postgres", "select list_price_paisa p from public.sku where id = $1", [sku])).rows[0].p);
const historyCount = async (sku: string) =>
  (await run("postgres", "select count(*)::int n from public.sku_price_change where sku_id = $1", [sku])).rows[0].n as number;
const salonPriceCount = async (salon: string) =>
  (await run("postgres", "select count(*)::int n from public.salon_sku_price where salon_id = $1", [salon])).rows[0].n as number;
const pricesOf = async (who: Who, salon: string) =>
  (await run(who, "select * from app.office_salon_prices($1)", [salon])).rows as Array<Record<string, unknown>>;

// One transaction: steps as people, then a final read as postgres.
const asUser = (who: "repA" | "manager" | "owner") => {
  const aal = who === "repA" ? "aal1" : "aal2";
  return `reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx[who].id, role: "authenticated", aal })}', true),
         set_config('request.headers', '${JSON.stringify({ "x-kiran-device": fx[who].device })}', true);
  set local role authenticated;`;
};
type Step = ["repA" | "manager" | "owner" | "postgres", string];
type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
const script = (steps: Step[]) => steps.map(([k, sql]) => `${k === "postgres" ? "reset role;" : asUser(k)}\n${sql}`).join("\n");
const tx = async (steps: Step[]) => ((await run("postgres", script(steps))) as unknown as Multi).at(-1)?.rows ?? [];
const txCode = (steps: Step[]) => sqlstate("postgres", script(steps));
const txError = (steps: Step[]) => errorOf("postgres", script(steps));

type Line = { sku: string; qty: number; price?: number };
const linesJson = (ls: Line[]) =>
  `'${JSON.stringify(ls.map((l) => ({ sku_id: l.sku, qty: l.qty, ...(l.price === undefined ? {} : { unit_price_paisa: l.price }) })))}'::jsonb`;
const createOrder = (who: "manager" | "owner", cid: string, salon: string, ls: Line[]): Step => [
  who,
  `select (app.office_create_order('${cid}', '${salon}', 'CASH', ${linesJson(ls)}, null, null)).id;`,
];
const orderRead = (cid: string): Step => [
  "postgres",
  `select o.status, o.hold_discount, o.subtotal_paisa, o.discount_paisa, o.total_paisa, o.discount_by_owner,
          a.checker_role_required as checker,
          (select jsonb_agg(jsonb_build_object('sku', l.sku_id, 'list', l.list_price_paisa, 'unit', l.unit_price_paisa,
                                               'total', l.line_total_paisa) order by l.line_no)
             from public.sales_order_line l where l.order_id = o.id) as lines
   from public.sales_order o left join control.approval_request a on a.id = o.discount_approval_id
   where o.client_id = '${cid}';`,
];
const setSalonPrice = (who: "manager" | "owner", salon: string, sku: string, price: number | null): Step => [
  who,
  `select (app.office_set_salon_price('${id()}', '${salon}', '${sku}', ${q(price)}, 'dummy salon price')).id;`,
];

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T, `[Test] Catalogue ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Catalogue area')", [AREA, T]);
  await inTurn([SALON, SALON2, SALON_MEMBER], (s) =>
    one(MANAGER, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'manual')", [s, `[Test] Catalogue salon ${tag()}`, AREA]),
  );
  await inTurn(
    [
      [PENDING, "pending"],
      [REJECTED, "rejected"],
    ] as const,
    ([s, status]) =>
      run(
        "postgres",
        `insert into public.salon (id, name, type, area_id, source, created_by, approval_status)
         values ($1, $2, 'ladies_parlor', $3, 'map_pin', $4, $5::public.salon_approval)`,
        [s, `[Test] Catalogue ${status} ${tag()}`, AREA, fx.repA.id, status],
        C,
      ),
  );
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, $3)", [GROUP, `[Test] Catalogue group ${tag()}`, GROUP_CYCLE_DAYS]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Catalogue colour')", [PRODUCT, GROUP]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Retired colour', false)", [
    INACTIVE_PRODUCT,
    GROUP,
  ]);
  await inTurn(
    [
      [SKU1, PRODUCT, true],
      [SKU2, PRODUCT, true],
      [UNPRICED, PRODUCT, true],
      [INACTIVE_SKU, INACTIVE_PRODUCT, false],
    ] as const,
    ([s, p, active]) =>
      one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', $4, null, null, $5)", [
        s,
        p,
        `T-CAT-${tag().toUpperCase()}`,
        SKU_SIZE,
        active,
      ]),
  );
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU1, LIST]);
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU2, LIST2]);
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [INACTIVE_SKU, LIST]);
});

// ---------------------------------------------------------------------------------------------
describe("product description and picture path (app.office_upsert_product)", () => {
  it.each([
    ["manager", MANAGER],
    ["owner", OWNER],
  ])("the %s sets a description and a picture path; a null keeps them; an empty string clears them", async (_n, who) => {
    const pid = id();
    const path = img(pid);
    const made = (await run(who, upsertSql(pid, "  [Dummy] Long-lasting shade for salons.  ", path), [], C)).rows[0].r;
    expect(made).toMatchObject({ description: "[Dummy] Long-lasting shade for salons.", image_path: path, active: true });
    // A caller that does not name the new fields (the older four-argument form) keeps them.
    await run(who, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Renamed colour')", [pid, GROUP], C);
    const kept = (await run("postgres", "select name, description, image_path from public.product where id = $1", [pid])).rows[0];
    expect(kept).toEqual({ name: "[Dummy] Renamed colour", description: "[Dummy] Long-lasting shade for salons.", image_path: path });
    await run(who, upsertSql(pid, "", ""), [], C);
    const cleared = (await run("postgres", "select description, image_path from public.product where id = $1", [pid])).rows[0];
    expect(cleared).toEqual({ description: null, image_path: null });
  });

  it.each(["png", "jpg", "jpeg", "webp"])("accepts a .%s picture under the product's own folder", async (ext) => {
    expect(await sqlstate(MANAGER, upsertSql(PRODUCT, null, img(PRODUCT, ext)))).toBeNull();
  });

  it.each([
    ["a URL", (p: string) => `https://example.test/products/${p}/${id()}.png`],
    ["a scheme", (p: string) => `file:products/${p}/${id()}.png`],
    ["path traversal", (p: string) => `products/${p}/../${id()}.png`],
    ["a leading slash", (p: string) => `/products/${p}/${id()}.png`],
    ["a backslash", (p: string) => `products\\${p}\\${id()}.png`],
    ["another product's folder", () => `products/${id()}/${id()}.png`],
    ["another top folder", (p: string) => `salons/${p}/${id()}.png`],
    ["a .gif", (p: string) => `products/${p}/${id()}.gif`],
    ["an .svg", (p: string) => `products/${p}/${id()}.svg`],
    ["upper case", (p: string) => `products/${p}/${id().toUpperCase()}.PNG`],
    ["a free file name", (p: string) => `products/${p}/photo.png`],
    ["a line break inside", (p: string) => `products/${p}/\n${id()}.png`],
  ])("refuses %s as a picture path (22023), and the table refuses it too", async (_n, make) => {
    const bad = make(PRODUCT);
    expect(await sqlstate(MANAGER, upsertSql(PRODUCT, null, bad))).toBe(BAD_INPUT);
    expect(await sqlstate("postgres", "update public.product set image_path = $1 where id = $2", [bad, PRODUCT])).toBe(CHECK_VIOLATION);
  });

  it("refuses a description over 1000 characters; exactly 1000 is kept", async () => {
    expect(await sqlstate(MANAGER, upsertSql(PRODUCT, "x".repeat(DESCRIPTION_MAX + 1)))).toBe(BAD_INPUT);
    expect(await sqlstate(MANAGER, upsertSql(PRODUCT, "x".repeat(DESCRIPTION_MAX)))).toBeNull();
    expect(await sqlstate("postgres", "update public.product set description = '   ' where id = $1", [PRODUCT])).toBe(CHECK_VIOLATION);
  });

  it.each(REFUSED)("%s cannot add or edit a product", async (_n, who) => {
    expect(await sqlstate(who, upsertSql(id(), "[Dummy] text"))).toBe(DENIED);
    expect(await sqlstate(who, upsertSql(PRODUCT, "[Dummy] changed"))).toBe(DENIED);
  });
});

// ---------------------------------------------------------------------------------------------
describe("list prices: app.office_set_sku_price (owner or manager) and app.owner_set_sku_price (owner)", () => {
  it("the manager sets a price with a reason: the SKU changes, one history row and one audit row carry the manager", async () => {
    const cid = id();
    const res = (await tx([
      ["manager", `select (app.office_set_sku_price('${cid}', '${SKU2}', 55000, '[Test] new season price')).list_price_paisa;`],
      [
        "postgres",
        `select h.old_price_paisa, h.new_price_paisa, h.reason, h.via, h.changed_by, k.list_price_paisa,
                (select count(*)::int from control.audit_event e where e.table_name = 'public.sku_price_change' and e.row_id = h.id::text
                   and e.actor_id = '${fx.manager.id}') as audit_rows,
                (select e.purpose from control.audit_event e where e.table_name = 'public.sku' and e.row_id = k.id::text
                   order by e.seq desc limit 1) as sku_purpose
         from public.sku_price_change h join public.sku k on k.id = h.sku_id where h.client_id = '${cid}';`,
      ],
    ])) as Array<Record<string, unknown>>;
    expect(res).toEqual([
      {
        old_price_paisa: String(LIST2),
        new_price_paisa: "55000",
        reason: "[Test] new season price",
        via: "office_set_sku_price",
        changed_by: fx.manager.id,
        list_price_paisa: "55000",
        audit_rows: 1,
        sku_purpose: "price list: [Test] new season price",
      },
    ]);
  });

  it("a replay of the client_id is one change; the same id with other facts is refused (23505)", async () => {
    const cid = id();
    const res = await tx([
      ["owner", `select app.office_set_sku_price('${cid}', '${SKU2}', 60000, 'dummy replay');`],
      ["owner", `select app.office_set_sku_price('${cid}', '${SKU2}', 60000, 'dummy replay');`],
      ["postgres", `select count(*)::int n from public.sku_price_change where client_id = '${cid}';`],
    ]);
    expect(res).toEqual([{ n: 1 }]);
    const first = `select app.office_set_sku_price('${cid}', '${SKU2}', 60000, 'dummy replay');`;
    const others = [
      `select app.office_set_sku_price('${cid}', '${SKU2}', 61000, 'dummy replay');`,
      `select app.office_set_sku_price('${cid}', '${SKU1}', 60000, 'dummy replay');`,
      `select app.office_set_sku_price('${cid}', '${SKU2}', 60000, 'another reason');`,
    ];
    const codes = await Promise.all(others.map((other) => txCode([["owner", first], ["owner", other]])));
    expect(codes).toEqual(others.map(() => DUPLICATE));
    // Another person replaying the owner's id is not a replay.
    expect(
      await txCode([
        ["owner", `select app.office_set_sku_price('${cid}', '${SKU2}', 60000, 'dummy replay');`],
        ["manager", `select app.office_set_sku_price('${cid}', '${SKU2}', 60000, 'dummy replay');`],
      ]),
    ).toBe(DUPLICATE);
  });

  it.each([
    ["zero", 0],
    ["a negative price", -1],
    ["a price above the ceiling", CEILING + 1],
    ["no price", null],
  ])("refuses %s (22023) and changes nothing", async (_n, price) => {
    const before = [await listPrice(SKU1), await historyCount(SKU1)];
    expect(await sqlstate(MANAGER, skuPriceSql(id(), SKU1, price))).toBe(BAD_INPUT);
    expect([await listPrice(SKU1), await historyCount(SKU1)]).toEqual(before);
  });

  it("accepts the ceiling itself", async () => {
    expect(await sqlstate(MANAGER, skuPriceSql(id(), SKU1, CEILING))).toBeNull();
  });

  it("refuses a short or blank reason, an unknown SKU and a missing client_id (22023)", async () => {
    expect(await sqlstate(MANAGER, skuPriceSql(id(), SKU1, LIST, "  ab  "))).toBe(BAD_INPUT);
    expect(await sqlstate(MANAGER, skuPriceSql(id(), SKU1, LIST, "   "))).toBe(BAD_INPUT);
    expect(await sqlstate(MANAGER, skuPriceSql(id(), id(), LIST))).toBe(BAD_INPUT);
    expect(await sqlstate(MANAGER, `select app.office_set_sku_price(null, '${SKU1}', ${LIST}, 'dummy reason')`)).toBe(BAD_INPUT);
  });

  it.each(REFUSED)("%s cannot set a list price, and nothing is recorded", async (_n, who) => {
    const before = await historyCount(SKU1);
    expect(await sqlstate(who, skuPriceSql(id(), SKU1, 1))).toBe(DENIED);
    expect(await historyCount(SKU1)).toBe(before);
  });

  it("app.owner_set_sku_price stays owner only, and now writes the same history", async () => {
    expect(await sqlstate(MANAGER, `select app.owner_set_sku_price('${SKU1}', 1, 'dummy try')`)).toBe(DENIED);
    const res = await tx([
      ["owner", `select app.owner_set_sku_price('${SKU1}', 99000, 'dummy owner price');`],
      [
        "postgres",
        `select h.old_price_paisa, h.new_price_paisa, h.via, h.changed_by from public.sku_price_change h
         where h.sku_id = '${SKU1}' order by h.created_at desc, h.id limit 1;`,
      ],
    ]);
    expect(res).toEqual([{ old_price_paisa: String(LIST), new_price_paisa: "99000", via: "owner_set_sku_price", changed_by: fx.owner.id }]);
  });

  it("the setup's owner prices are in the history", async () => {
    const { rows } = await run(
      "postgres",
      "select new_price_paisa from public.sku_price_change where sku_id = $1 and via = 'owner_set_sku_price' order by created_at",
      [SKU1],
    );
    expect(rows.map((r) => Number(r.new_price_paisa))).toContain(LIST);
  });
});

// ---------------------------------------------------------------------------------------------
describe("per-salon prices (D-37): app.office_set_salon_price and app.office_salon_prices", () => {
  it("the manager sets a salon price; the sheet shows it as that salon's reference price and not another salon's", async () => {
    const res = await tx([
      ["manager", `select (app.office_set_salon_price('${id()}', '${SALON}', '${SKU1}', ${SALON_PRICE}, '[Test] loyal salon')).id;`],
      [
        "manager",
        `select a.sku_id, a.list_price_paisa, a.salon_price_paisa, a.reference_price_paisa, a.above_list, a.reason, a.set_by_name,
                b.salon_price_paisa as other_salon_price, b.reference_price_paisa as other_reference
         from app.office_salon_prices('${SALON}') a join app.office_salon_prices('${SALON2}') b using (sku_id)
         where a.sku_id = '${SKU1}';`,
      ],
    ]);
    expect(res).toEqual([
      {
        sku_id: SKU1,
        list_price_paisa: String(LIST),
        salon_price_paisa: String(SALON_PRICE),
        reference_price_paisa: String(SALON_PRICE),
        above_list: false,
        reason: "[Test] loyal salon",
        set_by_name: "[Test] Manager",
        other_salon_price: null,
        other_reference: String(LIST),
      },
    ]);
  });

  it("the latest row wins, and a null price clears it back to the list price", async () => {
    const res = await tx([
      setSalonPrice("manager", SALON, SKU1, SALON_PRICE),
      setSalonPrice("owner", SALON, SKU1, LIST - 1),
      ["manager", `select reference_price_paisa r from app.office_salon_prices('${SALON}') where sku_id = '${SKU1}';`],
    ]);
    expect(res).toEqual([{ r: String(LIST - 1) }]);
    const cleared = await tx([
      setSalonPrice("manager", SALON, SKU1, SALON_PRICE),
      setSalonPrice("manager", SALON, SKU1, null),
      ["manager", `select salon_price_paisa s, reference_price_paisa r from app.office_salon_prices('${SALON}') where sku_id = '${SKU1}';`],
    ]);
    expect(cleared).toEqual([{ s: null, r: String(LIST) }]);
  });

  it("a replay is one row; the same id with other facts is refused (23505)", async () => {
    const cid = id();
    const first = `select app.office_set_salon_price('${cid}', '${SALON}', '${SKU1}', ${SALON_PRICE}, 'dummy replay');`;
    expect(await tx([["manager", first], ["manager", first], ["postgres", `select count(*)::int n from public.salon_sku_price where client_id = '${cid}';`]])).toEqual([
      { n: 1 },
    ]);
    expect(await txCode([["manager", first], ["manager", first.replace(String(SALON_PRICE), String(SALON_PRICE - 1))]])).toBe(DUPLICATE);
    expect(await txCode([["manager", first], ["manager", first.replace(SALON, SALON2)]])).toBe(DUPLICATE);
    expect(await txCode([["manager", first], ["owner", first]])).toBe(DUPLICATE);
  });

  it("a pending or rejected salon gets no price (55000); nothing is written", async () => {
    const states = await Promise.all([PENDING, REJECTED].map((s) => sqlstate(MANAGER, salonPriceSql(id(), s, SKU1, SALON_PRICE))));
    expect(states).toEqual([WRONG_STATE, WRONG_STATE]);
    expect(await Promise.all([PENDING, REJECTED].map(salonPriceCount))).toEqual([0, 0]);
  });

  it("refuses an unknown salon or SKU (22023), an unpriced SKU (55000), a price above list or bad price (22023), a short reason (22023)", async () => {
    expect(await sqlstate(MANAGER, salonPriceSql(id(), id(), SKU1, SALON_PRICE))).toBe(BAD_INPUT);
    expect(await sqlstate(MANAGER, salonPriceSql(id(), SALON, id(), SALON_PRICE))).toBe(BAD_INPUT);
    expect(await sqlstate(MANAGER, salonPriceSql(id(), SALON, UNPRICED, SALON_PRICE))).toBe(WRONG_STATE);
    expect(await sqlstate(MANAGER, salonPriceSql(id(), SALON, SKU1, LIST + 1))).toBe(BAD_INPUT);
    expect(await sqlstate(MANAGER, salonPriceSql(id(), SALON, SKU1, 0))).toBe(BAD_INPUT);
    expect(await sqlstate(MANAGER, salonPriceSql(id(), SALON, SKU1, NEGATIVE))).toBe(BAD_INPUT);
    expect(await sqlstate(MANAGER, salonPriceSql(id(), SALON, SKU1, SALON_PRICE, "ab"))).toBe(BAD_INPUT);
    expect(await sqlstate(MANAGER, `select app.office_set_salon_price(null, '${SALON}', '${SKU1}', 1, 'dummy reason')`)).toBe(BAD_INPUT);
    expect(await sqlstate(MANAGER, "select * from app.office_salon_prices($1)", [id()])).toBe(BAD_INPUT);
  });

  it.each(REFUSED)("%s cannot set, clear or read salon prices, nor read the office catalogue", async (_n, who) => {
    const before = await salonPriceCount(SALON);
    expect(await sqlstate(who, salonPriceSql(id(), SALON, SKU1, SALON_PRICE))).toBe(DENIED);
    expect(await sqlstate(who, salonPriceSql(id(), SALON, SKU1, null))).toBe(DENIED);
    expect(await sqlstate(who, "select * from app.office_salon_prices($1)", [SALON])).toBe(DENIED);
    expect(await sqlstate(who, "select * from app.office_catalogue()")).toBe(DENIED);
    expect(await salonPriceCount(SALON)).toBe(before);
  });

  it("an unredeemed login (signed up, nothing redeemed) is refused every new function", async () => {
    const l = await newLogin();
    await inTurn(
      [
        salonPriceSql(id(), SALON, SKU1, SALON_PRICE),
        skuPriceSql(id(), SKU1, LIST),
        `select * from app.office_salon_prices('${SALON}')`,
        "select * from app.office_catalogue()",
        upsertSql(id(), "[Dummy] text"),
      ],
      (sql) => expect(asLoginRows(l, sql)).rejects.toMatchObject({ code: DENIED }),
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe("orders use the salon's price (app.build_order); the price gate is unchanged (OQ-33 default)", () => {
  it("a line with no price takes the salon price; it is below list, so the manager's order waits for a discount approval", async () => {
    const cid = id();
    const [o] = await tx([
      setSalonPrice("manager", SALON, SKU1, SALON_PRICE),
      createOrder("manager", cid, SALON, [
        { sku: SKU1, qty: QTY },
        { sku: SKU2, qty: 1 },
      ]),
      orderRead(cid),
    ]);
    expect(o).toMatchObject({
      status: "draft",
      hold_discount: "pending",
      subtotal_paisa: String(QTY * LIST + LIST2),
      discount_paisa: String(QTY * (LIST - SALON_PRICE)),
      total_paisa: String(QTY * SALON_PRICE + LIST2),
      discount_by_owner: false,
      checker: "manager",
      lines: [
        { sku: SKU1, list: LIST, unit: SALON_PRICE, total: QTY * SALON_PRICE },
        { sku: SKU2, list: LIST2, unit: LIST2, total: LIST2 },
      ],
    });
  });

  it("another salon's order is at list price, with no hold", async () => {
    const cid = id();
    const [o] = await tx([setSalonPrice("manager", SALON, SKU1, SALON_PRICE), createOrder("manager", cid, SALON2, [{ sku: SKU1, qty: 1 }]), orderRead(cid)]);
    expect(o).toMatchObject({ status: "confirmed", hold_discount: null, total_paisa: String(LIST), discount_paisa: "0" });
  });

  it("a salon price equal to list is no discount; the owner's own office order at a salon price is not held (the existing owner rule)", async () => {
    const equal = id();
    const [a] = await tx([setSalonPrice("manager", SALON, SKU1, LIST), createOrder("manager", equal, SALON, [{ sku: SKU1, qty: 1 }]), orderRead(equal)]);
    expect(a).toMatchObject({ status: "confirmed", hold_discount: null, discount_paisa: "0" });
    const byOwner = id();
    const [b] = await tx([setSalonPrice("manager", SALON, SKU1, SALON_PRICE), createOrder("owner", byOwner, SALON, [{ sku: SKU1, qty: 1 }]), orderRead(byOwner)]);
    expect(b).toMatchObject({ status: "confirmed", hold_discount: null, discount_by_owner: true, total_paisa: String(SALON_PRICE) });
  });

  it("a price typed on the line wins over the salon price, and above the list price it is refused (the cap)", async () => {
    const typed = id();
    const [o] = await tx([
      setSalonPrice("manager", SALON, SKU1, SALON_PRICE),
      createOrder("manager", typed, SALON, [{ sku: SKU1, qty: 1, price: LIST }]),
      orderRead(typed),
    ]);
    expect(o).toMatchObject({ status: "confirmed", total_paisa: String(LIST), hold_discount: null });
    expect(
      await txCode([setSalonPrice("manager", SALON, SKU1, SALON_PRICE), createOrder("manager", id(), SALON, [{ sku: SKU1, qty: 1, price: LIST + 1 }])]),
    ).toBe(BAD_INPUT);
  });

  it("a salon price left above a since-lowered list price is refused at order time, naming the SKU; nothing is written", async () => {
    const cid = id();
    const err = await txError([
      setSalonPrice("manager", SALON, SKU1, SALON_PRICE),
      ["owner", `select app.office_set_sku_price('${id()}', '${SKU1}', ${SALON_PRICE - 1}, 'dummy price cut');`],
      createOrder("manager", cid, SALON, [{ sku: SKU1, qty: 1 }]),
    ]);
    expect(err).toMatch(STALE_PRICE);
    const sheet = await tx([
      setSalonPrice("manager", SALON, SKU1, SALON_PRICE),
      ["owner", `select app.office_set_sku_price('${id()}', '${SKU1}', ${SALON_PRICE - 1}, 'dummy price cut');`],
      ["manager", `select above_list from app.office_salon_prices('${SALON}') where sku_id = '${SKU1}';`],
    ]);
    expect(sheet).toEqual([{ above_list: true }]);
    expect((await run("postgres", "select count(*)::int n from public.sales_order where client_id = $1", [cid])).rows[0].n).toBe(0);
  });

  it("the order replay is one order and its lines do not move when the salon price changes later", async () => {
    const cid = id();
    const res = await tx([
      setSalonPrice("manager", SALON, SKU1, SALON_PRICE),
      createOrder("manager", cid, SALON, [{ sku: SKU1, qty: 1 }]),
      setSalonPrice("manager", SALON, SKU1, SALON_PRICE - PRICE_STEP),
      createOrder("manager", cid, SALON, [{ sku: SKU1, qty: 1 }]),
      [
        "postgres",
        `select count(*)::int n, min(l.unit_price_paisa) u from public.sales_order o join public.sales_order_line l on l.order_id = o.id
         where o.client_id = '${cid}';`,
      ],
    ]);
    expect(res).toEqual([{ n: 1, u: String(SALON_PRICE) }]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("reads: the office catalogue; nothing from the vault, no cost or margin (doc 07, H-01, H-05)", () => {
  it("the office catalogue lists inactive products and SKUs with prices, picture and description", async () => {
    const { rows } = await run(MANAGER, "select * from app.office_catalogue() where product_id in ($1, $2) order by name", [PRODUCT, INACTIVE_PRODUCT]);
    expect(rows.map((r) => [r.product_id, r.active])).toEqual([
      [PRODUCT, true],
      [INACTIVE_PRODUCT, false],
    ]);
    const retired = rows[1].skus as Array<Record<string, unknown>>;
    expect(retired).toEqual([expect.objectContaining({ id: INACTIVE_SKU, active: false, list_price_paisa: LIST })]);
    const skus = rows[0].skus as Array<Record<string, unknown>>;
    expect(skus.map((s) => s.id).sort()).toEqual([SKU1, SKU2, UNPRICED].sort());
  });

  it("no key or column of the catalogue or the salon price sheet names a cost, supplier, margin, lot or purchase order", async () => {
    const cat = await run(MANAGER, "select * from app.office_catalogue()");
    const sheet = await run(MANAGER, "select * from app.office_salon_prices($1)", [SALON]);
    // Every key at any depth of a JSON value.
    const keysOf = (v: unknown): string[] => {
      if (Array.isArray(v)) return v.flatMap(keysOf);
      if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]);
      return [];
    };
    const keys = [...keysOf(cat.rows), ...keysOf(sheet.rows)];
    expect(keys.length).toBeGreaterThan(MIN_KEYS);
    expect(keys.filter((k) => LEAKY_KEY.test(k))).toEqual([]);
    const cols = await run(
      "postgres",
      `select table_name || '.' || column_name c from information_schema.columns where table_schema = 'public'
         and table_name in ('product', 'sku', 'sku_price_change', 'salon_sku_price')
         and column_name ~* '(cost|margin|supplier|vendor|lot|purchase)'`,
    );
    expect(cols.rows).toEqual([]);
  });

  it("no new function's source refers to the vault schemas or the vault API", async () => {
    const { rows } = await run(
      "postgres",
      `select p.proname, p.prosrc ~* '(supplier_vault|vault_api|has_vault_grant)' vault from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname in ('office_catalogue', 'office_salon_prices', 'office_set_salon_price',
         'office_set_sku_price', 'office_upsert_product', 'salon_price', 'build_order', 'may_read_product_images') order by 1`,
    );
    expect(rows).toEqual(
      ["build_order", "may_read_product_images", "office_catalogue", "office_salon_prices", "office_set_salon_price", "office_set_sku_price", "office_upsert_product", "salon_price"].map(
        (proname) => ({ proname, vault: false }),
      ),
    );
  });

  it("reps read active products with their picture and description as before, and no salon price or price history", async () => {
    const path = img(PRODUCT);
    await run(MANAGER, upsertSql(PRODUCT, "[Dummy] Rep-visible text", path), [], C);
    const { rows } = await run(REP_A, "select description, image_path from public.product where id = $1", [PRODUCT]);
    expect(rows).toEqual([{ description: "[Dummy] Rep-visible text", image_path: path }]);
    expect((await run(REP_A, "select count(*)::int n from public.product where id = $1", [INACTIVE_PRODUCT])).rows[0].n).toBe(0);
    expect((await run(REP_A, "select count(*)::int n from public.salon_sku_price")).rows[0].n).toBe(0);
    expect((await run(REP_A, "select count(*)::int n from public.sku_price_change")).rows[0].n).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe("append-only history (H-06)", () => {
  it.each(["public.sku_price_change", "public.salon_sku_price"])("%s refuses UPDATE, DELETE and TRUNCATE even for its owner", async (t) => {
    await run(OWNER, salonPriceSql(id(), SALON2, SKU2, LIST2 - 1), [], C);
    expect(await sqlstate("postgres", `update ${t} set reason = reason`)).toBe(DENIED);
    expect(await sqlstate("postgres", `delete from ${t}`)).toBe(DENIED);
    expect(await sqlstate("postgres", `truncate ${t}`)).toBe(DENIED);
  });

  it("the audit chain still verifies", async () => {
    const { rows } = await run("postgres", "select * from control.verify_audit_chain()");
    expect(rows[0]).toMatchObject({ ok: true });
  });

  it("no application role can draw on the salon_sku_price identity sequence", async () => {
    const { rows } = await run(
      "postgres",
      `select r.rolname from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role')
         and has_sequence_privilege(r.rolname, 'public.salon_sku_price_seq_seq', 'usage,select,update')`,
    );
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("pictures: who may read the product-images bucket, and the bucket where storage exists", () => {
  it("staff on an approved device and an active salon member may read; an unredeemed login, a suspended rep and a wrong device may not", async () => {
    const read = async (who: Who) => (await run(who, "select app.may_read_product_images() as ok")).rows[0].ok;
    expect(await read(REP_A)).toBe(true);
    expect(await read(MANAGER)).toBe(true);
    expect(await read(MANAGER_AAL1)).toBe(true);
    expect(await read(REP_A_WRONG_DEVICE)).toBe(false);
    expect(await read(SUSPENDED)).toBe(false);
    expect(await sqlstate("anon", "select app.may_read_product_images()")).toBe(DENIED);
    const nobody = await newLogin();
    expect((await asLoginRows(nobody, "select app.may_read_product_images() as ok"))[0].ok).toBe(false);

    const member = await newLogin();
    const inv = (
      await run(
        MANAGER,
        `select app.office_invite($1, 'salon', '[Test] Catalogue member', $2, $3, null, null, null, null) as r`,
        [id(), member.email, SALON_MEMBER],
        C,
      )
    ).rows[0].r as { token: string };
    await asLoginRows(member, `select app.redeem_invitation('${inv.token}')`, { commit: true });
    expect((await asLoginRows(member, "select app.may_read_product_images() as ok"))[0].ok).toBe(true);
    // A password session of the same member did not prove the mailbox (slice 1): no pictures.
    expect((await asLoginRows(member, "select app.may_read_product_images() as ok", { method: "password" }))[0].ok).toBe(false);
  });

  it("where storage exists: a private bucket with the image types and 5 MB, and the four office-only write policies; elsewhere none", async () => {
    const { rows } = await run<{ has: boolean }>("postgres", "select to_regclass('storage.objects') is not null as has");
    if (!rows[0].has) {
      // The embedded test database has no storage schema: the migration made nothing there.
      const { rows: s } = await run("postgres", "select count(*)::int n from pg_namespace where nspname = 'storage'");
      expect(s[0].n).toBe(0);
      return;
    }
    const bucket = (await run("postgres", "select to_jsonb(b) b from storage.buckets b where id = 'product-images'")).rows[0]?.b;
    expect(bucket).toBeTruthy();
    if ("public" in bucket) expect(bucket.public).toBe(false);
    if ("file_size_limit" in bucket) expect(Number(bucket.file_size_limit)).toBe(FIVE_MB);
    if ("allowed_mime_types" in bucket) expect([...bucket.allowed_mime_types].sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
    const { rows: pol } = await run(
      "postgres",
      `select policyname, cmd, roles::text roles, coalesce(qual, '') || ' ' || coalesce(with_check, '') body from pg_policies
       where schemaname = 'storage' and tablename = 'objects' and policyname like 'product_images_%' order by 1`,
    );
    expect(pol.map((p) => [p.policyname, p.cmd, p.roles])).toEqual([
      ["product_images_delete", "DELETE", "{authenticated}"],
      ["product_images_insert", "INSERT", "{authenticated}"],
      ["product_images_read", "SELECT", "{authenticated}"],
      ["product_images_update", "UPDATE", "{authenticated}"],
    ]);
    expect(pol.every((p) => String(p.body).includes("product-images"))).toBe(true);
    expect(pol.filter((p) => p.cmd === "SELECT").every((p) => String(p.body).includes("may_read_product_images"))).toBe(true);
    expect(pol.filter((p) => p.cmd !== "SELECT").every((p) => OFFICE_UNDER_PRODUCTS.test(String(p.body)))).toBe(true);
    // A rep writing into the bucket is refused by the policy.
    const name = img(PRODUCT);
    expect(await sqlstate(REP_A, "insert into storage.objects (bucket_id, name) values ('product-images', $1)", [name])).toBe(DENIED);
  });
});
