import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Browser, expect, type Page, test } from "@playwright/test";

// Slice 1 journeys on a real local stack (execution map; J1 steps 1 to 3, J4 steps 1, 5, J5
// steps 1, 10). Seed: scripts/e2e-stack-seed.mjs. Tests run in order and share the stack.

type P = { id: string; email: string; name: string };
const seed = JSON.parse(readFileSync(new URL("./.seed.json", import.meta.url), "utf8")) as {
  password: string;
  people: Record<"owner" | "manager" | "rep" | "rep2" | "newcomer", P>;
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
  await page.getByRole("link", { name: "Devices" }).click();
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
  await page.getByRole("link", { name: "Territories" }).click();
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
  await page.getByRole("link", { name: "Team" }).click();
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
  await page.getByRole("link", { name: "Team" }).click();
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
  await page.getByRole("link", { name: "Team" }).click();
  await expect(page.getByText("Only the owner adds people or changes their status")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a person" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Suspend" })).toHaveCount(0);
});

test("a rep signs in with an email code, waits for approval, then checks in and out (J1 steps 1 to 6 and 15)", async ({
  browser,
  page,
}) => {
  await page.goto("/app/login");
  await page.getByLabel(/Email/).fill(rep.email);
  const asked = Date.now();
  await page.getByRole("button", { name: /Send code/ }).click();
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
  await office.getByRole("link", { name: "Devices" }).click();
  const row = office.getByRole("row", { name: new RegExp(rep.name.replace(/[[\]]/g, "\\$&")) });
  await row.getByRole("button", { name: "Approve" }).click();
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(office.getByText(`Approved ${rep.name}'s phone.`)).toBeVisible();

  await page.reload();
  await expect(page.getByText("This phone is approved.")).toBeVisible();
  await page.getByRole("link", { name: /Start your day/ }).click();
  await page.waitForURL(/\/app\/day$/);
  await expect(page.getByRole("heading", { name: /Your territory/ })).toBeVisible();
  // The rep has no bag yet, so the morning count is empty; check in.
  await page.getByRole("button", { name: "Check in" }).click();
  await expect(page.getByText("Checked in. Have a good day.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Today's route/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Due for a visit/ })).toBeVisible();
  // A second check-in is not offered; the day is open.
  await expect(page.getByRole("button", { name: "Check in" })).toHaveCount(0);
  // J2 salon acquisition (slice 3): the office gives the rep a territory, the rep adds a salon.
  await office.getByRole("link", { name: "Territories" }).click();
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
  await page.getByLabel("Salon name").fill(salonName);
  await page.getByRole("button", { name: "Add salon" }).click();
  await page.waitForURL(/\/app\/salons\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: salonName })).toBeVisible();
  await expect(page.getByText("prospect").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stage history" })).toBeVisible();
  await page.getByLabel("New note").fill("[Test] owner asked for a price list");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Note added.")).toBeVisible();
  await expect(page.getByText("[Test] owner asked for a price list")).toBeVisible();
  // The salon is in the rep's list after a reload (data survives, from the database).
  await page.goto("/app/salons");
  await expect(page.getByRole("link", { name: salonName })).toBeVisible();

  await page.goto("/app/day");
  await page.getByRole("button", { name: /Finish the day/ }).click();
  await page.getByRole("button", { name: "Save count and check out" }).click();
  await expect(page.getByText("Day closed. Thank you.")).toBeVisible();
  await expect(page.getByText("Today's day is closed.")).toBeVisible();
});
