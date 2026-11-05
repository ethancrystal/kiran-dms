/**
 * Requests queue and salon portal (migration 20261105150000, completion slice 6, P1-23; D-34, D-41;
 * spec 2026-11-05 rulings R1, R5, R6 and sections 3, 4, 7).
 *
 * A request is an order_intake_card: a rep's card (a note and, now, optional product lines) or a
 * salon's request (lines and an optional note). Edits are new versions (order_intake_card_version and
 * order_intake_card_line, both append-only); cancel is a close row. The office converts a request with
 * app.office_create_order (one click: no lines given, the request's current lines are used; channel
 * salon_portal for a salon request) or rejects it with app.office_dismiss_card. Prices never come
 * from the submitter: a line carries a SKU and a quantity only, and the order takes the salon's own
 * price, else the list price. The salon reads only through app.salon_* functions, which resolve the
 * salon from the caller's active membership.
 *
 * Setup (territory, area, two approved salons, a [Dummy] catalogue, one salon price, two salon logins)
 * is committed with fresh ids, as the other module tests do; every case runs in one rolled-back
 * transaction, so no request, order or audit row from a case is left behind. afterAll ends rep A's
 * territory assignment and revokes the two salon accounts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorOf, fx, MANAGER, run, sqlstate } from "./helpers/db";
import { signOrderSql } from "./helpers/submit-approve";
import { type Login, type Method, newLogin, quote, tag, uuid } from "./helpers/invite";

const C = { commit: true };
const DENIED = "42501";
const BAD_INPUT = "22023";
const WRONG_STATE = "55000";
const DUPLICATE = "23505";
const CHECK_VIOLATION = "23514";
const TODAY = "(now() at time zone 'Asia/Karachi')::date";

// Hand-worked prices, in paisa (integer, H-10), and the quantities of the standard request.
const LIST_1 = 120_000; // Rs 1,200
const SALON_A_PRICE_1 = 100_000; // Rs 1,000: salon A's own price for SKU 1
const LIST_2 = 80_000; // Rs 800
const QTY_1 = 2;
const QTY_2 = 3;
const QTY_EDITED = 5;
const QTY_STALE = 4;
const QTY_OTHER = 9;
const QTY_FRACTION = 1.5;
const PAYMENT = 100_000; // Rs 1,000 paid by bank transfer
const STOCK = 50;
const CYCLE_DAYS = 30;
const NOTE = "[Test] for the bridal season";
const BODY = "[Test] two of shade 5 and three developers";
const REASON = "[Test] out of season, ask again in May";
const MAX_LINES = 50;
const MAX_QTY = 10_000;
const NOTE_MAX = 2000;
const REASON_MAX = 500;
const SECOND_VERSION = 2;
// A receipt number as public.receipt stores it: "R-27-000001" matches; "R-2027-1" does not.
// https://regex101.com/?regex=%5ER-%5Cd%7B2%7D-%5Cd%7B6%7D%24&flavor=javascript
const RECEIPT_NUMBER = /^R-\d{2}-\d{6}$/;

const T = uuid(),
  AREA = uuid(),
  SALON_A = uuid(),
  SALON_B = uuid(),
  GROUP = uuid(),
  PRODUCT = uuid(),
  SKU_1 = uuid(),
  SKU_2 = uuid(),
  SKU_OFF = uuid(),
  SKU_UNPRICED = uuid();

let loginA: Login;
let loginB: Login;
let memberA = "";
let memberB = "";

type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
type Staff = "repA" | "repB" | "repAWrongDevice" | "manager" | "managerAal1" | "owner" | "suspended";
type Actor = Staff | "postgres" | "anon" | { salon: Login; method?: Method };
type Step = [Actor, string];

const staff = (k: Staff) => {
  const of: Record<Staff, [string, string, "aal1" | "aal2"]> = {
    repA: [fx.repA.id, fx.repA.device, "aal1"],
    repB: [fx.repB.id, fx.repB.device, "aal1"],
    repAWrongDevice: [fx.repA.id, "dev-not-approved-0000", "aal1"],
    manager: [fx.manager.id, fx.manager.device, "aal2"],
    managerAal1: [fx.manager.id, fx.manager.device, "aal1"],
    owner: [fx.owner.id, fx.owner.device, "aal2"],
    suspended: [fx.suspendedRep.id, fx.suspendedRep.device, "aal1"],
  };
  return of[k];
};

const switchTo = (a: Actor) => {
  if (a === "postgres") return "reset role;";
  if (a === "anon") {
    return `reset role; select set_config('request.jwt.claims', '${JSON.stringify({ role: "anon" })}', true); set local role anon;`;
  }
  if (typeof a === "object") {
    const claims = JSON.stringify({
      sub: a.salon.id,
      role: "authenticated",
      aal: "aal1",
      session_id: a.salon.session,
      email: a.salon.email,
      amr: [{ method: a.method ?? "otp", timestamp: 1 }],
    });
    return `reset role; select set_config('request.jwt.claims', '${claims}', true), set_config('request.headers', '{}', true);
      set local role authenticated;`;
  }
  const [id, device, aal] = staff(a);
  return `reset role;
    select set_config('request.jwt.claims', '${JSON.stringify({ sub: id, role: "authenticated", aal })}', true),
           set_config('request.headers', '${JSON.stringify({ "x-kiran-device": device })}', true);
    set local role authenticated;`;
};
const OPEN_DAY = (): Step => [
  "postgres",
  `insert into public.rep_day (rep_id, day) values ('${fx.repA.id}', ${TODAY}) on conflict (rep_id, day) do nothing;`,
];
const script = (list: Step[]) => [OPEN_DAY(), ...list].map(([a, sql]) => `${switchTo(a)}\n${sql}`).join("\n");
const stx = async (list: Step[]) => ((await run("postgres", script(list))) as unknown as Multi).at(-1)?.rows ?? [];
const stxCode = (list: Step[]) => sqlstate("postgres", script(list));
const stxError = (list: Step[]) => errorOf("postgres", script(list));
/** Runs fn over items one after another (each call is its own rolled-back transaction). */
const each = <T>(items: readonly T[], fn: (x: T) => Promise<unknown>) =>
  items.reduce<Promise<void>>(async (prev, x) => {
    await prev;
    await fn(x);
  }, Promise.resolve());

const A = (): Actor => ({ salon: loginA });
const B = (): Actor => ({ salon: loginB });
const lines = (l: Array<Record<string, unknown>>) => `'${JSON.stringify(l)}'::jsonb`;
const L12 = () =>
  lines([
    { sku_id: SKU_1, qty: QTY_1 },
    { sku_id: SKU_2, qty: QTY_2 },
  ]);
const STANDARD_AT_LIST = QTY_1 * LIST_1 + QTY_2 * LIST_2; // Rs 4,800
const STANDARD_FOR_A = QTY_1 * SALON_A_PRICE_1 + QTY_2 * LIST_2; // Rs 4,400
// A salon session cannot read order_intake_card or sales_order (it reads through app.salon_* only), so
// each step that makes a request, card or order also notes its id in a transaction-local setting, and
// these read it back in any session; postgres falls back to the table.
const key = (cid: string) => cid.replaceAll("-", "");
const noteCard = (cid: string, idSql: string) => `set_config('portal.c${key(cid)}', (${idSql})::text, true)`;
const CARD = (cid: string) =>
  `coalesce(nullif(current_setting('portal.c${key(cid)}', true), '')::uuid, (select c.id from public.order_intake_card c where c.client_id = '${cid}'))`;
const ORDER = (ocid: string) =>
  `coalesce(nullif(current_setting('portal.o${key(ocid)}', true), '')::uuid, (select o.id from public.sales_order o where o.client_id = '${ocid}'))`;
const submit = (who: Actor, cid: string, l = L12(), note: string | null = NOTE): Step => [
  who,
  `select ${noteCard(cid, `app.salon_submit_request('${cid}', ${l}, ${quote(note)}) ->> 'request_id'`)} as r;`,
];
const edit = (who: Actor, vid: string, cid: string, l: string, note: string | null = NOTE): Step => [
  who,
  `select app.salon_edit_request('${vid}', ${CARD(cid)}, ${l}, ${quote(note)}) as r;`,
];
const cancel = (who: Actor, cid: string, reason: string | null = null): Step => [
  who,
  `select app.salon_cancel_request(${CARD(cid)}, ${quote(reason)}) as r;`,
];
const repCard = (who: Actor, cid: string, salon = SALON_A, l: string | null = null, body = BODY): Step => [
  who,
  `select ${noteCard(cid, `(app.rep_create_card('${cid}', '${salon}', '${body}', null, ${l ?? "null"})).id`)} as id;`,
];
const convert = (
  who: Actor,
  ocid: string,
  cid: string,
  salon = SALON_A,
  version: number | null = null,
  l: string | null = null,
): Step => [
  who,
  `select o.id, o.status::text, o.source_channel::text channel, o.subtotal_paisa, o.discount_paisa, o.total_paisa, o.rep_id,
          o.rep_day_id, o.intake_card_id = ${CARD(cid)} as from_card, o.created_by, o.hold_discount,
          set_config('portal.o${key(ocid)}', o.id::text, true) is not null as noted
   from app.office_create_order('${ocid}', '${salon}', 'CASH', ${l ?? "null"}, null, ${CARD(cid)}, ${version ?? "null"}) o;`,
];
const dismiss = (who: Actor, cid: string): Step => [who, `select (app.office_dismiss_card(${CARD(cid)}, '${REASON}')).outcome;`];

const inviteSalon = async (salon: string) => {
  const email = `salon.${tag()}@example.test`;
  const r = await run(
    MANAGER,
    "select app.office_invite($1, 'salon', '[Test] Salon contact', $2, $3) as r",
    [uuid(), email, salon],
    C,
  );
  const token = (r.rows[0].r as { token: string }).token;
  const l = await newLogin({ email });
  await run("postgres", `${switchTo({ salon: l })} select app.redeem_invitation(${quote(token)});`, [], C);
  const m = (await run("postgres", "select id from public.salon_membership where user_id = $1", [l.id])).rows[0];
  return { l, member: m.id as string };
};

beforeAll(async () => {
  await run(MANAGER, "select app.office_upsert_territory($1, $2)", [T, `[Test] Portal ${tag()}`], C);
  await run(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Portal area')", [AREA, T], C);
  await run(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T], C);
  await each(
    [
      [SALON_A, "A"],
      [SALON_B, "B"],
    ] as const,
    ([s, n]) =>
      run(
        MANAGER,
        "select app.create_salon($1, $2, 'ladies_parlor', $3, 'manual')",
        [s, `[Test] Portal salon ${n} ${tag()}`, AREA],
        C,
      ),
  );
  await run(
    MANAGER,
    "select app.office_upsert_product_group($1, $2, $3)",
    [GROUP, `[Test] Portal group ${tag()}`, CYCLE_DAYS],
    C,
  );
  await run(
    MANAGER,
    "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Portal colour', true, '[Dummy] A test shade.')",
    [PRODUCT, GROUP],
    C,
  );
  const sku = (id: string, code: string, active = true) =>
    run(
      MANAGER,
      "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100, null, null, $4)",
      [id, PRODUCT, code, active],
      C,
    );
  const offCode = `T-PRTX-${tag().toUpperCase()}`;
  await each(
    [
      [SKU_1, `T-PRT1-${tag().toUpperCase()}`],
      [SKU_2, `T-PRT2-${tag().toUpperCase()}`],
      [SKU_OFF, offCode],
      [SKU_UNPRICED, `T-PRTU-${tag().toUpperCase()}`],
    ] as const,
    ([id, code]) => sku(id, code),
  );
  await each(
    [
      [SKU_1, LIST_1],
      [SKU_2, LIST_2],
      [SKU_OFF, LIST_2],
    ] as const,
    ([id, p]) => run(MANAGER, "select app.office_set_sku_price($1, $2, $3, '[Test] portal list price')", [uuid(), id, p], C),
  );
  await sku(SKU_OFF, offCode, false);
  await run(
    MANAGER,
    "select app.office_set_salon_price($1, $2, $3, $4, '[Test] portal salon price')",
    [uuid(), SALON_A, SKU_1, SALON_A_PRICE_1],
    C,
  );
  const a = await inviteSalon(SALON_A);
  const b = await inviteSalon(SALON_B);
  loginA = a.l;
  memberA = a.member;
  loginB = b.l;
  memberB = b.member;
});

afterAll(async () => {
  await run(MANAGER, "select app.office_end_territory($1, $2, 'portal tests finished')", [fx.repA.id, T], C);
  await each([memberA, memberB].filter(Boolean), (m) =>
    run(MANAGER, "select app.office_set_member_status('salon', $1, 'revoked', 'portal tests finished')", [m], C),
  );
});

// ------------------------------------------------------------------------------------ tables ----
describe("the new tables are append-only and shaped", () => {
  it("lines and versions refuse UPDATE, DELETE and TRUNCATE, even for postgres", async () => {
    const cid = uuid();
    const base = [submit(A(), cid), edit(A(), uuid(), cid, L12())];
    const writes = [
      "update public.order_intake_card_line set qty = qty + 1",
      "delete from public.order_intake_card_line",
      "truncate public.order_intake_card_line",
      "update public.order_intake_card_version set body = 'changed'",
      "delete from public.order_intake_card_version",
      "truncate public.order_intake_card_version",
    ];
    await each(writes, async (sql) => expect(await stxError([...base, ["postgres", `${sql};`]]), sql).toContain("append-only"));
  });

  it("a request line and a version have no price column at all", async () => {
    const { rows } = await run(
      "postgres",
      `select column_name from information_schema.columns where table_schema = 'public'
         and table_name in ('order_intake_card_line', 'order_intake_card_version') and column_name like '%price%'`,
    );
    expect(rows).toEqual([]);
  });

  it("a card is a rep's (rep, day, note) or a salon's (no rep, no day, the salon login): mixed shapes fail", async () => {
    const id = uuid();
    const day = `(select d.id from public.rep_day d where d.rep_id = '${fx.repA.id}' and d.day = ${TODAY})`;
    const bad = [
      `insert into public.order_intake_card (client_id, salon_id, submitter_kind, salon_user_id, rep_id, rep_day_id, body)
       values ('${id}', '${SALON_A}', 'salon', '${loginA.id}', '${fx.repA.id}', null, null);`,
      `insert into public.order_intake_card (client_id, salon_id, submitter_kind, body) values ('${id}', '${SALON_A}', 'salon', null);`,
      `insert into public.order_intake_card (client_id, salon_id, submitter_kind, salon_user_id, rep_id, rep_day_id, body)
       values ('${id}', '${SALON_A}', 'rep', '${loginA.id}', '${fx.repA.id}', ${day}, 'x');`,
      `insert into public.order_intake_card (client_id, salon_id, submitter_kind, rep_id, rep_day_id, body)
       values ('${id}', '${SALON_A}', 'rep', '${fx.repA.id}', ${day}, null);`,
    ];
    await each(bad, async (sql) => expect(await stxCode([["postgres", sql]]), sql).toBe(CHECK_VIOLATION));
  });
});

// ------------------------------------------------------------------------------- salon reads ----
describe("salon reads resolve the salon from the membership (allow-listed fields only)", () => {
  it("salon_catalogue shows active priced SKUs with the salon's own price, else the list price", async () => {
    const q = `select sku_id, price_paisa, own_price, product_name, description from app.salon_catalogue()
               where sku_id in ('${SKU_1}', '${SKU_2}', '${SKU_OFF}', '${SKU_UNPRICED}') order by price_paisa desc;`;
    const shade = { product_name: "[Dummy] Portal colour", description: "[Dummy] A test shade." };
    expect(await stx([[A(), q]])).toEqual([
      { sku_id: SKU_1, price_paisa: String(SALON_A_PRICE_1), own_price: true, ...shade },
      { sku_id: SKU_2, price_paisa: String(LIST_2), own_price: false, ...shade },
    ]);
    // Salon B sees the list price for SKU 1: A's own price never reaches B.
    expect(await stx([[B(), `select price_paisa, own_price from app.salon_catalogue() where sku_id = '${SKU_1}';`]])).toEqual([
      { price_paisa: String(LIST_1), own_price: false },
    ]);
  });

  it("no salon read names a cost, margin, supplier, stock location, rep, GPS or hold field", async () => {
    const { rows } = await run(
      "postgres",
      `select a.n from pg_proc p join pg_namespace n on n.oid = p.pronamespace, unnest(coalesce(p.proargnames, '{}')) a(n)
       where n.nspname = 'app' and p.proname in ('salon_catalogue', 'salon_my_requests', 'salon_my_orders', 'salon_my_account')`,
    );
    const names = rows.map((r) => String(r.n)).join(" ");
    expect(names.length).toBeGreaterThan(0);
    ["cost", "margin", "supplier", "location", "rep_", "lat", "lng", "hold"].map((bad) => expect(names).not.toContain(bad));
    const out = await stx([
      submit(A(), uuid()),
      [
        A(),
        `select app.salon_my_account()::text a, (select json_agg(r)::text from app.salon_my_orders() r) o,
                (select json_agg(r)::text from app.salon_my_requests() r) q;`,
      ],
    ]);
    const text = JSON.stringify(out);
    ["cost", "margin", "supplier", "rep_id", "hold_", "recorded_by", "bank_reference", fx.repA.id].map((bad) =>
      expect(text).not.toContain(bad),
    );
  });

  it("every salon function refuses anon, staff, a password session, an unredeemed login, and a suspended or revoked account", async () => {
    const calls = [
      "select * from app.salon_catalogue()",
      "select * from app.salon_my_requests()",
      "select * from app.salon_my_orders()",
      "select app.salon_my_account()",
      `select app.salon_submit_request(gen_random_uuid(), ${L12()})`,
      `select app.salon_edit_request(gen_random_uuid(), gen_random_uuid(), ${L12()})`,
      "select app.salon_cancel_request(gen_random_uuid())",
    ];
    // A login with nothing redeemed, written inside each rolled-back transaction (nothing committed).
    const outsider: Login = { id: uuid(), email: `outsider.${tag()}@example.test`, session: uuid() };
    const outsiderRow: Step = [
      "postgres",
      `insert into auth.users (id, email, email_confirmed_at) values ('${outsider.id}', '${outsider.email}', now());`,
    ];
    const actors: Array<[string, Actor]> = [
      ["anon", "anon"],
      ["rep A", "repA"],
      ["manager", "manager"],
      ["owner", "owner"],
      ["a password session of salon A", { salon: loginA, method: "password" }],
      ["a login with nothing redeemed", { salon: outsider }],
    ];
    const off = (status: string): Step => [
      "manager",
      `select app.office_set_member_status('salon', '${memberA}', '${status}', '[Test] stop');`,
    ];
    await each(calls, async (sql) => {
      await each(actors, async ([n, who]) => expect(await stxCode([outsiderRow, [who, `${sql};`]]), `${n}: ${sql}`).toBe(DENIED));
      await each(["suspended", "revoked"], async (status) =>
        expect(await stxCode([off(status), [A(), `${sql};`]]), `${status}: ${sql}`).toBe(DENIED),
      );
    });
  });
});

// ------------------------------------------------------------------------------ salon writes ----
describe("a salon sends, edits and cancels its own request (ORD-11, B-40 d)", () => {
  it("submit: a request with lines and a note, waiting; a replay returns it; other facts on the key are 23505", async () => {
    const cid = uuid();
    const [r] = await stx([
      submit(A(), cid),
      submit(A(), cid),
      [
        "postgres",
        `select c.submitter_kind, c.salon_id, c.salon_user_id, c.rep_id, c.rep_day_id, c.body,
                (select count(*)::int from public.order_intake_card x where x.client_id = '${cid}') n,
                (select json_agg(json_build_object('sku', l.sku_id, 'qty', l.qty) order by l.line_no)
                   from public.order_intake_card_line l where l.card_id = c.id and l.version = 1) lines
         from public.order_intake_card c where c.client_id = '${cid}';`,
      ],
    ]);
    expect(r).toEqual({
      submitter_kind: "salon",
      salon_id: SALON_A,
      salon_user_id: loginA.id,
      rep_id: null,
      rep_day_id: null,
      body: NOTE,
      n: 1,
      lines: [
        { sku: SKU_1, qty: QTY_1 },
        { sku: SKU_2, qty: QTY_2 },
      ],
    });
    expect(await stxCode([submit(A(), cid), submit(A(), cid, lines([{ sku_id: SKU_1, qty: QTY_OTHER }]))])).toBe(DUPLICATE);
    expect(await stxCode([submit(A(), cid), submit(A(), cid, L12(), "another note")])).toBe(DUPLICATE);
    // Salon B reusing salon A's key gets nothing of A's.
    expect(await stxCode([submit(A(), cid), submit(B(), cid)])).toBe(DUPLICATE);
  });

  it("a price in a request line is refused (prices come from the office), and so is any other key", async () => {
    const priced = [
      [{ sku_id: SKU_1, qty: 1, unit_price_paisa: 1 }],
      [{ sku_id: SKU_1, qty: 1, price: 1 }],
      [{ sku_id: SKU_1, qty: 1, list_price_paisa: 1 }],
      [{ sku_id: SKU_1, qty: 1, note: "cheap please" }],
    ];
    await each(priced, async (l) => expect(await stxCode([submit(A(), uuid(), lines(l))]), JSON.stringify(l)).toBe(BAD_INPUT));
    expect(await stxError([submit(A(), uuid(), lines([{ sku_id: SKU_1, qty: 1, unit_price_paisa: 1 }]))])).toContain("price");
  });

  it("bad lines and notes are refused 22023", async () => {
    const many = Array.from({ length: MAX_LINES + 1 }, () => ({ sku_id: SKU_1, qty: 1 }));
    const bad = [
      "null",
      "'[]'::jsonb",
      "'{}'::jsonb",
      "'[1]'::jsonb",
      lines(many),
      lines([{ sku_id: SKU_1 }]),
      lines([{ sku_id: SKU_1, qty: 0 }]),
      lines([{ sku_id: SKU_1, qty: MAX_QTY + 1 }]),
      lines([{ sku_id: SKU_1, qty: QTY_FRACTION }]),
      lines([{ sku_id: SKU_1, qty: "2" }]),
      lines([{ sku_id: "not-a-uuid", qty: 1 }]),
      lines([{ sku_id: uuid(), qty: 1 }]),
      lines([{ sku_id: SKU_OFF, qty: 1 }]),
      lines([{ sku_id: SKU_UNPRICED, qty: 1 }]),
      lines([
        { sku_id: SKU_1, qty: 1 },
        { sku_id: SKU_1, qty: QTY_1 },
      ]),
    ];
    await each(bad, async (l) => expect(await stxCode([submit(A(), uuid(), l)]), l).toBe(BAD_INPUT));
    expect(await stxCode([submit(A(), uuid(), L12(), "x".repeat(NOTE_MAX + 1))])).toBe(BAD_INPUT);
    expect(await stxCode([[A(), `select app.salon_submit_request(null, ${L12()});`]])).toBe(BAD_INPUT);
    // A blank note is no note.
    const cid = uuid();
    expect(
      await stx([
        submit(A(), cid, L12(), "   "),
        ["postgres", `select body from public.order_intake_card where client_id = '${cid}';`],
      ]),
    ).toEqual([{ body: null }]);
  });

  it("a salon that is not approved cannot send a request (D-35), 55000", async () => {
    const rejectA = `insert into public.salon_approval_decision (client_id, salon_id, decision, reason, decided_by)
                     values (gen_random_uuid(), '${SALON_A}', 'rejected', '[Test] closed down', '${fx.manager.id}');
                     update public.salon set approval_status = 'rejected' where id = '${SALON_A}';`;
    expect(await stxCode([["postgres", rejectA], submit(A(), uuid())])).toBe(WRONG_STATE);
  });

  it("edit: a new version with new lines; the first version stays; a replay returns it; other facts are 23505", async () => {
    const [cid, vid] = [uuid(), uuid()];
    const l2 = lines([{ sku_id: SKU_2, qty: QTY_EDITED }]);
    const rows = await stx([
      submit(A(), cid),
      edit(A(), vid, cid, l2, null),
      edit(A(), vid, cid, l2, null),
      [A(), `select version, note, status, lines from app.salon_my_requests() where request_id = ${CARD(cid)};`],
    ]);
    expect(rows).toEqual([
      {
        version: SECOND_VERSION,
        note: null,
        status: "open",
        lines: [
          {
            line_no: 1,
            sku_id: SKU_2,
            code: expect.any(String),
            product_name: "[Dummy] Portal colour",
            variant: "[Dummy] shade",
            qty: QTY_EDITED,
            price_paisa: LIST_2,
          },
        ],
      },
    ]);
    const [kept] = await stx([
      submit(A(), cid),
      edit(A(), vid, cid, l2, null),
      [
        "postgres",
        `select (select count(*)::int from public.order_intake_card_line where card_id = ${CARD(cid)} and version = 1) v1,
                (select count(*)::int from public.order_intake_card_line where card_id = ${CARD(cid)} and version = 2) v2,
                (select count(*)::int from public.order_intake_card_version where card_id = ${CARD(cid)}) versions,
                (select edited_by_salon_user from public.order_intake_card_version where client_id = '${vid}') editor;`,
      ],
    ]);
    expect(kept).toEqual({ v1: QTY_1, v2: 1, versions: 1, editor: loginA.id });
    expect(await stxCode([submit(A(), cid), edit(A(), vid, cid, l2, null), edit(A(), vid, cid, L12(), null)])).toBe(DUPLICATE);
    expect(await stxCode([submit(A(), cid), edit(A(), vid, cid, lines([{ sku_id: SKU_1, qty: 1, unit_price_paisa: 1 }]))])).toBe(
      BAD_INPUT,
    );
  });

  it("cancel: the request closes as cancelled; a replay returns it; it cannot then be edited, converted or rejected", async () => {
    const cid = uuid();
    const rows = await stx([
      submit(A(), cid),
      cancel(A(), cid, "[Test] ordered elsewhere"),
      cancel(A(), cid),
      [A(), `select status, reason from app.salon_my_requests() where request_id = ${CARD(cid)};`],
    ]);
    expect(rows).toEqual([{ status: "cancelled", reason: "[Test] ordered elsewhere" }]);
    const closed = [submit(A(), cid), cancel(A(), cid)];
    expect(await stxCode([...closed, edit(A(), uuid(), cid, L12())])).toBe(WRONG_STATE);
    expect(await stxCode([...closed, convert("manager", uuid(), cid)])).toBe(WRONG_STATE);
    expect(await stxCode([...closed, dismiss("manager", cid)])).toBe(WRONG_STATE);
    expect(await stxCode([...closed, ["owner", `select app.salon_cancel_request(${CARD(cid)});`]])).toBe(DENIED);
    expect(await stxCode([submit(A(), cid), cancel(A(), cid, "x".repeat(REASON_MAX + 1))])).toBe(BAD_INPUT);
  });

  it("after the office reviews it (converted or rejected), the salon can neither edit nor cancel it", async () => {
    const reviews = [(cid: string) => convert("manager", uuid(), cid), (cid: string) => dismiss("manager", cid)];
    await each(reviews, async (review) => {
      const cid = uuid();
      expect(await stxCode([submit(A(), cid), review(cid), edit(A(), uuid(), cid, L12())])).toBe(WRONG_STATE);
      expect(await stxCode([submit(A(), cid), review(cid), cancel(A(), cid)])).toBe(WRONG_STATE);
    });
  });

  it("salon B can neither see, edit nor cancel salon A's request; an unknown id gets the same refusal", async () => {
    const cid = uuid();
    const made = submit(A(), cid);
    expect(
      await stx([made, [B(), `select count(*)::int n from app.salon_my_requests() where request_id = ${CARD(cid)};`]]),
    ).toEqual([{ n: 0 }]);
    expect(await stxCode([made, edit(B(), uuid(), cid, L12())])).toBe(DENIED);
    expect(await stxCode([made, cancel(B(), cid)])).toBe(DENIED);
    const cancelB = await stxError([made, cancel(B(), cid)]);
    const editB = await stxError([made, edit(B(), uuid(), cid, L12())]);
    expect(cancelB).toBe(await stxError([[B(), `select app.salon_cancel_request('${uuid()}');`]]));
    expect(editB).toBe(await stxError([[B(), `select app.salon_edit_request(gen_random_uuid(), '${uuid()}', ${L12()});`]]));
  });

  it("a refused call that would commit writes nothing (no partial writes)", async () => {
    const cid = uuid();
    // A good first line and a priced second line, sent as a committing call: refused, so nothing stays.
    const bad = lines([
      { sku_id: SKU_2, qty: 1 },
      { sku_id: SKU_1, qty: 1, unit_price_paisa: 1 },
    ]);
    const before = (await run("postgres", "select count(*)::int n from control.audit_event")).rows[0].n as number;
    await expect(run("postgres", script([submit(A(), cid, bad)]), [], C)).rejects.toMatchObject({ code: BAD_INPUT });
    const { rows } = await run(
      "postgres",
      `select (select count(*)::int from public.order_intake_card where client_id = '${cid}') cards,
              (select count(*)::int from control.audit_event) audit`,
    );
    expect(rows[0]).toEqual({ cards: 0, audit: before });
  });

  it("a salon cannot act on a rep's card for its own salon, nor read it", async () => {
    const cid = uuid();
    const made = repCard("repA", cid);
    expect(await stxCode([made, cancel(A(), cid)])).toBe(DENIED);
    expect(await stxCode([made, edit(A(), uuid(), cid, L12())])).toBe(DENIED);
    expect(
      await stx([made, [A(), `select count(*)::int n from app.salon_my_requests() where request_id = ${CARD(cid)};`]]),
    ).toEqual([{ n: 0 }]);
  });

  it("the audit rows carry the salon login as actor, and the chain verifies", async () => {
    const [cid, vid] = [uuid(), uuid()];
    const [r] = await stx([
      submit(A(), cid),
      edit(A(), vid, cid, L12()),
      cancel(A(), cid),
      [
        "postgres",
        `select (select array_agg(distinct actor_id::text) from control.audit_event
                  where table_name in ('public.order_intake_card', 'public.order_intake_card_line', 'public.order_intake_card_version',
                                       'public.order_intake_card_close')
                    and (row_id = ${CARD(cid)}::text or after ->> 'card_id' = ${CARD(cid)}::text)) actors,
                (select count(*)::int from control.audit_event
                  where table_name in ('public.order_intake_card_line', 'public.order_intake_card_version', 'public.order_intake_card_close')
                    and after ->> 'card_id' = ${CARD(cid)}::text) n,
                (select ok from control.verify_audit_chain()) chain;`,
      ],
    ]);
    // 2 lines at version 1, the version row, 2 lines at version 2, the close row.
    expect(r).toEqual({ actors: [loginA.id], n: QTY_1 + 1 + QTY_1 + 1, chain: true });
  });
});

// ------------------------------------------------------------------------------- office side ----
describe("the office queue and one-click convert (ORD-12, ORD-13, R1, R5, R6)", () => {
  it("office_open_cards lists a salon request with its lines and the database's prices, beside a rep card", async () => {
    const [s, r] = [uuid(), uuid()];
    const rows = await stx([
      submit(A(), s),
      repCard("repA", r, SALON_A, lines([{ sku_id: SKU_2, qty: 1 }])),
      [
        "manager",
        `select submitter_kind, rep_id, body, version, lines, estimate_paisa from app.office_open_cards()
         where card_id in (${CARD(s)}, ${CARD(r)}) order by submitter_kind;`,
      ],
    ]);
    expect(rows).toEqual([
      {
        submitter_kind: "rep",
        rep_id: fx.repA.id,
        body: BODY,
        version: 1,
        lines: [expect.objectContaining({ sku_id: SKU_2, qty: 1, price_paisa: LIST_2 })],
        estimate_paisa: String(LIST_2),
      },
      {
        submitter_kind: "salon",
        rep_id: null,
        body: NOTE,
        version: 1,
        lines: [
          expect.objectContaining({ sku_id: SKU_1, qty: QTY_1, price_paisa: SALON_A_PRICE_1 }),
          expect.objectContaining({ sku_id: SKU_2, qty: QTY_2, price_paisa: LIST_2 }),
        ],
        estimate_paisa: String(STANDARD_FOR_A),
      },
    ]);
  });

  it("one click converts salon A's request at the database's prices (hand-worked: Rs 4,400, held for the discount)", async () => {
    const [cid, oid] = [uuid(), uuid()];
    const [o] = await stx([submit(A(), cid), convert("manager", oid, cid)]);
    // 2 x Rs 1,000 (A's own price) + 3 x Rs 800 (list) = Rs 4,400; at list it is 2 x Rs 1,200 + 3 x Rs 800 =
    // Rs 4,800, so Rs 400 is a discount, held for approval as the price gate is written (OQ-33 default).
    expect(o).toMatchObject({
      status: "draft",
      channel: "salon_portal",
      subtotal_paisa: String(STANDARD_AT_LIST),
      discount_paisa: String(STANDARD_AT_LIST - STANDARD_FOR_A),
      total_paisa: String(STANDARD_FOR_A),
      rep_id: null,
      rep_day_id: null,
      from_card: true,
      created_by: fx.manager.id,
      hold_discount: "pending",
    });
    const sold = await stx([
      submit(A(), cid),
      convert("manager", oid, cid),
      [
        "postgres",
        `select l.sku_id, l.qty, l.unit_price_paisa, l.line_total_paisa from public.sales_order_line l
         where l.order_id = ${ORDER(oid)} order by l.line_no;`,
      ],
    ]);
    expect(sold).toEqual([
      { sku_id: SKU_1, qty: QTY_1, unit_price_paisa: String(SALON_A_PRICE_1), line_total_paisa: String(QTY_1 * SALON_A_PRICE_1) },
      { sku_id: SKU_2, qty: QTY_2, unit_price_paisa: String(LIST_2), line_total_paisa: String(QTY_2 * LIST_2) },
    ]);
  });

  it("salon B, with no salon price, converts at list: Rs 4,800, confirmed (CASH)", async () => {
    const [cid, oid] = [uuid(), uuid()];
    const [o] = await stx([submit(B(), cid), convert("manager", oid, cid, SALON_B)]);
    expect(o).toMatchObject({
      status: "confirmed",
      channel: "salon_portal",
      subtotal_paisa: String(STANDARD_AT_LIST),
      discount_paisa: "0",
      total_paisa: String(STANDARD_AT_LIST),
    });
  });

  it("the owner converting a salon request priced below list is held too (the owner's no-approval rule is for office orders)", async () => {
    const [cid, oid] = [uuid(), uuid()];
    const [o] = await stx([submit(A(), cid), convert("owner", oid, cid)]);
    expect(o).toMatchObject({ status: "draft", channel: "salon_portal", hold_discount: "pending" });
  });

  it("convert uses the current version; an expected version that is stale is refused 55000", async () => {
    const [cid, oid] = [uuid(), uuid()];
    const l2 = lines([{ sku_id: SKU_2, qty: QTY_STALE }]);
    const [o] = await stx([submit(A(), cid), edit(A(), uuid(), cid, l2), convert("manager", oid, cid, SALON_A, SECOND_VERSION)]);
    expect(o).toMatchObject({ total_paisa: String(QTY_STALE * LIST_2), discount_paisa: "0" });
    expect(await stxCode([submit(A(), cid), edit(A(), uuid(), cid, l2), convert("manager", oid, cid, SALON_A, 1)])).toBe(
      WRONG_STATE,
    );
    // A replay of the conversion returns the same order.
    const [x, y] = await stx([
      submit(A(), cid),
      convert("manager", oid, cid),
      [
        "manager",
        `select (app.office_create_order('${oid}', '${SALON_A}', 'CASH', null, null, ${CARD(cid)})).id union all select ${ORDER(oid)};`,
      ],
    ]);
    expect(x.id).toBe(y.id);
  });

  it("a converted request reads converted with its order for the salon, and the order is in the salon's orders only", async () => {
    const [cid, oid] = [uuid(), uuid()];
    const made = [submit(B(), cid), convert("manager", oid, cid, SALON_B)];
    const rows = await stx([
      ...made,
      [
        B(),
        `select q.status, q.order_id = o.order_id as same, o.status as order_status, o.total_paisa, o.from_request,
                jsonb_array_length(o.lines) n
         from app.salon_my_requests() q join app.salon_my_orders() o on o.order_id = q.order_id
         where q.request_id = ${CARD(cid)};`,
      ],
    ]);
    expect(rows).toEqual([
      {
        status: "converted",
        same: true,
        order_status: "confirmed",
        total_paisa: String(STANDARD_AT_LIST),
        from_request: true,
        n: QTY_1,
      },
    ]);
    expect(
      await stx([...made, [A(), `select count(*)::int n from app.salon_my_orders() where order_id = ${ORDER(oid)};`]]),
    ).toEqual([{ n: 0 }]);
  });

  it("a rejected request reads rejected with the office's reason", async () => {
    const cid = uuid();
    expect(
      await stx([
        submit(A(), cid),
        dismiss("manager", cid),
        [A(), `select status, reason from app.salon_my_requests() where request_id = ${CARD(cid)};`],
      ]),
    ).toEqual([{ status: "dismissed", reason: REASON }]);
  });

  it("a rep's card with lines converts on channel office with one click", async () => {
    const [cid, oid] = [uuid(), uuid()];
    const [o] = await stx([repCard("repA", cid, SALON_A, lines([{ sku_id: SKU_2, qty: QTY_1 }])), convert("manager", oid, cid)]);
    expect(o).toMatchObject({ channel: "office", total_paisa: String(QTY_1 * LIST_2), from_card: true });
    // A note with no lines still needs the office to choose the lines.
    const note = uuid();
    expect(await stxCode([repCard("repA", note), convert("manager", uuid(), note)])).toBe(BAD_INPUT);
  });

  it("the channel shape: a salon_portal order has no rep, no rep day, no visit, and a request", async () => {
    const oid = uuid();
    const sql = `insert into public.sales_order (id, client_id, salon_id, source_channel, created_by, plan, delivery_mode, subtotal_paisa, total_paisa)
                 values ('${oid}', '${oid}', '${SALON_A}', 'salon_portal', '${fx.manager.id}', 'CASH', 'warehouse', 1, 1);`;
    expect(await stxCode([["postgres", sql]])).toBe(CHECK_VIOLATION);
    expect(await stxError([["postgres", sql]])).toContain("sales_order_salon_portal_shape");
  });

  it("nobody but the office converts, rejects or lists: reps, salons, AAL1 office and anon are refused 42501", async () => {
    const cid = uuid();
    const who: Actor[] = ["repA", "repB", "managerAal1", "suspended", "anon", A(), B()];
    await each(who, async (w) => {
      expect(await stxCode([submit(A(), cid), convert(w, uuid(), cid)]), JSON.stringify(w)).toBe(DENIED);
      expect(await stxCode([submit(A(), cid), dismiss(w, cid)]), JSON.stringify(w)).toBe(DENIED);
      expect(await stxCode([[w, "select * from app.office_open_cards();"]]), JSON.stringify(w)).toBe(DENIED);
    });
  });

  it("a rep cannot create an official order by any path (R1)", async () => {
    expect(
      await stxCode([["repA", `select app.create_order(gen_random_uuid(), '${SALON_A}', 'CASH', 'bag_now', ${L12()});`]]),
    ).toBe(DENIED);
    expect(await stxCode([["repA", `select app.office_create_order(gen_random_uuid(), '${SALON_A}', 'CASH', ${L12()});`]])).toBe(
      DENIED,
    );
    expect(await stxCode([[A(), `select app.office_create_order(gen_random_uuid(), '${SALON_A}', 'CASH', ${L12()});`]])).toBe(
      DENIED,
    );
  });
});

// ---------------------------------------------------------------------------------- rep side ----
describe("a rep's card with lines, its edits and cancel (ORD-14)", () => {
  it("a rep saves a card with lines; the replay compares the lines too; a price is refused", async () => {
    const cid = uuid();
    const l = lines([{ sku_id: SKU_1, qty: QTY_1 }]);
    const rows = await stx([
      repCard("repA", cid, SALON_A, l),
      repCard("repA", cid, SALON_A, l),
      ["repA", `select status, version, lines from app.my_cards() where card_id = ${CARD(cid)};`],
    ]);
    expect(rows).toEqual([
      {
        status: "open",
        version: 1,
        lines: [
          {
            line_no: 1,
            sku_id: SKU_1,
            code: expect.any(String),
            product_name: "[Dummy] Portal colour",
            variant: "[Dummy] shade",
            qty: QTY_1,
          },
        ],
      },
    ]);
    expect(
      await stxCode([repCard("repA", cid, SALON_A, l), repCard("repA", cid, SALON_A, lines([{ sku_id: SKU_1, qty: QTY_2 }]))]),
    ).toBe(DUPLICATE);
    expect(await stxCode([repCard("repA", uuid(), SALON_A, lines([{ sku_id: SKU_1, qty: 1, unit_price_paisa: 1 }]))])).toBe(
      BAD_INPUT,
    );
  });

  it("a rep without reach cannot request for a salon (rep B covers no portal salon)", async () => {
    expect(
      await stxCode([
        [
          "postgres",
          `insert into public.rep_day (rep_id, day) values ('${fx.repB.id}', ${TODAY}) on conflict (rep_id, day) do nothing;`,
        ],
        repCard("repB", uuid(), SALON_A, L12()),
      ]),
    ).toBe(DENIED);
  });

  it("the rep edits its open card (new version) and cancels it; rep B cannot; after review both are refused", async () => {
    const [cid, vid] = [uuid(), uuid()];
    const made = repCard("repA", cid);
    const editSql = (who: Actor, v: string): Step => [
      who,
      `select app.rep_edit_card('${v}', ${CARD(cid)}, '[Test] three of shade 5', ${lines([{ sku_id: SKU_1, qty: QTY_2 }])}) as r;`,
    ];
    const rows = await stx([
      made,
      editSql("repA", vid),
      editSql("repA", vid),
      ["repA", `select version, body, lines from app.my_cards() where card_id = ${CARD(cid)};`],
    ]);
    expect(rows).toEqual([
      {
        version: SECOND_VERSION,
        body: "[Test] three of shade 5",
        lines: [expect.objectContaining({ sku_id: SKU_1, qty: QTY_2 })],
      },
    ]);
    expect(await stxCode([made, editSql("repB", vid)])).toBe(DENIED);
    expect(await stxCode([made, ["repB", `select app.rep_cancel_card(${CARD(cid)});`]])).toBe(DENIED);
    expect(await stxCode([made, editSql("repAWrongDevice", vid)])).toBe(DENIED);
    expect(await stxCode([made, editSql("manager", vid)])).toBe(DENIED);
    expect(
      await stx([
        made,
        ["repA", `select app.rep_cancel_card(${CARD(cid)}, '[Test] salon changed its mind') as r;`],
        ["repA", `select app.rep_cancel_card(${CARD(cid)}) as r;`],
        ["repA", `select status, reason from app.my_cards() where card_id = ${CARD(cid)};`],
      ]),
    ).toEqual([{ status: "cancelled", reason: "[Test] salon changed its mind" }]);
    expect(await stxCode([made, dismiss("manager", cid), editSql("repA", uuid())])).toBe(WRONG_STATE);
    expect(await stxCode([made, dismiss("manager", cid), ["repA", `select app.rep_cancel_card(${CARD(cid)});`]])).toBe(
      WRONG_STATE,
    );
    // A salon's request is not a rep's card.
    const s = uuid();
    expect(await stxCode([submit(A(), s), ["repA", `select app.rep_cancel_card(${CARD(s)});`]])).toBe(DENIED);
    expect(await stxCode([submit(A(), s), ["repA", `select app.rep_edit_card(gen_random_uuid(), ${CARD(s)}, 'x');`]])).toBe(
      DENIED,
    );
  });

  it("an edit after the rep lost the salon is refused 42501", async () => {
    const cid = uuid();
    expect(
      await stxCode([
        repCard("repA", cid),
        ["manager", `select app.office_end_territory('${fx.repA.id}', '${T}', '[Test] moved');`],
        ["repA", `select app.rep_edit_card(gen_random_uuid(), ${CARD(cid)}, 'x');`],
      ]),
    ).toBe(DENIED);
  });
});

// ---------------------------------------------------------------------------------- account ----
describe("the salon's account and payments", () => {
  it("salon_my_account: a salon with nothing invoiced reads zeros and no payments", async () => {
    const [r] = await stx([[B(), "select app.salon_my_account() as a;"]]);
    expect(r.a).toMatchObject({
      balance: { invoiced_paisa: 0, paid_paisa: 0, balance_paisa: 0, overdue_paisa: 0, next_due_on: null },
      installments: [],
      payments: [],
    });
  });

  it("after the office delivers and a bank payment is recorded, the salon reads its balance and receipt; salon A reads none of it", async () => {
    const [cid, oid, wh, pay] = [uuid(), uuid(), uuid(), uuid()];
    const delivered: Step[] = [
      submit(B(), cid),
      convert("manager", oid, cid, SALON_B),
      [
        "postgres",
        `insert into public.stock_location (id, kind, name, created_by) values ('${wh}', 'warehouse', '[Test] Portal warehouse', '${fx.manager.id}');
         insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
         values (gen_random_uuid(), '${SKU_1}', ${STOCK}, '${wh}', 'receipt', '${fx.manager.id}'),
                (gen_random_uuid(), '${SKU_2}', ${STOCK}, '${wh}', 'receipt', '${fx.manager.id}');`,
      ],
      ["manager", `${signOrderSql(oid, ORDER(oid))} select (app.office_deliver(gen_random_uuid(), ${ORDER(oid)}, '${wh}', '[Test] Receiver')).number;`],
      [
        "manager",
        `select (app.office_record_payment('${pay}', '${SALON_B}', ${PAYMENT}, '[Test] Bank', 'REF-${tag()}')).number;`,
      ],
    ];
    const [r] = await stx([...delivered, [B(), "select app.salon_my_account() as a;"]]);
    expect(r.a).toMatchObject({
      balance: { invoiced_paisa: STANDARD_AT_LIST, paid_paisa: PAYMENT, balance_paisa: STANDARD_AT_LIST - PAYMENT },
      payments: [{ method: "bank_transfer", amount_paisa: PAYMENT, receipt_number: expect.stringMatching(RECEIPT_NUMBER) }],
    });
    const payment = (r.a as { payments: Array<Record<string, unknown>> }).payments[0];
    expect(Object.keys(payment).sort()).toEqual(["amount_paisa", "method", "paid_at", "receipt_number"]);
    const [x] = await stx([...delivered, [A(), "select app.salon_my_account() as a;"]]);
    expect(x.a).toMatchObject({ payments: [] });
    const [o] = await stx([...delivered, [B(), `select status from app.salon_my_orders() where order_id = ${ORDER(oid)};`]]);
    expect(o).toEqual({ status: "delivered" });
  });
});
