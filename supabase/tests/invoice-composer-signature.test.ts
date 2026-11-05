/**
 * Invoice composer and customer acknowledgement (migration 20261105220000, completion slice P1-31; D-49).
 *
 * The invoice is still issued only by the approval transaction (app.office_approve_delivery -> app.finalise_delivery).
 * This file proves what was added around it: a draft that is clearly a draft and never changes the transaction,
 * display text the office can prepare, a snapshot that makes an issued invoice immutable, and the salon's
 * acknowledgement of receipt bound to the exact lines handed over.
 *
 * Catalogue, territories, salons, a warehouse and its stock, and two salon logins are committed with fresh ids;
 * everything else runs in one rolled-back transaction per test. The snapshot trigger fires with the invoice insert
 * (after the installments trigger), so a rolled-back transaction still sees the snapshot.
 * Hand-worked figures (paisa): SKU 1 lists at 120,000 and SKU 2 at 50,000, so 3 x SKU 1 + 2 x SKU 2 = 460,000.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveSalon, fx, MANAGER, OWNER, REP_A, run } from "./helpers/db";
import { type Login, newLogin, quote } from "./helpers/invite";

const C = { commit: true };
const DENIED = "42501";
const BAD_INPUT = "22023";
const WRONG_STATE = "55000";
const DUPLICATE = "23505";
const BAG_LIMIT_PAISA = 50_000_000;
const BAG_LOAD = 20;
const OPENING_STOCK = 100;
const SKU1_PAISA = 120_000;
const SKU2_PAISA = 50_000;
const QTY_1 = 3;
const QTY_2 = 2;
const ORDER_TOTAL = QTY_1 * SKU1_PAISA + QTY_2 * SKU2_PAISA; // 460,000
const PNG_BYTES = 400;
const PIN_LAT = 24.9;
const PIN_LNG = 67.1;

const id = () => randomUUID();
const TAG_LENGTH = 8;
const tag = () => randomUUID().slice(0, TAG_LENGTH);
const inSeries = <T, R>(items: readonly T[], f: (t: T) => Promise<R>) =>
  items.reduce<Promise<R[]>>(async (acc, t) => [...(await acc), await f(t)], Promise.resolve([]));
const one = async (who: Parameters<typeof run>[0], sql: string, params: unknown[] = []) =>
  (await run(who, sql, params, C)).rows[0];
const TODAY = "(now() at time zone 'Asia/Karachi')::date";

/** A PNG-looking picture: the 8-byte PNG signature and random bytes. The database checks signature and size. */
const png = () => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), randomBytes(PNG_BYTES)]).toString("base64");

const T_A = id(),
  AREA_A = id(),
  T_B = id(),
  AREA_B = id();
const SALON = id(),
  SALON_B = id();
const GROUP = id(),
  PRODUCT = id(),
  SKU1 = id(),
  SKU2 = id();
const WH = id();
let salonLogin: Login;
let otherSalonLogin: Login;
let memberA = "";
let memberB = "";

const bagA = `(select l.id from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}')`;

type Persona = "repA" | "repB" | "manager" | "owner" | "managerAal1" | "salonA" | "salonB" | "anon";
const PERSONA: Record<string, { key: keyof typeof fx; aal: string }> = {
  repA: { key: "repA", aal: "aal1" },
  repB: { key: "repB", aal: "aal1" },
  manager: { key: "manager", aal: "aal2" },
  owner: { key: "owner", aal: "aal2" },
  managerAal1: { key: "manager", aal: "aal1" },
};
const asUser = (k: Persona) => {
  if (k === "anon") {
    return `reset role; select set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;`;
  }
  if (k === "salonA" || k === "salonB") {
    const l = k === "salonA" ? salonLogin : otherSalonLogin;
    const claims = JSON.stringify({
      sub: l.id,
      role: "authenticated",
      aal: "aal1",
      session_id: l.session,
      email: l.email,
      amr: [{ method: "otp", timestamp: 1 }],
    });
    return `reset role; select set_config('request.jwt.claims', '${claims}', true), set_config('request.headers', '{}', true); set local role authenticated;`;
  }
  const p = PERSONA[k];
  const persona = fx[p.key];
  return `reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: persona.id, role: "authenticated", aal: p.aal })}', true),
         set_config('request.headers', '${JSON.stringify({ "x-kiran-device": persona.device })}', true);
  set local role authenticated;`;
};

const prelude = `
  insert into public.rep_day (rep_id, day) values ('${fx.repA.id}', ${TODAY}), ('${fx.repB.id}', ${TODAY}) on conflict (rep_id, day) do nothing;
  ${asUser("owner")}
  select app.office_create_location('${id()}', 'rep_bag', '[Test] Invoice bag A', '${fx.repA.id}', ${BAG_LIMIT_PAISA})
   where not exists (select 1 from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}');
  reset role;
  insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
  values (gen_random_uuid(), '${SKU1}', ${BAG_LOAD}, '${WH}', ${bagA}, 'issue_to_rep', '${fx.manager.id}'),
         (gen_random_uuid(), '${SKU2}', ${BAG_LOAD}, '${WH}', ${bagA}, 'issue_to_rep', '${fx.manager.id}');`;
type Step = [Persona | "postgres", string];
const script = (steps: Step[]) =>
  `${prelude}\n${steps.map(([k, sql]) => `${k === "postgres" ? "reset role;" : asUser(k)}\n${sql}`).join("\n")}`;
type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
const tx = async (steps: Step[]) => ((await run("postgres", script(steps))) as unknown as Multi).at(-1)?.rows ?? [];
const txCode = async (steps: Step[]) => {
  try {
    await run("postgres", script(steps));
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "unknown";
  }
};
const txMessage = async (steps: Step[]) => {
  try {
    await run("postgres", script(steps));
    return null;
  } catch (e) {
    return (e as { message: string }).message;
  }
};

const lines = (l: Array<[string, number]>) => `'${JSON.stringify(l.map(([sku_id, qty]) => ({ sku_id, qty })))}'::jsonb`;
const oid = (cid: string) => `(select id from public.sales_order where client_id = '${cid}')`;
const sid = (cid: string) => `(select id from public.delivery_submission where client_id = '${cid}')`;
const both: Array<[string, number]> = [
  [SKU1, QTY_1],
  [SKU2, QTY_2],
];
const order = (cid: string, l: Array<[string, number]> = both, salon = SALON): Step => [
  "manager",
  `select app.office_create_order('${cid}', '${salon}', 'CASH', ${lines(l)}, '${fx.repA.id}');`,
];
const submit = (scid: string, ocid: string, l: Array<[string, number]> | null = null, who: Persona = "repA"): Step => [
  who,
  `select (app.rep_submit_delivery('${scid}', ${oid(ocid)}, 'Ayesha at the counter', ${PIN_LAT}, ${PIN_LNG}, ${l ? lines(l) : "null"})).*;`,
];
const sign = (acid: string, scid: string, who: Persona = "repA", name = "Ayesha Khan", role = "Owner", img = png()): Step => [
  who,
  `select app.rep_attach_signature('${acid}', ${sid(scid)}, 'signed', '${name}', '${role}', '${img}', null) as r;`,
];
const approve = (scid: string, dcid: string, who: Persona = "manager"): Step => [
  who,
  `select (app.office_approve_delivery(${sid(scid)}, '${dcid}')).*;`,
];
const fire: Step = ["postgres", "set constraints all immediate;"];
/** Notes an id (read as postgres) in a transaction-local setting, so a later step under any role can use it. */
const note = (name: string, idSql: string): Step => ["postgres", `select set_config('t.${name}', (${idSql})::text, true);`];
const noted = (name: string) => `current_setting('t.${name}')::uuid`;
const invoiceOf = (ocid: string) => `(select id from public.invoice where order_id = ${oid(ocid)} order by issued_at desc limit 1)`;

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_A, `[Test] Invoice A ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_B, `[Test] Invoice B ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Invoice area A')", [AREA_A, T_A]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Invoice area B')", [AREA_B, T_B]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repB.id, T_B]);
  await one(REP_A, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, $4, $5)", [
    SALON,
    `[Test] Invoice salon ${tag()}`,
    AREA_A,
    PIN_LAT,
    PIN_LNG,
  ]);
  await one({ as: "repB" }, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, $4, $5)", [
    SALON_B,
    `[Test] Invoice salon B ${tag()}`,
    AREA_B,
    PIN_LAT,
    PIN_LNG,
  ]);
  await approveSalon(SALON);
  await approveSalon(SALON_B);
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, 21)", [GROUP, `[Test] Invoice colour ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Invoice colour')", [PRODUCT, GROUP]);
  await inSeries([SKU1, SKU2], (s) =>
    one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100)", [
      s,
      PRODUCT,
      `T-INV-${tag().toUpperCase()}`,
    ]),
  );
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU1, SKU1_PAISA]);
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU2, SKU2_PAISA]);
  await one(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Invoice store')", [WH]);
  await one(
    "postgres",
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, $4, $3, 'receipt', $5), (gen_random_uuid(), $2, $4, $3, 'receipt', $5)`,
    [SKU1, SKU2, WH, OPENING_STOCK, fx.manager.id],
  );
  const invite = async (salon: string) => {
    const email = `invoice.salon.${tag()}@example.test`;
    const r = await run(MANAGER, "select app.office_invite($1, 'salon', '[Test] Salon contact', $2, $3) as r", [id(), email, salon], C);
    const token = (r.rows[0].r as { token: string }).token;
    const l = await newLogin({ email });
    const claims = JSON.stringify({
      sub: l.id,
      role: "authenticated",
      aal: "aal1",
      session_id: l.session,
      email: l.email,
      amr: [{ method: "otp", timestamp: 1 }],
    });
    await run(
      "postgres",
      `reset role; select set_config('request.jwt.claims', '${claims}', true), set_config('request.headers', '{}', true);
       set local role authenticated; select app.redeem_invitation(${quote(token)});`,
      [],
      C,
    );
    const m = (await run("postgres", "select id from public.salon_membership where user_id = $1", [l.id])).rows[0];
    return { l, member: m.id as string };
  };
  const a = await invite(SALON);
  const b = await invite(SALON_B);
  salonLogin = a.l;
  memberA = a.member;
  otherSalonLogin = b.l;
  memberB = b.member;
});

afterAll(async () => {
  await one(MANAGER, "select app.office_end_territory($1, $2, 'invoice composer tests finished')", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_end_territory($1, $2, 'invoice composer tests finished')", [fx.repB.id, T_B]);
  for (const m of [memberA, memberB].filter(Boolean)) {
    await run(MANAGER, "select app.office_set_member_status('salon', $1, 'revoked', 'invoice composer tests finished')", [m], C);
  }
});

type Doc = Record<string, any>;
const docOf = async (steps: Step[]) => (await tx(steps))[0]?.d as Doc;

// ------------------------------------------------------------------------ the draft ----
describe("the draft is clearly a draft and changes nothing real", () => {
  it("the preview is marked, has no number, and its figures are the order's own in integer paisa", async () => {
    const o = id();
    const d = await docOf([
      order(o),
      ["manager", `select app.office_invoice_preview(${oid(o)}) as d;`],
    ]);
    expect(d.status).toBe("draft");
    expect(d.banner).toBe("DRAFT — NOT AN OFFICIAL INVOICE");
    expect(d.number).toBeUndefined();
    expect(d.totals.subtotal_paisa).toBe(ORDER_TOTAL);
    expect(d.totals.total_paisa).toBe(ORDER_TOTAL);
    expect(d.totals.discount_paisa).toBe(0);
    expect(d.total_qty).toBe(QTY_1 + QTY_2);
    expect(d.lines).toHaveLength(2);
    expect(d.customer.reference).toMatch(/^[0-9A-F]{8}$/);
    expect(d.lines[0].expiry).toBeNull();
    expect(Number.isInteger(d.lines[0].unit_price_paisa)).toBe(true);
  });

  it("the preview of a submission shows the quantities the rep submitted, not the whole order", async () => {
    const o = id(), s = id();
    const d = await docOf([
      order(o),
      submit(s, o, [[SKU1, 1]]),
      ["manager", `select app.office_invoice_preview(${oid(o)}, ${sid(s)}) as d;`],
    ]);
    expect(d.totals.total_paisa).toBe(SKU1_PAISA);
    expect(d.total_qty).toBe(1);
    expect(d.lines).toHaveLength(1);
    expect(d.delivery_person).toBeTruthy();
  });

  it("preparing text never changes the order, the SKU or the money, and creates no invoice or stock movement", async () => {
    const o = id(), dc = id();
    const rows = await tx([
      order(o),
      ["postgres", `create temp table before as select (select count(*) from public.invoice) inv, (select count(*) from public.stock_movement) mv,
                    (select sum(unit_price_paisa * qty) from public.sales_order_line where order_id = ${oid(o)}) tot,
                    (select string_agg(sku_id::text, ',' order by sku_id) from public.sales_order_line where order_id = ${oid(o)}) skus;`],
      ["manager", `select app.office_save_invoice_draft('${dc}', ${oid(o)}, 'Thank you', 'Pay within 7 days', jsonb_build_object('${SKU1}', 'Rose shade, 100 ml')) as r;`],
      ["postgres", `select (select count(*) from public.invoice) = b.inv as no_invoice, (select count(*) from public.stock_movement) = b.mv as no_move,
                           (select sum(unit_price_paisa * qty) from public.sales_order_line where order_id = ${oid(o)}) = b.tot as same_money,
                           (select string_agg(sku_id::text, ',' order by sku_id) from public.sales_order_line where order_id = ${oid(o)}) = b.skus as same_skus
                    from before b;`],
    ]);
    expect(rows[0]).toMatchObject({ no_invoice: true, no_move: true, same_money: true, same_skus: true });
  });

  it("saved text shows in the preview; versions count up; the same client_id replays; another order with it is refused", async () => {
    const o = id(), o2 = id(), dc = id();
    const d = await docOf([
      order(o),
      ["manager", `select app.office_save_invoice_draft('${dc}', ${oid(o)}, 'n1', 'p1', jsonb_build_object('${SKU1}', 'Rose shade')) as r;`],
      ["manager", `select app.office_save_invoice_draft('${dc}', ${oid(o)}, 'n1', 'p1', jsonb_build_object('${SKU1}', 'Rose shade')) as r;`],
      ["manager", `select app.office_save_invoice_draft('${id()}', ${oid(o)}, 'n2', 'p2', jsonb_build_object('${SKU1}', 'Rose shade deluxe')) as r;`],
      ["manager", `select app.office_invoice_preview(${oid(o)}) as d;`],
    ]);
    expect(d.draft_version).toBe(2);
    expect(d.notes).toBe("n2");
    expect(d.payment_instructions).toBe("p2");
    expect(d.lines.find((l: Doc) => l.sku_code.startsWith("T-INV"))?.description).toBeTruthy();
    expect(d.lines.some((l: Doc) => l.description === "Rose shade deluxe")).toBe(true);
    expect(
      await txCode([
        order(o),
        order(o2),
        ["manager", `select app.office_save_invoice_draft('${dc}', ${oid(o)}, 'a', 'b', '{}'::jsonb);`],
        ["manager", `select app.office_save_invoice_draft('${dc}', ${oid(o2)}, 'a', 'b', '{}'::jsonb);`],
      ]),
    ).toBe(DUPLICATE);
  });

  it("refuses a description for a product not on the order, a long text, and a draft for a finished order", async () => {
    const o = id();
    const other = id();
    expect(
      await txCode([order(o), ["manager", `select app.office_save_invoice_draft('${id()}', ${oid(o)}, null, null, jsonb_build_object('${other}', 'x'));`]]),
    ).toBe(BAD_INPUT);
    expect(
      await txCode([order(o), ["manager", `select app.office_save_invoice_draft('${id()}', ${oid(o)}, '${"x".repeat(501)}', null, '{}'::jsonb);`]]),
    ).toBe(BAD_INPUT);
    expect(
      await txCode([order(o), ["manager", `select app.office_save_invoice_draft('${id()}', ${oid(o)}, null, null, jsonb_build_object('${SKU1}', '${"y".repeat(121)}'));`]]),
    ).toBe(BAD_INPUT);
    expect(
      await txCode([
        order(o),
        ["manager", `select app.cancel_order(${oid(o)}, 'cancelled for the draft test');`],
        ["manager", `select app.office_save_invoice_draft('${id()}', ${oid(o)}, null, null, '{}'::jsonb);`],
      ]),
    ).toBe(WRONG_STATE);
  });

  it("only the office prepares or previews: not a rep, a salon, an AAL1 office session or anonymous", async () => {
    const o = id();
    for (const who of ["repA", "salonA", "managerAal1", "anon"] as const) {
      expect(await txCode([order(o), [who, `select app.office_invoice_preview(${oid(o)});`]]), who).toBe(DENIED);
      expect(await txCode([order(o), [who, `select app.office_save_invoice_draft('${id()}', ${oid(o)}, null, null, '{}'::jsonb);`]]), who).toBe(DENIED);
    }
  });

  it("drafts are append-only, even for postgres", async () => {
    const o = id();
    for (const stmt of ["update public.invoice_draft_version set notes = 'x'", "delete from public.invoice_draft_version", "truncate public.invoice_draft_version"]) {
      expect(
        await txMessage([order(o), ["manager", `select app.office_save_invoice_draft('${id()}', ${oid(o)}, 'a', null, '{}'::jsonb);`], ["postgres", stmt]]),
        stmt,
      ).toMatch(/append-only/);
    }
  });
});

// ----------------------------------------------------------------- the acknowledgement ----
describe("the customer's acknowledgement is bound to the exact lines and kept private", () => {
  it("a rep attaches a signed acknowledgement to its own submission; the office sees who signed, not the picture", async () => {
    const o = id(), s = id(), a = id();
    const r = await tx([
      order(o),
      submit(s, o),
      sign(a, s),
      ["manager", `select app.office_delivery_signature(${sid(s)}) as d;`],
    ]);
    const d = r[0].d as Doc;
    expect(d).toMatchObject({ outcome: "signed", signatory_name: "Ayesha Khan", signatory_designation: "Owner", valid: true, has_picture: true, statement_version: 1 });
    expect(d.exception).toBeNull();
    expect(JSON.stringify(d)).not.toMatch(/iVBOR|89504e47/i);
  });

  it("a replay returns the same acknowledgement; the same client_id with other content is refused", async () => {
    const o = id(), s = id(), a = id();
    const rows = await tx([
      order(o),
      submit(s, o),
      sign(a, s),
      sign(a, s),
      ["postgres", `select count(*)::int n from public.delivery_signature where client_id = '${a}';`],
    ]);
    expect(rows[0].n).toBe(1);
    expect(
      await txCode([
        order(o),
        submit(s, o),
        sign(a, s),
        ["repA", `select app.rep_attach_signature('${a}', ${sid(s)}, 'refused', null, null, null, 'customer would not sign');`],
      ]),
    ).toBe(DUPLICATE);
  });

  it("refuses a missing name or role, a picture that is not a PNG, a tiny picture and bad base64", async () => {
    const o = id(), s = id();
    const bad = async (name: string, role: string, img: string) =>
      txCode([order(o), submit(s, o), ["repA", `select app.rep_attach_signature('${id()}', ${sid(s)}, 'signed', '${name}', '${role}', '${img}', null);`]]);
    expect(await bad("A", "Owner", png())).toBe(BAD_INPUT);
    expect(await bad("Ayesha Khan", "", png())).toBe(BAD_INPUT);
    expect(await bad("Ayesha Khan", "Owner", Buffer.from("not a picture at all".repeat(30)).toString("base64"))).toBe(BAD_INPUT);
    expect(await bad("Ayesha Khan", "Owner", Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("x")]).toString("base64"))).toBe(BAD_INPUT);
    expect(await bad("Ayesha Khan", "Owner", "!!!notbase64!!!")).toBe(BAD_INPUT);
  });

  it("a refusal or an inability is recorded honestly, with a reason, and has no picture", async () => {
    const o = id(), s = id();
    const rows = await tx([
      order(o),
      submit(s, o),
      ["repA", `select app.rep_attach_signature('${id()}', ${sid(s)}, 'refused', null, null, null, 'the owner was away and the cashier would not sign');`],
      ["manager", `select app.office_delivery_signature(${sid(s)}) as d;`],
    ]);
    expect(rows[0].d).toMatchObject({ outcome: "refused", valid: true, has_picture: false });
    expect(
      await txCode([order(o), submit(s, o), ["repA", `select app.rep_attach_signature('${id()}', ${sid(s)}, 'refused', null, null, null, 'no');`]]),
    ).toBe(BAD_INPUT);
  });

  it("only the submitting rep: not another rep, not the office, not a salon, not anonymous", async () => {
    const o = id(), s = id();
    const call = (who: Persona) =>
      [who, `select app.rep_attach_signature('${id()}', ${sid(s)}, 'signed', 'Ayesha Khan', 'Owner', '${png()}', null);`] as Step;
    for (const who of ["repB", "manager", "owner", "salonA", "anon"] as const) {
      expect(await txCode([order(o), submit(s, o), call(who)]), who).toBe(DENIED);
    }
  });

  it("cannot be added once the delivery is decided", async () => {
    const o = id(), s = id(), d = id();
    expect(await txCode([order(o), submit(s, o), approve(s, d), sign(id(), s)])).toBe(WRONG_STATE);
  });

  it("the picture reaches only the office, through a function that records every opening", async () => {
    const o = id(), s = id(), a = id();
    const img = png();
    const base: Step[] = [
      order(o),
      submit(s, o),
      sign(a, s, "repA", "Ayesha Khan", "Owner", img),
      note("sig", `select id from public.delivery_signature where client_id = '${a}'`),
    ];
    const opened = await tx([...base, ["manager", `select app.office_signature_image(${noted("sig")}, 'checking the delivery') as b64;`]]);
    expect(opened[0].b64).toBe(img);
    const log = await tx([
      ...base,
      ["manager", `select app.office_signature_image(${noted("sig")}, 'first look');`],
      ["owner", `select app.office_signature_image(${noted("sig")}, 'second look');`],
      ["postgres", `select count(*)::int n, count(distinct accessed_by)::int who from public.delivery_signature_access;`],
    ]);
    expect(log[0]).toMatchObject({ n: 2, who: 2 });
    const refused = await Promise.all(
      (["repA", "repB", "salonA", "managerAal1", "anon"] as const).map((who) =>
        txCode([...base, [who, `select app.office_signature_image(${noted("sig")}, 'looking');`]]),
      ),
    );
    expect(refused).toEqual(Array(refused.length).fill(DENIED));
    expect(await txCode([...base, ["manager", `select app.office_signature_image(${noted("sig")}, 'x');`]])).toBe(BAD_INPUT);
  });

  it("no API role reads the acknowledgement tables or the picture directly", async () => {
    const o = id(), s = id(), a = id();
    for (const who of ["repA", "manager", "owner", "salonA"] as const) {
      for (const t of ["delivery_signature", "delivery_signature_image"]) {
        expect(await txCode([order(o), submit(s, o), sign(a, s), [who, `select * from public.${t};`]]), `${who} ${t}`).toBe(DENIED);
      }
    }
  });

  it("a rep sees the status of its own acknowledgement, never another rep's, and no picture", async () => {
    const o = id(), s = id(), a = id();
    const mine = await tx([order(o), submit(s, o), sign(a, s), ["repA", `select app.my_signature_status(${sid(s)}) as d;`]]);
    expect(mine[0].d).toMatchObject({ outcome: "signed", valid: true });
    expect(JSON.stringify(mine[0].d)).not.toMatch(/png|iVBOR/i);
    const other = await tx([order(o), submit(s, o), sign(a, s), ["repB", `select app.my_signature_status(${sid(s)}) as d;`]]);
    expect(other[0].d).toBeNull();
  });

  it("an acknowledgement for different lines does not match the submission, so it cannot pass for it", async () => {
    const o = id(), s = id();
    const rows = await tx([
      order(o),
      submit(s, o),
      [
        "postgres",
        `insert into public.delivery_signature (client_id, submission_id, order_id, salon_id, rep_id, device_fingerprint, outcome,
            signatory_name, signatory_designation, statement_version, statement_text, lines_hash, signature_size, signature_hash, evidence_hash)
         select '${id()}', ${sid(s)}, order_id, salon_id, rep_id, 'dev', 'signed', 'Ayesha Khan', 'Owner', 1, 'old', repeat('0', 64), 300, repeat('1', 64), repeat('2', 64)
         from public.delivery_submission where id = ${sid(s)};`,
      ],
      ["manager", `select app.office_delivery_signature(${sid(s)}) as d;`],
    ]);
    expect((rows[0].d as Doc).valid).toBe(false);
  });

  it("the office can accept a delivery without a valid acknowledgement only with a reason, once, and not after the decision", async () => {
    const o = id(), s = id(), d = id();
    const e = id();
    const rows = await tx([
      order(o),
      submit(s, o),
      ["manager", `select (app.office_accept_unsigned('${e}', ${sid(s)}, 'the customer left before signing')).reason;`],
      ["manager", `select (app.office_accept_unsigned('${e}', ${sid(s)}, 'the customer left before signing')).reason;`],
      ["manager", `select app.office_delivery_signature(${sid(s)}) as d;`],
    ]);
    expect((rows[0].d as Doc).exception.reason).toBe("the customer left before signing");
    expect(await txCode([order(o), submit(s, o), ["manager", `select app.office_accept_unsigned('${e}', ${sid(s)}, 'no');`]])).toBe(BAD_INPUT);
    expect(await txCode([order(o), submit(s, o), approve(s, d), ["manager", `select app.office_accept_unsigned('${e}', ${sid(s)}, 'too late to matter');`]])).toBe(WRONG_STATE);
    for (const who of ["repA", "salonA", "managerAal1", "anon"] as const) {
      expect(await txCode([order(o), submit(s, o), [who, `select app.office_accept_unsigned('${id()}', ${sid(s)}, 'trying it out');`]]), who).toBe(DENIED);
    }
  });

  it("acknowledgement rows, pictures, openings and exceptions are append-only, even for postgres", async () => {
    const o = id(), s = id(), a = id(), s2 = id(), o2 = id();
    const base: Step[] = [
      order(o),
      submit(s, o),
      sign(a, s),
      note("sig", `select id from public.delivery_signature where client_id = '${a}'`),
      ["manager", `select app.office_signature_image(${noted("sig")}, 'checking the delivery');`],
      order(o2),
      submit(s2, o2),
      ["manager", `select (app.office_accept_unsigned('${id()}', ${sid(s2)}, 'the customer left before signing')).id;`],
    ];
    const statements = [
      "update public.delivery_signature set note = 'x'",
      "delete from public.delivery_signature",
      "update public.delivery_signature_image set png = png",
      "delete from public.delivery_signature_image",
      "update public.delivery_signature_access set purpose = 'edited purpose'",
      "delete from public.delivery_signature_access",
      "update public.delivery_signature_exception set reason = 'edited reason'",
      "delete from public.delivery_signature_exception",
      "truncate public.delivery_signature_exception",
    ];
    const messages = await Promise.all(statements.map((stmt) => txMessage([...base, ["postgres", stmt]])));
    messages.forEach((m, i) => expect(m, statements[i]).toMatch(/append-only/));
  });
});

// ------------------------------------------------------------------ the issued invoice ----
describe("the issued invoice is a snapshot: complete, immutable and reprinted unchanged", () => {
  it("approval issues one invoice; its snapshot carries the customer, people, lines, totals and acknowledgement", async () => {
    const o = id(), s = id(), a = id(), d = id(), dc = id();
    const doc = await docOf([
      order(o),
      ["manager", `select app.office_save_invoice_draft('${dc}', ${oid(o)}, 'Thank you for your business', 'Pay into the company account only', jsonb_build_object('${SKU1}', 'Rose shade, 100 ml')) as r;`],
      submit(s, o),
      sign(a, s),
      approve(s, d),
      fire,
      ["manager", `select app.invoice_document(${invoiceOf(o)}) as d;`],
    ]);
    expect(doc.version).toBe(2);
    expect(doc.status).toBe("issued");
    expect(doc.number).toMatch(/^INV-[0-9]{2}-[0-9]{6}$/);
    expect(doc.totals).toMatchObject({ subtotal_paisa: ORDER_TOTAL, discount_paisa: 0, total_paisa: ORDER_TOTAL });
    expect(doc.total_qty).toBe(QTY_1 + QTY_2);
    expect(doc.lines).toHaveLength(2);
    const l1 = doc.lines.find((l: Doc) => l.description === "Rose shade, 100 ml");
    expect(l1).toBeTruthy();
    expect(l1).toMatchObject({ qty: QTY_1, unit_price_paisa: SKU1_PAISA, gross_paisa: QTY_1 * SKU1_PAISA, discount_paisa: 0, line_total_paisa: QTY_1 * SKU1_PAISA, uom: "100 ml", expiry: null });
    expect(doc.customer.reference).toMatch(/^[0-9A-F]{8}$/);
    expect(doc.sales_officer).toBeTruthy();
    expect(doc.delivery_person).toBeTruthy();
    expect(doc.notes).toBe("Thank you for your business");
    expect(doc.payment_instructions).toBe("Pay into the company account only");
    expect(doc.acknowledgement).toMatchObject({ outcome: "signed", signatory_name: "Ayesha Khan", signatory_designation: "Owner", matches_delivery: true });
    expect(doc.paid_paisa).toBe(0);
    expect(doc.outstanding_paisa).toBe(ORDER_TOTAL);
    expect(JSON.stringify(doc)).not.toMatch(/supplier|cost_paisa|margin|signature_png|iVBOR/i);
  });

  it("the snapshot hash matches its document, and a reprint reads the same document", async () => {
    const o = id(), s = id(), d = id();
    const rows = await tx([
      order(o),
      submit(s, o),
      approve(s, d),
      fire,
      ["postgres", `select z.doc_hash = encode(sha256(convert_to(z.document::text, 'utf8')), 'hex') as hash_ok,
                           app.invoice_document_live(${invoiceOf(o)}) is not null as live_ok, z.document ->> 'number' as num
                    from public.invoice_snapshot z where z.invoice_id = ${invoiceOf(o)};`],
    ]);
    expect(rows[0]).toMatchObject({ hash_ok: true, live_ok: true });
    const twice = await tx([
      order(o),
      submit(s, o),
      approve(s, d),
      fire,
      ["manager", `select (app.invoice_document(${invoiceOf(o)}) - 'receipts' - 'paid_paisa' - 'outstanding_paisa') = (app.invoice_document(${invoiceOf(o)}) - 'receipts' - 'paid_paisa' - 'outstanding_paisa') as same,
                          (select count(*) from public.invoice where order_id = ${oid(o)})::int n;`],
    ]);
    expect(twice[0]).toMatchObject({ same: true, n: 1 });
  });

  it("later changes to the salon or the company profile do not alter an issued invoice", async () => {
    const o = id(), s = id(), d = id();
    const rows = await tx([
      order(o),
      submit(s, o),
      approve(s, d),
      fire,
      ["postgres", `update public.salon set name = 'Renamed After Issue', address = 'A new address' where id = '${SALON}';
                    update public.app_config set value = jsonb_set(value, '{name_en}', '"Renamed Company"') where key = 'company.profile';`],
      ["manager", `select app.invoice_document(${invoiceOf(o)}) as d;`],
    ]);
    const doc = rows[0].d as Doc;
    expect(doc.customer.name).not.toBe("Renamed After Issue");
    expect(doc.customer.billing_address).not.toBe("A new address");
    expect(doc.company.name_en).not.toBe("Renamed Company");
  });

  it("snapshots are append-only, even for postgres", async () => {
    const o = id(), s = id(), d = id();
    for (const stmt of ["update public.invoice_snapshot set doc_hash = 'x'", "delete from public.invoice_snapshot", "truncate public.invoice_snapshot"]) {
      expect(await txMessage([order(o), submit(s, o), approve(s, d), fire, ["postgres", stmt]]), stmt).toMatch(/append-only/);
    }
  });

  it("a part delivery invoices only the quantities delivered, in integer paisa, and numbers do not skip", async () => {
    const o = id(), s1 = id(), s2 = id(), d1 = id(), d2 = id();
    const rows = await tx([
      order(o),
      submit(s1, o, [[SKU1, 1]]),
      approve(s1, d1),
      submit(s2, o, [[SKU1, 2], [SKU2, QTY_2]]),
      approve(s2, d2),
      fire,
      ["postgres", `select i.number, i.total_paisa, z.document ->> 'total_qty' qty
                    from public.invoice i join public.invoice_snapshot z on z.invoice_id = i.id
                    where i.order_id = ${oid(o)} order by i.issued_at, i.number;`],
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].total_paisa).toBe(String(SKU1_PAISA));
    expect(rows[0].qty).toBe("1");
    expect(rows[1].total_paisa).toBe(String(2 * SKU1_PAISA + QTY_2 * SKU2_PAISA));
    const n = (x: unknown) => Number((x as string).slice(-6));
    expect(n(rows[1].number)).toBe(n(rows[0].number) + 1);
  });

  it("a rep's submission and acknowledgement issue no invoice and move no sale; only the office's approval does", async () => {
    const o = id(), s = id(), a = id(), d = id();
    const rows = await tx([
      order(o),
      submit(s, o),
      sign(a, s),
      ["postgres", `select (select count(*) from public.invoice where order_id = ${oid(o)})::int inv,
                           (select count(*) from public.stock_movement where kind = 'sale' and source_id in (select id from public.delivery where order_id = ${oid(o)}))::int sales,
                           (select status::text from public.sales_order where id = ${oid(o)}) st;`],
    ]);
    expect(rows[0]).toMatchObject({ inv: 0, sales: 0, st: "confirmed" });
    for (const who of ["repA", "repB", "salonA", "managerAal1", "anon"] as const) {
      expect(await txCode([order(o), submit(s, o), approve(s, d, who)]), who).toBe(DENIED);
    }
    const after = await tx([order(o), submit(s, o), sign(a, s), approve(s, d), fire, ["postgres", `select count(*)::int n from public.invoice where order_id = ${oid(o)};`]]);
    expect(after[0].n).toBe(1);
  });

  it("a rejected delivery keeps its submission, its acknowledgement and its decision", async () => {
    const o = id(), s = id(), a = id();
    const rows = await tx([
      order(o),
      submit(s, o),
      sign(a, s),
      ["manager", `select (app.office_reject_delivery(${sid(s)}, '${id()}', 'wrong shade delivered')).outcome;`],
      ["postgres", `select (select count(*) from public.delivery_submission where id = ${sid(s)})::int subs,
                           (select count(*) from public.delivery_signature where submission_id = ${sid(s)})::int sigs,
                           (select count(*) from public.delivery_submission_decision where submission_id = ${sid(s)} and outcome = 'rejected')::int dec,
                           (select count(*) from public.invoice where order_id = ${oid(o)})::int inv;`],
    ]);
    expect(rows[0]).toMatchObject({ subs: 1, sigs: 1, dec: 1, inv: 0 });
  });
});

// ------------------------------------------------------------------------ the salon ----
describe("a salon reads its own invoices only", () => {
  const issued = (o: string, s: string, d: string, salon = SALON): Step[] => [
    order(o, both, salon),
    submit(s, o, null, salon === SALON ? "repA" : "repB"),
    approve(s, d),
    fire,
    note("inv", invoiceOf(o)),
  ];

  it("salon A lists and opens its invoice; salon B sees none of it", async () => {
    const o = id(), s = id(), d = id();
    const mine = await tx([
      ...issued(o, s, d),
      ["salonA", `select count(*)::int n, max(total_paisa) total from app.salon_my_invoices();`],
    ]);
    expect(mine[0].n).toBeGreaterThanOrEqual(1);
    const open = await tx([...issued(o, s, d), ["salonA", `select app.salon_invoice_document(${noted("inv")}) as d;`]]);
    const doc = open[0].d as Doc;
    expect(doc.number).toMatch(/^INV-/);
    expect(doc.totals.total_paisa).toBe(ORDER_TOTAL);
    expect(JSON.stringify(doc)).not.toMatch(/supplier|cost_paisa|margin|signature_png|iVBOR/i);
    const theirs = await tx([...issued(o, s, d), ["salonB", `select app.salon_invoice_document(${noted("inv")}) as d;`]]);
    expect(theirs[0].d).toBeNull();
    const list = await tx([
      ...issued(o, s, d),
      ["salonB", `select count(*)::int n from app.salon_my_invoices() where invoice_id = ${noted("inv")};`],
    ]);
    expect(list[0].n).toBe(0);
  });

  it("a rep, the office and anonymous have no salon view; the old document function still serves the office", async () => {
    const o = id(), s = id(), d = id();
    for (const who of ["repA", "manager", "anon"] as const) {
      expect(await txCode([...issued(o, s, d), [who, `select app.salon_my_invoices();`]]), who).toBe(DENIED);
      expect(await txCode([...issued(o, s, d), [who, `select app.salon_invoice_document(${noted("inv")});`]]), who).toBe(DENIED);
    }
    const office = await tx([...issued(o, s, d), ["manager", `select app.invoice_document(${noted("inv")}) ->> 'number' as n;`]]);
    expect(office[0].n).toMatch(/^INV-/);
    const salonAsOffice = await tx([...issued(o, s, d), ["salonA", `select app.invoice_document(${noted("inv")}) as d;`]]);
    expect(salonAsOffice[0].d).toBeNull();
  });
});
