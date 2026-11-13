/**
 * Order steps and approval reminders (migration 20261111020000, P1-38; D-59, D-60, MSG-03, ORD-04).
 *
 * Steps are projected from the records that already exist. Closed stays upcoming (B-45).
 * Reminders are prepared for the service role and recorded; no mail is sent (B-61).
 * The pending salon is created inside the test transaction. The territory and catalogue are committed
 * and the territory assignment is ended afterwards.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fx, MANAGER, OWNER, run } from "./helpers/db";
import { asLogin, type Login, newLogin, quote } from "./helpers/invite";
import { signOrderSql } from "./helpers/submit-approve";

const C = { commit: true };
const DENIED = "42501";
const BAD_INPUT = "22023";
const OPENING_STOCK = 20;
const SKU_PAISA = 12_345;
const PIN_LAT = 24.9;
const PIN_LNG = 67.1;
const PHONE_SPACE = 10_000_000;
const PHONE_DIGITS = 7;
const CONTACT = "[Test] Steps contact";

const id = () => randomUUID();
const tag = () => randomUUID().slice(0, 8);

const T = id();
const AREA = id();
const S1 = id();
const S2 = id();
const GROUP = id();
const PRODUCT = id();
const SKU = id();
const WH = id();
const rep = { id: id(), device: `dev-${id()}` };
let salonA: Login;
let salonB: Login;
let ready = false;

type Persona = "rep" | "manager" | "managerAal1" | "owner" | "salon" | "salonB" | "anon" | "service" | "serviceWrong";

const who = (k: Persona) => {
  if (k === "anon") return `reset role; select set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;`;
  if (k === "service")
    return `reset role; select set_config('request.jwt.claims', '{"role":"service_role"}', true); set local role service_role;`;
  if (k === "serviceWrong")
    return `reset role; select set_config('request.jwt.claims', '{"role":"authenticated"}', true); set local role service_role;`;
  if (k === "salon") return asLogin(salonA);
  if (k === "salonB") return asLogin(salonB);
  const [uid, aal, device] = {
    rep: [rep.id, "aal1", rep.device],
    manager: [fx.manager.id, "aal2", null],
    managerAal1: [fx.manager.id, "aal1", null],
    owner: [fx.owner.id, "aal2", null],
  }[k] as [string, string, string | null];
  return `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: uid, role: "authenticated", aal })}', true),
         set_config('request.headers', '${JSON.stringify(device ? { "x-kiran-device": device } : {})}', true);
  set local role authenticated;`;
};

type Step = [Persona | "postgres", string];
const script = (steps: Step[]) => steps.map(([k, sql]) => `${k === "postgres" ? "reset role;" : who(k)}\n${sql}`).join("\n");
type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
const tx = async (steps: Step[]) => {
  const r = (await run("postgres", script(steps))) as unknown as Multi | { rows: Array<Record<string, unknown>> };
  return Array.isArray(r) ? (r.at(-1)?.rows ?? []) : r.rows;
};
const txCode = async (steps: Step[]) => {
  try {
    await run("postgres", script(steps));
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "unknown";
  }
};
const txError = async (steps: Step[]) => {
  try {
    await run("postgres", script(steps));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

const lines = (l: Array<[string, number]>) => `'${JSON.stringify(l.map(([sku_id, qty]) => ({ sku_id, qty })))}'::jsonb`;

/** A Karachi time inside the reminder window, at or before now(), so a new row is under 24 hours old. */
const IN_WINDOW = `(case
  when extract(hour from now() at time zone 'Asia/Karachi') >= 9
   and extract(hour from now() at time zone 'Asia/Karachi') < 21
  then date_trunc('hour', now() at time zone 'Asia/Karachi') at time zone 'Asia/Karachi'
  else (date_trunc('day', now() at time zone 'Asia/Karachi')
        + case when (now() at time zone 'Asia/Karachi')::time > time '10:00' then interval '1 day' else interval '0' end
        + interval '10 hours') at time zone 'Asia/Karachi'
end)`;
const OUTSIDE = `((date_trunc('day', now() at time zone 'Asia/Karachi') + interval '22 hours') at time zone 'Asia/Karachi')`;
const NEXT_ROUND = `(case
  when extract(hour from (now() + interval '3 hours') at time zone 'Asia/Karachi') >= 9
   and extract(hour from (now() + interval '3 hours') at time zone 'Asia/Karachi') < 21
  then now() + interval '3 hours'
  else (date_trunc('day', (now() + interval '3 hours') at time zone 'Asia/Karachi')
        + case when ((now() + interval '3 hours') at time zone 'Asia/Karachi')::time >= time '10:00'
               then interval '1 day' else interval '0' end
        + interval '10 hours') at time zone 'Asia/Karachi'
end)`;
const NEGATIVE = `((date_trunc('day', now() at time zone 'Asia/Karachi') - interval '1 day' + interval '10 hours') at time zone 'Asia/Karachi')`;

type Claim = { kind: string; item_id: string; round_no: number };
type Due = { recipient_id: string; body: string; claims: Claim[] };
const asList = (raw: unknown): Due[] => {
  const list = typeof raw === "string" ? (JSON.parse(raw) as unknown[]) : (raw as unknown[]);
  if (!Array.isArray(list)) return [];
  return list.map((row) => {
    const r = row as { recipient_id: string; body: string; claims: unknown };
    const claims = typeof r.claims === "string" ? (JSON.parse(r.claims) as Claim[]) : (r.claims as Claim[]);
    return { recipient_id: String(r.recipient_id), body: String(r.body), claims };
  });
};
const forItem = (rows: Due[], itemId: string) =>
  rows.flatMap((row) =>
    row.claims
      .filter((c) => String(c.item_id).toLowerCase() === itemId.toLowerCase())
      .map((c) => ({ recipient_id: row.recipient_id, body: row.body, round_no: Number(c.round_no), kind: c.kind })),
  );

const propose = (salon: string): Step => [
  "rep",
  `select app.create_salon('${salon}', ${quote(`[Test] Pending ${tag()}`)}, 'ladies_parlor', '${AREA}', 'manual', null, ${PIN_LAT}, ${PIN_LNG});`,
];

beforeAll(async () => {
  await run(MANAGER, "select app.office_upsert_territory($1, $2)", [T, `[Test] Steps ${tag()}`], C);
  await run(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Steps area')", [AREA, T], C);
  await run("postgres", "insert into auth.users (id, email) values ($1, $2)", [rep.id, `rep.${tag()}@example.test`], C);
  await run(
    OWNER,
    "select app.owner_create_user($1, $2, 'rep'::public.app_role, $3)",
    [rep.id, "[Test] Steps rep", `+92000${String(Math.floor(Math.random() * PHONE_SPACE)).padStart(PHONE_DIGITS, "0")}`],
    C,
  );
  const reg = (await run(
    "postgres",
    `${who("rep")} select (app.register_device('${rep.device}', 'android', 'test phone')).id as d`,
    [],
    C,
  )) as unknown as Multi;
  await run(MANAGER, "select app.approve_device($1, 'fixture')", [reg.at(-1)?.rows[0].d], C);
  await run(MANAGER, "select app.office_assign_territory($1, $2)", [rep.id, T], C);
  await run(
    MANAGER,
    "select app.create_salon($1, $2, 'ladies_parlor', $3, 'manual', null, $4, $5)",
    [S1, `[Test] Steps salon ${tag()}`, AREA, PIN_LAT, PIN_LNG],
    C,
  );
  await run(
    MANAGER,
    "select app.create_salon($1, $2, 'ladies_parlor', $3, 'manual', null, $4, $5)",
    [S2, `[Test] Steps other ${tag()}`, AREA, PIN_LAT, PIN_LNG],
    C,
  );
  await run(MANAGER, "select app.office_upsert_product_group($1, $2, 38)", [GROUP, `[Test] Steps colour ${tag()}`], C);
  await run(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Steps colour')", [PRODUCT, GROUP], C);
  await run(
    MANAGER,
    "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100)",
    [SKU, PRODUCT, `T-STP-${tag().toUpperCase()}`],
    C,
  );
  await run(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU, SKU_PAISA], C);
  await run(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Steps store')", [WH], C);
  await run(
    "postgres",
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, $2, $3, 'receipt', $4)`,
    [SKU, OPENING_STOCK, WH, fx.manager.id],
    C,
  );
  const invite = async (salon: string) => {
    const email = `salon.${tag()}@example.test`;
    const r = await run(MANAGER, "select app.office_invite($1, 'salon', $2, $3, $4) as r", [id(), CONTACT, email, salon], C);
    const token = (r.rows[0].r as { token: string }).token;
    const login = await newLogin({ email });
    await run("postgres", `${asLogin(login)} select app.redeem_invitation(${quote(token)})`, [], C);
    return login;
  };
  salonA = await invite(S1);
  salonB = await invite(S2);
  ready = true;
});

afterAll(async () => {
  if (!ready) return;
  await run(MANAGER, "select app.office_end_territory($1, $2, 'steps tests finished')", [rep.id, T], C);
});

describe("order step registry", () => {
  it("lists both order kinds and marks only the two approval steps", async () => {
    const rows = await tx([
      [
        "postgres",
        `select step_key, needs_approval, rep_sort, office_sort, applies_to
         from app.order_step_registry() order by step_key;`,
      ],
    ]);
    const byKey = Object.fromEntries(rows.map((r) => [String(r.step_key), r]));
    expect(
      rows
        .filter((r) => r.needs_approval === true)
        .map((r) => r.step_key)
        .sort(),
    ).toEqual(["delivery_approved", "price_or_credit_approval"]);
    expect(byKey.out_for_delivery).toMatchObject({ rep_sort: 60, office_sort: 70 });
    expect(byKey.goods_released).toMatchObject({ rep_sort: 90, office_sort: 60 });
    expect(byKey.customer_acknowledged).toMatchObject({ rep_sort: 70, office_sort: 50 });
    expect(byKey.delivery_submitted).toMatchObject({ rep_sort: 50, office_sort: null });
    expect(byKey.paid_on_shopify).toMatchObject({ applies_to: "regular_user", rep_sort: null, office_sort: null });
    expect(byKey.dispatched_with_rider).toMatchObject({ applies_to: "regular_user", rep_sort: null, office_sort: null });
    const shape = await tx([
      ["postgres", "select pg_get_function_result('app.salon_order_steps(uuid)'::regprocedure) as result;"],
    ]);
    expect(String(shape[0].result)).not.toContain("actor_name");
  });

  it("builds a reminder body with no price and no phone", async () => {
    const rows = await tx([
      [
        "postgres",
        `select app.reminder_body('[
           {"kind":"salon","reference":"11111111-1111-1111-1111-111111111111","age_seconds":-5,"path":"/office/salons/approvals"},
           {"kind":"discount","reference":"22222222-2222-2222-2222-222222222222","age_seconds":7200,"path":"/office/approvals"}
         ]'::jsonb) as body;`,
      ],
    ]);
    const body = String(rows[0].body);
    expect(body.startsWith("discount. Reference 22222222-2222-2222-2222-222222222222.")).toBe(true);
    expect(body).toContain("Waiting 2 hours.");
    expect(body).toContain("Waiting under an hour.");
    expect(body).not.toMatch(/Rs|paisa|\+92|\[Test\]/);
  });
});

describe("order steps", () => {
  const convert = (card: string, order: string): Step[] => [
    [
      "salon",
      `select set_config('p138.card', app.salon_submit_request('${card}', ${lines([[SKU, 1]])}, null) ->> 'request_id', true);`,
    ],
    [
      "manager",
      `select set_config('p138.order', o.id::text, true)
       from app.office_create_order('${order}', '${S1}', 'CASH', null, null, current_setting('p138.card')::uuid, null) o;`,
    ],
  ];

  it("shows a converted salon request on the office path, and hides the actor from the salon", async () => {
    const card = id();
    const order = id();
    const rows = await tx([
      ...convert(card, order),
      [
        "manager",
        `select set_config('p138.office', (
           select coalesce(jsonb_agg(jsonb_build_object(
             'step_key', step_key, 'state', state, 'actor_name', actor_name, 'actor_kind', actor_kind
           ) order by n), '[]'::jsonb)::text
           from (select row_number() over () as n, s.* from app.office_order_steps(current_setting('p138.order')::uuid) s) s
         ), true);`,
      ],
      [
        "salon",
        `select set_config('p138.salon', (
           select coalesce(jsonb_agg(step_key order by n), '[]'::jsonb)::text
           from (select row_number() over () as n, s.step_key from app.salon_order_steps(current_setting('p138.order')::uuid) s) s
         ), true);`,
      ],
      ["postgres", "select current_setting('p138.office') as office, current_setting('p138.salon') as salon;"],
    ]);
    const office = JSON.parse(String(rows[0].office)) as Array<{
      step_key: string;
      state: string;
      actor_name: string | null;
      actor_kind: string | null;
    }>;
    const salonKeys = JSON.parse(String(rows[0].salon)) as string[];
    const keys = office.map((s) => s.step_key);
    expect(keys).toEqual([
      "request_received",
      "request_reviewed",
      "official_order_created",
      "customer_acknowledged",
      "goods_released",
      "out_for_delivery",
      "delivery_approved",
      "invoice_issued",
      "delivered",
      "closed",
    ]);
    expect(keys).not.toContain("delivery_submitted");
    expect(keys).not.toContain("paid_on_shopify");
    const byKey = Object.fromEntries(office.map((s) => [s.step_key, s]));
    expect(byKey.request_received).toMatchObject({ state: "done", actor_kind: "salon", actor_name: CONTACT });
    expect(byKey.request_reviewed).toMatchObject({ state: "done", actor_kind: "manager", actor_name: "[Test] Manager" });
    expect(byKey.official_order_created.state).toBe("done");
    expect(byKey.customer_acknowledged.state).toBe("current");
    expect(byKey.closed.state).toBe("upcoming");
    expect(byKey.closed.actor_name).toBeNull();
    expect(salonKeys).toEqual(keys);
  });

  it("refuses another salon, a rep, and an office session without MFA", async () => {
    const card = id();
    const order = id();
    expect(
      await txCode([
        ...convert(card, order),
        ["salonB", "select * from app.salon_order_steps(current_setting('p138.order')::uuid);"],
      ]),
    ).toBe(DENIED);
    expect(await txCode([["rep", `select * from app.office_order_steps('${id()}');`]])).toBe(DENIED);
    expect(await txCode([["managerAal1", `select * from app.office_order_steps('${id()}');`]])).toBe(DENIED);
    expect(await txCode([["anon", `select * from app.office_order_steps('${id()}');`]])).toBe(DENIED);
    expect(await txCode([["manager", `select * from app.office_order_steps('${id()}');`]])).toBe(BAD_INPUT);
    expect(await txCode([["manager", "select * from app.office_order_steps(null);"]])).toBe(BAD_INPUT);
  });

  it("marks an office delivery done and leaves closed upcoming", async () => {
    const order = id();
    const rows = await tx([
      [
        "manager",
        `select set_config('p138.order', o.id::text, true)
         from app.office_create_order('${order}', '${S1}', 'CASH', ${lines([[SKU, 1]])}, null) o;`,
      ],
      [
        "manager",
        `${signOrderSql(order, "current_setting('p138.order')::uuid")}
         select app.office_deliver('${order}', current_setting('p138.order')::uuid, '${WH}', 'Ayesha at the counter');`,
      ],
      [
        "manager",
        `select coalesce(jsonb_agg(jsonb_build_object('step_key', step_key, 'state', state) order by n), '[]'::jsonb) as steps
         from (select row_number() over () as n, s.step_key, s.state from app.office_order_steps(current_setting('p138.order')::uuid) s) s;`,
      ],
    ]);
    const steps = (typeof rows[0].steps === "string" ? JSON.parse(String(rows[0].steps)) : rows[0].steps) as Array<{
      step_key: string;
      state: string;
    }>;
    expect(steps.map((s) => s.step_key)).toEqual([
      "official_order_created",
      "customer_acknowledged",
      "goods_released",
      "out_for_delivery",
      "delivery_approved",
      "invoice_issued",
      "delivered",
      "closed",
    ]);
    const byKey = Object.fromEntries(steps.map((s) => [s.step_key, s.state]));
    expect(byKey.goods_released).toBe("done");
    expect(byKey.out_for_delivery).toBe("done");
    expect(byKey.delivery_approved).toBe("done");
    expect(byKey.invoice_issued).toBe("done");
    expect(byKey.delivered).toBe("done");
    expect(byKey.customer_acknowledged).toBe("done");
    expect(byKey.closed).toBe("upcoming");
    expect(steps.some((s) => s.state === "current")).toBe(false);
  });

  it("takes one client salon order from request to delivered, each step once and in order", async () => {
    const card = id();
    const order = id();
    const rows = await tx([
      ...convert(card, order),
      [
        "manager",
        `${signOrderSql(order, "current_setting('p138.order')::uuid")}
         select app.office_deliver('${order}', current_setting('p138.order')::uuid, '${WH}', 'Ayesha at the counter');`,
      ],
      [
        "manager",
        `select set_config('p138.office', (
           select coalesce(jsonb_agg(jsonb_build_object(
             'step_key', step_key, 'state', state, 'actor_kind', actor_kind
           ) order by n), '[]'::jsonb)::text
           from (select row_number() over () as n, s.step_key, s.state, s.actor_kind
                 from app.office_order_steps(current_setting('p138.order')::uuid) s) s
         ), true);`,
      ],
      [
        "salon",
        `select set_config('p138.salon', (
           select coalesce(jsonb_agg(jsonb_build_object('step_key', step_key, 'state', state) order by n), '[]'::jsonb)::text
           from (select row_number() over () as n, s.step_key, s.state
                 from app.salon_order_steps(current_setting('p138.order')::uuid) s) s
         ), true);`,
      ],
      ["postgres", "select current_setting('p138.office') as office, current_setting('p138.salon') as salon;"],
    ]);
    const office = JSON.parse(String(rows[0].office)) as Array<{ step_key: string; state: string; actor_kind: string | null }>;
    const salon = JSON.parse(String(rows[0].salon)) as Array<{ step_key: string; state: string }>;
    const keys = office.map((s) => s.step_key);
    expect(keys).toEqual([
      "request_received",
      "request_reviewed",
      "official_order_created",
      "customer_acknowledged",
      "goods_released",
      "out_for_delivery",
      "delivery_approved",
      "invoice_issued",
      "delivered",
      "closed",
    ]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain("delivery_submitted");
    expect(keys).not.toContain("price_or_credit_approval");
    expect(keys).not.toContain("paid_on_shopify");
    const byKey = Object.fromEntries(office.map((s) => [s.step_key, s]));
    // The acknowledgement is recorded by the office user who took the signature. The step's performer stays salon.
    for (const key of [
      "request_reviewed",
      "official_order_created",
      "customer_acknowledged",
      "goods_released",
      "out_for_delivery",
      "delivery_approved",
      "invoice_issued",
      "delivered",
    ]) {
      expect(byKey[key]).toMatchObject({ state: "done", actor_kind: "manager" });
    }
    expect(byKey.request_received).toMatchObject({ state: "done", actor_kind: "salon" });
    expect(byKey.closed).toMatchObject({ state: "upcoming", actor_kind: null });
    expect(salon.map((s) => s.step_key)).toEqual(keys);
    expect(salon.map((s) => s.state)).toEqual(office.map((s) => s.state));
  });
});

describe("approval reminders", () => {
  it("returns nothing outside the Karachi window", async () => {
    const rows = await tx([["service", `select count(*)::int as n from app.approval_reminders_due(${OUTSIDE});`]]);
    expect(rows[0].n).toBe(0);
  });

  it("reminds the manager about a pending salon, once per round, and stops when it is decided", async () => {
    const salon = id();
    const rows = await tx([
      propose(salon),
      [
        "service",
        `select set_config('p138.first', (
           select coalesce(jsonb_agg(jsonb_build_object('recipient_id', recipient_id, 'body', body, 'claims', claims)), '[]'::jsonb)::text
           from app.approval_reminders_due(${IN_WINDOW})
         ), true);`,
      ],
      [
        "service",
        `select set_config('p138.n1', (
           select app.record_approval_reminders(
             '${fx.manager.id}',
             (select e -> 'claims' from jsonb_array_elements(current_setting('p138.first')::jsonb) e
              where e ->> 'recipient_id' = '${fx.manager.id}'),
             'claimed')::text
         ), true);`,
      ],
      [
        "service",
        `select set_config('p138.n2', (
           select app.record_approval_reminders(
             '${fx.manager.id}',
             (select e -> 'claims' from jsonb_array_elements(current_setting('p138.first')::jsonb) e
              where e ->> 'recipient_id' = '${fx.manager.id}'),
             'claimed')::text
         ), true);`,
      ],
      [
        "service",
        `select set_config('p138.next', (
           select coalesce(jsonb_agg(jsonb_build_object('recipient_id', recipient_id, 'body', body, 'claims', claims)), '[]'::jsonb)::text
           from app.approval_reminders_due(${NEXT_ROUND})
         ), true);`,
      ],
      ["manager", `select app.office_decide_salon('${id()}', '${salon}', true, null);`],
      [
        "service",
        `select set_config('p138.after', (
           select coalesce(jsonb_agg(jsonb_build_object('recipient_id', recipient_id, 'body', body, 'claims', claims)), '[]'::jsonb)::text
           from app.approval_reminders_due(${IN_WINDOW})
         ), true);`,
      ],
      [
        "postgres",
        `select current_setting('p138.first') as first, current_setting('p138.n1') as n1,
                current_setting('p138.n2') as n2, current_setting('p138.next') as next,
                current_setting('p138.after') as after;`,
      ],
    ]);
    const first = forItem(asList(rows[0].first), salon);
    const managerHit = first.filter((c) => c.recipient_id === fx.manager.id);
    expect(managerHit.length).toBeGreaterThan(0);
    expect(managerHit.every((c) => c.round_no === 0 && c.kind === "salon")).toBe(true);
    expect(first.some((c) => c.recipient_id === fx.owner.id || c.recipient_id === rep.id)).toBe(false);
    expect(managerHit[0].body).not.toMatch(/\[Test\]|Rs|paisa|\+92|\b\d{11}\b/);
    expect(Number(rows[0].n1)).toBeGreaterThan(0);
    expect(Number(rows[0].n2)).toBe(0);
    const next = forItem(asList(rows[0].next), salon).filter((c) => c.recipient_id === fx.manager.id);
    expect(next.map((c) => c.round_no)).toEqual([1]);
    expect(forItem(asList(rows[0].after), salon)).toEqual([]);
  });

  it("still lists a future item on the first round, and adds the owner only after the wait", async () => {
    const early = id();
    const late = id();
    const rows = await tx([
      propose(early),
      [
        "service",
        `select coalesce(jsonb_agg(jsonb_build_object('recipient_id', recipient_id, 'claims', claims)), '[]'::jsonb) as due
         from app.approval_reminders_due(${NEGATIVE});`,
      ],
    ]);
    const earlyHits = forItem(asList(rows[0].due), early);
    expect(earlyHits.some((c) => c.recipient_id === fx.manager.id && c.round_no === 0)).toBe(true);
    expect(earlyHits.some((c) => c.recipient_id === fx.owner.id)).toBe(false);

    const later = await tx([
      propose(late),
      [
        "service",
        `select coalesce(jsonb_agg(jsonb_build_object('recipient_id', recipient_id, 'claims', claims)), '[]'::jsonb) as due
         from app.approval_reminders_due((
           select case
             when extract(hour from t at time zone 'Asia/Karachi') >= 9
              and extract(hour from t at time zone 'Asia/Karachi') < 21 then t
             else (date_trunc('day', t at time zone 'Asia/Karachi')
                   + case when (t at time zone 'Asia/Karachi')::time >= time '10:00' then interval '1 day' else interval '0' end
                   + interval '10 hours') at time zone 'Asia/Karachi'
           end
           from (select s.created_at + interval '25 hours' as t from public.salon s where s.id = '${late}') s
         ));`,
      ],
    ]);
    const lateHits = forItem(asList(later[0].due), late);
    expect(lateHits.some((c) => c.recipient_id === fx.manager.id)).toBe(true);
    expect(lateHits.some((c) => c.recipient_id === fx.owner.id)).toBe(true);
    expect(lateHits.some((c) => c.recipient_id === rep.id)).toBe(false);
  });

  it("keeps the log append-only and closed to every API role", async () => {
    const { rows: granted } = await run(
      "postgres",
      `
      select n.nspname || '.' || p.proname as f
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and has_function_privilege('service_role', p.oid, 'execute')
      order by 1`,
    );
    expect(granted.map((r) => r.f)).toEqual(["app.approval_reminders_due", "app.record_approval_reminders"]);
    const claim = `[{"kind":"salon","item_id":"${id()}","round_no":0}]`;
    const record: Step = ["service", `select app.record_approval_reminders('${fx.manager.id}', '${claim}'::jsonb, 'claimed');`];
    for (const change of [
      "update control.approval_reminder_log set result = 'sent'",
      "delete from control.approval_reminder_log",
      "truncate control.approval_reminder_log",
    ]) {
      expect(await txCode([record, ["postgres", `${change};`]])).toBe(DENIED);
      expect(await txError([record, ["postgres", `${change};`]])).toContain("append-only");
    }
    expect(await txCode([["service", "select * from control.approval_reminder_log;"]])).toBe(DENIED);
    expect(await txCode([["anon", "select * from control.approval_reminder_log;"]])).toBe(DENIED);
    expect(await txCode([["rep", "select * from control.approval_reminder_log;"]])).toBe(DENIED);
    expect(await txCode([["salon", "select * from control.approval_reminder_log;"]])).toBe(DENIED);
    expect(await txCode([["rep", "select * from app.office_reminder_log();"]])).toBe(DENIED);
    expect(await txCode([["salon", "select * from app.office_reminder_log();"]])).toBe(DENIED);
    expect(await txCode([["manager", "select * from app.approval_reminders_due(now());"]])).toBe(DENIED);
    expect(await txCode([["serviceWrong", "select * from app.approval_reminders_due(now());"]])).toBe(DENIED);
    expect(
      await txCode([
        ["manager", "select app.owner_set_config('reminders.interval_minutes', '30'::jsonb, 'not the owner', null);"],
      ]),
    ).toBe(DENIED);
    const item = id();
    const seenClaim = `[{"kind":"salon","item_id":"${item}","round_no":0}]`;
    const recorded = await tx([
      record,
      ["service", `select app.record_approval_reminders('${fx.manager.id}', '${seenClaim}'::jsonb, 'claimed');`],
      [
        "manager",
        `select set_config('p138.seen', (
           select count(*) from app.office_reminder_log() where item_id = '${item}'
         )::text, true);`,
      ],
      [
        "postgres",
        `select current_setting('p138.seen')::int as n,
                (select count(*)::int from control.audit_event
                 where table_name = 'control.approval_reminder_log' and action = 'INSERT') as audit_n;`,
      ],
    ]);
    expect(Number(recorded[0].n)).toBe(1);
    expect(Number(recorded[0].audit_n)).toBeGreaterThan(0);
    const again = await tx([
      ["service", `select app.record_approval_reminders('${fx.manager.id}', '[]'::jsonb, 'claimed') as n;`],
    ]);
    expect(again[0].n).toBe(0);
    expect(await txCode([["service", `select app.record_approval_reminders('${fx.manager.id}', '{}'::jsonb, 'sent');`]])).toBe(
      BAD_INPUT,
    );
  });
});
