import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { rupees } from "../lib/money";

// Slice 1 journeys on a real local stack (execution map; J1 steps 1 to 3, J4 steps 1, 5, J5
// steps 1, 10). Seed: scripts/e2e-stack-seed.mjs. Tests run in order and share the stack.

type P = { id: string; email: string; name: string };
const seed = JSON.parse(readFileSync(new URL("./.seed.json", import.meta.url), "utf8")) as {
  password: string;
  people: Record<"owner" | "manager" | "rep" | "rep2" | "newcomer", P>;
  sku: { id: string; code: string; list_price_paisa: number };
};
const { owner, manager, rep, rep2, newcomer } = seed.people;
const MAILPIT = process.env.KIRAN_STACK_MAILPIT_URL ?? "http://127.0.0.1:54324";

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s), the authenticator app's arithmetic. One code per
// 30-second step per person, so a second sign-in waits for the next step.
const secrets = new Map<string, string>();
const usedStep = new Map<string, number>();
function totp(secret: string, step: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}
async function freshCode(who: string) {
  const secret = secrets.get(who);
  if (!secret) throw new Error(`no TOTP secret captured for ${who}`);
  let step = Math.floor(Date.now() / 30_000);
  while (usedStep.get(who) === step) {
    await new Promise((r) => setTimeout(r, 1_000));
    step = Math.floor(Date.now() / 30_000);
  }
  usedStep.set(who, step);
  return totp(secret, step);
}

async function officeSignIn(page: Page, p: P) {
  await page.goto("/office/login");
  await page.getByLabel("Email").fill(p.email);
  await page.getByLabel("Password").fill(seed.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/office\/mfa/);
  const key = page.locator("code");
  const enrol = await key
    .first()
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (enrol) secrets.set(p.email, (await key.first().innerText()).trim());
  await page.getByLabel("6-digit code").fill(await freshCode(p.email));
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForURL(/\/office$/);
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

const HTTP_OK = 200;
const HTTP_UNPROCESSABLE = 422;
// The rep journey does many steps on one real stack; it gets more than the 60 s default.
const JOURNEY_TIMEOUT_MS = 120_000;

// D-30 (ORD-14): the rep journey saves an order card for its new salon; a later test has the manager
// make the order from it. The journey keeps the salon's name and the rep's signed-in, approved phone
// (cookies and the stored device id) so that test can read the rep's Orders page without a second
// e-mail code (the local stack sends at most 2 an hour).
const CARD_TEXT = "[Test] 2 bottles of shade 5";
const CARD_QTY = 2;
let journeySalon = "";
let repPhone: Awaited<ReturnType<BrowserContext["storageState"]>> | null = null;

test.describe.configure({ mode: "serial" });

// Auth provider guard. Two independent GoTrue switches, both pinned here against the real stack:
// the email provider must be ON (else every sign-in is 422 email_provider_disabled, seen on
// a05d771) and self-signup must stay OFF (an address the owner has not created is refused).
test("auth provider guard: the owner's password grant works and self-signup is refused", async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  expect(url, "NEXT_PUBLIC_SUPABASE_URL must point at the local stack").toBeTruthy();
  const headers = { apikey: key ?? "", "content-type": "application/json" };

  const grant = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: owner.email, password: seed.password }),
  });
  const granted = (await grant.json()) as { access_token?: string; error_code?: string; code?: string };
  expect(granted.error_code ?? granted.code, "email provider must be enabled").not.toBe("email_provider_disabled");
  expect(grant.status).toBe(HTTP_OK);
  expect(granted.access_token).toBeTruthy();

  const signup = await fetch(`${url}/auth/v1/signup`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: `self-signup-${Date.now()}@example.test`, password: "Self-signup-attempt-1!" }),
  });
  const refused = (await signup.json()) as { error_code?: string; code?: string };
  expect(signup.status).toBe(HTTP_UNPROCESSABLE);
  expect(refused.error_code ?? refused.code).toBe("signup_disabled");
});

test("owner signs in with password and TOTP and sees the office overview", async ({ page }) => {
  await officeSignIn(page, owner);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Office" })).toBeVisible();
  // Rep Two's seeded phone is waiting.
  await expect(page.getByText("phones waiting for approval")).toBeVisible();
  await expect(page.locator(".tile .big").first()).toHaveText("1");
});

test("an office page without a session sends the visitor to the sign-in page", async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto("/office/devices");
  await expect(page).toHaveURL(/\/office\/login/);
});

test("owner approves a rep's phone (SEC-03), and it moves to Approved", async ({ page }) => {
  await officeSignIn(page, owner);
  await page.getByRole("link", { name: "Devices", exact: true }).click();
  const row = page.getByRole("row", { name: new RegExp(rep2.name.replace(/[[\]]/g, "\\$&")) });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Approve" }).click();
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(`Approved ${rep2.name}'s phone.`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Waiting for approval (0)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Approved (1)" })).toBeVisible();
});

test("owner builds a territory with an area, assigns a rep and ends the assignment with a reason (PIP-01)", async ({ page }) => {
  await officeSignIn(page, owner);
  await page.getByRole("link", { name: "Territories", exact: true }).click();
  const tname = `[Test] North ${Date.now()}`;
  await page.getByLabel("New territory").fill(tname);
  await page.getByRole("button", { name: "Add territory" }).click();
  await expect(page.getByText(`Added territory ${tname}.`)).toBeVisible();
  const card = page.locator("section", { has: page.getByRole("heading", { name: tname }) });
  await card.getByLabel(`New area in ${tname}`).fill("[Test] Block 1");
  await card.getByRole("button", { name: "Add area" }).click();
  await expect(card.getByText("[Test] Block 1")).toBeVisible();
  await card.getByLabel("Assign a rep").selectOption({ label: rep.name });
  await card.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByText(`${rep.name} now covers ${tname}.`)).toBeVisible();
  // An empty reason is refused by the form; a short one by the database.
  await card.getByRole("button", { name: "End" }).click();
  await card.getByLabel("Reason").fill("moved to another territory");
  await card.getByRole("button", { name: "End assignment" }).click();
  await expect(page.getByText(`${rep.name} no longer covers ${tname}.`)).toBeVisible();
  await expect(card.getByText("No rep is assigned.")).toBeVisible();
});

test("owner suspends and reactivates the manager, with a reason, and cannot act on the owner row", async ({ page }) => {
  await officeSignIn(page, owner);
  await page.getByRole("link", { name: "Team", exact: true }).click();
  const row = page.getByRole("row", { name: new RegExp(manager.name.replace(/[[\]]/g, "\\$&")) });
  await row.getByRole("button", { name: "Suspend" }).click();
  await row.getByLabel("Reason").fill("test: suspend for a day");
  await row.getByRole("button", { name: "Suspend now" }).click();
  await expect(page.getByText(`${manager.name} is now suspended.`)).toBeVisible();
  await row.getByRole("button", { name: "Reactivate" }).click();
  await row.getByLabel("Reason").fill("test: back at work");
  await row.getByRole("button", { name: "Reactivate" }).last().click();
  await expect(page.getByText(`${manager.name} is now active.`)).toBeVisible();
  const ownerRow = page.getByRole("row", { name: new RegExp(owner.name.replace(/[[\]]/g, "\\$&")) });
  await expect(ownerRow.getByRole("button")).toHaveCount(0);
});

test("a new office person sees their sign-in code, the owner adds them, and they get in (SEC-04, ADM)", async ({
  browser,
  page,
}) => {
  const newbie = await newPage(browser);
  await officeSignIn(newbie, newcomer);
  const code = newbie.getByTestId("signin-code");
  await expect(code).toHaveText(newcomer.id);
  await expect(newbie.getByRole("navigation", { name: "Office" })).toHaveCount(0);

  await officeSignIn(page, owner);
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await page.getByRole("button", { name: "Add a person" }).click();
  await page.getByLabel("Sign-in code").fill(newcomer.id);
  await page.getByLabel("Full name").fill(newcomer.name);
  await page.getByLabel("Role").selectOption("manager");
  await page.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByText(`Added ${newcomer.name}.`)).toBeVisible();

  await newbie.reload();
  await expect(newbie.getByRole("navigation", { name: "Office" })).toBeVisible();
});

test("a manager sees the team but no owner controls (H-15)", async ({ page }) => {
  await officeSignIn(page, manager);
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await expect(page.getByText("Only the owner adds people or changes their status")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a person" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Suspend" })).toHaveCount(0);
});

test("a rep signs in with an email code, waits for approval, then checks in and out (J1 steps 1 to 6 and 15)", async ({
  browser,
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  await page.goto("/app/login");
  await page.getByLabel(/Email/).fill(rep.email);
  const asked = Date.now();
  // The app turns any Auth error into one generic line, so read the real response here.
  const otpResponse = page.waitForResponse((r) => r.url().includes("/auth/v1/otp"));
  await page.getByRole("button", { name: /Send code/ }).click();
  const sent = await otpResponse;
  expect(sent.status(), `POST /auth/v1/otp answered: ${await sent.text()}`).toBe(HTTP_OK);
  let token = "";
  for (let i = 0; i < 20 && !token; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    const list = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${rep.email}`)}`)).json()) as {
      messages?: Array<{ ID: string; Created: string }>;
    };
    const latest = (list.messages ?? []).find((m) => Date.parse(m.Created) >= asked - 5_000);
    if (latest) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${latest.ID}`)).json()) as { Text?: string; HTML?: string };
      token = `${msg.Text ?? ""} ${msg.HTML ?? ""}`.match(/\b(\d{6})\b/)?.[1] ?? "";
    }
  }
  expect(token, "the one-time code e-mail reached the local mail catcher").toMatch(/^\d{6}$/);
  await page.getByLabel(/Code/).fill(token);
  await page.getByRole("button", { name: /Sign in/ }).click();
  await page.waitForURL(/\/app$/);
  await expect(page.getByText(/waiting for your manager/)).toBeVisible();

  // J1 step 3: the office approves this phone; the rep's day opens (slice 2, J1 steps 4 to 6 and 15).
  const office = await newPage(browser);
  await officeSignIn(office, owner);
  await office.getByRole("link", { name: "Devices", exact: true }).click();
  const row = office.getByRole("row", { name: new RegExp(rep.name.replace(/[[\]]/g, "\\$&")) });
  await row.getByRole("button", { name: "Approve" }).click();
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(office.getByText(`Approved ${rep.name}'s phone.`)).toBeVisible();

  await page.reload();
  await expect(page.getByText("This phone is approved.")).toBeVisible();
  await page.getByRole("link", { name: /Start your day/ }).click();
  await page.waitForURL(/\/app\/day$/);
  await expect(page.getByRole("heading", { name: /Your territory/ })).toBeVisible();
  // The rep has an empty bag (seed), so the morning count is empty; check in.
  await page.getByRole("button", { name: "Check in" }).click();
  await expect(page.getByText("Checked in. Have a good day.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Today's route/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Due for a visit/ })).toBeVisible();
  // A second check-in is not offered; the day is open.
  await expect(page.getByRole("button", { name: "Check in" })).toHaveCount(0);
  // J2 salon acquisition (slice 3): the office gives the rep a territory, the rep adds a salon.
  await office.getByRole("link", { name: "Territories", exact: true }).click();
  const tname = `[Test] South ${Date.now()}`;
  await office.getByLabel("New territory").fill(tname);
  await office.getByRole("button", { name: "Add territory" }).click();
  const card = office.locator("section", { has: office.getByRole("heading", { name: tname }) });
  await card.getByLabel(`New area in ${tname}`).fill("[Test] Market");
  await card.getByRole("button", { name: "Add area" }).click();
  await expect(card.getByText("[Test] Market")).toBeVisible();
  await card.getByLabel("Assign a rep").selectOption({ label: rep.name });
  await card.getByRole("button", { name: "Assign" }).click();
  await expect(office.getByText(`${rep.name} now covers ${tname}.`)).toBeVisible();

  await page.goto("/app/salons/new");
  const salonName = `[Test] Salon ${Date.now()}`;
  journeySalon = salonName;
  await page.getByLabel("Salon name").fill(salonName);
  await page.getByRole("button", { name: "Add salon" }).click();
  await page.waitForURL(/\/app\/salons\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: salonName })).toBeVisible();
  await expect(page.getByText("prospect").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stage history" })).toBeVisible();
  // P1-07 (PAY-02, PAY-04): the salon's account comes from app.salon_balance and app.salon_installments.
  // A new salon owes nothing, so the database's zero is shown and no payment form is offered.
  await expect(page.getByRole("heading", { name: "Account · حساب" })).toBeVisible();
  await expect(page.getByTestId("balance")).toHaveText("Rs 0");
  await expect(page.getByText("Nothing is owed.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);
  await page.getByLabel("New note").fill("[Test] owner asked for a price list");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Note added.")).toBeVisible();
  await expect(page.getByText("[Test] owner asked for a price list")).toBeVisible();
  // D-30 (ORD-14): the rep does not place orders; it saves what the salon wants as an order card
  // (app.rep_create_card, open day), listed under My cards as Open until the office acts on it.
  await page.getByLabel("What the salon needs").fill(CARD_TEXT);
  await page.getByRole("button", { name: "Save order details" }).click();
  await expect(page.getByText("Order details saved.")).toBeVisible();
  await page.goto("/app/cards");
  await expect(page.getByRole("heading", { name: "My cards" })).toBeVisible();
  const myCard = page.getByRole("listitem").filter({ hasText: CARD_TEXT });
  await expect(myCard.getByText("Open", { exact: true })).toBeVisible();
  await expect(myCard).toContainText(salonName);
  // The rep's Orders page (app.my_territory_orders) is read-only: a note, nothing that makes an order.
  await page.goto("/app/orders");
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
  await expect(page.getByText("Orders are made by the office")).toBeVisible();
  await expect(page.getByText("No orders in your territories yet.")).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "order" })).toHaveCount(0);
  // The salon is in the rep's list after a reload (data survives, from the database).
  await page.goto("/app/salons");
  await expect(page.getByRole("link", { name: salonName })).toBeVisible();

  // SAL-01 edit (slice 3): the form starts from the database's values; the saved values come back
  // from the database after a reload; the note and stage history are untouched.
  await page.getByRole("link", { name: salonName }).click();
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.waitForURL(/\/edit$/);
  await expect(page.getByLabel("Salon name")).toHaveValue(salonName);
  await page.getByLabel("Address").fill("[Test] 7 Fake Market Road");
  await page.getByLabel("Chairs").fill("4");
  await page.getByRole("button", { name: "Save changes" }).click();
  // The confirmation shows the row app.update_salon returned, then the salon page reloads it.
  await expect(page.getByText(`Salon updated: ${salonName} · [Test] 7 Fake Market Road · 4 chairs.`)).toBeVisible();
  await page.getByRole("link", { name: "Back to the salon" }).click();
  await page.waitForURL(/\/app\/salons\/[0-9a-f-]{36}$/);
  await page.reload();
  await expect(page.getByText("[Test] 7 Fake Market Road")).toBeVisible();
  await expect(page.getByText("4 chairs")).toBeVisible();
  await expect(page.getByText("[Test] owner asked for a price list")).toBeVisible();
  // A recorded field cannot be emptied (null keeps the old value in app.update_salon).
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.getByLabel("Address").fill("");
  await expect(page.getByText(/cannot be emptied/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();

  // Office side of slice 3: the owner finds the salon, sets its pin (office only while B-31 a is
  // open), overrides the stage with a reason, and the history shows it; the rep sees the new pin.
  await office.getByRole("link", { name: "Salons", exact: true }).click();
  await office.getByLabel("Name contains").fill(salonName);
  await office.getByRole("button", { name: "Search" }).click();
  await office.getByRole("link", { name: salonName }).click();
  await expect(office.getByRole("heading", { name: salonName })).toBeVisible();
  await expect(office.getByLabel("Address")).toHaveValue("[Test] 7 Fake Market Road");
  await office.getByLabel("Pin latitude").fill("24.8607");
  await expect(office.getByText("A pin needs both latitude and longitude.")).toBeVisible();
  await office.getByLabel("Pin longitude").fill("67.0011");
  await office.getByRole("button", { name: "Save changes" }).click();
  await expect(office.getByText("Salon updated.")).toBeVisible();
  // L-0362: the office salon page has the account section in office mode; a new salon owes nothing.
  await expect(office.getByTestId("balance")).toHaveText("Rs 0");
  await expect(office.getByRole("button", { name: "Record payment" })).toHaveCount(0);
  await office.getByLabel("New stage").selectOption("visited");
  await office.getByRole("button", { name: "Change stage" }).click();
  await office.getByLabel("Reason").fill("[Test] confirmed by phone");
  await office.getByRole("button", { name: "Set stage" }).click();
  await expect(office.getByText("Stage set to visited.")).toBeVisible();
  await office.reload();
  await expect(office.getByText("[Test] confirmed by phone")).toBeVisible();
  await expect(office.getByLabel("Pin latitude")).toHaveValue("24.8607");
  await page.reload();
  await expect(page.getByText("Pin: 24.8607, 67.0011.")).toBeVisible();

  // CTL-03, the rep's side: the handover page reads app.my_cash_position and app.my_handovers. The
  // seeded rep has collected nothing, so the database's zero and an empty list are shown.
  await page.goto("/app");
  await page.getByRole("link", { name: /Cash handover/ }).click();
  await page.waitForURL(/\/app\/handovers$/);
  await expect(page.getByTestId("my-cash")).toHaveText("Rs 0");
  await expect(page.getByText("No handovers yet.")).toBeVisible();

  await page.goto("/app/day");
  await page.getByRole("button", { name: /Finish the day/ }).click();
  // B-35: with a bag, check-out needs the daily close, so the page must send the evening count.
  const closeCount = page.waitForRequest((r) => r.url().includes("/rpc/record_count") && r.method() === "POST");
  await page.getByRole("button", { name: "Save count and check out" }).click();
  expect((await closeCount).postDataJSON()).toMatchObject({ p_kind: "daily_close" });
  await expect(page.getByText("Day closed. Thank you.")).toBeVisible();
  await expect(page.getByText("Today's day is closed.")).toBeVisible();
  repPhone = await page.context().storageState();
});

test("a manager opens Receivables and reads the real ageing for each grouping (PAY-07)", async ({ page }) => {
  await officeSignIn(page, manager);
  const calls: Array<{ p_group?: string }> = [];
  page.on("request", (req) => {
    if (req.url().includes("/rpc/office_receivables_ageing")) calls.push(req.postDataJSON() ?? {});
  });
  // The overview also links to Receivables, so click the one in the office menu.
  await page.getByRole("navigation", { name: "Office" }).getByRole("link", { name: "Receivables", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Receivables" })).toBeVisible();
  // The seeded stack has no invoices, so the database answers with no rows: the page says so, with no error.
  await expect(page.getByText("Nothing is owed.")).toBeVisible();
  await page.getByRole("radio", { name: "Territory" }).check();
  await expect(page.getByText("Nothing is owed.")).toBeVisible();
  await page.getByRole("radio", { name: "Rep" }).check();
  await expect(page.getByText("Nothing is owed.")).toBeVisible();
  await expect(page.locator("p.error")).toHaveCount(0);
  expect(calls.map((c) => c.p_group)).toEqual(["salon", "territory", "rep"]);
});

test("a manager opens Cash handover; counting a rep who holds nothing is refused by the database (PAY-05, CTL-03)", async ({
  page,
}) => {
  await officeSignIn(page, manager);
  await page.getByRole("navigation", { name: "Office" }).getByRole("link", { name: "Cash handover", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cash handover" })).toBeVisible();
  await expect(page.getByTestId("office-cash")).toHaveText("Rs 0");
  await expect(page.getByText("No handovers yet.")).toBeVisible();
  await page.getByLabel("Rep", { exact: true }).selectOption({ label: rep.name });
  // The expected figure is the database's: the seeded rep has collected no cash.
  await expect(page.getByTestId("expected")).toHaveText("Rs 0");
  await page.getByLabel("Cash counted (Rs)").fill("0");
  await page.getByRole("button", { name: "Record count" }).click();
  await expect(page.getByText("nothing to hand over: the rep holds no cash and none was counted")).toBeVisible();
  await expect(page.getByText("No handovers yet.")).toBeVisible();
});

test("a manager makes an order from the rep's card; the card leaves the queue and the rep reads the order (D-30, ORD-14)", async ({
  browser,
  page,
}) => {
  expect(repPhone, "the rep journey kept the rep's signed-in phone").not.toBeNull();
  await officeSignIn(page, manager);
  await page.getByRole("navigation", { name: "Office" }).getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
  const queued = page.getByRole("listitem").filter({ hasText: CARD_TEXT });
  await expect(queued).toContainText(rep.name);
  await expect(queued).toContainText(journeySalon);
  await queued.getByRole("button", { name: "Create order from this card" }).click();

  // The form shows the card, keeps its salon and pre-selects the card's rep, who covers the territory.
  const form = page.getByRole("form", { name: "New order" });
  await expect(form.getByTestId("card-body")).toHaveText(CARD_TEXT);
  await expect(form.getByLabel("Delivering rep")).toHaveValue(rep.id);
  await form.getByLabel("Product 1").selectOption(seed.sku.id);
  await form.getByLabel("Quantity 1").fill(String(CARD_QTY));
  // A CASH order needs no credit (app.evaluate_order), so the database confirms it at once.
  await form.getByLabel("Plan").selectOption("CASH");
  await form.getByRole("button", { name: "Create order" }).click();
  const total = rupees(seed.sku.list_price_paisa * CARD_QTY);
  await expect(page.getByText(`Order created for ${journeySalon}: confirmed · ${total}.`)).toBeVisible();

  // The card is closed as converted, so it leaves the queue; the order is listed from app.office_orders.
  await expect(queued).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: journeySalon });
  await expect(row).toContainText("confirmed");
  await expect(row).toContainText(total);
  await expect(row).toContainText(rep.name);
  await expect(row).toContainText("office");
  // Data survives a reload: the database answers the same.
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: journeySalon })).toContainText("confirmed");
  await expect(page.getByRole("listitem").filter({ hasText: CARD_TEXT })).toHaveCount(0);

  // The rep's phone: the order is in its territory list, assigned to it, and still nothing makes an order.
  const phone = await (await browser.newContext({ storageState: repPhone ?? undefined })).newPage();
  await phone.goto("/app/orders");
  const mine = phone.getByRole("listitem").filter({ hasText: journeySalon });
  await expect(mine).toContainText("confirmed");
  await expect(mine).toContainText(total);
  await expect(mine).toContainText("Assigned to you");
  await expect(phone.getByRole("button")).toHaveCount(0);
  await phone.goto("/app/cards");
  await expect(phone.getByRole("listitem").filter({ hasText: CARD_TEXT }).getByText("Converted", { exact: true })).toBeVisible();
});
