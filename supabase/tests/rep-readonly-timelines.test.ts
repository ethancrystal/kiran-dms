/**
 * Slice 7 (P1-24), migration 20261105160000: reps read salons and do not edit them (R3, D-35); a rep's
 * new salon is a pending proposal that the office decides (slice 1's app.office_decide_salon), reachable
 * under R4 meanwhile; and the office's scoped salon and order timelines over control.audit_event
 * (allow-listed fields; the raw audit log stays owner-only). Synthetic data only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { asLoginCode, type Login, newLogin, quote, tag, uuid } from "./helpers/invite";

const C = { commit: true };
const DENIED = "42501";
const BAD_INPUT = "22023";
const WRONG_STATE = "55000";
const TODAY = "(now() at time zone 'Asia/Karachi')::date";
const UNIT = 120_000; // Rs 1,200 list price, paisa
const QTY = 2;
const CYCLE_DAYS = 30;
const RATE = 250; // 2.5%
const EVENT_CAP = 500;
const CHAIRS = 5;
const MANAGER_NAME = "[Test] Manager"; // the fixtures' names (setup/fixtures.ts)
const REP_A_NAME = "[Test] Rep A";
const OFFICE_ONLY ="only the office edits a salon";

// Values written into the salon's rows that a timeline must never return.
const PHONE = "+920000009377";
const NOTE = "[Test] timeline-secret note body";
const ADDRESS = "[Test] 12 Hidden Timeline Lane";
const LAT = 24.8612;
const LNG = 67.0123;
const REJECT_REASON = "[Test] timeline-secret reason";
const REQUEST_NOTE = "[Test] timeline-secret request note";

const T_A = uuid(),
  AREA_A = uuid(),
  T_B = uuid(),
  AREA_B = uuid(),
  GROUP = uuid(),
  PRODUCT = uuid(),
  SKU = uuid(),
  SALON = uuid(); // office-made, with a phone, a note, an edit, an order and a salon account

let salonLogin: Login;
let member = "";

const LINES = () => `'${JSON.stringify([{ sku_id: SKU, qty: QTY }])}'::jsonb`;
const TIMELINE_KEYS = ["action", "actor_kind", "actor_name", "detail", "entity", "entity_id", "occurred_at", "seq"];

const asSalon = (l: Login) => `reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({
    sub: l.id,
    role: "authenticated",
    aal: "aal1",
    session_id: l.session,
    email: l.email,
    amr: [{ method: "otp", timestamp: 1 }],
  })}', true), set_config('request.headers', '{}', true);
  set local role authenticated;`;
const asRepA = `reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.repA.id, role: "authenticated", aal: "aal1" })}', true),
         set_config('request.headers', '${JSON.stringify({ "x-kiran-device": fx.repA.device })}', true);
  set local role authenticated;`;
const asManager = `reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.manager.id, role: "authenticated", aal: "aal2" })}', true),
         set_config('request.headers', '{}', true);
  set local role authenticated;`;
// An open day for rep A that lives only inside the rolled-back script (visits.test.ts expects none).
const OPEN_DAY = `insert into public.rep_day (rep_id, day) values ('${fx.repA.id}', ${TODAY}) on conflict (rep_id, day) do nothing;`;
const repCardCode = (salon: string) =>
  sqlstate("postgres", `${OPEN_DAY} ${asRepA} select app.rep_create_card(gen_random_uuid(), '${salon}', '[Test] 2 bottles');`);

const propose = async (who: Who = REP_A, area = AREA_A) => {
  const id = uuid();
  await run(who, "select app.create_salon($1, $2, 'unisex', $3, 'map_pin')", [id, `[Test] Proposal ${tag()}`, area], C);
  return id;
};
const decide = (salon: string, approve: boolean, reason: string | null = null, rep: string | null = null, rate: number | null = null) =>
  run(MANAGER, "select (app.office_decide_salon($1, $2, $3, $4, $5, $6)).*", [uuid(), salon, approve, reason, rep, rate], C);
const salonRow = async (id: string) =>
  (await run("postgres", "select approval_status, stage, name, address, chairs from public.salon where id = $1", [id])).rows[0];
const mySalons = async (who: Who) => (await run(who, "select id from app.my_salons(null, null, 50)")).rows.map((r) => r.id);
const salonTimeline = async (who: Who, id: string) =>
  (await run(who, "select * from app.office_salon_timeline($1)", [id])).rows as Array<Record<string, unknown>>;
const orderTimeline = async (who: Who, id: string) =>
  (await run(who, "select * from app.office_order_timeline($1)", [id])).rows as Array<Record<string, unknown>>;
const actions = (rows: Array<Record<string, unknown>>) => rows.map((r) => r.action);

const STAFF_REFUSED: Array<[string, Who]> = [
  ["anon", "anon"],
  ["repA", REP_A],
  ["repB (other territory)", REP_B],
  ["repA on a wrong device", REP_A_WRONG_DEVICE],
  ["a suspended rep", SUSPENDED],
  ["manager without MFA", MANAGER_AAL1],
  ["owner without MFA", OWNER_AAL1],
];

beforeAll(async () => {
  await run(MANAGER, "select app.office_upsert_territory($1, $2)", [T_A, `[Test] Readonly A ${tag()}`], C);
  await run(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Readonly area A')", [AREA_A, T_A], C);
  await run(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T_A], C);
  await run(MANAGER, "select app.office_upsert_territory($1, $2)", [T_B, `[Test] Readonly B ${tag()}`], C);
  await run(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Readonly area B')", [AREA_B, T_B], C);
  await run(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repB.id, T_B], C);
  await run(MANAGER, "select app.office_upsert_product_group($1, $2, $3)", [GROUP, `[Test] Readonly ${tag()}`, CYCLE_DAYS], C);
  await run(
    MANAGER,
    "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Readonly colour', true, '[Dummy] A test shade.')",
    [PRODUCT, GROUP],
    C,
  );
  await run(
    MANAGER,
    "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100)",
    [SKU, PRODUCT, `T-RO-${tag().toUpperCase()}`],
    C,
  );
  await run(MANAGER, "select app.office_set_sku_price($1, $2, $3, '[Test] readonly list price')", [uuid(), SKU, UNIT], C);

  // The office's salon: a phone and a note at creation, then an edit of the address and the pin.
  await run(
    MANAGER,
    "select app.create_salon($1, $2, 'ladies_parlor', $3, 'manual', null, null, null, 3, '[Test] Contact', $4, $5)",
    [SALON, `[Test] Readonly salon ${tag()}`, AREA_A, PHONE, NOTE],
    C,
  );
  await run(MANAGER, "select app.update_salon($1, null, 'ladies_parlor', $2, $3, $4, $5)", [SALON, AREA_A, ADDRESS, LAT, LNG], C);
  // Its salon account, through a real invitation and an emailed-code session.
  const email = `salon.${tag()}@example.test`;
  const inv = (await run(MANAGER, "select app.office_invite($1, 'salon', '[Test] Timeline contact', $2, $3) as r", [uuid(), email, SALON], C))
    .rows[0].r as { token: string };
  salonLogin = await newLogin({ email });
  await run("postgres", `${asSalon(salonLogin)} select app.redeem_invitation(${quote(inv.token)});`, [], C);
  member = (await run("postgres", "select id from public.salon_membership where user_id = $1", [salonLogin.id])).rows[0].id;
});

afterAll(async () => {
  if (member) await run(MANAGER, "select app.office_set_member_status('salon', $1, 'revoked', 'readonly tests finished')", [member], C);
  // Leave the shared reps' reach as other files expect it: clear direct assignments made here.
  const { rows: held } = await run(
    "postgres",
    "select s.id from public.salon s where s.area_id in ($1, $2) and app.salon_direct_rep(s.id) is not null",
    [AREA_A, AREA_B],
  );
  await held.reduce(async (prev, { id }) => {
    await prev;
    await run(MANAGER, "select app.office_assign_salon_rep($1, $2, null)", [uuid(), id], C);
  }, Promise.resolve());
  await run(MANAGER, "select app.office_end_territory($1, $2, 'readonly tests finished')", [fx.repA.id, T_A], C);
  await run(MANAGER, "select app.office_end_territory($1, $2, 'readonly tests finished')", [fx.repB.id, T_B], C);
});

// ------------------------------------------------------------------------------ read-only ----
describe("reps read salons and do not edit them (R3, D-35)", () => {
  it("app.update_salon refuses the territory's own rep with 42501 and changes nothing", async () => {
    const before = await salonRow(SALON);
    expect(await sqlstate(REP_A, "select app.update_salon($1, '[Test] renamed', 'unisex', $2)", [SALON, AREA_A])).toBe(DENIED);
    expect(await errorOf(REP_A, "select app.update_salon($1, null, 'ladies_parlor', $2, '[Test] new address')", [SALON, AREA_A])).toContain(
      OFFICE_ONLY,
    );
    expect(await salonRow(SALON)).toEqual(before);
  });

  it("an unknown salon id and another territory's salon get the same 42501 for a rep (no lookup first)", async () => {
    expect(await errorOf(REP_A, "select app.update_salon($1, null, 'unisex', $2)", [uuid(), AREA_A])).toContain(OFFICE_ONLY);
    expect(await errorOf(REP_B, "select app.update_salon($1, null, 'unisex', $2)", [SALON, AREA_B])).toContain(OFFICE_ONLY);
  });

  it.each(STAFF_REFUSED)("%s cannot edit a salon", async (_n, who) => {
    expect(await sqlstate(who, "select app.update_salon($1, null, 'ladies_parlor', $2, '[Test] x')", [SALON, AREA_A])).toBe(DENIED);
  });

  it("a salon login and a login with nothing redeemed cannot edit a salon", async () => {
    const sql = `select app.update_salon('${SALON}', null, 'ladies_parlor', '${AREA_A}', '[Test] x')`;
    expect(await sqlstate("postgres", `${asSalon(salonLogin)} ${sql}`)).toBe(DENIED);
    expect(await asLoginCode(await newLogin(), sql)).toBe(DENIED);
  });

  it.each([
    ["manager", MANAGER],
    ["owner", OWNER],
  ])("the %s still edits a salon", async (_n, who) => {
    const r = await run(who, "select (app.update_salon($1, null, 'ladies_parlor', $2, null, null, null, $3)).chairs", [
      SALON,
      AREA_A,
      CHAIRS,
    ]);
    expect(r.rows[0].chairs).toBe(CHAIRS);
  });

  it("the rep still reads the salon (my_salon, with the approval status) and adds a note", async () => {
    const r = await run(REP_A, "select id, address, approval_status from app.my_salon($1)", [SALON]);
    expect(r.rows).toEqual([{ id: SALON, address: ADDRESS, approval_status: "approved" }]);
    expect(await sqlstate(REP_A, "select app.add_salon_note(gen_random_uuid(), $1, '[Test] a note')", [SALON])).toBeNull();
    expect((await run(REP_B, "select id from app.my_salon($1)", [SALON])).rows).toEqual([]);
  });

  it("rep_park_salon stays a rep action (B-28 default)", async () => {
    const id = await propose();
    expect(await sqlstate(REP_A, "select app.rep_park_salon($1, '[Test] not interested now')", [id])).toBeNull();
    expect(await sqlstate(REP_B, "select app.rep_park_salon($1, '[Test] not interested now')", [id])).toBe(DENIED);
  });
});

// ------------------------------------------------------------------------------ proposals ----
describe("a rep's new salon is a pending proposal (R3, R4)", () => {
  it("create_salon by a rep makes a pending salon with no assignment; the office's salons stay approved", async () => {
    const id = await propose();
    expect(await salonRow(id)).toMatchObject({ approval_status: "pending", stage: "prospect" });
    expect((await run("postgres", "select 1 from public.salon_rep_assignment where salon_id = $1", [id])).rows).toEqual([]);
    expect((await salonRow(SALON)).approval_status).toBe("approved");
    const ownerMade = uuid();
    await run(OWNER, "select app.create_salon($1, '[Test] Owner made', 'barber', $2, 'manual')", [ownerMade, AREA_A], C);
    expect((await salonRow(ownerMade)).approval_status).toBe("approved");
  });

  it("the proposing rep reaches it under R4 (territory), sees it is pending and adds notes; another rep does not", async () => {
    const id = await propose();
    expect(await mySalons(REP_A)).toContain(id);
    expect((await run(REP_A, "select approval_status from app.my_salon($1)", [id])).rows).toEqual([{ approval_status: "pending" }]);
    expect(await sqlstate(REP_A, "select app.add_salon_note(gen_random_uuid(), $1, '[Test] proposal note')", [id])).toBeNull();
    expect(await mySalons(REP_B)).not.toContain(id);
    expect(await sqlstate(REP_B, "select app.add_salon_note(gen_random_uuid(), $1, '[Test] x')", [id])).toBe(DENIED);
  });

  it("a rep proposes only in its own territories, from the field only", async () => {
    expect(await sqlstate(REP_A, "select app.create_salon($1, '[Test] x', 'unisex', $2, 'map_pin')", [uuid(), AREA_B])).toBe(DENIED);
    expect(await sqlstate(REP_A, "select app.create_salon($1, '[Test] x', 'unisex', $2, 'excel_import')", [uuid(), AREA_A])).toBe(
      DENIED,
    );
    expect(await sqlstate(SUSPENDED, "select app.create_salon($1, '[Test] x', 'unisex', $2, 'map_pin')", [uuid(), AREA_A])).toBe(DENIED);
  });

  it("a replay of the proposal returns the same pending row and adds nothing", async () => {
    const id = uuid();
    const sql = "select (app.create_salon($1, '[Test] Replayed proposal', 'unisex', $2, 'map_pin')).approval_status";
    await run(REP_A, sql, [id, AREA_A], C);
    expect((await run(REP_A, sql, [id, AREA_A], C)).rows[0].approval_status).toBe("pending");
    const n = await run("postgres", "select count(*)::int n from public.stage_event where salon_id = $1", [id]);
    expect(n.rows[0].n).toBe(1);
    // Another rep reusing the id in its own area is refused as a duplicate id (as salons.test.ts pins).
    expect(await sqlstate(REP_B, sql, [id, AREA_B])).toBe("23505");
  });

  it("a pending proposal gets no card and no order; it is on the office's queue with the proposer's name", async () => {
    const id = await propose();
    expect(await repCardCode(id)).toBe(WRONG_STATE);
    expect(await sqlstate(MANAGER, `select app.office_create_order($1, $2, 'CASH', ${LINES()})`, [uuid(), id])).toBe(WRONG_STATE);
    const q = (await run(MANAGER, "select salon_id, proposed_by_name from app.office_pending_salons()")).rows;
    expect(q.find((r) => r.salon_id === id)).toEqual({ salon_id: id, proposed_by_name: REP_A_NAME });
  });

  it("the office approves it with no rep: territory coverage stays, and the rep's card is now taken", async () => {
    const id = await propose();
    await decide(id, true);
    expect((await salonRow(id)).approval_status).toBe("approved");
    expect(await mySalons(REP_A)).toContain(id);
    expect(await repCardCode(id)).toBeNull();
  });

  it("the office approves it with another rep and a rate: that rep alone reaches it (R4)", async () => {
    const id = await propose();
    await decide(id, true, null, fx.repB.id, RATE);
    expect(await mySalons(REP_B)).toContain(id);
    expect(await mySalons(REP_A)).not.toContain(id);
    expect(await repCardCode(id)).toBe(DENIED);
  });

  it("the office rejects it with a reason: still no card, and the rep cannot approve or decide it", async () => {
    const id = await propose();
    const d = "select app.office_decide_salon(gen_random_uuid(), $1, true, null)";
    expect(await sqlstate(REP_A, d, [id])).toBe(DENIED);
    await decide(id, false, REJECT_REASON);
    expect((await salonRow(id)).approval_status).toBe("rejected");
    expect(await repCardCode(id)).toBe(WRONG_STATE);
  });

  it("the audit row of a proposal carries the rep as its actor", async () => {
    const id = await propose();
    const a = await run(
      "postgres",
      "select actor_id, after ->> 'approval_status' s from control.audit_event where table_name = 'public.salon' and row_id = $1 and action = 'INSERT'",
      [id],
    );
    expect(a.rows).toEqual([{ actor_id: fx.repA.id, s: "pending" }]);
  });
});

// ------------------------------------------------------------------------------ timelines ----
describe("the office's salon and order timelines", () => {
  let proposal = "";
  let orderId = "";

  beforeAll(async () => {
    proposal = await propose();
    await decide(proposal, true, null, fx.repA.id, RATE);
    // A salon request from the salon account, converted by the manager in one click (slice 6).
    const cid = uuid();
    const req = await run(
      "postgres",
      `${asSalon(salonLogin)} select app.salon_submit_request('${cid}', ${LINES()}, ${quote(REQUEST_NOTE)}) ->> 'request_id' as id;`,
      [],
      C,
    );
    const card = (req as unknown as Array<{ rows: Array<{ id: string }> }>).at(-1)?.rows[0].id ?? "";
    const o = await run(MANAGER, "select (app.office_create_order($1, $2, 'CASH', null, null, $3, null)).id", [uuid(), SALON, card], C);
    orderId = o.rows[0].id;
  });

  it("the salon timeline lists who did what, oldest first, with allow-listed columns only", async () => {
    const rows = await salonTimeline(MANAGER, SALON);
    expect(Object.keys(rows[0]).sort()).toEqual(TIMELINE_KEYS);
    expect(rows.map((r) => Number(r.seq))).toEqual([...rows.map((r) => Number(r.seq))].sort((x, y) => x - y));
    const first = rows[0];
    expect(first).toMatchObject({ action: "salon added", detail: "approved", actor_name: MANAGER_NAME, actor_kind: "manager" });
    expect(first).toMatchObject({ entity: "public.salon", entity_id: SALON });
    const acts = actions(rows);
    expect(acts).toEqual(
      expect.arrayContaining([
        "salon added",
        "phone added",
        "note added",
        "stage changed",
        "salon updated",
        "invitation sent",
        "salon account joined",
        "request sent",
        "order created",
      ]),
    );
    expect(rows.find((r) => r.action === "salon updated")?.detail).toBe("address, pin");
    expect(rows.find((r) => r.action === "stage changed")?.detail).toBe("prospect");
    const request = rows.find((r) => r.action === "request sent");
    expect(request).toMatchObject({ actor_kind: "salon", actor_name: "[Test] Timeline contact" });
  });

  it("no timeline row carries a phone, a pin, an address, a note, a reason or another table's data", async () => {
    const all = JSON.stringify([
      ...(await salonTimeline(MANAGER, SALON)),
      ...(await salonTimeline(MANAGER, proposal)),
      ...(await orderTimeline(MANAGER, orderId)),
    ]);
    [PHONE, PHONE.slice(1), NOTE, ADDRESS, String(LAT), String(LNG), REJECT_REASON, REQUEST_NOTE, "token", "hash", "purpose"].forEach((s) =>
      expect(all, s).not.toContain(s),
    );
    const tables = new Set(
      [...(await salonTimeline(OWNER, SALON)), ...(await orderTimeline(OWNER, orderId))].map((r) => String(r.entity)),
    );
    // A public or control table that is not the phone-reveal log, a stock table or an investor table:
    // "public.salon_note" matches; "control.phone_reveal", "public.stock_movement" and
    // "public.investor_payout" do not.
    // https://regex101.com/?regex=%5E%28public%7Ccontrol%29%5C.%28%3F%21phone_reveal%7Cstock%7Cinvestor%7Cinvestment%29&flavor=javascript
    tables.forEach((t) => expect(t, t).toMatch(/^(public|control)\.(?!phone_reveal|stock|investor|investment)/));
  });

  it("a proposal's timeline shows the rep's proposal, the office's approval and the assignment", async () => {
    const rows = await salonTimeline(OWNER, proposal);
    expect(rows[0]).toMatchObject({ action: "salon proposed", detail: "pending", actor_name: REP_A_NAME, actor_kind: "rep" });
    expect(rows.find((r) => r.action === "salon approved")).toMatchObject({ actor_name: MANAGER_NAME, actor_kind: "manager" });
    expect(rows.find((r) => r.action === "rep assigned")).toMatchObject({ actor_kind: "manager" });
  });

  it("the order timeline shows the request, its conversion, the order and its lines", async () => {
    const rows = await orderTimeline(MANAGER, orderId);
    expect(Object.keys(rows[0]).sort()).toEqual(TIMELINE_KEYS);
    expect(actions(rows)).toEqual(expect.arrayContaining(["request sent", "request converted", "order created", "order line added"]));
    expect(rows.find((r) => r.action === "order created")).toMatchObject({
      detail: "draft",
      actor_name: MANAGER_NAME,
      entity_id: orderId,
    });
    // The order is written as a draft, then confirmed by the credit and price check in the same call.
    expect(rows.some((r) => r.action === "order updated" && r.detail === "confirmed" && r.actor_kind === "manager")).toBe(true);
    expect(rows.find((r) => r.action === "request sent")?.actor_kind).toBe("salon");
    // Nothing from another order of the same salon.
    expect(rows.every((r) => r.entity !== "public.sales_order" || r.entity_id === orderId)).toBe(true);
  });

  it.each(STAFF_REFUSED)("%s reads neither timeline", async (_n, who) => {
    expect(await sqlstate(who, "select * from app.office_salon_timeline($1)", [SALON])).toBe(DENIED);
    expect(await sqlstate(who, "select * from app.office_order_timeline($1)", [orderId])).toBe(DENIED);
  });

  it("the salon's own login and a login with nothing redeemed read neither timeline", async () => {
    const a = `select * from app.office_salon_timeline('${SALON}')`;
    const b = `select * from app.office_order_timeline('${orderId}')`;
    expect(await sqlstate("postgres", `${asSalon(salonLogin)} ${a}`)).toBe(DENIED);
    expect(await sqlstate("postgres", `${asSalon(salonLogin)} ${b}`)).toBe(DENIED);
    const nobody = await newLogin();
    expect(await asLoginCode(nobody, a)).toBe(DENIED);
    expect(await asLoginCode(nobody, b)).toBe(DENIED);
  });

  it("bad input: a null or unknown id, or an id of the other kind, is 22023", async () => {
    await Promise.all(
      [
        ["select * from app.office_salon_timeline(null)", []],
        ["select * from app.office_salon_timeline($1)", [uuid()]],
        ["select * from app.office_salon_timeline($1)", [orderId]],
        ["select * from app.office_order_timeline(null)", []],
        ["select * from app.office_order_timeline($1)", [uuid()]],
        ["select * from app.office_order_timeline($1)", [SALON]],
      ].map(async ([sql, p]) => expect(await sqlstate(MANAGER, sql as string, p as unknown[]), String(p)).toBe(BAD_INPUT)),
    );
  });

  it("the raw audit log stays owner-only: the manager reads no audit row directly", async () => {
    expect((await run(MANAGER, "select count(*)::int n from control.audit_event")).rows[0].n).toBe(0);
    expect((await run(REP_A, "select count(*)::int n from control.audit_event")).rows[0].n).toBe(0);
    expect((await run(OWNER, "select count(*)::int n from control.audit_event")).rows[0].n).toBeGreaterThan(0);
  });

  it("the helpers are internal: no app role may execute them", async () => {
    const r = await run(
      "postgres",
      `select has_function_privilege('authenticated', 'app.timeline_actor(uuid, text)', 'execute') a,
              has_function_privilege('authenticated', 'app.timeline_label(text, text, jsonb, jsonb)', 'execute') b,
              has_function_privilege('anon', 'app.office_salon_timeline(uuid)', 'execute') c,
              has_function_privilege('service_role', 'app.office_order_timeline(uuid)', 'execute') d`,
    );
    expect(r.rows[0]).toEqual({ a: false, b: false, c: false, d: false });
  });

  it("replays add no event, reading writes no audit row, and the chain still verifies", async () => {
    const id = uuid();
    const client = uuid();
    const create = "select app.create_salon($1, '[Test] Timeline replay', 'unisex', $2, 'map_pin')";
    await run(REP_A, create, [id, AREA_A], C);
    const decision = "select app.office_decide_salon($1, $2, true, null)";
    await run(MANAGER, decision, [client, id], C);
    const once = (await salonTimeline(MANAGER, id)).length;
    await run(REP_A, create, [id, AREA_A], C);
    await run(MANAGER, decision, [client, id], C);
    expect((await salonTimeline(MANAGER, id)).length).toBe(once);
    const head = async () => (await run("postgres", "select last_seq from control.audit_chain_head")).rows[0].last_seq;
    const before = await head();
    await run(MANAGER, "select count(*) from app.office_salon_timeline($1)", [id], C);
    await run(MANAGER, "select count(*) from app.office_order_timeline($1)", [orderId], C);
    expect(await head()).toBe(before);
    expect((await run("postgres", "select ok from control.verify_audit_chain()")).rows[0].ok).toBe(true);
  });

  it(`returns at most the newest ${EVENT_CAP} events`, async () => {
    // Postgres writes 501 notes inside a rolled-back transaction, then the manager's call in the same one.
    const r = await run(
      "postgres",
      `insert into public.salon_note (client_id, salon_id, author_id, body)
         select gen_random_uuid(), '${SALON}', '${fx.manager.id}', '[Test] bulk ' || g from generate_series(1, ${EVENT_CAP + 1}) g;
       ${asManager}
       select count(*)::int n, max(seq) m from app.office_salon_timeline('${SALON}');`,
    );
    const last = (r as unknown as Array<{ rows: Array<{ n: number }> }>).at(-1)?.rows[0];
    expect(last?.n).toBe(EVENT_CAP);
  });
});
