// Seeds a LOCAL Supabase stack (`supabase start`) for the office browser tests in
// apps/web/e2e-stack (execution map, slice 1). Synthetic people only (H-03): example.test
// addresses, "[Test]" names, a random password per run. Never point this at a hosted project:
// it refuses any database URL that is not on 127.0.0.1 or localhost.
//
// Sign-in accounts are written straight into the local auth schema (every token column set to
// an empty string: GoTrue cannot read a user row whose token columns are null), so no service-role key is
// used anywhere (H-18). Profiles go through the same functions the app uses
// (app.bootstrap_owner as postgres, then app.owner_create_user as the owner at AAL2), exactly as
// supabase/tests/setup/fixtures.ts does.
//
// Usage: KIRAN_STACK_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
//          node scripts/e2e-stack-seed.mjs apps/web/e2e-stack/.seed.json
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import pg from "pg";

const url = process.env.KIRAN_STACK_DB_URL;
if (!url) throw new Error("KIRAN_STACK_DB_URL is not set (never falls back to DATABASE_URL)");
const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost"].includes(host)) throw new Error(`refusing to seed a non-local database (${host})`);
const out = process.argv[2] ?? "apps/web/e2e-stack/.seed.json";

const tag = randomUUID().slice(0, 8);
const password = `e2e-${randomUUID()}`;
const person = (key, name) => ({ id: randomUUID(), email: `${key}.${tag}@example.test`, name: `[Test] ${name}` });
const people = {
  owner: person("owner", "Owner"),
  manager: person("manager", "Manager"),
  rep: person("rep", "Rep One"),
  rep2: person("rep2", "Rep Two"),
  newcomer: person("newcomer", "Newcomer"),
  // Slice 1 (D-39): a login with no profile, invited as a rep on the People page by the stack test.
  invitee: person("invitee", "Invited Rep"),
};

// One priced product for the office order test (D-30): a [Dummy] catalogue entry (no real supplier or
// product data, H-01), list price Rs 1,500 set by the owner as the price list requires (doc 06 section 2).
const SKU_PRICE_PAISA = 150_000;
const CYCLE_DAYS = 30;
const SKU_SIZE_ML = 100;
const sku = { id: randomUUID(), code: `DUMMY-${tag.toUpperCase()}`, list_price_paisa: SKU_PRICE_PAISA };
const pendingSalon = { id: randomUUID(), name: `[Test] Proposed salon ${tag}`, area: "" };
// Slice 4 (D-32): units of the SKU loaded into Rep One's bag, and the warehouse they came from.
const BAG_QTY = 6;
const warehouse = { id: randomUUID(), name: `[Test] Warehouse ${tag}` };

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  for (const p of Object.values(people)) {
    await c.query(
      `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
         confirmation_token, recovery_token, email_change, email_change_token_new,
         email_change_token_current, phone_change, phone_change_token, reauthentication_token)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
         extensions.crypt($3, extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', '')`,
      [p.id, p.email, password],
    );
    await c.query(
      `insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values (gen_random_uuid(), $1::uuid, $3::text, jsonb_build_object('sub', $3::text, 'email', $2::text, 'email_verified', true),
               'email', now(), now(), now())`,
      [p.id, p.email, p.id],
    );
  }

  await c.query("select app.bootstrap_owner($1, $2)", [people.owner.id, people.owner.name]);

  const as = async (id, aal, device, sql, params) => {
    await c.query("begin");
    try {
      await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)", [
        JSON.stringify({ sub: id, role: "authenticated", aal }),
        JSON.stringify(device ? { "x-kiran-device": device } : {}),
      ]);
      await c.query("set local role authenticated");
      const r = await c.query(sql, params);
      await c.query("commit");
      return r;
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  };
  const create = (p, role, phone) =>
    as(people.owner.id, "aal2", null, "select app.owner_create_user($1, $2, $3::public.app_role, $4)", [
      p.id,
      p.name,
      role,
      phone,
    ]);
  await create(people.manager, "manager", "+920000000101");
  await create(people.rep, "rep", "+920000000102");
  await create(people.rep2, "rep", "+920000000103");
  // newcomer has a sign-in but no profile: the tests add it through the Team page. invitee too: the
  // tests invite it as a rep on the People page.

  // Rep One has a bag (owner only, A-08): the evening count then has a bag to close, so check-out
  // depends on the daily close being sent (B-35, INV-05). Rep Two has none. The bag's pending-delivery
  // location comes with it (D-32, migration 20261105130100).
  const bagId = randomUUID();
  await as(people.owner.id, "aal2", null, "select app.office_create_location($1, 'rep_bag', '[Test] Rep One bag', $2, 1000000)", [
    bagId,
    people.rep.id,
  ]);

  // The [Dummy] catalogue: product group, product and SKU through the office catalogue functions,
  // then the list price through app.owner_set_sku_price (owner only, with a reason).
  const group = randomUUID();
  const product = randomUUID();
  await as(people.owner.id, "aal2", null, "select app.office_upsert_product_group($1, $2, $3)", [
    group,
    `[Dummy] Hair colour ${tag}`,
    CYCLE_DAYS,
  ]);
  await as(people.owner.id, "aal2", null, "select app.office_upsert_product($1, $2, $3, $4)", [
    product,
    group,
    "[Dummy] Kiran",
    "[Dummy] Hair colour",
  ]);
  await as(people.owner.id, "aal2", null, "select app.office_upsert_sku($1, $2, $3, $4, 'ml', $5)", [
    sku.id,
    product,
    sku.code,
    "[Dummy] Shade 5",
    SKU_SIZE_ML,
  ]);
  await as(people.owner.id, "aal2", null, "select app.owner_set_sku_price($1, $2, $3)", [
    sku.id,
    sku.list_price_paisa,
    "[Test] e2e list price",
  ]);

  // Slice 4 (D-32): a warehouse, and BAG_QTY of the SKU in Rep One's bag, so the rep can hand goods
  // over and the office can return rejected goods. No office stock screen exists, so the opening
  // receipt and the issue to the bag are written as postgres, the way the database tests do.
  await as(people.owner.id, "aal2", null, "select app.office_create_location($1, 'warehouse', $2)", [
    warehouse.id,
    warehouse.name,
  ]);
  await c.query(
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, $2, $3, 'receipt', $4)`,
    [sku.id, BAG_QTY, warehouse.id, people.owner.id],
  );
  await c.query(
    `insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, $2, $3, $4, 'issue_to_rep', $5)`,
    [sku.id, BAG_QTY, warehouse.id, bagId, people.owner.id],
  );

  // Slice 1 (D-35, D-39): a territory and area for a salon the manager creates while inviting it,
  // and a salon a rep proposed, waiting on Salon approvals. Nothing in the app makes a pending salon
  // until slice 7, so it is written here as postgres, the way the database tests do.
  const territory = { id: randomUUID(), name: `[Test] Seed territory ${tag}` };
  const area = { id: randomUUID(), name: `[Test] Seed area ${tag}` };
  await as(people.owner.id, "aal2", null, "select app.office_upsert_territory($1, $2)", [territory.id, territory.name]);
  await as(people.owner.id, "aal2", null, "select app.office_upsert_area($1, $2, $3)", [area.id, territory.id, area.name]);
  pendingSalon.area = `${territory.name} · ${area.name}`; // as the area pickers label it
  await c.query(
    `insert into public.salon (id, name, type, area_id, source, created_by, approval_status)
     values ($1, $2, 'ladies_parlor', $3, 'map_pin', $4, 'pending')`,
    [pendingSalon.id, pendingSalon.name, area.id, people.rep.id],
  );

  // Rep Two's phone asks for approval, as the rep app does on first open.
  const device = `web-${randomUUID()}`;
  await as(people.rep2.id, "aal1", device, "select app.register_device($1, 'android', '[Test] phone')", [device]);
} finally {
  await c.end();
}

writeFileSync(out, JSON.stringify({ password, people, sku, pendingSalon, warehouse, bagQty: BAG_QTY }, null, 2));
console.log(`seeded ${Object.keys(people).length} synthetic people into the local stack -> ${out}`);
