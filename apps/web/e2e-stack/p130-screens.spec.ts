import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import pg from "pg";

// P1-30 part 2 (the wiring audit's screens package) on a real local stack. Runs last (files run by name,
// one worker) and touches no earlier spec's data: it makes its own owner and manager logins, territory,
// salon, rep and bag, all synthetic ("[Test]", example.test). Setup rows are written through app.*
// functions, or as postgres where a test needs a state no screen makes (a rep day left open from an
// earlier date). Every result checked on a page is the database's. CI only: this host has no Docker.
// It changes no threshold: the settings journey changes only the company's printed city, and restores it.
// The journeys after the settings one cover part 1's decisions (D-45 to D-48, added after review): the
// owner's opening stock, the handover settlement and withdrawal, the payment reversal and the cash cap.

type P = { id: string; email: string; name: string };
const seed = JSON.parse(readFileSync(new URL("./.seed.json", import.meta.url), "utf8")) as {
  password: string;
  people: Record<"owner" | "rep" | "rep2", P>;
  sku: { id: string; code: string; list_price_paisa: number };
};
const DB_URL = process.env.KIRAN_STACK_DB_URL ?? "";
const TAG_LENGTH = 8;
const tag = randomUUID().slice(0, TAG_LENGTH);
const password = `e2e-${randomUUID()}`;
const owner2: P = { id: randomUUID(), email: `p130-owner.${tag}@example.test`, name: `[Test] P130 owner ${tag}` };
const manager: P = { id: randomUUID(), email: `p130-manager.${tag}@example.test`, name: `[Test] P130 manager ${tag}` };
const rep: P = { id: randomUUID(), email: `p130-rep.${tag}@example.test`, name: `[Test] P130 rep ${tag}` };
const territory = { id: randomUUID(), name: `[Test] P130 territory ${tag}` };
const area = { id: randomUUID(), name: `[Test] P130 area ${tag}` };
const salon = { id: randomUUID(), name: `[Test] P130 salon ${tag}` };
const bag = { id: randomUUID(), name: `[Test] P130 bag ${tag}` };
const PHONE_DIGITS = 8;
const LIMIT_RS = "25000";
const RAISED_RS = "30000";
const BAG_RS = "40000";

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s), as office.spec.ts and overviews.spec.ts.
const STEP_MS = 30_000;
const DIGITS = 1_000_000;
const CODE_LENGTH = 6;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BITS_PER_CHAR = 5;
const BYTE = 8;
const LOW_NIBBLE = 0xf;
const NO_SIGN = 0x7fffffff;
const BINARY = 2;
const ENROL_WAIT_MS = 10_000;
const WAIT_STEP_MS = 1_000;
function totp(secret: string, step: number) {
  // Base32 padding at the end: matches the "==" of "JBSWY3DP==", leaves "JBSW=Y3DP" alone.
  // https://regex101.com/?regex=%3D%2B%24&flavor=javascript
  const bits = [...secret.replace(/=+$/, "").toUpperCase()]
    .map((ch) => BASE32.indexOf(ch).toString(BINARY).padStart(BITS_PER_CHAR, "0"))
    .join("");
  const bytes = Array.from({ length: Math.floor(bits.length / BYTE) }, (_, i) =>
    Number.parseInt(bits.slice(i * BYTE, i * BYTE + BYTE), BINARY),
  );
  const counter = Buffer.alloc(BYTE);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const o = h[h.length - 1] & LOW_NIBBLE;
  return ((h.readUInt32BE(o) & NO_SIGN) % DIGITS).toString().padStart(CODE_LENGTH, "0");
}

/** Runs one statement on the local database as a signed-in person (or as postgres with `as` null). */
async function sql(as: { id: string; aal: "aal1" | "aal2" } | null, text: string, params: unknown[] = []) {
  expect(["127.0.0.1", "localhost"], "this stack test runs only on a local database").toContain(new URL(DB_URL).hostname);
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  try {
    await c.query("begin");
    if (as) {
      await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.headers', '{}', true)", [
        JSON.stringify({ sub: as.id, role: "authenticated", aal: as.aal }),
      ]);
      await c.query("set local role authenticated");
    }
    const r = await c.query(text, params);
    await c.query("commit");
    return r.rows;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    await c.end();
  }
}
const OWNER = { id: seed.people.owner.id, aal: "aal2" as const };

/** As sql(), for the rep on its approved phone: the device id goes in the header PostgREST would pass. */
async function repSql(device: string, text: string, params: unknown[] = []) {
  expect(["127.0.0.1", "localhost"], "this stack test runs only on a local database").toContain(new URL(DB_URL).hostname);
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)", [
      JSON.stringify({ sub: rep.id, role: "authenticated", aal: "aal1" }),
      JSON.stringify({ "x-kiran-device": device }),
    ]);
    await c.query("set local role authenticated");
    const r = await c.query(text, params);
    await c.query("commit");
    return r.rows;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    await c.end();
  }
}

/** A password login, as the seed and overviews.spec.ts make them. */
async function makeLogin(p: P) {
  await sql(
    null,
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change,
       email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
       extensions.crypt($3, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(),
       '', '', '', '', '', '', '', '')`,
    [p.id, p.email, password],
  );
  await sql(
    null,
    `insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $3::text, jsonb_build_object('sub', $3::text, 'email', $2::text, 'email_verified', true),
             'email', now(), now(), now())`,
    [p.id, p.email, p.id],
  );
}

const secrets = new Map<string, string>();
const usedSteps = new Map<string, number>();
/** A fresh code for this person: one per 30-second step. */
async function freshCode(p: P): Promise<string> {
  const step = Math.floor(Date.now() / STEP_MS);
  if (step === usedSteps.get(p.email)) {
    await new Promise((r) => setTimeout(r, WAIT_STEP_MS));
    return freshCode(p);
  }
  usedSteps.set(p.email, step);
  return totp(secrets.get(p.email) ?? "", step);
}
// A URL ending "/office": matches "http://x/office"; rejects "/office/orders" and "/office/mfa".
// https://regex101.com/?regex=%5C%2Foffice%24&flavor=javascript
const HOME_URL = /\/office$/;
const H2 = 2; // the section headings of a page
// The owner's notice after saving credit: matches "Credit set: Up to 2 installments, limit Rs 25,000."; rejects
// "Credit set: Cash only".
// https://regex101.com/?regex=Credit+set%3A+Up+to+2+installments&flavor=javascript
const CREDIT_SET = /Credit set: Up to 2 installments/;
// The home's open-day line, across the line break of the page source: matches "still open, so those reps cannot
// check in"; rejects "still open. Those reps".
// https://regex101.com/?regex=still+open%2C+so+those%5Cs%2Breps+cannot+check+in&flavor=javascript
const DAYS_OPEN = /still open, so those\s+reps cannot check in/;
// The notice after a force close: matches "Rep's day of 15 Jan is closed. They can check in now."; rejects "is closed.".
// https://regex101.com/?regex=is+closed%5C.+They+can+check+in+now%5C.&flavor=javascript
const DAY_CLOSED = /is closed\. They can check in now\./;
// The Team page's link: matches "Company settings: name, bank accounts and limits"; rejects "Settings".
// https://regex101.com/?regex=Company+settings&flavor=javascript
const SETTINGS_LINK = /Company settings/;
// The TOTP step: matches "/office/mfa" anywhere in the URL; rejects "/office/login".
// https://regex101.com/?regex=%5C%2Foffice%5C%2Fmfa&flavor=javascript
const MFA_URL = /\/office\/mfa/;
async function signIn(page: Page, p: P) {
  await page.goto("/office/login");
  await page.getByLabel("Email").fill(p.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(MFA_URL);
  const key = page.locator("code");
  const enrol = await key
    .first()
    .waitFor({ timeout: ENROL_WAIT_MS })
    .then(() => true)
    .catch(() => false);
  if (enrol) secrets.set(p.email, (await key.first().innerText()).trim());
  await page.getByLabel("6-digit code").fill(await freshCode(p));
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForURL(HOME_URL);
}

// Each person signs in once; later tests reuse the session, so no test waits for a fresh code.
const sessions = new Map<string, Awaited<ReturnType<BrowserContext["storageState"]>>>();
async function officePage(browser: Browser, p: P) {
  const saved = sessions.get(p.email);
  const ctx = await browser.newContext(saved ? { storageState: saved } : {});
  const page = await ctx.newPage();
  if (saved) await page.goto("/office");
  else {
    await signIn(page, p);
    sessions.set(p.email, await ctx.storageState());
  }
  return page;
}

const TEST_TIMEOUT_MS = 120_000;
test.describe.configure({ mode: "serial", timeout: TEST_TIMEOUT_MS });

test.beforeAll(async () => {
  await makeLogin(owner2);
  await makeLogin(manager);
  await makeLogin(rep);
  const phone = () => `+9200${String(Date.now()).slice(-PHONE_DIGITS)}`;
  // A second owner for this file only: the seeded owner's authenticator secret belongs to office.spec.ts.
  await sql(OWNER, "select app.owner_create_user($1, $2, 'owner'::public.app_role, $3)", [owner2.id, owner2.name, phone()]);
  await sql(OWNER, "select app.owner_create_user($1, $2, 'manager'::public.app_role, $3)", [manager.id, manager.name, phone()]);
  await sql(OWNER, "select app.owner_create_user($1, $2, 'rep'::public.app_role, $3)", [rep.id, rep.name, phone()]);
  const M = { id: manager.id, aal: "aal2" as const };
  await sql(M, "select app.office_upsert_territory($1, $2)", [territory.id, territory.name]);
  await sql(M, "select app.office_upsert_area($1, $2, $3)", [area.id, territory.id, area.name]);
  await sql(M, "select app.office_assign_territory($1, $2)", [rep.id, territory.id]);
  await sql(M, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'manual')", [salon.id, salon.name, area.id]);
  await sql(OWNER, "select app.office_create_location($1, 'rep_bag', $2, $3, 1000000)", [bag.id, bag.name, rep.id]);
});

test("salon credit: the owner sets a plan and limit and blocks and unblocks; the manager raises the limit within the rules (H3, FLOW-02, FLOW-17)", async ({
  browser,
}) => {
  const page = await officePage(browser, owner2);
  await page.goto(`/office/salons/${salon.id}`);
  const credit = page.locator("section", { has: page.getByRole("heading", { name: "Credit", exact: true, level: H2 }) });
  await expect(credit.getByTestId("credit-limit")).toHaveText("Not set yet");
  await credit.getByLabel("Plan the salon may use").selectOption("INST2");
  await credit.getByLabel("Credit limit to set (Rs)").fill(LIMIT_RS);
  await credit.getByLabel("Why this plan and limit").fill("p130: a steady customer for a year");
  await credit.getByRole("button", { name: "Save plan and limit" }).click();
  await expect(credit.getByText(CREDIT_SET)).toBeVisible();
  await expect(credit.getByTestId("credit-plan")).toHaveText("Up to 2 installments");
  await expect(credit.getByTestId("credit-limit")).toHaveText("Rs 25,000");

  await credit.getByRole("button", { name: "Block credit" }).click();
  await credit.getByLabel("Why block credit").fill("p130: two cheques bounced");
  await credit.getByRole("button", { name: "Block now" }).click();
  await expect(credit.getByTestId("credit-block")).toHaveText("Blocked");
  await credit.getByRole("button", { name: "Unblock credit" }).click();
  await credit.getByLabel("Why unblock credit").fill("p130: the cheques cleared");
  await credit.getByRole("button", { name: "Unblock now" }).click();
  await expect(credit.getByTestId("credit-block")).toHaveText("Not blocked");
  await expect(credit.getByTestId("credit-history")).toContainText("Unblocked");
  const [row] = await sql(
    null,
    "select plan_eligibility::text p, credit_limit_paisa::bigint l, blocked from public.salon_credit where salon_id = $1",
    [salon.id],
  );
  expect(row).toEqual({ p: "INST2", l: "2500000", blocked: false });

  // The manager sees the status and the raise form, not the owner's form.
  const m = await officePage(browser, manager);
  await m.goto(`/office/salons/${salon.id}`);
  const mc = m.locator("section", { has: m.getByRole("heading", { name: "Credit", exact: true, level: H2 }) });
  await expect(mc.getByLabel("Plan the salon may use")).toHaveCount(0);
  await expect(mc.getByTestId("credit-manager-rules")).toBeVisible();
  await mc.getByLabel("Raised limit (Rs)").fill(RAISED_RS);
  await mc.getByLabel("Why raise the limit").fill("p130: busy wedding season");
  await mc.getByRole("button", { name: "Raise limit" }).click();
  await expect(mc.getByTestId("credit-limit")).toHaveText("Rs 30,000");
});

test("primary contact and a salon added by the office (FLOW-16, M3, M11)", async ({ browser }) => {
  const page = await officePage(browser, manager);
  await page.goto(`/office/salons/${salon.id}`);
  await expect(page.getByTestId("primary-contact")).toHaveText("No phone recorded.");
  await page.getByRole("button", { name: "Add contact" }).click();
  await page.getByLabel("Contact person's name").fill("[Test] Salon owner");
  await page.getByLabel("Contact phone").fill("03000000130");
  await page.getByLabel("Why change the contact").fill("p130: the salon gave its number");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Primary contact saved.")).toBeVisible();
  await expect(page.getByTestId("primary-contact")).toHaveText("[Test] Salon owner · 03000000130");

  const added = `[Test] P130 added ${tag}`;
  await page.goto("/office/salons");
  await page.getByRole("button", { name: "Add a salon" }).click();
  await page.getByLabel("New salon's name").fill(added);
  await page.getByLabel("New salon's area").selectOption({ label: `${territory.name} · ${area.name}` });
  await page.getByRole("button", { name: "Add salon" }).click();
  await expect(page.getByRole("heading", { name: added, level: 1 })).toBeVisible();
  const [made] = await sql(null, "select approval_status::text a, source::text s from public.salon where name = $1", [added]);
  expect(made).toEqual({ a: "approved", s: "manual" });
});

test("a rep day left open from an earlier date shows on the office home and the office closes it with a reason (REP-01, FLOW-04)", async ({
  browser,
}) => {
  const old = "2020-01-15";
  await sql(null, "insert into public.rep_day (rep_id, day) values ($1, $2)", [rep.id, old]);
  const page = await officePage(browser, manager);
  await page.goto("/office");
  await expect(page.getByText(DAYS_OPEN)).toBeVisible();
  const row = page.getByTestId("open-rep-day").filter({ hasText: rep.name });
  await expect(row).toContainText("15 Jan");
  await row.getByRole("button", { name: "Close this day" }).click();
  await row.getByLabel("Why close the rep's day").fill("p130: forgot to check out");
  await row.getByRole("button", { name: "Close the day now" }).click();
  await expect(page.getByText(DAY_CLOSED)).toBeVisible();
  await expect(page.getByTestId("open-rep-day").filter({ hasText: rep.name })).toHaveCount(0);
  const [day] = await sql(
    null,
    "select status::text s, close_reason r, closed_by from public.rep_day where rep_id = $1 and day = $2",
    [rep.id, old],
  );
  expect(day).toEqual({ s: "force_closed", r: "p130: forgot to check out", closed_by: manager.id });
});

test("the owner changes a bag's value limit; settings are owner only (M9, FLOW-14)", async ({ browser }) => {
  const page = await officePage(browser, owner2);
  await page.goto("/office/stock");
  const row = page.getByTestId("stock-location").filter({ hasText: bag.name });
  await row.getByRole("button", { name: "Change limit" }).click();
  const form = page.getByRole("form", { name: `Change the value limit of ${bag.name}` });
  await form.getByLabel("New value limit (Rs)").fill(BAG_RS);
  await form.getByLabel("Why change the limit").fill("p130: a bigger route");
  await form.getByRole("button", { name: "Save limit" }).click();
  await expect(page.getByText(`The value limit of ${bag.name} is now Rs 40,000.`)).toBeVisible();

  // Settings: the owner changes the printed city and puts it back; every field stays as it was.
  const [before] = await sql(null, "select value from public.app_config where key = 'company.profile'");
  await page.goto("/office/team");
  await page.getByRole("link", { name: SETTINGS_LINK }).click();
  const details = page.getByRole("form", { name: "Company details" });
  const city = details.getByLabel("Company city");
  await city.fill(`[Test] City ${tag}`);
  await details.getByLabel("Why change it").fill("p130: test the settings page");
  await details.getByRole("button", { name: "Save company details" }).click();
  await expect(page.getByText("Company details saved.")).toBeVisible();
  const [after] = await sql(null, "select value from public.app_config where key = 'company.profile'");
  expect(after.value).toEqual({ ...before.value, city: `[Test] City ${tag}` });
  // The page re-reads its settings after a save; reload so the form is settled before typing into it again.
  await page.reload();
  const restore = page.getByRole("form", { name: "Company details" });
  await expect(restore.getByLabel("Company city")).toHaveValue(`[Test] City ${tag}`);
  await restore.getByLabel("Company city").fill(String(before.value.city));
  await restore.getByLabel("Why change it").fill("p130: put the city back");
  await restore.getByRole("button", { name: "Save company details" }).click();
  await expect(page.getByText("Company details saved.")).toBeVisible();
  // The notice was already on screen, so the database is the proof that the restore was saved.
  await expect
    .poll(async () => (await sql(null, "select value from public.app_config where key = 'company.profile'"))[0].value)
    .toEqual(before.value);

  const m = await officePage(browser, manager);
  await m.goto("/office/settings");
  await expect(m.getByText("Only the owner changes settings.")).toBeVisible();
  await expect(m.getByRole("form", { name: "Company details" })).toHaveCount(0);
});

// ------------------------------------------------------------------ part 1 decisions (review of P1-30) ----
const store = { id: randomUUID(), name: `[Test] P130 store ${tag}` };
const repPhone = `p130-phone-${tag}-0000`;
const ORDER_UNITS = 3; // Rs 4,500 at the seed's Rs 1,500 list price: room for four Rs 1,000 payments
const STOCK_UNITS = 100;
const OPENING_UNITS = "7";
const RS_1000 = 100_000; // paisa
const SHORT_100 = 90_000;
const SHORT_50 = 95_000;
const M = () => ({ id: manager.id, aal: "aal2" as const });
// The owner's notice after opening stock: matches "Opening stock added: 7 units, on the record with your reason."
// https://regex101.com/?regex=Opening+stock+added%3A+7+units&flavor=javascript
const OPENING_ADDED = /Opening stock added: 7 units/;
// The database's refusal of a manager's own count: matches "a manager cannot withdraw a count they made; the
// owner can"; rejects "the rep has answered this handover".
// https://regex101.com/?regex=cannot+withdraw+a+count+they+made&flavor=javascript
const OWN_COUNT = /cannot withdraw a count they made/;
// The database's refusal of a manager's own payment: matches "a manager cannot reverse a payment they recorded;
// the owner can (D-48)"; rejects "this payment is already reversed".
// https://regex101.com/?regex=cannot+reverse+a+payment+they+recorded&flavor=javascript
const OWN_PAYMENT = /cannot reverse a payment they recorded/;
// The owner's notice: matches "Receipt RCP-27-000001 reversed. The salon owes Rs 1,000 again."; rejects
// "Receipt RCP-27-000001 reversed".
// https://regex101.com/?regex=reversed%5C.+The+salon+owes&flavor=javascript
const REVERSED = /reversed\. The salon owes/;
// The cap refusal: matches "cash limit reached: you hold Rs 50,000.00"; rejects "cash limit is Rs 50,000".
// https://regex101.com/?regex=cash+limit+reached&flavor=javascript
const CAP_REACHED = /cash limit reached/;

const handoverRow = (page: Page, status: string) =>
  page.getByRole("row").filter({ hasText: rep.name }).filter({ hasText: status }).first();
/** The rep collects Rs 1,000 cash from the salon on its approved phone. */
const collect = () =>
  repSql(repPhone, "select (app.rep_record_payment($1, $2, 'cash', $3, 24.9, 67.1)).number n", [randomUUID(), salon.id, RS_1000]);
/** The manager counts the rep's cash (the database fixes the expected figure); returns the handover id. */
async function count(counted: number, why: string | null) {
  const [h] = await sql(M(), "select (app.office_count_handover($1, $2, $3, $4)).id", [randomUUID(), rep.id, counted, why]);
  return h.id as string;
}
const dispute = (hid: string) =>
  repSql(repPhone, "select app.rep_respond_handover($1, $2, false, 'I handed over the full amount')", [randomUUID(), hid]);
const settlement = async (hid: string) =>
  (await sql(null, "select outcome, settled_by from public.handover_settlement where handover_id = $1", [hid]))[0];

test("the owner adds opening stock at once, with a reason on the record (D-45)", async ({ browser }) => {
  await sql(M(), "select app.office_create_location($1, 'warehouse', $2)", [store.id, store.name]);
  const page = await officePage(browser, owner2);
  await page.goto("/office/stock");
  const form = page.getByRole("form", { name: "Add opening stock" });
  await form.getByLabel("Warehouse for the opening stock").selectOption({ label: store.name });
  await form.getByLabel("SKU for the opening stock").selectOption(seed.sku.id);
  await form.getByLabel("Units counted in").fill(OPENING_UNITS);
  await form.getByLabel("Why (kept on the record)").fill("p130: opening count of the new store");
  await form.getByRole("button", { name: "Add to stock" }).click();
  await expect(page.getByText(OPENING_ADDED)).toBeVisible();
  const [row] = await sql(
    null,
    `select a.qty_delta, a.owner_id, a.reason, m.approval_id is null as no_approval
       from public.owner_stock_adjustment a
       join public.stock_movement m on m.source_type = 'owner_stock_adjustment' and m.source_id = a.id
      where a.location_id = $1`,
    [store.id],
  );
  expect(row).toEqual({
    qty_delta: Number(OPENING_UNITS),
    owner_id: owner2.id,
    reason: "p130: opening count of the new store",
    no_approval: true,
  });
});

test("cash handovers: the owner settles disputes at either amount; the manager cannot withdraw their own count, the owner can (D-46)", async ({
  browser,
}) => {
  // Stock to deliver, the rep's approved phone and open day, and a delivered cash order the salon owes for.
  await sql(
    null,
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, $2, $3, 'receipt', $4)`,
    [seed.sku.id, STOCK_UNITS, store.id, manager.id],
  );
  await repSql(repPhone, "select app.register_device($1, 'web', 'p130 phone')", [repPhone]);
  await sql(
    M(),
    "select app.approve_device((select d.id from public.device d where d.user_id = $1 order by d.created_at desc limit 1), 'p130 phone')",
    [rep.id],
  );
  await sql(
    null,
    "insert into public.rep_day (rep_id, day) values ($1, (now() at time zone 'Asia/Karachi')::date) on conflict do nothing",
    [rep.id],
  );
  const orderCid = randomUUID();
  await sql(M(), "select app.office_create_order($1, $2, 'CASH', $3::jsonb, $4)", [
    orderCid,
    salon.id,
    JSON.stringify([{ sku_id: seed.sku.id, qty: ORDER_UNITS }]),
    rep.id,
  ]);
  // D-49: a delivery is final only with the salon's signed acknowledgement, so the fixture records one first.
  await sql(
    M(),
    "select app.office_attach_signature($1, (select id from public.sales_order where client_id = $2), null, 'signed', 'Ayesha Khan', 'Owner', $3, null)",
    [randomUUID(), orderCid, Buffer.from(`89504e470d0a1a0a${"00".repeat(300)}`, "hex").toString("base64")],
  );
  await sql(M(), "select app.office_deliver($1, (select id from public.sales_order where client_id = $2), $3, 'p130 counter')", [
    randomUUID(),
    orderCid,
    store.id,
  ]);

  // 1. Counted Rs 100 short and disputed. The manager is told only the owner settles; the owner keeps the count.
  await collect();
  const first = await count(SHORT_100, "p130: counted short at the desk");
  await dispute(first);
  const m = await officePage(browser, manager);
  await m.goto("/office/handovers");
  await expect(handoverRow(m, "Disputed").getByText("Only the owner settles a dispute.")).toBeVisible();
  const page = await officePage(browser, owner2);
  await page.goto("/office/handovers");
  const disputed = handoverRow(page, "Disputed");
  await disputed.getByRole("button", { name: "Keep the counted Rs 900 (the rep is short Rs 100)" }).click();
  await disputed.getByLabel("Why (kept on the record)").fill("p130: the till roll shows Rs 900");
  await disputed.getByRole("button", { name: "Settle at the counted Rs 900" }).click();
  await expect(page.getByText(`Settled ${rep.name}'s handover.`)).toBeVisible();
  expect(await settlement(first)).toEqual({ outcome: "counted", settled_by: owner2.id });

  // 2. Counted Rs 50 short and disputed; the owner accepts the rep's amount, so the office absorbs it.
  await collect();
  const second = await count(SHORT_50, "p130: counted short again");
  await dispute(second);
  await page.reload();
  const again = handoverRow(page, "Disputed");
  await again.getByRole("button", { name: "Accept the rep's Rs 1,000 (the office absorbs Rs 50)" }).click();
  await again.getByLabel("Why (kept on the record)").fill("p130: a note was stuck in the bag");
  await again.getByRole("button", { name: "Settle at the rep's Rs 1,000" }).click();
  await expect(page.getByText(`Settled ${rep.name}'s handover.`)).toBeVisible();
  expect(await settlement(second)).toEqual({ outcome: "rep", settled_by: owner2.id });

  // 3. An unanswered count: the manager who made it is refused in the database's words; the owner withdraws it.
  await collect();
  const third = await count(RS_1000, null);
  await m.reload();
  const waitingM = handoverRow(m, "Waiting for the rep");
  await waitingM.getByRole("button", { name: "Withdraw this count" }).click();
  await waitingM.getByLabel("Why it is withdrawn").fill("p130: the rep lost the phone");
  await waitingM.getByRole("button", { name: "Withdraw the count" }).click();
  await expect(waitingM.getByText(OWN_COUNT)).toBeVisible();
  await page.reload();
  const waiting = handoverRow(page, "Waiting for the rep");
  await waiting.getByRole("button", { name: "Withdraw this count" }).click();
  await waiting.getByLabel("Why it is withdrawn").fill("p130: the rep lost the phone");
  await waiting.getByRole("button", { name: "Withdraw the count" }).click();
  await expect(page.getByText(`Withdrew the count for ${rep.name}; nothing moved.`)).toBeVisible();
  expect(await settlement(third)).toEqual({ outcome: "withdrawn", settled_by: owner2.id });
  // Survives a reload: the row reads withdrawn from the database.
  await page.reload();
  await expect(handoverRow(page, "Withdrawn")).toBeVisible();
});

test("payment reversal: the manager cannot reverse a payment they recorded; the owner can, and the receipt shows it (D-48)", async ({
  browser,
}) => {
  const [receipt] = await sql(M(), "select (app.office_record_cash($1, $2, $3)).number n", [randomUUID(), salon.id, RS_1000]);
  const number = String(receipt.n);
  const m = await officePage(browser, manager);
  await m.goto(`/office/salons/${salon.id}`);
  const mine = m.getByTestId("salon-payment").filter({ hasText: number });
  await expect(mine).toBeVisible();
  // The page hides Reverse when the database says the caller may not, and the database refuses it anyway.
  await expect(mine.getByRole("button", { name: "Reverse" })).toHaveCount(0);
  await expect(
    sql(M(), "select app.office_reverse_payment($1, (select r.payment_id from public.receipt r where r.number = $2), $3)", [
      randomUUID(),
      number,
      "p130: recorded by mistake",
    ]),
  ).rejects.toThrow(OWN_PAYMENT);

  const page = await officePage(browser, owner2);
  await page.goto(`/office/salons/${salon.id}`);
  const row = page.getByTestId("salon-payment").filter({ hasText: number });
  await row.getByRole("button", { name: "Reverse" }).click();
  await row.getByLabel("Why it is reversed").fill("p130: recorded against the wrong salon");
  await row.getByRole("button", { name: `Reverse receipt ${number}` }).click();
  await expect(page.getByText(REVERSED)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("salon-payment").filter({ hasText: number })).toContainText("Reversed");
  const [rev] = await sql(
    null,
    `select x.reversed_by, x.cash_holder from public.payment_reversal x
       join public.receipt r on r.payment_id = x.payment_id where r.number = $1`,
    [number],
  );
  expect(rev).toEqual({ reversed_by: owner2.id, cash_holder: "office" });
});

test("a rep at the cash limit is refused more cash and shows on the office home (D-47)", async ({ browser }) => {
  // The rep's ledger is brought to the configured limit as postgres: collecting Rs 50,000 through salons is
  // more setup than this check needs, and the limit itself is not changed.
  const [cap] = await sql(null, "select (value #>> '{}')::bigint v from public.app_config where key = 'cash.intraday_cap_paisa'");
  const [held] = await sql(
    null,
    `select coalesce(sum(case direction when 'in' then amount_paisa else -amount_paisa end), 0)::bigint v
       from public.cash_ledger_entry where holder_type = 'rep' and holder_id = $1`,
    [rep.id],
  );
  const missing = BigInt(String(cap.v)) - BigInt(String(held.v));
  if (missing > BigInt(0)) {
    await sql(
      null,
      `insert into public.cash_ledger_entry (holder_type, holder_id, direction, amount_paisa, source_type, source_id)
       values ('rep', $1, 'in', $2, 'payment', gen_random_uuid())`,
      [rep.id, missing.toString()],
    );
  }
  await expect(
    repSql(repPhone, "select app.rep_record_payment($1, $2, 'cash', 100, 24.9, 67.1)", [randomUUID(), salon.id]),
  ).rejects.toThrow(CAP_REACHED);
  const page = await officePage(browser, manager);
  await page.goto("/office");
  await expect(page.getByTestId("cash-cap-rep").filter({ hasText: rep.name })).toBeVisible();
});
