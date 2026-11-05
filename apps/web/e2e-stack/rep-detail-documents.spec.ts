import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { rupees } from "../lib/money";

// Slice 10 (P1-28; frontend plan sections 4, 6, F6): the grouped sidebar, the Rep-detail page and the
// invoice and receipt views on a real local stack (migration 20261105190000). Runs after overviews.spec.ts
// (files run by name, one worker) and touches none of its data: it makes its own manager login, territory,
// salon and warehouse, all synthetic ("[Test]", "[Dummy]", example.test). Setup rows are written through
// the app.* functions on the local database, as scripts/e2e-stack-seed.mjs does; every figure checked on a
// page is read back from the database by that page. CI only: this host has no Docker.

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
const manager: P = { id: randomUUID(), email: `detail-manager.${tag}@example.test`, name: `[Test] Detail manager ${tag}` };
const rep2 = seed.people.rep2;
// The phone scripts/e2e-stack-seed.mjs gives Rep Two: synthetic, and never shown unmasked on the page.
const REP2_PHONE = "+920000000103";
const territory = { id: randomUUID(), name: `[Test] Detail territory ${tag}` };
const area = randomUUID();
const salon = { id: randomUUID(), name: `[Test] Detail salon ${tag}` };
const warehouse = randomUUID();
const STOCK = 10;
const PHONE_DIGITS = 8;
const PAID_RS = 100;
const PAISA_PER_RUPEE = 100;
const ORDER_PAISA = seed.sku.list_price_paisa;
const LINE = JSON.stringify([{ sku_id: seed.sku.id, qty: 1 }]);
const PROOF = "The system receipt is the only valid proof of payment.";
// Any Arabic-script letter, so an Urdu word on a document is caught (D-42, doc 08). "حساب" matches; "Rs 100" does not.
// https://regex101.com/?regex=%5B%5Cu0600-%5Cu06FF%5D&flavor=javascript
const ARABIC_SCRIPT = /[؀-ۿ]/;

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
const TABLET_WIDTH = 768;
const TABLET_HEIGHT = 1024;
const TABLET = { width: TABLET_WIDTH, height: TABLET_HEIGHT };
const TWO_ORDERS = 2;
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
const MANAGER = { id: manager.id, aal: "aal2" as const };

// The second-step page: matches "/office/mfa"; rejects "/office/login".
// https://regex101.com/?regex=%5C%2Foffice%5C%2Fmfa&flavor=javascript
const MFA_URL = /\/office\/mfa/;
// The sign-in page: matches "/office/login?next=x"; rejects "/office/mfa".
// https://regex101.com/?regex=%5C%2Foffice%5C%2Flogin&flavor=javascript
const LOGIN_URL = /\/office\/login/;
// The office home: matches a URL ending "/office"; rejects "/office/orders".
// https://regex101.com/?regex=%5C%2Foffice%24&flavor=javascript
const HOME_URL = /\/office$/;

// The manager signs in once (password and TOTP enrolment); later tests reuse the signed-in session, so no
// test waits for a fresh 30-second code.
let session: Awaited<ReturnType<BrowserContext["storageState"]>> | null = null;
async function officePage(browser: Browser) {
  const ctx = await browser.newContext(session ? { storageState: session } : {});
  const page = await ctx.newPage();
  if (session) {
    await page.goto("/office");
    return page;
  }
  await page.goto("/office/login");
  await page.getByLabel("Email").fill(manager.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(MFA_URL);
  const key = page.locator("code");
  await key.first().waitFor({ timeout: ENROL_WAIT_MS });
  const secret = (await key.first().innerText()).trim();
  await page.getByLabel("6-digit code").fill(totp(secret, Math.floor(Date.now() / STEP_MS)));
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForURL(HOME_URL);
  session = await ctx.storageState();
  return page;
}
const navOf = (page: Page) => page.getByRole("navigation", { name: "Office" });
const navLink = (page: Page, name: string) => navOf(page).getByRole("link", { name, exact: true });

// Each test does several database and page round trips on one real stack: more than the 60 s default.
const TEST_TIMEOUT_MS = 120_000;
test.describe.configure({ mode: "serial", timeout: TEST_TIMEOUT_MS });

let invoiceNumber = "";
let pendingOrderId = "";

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
    `+9201${String(Date.now()).slice(-PHONE_DIGITS)}`,
  ]);
  // Rep Two covers a new territory with one approved salon; a warehouse holds stock to deliver from.
  await sql(MANAGER, "select app.office_upsert_territory($1, $2)", [territory.id, territory.name]);
  await sql(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Detail area')", [area, territory.id]);
  await sql(MANAGER, "select app.office_assign_territory($1, $2)", [rep2.id, territory.id]);
  await sql(MANAGER, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'manual')", [salon.id, salon.name, area]);
  await sql(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Detail store')", [warehouse]);
  await sql(
    null,
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, $2, $3, 'receipt', $4)`,
    [seed.sku.id, STOCK, warehouse, manager.id],
  );
  // One order of Rep Two delivered by the office (it has an invoice), one waiting on Rep Two's submission.
  const delivered = randomUUID();
  await sql(MANAGER, "select app.office_create_order($1, $2, 'CASH', $3::jsonb, $4)", [delivered, salon.id, LINE, rep2.id]);
  const invoice = await sql(
    MANAGER,
    "select (app.office_deliver($1, (select id from public.sales_order where client_id = $2), $3, 'Ayesha at the counter')).number n",
    [randomUUID(), delivered, warehouse],
  );
  invoiceNumber = invoice[0].n as string;
  const submitted = randomUUID();
  const order = await sql(MANAGER, "select (app.office_create_order($1, $2, 'CASH', $3::jsonb, $4)).id", [
    submitted,
    salon.id,
    LINE,
    rep2.id,
  ]);
  pendingOrderId = order[0].id as string;
  // A submission written directly (the rep's phone and bag are not part of this test): what the rep would send.
  await sql(
    null,
    `insert into public.rep_day (rep_id, day) values ($1, (now() at time zone 'Asia/Karachi')::date) on conflict (rep_id, day) do nothing`,
    [rep2.id],
  );
  await sql(
    null,
    `insert into public.delivery_submission (client_id, order_id, salon_id, rep_id, rep_day_id, lines, received_by_name, lat, lng, device_fingerprint)
     select gen_random_uuid(), $1, $2, $3, d.id, $4::jsonb, 'Ayesha at the counter', 24.9, 67.1, 'stack-fixture-fingerprint'
     from public.rep_day d where d.rep_id = $3 order by d.day desc limit 1`,
    [pendingOrderId, salon.id, rep2.id, LINE],
  );
});

test("sidebar: grouped, collapsible by keyboard, the current page marked, and usable at tablet width", async ({ browser }) => {
  const page = await officePage(browser);
  const nav = navOf(page);
  await expect(nav.locator("summary")).toHaveText([
    "Overview",
    "Customers and Salons",
    "Orders and Deliveries",
    "Inventory and Stock",
    "Money and Collections",
    "Field Team",
  ]);
  // No page that does not exist is listed.
  await expect(nav.getByRole("link", { name: "Routes" })).toHaveCount(0);
  await expect(navLink(page, "Overview")).toHaveAttribute("aria-current", "page");

  // Folding a group hides its links; the keyboard opens it again.
  const group = nav.locator("summary", { hasText: "Orders and Deliveries" });
  await group.click();
  await expect(navLink(page, "Orders")).toBeHidden();
  await group.focus();
  await page.keyboard.press("Enter");
  await expect(navLink(page, "Orders")).toBeVisible();

  // Moving to a page opens its folded group.
  await nav.locator("summary", { hasText: "Customers and Salons" }).click();
  await expect(navLink(page, "Salons")).toBeHidden();
  await page.locator('a.tile[href="/office/salons"]').click();
  await expect(navLink(page, "Salons")).toBeVisible();
  await expect(navLink(page, "Salons")).toHaveAttribute("aria-current", "page");

  // The longest match is the current page.
  await navLink(page, "Salon approvals").click();
  await expect(navLink(page, "Salon approvals")).toHaveAttribute("aria-current", "page");
  await expect(navLink(page, "Salons")).not.toHaveAttribute("aria-current", "page");

  await page.setViewportSize(TABLET);
  await navLink(page, "Invoices").click();
  await expect(page.getByRole("heading", { name: "Invoices and receipts", level: 1 })).toBeVisible();
  await expect(navLink(page, "Invoices")).toHaveAttribute("aria-current", "page");
});

test("Rep detail: from Rep performance, the rep's orders, submission and money, read-only and with a masked phone", async ({
  browser,
}) => {
  const page = await officePage(browser);
  await navLink(page, "Rep performance").click();
  await page.getByTestId("rep-month-row").filter({ hasText: rep2.name }).getByRole("link", { name: rep2.name }).click();
  await expect(page.getByRole("heading", { name: rep2.name, level: 1 })).toBeVisible();
  await expect(navLink(page, "Rep performance")).toHaveAttribute("aria-current", "page");

  await expect(page.getByTestId("rep-status")).toHaveText("active");
  await expect(page.getByTestId("rep-phone")).toContainText("*");
  await expect(page.locator("body")).not.toContainText(REP2_PHONE);
  await expect(page.locator("body")).not.toContainText("stack-fixture-fingerprint");
  await expect(page.getByTestId("rep-territory").filter({ hasText: territory.name })).toContainText("(current)");
  await expect(page.getByTestId("rep-salon").filter({ hasText: salon.name })).toBeVisible();
  await expect(page.getByTestId("rep-order").filter({ hasText: salon.name })).toHaveCount(TWO_ORDERS);
  await expect(page.getByTestId("rep-invoice").filter({ hasText: invoiceNumber })).toContainText(rupees(ORDER_PAISA));

  // The figures are the database's, from the same function the Commission page reads.
  const detail = await sql(MANAGER, "select app.office_rep_detail($1) j", [rep2.id]);
  const month = (detail[0].j as { month: { start: string; end: string } }).month;
  const statement = await sql(MANAGER, "select app.office_commission($1, $2::date, $3::date) j", [
    rep2.id,
    month.start,
    month.end,
  ]);
  const c = statement[0].j as { earned_paisa: number; paid_paisa: number; owed_paisa: number };
  await expect(page.getByTestId("rep-earned")).toHaveText(rupees(c.earned_paisa));
  await expect(page.getByTestId("rep-paid")).toHaveText(rupees(c.paid_paisa));
  await expect(page.getByTestId("rep-owed")).toHaveText(rupees(c.owed_paisa));
  await expect(page.getByTestId("rep-cash")).toBeVisible();

  // The submission waits here with a link; deciding happens only on Delivery approvals.
  const pending = page.getByTestId("rep-pending").filter({ hasText: salon.name });
  await expect(pending).toContainText(rupees(ORDER_PAISA));
  await expect(page.getByRole("button")).toHaveText(["Sign out"]);
  await page.getByRole("link", { name: "Check and decide them on Delivery approvals" }).click();
  await expect(page.getByRole("heading", { name: "Delivery approvals", level: 1 })).toBeVisible();

  // A wrong id is the database's refusal.
  await page.goto(`/office/reps/${randomUUID()}`);
  await expect(page.getByRole("alert")).toHaveText("unknown rep");
  await page.goto(`/office/reps/${manager.id}`);
  await expect(page.getByRole("alert")).toHaveText("unknown rep");
  await page.goto("/office/reps/not-an-id");
  await expect(page.getByRole("alert")).toHaveText("unknown rep");
});

test("invoice and receipt views: linked from each page, in English, with the database's figures and the proof sentence", async ({
  browser,
}) => {
  const page = await officePage(browser);
  // From the office home.
  await page.getByTestId("delivered-row").filter({ hasText: invoiceNumber }).getByRole("link", { name: invoiceNumber }).click();
  await expect(page.getByRole("heading", { name: `Invoice ${invoiceNumber}`, level: 1 })).toBeVisible();
  await expect(navLink(page, "Invoices")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("doc-salon")).toHaveText(salon.name);
  await expect(page.getByTestId("doc-line").filter({ hasText: seed.sku.code })).toContainText(rupees(ORDER_PAISA));
  await expect(page.getByTestId("doc-total")).toHaveText(rupees(ORDER_PAISA));
  await expect(page.getByTestId("doc-proof")).toHaveText(PROOF);
  await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
  await expect(page.getByTestId("doc-receipt")).toHaveCount(0);
  expect(ARABIC_SCRIPT.test(await page.locator("article").innerText())).toBe(false);

  // To the order, and back from the order's invoice list.
  await page.getByRole("link", { name: "Open the order" }).click();
  await page.getByTestId("order-invoice").filter({ hasText: invoiceNumber }).getByRole("link", { name: invoiceNumber }).click();
  await expect(page.getByRole("heading", { name: `Invoice ${invoiceNumber}`, level: 1 })).toBeVisible();

  // The salon page lists it; a payment recorded there links its receipt.
  await page.getByRole("link", { name: "Open the salon" }).click();
  await expect(page.getByTestId("invoice-row").filter({ hasText: invoiceNumber })).toBeVisible();
  await expect(page.getByTestId("receipt-row")).toHaveCount(0);
  await page.getByLabel("Amount (Rs)", { exact: true }).fill(String(PAID_RS));
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded. Receipt")).toBeVisible();
  await page.locator("output", { hasText: "Payment recorded" }).getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Receipt R-", level: 1 })).toBeVisible();
  await expect(page.getByTestId("doc-salon")).toHaveText(salon.name);
  await expect(page.getByTestId("doc-total")).toHaveText(rupees(PAID_RS * PAISA_PER_RUPEE));
  await expect(page.getByTestId("doc-allocation").filter({ hasText: invoiceNumber })).toContainText(
    rupees(PAID_RS * PAISA_PER_RUPEE),
  );
  await expect(page.getByTestId("doc-proof")).toHaveText(PROOF);
  expect(ARABIC_SCRIPT.test(await page.locator("article").innerText())).toBe(false);
  await page.reload();
  await expect(page.getByTestId("doc-total")).toHaveText(rupees(PAID_RS * PAISA_PER_RUPEE));

  // The invoice now lists that receipt, and links it.
  await page.goto("/office/invoices");
  await page.getByTestId("invoice-row").filter({ hasText: invoiceNumber }).getByRole("link", { name: invoiceNumber }).click();
  await expect(page.getByTestId("doc-receipt")).toHaveCount(1);
  await page.getByTestId("doc-receipt").getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Receipt R-", level: 1 })).toBeVisible();

  // A wrong id: one plain message, whichever way it is wrong.
  await page.goto(`/office/invoices/${randomUUID()}`);
  await expect(page.getByRole("alert")).toHaveText("This invoice does not exist, or you may not read it.");
  await page.goto("/office/receipts/not-an-id");
  await expect(page.getByRole("alert")).toHaveText("This receipt does not exist, or you may not read it.");
});

test("the new reads and the documents refuse a rep, a signed-out visitor and an office session without the second step", async ({
  browser,
}) => {
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("/office/invoices");
  await expect(visitor).toHaveURL(LOGIN_URL);
  await visitor.goto(`/office/reps/${rep2.id}`);
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
  const refused = await Promise.all(
    [null, repToken, managerAal1].flatMap((t) => [
      call(t, "office_rep_detail", { p_rep_id: rep2.id }),
      call(t, "office_invoices"),
      call(t, "office_receipts"),
    ]),
  );
  expect(refused.map((r) => r.ok)).toEqual(refused.map(() => false));

  // The documents answer null, not a refusal, to a caller they do not serve; anon cannot call them at all.
  const invoice = await sql(null, "select id from public.invoice where number = $1", [invoiceNumber]);
  const args = { p_invoice_id: invoice[0].id };
  expect((await call(null, "invoice_document", args)).ok).toBe(false);
  const shut = await Promise.all([repToken, managerAal1].map((t) => call(t, "invoice_document", args)));
  expect(await Promise.all(shut.map((r) => r.json()))).toEqual([null, null]);
});
