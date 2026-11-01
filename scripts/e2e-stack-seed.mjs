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
};

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
  // newcomer has a sign-in but no profile: the tests add it through the Team page.

  // Rep Two's phone asks for approval, as the rep app does on first open.
  const device = `web-${randomUUID()}`;
  await as(people.rep2.id, "aal1", device, "select app.register_device($1, 'android', '[Test] phone')", [device]);
} finally {
  await c.end();
}

writeFileSync(out, JSON.stringify({ password, people }, null, 2));
console.log(`seeded ${Object.keys(people).length} synthetic people into the local stack -> ${out}`);
