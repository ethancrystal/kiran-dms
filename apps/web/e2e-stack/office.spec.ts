import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { percent, rupees } from "../lib/money";

// Slice 1 journeys on a real local stack (execution map; J1 steps 1 to 3, J4 steps 1, 5, J5
// steps 1, 10). Seed: scripts/e2e-stack-seed.mjs. Tests run in order and share the stack.

type P = { id: string; email: string; name: string };
const seed = JSON.parse(readFileSync(new URL("./.seed.json", import.meta.url), "utf8")) as {
  password: string;
  people: Record<"owner" | "manager" | "rep" | "rep2" | "newcomer" | "invitee" | "journeyRep" | "journeySalon", P>;
  sku: { id: string; code: string; list_price_paisa: number };
  pendingSalon: { id: string; name: string; area: string };
  warehouse: { id: string; name: string };
  bagQty: number;
  catalogueSalon: { id: string; name: string };
  productGroup: { name: string };
};
const { owner, manager, rep, rep2, newcomer, invitee, journeyRep, journeySalon: salonInvitee } = seed.people;
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
// Slice 6 (P1-23): the salon invited in the slice 1 journey, its address and its signed-in session
// (an emailed-code session, which the salon functions require), kept for the portal journey: the
// local stack sends at most 2 e-mails an hour, so no second salon signs in.
let portalSalon = { name: "", email: "" };
let salonPhone: Awaited<ReturnType<BrowserContext["storageState"]>> | null = null;

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
  // The rep's bag holds seed.bagQty of the seeded SKU (slice 4), so the morning count has one line.
  await page.getByLabel(seed.sku.code).fill(String(seed.bagQty));
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
  // Slice 7 (P1-24; R3, D-35): a salon the rep adds is a proposal, pending until the office decides, so
  // no order details can be saved for it yet; salon details are read-only for a rep (no Edit link).
  await expect(page.getByTestId("salon-pending")).toBeVisible();
  await expect(page.getByLabel("What the salon needs")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("salon-readonly")).toContainText("The office keeps the salon's details");
  // P1-07 (PAY-02, PAY-04): the salon's account comes from app.salon_balance and app.salon_installments.
  // A new salon owes nothing, so the database's zero is shown and no payment form is offered.
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByTestId("balance")).toHaveText("Rs 0");
  await expect(page.getByText("Nothing is owed.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);
  await page.getByLabel("New note").fill("[Test] owner asked for a price list");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Note added.")).toBeVisible();
  await expect(page.getByText("[Test] owner asked for a price list")).toBeVisible();
  // The owner approves the proposal on Salon approvals with no rep, so the territory's rep keeps it (R4).
  await office.getByRole("navigation", { name: "Office" }).getByRole("link", { name: "Salon approvals", exact: true }).click();
  const proposal = office.getByRole("region", { name: salonName });
  await expect(proposal).toContainText(`proposed by ${rep.name}`);
  await proposal.getByRole("button", { name: "Approve" }).click();
  await expect(office.getByText(`Approved ${salonName}.`)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("salon-pending")).toHaveCount(0);
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

  await page.getByRole("link", { name: salonName }).click();
  await page.waitForURL(/\/app\/salons\/[0-9a-f-]{36}$/);

  // SAL-01 edit (slice 3), by the office since slice 7 (D-35): the owner finds the salon, records the
  // address and chairs and sets its pin; a recorded field cannot be emptied (null keeps the old value
  // in app.update_salon); the owner overrides the stage with a reason, and the history shows it.
  await office.getByRole("link", { name: "Salons", exact: true }).click();
  await office.getByLabel("Name contains").fill(salonName);
  await office.getByRole("button", { name: "Search" }).click();
  await office.getByRole("link", { name: salonName }).click();
  await expect(office.getByRole("heading", { name: salonName })).toBeVisible();
  await expect(office.getByLabel("Salon name")).toHaveValue(salonName);
  await office.getByLabel("Address").fill("[Test] 7 Fake Market Road");
  await office.getByLabel("Chairs").fill("4");
  await office.getByLabel("Pin latitude").fill("24.8607");
  await expect(office.getByText("A pin needs both latitude and longitude.")).toBeVisible();
  await office.getByLabel("Pin longitude").fill("67.0011");
  await office.getByRole("button", { name: "Save changes" }).click();
  await expect(office.getByText("Salon updated.")).toBeVisible();
  await office.getByLabel("Address").fill("");
  await expect(office.getByText(/cannot be emptied/)).toBeVisible();
  await expect(office.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await office.reload();
  await expect(office.getByLabel("Address")).toHaveValue("[Test] 7 Fake Market Road");
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
  // Slice 7: the salon's timeline (app.office_salon_timeline) says who did what, from the audit chain.
  const timeline = office.getByTestId("salon-timeline");
  await expect(timeline).toContainText(`salon proposed · pending · ${rep.name}`);
  await expect(timeline).toContainText(`salon approved · ${owner.name}`);
  await expect(timeline).toContainText(`note added · ${rep.name}`);
  await expect(timeline).toContainText(`salon updated · address, pin, chairs · ${owner.name}`);
  await expect(timeline).not.toContainText("[Test] owner asked for a price list");
  // The rep reads what the office recorded, read-only, after a reload; its note is untouched.
  await page.reload();
  await expect(page.getByText("[Test] 7 Fake Market Road")).toBeVisible();
  await expect(page.getByText("4 chairs")).toBeVisible();
  await expect(page.getByText("[Test] owner asked for a price list")).toBeVisible();
  await expect(page.getByText("Pin: 24.8607, 67.0011.")).toBeVisible();

  // CTL-03, the rep's side: the handover page reads app.my_cash_position and app.my_handovers. The
  // seeded rep has collected nothing, so the database's zero and an empty list are shown.
  await page.goto("/app");
  await page.getByRole("link", { name: /Cash handover/ }).click();
  await page.waitForURL(/\/app\/handovers$/);
  await expect(page.getByTestId("my-cash")).toHaveText("Rs 0");
  await expect(page.getByText("No handovers yet.")).toBeVisible();

  // The day stays open: the delivery tests below need it. The evening count and check-out (J1 step
  // 15, B-35) are the last test of this file.
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
  // Slice 7: the order's timeline (app.office_order_timeline): the rep's card, its conversion and the order.
  await page.getByRole("row").filter({ hasText: journeySalon }).getByRole("button", { name: "Timeline" }).click();
  const orderTimeline = page.getByTestId("order-timeline");
  await expect(orderTimeline).toContainText(`order card saved · ${rep.name}`);
  await expect(orderTimeline).toContainText(`request converted · converted · ${manager.name}`);
  await expect(orderTimeline).toContainText(`order created · draft · ${manager.name}`);
  await expect(orderTimeline).not.toContainText(CARD_TEXT);

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

// Slice 4 (P1-21, D-32): a rep's delivery is a submission the office approves. The rep's phone is the
// one the journey signed in (cookies and device id), with a GPS fix at the salon's pin.
// The pin the journey's office step set on the salon.
const PIN_LATITUDE = 24.8607;
const PIN_LONGITUDE = 67.0011;
const SALON_PIN = { latitude: PIN_LATITUDE, longitude: PIN_LONGITUDE };
// A Deliver page's path ends in "/deliver": "/app/orders/1f2e/deliver" matches; "/app/orders" does not.
// https://regex101.com/?regex=%5C%2Fdeliver%24&flavor=javascript
const DELIVER_PATH = /\/deliver$/;
// The office sign-in page: "/office/login" matches; "/office/deliveries" does not.
// https://regex101.com/?regex=%5C%2Foffice%5C%2Flogin&flavor=javascript
const OFFICE_LOGIN = /\/office\/login/;
const RECEIVER = "[Test] Counter staff";
const SENT_COPY = "Sent for approval. No invoice yet: the office approves first. Collect payment after approval.";
const REJECTED_ORDER_QTY = 3;
const REJECTED_QTY = 2;
const REJECT_REASON = "[Test] wrong shade handed over";

async function repPhoneOpen(browser: Browser) {
  expect(repPhone, "the rep journey kept the rep's signed-in phone").not.toBeNull();
  const ctx = await browser.newContext({
    storageState: repPhone ?? undefined,
    geolocation: SALON_PIN,
    permissions: ["geolocation"],
  });
  return { ctx, phone: await ctx.newPage() };
}

/** Stock on hand of the seeded SKU in Rep One's bag, read on the local database (no office stock screen exists). */
async function repBagOnHand() {
  const dbUrl = process.env.KIRAN_STACK_DB_URL ?? "";
  expect(["127.0.0.1", "localhost"]).toContain(new URL(dbUrl).hostname);
  const c = new pg.Client({ connectionString: dbUrl });
  await c.connect();
  try {
    const r = await c.query(
      `select app.on_hand(l.id, $2)::int n from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = $1`,
      [rep.id, seed.sku.id],
    );
    return r.rows[0]?.n as number;
  } finally {
    await c.end();
  }
}

/**
 * The customer signs on the screen (D-49): name, role, a few strokes with the mouse, the statement ticked, then Confirm.
 * Used on the rep's phone after a delivery is sent, on My deliveries, and on the office's delivery form.
 */
async function signOnScreen(page: Page) {
  const ack = page.getByTestId("acknowledgement");
  await expect(ack).toBeVisible();
  await ack.getByLabel("Name of the person signing").fill("Ayesha Khan");
  await ack.getByLabel("Their role at the salon").fill("Owner");
  await ack.getByTestId("signature-pad").scrollIntoViewIfNeeded();
  const box = await ack.getByTestId("signature-pad").boundingBox();
  if (!box) throw new Error("the signature area is not on the page");
  const stroke = [
    [30, 60],
    [120, 30],
    [220, 90],
    [320, 40],
  ];
  await page.mouse.move(box.x + stroke[0][0], box.y + stroke[0][1]);
  await page.mouse.down();
  for (const [x, y] of stroke.slice(1)) await page.mouse.move(box.x + x, box.y + y, { steps: 10 });
  await page.mouse.up();
  await ack.getByLabel("I have read the statement above").check();
  await ack.getByRole("button", { name: "Confirm and sign" }).click();
}

/** The rep opens an order's Deliver page from its Orders list, sets the quantity handed over and sends it. */
async function submitDelivery(phone: Page, row: ReturnType<Page["getByRole"]>, qty: number, sign = true) {
  await row.getByRole("link", { name: "Deliver this order" }).click();
  await phone.waitForURL(DELIVER_PATH);
  await phone.getByLabel(`Handed over: ${seed.sku.code}`).fill(String(qty));
  await phone.getByLabel("Received by (name)").fill(RECEIVER);
  await phone.getByRole("button", { name: "Send for approval" }).click();
  await expect(phone.getByTestId("delivery-sent")).toHaveText(SENT_COPY);
  if (sign) {
    await signOnScreen(phone);
    await expect(phone.getByTestId("ack-result")).toHaveText("The customer's acknowledgement is recorded.");
  } else {
    await phone.getByTestId("acknowledgement").getByRole("button", { name: "Skip for now" }).click();
    await expect(phone.getByTestId("ack-result")).toHaveText("No acknowledgement was recorded. The office will see that.");
  }
}

test("the rep submits its assigned order and the manager approves it; the invoice appears for both (D-32)", async ({
  browser,
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const total = rupees(seed.sku.list_price_paisa * CARD_QTY);
  const { ctx, phone } = await repPhoneOpen(browser);
  await phone.goto("/app/orders");
  await submitDelivery(phone, phone.getByRole("listitem").filter({ hasText: journeySalon }), CARD_QTY);
  // Nothing official yet: the order waits, and no invoice is listed.
  await phone.goto("/app/orders");
  const mine = phone.getByRole("listitem").filter({ hasText: journeySalon });
  await expect(mine).toContainText("Waiting for approval");
  await expect(mine.getByRole("link", { name: "Deliver this order" })).toHaveCount(0);
  await phone.goto("/app/deliveries");
  const sent = phone.getByRole("listitem").filter({ hasText: journeySalon });
  await expect(sent).toContainText("Waiting for approval");
  await expect(sent.getByTestId("invoice-number")).toHaveCount(0);

  await officeSignIn(page, manager);
  await page.getByRole("navigation", { name: "Office" }).getByRole("link", { name: "Delivery approvals", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Delivery approvals", exact: true })).toBeVisible();
  const waiting = page.getByTestId("waiting-delivery").filter({ hasText: journeySalon });
  await expect(waiting).toContainText(rep.name);
  await expect(waiting).toContainText(total);
  await expect(waiting).toContainText(RECEIVER);
  await waiting.getByRole("button", { name: "Approve delivery" }).click();
  await expect(page.getByText(`Approved the delivery to ${journeySalon}; the invoice is issued.`)).toBeVisible();
  await expect(waiting).toHaveCount(0);
  await page.getByRole("navigation", { name: "Office" }).getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: journeySalon })).toContainText("delivered");
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: journeySalon })).toContainText("delivered");

  // The rep sees the approval and its invoice; the salon now owes the total, so a payment can be recorded.
  await phone.goto("/app/deliveries");
  await expect(sent).toContainText("Approved");
  await expect(sent.getByTestId("invoice-number")).toContainText("INV-");
  await sent.getByRole("link", { name: "See the salon's account" }).click();
  await expect(phone.getByTestId("balance")).toHaveText(total);
  await expect(phone.getByRole("button", { name: "Record payment" })).toBeVisible();
  await ctx.close();
});

test("a rejected submission keeps its history and its goods wait until the office returns them (D-32)", async ({
  browser,
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const bagBefore = await repBagOnHand();
  const total = rupees(seed.sku.list_price_paisa * REJECTED_ORDER_QTY);
  // The manager makes a direct order for the journey's salon with Rep One delivering (A-16).
  await officeSignIn(page, manager);
  await page.getByRole("navigation", { name: "Office" }).getByRole("link", { name: "Orders", exact: true }).click();
  await page.getByRole("button", { name: "Create New Order" }).click();
  const form = page.getByRole("form", { name: "New order" });
  await form.getByLabel("Salon").selectOption({ label: `${journeySalon} · [Test] Market` });
  await form.getByLabel("Product 1").selectOption(seed.sku.id);
  await form.getByLabel("Quantity 1").fill(String(REJECTED_ORDER_QTY));
  await form.getByLabel("Plan").selectOption("CASH");
  await form.getByLabel("Delivering rep").selectOption(rep.id);
  await form.getByRole("button", { name: "Create order" }).click();
  await expect(page.getByText(`Order created for ${journeySalon}: confirmed · ${total}.`)).toBeVisible();

  const { ctx, phone } = await repPhoneOpen(browser);
  await phone.goto("/app/orders");
  const order = phone.getByRole("listitem").filter({ hasText: journeySalon }).filter({ hasText: total });
  await submitDelivery(phone, order, REJECTED_QTY);
  expect(await repBagOnHand()).toBe(bagBefore - REJECTED_QTY);

  await page.getByRole("navigation", { name: "Office" }).getByRole("link", { name: "Delivery approvals", exact: true }).click();
  const waiting = page.getByTestId("waiting-delivery").filter({ hasText: journeySalon });
  await waiting.getByRole("button", { name: "Reject delivery" }).click();
  await waiting.getByLabel("Why it is rejected").fill(REJECT_REASON);
  await waiting.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText(`Rejected the delivery to ${journeySalon}; its goods wait to be settled.`)).toBeVisible();
  await expect(waiting).toHaveCount(0);
  const goods = page.getByTestId("unsettled-goods").filter({ hasText: `${REJECTED_QTY} × ${seed.sku.code}` });
  await expect(goods).toContainText(rep.name);
  await expect(goods).toContainText(REJECT_REASON);

  // History stays: the rep sees the rejection and its reason; the order is still confirmed.
  await phone.goto("/app/deliveries");
  const rejected = phone.getByRole("listitem").filter({ hasText: "Rejected" });
  await expect(rejected).toContainText(REJECT_REASON);
  await expect(rejected).toContainText(`Goods wait for the office (${REJECTED_QTY})`);
  await page.getByRole("navigation", { name: "Office" }).getByRole("link", { name: "Orders", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: journeySalon }).filter({ hasText: total })).toContainText("confirmed");

  // The office returns the goods to the bag with a count note; the row leaves the list.
  await page.getByRole("navigation", { name: "Office" }).getByRole("link", { name: "Delivery approvals", exact: true }).click();
  await goods.getByRole("button", { name: "Return to bag" }).click();
  await goods.getByLabel("Count note").fill("[Test] counted 2 at the office");
  await goods.getByRole("button", { name: "Return to the rep's bag" }).click();
  await expect(page.getByText(`Returned to ${rep.name}'s bag.`)).toBeVisible();
  await expect(goods).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("unsettled-goods").filter({ hasText: journeySalon })).toHaveCount(0);
  expect(await repBagOnHand()).toBe(bagBefore);
  // The rep may hand the order over again.
  await phone.goto("/app/orders");
  await expect(order.getByRole("link", { name: "Deliver this order" })).toBeVisible();
  await ctx.close();
});

test("Delivery approvals without a session sends the visitor to the sign-in page", async ({ browser }) => {
  const visitor = await newPage(browser);
  await visitor.goto("/office/deliveries");
  await expect(visitor).toHaveURL(OFFICE_LOGIN);
});

// Slice 5 (P1-22; D-31, D-38; FLD-03, FLD-06): the manager sets Rep One's default rate on Commission;
// the rep hands over one unit of the order left confirmed above and the manager approves it, so its
// invoice is stamped at that rate; the manager pays part of what is owed and reverses it; the rep reads
// earned, paid and owed on its own page. Earlier invoices of Rep One were stamped before any rate was
// set (0%), so the test reads the owed figure first and asserts only what this test adds.
const COMMISSION_RATE = "2.5";
const COMMISSION_RATE_BP = 250;
const BASIS_POINTS = 10_000;
const COMMISSION_PAY_RUPEES = "20";
const COMMISSION_PAY_PAISA = 2_000;
const COMMISSION_REASON = "[Test] rate agreed at hiring";
const COMMISSION_REVERSE_REASON = "[Test] paid by mistake";

/** Rep One's owed commission to date, read on the local database (the figure the pages show). */
async function repOwedPaisa() {
  const dbUrl = process.env.KIRAN_STACK_DB_URL ?? "";
  expect(["127.0.0.1", "localhost"]).toContain(new URL(dbUrl).hostname);
  const c = new pg.Client({ connectionString: dbUrl });
  await c.connect();
  try {
    const r = await c.query(
      "select (app.commission_earned_paisa($1, null, null) - app.commission_paid_paisa($1, null, null))::int n",
      [rep.id],
    );
    return r.rows[0].n as number;
  } finally {
    await c.end();
  }
}

test("commission: the manager sets the rate, an approved delivery earns at it, a payment is recorded and reversed, the rep reads it (P1-22)", async ({
  browser,
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const owedBefore = await repOwedPaisa();
  const earned = Math.floor((seed.sku.list_price_paisa * COMMISSION_RATE_BP) / BASIS_POINTS);
  const nav = () => page.getByRole("navigation", { name: "Office" });

  await officeSignIn(page, manager);
  await nav().getByRole("link", { name: "Commission", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Commission", exact: true })).toBeVisible();
  await page.getByTestId("commission-rep").filter({ hasText: rep.name }).getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("heading", { name: rep.name, exact: true })).toBeVisible();
  await page.getByLabel("Rate in percent").fill(COMMISSION_RATE);
  await page.getByLabel("Reason for the rate").fill(COMMISSION_REASON);
  await page.getByRole("button", { name: "Set default rate" }).click();
  await expect(page.getByText(`Default rate set to ${percent(COMMISSION_RATE_BP)} for invoices from now on.`)).toBeVisible();

  // The rep hands over one unit of the order the rejection test left confirmed; the manager approves.
  const { ctx, phone } = await repPhoneOpen(browser);
  await phone.goto("/app/orders");
  const order = phone
    .getByRole("listitem")
    .filter({ hasText: journeySalon })
    .filter({ hasText: rupees(seed.sku.list_price_paisa * REJECTED_ORDER_QTY) });
  await submitDelivery(phone, order, 1);
  await nav().getByRole("link", { name: "Delivery approvals", exact: true }).click();
  await page
    .getByTestId("waiting-delivery")
    .filter({ hasText: journeySalon })
    .getByRole("button", { name: "Approve delivery" })
    .click();
  await expect(page.getByText(`Approved the delivery to ${journeySalon}; the invoice is issued.`)).toBeVisible();
  expect(await repOwedPaisa()).toBe(owedBefore + earned);

  // The office sees the stamped invoice and pays part of what is owed; the figure survives a reload.
  await nav().getByRole("link", { name: "Commission", exact: true }).click();
  await page.getByTestId("commission-rep").filter({ hasText: rep.name }).getByRole("button", { name: "Open" }).click();
  await expect(
    page.getByText(`${rupees(seed.sku.list_price_paisa)} at ${percent(COMMISSION_RATE_BP)} = ${rupees(earned)}`),
  ).toBeVisible();
  await expect(page.getByTestId("rep-owed")).toHaveText(rupees(owedBefore + earned));
  await page.getByLabel("Amount in rupees").fill(COMMISSION_PAY_RUPEES);
  await page.getByLabel("Payment note").fill("[Test] cash");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText(`Recorded a commission payment of ${rupees(COMMISSION_PAY_PAISA)}.`)).toBeVisible();
  await expect(page.getByTestId("rep-owed")).toHaveText(rupees(owedBefore + earned - COMMISSION_PAY_PAISA));
  expect(await repOwedPaisa()).toBe(owedBefore + earned - COMMISSION_PAY_PAISA);

  // The rep reads it, read-only.
  await phone.goto("/app/commission");
  await expect(phone.getByTestId("owed")).toHaveText(rupees(owedBefore + earned - COMMISSION_PAY_PAISA));
  await expect(phone.getByTestId("commission-invoice").filter({ hasText: rupees(earned) })).toContainText(
    percent(COMMISSION_RATE_BP),
  );
  await expect(phone.getByTestId("commission-payment").filter({ hasText: "Paid" })).toContainText(rupees(COMMISSION_PAY_PAISA));
  await expect(phone.getByRole("button", { name: "Record payment" })).toHaveCount(0);

  // The office reverses the payment with a reason; what was paid is owed again.
  const paid = page.getByTestId("office-commission-payment").filter({ hasText: "[Test] cash" });
  await paid.getByRole("button", { name: "Reverse" }).click();
  await paid.getByLabel("Why it is reversed").fill(COMMISSION_REVERSE_REASON);
  await paid.getByRole("button", { name: "Reverse payment" }).click();
  await expect(page.getByText(`Reversed the payment of ${rupees(COMMISSION_PAY_PAISA)}.`)).toBeVisible();
  await expect(page.getByTestId("rep-owed")).toHaveText(rupees(owedBefore + earned));
  await phone.reload();
  await expect(phone.getByTestId("owed")).toHaveText(rupees(owedBefore + earned));
  // The reversal row carries the reason; the payment row is marked as later reversed.
  await expect(phone.getByTestId("commission-payment").filter({ hasText: COMMISSION_REVERSE_REASON })).toContainText(
    rupees(COMMISSION_PAY_PAISA),
  );
  await expect(phone.getByTestId("commission-payment").filter({ hasText: "[Test] cash" })).toContainText("later reversed");

  await phone.goto("/app/account");
  await expect(phone.getByTestId("account-name")).toHaveText(rep.name);
  await ctx.close();
});

test("Commission without a session sends the visitor to the sign-in page", async ({ browser }) => {
  const visitor = await newPage(browser);
  await visitor.goto("/office/commission");
  await expect(visitor).toHaveURL(OFFICE_LOGIN);
});

// Slice 1 (P1-18; D-35, D-36, D-39): the manager invites a rep and a salon on People, approves a
// proposed salon with a rep and a rate, and both invitees join. Both go through the real invitation
// page and the code GoTrue e-mails (Mailpit, then Accept). The local stack allows 30 e-mails an hour
// (supabase/config.toml, D-50), enough for the rep journey above and these two.

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

/**
 * Opens an invitation link as a guest and joins through the real page: the e-mail address, the 6-digit
 * code from the local mail catcher, then Accept. The preview answers only a session that proved the
 * mailbox (the amr claim GoTrue signs); if it does not, the message names the methods GoTrue wrote.
 */
async function joinThroughCode(browser: Browser, link: URL, email: string, expectedDetails: string) {
  const guest = await newPage(browser);
  await guest.goto(link.pathname);
  await expect(guest.getByRole("heading", { name: "Your Kiran invitation" })).toBeVisible();
  await guest.getByLabel("Email").fill(email);
  const asked = Date.now();
  await guest.getByRole("button", { name: "Send code" }).click();
  await guest.getByLabel("Code").fill(await mailedCode(email, asked));
  const previewCall = guest.waitForRequest((r) => r.url().includes("/rpc/invitation_preview"));
  await guest.getByRole("button", { name: "Sign in" }).click();
  const bearer = ((await previewCall).headers().authorization ?? "").split(" ")[1] ?? "";
  const claims = JSON.parse(Buffer.from(bearer.split(".")[1] ?? "", "base64url").toString() || "{}") as {
    amr?: Array<{ method?: string }>;
  };
  const methods = (claims.amr ?? []).map((m) => m.method).join(", ");
  await expect(guest.getByTestId("invite-details"), `amr methods in the invitee's session: ${methods || "none"}`).toHaveText(
    expectedDetails,
  );
  await guest.getByRole("button", { name: "Accept invitation" }).click();
  return guest;
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

  // The rep: invited on People, joined through the real page and the e-mailed code.
  const repLink = await invite(page, "rep", invitee.name, invitee.email);
  const repRow = page.getByRole("row").filter({ hasText: invitee.email });
  await expect(repRow).toContainText("pending");
  const repGuest = await joinThroughCode(
    browser,
    repLink,
    invitee.email,
    `${manager.name} invited ${invitee.name} to a sales rep account.`,
  );
  await repGuest.waitForURL((u) => !u.pathname.startsWith("/invite"));
  await expect(repGuest.getByRole("alert")).toHaveCount(0);
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
  const guest = await joinThroughCode(
    browser,
    salonLink,
    salonEmail,
    `${manager.name} invited [Test] Salon Owner to the salon account of ${salonName}.`,
  );
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
  // P1-30 (AUTH-09): a suspended salon is told so, in plain words, and sees no account data.
  await expect(guest.getByTestId("salon-account-state")).toHaveText(
    "This salon account is suspended by the office. Contact the office to have it reactivated.",
  );
  portalSalon = { name: salonName, email: salonEmail };
  salonPhone = await guest.context().storageState();

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
// order waits for a discount approval (OQ-33 default). The manager also uploads a picture: the stack runs the
// storage service, so the upload and the signed read go through the bucket's real policies.
// The smallest valid PNG (one transparent pixel), for the picture upload.
const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
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
  // A picture: a real 1 x 1 PNG, uploaded through the page, stored in the private bucket and shown through a signed URL.
  await card
    .getByLabel("Add a picture")
    .setInputFiles({ name: "shade.png", mimeType: "image/png", buffer: Buffer.from(ONE_PIXEL_PNG, "base64") });
  await card.getByRole("button", { name: "Upload picture" }).click();
  await expect(page.getByText(`Picture of ${productName} saved.`)).toBeVisible();
  const picture = page.getByRole("region", { name: `Product ${productName}` }).getByRole("img", { name: productName });
  await expect(picture).toBeVisible();
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await page.reload();
  await expect(
    page.getByRole("region", { name: `Product ${productName}` }).getByRole("img", { name: productName }),
  ).toBeVisible();
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

// ADM-01: on a fresh database nothing else creates a product group, and a product needs one. Groups are
// config, owner only in doc 06 section 2. The owner's changes survive a reload and reach the Add a product
// choices; the database's refusal of a repeated name is shown; a manager sees the list but no controls.
test("the owner adds, edits and deactivates a product group, and a product can use it (ADM-01)", async ({ page }) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const name = `[Dummy] Group ${Date.now()}`;
  await officeSignIn(page, owner);
  await page.getByRole("navigation", { name: "Office" }).getByRole("link", { name: "Products", exact: true }).click();

  const add = page.getByRole("form", { name: "New product group" });
  await add.getByLabel("New group name").fill(name);
  await add.getByLabel("Default cycle (days").fill("3.5");
  await add.getByRole("button", { name: "Add group" }).click();
  await expect(add.getByRole("alert")).toContainText("whole number of days");
  // The database's refusal replaces the page's own message, so this cannot pass on the stale alert above.
  await add.getByLabel("Default cycle (days").fill("400");
  await add.getByRole("button", { name: "Add group" }).click();
  await expect(add.getByRole("alert")).not.toContainText("whole number of days");
  await expect(add.getByRole("alert")).toBeVisible();
  await add.getByLabel("Default cycle (days").fill("21");
  await add.getByRole("button", { name: "Add group" }).click();
  await expect(page.getByText(`Group ${name} added.`)).toBeVisible();
  await page.reload();
  const row = page.getByRole("listitem", { name: `Group ${name}` });
  await expect(row).toContainText("21 days");
  await expect(page.locator("#new-group option", { hasText: name })).toHaveCount(1);

  await add.getByLabel("New group name").fill(name);
  await add.getByLabel("Default cycle (days").fill("30");
  await add.getByRole("button", { name: "Add group" }).click();
  await expect(add.getByRole("alert")).toBeVisible();

  await row.getByRole("button", { name: `Edit ${name}` }).click();
  await row.getByLabel("Default cycle (days)").fill("30");
  await row.getByRole("button", { name: "Save group" }).click();
  await expect(page.getByText(`${name} saved.`)).toBeVisible();
  await page.reload();
  await expect(row).toContainText("30 days");

  await row.getByRole("button", { name: `Deactivate ${name}` }).click();
  await expect(row).toContainText("Inactive");
  await expect(page.locator("#new-group option", { hasText: name })).toHaveCount(0);
  await row.getByRole("button", { name: `Activate ${name}` }).click();
  await expect(page.locator("#new-group option", { hasText: name })).toHaveCount(1);
});

test("a manager sees the product groups but no controls for them (ADM-01, doc 06 section 2)", async ({ page }) => {
  await officeSignIn(page, manager);
  await page.getByRole("navigation", { name: "Office" }).getByRole("link", { name: "Products", exact: true }).click();
  await expect(page.getByText("Only the owner adds or changes product groups")).toBeVisible();
  await expect(page.getByRole("listitem", { name: `Group ${seed.productGroup.name}` })).toBeVisible();
  await expect(page.getByRole("form", { name: "New product group" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Edit ${seed.productGroup.name}` })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Deactivate ${seed.productGroup.name}` })).toHaveCount(0);
});

// Slice 6 (P1-23; D-34, D-41): the salon invited in the slice 1 journey (suspended at its end, so the
// manager reactivates it first) sends a request from its portal; the manager converts it with one click
// on the Requests queue; the salon sees the order. The salon has no own price, so the database prices the
// seeded SKU at list: 2 x Rs 1,500 = Rs 3,000, a CASH order, confirmed at once.
const PORTAL_QTY = 2;
const PORTAL_NOTE = "[Test] for Saturday's brides";

test("a salon sends a request, the manager converts it in one click, and the salon sees its order (P1-23)", async ({
  browser,
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  expect(salonPhone, "the slice 1 journey kept the invited salon's signed-in session").not.toBeNull();
  const total = rupees(seed.sku.list_price_paisa * PORTAL_QTY);
  await officeSignIn(page, manager);
  const nav = page.getByRole("navigation", { name: "Office" });

  // The salon account the slice 1 journey suspended is made active again.
  await nav.getByRole("link", { name: "People", exact: true }).click();
  const members = page.locator("section", { has: page.getByRole("heading", { name: "Salon accounts" }) });
  const member = members.getByRole("row").filter({ hasText: portalSalon.email });
  await expect(member).toContainText("suspended");
  await member.getByRole("button", { name: "Reactivate" }).click();
  await member.getByLabel("Reason").fill("test: back for the portal");
  await member.getByRole("button", { name: "Reactivate" }).last().click();
  await expect(page.getByText("[Test] Salon Owner is now active.")).toBeVisible();

  // The salon: its catalogue at the database's price, a basket, a request that survives a reload.
  const salonContext = await browser.newContext({ storageState: salonPhone ?? undefined });
  const salon = await salonContext.newPage();
  await salon.goto("/salon");
  await expect(salon.getByRole("heading", { name: portalSalon.name })).toBeVisible();
  await expect(salon.getByTestId(`price-${seed.sku.code}`)).toHaveText(rupees(seed.sku.list_price_paisa));
  await salon.getByLabel(`Quantity of ${seed.sku.code} to add`).fill(String(PORTAL_QTY));
  await salon.getByRole("button", { name: `Add ${seed.sku.code} to the basket` }).click();
  await expect(salon.getByTestId("basket-estimate")).toContainText(total);
  await salon.getByLabel("A note for the office (optional)").fill(PORTAL_NOTE);
  await salon.getByRole("button", { name: "Send request" }).click();
  await expect(salon.getByText("Request sent. The office will make the order from it.")).toBeVisible();
  const request = salon.getByTestId("salon-request").filter({ hasText: PORTAL_NOTE });
  await expect(request).toContainText("Waiting for the office");
  await expect(request).toContainText(`${PORTAL_QTY} × ${seed.sku.code}`);
  await salon.reload();
  await expect(request).toContainText("Waiting for the office");
  // The salon reaches no office page.
  await salon.goto("/office/orders");
  await expect(salon.getByRole("navigation", { name: "Office" })).toHaveCount(0);

  // The manager: the salon's request is in the Requests queue with its lines and the database's total.
  await nav.getByRole("link", { name: "Orders", exact: true }).click();
  const queued = page.getByTestId("request").filter({ hasText: PORTAL_NOTE });
  await expect(queued).toContainText("Salon request");
  await expect(queued).toContainText(portalSalon.name);
  await expect(queued).toContainText(`${total} at these prices`);
  await queued.getByRole("button", { name: "Convert to order", exact: true }).click();
  await expect(
    page.getByText(
      `Order created for ${portalSalon.name} from the request of the salon ${portalSalon.name}: confirmed · ${total}.`,
    ),
  ).toBeVisible();
  await expect(page.getByTestId("request").filter({ hasText: PORTAL_NOTE })).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: portalSalon.name });
  await expect(row).toContainText("salon portal");
  await expect(row).toContainText(total);
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: portalSalon.name })).toContainText("confirmed");

  // The salon sees its request made into an order, and the order, after a reload.
  await salon.goto("/salon");
  await expect(salon.getByTestId("salon-request").filter({ hasText: PORTAL_NOTE })).toContainText("Made into an order");
  const order = salon.getByTestId("salon-order").filter({ hasText: `${PORTAL_QTY} × ${seed.sku.code}` });
  await expect(order).toContainText("confirmed");
  await expect(order).toContainText(total);
  await expect(order).toContainText("from your request");
  // A reviewed request can no longer be edited or cancelled: the page offers neither.
  await expect(
    salon.getByTestId("salon-request").filter({ hasText: PORTAL_NOTE }).getByRole("button", { name: "Edit request" }),
  ).toHaveCount(0);
  await salonContext.close();
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
  // Positive checks first, so the absence checks below cannot pass on an expired session or an error page:
  // the rep's Today page renders (signed in), and the office route stops at the TOTP step (the rep is AAL1).
  await phone.goto("/app");
  await expect(phone.getByRole("heading", { name: "Today", exact: false, level: 1 })).toBeVisible();
  await expect(phone.getByRole("link", { name: "Investors" })).toHaveCount(0);
  await phone.goto("/office/investors");
  await phone.waitForURL((u) => u.pathname === "/office/mfa");
  await expect(phone.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
  await expect(phone.getByRole("navigation", { name: "Office" })).toHaveCount(0);
  await expect(phone.getByText(name)).toHaveCount(0);
  await expect(phone.getByTestId("total-owed")).toHaveCount(0);
  await phoneContext.close();
});

// Slice 8 (P1-25): the delivery-approval boundary through the UI and the database (D-32; MJ's answers of
// 2026-11-05, frontend structure section 5). Rep One hands over one more unit of the order the rejection
// test left (3 ordered, 1 delivered by the commission test, so 2 left). Until the office approves: no
// new invoice, no new sale movement for the order, its status unchanged, no approve control on the rep's
// phone, and a direct call of the approval function with the rep's own identity is refused (42501).
// The manager approves on Delivery approvals: exactly one invoice more; a second approval of the same
// submission (a new key) is refused as already decided (55000) and adds nothing.
const BOUNDARY_QTY = 1;

/** Runs one query on the local stack's database as postgres. */
async function stackQuery<T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const dbUrl = process.env.KIRAN_STACK_DB_URL ?? "";
  expect(["127.0.0.1", "localhost"]).toContain(new URL(dbUrl).hostname);
  const c = new pg.Client({ connectionString: dbUrl });
  await c.connect();
  try {
    return (await c.query<T>(sql, params)).rows;
  } finally {
    await c.end();
  }
}

/** Calls one statement as the person (claims as PostgREST sets them, rolled back); returns the SQLSTATE or null. */
async function sqlstateAs(person: P, aal: "aal1" | "aal2", sql: string, params: unknown[] = []) {
  const dbUrl = process.env.KIRAN_STACK_DB_URL ?? "";
  expect(["127.0.0.1", "localhost"]).toContain(new URL(dbUrl).hostname);
  const c = new pg.Client({ connectionString: dbUrl });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: person.id, role: "authenticated", aal }),
    ]);
    await c.query("set local role authenticated");
    await c.query(sql, params);
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "unknown";
  } finally {
    await c.query("rollback").catch(() => {});
    await c.end();
  }
}

test("delivery-approval boundary: a rep's submission writes no invoice or sale; only the office's approval does, once (D-32, P1-25)", async ({
  browser,
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const orderTotal = seed.sku.list_price_paisa * REJECTED_ORDER_QTY;
  const [order] = await stackQuery<{ id: string; status: string }>(
    `select o.id, o.status::text from public.sales_order o join public.salon s on s.id = o.salon_id
      where s.name = $1 and o.total_paisa = $2`,
    [journeySalon, orderTotal],
  );
  expect(order, "the rejection test left this order").toBeDefined();
  const facts = async () =>
    (
      await stackQuery<{ invoices: number; sales: number; status: string }>(
        `select (select count(*)::int from public.invoice i where i.order_id = $1) invoices,
                (select count(*)::int from public.stock_movement m join public.delivery d on d.id = m.source_id
                  where m.kind = 'sale' and d.order_id = $1) sales,
                (select status::text from public.sales_order where id = $1) status`,
        [order.id],
      )
    )[0];
  const before = await facts();

  const { ctx, phone } = await repPhoneOpen(browser);
  await phone.goto("/app/orders");
  const row = phone
    .getByRole("listitem")
    .filter({ hasText: journeySalon })
    .filter({ hasText: rupees(orderTotal) });
  await submitDelivery(phone, row, BOUNDARY_QTY, false);
  // Nothing official yet.
  expect(await facts()).toEqual(before);
  const [submission] = await stackQuery<{ id: string }>(
    `select s.id from public.delivery_submission s
      where s.order_id = $1 and not exists (select 1 from public.delivery_submission_decision x where x.submission_id = s.id)`,
    [order.id],
  );
  expect(submission).toBeDefined();
  // The rep's phone offers no approval, and the approval function refuses the rep's own identity.
  await phone.goto("/app/deliveries");
  await expect(phone.getByRole("button", { name: "Approve delivery" })).toHaveCount(0);
  expect(await sqlstateAs(rep, "aal1", "select app.office_approve_delivery($1, gen_random_uuid())", [submission.id])).toBe(
    "42501",
  );
  expect(await facts()).toEqual(before);

  // The manager approves: one invoice and one sale movement more.
  // The salon has not signed: the database refuses the approval, and the office page offers none.
  expect(await sqlstateAs(manager, "aal2", "select app.office_approve_delivery($1, gen_random_uuid())", [submission.id])).toBe(
    "55000",
  );
  expect(await facts()).toEqual(before);
  await officeSignIn(page, manager);
  await page.getByRole("navigation", { name: "Office" }).getByRole("link", { name: "Delivery approvals", exact: true }).click();
  const unsigned = page.getByTestId("waiting-delivery").filter({ hasText: journeySalon });
  await expect(unsigned.getByTestId("signature-missing")).toBeVisible();
  await expect(unsigned.getByRole("button", { name: "Approve delivery" })).toBeDisabled();
  // The rep gets the customer's signature from My deliveries; then, and only then, the manager can approve.
  await phone.goto("/app/deliveries");
  await phone.getByRole("button", { name: "Get the customer's signature" }).click();
  await signOnScreen(phone);
  await expect(phone.getByText("The customer has signed for these goods.")).toBeVisible();
  await page.reload();
  const signedRow = page.getByTestId("waiting-delivery").filter({ hasText: journeySalon });
  await expect(signedRow.getByTestId("signature-valid")).toBeVisible();
  await signedRow.getByRole("button", { name: "Approve delivery" }).click();
  await expect(page.getByText(`Approved the delivery to ${journeySalon}; the invoice is issued.`)).toBeVisible();
  const after = await facts();
  expect(after.invoices).toBe(before.invoices + 1);
  expect(after.sales).toBe(before.sales + 1);
  // Deciding it again, with a new key, is refused and adds nothing.
  expect(await sqlstateAs(manager, "aal2", "select app.office_approve_delivery($1, gen_random_uuid())", [submission.id])).toBe(
    "55000",
  );
  expect(await facts()).toEqual(after);
  await ctx.close();
});

// J1 step 15 and B-35, moved here from the rep journey (slice 4) so the rep's day stays open for the
// delivery tests above. The bag holds what it holds now: the seeded quantity less the approved delivery.
test("the rep sends the evening count and checks out (J1 step 15, B-35)", async ({ browser }) => {
  const { ctx, phone: page } = await repPhoneOpen(browser);
  await page.goto("/app/day");
  await page.getByRole("button", { name: "Finish the day" }).click();
  await page.getByLabel(seed.sku.code).fill(String(await repBagOnHand()));
  // B-35: with a bag, check-out needs the daily close, so the page must send the evening count.
  const closeCount = page.waitForRequest((r) => r.url().includes("/rpc/record_count") && r.method() === "POST");
  await page.getByRole("button", { name: "Save count and check out" }).click();
  expect((await closeCount).postDataJSON()).toMatchObject({ p_kind: "daily_close" });
  await expect(page.getByText("Day closed. Thank you.")).toBeVisible();
  await expect(page.getByText("Today's day is closed.")).toBeVisible();
  await ctx.close();
});

// Slice 8 (P1-25): the end-to-end journey of the completion design (spec section 7; the 14 steps of
// docs/superpowers/plans/2026-11-05-final-review-checklist.md), on the screens slice 8 adds. It runs
// after the check-out above: the only rep step here (confirming a stock issue) needs no open day.
// Mail: the local stack sends at most 2 e-mails an hour and earlier journeys use both, so the new rep and
// the new salon join through the real invitation page and the e-mailed code; the browser steps of a
// salon use the slice 1 salon's kept session (portalSalon), and of a rep Rep One's kept phone.
// Amounts, hand-worked in paisa:
//   new SKU list price Rs 100 = 10_000; opening stock 10 units (Rs 1,000: under the adjustment owner
//   threshold of 10 units and Rs 10,000, migration 0001 config; the owner approves anyway);
//   2 units issued to Rep One's bag: CTL-05 bag value after the issue is what the bag holds of the seed
//   SKU (6 seeded - 2 - 1 - 1 delivered = 2 x Rs 1,500 = Rs 3,000) + 2 x Rs 100 = Rs 3,200, under the
//   seeded Rs 10,000 limit;
//   the salon requests 3 at list = Rs 300 = 30_000, CASH, confirmed; the office delivers all 3 from the
//   warehouse: invoice Rs 300; warehouse left 10 - 2 - 3 = 5; the salon pays Rs 100 = 10_000 cash, so its
//   balance moves by +30_000 - 10_000; no rep, so no commission (Rep One's owed figure unchanged).
const J8_LIST_RS = 100;
const J8_LIST_PAISA = 10_000;
const J8_OPENING = 10;
const J8_ISSUE = 2;
const J8_SALON_QTY = 3;
const J8_WAREHOUSE_LEFT = J8_OPENING - J8_ISSUE - J8_SALON_QTY;
const J8_PAY_RS = 100;
const J8_PAY_PAISA = 10_000;
const J8_BAG_LIMIT_RS = 5000;
const J8_TIMEOUT_MS = 360_000;
const P1_19_TOTAL_RS = 900; // the slice 2 test's order: 1 x Rs 900 salon price, held for a Rs 100 discount
const PAISA_DIGITS = 2;
const TAG_RADIX = 36; // a short run tag: the time in base 36

/** "Rs 1,234.5" as the pages print it (lib/money.ts) back to paisa, without floating point. */
function paisaOf(text: string) {
  // Keeps digits and the decimal point: "Rs 1,234.5" becomes "1234.5"; "Rs" and "," are dropped.
  // https://regex101.com/?regex=%5B%5E%5Cd.%5D&flavor=javascript
  const [whole, fraction = ""] = text.replace(/[^\d.]/g, "").split(".");
  return Number(whole) * PAISA_PER_RUPEE + Number(fraction.padEnd(PAISA_DIGITS, "0"));
}

test("end to end: invite, catalogue, opening stock, a stock issue the rep confirms, a salon request delivered by the office, payment, cancel and approvals (P1-25)", async ({
  browser,
  page,
}) => {
  test.setTimeout(J8_TIMEOUT_MS);
  expect(salonPhone, "the slice 1 journey kept the invited salon's signed-in session").not.toBeNull();
  const tag = Date.now().toString(TAG_RADIX).toUpperCase();
  const code = `J8-${tag}`;
  const productName = `[Dummy] Journey colour ${tag}`;
  const newSalonName = `[Test] Journey salon ${tag}`;
  const bagName = `[Test] Journey bag ${tag}`;
  const requestNote = `[Test] journey request ${tag}`;
  const list = rupees(J8_LIST_PAISA);
  const requestTotal = rupees(J8_LIST_PAISA * J8_SALON_QTY);
  const owedBefore = await repOwedPaisa();
  const nav = () => page.getByRole("navigation", { name: "Office" });

  // 1-2. The manager invites a rep and a salon; both join by invitation through the real page and the e-mailed code.
  await officeSignIn(page, manager);
  await nav().getByRole("link", { name: "People", exact: true }).click();
  const repLink = await invite(page, "rep", journeyRep.name, journeyRep.email);
  const repJoined = await joinThroughCode(
    browser,
    repLink,
    journeyRep.email,
    `${manager.name} invited ${journeyRep.name} to a sales rep account.`,
  );
  await repJoined.waitForURL((u) => !u.pathname.startsWith("/invite"));
  await repJoined.context().close();
  const salonLink = await invite(page, "salon", salonInvitee.name, salonInvitee.email, {
    name: newSalonName,
    area: seed.pendingSalon.area,
  });
  const salonJoined = await joinThroughCode(
    browser,
    salonLink,
    salonInvitee.email,
    `${manager.name} invited ${salonInvitee.name} to the salon account of ${newSalonName}.`,
  );
  await salonJoined.waitForURL((u) => u.pathname === "/salon");
  await salonJoined.context().close();
  await page.reload();
  const repsSection = page.locator("section", { has: page.getByRole("heading", { name: "Reps" }) });
  await expect(repsSection.getByRole("row").filter({ hasText: journeyRep.name })).toContainText("active");
  const members = page.locator("section", { has: page.getByRole("heading", { name: "Salon accounts" }) });
  await expect(members.getByRole("row").filter({ hasText: salonInvitee.email })).toContainText("active");

  // 3. A [Dummy] product with a SKU and a list price (no picture: no storage-api in this stack).
  await nav().getByRole("link", { name: "Products", exact: true }).click();
  const add = page.getByRole("form", { name: "Add a product" });
  await add.getByLabel("Product group").selectOption({ label: seed.productGroup.name });
  await add.getByLabel("Brand label").fill("[Dummy] Kiran");
  await add.getByLabel("Product name").fill(productName);
  await add.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByText(`Product ${productName} added.`)).toBeVisible();
  const card = page.getByRole("region", { name: `Product ${productName}` });
  const addSku = card.getByRole("form", { name: `Add a SKU to ${productName}` });
  await addSku.getByLabel("SKU code").fill(code);
  await addSku.getByLabel("Variant").fill("[Dummy] Shade 8");
  await addSku.getByRole("button", { name: "Add SKU" }).click();
  await expect(page.getByText(`SKU ${code} added to ${productName}.`)).toBeVisible();
  await card.getByLabel(`List price (Rs) for ${code}`).fill(String(J8_LIST_RS));
  await card.getByLabel(`Why this price for ${code}`).fill("[Test] journey list price");
  await card.getByRole("button", { name: `Set price of ${code}` }).click();
  await expect(page.getByText(`${code} now lists at ${list}.`)).toBeVisible();

  // Opening stock: the manager asks; the manager sees no rep-bag form (A-08, owner only).
  await nav().getByRole("link", { name: "Stock", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Stock", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("form", { name: "Add a rep bag" })).toHaveCount(0);
  const opening = page.getByRole("form", { name: "Ask for opening stock" });
  await opening.getByLabel("Warehouse for the opening stock").selectOption({ label: seed.warehouse.name });
  const openingSku = opening.locator("#opening-sku option", { hasText: code });
  await opening.getByLabel("SKU for the opening stock").selectOption((await openingSku.getAttribute("value")) ?? "");
  await opening.getByLabel("Units counted in").fill(String(J8_OPENING));
  await opening.getByLabel("Why (for the approver)").fill("[Test] journey opening count");
  await opening.getByRole("button", { name: "Ask for approval" }).click();
  await expect(page.getByText("Opening stock requested; the owner approves it on Approvals.")).toBeVisible();
  await expect(page.getByTestId("adjustment").filter({ hasText: code })).toContainText("waiting for approval");
  // The maker sees its own request on Approvals with no buttons (maker is not checker, H-12).
  await nav().getByRole("link", { name: "Approvals", exact: true }).click();
  const mine = page.getByTestId("approval").filter({ hasText: code });
  await expect(mine).toContainText("You asked for this; another office user decides it.");
  await expect(mine.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);

  // The owner, in a second browser: approves the adjustment and the slice 2 test's held discount.
  const ownerPage = await newPage(browser);
  await officeSignIn(ownerPage, owner);
  const ownerNav = () => ownerPage.getByRole("navigation", { name: "Office" });
  await ownerNav().getByRole("link", { name: "Approvals", exact: true }).click();
  await expect(ownerPage.getByRole("heading", { name: "Approvals", exact: true, level: 1 })).toBeVisible();
  const adjustment = ownerPage.getByTestId("approval").filter({ hasText: code });
  await expect(adjustment).toContainText(`+${J8_OPENING} units`);
  await adjustment.getByRole("button", { name: "Approve", exact: true }).click();
  await adjustment.getByLabel("Checked how").fill("[Test] counted with the manager");
  await adjustment.getByRole("button", { name: "Approve request" }).click();
  await expect(ownerPage.getByText("Approved the adjustment request. Post it on the Stock page.")).toBeVisible();
  const discount = ownerPage
    .getByTestId("approval")
    .filter({ hasText: seed.catalogueSalon.name })
    .filter({ hasText: `total ${rupees(P1_19_TOTAL_RS * PAISA_PER_RUPEE)}` });
  await discount.getByRole("button", { name: "Approve", exact: true }).click();
  await discount.getByLabel("Checked how").fill("[Test] agreed salon price");
  await discount.getByRole("button", { name: "Approve request" }).click();
  await expect(ownerPage.getByText("Approved the discount request. The order is now confirmed.")).toBeVisible();
  // Decided, it leaves the manager's queue.
  await page.reload();
  await expect(page.getByTestId("approval").filter({ hasText: code })).toHaveCount(0);

  // The owner posts the approved adjustment, makes the new rep's bag and issues stock to Rep One's bag.
  await ownerNav().getByRole("link", { name: "Stock", exact: true }).click();
  await ownerPage.getByTestId("adjustment").filter({ hasText: code }).getByRole("button", { name: "Post to stock" }).click();
  await expect(ownerPage.getByText(`Posted: ${J8_OPENING} units of ${code} at ${seed.warehouse.name}.`)).toBeVisible();
  const onHand = () =>
    ownerPage.getByTestId("on-hand").filter({ hasText: seed.warehouse.name }).filter({ hasText: code }).locator("td").last();
  await expect(onHand()).toHaveText(String(J8_OPENING));
  const bagForm = ownerPage.getByRole("form", { name: "Add a rep bag" });
  await bagForm.getByLabel("Rep for the bag").selectOption({ label: journeyRep.name });
  await bagForm.getByLabel("Bag name").fill(bagName);
  await bagForm.getByLabel("Bag value limit (Rs, at list price)").fill(String(J8_BAG_LIMIT_RS));
  await bagForm.getByRole("button", { name: "Add bag" }).click();
  await expect(
    ownerPage.getByText(`Bag ${bagName} added with a value limit of ${rupees(J8_BAG_LIMIT_RS * PAISA_PER_RUPEE)}.`),
  ).toBeVisible();
  await expect(
    ownerPage.getByTestId("stock-location").filter({ hasText: journeyRep.name }).filter({ hasText: "rep bag" }),
  ).toContainText(bagName);
  const issue = ownerPage.getByRole("form", { name: "Issue stock to a bag" });
  await issue.getByLabel("From warehouse").selectOption({ label: seed.warehouse.name });
  await issue.getByLabel("To the bag of").selectOption({ label: `${rep.name} · [Test] Rep One bag` });
  const issueSku = issue.locator("#issue-sku-0 option", { hasText: code });
  await issue.getByLabel("Issue SKU 1").selectOption((await issueSku.getAttribute("value")) ?? "");
  await issue.getByLabel("Issue quantity 1").fill(String(J8_ISSUE));
  await issue.getByRole("button", { name: "Propose the issue" }).click();
  await expect(ownerPage.getByText("Stock issue proposed. Nothing moves until the rep confirms the same count.")).toBeVisible();
  await expect(ownerPage.getByTestId("stock-issue").filter({ hasText: code })).toContainText("pending");
  await expect(onHand()).toHaveText(String(J8_OPENING));

  // Rep One confirms with its own count (blind: the page does not show the office's quantity).
  const { ctx: repCtx, phone } = await repPhoneOpen(browser);
  await phone.goto("/app");
  await phone.getByRole("link", { name: "My bag and incoming stock" }).click();
  const count = phone.getByLabel(`Counted of incoming ${code}`);
  await count.fill(String(J8_ISSUE));
  await phone.getByTestId("incoming-issue").filter({ has: count }).getByRole("button", { name: "Confirm my count" }).click();
  await expect(phone.getByText("Confirmed: the stock is in your bag.")).toBeVisible();
  await phone.reload();
  await expect(phone.getByTestId("bag-line").filter({ hasText: code })).toContainText(`: ${J8_ISSUE}`);
  await expect(phone.getByTestId("incoming-issue")).toHaveCount(0);
  await ownerPage.reload();
  await expect(ownerPage.getByTestId("stock-issue").filter({ hasText: code })).toContainText("confirmed");
  await expect(onHand()).toHaveText(String(J8_OPENING - J8_ISSUE));
  // The rep reaches no office stock page.
  await phone.goto("/office/stock");
  await phone.waitForURL((u) => u.pathname === "/office/mfa");
  await expect(phone.getByRole("navigation", { name: "Office" })).toHaveCount(0);
  await repCtx.close();

  // 4. The salon requests the new SKU at the database's price.
  const salonContext = await browser.newContext({ storageState: salonPhone ?? undefined });
  const salon = await salonContext.newPage();
  await salon.goto("/salon");
  await expect(salon.getByTestId(`price-${code}`)).toHaveText(list);
  await salon.getByLabel(`Quantity of ${code} to add`).fill(String(J8_SALON_QTY));
  await salon.getByRole("button", { name: `Add ${code} to the basket` }).click();
  await salon.getByLabel("A note for the office (optional)").fill(requestNote);
  await salon.getByRole("button", { name: "Send request" }).click();
  await expect(salon.getByText("Request sent. The office will make the order from it.")).toBeVisible();
  const balanceBefore = paisaOf(await salon.getByTestId("salon-balance").innerText());

  // 5-6. The manager converts it in one click; the order page shows no invoice yet and the timeline.
  await nav().getByRole("link", { name: "Orders", exact: true }).click();
  await page
    .getByTestId("request")
    .filter({ hasText: requestNote })
    .getByRole("button", { name: "Convert to order", exact: true })
    .click();
  await expect(
    page.getByText(
      `Order created for ${portalSalon.name} from the request of the salon ${portalSalon.name}: confirmed · ${requestTotal}.`,
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: `Open the order for ${portalSalon.name} of ${requestTotal}`, exact: true }).click();
  await expect(page.getByRole("heading", { name: `Order for ${portalSalon.name}`, level: 1 })).toBeVisible();
  await expect(page.getByTestId("order-status")).toHaveText("confirmed");
  await expect(page.getByText("No invoice yet: an invoice is issued only when a delivery is recorded.")).toBeVisible();
  const timeline = page.getByTestId("order-timeline");
  await expect(timeline).toContainText("request sent");
  await expect(timeline).toContainText("request converted");
  await expect(timeline).toContainText("order created");

  // 6b. Prepare the invoice (P1-31, D-49): a draft that is clearly a draft, with display words only.
  const orderUrl = page.url();
  await page.getByRole("link", { name: "Prepare the invoice" }).click();
  await expect(page.getByTestId("draft-banner")).toHaveText("DRAFT — NOT AN OFFICIAL INVOICE");
  await expect(page.getByTestId("doc-number")).toHaveText("No number until it is issued");
  await expect(page.getByTestId("doc-total")).toHaveText(requestTotal);
  await page.getByLabel(`What the customer reads for ${code}`).fill("Rose shade, 100 ml");
  await page.getByLabel("A note for the customer (optional)").fill("Thank you for your order");
  await page.getByRole("button", { name: "Save these words" }).click();
  await expect(page.getByText("Saved. These words will be on the invoice when it is issued.")).toBeVisible();
  await expect(page.getByTestId("doc-notes")).toHaveText("Thank you for your order");
  await expect(page.getByTestId("doc-total")).toHaveText(requestTotal);
  await page.goto(orderUrl);

  // 7-8. A rep-less order: the office delivers it from the warehouse (A-18); the invoice appears.
  const deliver = page.getByRole("form", { name: "Deliver from a warehouse" });
  await deliver.getByLabel("Warehouse", { exact: true }).selectOption({ label: seed.warehouse.name });
  const deliverQty = deliver.getByLabel(`Quantity to deliver of ${code}`);
  await expect(deliverQty).toHaveValue(String(J8_SALON_QTY));
  await deliver.getByLabel("Received by (name)").fill(RECEIVER);
  // One more than is left: the salon signs for it, the database refuses to record it and the page shows its words;
  // nothing is written. Then the right quantity: the salon signs for exactly that and the delivery is made.
  await deliverQty.fill(String(J8_SALON_QTY + 1));
  await deliver.getByRole("button", { name: "Next: the salon signs for the goods" }).click();
  await expect(page.getByTestId("acknowledgement").getByRole("button", { name: "Skip for now" })).toHaveCount(0);
  await signOnScreen(page);
  await expect(page.getByTestId("acknowledgement").getByRole("alert")).toHaveText(
    "every line must be a SKU of this order, at most what is left to deliver",
  );
  await page.getByRole("button", { name: "Back to the delivery form" }).click();
  await expect(page.getByTestId("order-status")).toHaveText("confirmed");
  await deliverQty.fill(String(J8_SALON_QTY));
  await deliver.getByRole("button", { name: "Next: the salon signs for the goods" }).click();
  await signOnScreen(page);
  await expect(page.getByText(`Delivered to ${portalSalon.name} from the warehouse: invoice INV-`)).toBeVisible();
  await expect(page.getByTestId("order-status")).toHaveText("delivered");
  await page.reload();
  await expect(page.getByTestId("order-status")).toHaveText("delivered");
  await expect(page.getByTestId("order-invoice")).toContainText("INV-");
  await expect(page.getByTestId("order-invoice")).toContainText(requestTotal);
  await expect(timeline).toContainText("delivery recorded");
  await expect(timeline).toContainText("invoice issued");
  // The issued invoice carries the prepared words, the customer, the delivery person and the salon's acknowledgement.
  await page.getByTestId("order-invoice").getByRole("link").first().click();
  await expect(page.getByTestId("draft-banner")).toHaveCount(0);
  await expect(page.getByTestId("doc-number")).toContainText("INV-");
  await expect(page.getByTestId("doc-notes")).toHaveText("Thank you for your order");
  await expect(page.getByTestId("doc-line").first()).toContainText("Rose shade, 100 ml");
  await expect(page.getByTestId("doc-total")).toHaveText(requestTotal);
  await expect(page.getByTestId("doc-deliverer")).toBeVisible();
  await expect(page.getByTestId("doc-ack")).toContainText("Ayesha Khan, Owner");
  const issuedNumber = await page.getByTestId("doc-number").innerText();
  // A reprint is the same invoice: the same number and total after a reload, and no second invoice on the order.
  await page.reload();
  await expect(page.getByTestId("doc-number")).toHaveText(issuedNumber);
  await expect(page.getByTestId("doc-total")).toHaveText(requestTotal);
  await page.goBack();
  await expect(page.getByTestId("order-invoice")).toHaveCount(1);
  // 9. No rep, so no commission: Rep One's owed figure is unchanged.
  expect(await repOwedPaisa()).toBe(owedBefore);
  await ownerPage.reload();
  await expect(onHand()).toHaveText(String(J8_WAREHOUSE_LEFT));

  // 10-12. The office records a cash payment on the salon page; the salon sees its balance and order.
  await page.getByRole("link", { name: portalSalon.name, exact: true }).click();
  await expect(page.getByTestId("balance")).toHaveText(rupees(balanceBefore + J8_LIST_PAISA * J8_SALON_QTY));
  await page.getByLabel("Amount (Rs)", { exact: true }).fill(String(J8_PAY_RS));
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded. Receipt")).toBeVisible();
  const balanceAfter = rupees(balanceBefore + J8_LIST_PAISA * J8_SALON_QTY - J8_PAY_PAISA);
  await expect(page.getByTestId("balance")).toHaveText(balanceAfter);
  await salon.reload();
  await expect(salon.getByTestId("salon-balance")).toHaveText(balanceAfter);
  await expect(salon.getByTestId("salon-order").filter({ hasText: `${J8_SALON_QTY} × ${code}` })).toContainText("delivered");
  // The salon lists and opens its own invoice, with the words the office prepared and what is still to pay.
  const invoiceRow = salon.getByTestId("salon-invoice-row").filter({ hasText: issuedNumber });
  await expect(invoiceRow).toBeVisible();
  await invoiceRow.getByRole("link", { name: issuedNumber }).click();
  await expect(salon.getByTestId("doc-number")).toHaveText(issuedNumber);
  await expect(salon.getByTestId("doc-notes")).toHaveText("Thank you for your order");
  await expect(salon.getByTestId("doc-outstanding")).toBeVisible();
  await salonContext.close();
  // 14. The salon's timeline on the office salon page, read again after a reload.
  await page.reload();
  await expect(page.getByTestId("balance")).toHaveText(balanceAfter);
  const salonTimeline = page.getByTestId("salon-timeline");
  await expect(salonTimeline).toContainText("delivery recorded");
  await expect(salonTimeline).toContainText("invoice issued");
  await expect(salonTimeline).toContainText("payment recorded");

  // Cancel with a reason: a direct order for the catalogue salon, then cancelled on its page.
  await nav().getByRole("link", { name: "Orders", exact: true }).click();
  await page.getByRole("button", { name: "Create New Order" }).click();
  const form = page.getByRole("form", { name: "New order" });
  await form.getByLabel("Salon", { exact: true }).selectOption(seed.catalogueSalon.id);
  const lineOption = form.locator("select[id^='sku-'] option", { hasText: code });
  await form.getByLabel("Product 1").selectOption((await lineOption.getAttribute("value")) ?? "");
  await form.getByLabel("Quantity 1").fill("1");
  await form.getByLabel("Plan").selectOption("CASH");
  await form.getByRole("button", { name: "Create order" }).click();
  await expect(page.getByText(`Order created for ${seed.catalogueSalon.name}: confirmed · ${list}.`)).toBeVisible();
  await page.getByRole("link", { name: `Open the order for ${seed.catalogueSalon.name} of ${list}`, exact: true }).click();
  await page.getByRole("button", { name: "Cancel order" }).click();
  await page.getByLabel("Why the order is cancelled").fill("[Test] the salon changed its mind");
  await page.getByRole("button", { name: "Cancel this order" }).click();
  await expect(page.getByText("The order is cancelled.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("order-status")).toHaveText("cancelled");
  await expect(page.getByRole("form", { name: "Deliver from a warehouse" })).toHaveCount(0);

  // 13. An investor entry.
  await nav().getByRole("link", { name: "Investors", exact: true }).click();
  const investor = `[Dummy] Journey investor ${tag}`;
  const addInvestor = page.getByRole("form", { name: "Add an investor" });
  await addInvestor.getByLabel("Name").fill(investor);
  await addInvestor.getByRole("button", { name: "Add investor" }).click();
  await expect(page.getByText(`Investor ${investor} added.`)).toBeVisible();
  await ownerPage.context().close();
});

test("Stock and Approvals without a session send the visitor to the sign-in page", async ({ browser }) => {
  const visitor = await newPage(browser);
  await visitor.goto("/office/stock");
  await expect(visitor).toHaveURL(OFFICE_LOGIN);
  await visitor.goto("/office/approvals");
  await expect(visitor).toHaveURL(OFFICE_LOGIN);
});

// Slice 11 (P1-29): routes and the stock leftovers. They run after the slice 8 journey on Rep One's kept
// phone; none of the rep steps here needs an open day. Setup goes through the app.* functions as the owner,
// and stock arrives as postgres, the way the seed does; nothing here touches another journey's data.
const R11_TODAY = "(now() at time zone 'Asia/Karachi')::date";
// The seeded product group's cycle is 30 days: a purchase 40 days ago is overdue (not yet at risk, 45).
const R11_LAST_PURCHASE_DAYS_AGO = 40;
const R11_POINT = 5;
const R11_RECEIVED = 7;
const R11_TO_BAG = 3;
const R11_BACK = 1;
const R11_LEFT_IN_BAG = R11_TO_BAG - R11_BACK;
const R11_IN_WAREHOUSE = R11_RECEIVED - R11_TO_BAG + R11_BACK;
const R11_COUNTED = R11_IN_WAREHOUSE - 1;
const R11_LOST_QTY = 3;
const R11_PRICE_PAISA = 10_000;
const R11_SIZE_ML = 100;
const R11_TWO_STOPS = 2;
const R11_THREE_STOPS = 3;
const R11_THIRD_STOP = 2; // nth counts from 0
/** A salon of the route journey, kept for the lost-demand step of the next test. */
let r11Salon = { id: "", name: "" };

/** One committed statement on the local database as a signed-in office person, or as postgres. */
async function r11Sql(as: P | null, sql: string, params: unknown[] = []) {
  const dbUrl = process.env.KIRAN_STACK_DB_URL ?? "";
  expect(["127.0.0.1", "localhost"]).toContain(new URL(dbUrl).hostname);
  const c = new pg.Client({ connectionString: dbUrl });
  await c.connect();
  try {
    await c.query("begin");
    if (as) {
      await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.headers', '{}', true)", [
        JSON.stringify({ sub: as.id, role: "authenticated", aal: "aal2" }),
      ]);
      await c.query("set local role authenticated");
    }
    const r = await c.query(sql, params);
    await c.query("commit");
    return r.rows as Array<Record<string, unknown>>;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

test("a manager builds a rep's route, the rep sees it in order and reorders it, and other roles are refused (P1-29)", async ({
  page,
  browser,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const tag = String(Date.now());
  const territory = randomUUID();
  const otherTerritory = randomUUID();
  const area = randomUUID();
  const otherArea = randomUUID();
  const salon = (name: string) => ({ id: randomUUID(), name: `[Test] Route ${name} ${tag}` });
  const [dueSalon, plannedSalon, repAddedSalon, outsideSalon] = [
    salon("due"),
    salon("planned"),
    salon("added"),
    salon("outside"),
  ];
  await r11Sql(owner, "select app.office_upsert_territory($1, $2)", [territory, `[Test] Route territory ${tag}`]);
  await r11Sql(owner, "select app.office_upsert_area($1, $2, $3)", [area, territory, `[Test] Route area ${tag}`]);
  await r11Sql(owner, "select app.office_upsert_territory($1, $2)", [otherTerritory, `[Test] Other territory ${tag}`]);
  await r11Sql(owner, "select app.office_upsert_area($1, $2, $3)", [otherArea, otherTerritory, `[Test] Other area ${tag}`]);
  await Promise.all(
    [dueSalon, plannedSalon, repAddedSalon].map((s) =>
      r11Sql(owner, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'manual')", [s.id, s.name, area]),
    ),
  );
  await r11Sql(owner, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'manual')", [
    outsideSalon.id,
    outsideSalon.name,
    otherArea,
  ]);
  await r11Sql(owner, "select app.office_assign_territory($1, $2)", [rep.id, territory]);
  const group = await r11Sql(null, "select id from public.product_group where name = $1", [seed.productGroup.name]);
  await r11Sql(owner, `select app.office_set_last_purchase($1, $2, ${R11_TODAY} - ${R11_LAST_PURCHASE_DAYS_AGO})`, [
    dueSalon.id,
    group[0].id,
  ]);
  r11Salon = plannedSalon;

  // The manager picks the rep, adds a due salon and a chosen one, puts them in order and saves.
  await officeSignIn(page, manager);
  await page.goto("/office/routes");
  const pickRep = () => page.getByLabel("Rep for the route").selectOption({ label: rep.name });
  const officeStops = page.getByTestId("route-stop");
  await pickRep();
  const dueRow = page.getByTestId("route-due").filter({ hasText: dueSalon.name });
  await expect(dueRow).toContainText("overdue");
  await dueRow.getByRole("button", { name: "from the due list" }).click();
  const addForm = page.getByRole("form", { name: "Add a salon to the route" });
  // A salon outside the rep's territories is not offered.
  await expect(addForm.getByLabel("Salon for the new stop").locator("option", { hasText: outsideSalon.name })).toHaveCount(0);
  await addForm.getByLabel("Salon for the new stop").selectOption(plannedSalon.id);
  await addForm.getByLabel("Reason for the new stop").selectOption("prospect");
  await addForm.getByRole("button", { name: "Add stop" }).click();
  await expect(officeStops).toHaveCount(R11_TWO_STOPS);
  await page.getByRole("button", { name: `Move ${plannedSalon.name} up` }).click();
  await page.getByRole("button", { name: "Save route" }).click();
  await expect(page.getByText(`Route saved for ${rep.name}`)).toBeVisible();
  await page.reload();
  await pickRep();
  await expect(officeStops).toHaveCount(R11_TWO_STOPS);
  await expect(officeStops.nth(0)).toContainText(plannedSalon.name);
  await expect(officeStops.nth(1)).toContainText(dueSalon.name);

  // The rep's phone shows the same order, then the rep changes it and adds a stop of its own.
  const { ctx, phone } = await repPhoneOpen(browser);
  await phone.goto("/app");
  await phone.getByRole("link", { name: "My route" }).click();
  await phone.waitForURL((u) => u.pathname === "/app/route");
  const repStops = phone.getByTestId("my-route-stop");
  await expect(repStops).toHaveCount(R11_TWO_STOPS);
  await expect(repStops.nth(0)).toContainText(plannedSalon.name);
  await expect(repStops.nth(1)).toContainText(dueSalon.name);
  await phone.getByRole("button", { name: `Move ${dueSalon.name} up` }).click();
  await expect(phone.getByText("Route reordered.")).toBeVisible();
  await phone.reload();
  await expect(repStops.nth(0)).toContainText(dueSalon.name);
  await expect(repStops.nth(1)).toContainText(plannedSalon.name);
  const addMine = phone.getByRole("form", { name: "Add a stop from my salons" });
  await addMine.getByLabel("Add one of my salons").selectOption(repAddedSalon.id);
  await addMine.getByRole("button", { name: "Add stop" }).click();
  await expect(phone.getByText(`Added ${repAddedSalon.name} to today's route.`)).toBeVisible();
  await expect(repStops).toHaveCount(R11_THREE_STOPS);
  await expect(repStops.nth(R11_THIRD_STOP)).toContainText(repAddedSalon.name);

  // The office sees the rep's order and its stop; saving again keeps that stop, as a manual one, because
  // the database refuses the rep's own reason from the office.
  await page.reload();
  await pickRep();
  await expect(officeStops).toHaveCount(R11_THREE_STOPS);
  await expect(officeStops.nth(0)).toContainText(dueSalon.name);
  await expect(officeStops.nth(R11_THIRD_STOP)).toContainText("added by the rep");
  await page.getByRole("button", { name: `Remove ${plannedSalon.name}` }).click();
  await page.getByRole("button", { name: "Save route" }).click();
  await expect(page.getByText(`Route saved for ${rep.name}`)).toBeVisible();
  const saved = await r11Sql(
    null,
    `select st.salon_id, st.sequence, st.reason from public.route_stop st join public.route r on r.id = st.route_id
      where r.rep_id = $1 and r.day = ${R11_TODAY} order by st.sequence`,
    [rep.id],
  );
  expect(saved.map((s) => [s.salon_id, s.reason])).toEqual([
    [dueSalon.id, "reorder_due"],
    [repAddedSalon.id, "manual"],
  ]);
  await phone.reload();
  await expect(repStops).toHaveCount(R11_TWO_STOPS);
  await expect(repStops.nth(1)).toContainText(repAddedSalon.name);

  // Refused: a salon the rep does not hold, even by the manager; the function itself for a rep.
  const stop = JSON.stringify([{ salon_id: outsideSalon.id, reason: "manual" }]);
  expect(await sqlstateAs(manager, "aal2", `select app.office_set_route($1, ${R11_TODAY}, $2::jsonb)`, [rep.id, stop])).toBe(
    "22023",
  );
  expect(await sqlstateAs(rep, "aal1", `select app.office_set_route($1, ${R11_TODAY}, '[]'::jsonb)`, [rep.id])).toBe("42501");
  // The rep cannot open the office page, and a signed-out visitor is sent to sign in.
  await phone.goto("/office/routes");
  await phone.waitForURL((u) => u.pathname === "/office/mfa");
  await expect(phone.getByRole("navigation", { name: "Office" })).toHaveCount(0);
  await ctx.close();
  const visitor = await newPage(browser);
  await visitor.goto("/office/routes");
  await expect(visitor).toHaveURL(OFFICE_LOGIN);
  await visitor.goto("/office/stock/levels");
  await expect(visitor).toHaveURL(OFFICE_LOGIN);
});

test("reorder point and low stock, a bag return the rep confirms, a count with its variance, and a lost-demand tap (P1-29)", async ({
  page,
  browser,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const tag = String(Date.now());
  const code = `R11-${tag}`;
  const skuId = randomUUID();
  const product = randomUUID();
  const warehouse = { id: randomUUID(), name: `[Test] Levels warehouse ${tag}` };
  const group = await r11Sql(null, "select id from public.product_group where name = $1", [seed.productGroup.name]);
  await r11Sql(owner, "select app.office_upsert_product($1, $2, $3, $4)", [
    product,
    group[0].id,
    "[Dummy] Kiran",
    `[Dummy] Levels ${tag}`,
  ]);
  await r11Sql(owner, "select app.office_upsert_sku($1, $2, $3, $4, 'ml', $5)", [
    skuId,
    product,
    code,
    "[Dummy] Levels",
    R11_SIZE_ML,
  ]);
  await r11Sql(owner, "select app.owner_set_sku_price($1, $2, $3)", [skuId, R11_PRICE_PAISA, "[Test] e2e list price"]);
  await r11Sql(owner, "select app.office_create_location($1, 'warehouse', $2)", [warehouse.id, warehouse.name]);

  // A reorder point on a SKU with no stock: it is listed as low, with the database's figures.
  await officeSignIn(page, manager);
  await page.goto("/office/stock/levels");
  const level = page.getByTestId("sku-level").filter({ hasText: code });
  const low = page.getByTestId("low-stock").filter({ hasText: code });
  await expect(low).toHaveCount(0);
  await level.getByLabel(`Reorder point for ${code}`, { exact: true }).fill(String(R11_POINT));
  await level.getByRole("button", { name: `Save the reorder point for ${code}` }).click();
  await expect(page.getByText(`Reorder point of ${code} set to ${R11_POINT}.`)).toBeVisible();
  await expect(low.getByTestId("low-on-hand")).toHaveText("0");
  await expect(low.getByTestId("low-point")).toHaveText(String(R11_POINT));
  await page.reload();
  await expect(level.getByLabel(`Reorder point for ${code}`, { exact: true })).toHaveValue(String(R11_POINT));
  await expect(low).toHaveCount(1);

  // Stock arrives above the point: the SKU leaves the list and availability shows it.
  await r11Sql(
    null,
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, $2, $3, 'receipt', $4)`,
    [skuId, R11_RECEIVED, warehouse.id, owner.id],
  );
  await page.reload();
  await expect(level.getByTestId("sku-available")).toHaveText(String(R11_RECEIVED));
  await expect(low).toHaveCount(0);

  // A bag return: the office proposes it, nothing moves, the rep counts and confirms on its phone.
  const bag = await r11Sql(null, "select id, name from public.stock_location where kind = 'rep_bag' and owner_user_id = $1", [
    rep.id,
  ]);
  await r11Sql(
    null,
    `insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, $2, $3, $4, 'issue_to_rep', $5)`,
    [skuId, R11_TO_BAG, warehouse.id, bag[0].id, owner.id],
  );
  await page.goto("/office/stock");
  const back = page.getByRole("form", { name: "Take stock back from a bag" });
  await back.getByLabel("Take back from the bag of").selectOption({ label: `${rep.name} · ${String(bag[0].name)}` });
  await back.getByLabel("Into warehouse").selectOption({ label: warehouse.name });
  await back.getByLabel(`Units back of ${code}`).fill(String(R11_BACK));
  await back.getByRole("button", { name: "Propose the return" }).click();
  await expect(page.getByText("Return proposed. Nothing moves until the rep confirms the same count.")).toBeVisible();
  const issueRow = page.getByTestId("stock-issue").filter({ hasText: code });
  await expect(issueRow).toContainText("Return from");
  await expect(issueRow).toContainText("pending");
  const warehouseOnHand = page
    .getByTestId("on-hand")
    .filter({ hasText: warehouse.name })
    .filter({ hasText: code })
    .locator("td")
    .last();
  await expect(warehouseOnHand).toHaveText(String(R11_RECEIVED - R11_TO_BAG));

  const { ctx, phone } = await repPhoneOpen(browser);
  await phone.goto("/app/stock");
  await phone.getByLabel(`Counted going back ${code}`).fill(String(R11_BACK));
  await phone.getByTestId("outgoing-return").getByRole("button", { name: "Confirm my count" }).click();
  await expect(phone.getByText("Confirmed: the stock has gone back to the warehouse.")).toBeVisible();
  await expect(phone.getByTestId("bag-line").filter({ hasText: code })).toContainText(`: ${R11_LEFT_IN_BAG}`);
  await expect(phone.getByTestId("warehouse-line").filter({ hasText: code })).toContainText(`: ${R11_IN_WAREHOUSE}`);
  await page.reload();
  await expect(issueRow).toContainText("confirmed");
  await expect(warehouseOnHand).toHaveText(String(R11_IN_WAREHOUSE));

  // A stock take one short: the variance is recorded and stock does not change.
  await page.goto("/office/stock/levels");
  const count = page.getByRole("form", { name: "Record a stock count" });
  await count.getByLabel("Location counted").selectOption({ label: `warehouse · ${warehouse.name}` });
  await count.getByLabel(`Counted of ${code}`).fill(String(R11_COUNTED));
  await count.getByRole("button", { name: "Save the count" }).click();
  await expect(page.getByText("Count saved: variance 1 units.")).toBeVisible();
  const counted = page.getByTestId("stock-count").filter({ hasText: warehouse.name });
  await expect(counted).toContainText("variance 1 units");
  await expect(counted).toContainText(`expected ${R11_IN_WAREHOUSE}, counted ${R11_COUNTED}`);
  await expect(level.getByTestId("sku-available")).toHaveText(String(R11_IN_WAREHOUSE));

  // The lost-demand tap on a salon page, read again after a reload and on the database.
  await phone.goto(`/app/salons/${r11Salon.id}`);
  const lost = phone.getByRole("form", { name: "Record lost demand" });
  await lost.getByLabel("Why it could not be sold").selectOption("out_of_stock");
  await lost.getByLabel("Item asked for").selectOption(skuId);
  await lost.getByLabel("Units asked for").fill(String(R11_LOST_QTY));
  await lost.getByRole("button", { name: "Record lost demand" }).click();
  await expect(phone.getByText("Lost demand recorded.")).toBeVisible();
  await phone.reload();
  await expect(phone.getByTestId("lost-demand").filter({ hasText: code })).toContainText(`${R11_LOST_QTY} ×`);
  const signals = await r11Sql(null, "select qty, salon_id, captured_by from public.demand_signal where sku_id = $1", [skuId]);
  expect(signals).toEqual([{ qty: R11_LOST_QTY, salon_id: r11Salon.id, captured_by: rep.id }]);
  await ctx.close();

  // Refused for a rep, by the functions themselves.
  expect(await sqlstateAs(rep, "aal1", "select app.office_set_reorder_point($1, 1)", [skuId])).toBe("42501");
  expect(await sqlstateAs(rep, "aal1", "select * from app.low_stock()")).toBe("42501");
  expect(await sqlstateAs(rep, "aal1", "select * from app.stock_on_hand(null)")).toBe("42501");
});
