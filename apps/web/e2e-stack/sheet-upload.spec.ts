import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { CSV_TEMPLATE } from "../lib/sheet-import";

// The office sheet upload on a REAL local stack (MJ, 2026-11-20, ruling 5; workstream D, first slice).
// The journey is the one the office asked for: download the template, fill it in, upload it, see what
// the file says, apply, and find the products, SKUs, prices and stock recorded in the database.
// Runs last (files run by name, one worker); it makes its own manager login and reuses the seeded
// warehouse. Synthetic data only ("[Dummy]", "[Test]", example.test). CI only: this host has no Docker.
//
// The template is uploaded exactly as downloaded, so its two [Dummy] rows are the sheet under test.

type P = { id: string; email: string; name: string };
const seed = JSON.parse(readFileSync(new URL("./.seed.json", import.meta.url), "utf8")) as {
  password: string;
  people: Record<"owner" | "manager", P>;
  warehouse: { id: string; name: string };
};
const DB_URL = process.env.KIRAN_STACK_DB_URL ?? "";
const TAG_LENGTH = 8;
const tag = randomUUID().slice(0, TAG_LENGTH);
// The two groups the template names. Fixed ids, so a second run of this file upserts the same groups.
const COLOUR_GROUP = "11111111-2222-4333-8444-555555555501";
const CARE_GROUP = "11111111-2222-4333-8444-555555555502";
const GROUPS = [
  { id: COLOUR_GROUP, name: "[Dummy] Colour" },
  { id: CARE_GROUP, name: "[Dummy] After care" },
];
const CYCLE_DAYS = 30;
const manager: P = { id: randomUUID(), email: `sheet-manager.${tag}@example.test`, name: `[Test] Sheet manager ${tag}` };
const PHONE_DIGITS = 8;
const SHEET_FILE = "kiran-sheet-template.csv";
// The template's unit counts, and the total the receipt must carry.
const HAIR_COLOUR_UNITS = 12;
const SHAMPOO_UNITS = 6;
const TOTAL_UNITS = HAIR_COLOUR_UNITS + SHAMPOO_UNITS;
const PRICE_RS = "Rs 1,500";
const HAIR_CODE = "DUMMY-HC-5";

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s), as the other stack specs.
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

const secrets = new Map<string, string>();
const usedSteps = new Map<string, number>();
async function freshCode(p: P): Promise<string> {
  const step = Math.floor(Date.now() / STEP_MS);
  if (step === usedSteps.get(p.email)) {
    await new Promise((r) => setTimeout(r, WAIT_STEP_MS));
    return freshCode(p);
  }
  usedSteps.set(p.email, step);
  return totp(secrets.get(p.email) ?? "", step);
}
const HOME_URL = /\/office$/;
const MFA_URL = /\/office\/mfa/;
async function signIn(page: Page, p: P) {
  await page.goto("/office/login");
  await page.getByLabel("Email").fill(p.email);
  await page.getByLabel("Password").fill(seed.password);
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
const H2 = 2;
test.describe.configure({ mode: "serial", timeout: TEST_TIMEOUT_MS });

test.beforeAll(async () => {
  await sql(
    null,
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change,
       email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
       extensions.crypt($3, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(),
       '', '', '', '', '', '', '', '')`,
    [manager.id, manager.email, seed.password],
  );
  await sql(
    null,
    `insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $3::text, jsonb_build_object('sub', $3::text, 'email', $2::text, 'email_verified', true),
             'email', now(), now(), now())`,
    [manager.id, manager.email, manager.id],
  );
  const phone = `+9200${String(Date.now()).slice(-PHONE_DIGITS)}`;
  await sql(OWNER, "select app.owner_create_user($1, $2, 'manager'::public.app_role, $3)", [manager.id, manager.name, phone]);
  // The groups the template names: written by the owner (product groups are the owner's question, B-41),
  // so the upload itself only reads them.
  for (const g of GROUPS) {
    await sql(OWNER, "select app.office_upsert_product_group($1, $2, $3)", [g.id, g.name, CYCLE_DAYS]);
  }
});

test("the office uploads the template: preview, apply, and the products, prices and stock land in the database", async ({
  browser,
}) => {
  const page = await officePage(browser, manager);
  await page.goto("/office/products/upload");
  await expect(page.getByRole("heading", { name: "Upload a sheet", level: 1 })).toBeVisible();

  // The template downloads from the same page the upload uses.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download the template" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(SHEET_FILE);

  const startedAt = new Date();
  await page.getByLabel("Sheet file (CSV)").setInputFiles({
    name: SHEET_FILE,
    mimeType: "text/csv",
    buffer: Buffer.from(CSV_TEMPLATE, "utf8"),
  });

  // Preview: two rows, none refused, both ready; the page reads the file in the browser.
  await expect(page.getByTestId("sheet-summary")).toHaveText("2 rows, 0 with errors, 2 ready to apply.");
  await expect(page.getByTestId("sheet-row-2")).toContainText("[Dummy] Hair colour");
  await expect(page.getByTestId("sheet-row-2")).toContainText(HAIR_CODE);
  await expect(page.getByTestId("sheet-row-3")).toContainText("[Dummy] Shampoo");
  await expect(page.getByTestId("sheet-row-3")).toContainText("400 ml");
  // The row names no code, so the page shows the one it will create (SH- and eight hex digits).
  await expect(page.getByTestId("sheet-row-3")).toContainText(/SH-[0-9A-F]{8}/);

  // The seeded warehouse takes the unit counts.
  await page.getByLabel("Warehouse for the unit counts").selectOption({ label: seed.warehouse.name });
  await page.getByRole("button", { name: "Apply 2 rows" }).click();

  // The database's own answer, row by row.
  await expect(page.getByRole("heading", { name: "What the database did", level: H2 })).toBeVisible();
  await expect(page.getByTestId("sheet-result-2")).toContainText(
    `${HAIR_COLOUR_UNITS} units received into ${seed.warehouse.name}`,
  );
  await expect(page.getByTestId("sheet-result-2")).toContainText(/price (set to Rs 1,500|unchanged)/);
  await expect(page.getByTestId("sheet-result-3")).toContainText(`${SHAMPOO_UNITS} units received into ${seed.warehouse.name}`);
  await expect(page.getByRole("button", { name: "Applied" })).toBeDisabled();

  // The rows are in the products list: the hair colour SKU with the price the sheet set, and the shampoo
  // product (a name the seed does not use) with its own price.
  await page.goto("/office/products");
  await expect(page.getByTestId(`price-${HAIR_CODE}`)).toHaveText(PRICE_RS);
  const shampoo = page.locator("section", { has: page.getByRole("heading", { name: /\[Dummy\] Shampoo/, level: H2 }) });
  await expect(shampoo).toContainText("[Dummy] After care");
  await expect(shampoo).toContainText("Rs 650");

  // And in the database: one receipt batch, 12 and 6 units, into the warehouse the page named.
  const rows = await sql(
    null,
    `select s.code, sum(m.qty)::int as units
     from public.stock_movement m
     join public.sku s on s.id = m.sku_id
     where m.source_type = 'stock_receipt' and m.to_location_id = $1 and m.created_at >= $2
     group by s.code`,
    [seed.warehouse.id, startedAt],
  );
  const units = new Map(rows.map((r) => [String(r.code), Number(r.units)]));
  expect(units.get(HAIR_CODE), "the hair colour units are in the warehouse").toBe(HAIR_COLOUR_UNITS);
  expect(
    [...units.values()].reduce((n, u) => n + u, 0),
    "the whole sheet was received once",
  ).toBe(TOTAL_UNITS);
});
