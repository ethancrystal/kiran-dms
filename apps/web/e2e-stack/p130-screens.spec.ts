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

type P = { id: string; email: string; name: string };
const seed = JSON.parse(readFileSync(new URL("./.seed.json", import.meta.url), "utf8")) as {
  password: string;
  people: Record<"owner" | "rep" | "rep2", P>;
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
  const restore = page.getByRole("form", { name: "Company details" });
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
