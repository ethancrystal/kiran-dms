import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { rupees } from "../lib/money";

// Slice 9 (P1-26; doc 16): the overview pages on a real local stack (migration 20261105180000). Runs
// after office.spec.ts (files run by name, one worker) and touches none of its data: it makes its own
// manager login, territory, salon, warehouse and investor, all synthetic ("[Test]", "[Dummy]",
// example.test). Setup rows are written through the app.* functions as the owner or the new manager
// on the local database, the way scripts/e2e-stack-seed.mjs does; every figure checked on a page is
// read back from the database by that page. Counts are checked as deltas, so earlier specs do not
// matter. CI only: this host has no Docker.

type P = { id: string; email: string; name: string };
const seed = JSON.parse(readFileSync(new URL("./.seed.json", import.meta.url), "utf8")) as {
  password: string;
  people: Record<"owner" | "rep" | "rep2", P>;
  sku: { id: string; code: string; list_price_paisa: number };
};
const DB_URL = process.env.KIRAN_STACK_DB_URL ?? "";
const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const TAG_LENGTH = 8;
const tag = randomUUID().slice(0, TAG_LENGTH);
const password = `e2e-${randomUUID()}`;
const manager: P = { id: randomUUID(), email: `overview-manager.${tag}@example.test`, name: `[Test] Overview manager ${tag}` };
const rep2 = seed.people.rep2;
const territory = { id: randomUUID(), name: `[Test] Overview territory ${tag}` };
const area = randomUUID();
const salon = { id: randomUUID(), name: `[Test] Overview salon ${tag}` };
const warehouse = randomUUID();
const STOCK = 10;
const PHONE_DIGITS = 8;
const ORDER_QTY = 2;
const ORDER_PAISA = ORDER_QTY * seed.sku.list_price_paisa;
const INVESTED_RS = "100000";
const DECIDED_RS = "12000";
const DECIDED_PAISA = 1_200_000;
const ONE = 1;

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s), as office.spec.ts: the new manager enrols on first sign-in.
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
  expect(["127.0.0.1", "localhost"], "the overview stack test runs only on a local database").toContain(new URL(DB_URL).hostname);
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
const MANAGER = { id: manager.id, aal: "aal2" as const };

let secret = "";
let usedStep = -1;
/** A fresh code: one per 30-second step, so a second sign-in waits for the next step. */
async function freshCode() {
  let step = Math.floor(Date.now() / STEP_MS);
  while (step === usedStep) {
    await new Promise((r) => setTimeout(r, WAIT_STEP_MS));
    step = Math.floor(Date.now() / STEP_MS);
  }
  usedStep = step;
  return totp(secret, step);
}
// The pages signed in and signed out: matches "/office/mfa", "/office/login?next=x" and a URL ending
// "/office"; rejects "/office/orders" for the last one.
// https://regex101.com/?regex=%5C%2Foffice%24&flavor=javascript
const MFA_URL = /\/office\/mfa/;
const LOGIN_URL = /\/office\/login/;
const HOME_URL = /\/office$/;
async function signIn(page: Page) {
  await page.goto("/office/login");
  await page.getByLabel("Email").fill(manager.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(MFA_URL);
  const key = page.locator("code");
  const enrol = await key
    .first()
    .waitFor({ timeout: ENROL_WAIT_MS })
    .then(() => true)
    .catch(() => false);
  if (enrol) secret = (await key.first().innerText()).trim();
  await page.getByLabel("6-digit code").fill(await freshCode());
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForURL(HOME_URL);
}

// The manager signs in once (password and TOTP enrolment); later tests reuse the signed-in session, as
// office.spec.ts does with the rep's phone, so no test waits for a fresh 30-second code.
let session: Awaited<ReturnType<BrowserContext["storageState"]>> | null = null;
async function officePage(browser: Browser) {
  const ctx = await browser.newContext(session ? { storageState: session } : {});
  const page = await ctx.newPage();
  if (session) await page.goto("/office");
  else {
    await signIn(page);
    session = await ctx.storageState();
  }
  return page;
}

const num = async (page: Page, testId: string) => Number((await page.getByTestId(testId).innerText()).trim());

// Each test does several database and page round trips on one real stack: more than the 60 s default.
const TEST_TIMEOUT_MS = 120_000;
test.describe.configure({ mode: "serial", timeout: TEST_TIMEOUT_MS });

test.beforeAll(async () => {
  // A manager login with a password (as the seed makes people), then its profile through the owner.
  await sql(
    null,
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change,
       email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
       extensions.crypt($3, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(),
       '', '', '', '', '', '', '', '')`,
    [manager.id, manager.email, password],
  );
  await sql(
    null,
    `insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $3::text, jsonb_build_object('sub', $3::text, 'email', $2::text, 'email_verified', true),
             'email', now(), now(), now())`,
    [manager.id, manager.email, manager.id],
  );
  await sql(OWNER, "select app.owner_create_user($1, $2, 'manager'::public.app_role, $3)", [
    manager.id,
    manager.name,
    `+9200${String(Date.now()).slice(-PHONE_DIGITS)}`,
  ]);
  // Rep Two covers a new territory with one approved salon; a warehouse holds stock to deliver from.
  await sql(MANAGER, "select app.office_upsert_territory($1, $2)", [territory.id, territory.name]);
  await sql(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Overview area')", [area, territory.id]);
  await sql(MANAGER, "select app.office_assign_territory($1, $2)", [rep2.id, territory.id]);
  await sql(MANAGER, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'manual')", [salon.id, salon.name, area]);
  await sql(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Overview store')", [warehouse]);
  await sql(
    null,
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, $2, $3, 'receipt', $4)`,
    [seed.sku.id, STOCK, warehouse, manager.id],
  );
});

// P1-31 (D-49): a delivery is final only with the salon's signed acknowledgement of the goods and the office's approval,
// so a fixture that delivers through SQL records one first. A PNG signature plus zeros: the database checks the bytes and size.
const SIGNATURE_PNG = Buffer.from(`89504e470d0a1a0a${"00".repeat(300)}`, "hex").toString("base64");

test("office home: an order shows as placed and waiting with its rep; once delivered it shows its invoice, and the counts move by one", async ({
  browser,
}) => {
  const page = await officePage(browser);
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  const toDeliver = await num(page, "count-to-deliver");
  const placed = await num(page, "count-placed");

  const orderCid = randomUUID();
  await sql(MANAGER, "select app.office_create_order($1, $2, 'CASH', $3::jsonb, $4)", [
    orderCid,
    salon.id,
    JSON.stringify([{ sku_id: seed.sku.id, qty: ORDER_QTY }]),
    rep2.id,
  ]);
  await page.reload();
  await expect(page.getByTestId("count-to-deliver")).toHaveText(String(toDeliver + ONE));
  await expect(page.getByTestId("count-placed")).toHaveText(String(placed + ONE));
  const placedRow = page.getByTestId("placed-row").filter({ hasText: salon.name });
  await expect(placedRow).toContainText(`Office ${manager.name}`);
  await expect(placedRow).toContainText(rupees(ORDER_PAISA));
  await expect(placedRow).toContainText("Waiting to be delivered");
  const waitingRow = page.getByTestId("waiting-row").filter({ hasText: salon.name });
  await expect(waitingRow).toContainText(`Rep ${rep2.name}`);
  await expect(waitingRow).toContainText("since today");
  await expect(waitingRow).toContainText("The rep delivers it");

  // The office delivers it from the warehouse: it leaves "Waiting" and shows in "Delivered" with its invoice.
  await sql(
    MANAGER,
    "select app.office_attach_signature($1, (select id from public.sales_order where client_id = $2), null, 'signed', 'Ayesha Khan', 'Owner', $3, null)",
    [randomUUID(), orderCid, SIGNATURE_PNG],
  );
  const invoice = await sql(
    MANAGER,
    "select (app.office_deliver($1, (select id from public.sales_order where client_id = $2), $3, 'Ayesha at the counter')).number n",
    [randomUUID(), orderCid, warehouse],
  );
  await page.reload();
  await expect(page.getByTestId("count-to-deliver")).toHaveText(String(toDeliver));
  await expect(page.getByTestId("waiting-row").filter({ hasText: salon.name })).toHaveCount(0);
  const deliveredRow = page.getByTestId("delivered-row").filter({ hasText: invoice[0].n as string });
  await expect(deliveredRow).toContainText(salon.name);
  await expect(deliveredRow).toContainText(rupees(ORDER_PAISA));
  await expect(deliveredRow).toContainText(`Office ${manager.name}`);
  // The old tiles stay at the bottom.
  await expect(page.getByText("phones waiting for approval")).toBeVisible();
});

test("rep performance: Rep Two's order of this month is counted as brought and delivered", async ({ browser }) => {
  const page = await officePage(browser);
  await page.getByRole("navigation", { name: "Office" }).getByRole("link", { name: "Rep performance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Rep performance", level: 1 })).toBeVisible();
  const row = page.getByTestId("rep-month-row").filter({ hasText: rep2.name });
  await expect(row).toBeVisible();
  // Brought at least the order above, worth its amount among others; delivered at least one.
  const cells = row.getByRole("cell");
  expect(Number((await cells.nth(1).innerText()).split(" ")[0])).toBeGreaterThanOrEqual(ONE);
  expect(Number(await cells.nth(2).innerText())).toBeGreaterThanOrEqual(ONE);
  // The previous month has nothing from this run; Next goes back to this month.
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByRole("button", { name: "Next month" })).toBeEnabled();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByRole("button", { name: "Next month" })).toBeDisabled();
});

test("investors: a new investor with nothing decided says so; deciding fills the month; the previous month stays empty", async ({
  browser,
}) => {
  const page = await officePage(browser);
  await page.getByRole("navigation", { name: "Office" }).getByRole("link", { name: "Investors", exact: true }).click();
  const name = `[Dummy] Overview investor ${tag}`;
  const add = page.getByRole("form", { name: "Add an investor" });
  await add.getByLabel("Name").fill(name);
  await add.getByRole("button", { name: "Add investor" }).click();
  await expect(page.getByText(`Investor ${name} added.`)).toBeVisible();
  await expect(page.getByTestId("investor-month-line").filter({ hasText: name })).toContainText("nothing decided yet");
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();

  const invest = page.getByRole("form", { name: "Add an investment" });
  await invest.getByLabel("Amount (Rs)").fill(INVESTED_RS);
  await invest.getByRole("button", { name: "Record investment" }).click();
  await expect(page.getByTestId("month-one-decided")).toHaveText("Nothing decided yet for this month.");
  await page.getByRole("link", { name: "Decide profit for", exact: false }).click();
  const decide = page.getByRole("form", { name: "Decide profit" });
  await decide.getByLabel("Amount (Rs)").fill(DECIDED_RS);
  await decide.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText(`Profit of ${rupees(DECIDED_PAISA)} decided.`)).toBeVisible();
  await expect(page.getByTestId("month-one-decided")).toHaveText(rupees(DECIDED_PAISA));
  await expect(page.getByTestId("month-one-owed")).toHaveText(rupees(DECIDED_PAISA));
  // Survives a reload: the database answers the same.
  await page.reload();
  await expect(page.getByTestId("month-one-decided")).toHaveText(rupees(DECIDED_PAISA));
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByTestId("month-one-decided")).toHaveText("Nothing decided yet for this month.");
  // Still owed is over all months, so it does not change with the month.
  await expect(page.getByTestId("month-one-owed")).toHaveText(rupees(DECIDED_PAISA));
});

test("the overview reads refuse a rep, a signed-out visitor and an office session without the second step", async ({
  browser,
}) => {
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("/office/reps");
  await expect(visitor).toHaveURL(LOGIN_URL);

  // Real sessions from the auth server (password grant): Rep Two at AAL1, the new manager at AAL1.
  const grant = async (email: string, pw: string) => {
    const r = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email, password: pw }),
    });
    return ((await r.json()) as { access_token?: string }).access_token ?? "";
  };
  const call = (token: string | null, fn: string, args: Record<string, unknown> = {}) =>
    fetch(`${API_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        "content-type": "application/json",
        "content-profile": "app",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(args),
    });
  const repToken = await grant(rep2.email, seed.password);
  const managerAal1 = await grant(manager.email, password);
  expect(repToken).toBeTruthy();
  expect(managerAal1).toBeTruthy();
  const month = { p_month: new Date().toISOString().slice(0, "YYYY-MM-DD".length) };
  const refused = await Promise.all([
    call(null, "office_overview_counts"),
    call(repToken, "office_overview_counts"),
    call(repToken, "office_rep_month", month),
    call(repToken, "office_investor_month", month),
    call(managerAal1, "office_overview_rows"),
    call(managerAal1, "office_investor_month", month),
    // A rep without its approved phone (no device header) is refused its own month too.
    call(repToken, "my_month_orders", month),
  ]);
  expect(refused.map((r) => r.ok)).toEqual(refused.map(() => false));
});
