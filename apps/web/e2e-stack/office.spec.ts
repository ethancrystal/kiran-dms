import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { rupees } from "../lib/money";

// Slice 1 journeys on a real local stack (execution map; J1 steps 1 to 3, J4 steps 1, 5, J5
// steps 1, 10). Seed: scripts/e2e-stack-seed.mjs. Tests run in order and share the stack.

type P = { id: string; email: string; name: string };
const seed = JSON.parse(readFileSync(new URL("./.seed.json", import.meta.url), "utf8")) as {
  password: string;
  people: Record<"owner" | "manager" | "rep" | "rep2" | "newcomer" | "invitee", P>;
  sku: { id: string; code: string; list_price_paisa: number };
  pendingSalon: { id: string; name: string; area: string };
  catalogueSalon: { id: string; name: string };
  productGroup: { name: string };
};
const { owner, manager, rep, rep2, newcomer, invitee } = seed.people;
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
const TOKEN_LENGTH = 64; // an invitation token: 32 random bytes in hex
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
// a05d771), and signup is ON since D-39 (slice 1) so an invitee can get a login. GoTrue has no
// switch for "codes but not passwords", so the invariant pinned is the database's: a password
// self-signup gets a session that sees no profile and no salon, and cannot redeem an invitation.
test("auth provider guard: the owner's password grant works; a password self-signup gets nothing", async () => {
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
  const session = (await signup.json()) as { access_token?: string };
  expect(signup.status).toBe(HTTP_OK);
  expect(session.access_token, "enable_confirmations is off, so the signup is signed in").toBeTruthy();
  const call = (fn: string, args: Record<string, unknown> = {}) =>
    fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { ...headers, authorization: `Bearer ${session.access_token}`, "content-profile": "app" },
      body: JSON.stringify(args),
    });
  expect(await (await call("my_session")).json()).toBeNull();
  expect(await (await call("salon_me")).json()).toBeNull();
  const redeem = await call("redeem_invitation", { p_token: "0".repeat(TOKEN_LENGTH) });
  expect(redeem.ok).toBe(false);
  expect(((await redeem.json()) as { message?: string }).message).toContain("emailed code");
  const office = await call("office_invite", {
    p_client_id: crypto.randomUUID(),
    p_kind: "rep",
    p_full_name: "[Test] X",
    p_email: "x@example.test",
  });
  expect(office.ok).toBe(false);
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
  // A second manager sign-in waits for the next TOTP step (up to 30 s) before the test's own work.
  test.setTimeout(JOURNEY_TIMEOUT_MS);
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
  // The queue reloads after the order is made; ListState marks loading with aria-busy and hides the list
  // meanwhile, so the card's absence is read only once the reload is done.
  const queue = page.locator("section", { has: page.getByRole("heading", { name: "Order cards waiting" }) });
  await expect(queue.locator("[aria-busy]")).toHaveCount(0);
  await expect(queued).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: journeySalon });
  await expect(row).toContainText("confirmed");
  await expect(row).toContainText(total);
  await expect(row).toContainText(rep.name);
  await expect(row).toContainText("office");
  // Data survives a reload: the database answers the same.
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: journeySalon })).toContainText("confirmed");
  await expect(queue.locator("[aria-busy]")).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: CARD_TEXT })).toHaveCount(0);

  // The rep's phone: the order is in its territory list, assigned to it, and still nothing makes an order.
  const phoneContext = await browser.newContext({ storageState: repPhone ?? undefined });
  const phone = await phoneContext.newPage();
  await phone.goto("/app/orders");
  const mine = phone.getByRole("listitem").filter({ hasText: journeySalon });
  await expect(mine).toContainText("confirmed");
  await expect(mine).toContainText(total);
  await expect(mine).toContainText("Assigned to you");
  await expect(phone.getByRole("button")).toHaveCount(0);
  await phone.goto("/app/cards");
  await expect(phone.getByRole("listitem").filter({ hasText: CARD_TEXT }).getByText("Converted", { exact: true })).toBeVisible();
  await phoneContext.close();
});

// Slice 1 (P1-18; D-35, D-36, D-39): the manager invites a rep and a salon on People, approves a
// proposed salon with a rep and a rate, and both invitees join. The local stack sends at most 2
// e-mails an hour and the rep journey above spends one, so ONE invitee goes through the real page
// and code (the salon, a brand-new address: shouldCreateUser, Mailpit, Accept). The rep invitee's
// link is redeemed with a session made the way scripts/e2e-stack-seed.mjs acts for a person (claims
// with an emailed-code amr, straight on the local database); its page is the same page.

const MAIL_TRIES = 20;
const MAIL_POLL_MS = 1_000;
const MAIL_CLOCK_SLACK_MS = 5_000;
const CODE_LENGTH = 6;

/** The 6-digit code GoTrue e-mailed to this address after `since`, read from the local mail catcher. */
async function mailedCode(email: string, since: number) {
  const tries = Array.from({ length: MAIL_TRIES });
  // Which e-mail arrived, for the failure message: a first sign-in may use another template.
  const seen: string[] = [];
  const found = await tries.reduce<Promise<string>>(async (prev) => {
    const got = await prev;
    if (got) return got;
    await new Promise((r) => setTimeout(r, MAIL_POLL_MS));
    const list = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as {
      messages?: Array<{ ID: string; Created: string; Subject?: string }>;
    };
    const latest = (list.messages ?? []).find((m) => Date.parse(m.Created) >= since - MAIL_CLOCK_SLACK_MS);
    if (!latest) return "";
    seen.push(latest.Subject ?? "(no subject)");
    const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${latest.ID}`)).json()) as { Text?: string; HTML?: string };
    const text = `${msg.Text ?? ""} ${msg.HTML ?? ""}`;
    // Six digits standing alone: "code 123456." matches; "1234567" and "12345" do not.
    // https://regex101.com/?regex=%5Cb%28%5Cd%7B6%7D%29%5Cb&flavor=javascript
    return text.match(/\b(\d{6})\b/)?.[1] ?? "";
  }, Promise.resolve(""));
  expect(
    found,
    `the one-time code e-mail reached the local mail catcher (subjects seen: ${seen.join(", ") || "none"})`,
  ).toHaveLength(CODE_LENGTH);
  return found;
}

/** Redeems a link as the person, on the local database, as the seed acts for people (no service key). */
async function redeemAs(person: P, token: string) {
  const dbUrl = process.env.KIRAN_STACK_DB_URL ?? "";
  expect(["127.0.0.1", "localhost"]).toContain(new URL(dbUrl).hostname);
  const c = new pg.Client({ connectionString: dbUrl });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: person.id, role: "authenticated", aal: "aal1", amr: [{ method: "otp", timestamp: 1 }] }),
    ]);
    await c.query("set local role authenticated");
    const r = await c.query("select app.redeem_invitation($1) as r", [token]);
    await c.query("commit");
    return r.rows[0].r as { kind: string };
  } finally {
    await c.end();
  }
}

async function invite(page: Page, kind: "rep" | "salon", name: string, email: string, salon?: { name: string; area: string }) {
  await page.getByLabel("Invite a").selectOption(kind);
  await page.getByLabel(kind === "rep" ? "Rep's full name" : "Salon contact's name").fill(name);
  await page.getByLabel("Their email").fill(email);
  if (salon) {
    await page.getByLabel("A new salon").check();
    await page.getByLabel("New salon's name").fill(salon.name);
    await page.getByLabel("Area").selectOption({ label: salon.area });
  }
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByTestId("invite-created")).toContainText(`Invitation for ${name}.`);
  await expect(page.getByTestId("invite-created")).toContainText("shown once");
  const link = (await page.getByTestId("invite-link").innerText()).trim();
  expect(new URL(link).pathname).toMatch(INVITE_PATH);
  return new URL(link);
}
// An invitation link's path: "/invite/" and 64 hex digits; "/invite/abc" does not match.
// https://regex101.com/?regex=%5E%5C%2Finvite%5C%2F%5B0-9a-f%5D%7B64%7D%24&flavor=javascript
const INVITE_PATH = /^\/invite\/[0-9a-f]{64}$/;

test("a manager invites a rep and a salon, approves a proposed salon, and both invitees join (P1-18)", async ({
  browser,
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  await officeSignIn(page, manager);
  await page.getByRole("navigation", { name: "Office" }).getByRole("link", { name: "People", exact: true }).click();
  await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();

  // The rep: invited on People, joined with a code session on the database (see the note above).
  const repLink = await invite(page, "rep", invitee.name, invitee.email);
  const repRow = page.getByRole("row").filter({ hasText: invitee.email });
  await expect(repRow).toContainText("pending");
  expect(await redeemAs(invitee, repLink.pathname.split("/").at(-1) ?? "")).toEqual({ kind: "rep" });
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: invitee.email })).toContainText("redeemed");
  const repsSection = page.locator("section", { has: page.getByRole("heading", { name: "Reps" }) });
  const newRep = repsSection.getByRole("row").filter({ hasText: invitee.name });
  await expect(newRep).toContainText("active");
  // The manager may suspend and reactivate a rep (D-39); offboarding is not offered here.
  await newRep.getByRole("button", { name: "Suspend" }).click();
  await newRep.getByLabel("Reason").fill("test: suspended for a day");
  await newRep.getByRole("button", { name: "Suspend now" }).click();
  await expect(page.getByText(`${invitee.name} is now suspended.`)).toBeVisible();
  await newRep.getByRole("button", { name: "Reactivate" }).click();
  await newRep.getByLabel("Reason").fill("test: back at work");
  await newRep.getByRole("button", { name: "Reactivate" }).last().click();
  await expect(page.getByText(`${invitee.name} is now active.`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Offboard" })).toHaveCount(0);

  // The salon: a new salon made in the same invitation, joined through the real page and code.
  const salonName = `[Test] Invited salon ${Date.now()}`;
  const salonEmail = `salon.${Date.now()}@example.test`;
  const salonLink = await invite(page, "salon", "[Test] Salon Owner", salonEmail, {
    name: salonName,
    area: seed.pendingSalon.area,
  });
  const guest = await newPage(browser);
  await guest.goto(salonLink.pathname);
  await expect(guest.getByRole("heading", { name: "Your Kiran invitation" })).toBeVisible();
  await guest.getByLabel("Email").fill(salonEmail);
  const asked = Date.now();
  await guest.getByRole("button", { name: "Send code" }).click();
  await guest.getByLabel("Code").fill(await mailedCode(salonEmail, asked));
  // The preview answers only a session that proved the mailbox (the amr claim GoTrue signs). If it
  // does not answer, the message names the methods GoTrue wrote, so one CI run shows the cause.
  const previewCall = guest.waitForRequest((r) => r.url().includes("/rpc/invitation_preview"));
  await guest.getByRole("button", { name: "Sign in" }).click();
  const bearer = ((await previewCall).headers().authorization ?? "").split(" ")[1] ?? "";
  const claims = JSON.parse(Buffer.from(bearer.split(".")[1] ?? "", "base64url").toString() || "{}") as {
    amr?: Array<{ method?: string }>;
  };
  const methods = (claims.amr ?? []).map((m) => m.method).join(", ");
  await expect(guest.getByTestId("invite-details"), `amr methods in the invitee's session: ${methods || "none"}`).toHaveText(
    `${manager.name} invited [Test] Salon Owner to the salon account of ${salonName}.`,
  );
  await guest.getByRole("button", { name: "Accept invitation" }).click();
  await guest.waitForURL((u) => u.pathname === "/salon");
  await expect(guest.getByRole("heading", { name: salonName })).toBeVisible();
  await expect(guest.getByText("active")).toBeVisible();
  // The link works once: opening it again says so.
  await guest.goto(salonLink.pathname);
  await expect(guest.getByRole("alert").filter({ hasText: "already been accepted" })).toBeVisible();
  // The salon login reaches no office page and no rep data.
  await guest.goto("/office");
  await expect(guest.getByRole("navigation", { name: "Office" })).toHaveCount(0);

  // The manager sees the new salon account and can suspend it; the salon page then shows nothing.
  await page.reload();
  const members = page.locator("section", { has: page.getByRole("heading", { name: "Salon accounts" }) });
  const member = members.getByRole("row").filter({ hasText: salonEmail });
  await expect(member).toContainText("active");
  await member.getByRole("button", { name: "Suspend" }).click();
  await member.getByLabel("Reason").fill("test: paused");
  await member.getByRole("button", { name: "Suspend now" }).click();
  await expect(page.getByText("[Test] Salon Owner is now suspended.")).toBeVisible();
  await guest.goto("/salon");
  await expect(guest.getByRole("alert").filter({ hasText: "no active salon account" })).toBeVisible();

  // Salon approvals: the seeded proposal is approved with Rep One at 2.5%.
  await page.getByRole("navigation", { name: "Office" }).getByRole("link", { name: "Salon approvals", exact: true }).click();
  const card = page.getByRole("region", { name: seed.pendingSalon.name });
  await expect(card).toContainText(`proposed by ${rep.name}`);
  await card.getByLabel("Rep (optional)").selectOption({ label: rep.name });
  await card.getByLabel("Commission rate, % (optional, needs a rep)").fill("2.5");
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(`Approved ${seed.pendingSalon.name}, assigned to ${rep.name} at 2.5%.`)).toBeVisible();
  await expect(page.getByRole("region", { name: seed.pendingSalon.name })).toHaveCount(0);
  await page.goto(`/office/salons/${seed.pendingSalon.id}`);
  await expect(page.getByTestId("salon-rep")).toHaveText(`${rep.name} · 2.5%`);
  await page.reload();
  await expect(page.getByTestId("salon-rep")).toHaveText(`${rep.name} · 2.5%`);
});

// Slice 2 (P1-19; D-37, D-39): the manager adds a [Dummy] product and SKU on Products, sets its list
// price with a reason, gives a salon its own lower price on the salon page, and makes an order for that
// salon with no price typed: the database takes the salon's price, and because it is below list the
// order waits for a discount approval (OQ-33 default). No picture is uploaded: this stack runs without
// storage-api, so the picture path is covered by the database tests only.
const CATALOGUE_LIST_RS = 1000;
const CATALOGUE_SALON_RS = 900;
const PAISA_PER_RUPEE = 100;

test("a manager adds a product, prices it, sets a salon price, and an order for that salon uses it (P1-19)", async ({ page }) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const tag = Date.now().toString(36).toUpperCase();
  const productName = `[Dummy] Catalogue colour ${tag}`;
  const code = `E2E-${tag}`;
  await officeSignIn(page, manager);
  const nav = page.getByRole("navigation", { name: "Office" });

  await nav.getByRole("link", { name: "Products", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Products", exact: true })).toBeVisible();
  const add = page.getByRole("form", { name: "Add a product" });
  await add.getByLabel("Product group").selectOption({ label: seed.productGroup.name });
  await add.getByLabel("Brand label").fill("[Dummy] Kiran");
  await add.getByLabel("Product name").fill(productName);
  await add.getByLabel("Description (optional)").fill("[Dummy] A shade for the stack test.");
  await add.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByText(`Product ${productName} added.`)).toBeVisible();

  const card = page.getByRole("region", { name: `Product ${productName}` });
  await expect(card).toContainText("[Dummy] A shade for the stack test.");
  await expect(card).toContainText("No picture");
  const addSku = card.getByRole("form", { name: `Add a SKU to ${productName}` });
  await addSku.getByLabel("SKU code").fill(code);
  await addSku.getByLabel("Variant").fill("[Dummy] Shade 7");
  await addSku.getByRole("button", { name: "Add SKU" }).click();
  await expect(page.getByText(`SKU ${code} added to ${productName}.`)).toBeVisible();
  await expect(card.getByTestId(`price-${code}`)).toHaveText("No price yet");
  await card.getByLabel(`List price (Rs) for ${code}`).fill(String(CATALOGUE_LIST_RS));
  await card.getByLabel(`Why this price for ${code}`).fill("[Test] e2e list price");
  await card.getByRole("button", { name: `Set price of ${code}` }).click();
  const list = rupees(CATALOGUE_LIST_RS * PAISA_PER_RUPEE);
  await expect(page.getByText(`${code} now lists at ${list}.`)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: `Product ${productName}` }).getByTestId(`price-${code}`)).toHaveText(list);

  // The salon's own price, on the salon page.
  await page.goto(`/office/salons/${seed.catalogueSalon.id}`);
  await expect(page.getByText("No salon prices: this salon pays list prices.")).toBeVisible();
  const skuOption = page.locator("#salon-price-sku option", { hasText: code });
  await page.getByLabel("SKU for the salon price").selectOption((await skuOption.getAttribute("value")) ?? "");
  await page.getByLabel("Salon price (Rs; empty clears it)").fill(String(CATALOGUE_SALON_RS));
  await page.getByLabel("Why this salon price").fill("[Test] e2e salon price");
  await page.getByRole("button", { name: "Save salon price" }).click();
  const salonPrice = rupees(CATALOGUE_SALON_RS * PAISA_PER_RUPEE);
  await expect(page.getByText(`Salon price set: ${code} at ${salonPrice}.`)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId(`salon-price-${code}`)).toContainText(salonPrice);
  await expect(page.getByTestId(`salon-price-${code}`)).toContainText(manager.name);

  // An order for the salon with no price typed: the form shows the salon's price; the database applies it.
  await nav.getByRole("link", { name: "Orders", exact: true }).click();
  await page.getByRole("button", { name: "Create New Order" }).click();
  const form = page.getByRole("form", { name: "New order" });
  await form.getByLabel("Salon", { exact: true }).selectOption(seed.catalogueSalon.id);
  const lineOption = form.locator("select[id^='sku-'] option", { hasText: code });
  await expect(lineOption).toContainText(`salon price ${salonPrice}`);
  await form.getByLabel("Product 1").selectOption((await lineOption.getAttribute("value")) ?? "");
  await expect(form.getByTestId("salon-price-1")).toHaveText(`This salon's price: ${salonPrice}`);
  await form.getByLabel("Quantity 1").fill("1");
  await form.getByLabel("Plan").selectOption("CASH");
  await form.getByRole("button", { name: "Create order" }).click();
  await expect(
    page.getByText(`Order created for ${seed.catalogueSalon.name}: draft · ${salonPrice} (held: pending).`),
  ).toBeVisible();
  await page.reload();
  const row = page.getByRole("row").filter({ hasText: seed.catalogueSalon.name });
  await expect(row).toContainText(salonPrice);
});

// Slice 3 (P1-20; D-40): the manager keeps the basic investor ledger, typing every amount; the page
// shows the database's derived figures, which survive a reload. A rep's signed-in phone has no
// Investors link and reaches no office page or investor data.
const INVESTED_PAISA = 10_000_000; // Rs 100,000
const DECIDED_PAISA = 1_200_000; // Rs 12,000
const PAID_PAISA = 500_000; // Rs 5,000
const OWED_PAISA = DECIDED_PAISA - PAID_PAISA; // Rs 7,000

test("a manager records an investor, an investment, a profit decision and a payout; Rs 7,000 owed survives a reload; a rep sees none of it (P1-20)", async ({
  browser,
  page,
}) => {
  // A further manager sign-in waits for the next TOTP step (up to 30 s) before the test's own work.
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  expect(repPhone, "the rep journey kept the rep's signed-in phone").not.toBeNull();
  await officeSignIn(page, manager);
  await page.getByRole("navigation", { name: "Office" }).getByRole("link", { name: "Investors", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Investors", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByTestId("ledger-note")).toContainText("Nothing is calculated");

  const name = `[Dummy] Investor ${Date.now()}`;
  const add = page.getByRole("form", { name: "Add an investor" });
  await add.getByLabel("Name").fill(name);
  await add.getByLabel("Phone (optional)").fill("+920000001234");
  await add.getByRole("button", { name: "Add investor" }).click();
  await expect(page.getByText(`Investor ${name} added.`)).toBeVisible();
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();

  const invest = page.getByRole("form", { name: "Add an investment" });
  await invest.getByLabel("Amount (Rs)").fill("100000");
  await invest.getByRole("button", { name: "Record investment" }).click();
  await expect(page.getByText(`Investment of ${rupees(INVESTED_PAISA)} recorded.`)).toBeVisible();
  const decide = page.getByRole("form", { name: "Decide profit" });
  await decide.getByLabel("Amount (Rs)").fill("12000");
  await decide.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText(`Profit of ${rupees(DECIDED_PAISA)} decided.`)).toBeVisible();
  const payout = page.getByRole("form", { name: "Record a payout" });
  await payout.getByLabel("Paid as").selectOption("profit");
  await payout.getByLabel("Amount (Rs)").fill("5000");
  await payout.getByRole("button", { name: "Record payout" }).click();
  await expect(page.getByText(`Profit payout of ${rupees(PAID_PAISA)} recorded.`)).toBeVisible();

  // The investor's own figures and its investment row, as the database derives them.
  await expect(page.getByTestId("investor-invested")).toHaveText(rupees(INVESTED_PAISA));
  await expect(page.getByTestId("investor-decided")).toHaveText(rupees(DECIDED_PAISA));
  await expect(page.getByTestId("investor-paid")).toHaveText(rupees(PAID_PAISA));
  await expect(page.getByTestId("investor-owed")).toHaveText(rupees(OWED_PAISA));
  await expect(page.getByTestId("investment-row")).toContainText(rupees(OWED_PAISA));
  // Data survives a reload: the database answers the same.
  await page.reload();
  await expect(page.getByTestId("investor-owed")).toHaveText(rupees(OWED_PAISA));
  await expect(page.getByTestId("investment-row")).toContainText(rupees(OWED_PAISA));
  await page.goto("/office/investors");
  await expect(page.getByRole("row").filter({ hasText: name })).toContainText(rupees(OWED_PAISA));

  // The rep's phone: no Investors link in the rep app, and the office page shows it nothing.
  const phoneContext = await browser.newContext({ storageState: repPhone ?? undefined });
  const phone = await phoneContext.newPage();
  await phone.goto("/app");
  await expect(phone.getByRole("link", { name: "Investors" })).toHaveCount(0);
  await phone.goto("/office/investors");
  await expect(phone.getByRole("navigation", { name: "Office" })).toHaveCount(0);
  await expect(phone.getByText(name)).toHaveCount(0);
  await expect(phone.getByTestId("total-owed")).toHaveCount(0);
  await phoneContext.close();
});
