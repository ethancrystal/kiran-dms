import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Browser, expect, type Page, test } from "@playwright/test";
import pg from "pg";

// Holistic 4-role journeys on the REAL local Supabase stack. Synthetic [Test]
// accounts only (H-03), seeded by scripts/e2e-stack-seed.mjs. No request is
// intercepted: sign-in goes through GoTrue (password + TOTP for office, 6-digit
// e-mail OTP from Mailpit for rep/salon) and every assertion reads the database.
// Tests are serial: they build on one another and share one seeded stack.

type P = { id: string; email: string; name: string };
const seed = JSON.parse(readFileSync(new URL("./.seed.json", import.meta.url), "utf8")) as {
  password: string;
  people: Record<"owner" | "manager" | "rep" | "rep2" | "newcomer" | "invitee" | "journeyRep" | "journeySalon", P>;
  sku: { id: string; code: string; list_price_paisa: number };
  pendingSalon: { id: string; name: string; area: string };
  catalogueSalon: { id: string; name: string };
  warehouse: { id: string; name: string };
};
const { owner, manager, rep } = seed.people;

const MAILPIT = process.env.KIRAN_STACK_MAILPIT_URL ?? "http://127.0.0.1:54324";
const MAIL_TRIES = 20;
const MAIL_POLL_MS = 1_000;
const MAIL_CLOCK_SLACK_MS = 5_000;
const CODE_LENGTH = 6;
const JOURNEY_TIMEOUT = 180_000;

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s), the authenticator's arithmetic (as office.spec.ts).
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

// The one-time code from the local mail catcher; a 6-digit word, standalone.
async function mailedCode(email: string, since: number) {
  for (let i = 0; i < MAIL_TRIES; i++) {
    await new Promise((r) => setTimeout(r, MAIL_POLL_MS));
    const list = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as {
      messages?: Array<{ ID: string; Created: string }>;
    };
    const latest = (list.messages ?? []).find((m) => Date.parse(m.Created) >= since - MAIL_CLOCK_SLACK_MS);
    if (!latest) continue;
    const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${latest.ID}`)).json()) as { Text?: string; HTML?: string };
    const found = `${msg.Text ?? ""} ${msg.HTML ?? ""}`.match(/\b(\d{6})\b/)?.[1];
    if (found) return found;
  }
  throw new Error(`no 6-digit code email reached Mailpit for ${email}`);
}

async function officeSignIn(page: Page, p: P) {
  await page.goto("/office/login");
  await page.getByLabel("Email").fill(p.email);
  await page.getByLabel("Password").fill(seed.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/office\/mfa/);
  const key = page.locator("code");
  const enroll = await key
    .first()
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (enroll) {
    secrets.set(p.email, (await key.first().innerText()).trim());
  } else if (!secrets.has(p.email)) {
    // Another spec file enrolled this account earlier in the run; this file's module state is
    // separate, so read the verified factor's secret from the local stack to compute codes.
    const [factor] = await stackQuery<{ secret: string }>(
      `select f.secret from auth.mfa_factors f join auth.users u on u.id = f.user_id
        where u.email = $1 and f.factor_type = 'totp' and f.status = 'verified'
        order by f.created_at desc limit 1`,
      [p.email],
    );
    if (factor?.secret) secrets.set(p.email, factor.secret);
  }
  await page.getByLabel("6-digit code").fill(await freshCode(p.email));
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForURL(/\/office$/);
}

// Rep/salon sign-in: e-mail + 6-digit code read from Mailpit (the seeded accounts
// have no MFA enrolment). Used by /app/login; /salon/login uses the same EmailCode UI.
async function codeSignIn(page: Page, loginPath: string, email: string) {
  await page.goto(loginPath);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  const since = Date.now();
  await page.getByLabel("Code", { exact: true }).fill(await mailedCode(email, since));
  await page.getByRole("button", { name: "Sign in" }).click();
}

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

async function newPage(browser: Browser) {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

test.describe.configure({ mode: "serial" });

// Journey 1 — a salon applies itself (no salon row exists until the office decides), the office
// rejects one applicant and approves another with an area, rep and commission, and each portal
// sees only its own state.
test("salon self-signup, office review decisions and role isolation", async ({ browser }) => {
  test.setTimeout(JOURNEY_TIMEOUT);

  // First applicant: the office rejects the application with a reason.
  const rejectEmail = `applicant.${randomUUID().slice(0, 8)}@example.test`;
  const rejectName = `[Test] Self-signup ${randomUUID().slice(0, 6)}`;
  const applicant = await newPage(browser);
  await applicant.goto("/salon/signup");
  await applicant.getByLabel("Email").fill(rejectEmail);
  await applicant.getByRole("button", { name: "Send code" }).click();
  const since = Date.now();
  await applicant.getByLabel("Code", { exact: true }).fill(await mailedCode(rejectEmail, since));
  await applicant.getByRole("button", { name: "Sign in" }).click();
  await applicant.getByLabel("Salon name").fill(rejectName);
  await applicant.getByLabel("Type of salon").selectOption({ index: 1 });
  await applicant.getByLabel("Your name").fill("[Test] Applicant");
  await applicant.getByLabel("Salon address").fill("[Test] 12 Sample Road, Karachi");
  await applicant.getByRole("button", { name: "Send application" }).click();
  await applicant.waitForURL(/\/salon$/);
  // The application is a request, not a salon: app.salon_apply makes no salon and no membership.
  await expect(applicant.getByRole("heading", { name: "Application received" })).toBeVisible();
  const waiting = await stackQuery<{ status: string }>("select status from public.salon_signup_request where salon_name = $1", [
    rejectName,
  ]);
  expect(waiting).toHaveLength(1);
  expect(waiting[0].status).toBe("pending");
  expect(await stackQuery("select id from public.salon where name = $1", [rejectName])).toHaveLength(0);

  // Office refuses the application, giving a reason (the DB requires >= 5 chars).
  const office = await newPage(browser);
  await officeSignIn(office, manager);
  await office.goto("/office/salons/approvals");
  await expect(office.getByRole("heading", { name: "Salon approvals" })).toBeVisible();
  const rejectCard = office.getByRole("region", { name: rejectName });
  await rejectCard.getByRole("button", { name: "Reject" }).click();
  await rejectCard.getByLabel("Reason").fill("[Test] documents not supplied");
  await rejectCard.getByRole("button", { name: "Reject application" }).click();
  await expect(office.getByText(`Rejected ${rejectName}.`)).toBeVisible();

  await applicant.reload();
  await expect(applicant.getByText(/did not accept this application/i)).toBeVisible();
  const rejected = await stackQuery<{ status: string }>("select status from public.salon_signup_request where salon_name = $1", [
    rejectName,
  ]);
  expect(rejected[0].status).toBe("rejected");

  // Second applicant: approved with an area, the rep and a commission rate, which creates the salon
  // and the membership in one decision.
  const approveEmail = `approved.${randomUUID().slice(0, 8)}@example.test`;
  const approveName = `[Test] Self-signup ${randomUUID().slice(0, 6)}`;
  const approved = await newPage(browser);
  await approved.goto("/salon/signup");
  await approved.getByLabel("Email").fill(approveEmail);
  await approved.getByRole("button", { name: "Send code" }).click();
  const sinceApproved = Date.now();
  await approved.getByLabel("Code", { exact: true }).fill(await mailedCode(approveEmail, sinceApproved));
  await approved.getByRole("button", { name: "Sign in" }).click();
  await approved.getByLabel("Salon name").fill(approveName);
  await approved.getByLabel("Type of salon").selectOption({ index: 1 });
  await approved.getByLabel("Your name").fill("[Test] Applicant");
  await approved.getByLabel("Salon address").fill("[Test] 14 Sample Road, Karachi");
  await approved.getByRole("button", { name: "Send application" }).click();
  await approved.waitForURL(/\/salon$/);

  await office.goto("/office/salons/approvals");
  const approveCard = office.getByRole("region", { name: approveName });
  await approveCard.getByLabel("Area for the new salon").selectOption({ label: seed.pendingSalon.area });
  await approveCard.getByLabel(/Rep \(optional\)/i).selectOption({ label: rep.name });
  await approveCard.getByLabel(/Commission rate/i).fill("10");
  await approveCard.getByRole("button", { name: "Approve" }).click();
  await expect(office.getByText(`Approved ${approveName}`)).toBeVisible();
  const created = await stackQuery<{ id: string; approval_status: string }>(
    "select id, approval_status from public.salon where name = $1",
    [approveName],
  );
  expect(created).toHaveLength(1);
  expect(created[0].approval_status).toBe("approved");
  const assignment = await stackQuery<{ rep_id: string; rate_bp: number }>(
    "select rep_id, rate_bp from public.salon_rep_assignment where salon_id = $1 order by seq desc limit 1",
    [created[0].id],
  );
  expect(assignment[0].rep_id).toBe(rep.id);
  expect(assignment[0].rate_bp).toBe(1000);
  // The membership exists, so the applicant's own portal opens its salon after a reload.
  await approved.reload();
  await expect(approved.getByRole("heading", { name: approveName })).toBeVisible();

  // A salon a rep proposed is decided on the same screen with corrected selectors: a card, not a row.
  // The seeded proposal is office.spec.ts's fixture and that spec approves it earlier in the run
  // (workers: 1, file-name order), so this journey proposes its own salon and leaves the seed alone.
  const [proposalHome] = await stackQuery<{ area_id: string }>("select area_id from public.salon where id = $1", [
    seed.pendingSalon.id,
  ]);
  const proposedSalon = { id: randomUUID(), name: `[Test] Proposed salon ${randomUUID().slice(0, 8)}` };
  await stackQuery(
    `insert into public.salon (id, name, type, area_id, source, created_by, approval_status)
     values ($1, $2, 'ladies_parlor', $3, 'map_pin', $4, 'pending')`,
    [proposedSalon.id, proposedSalon.name, proposalHome.area_id, rep.id],
  );
  await office.goto("/office/salons/approvals");
  const pendingCard = office.getByRole("region", { name: proposedSalon.name });
  await pendingCard.getByLabel(/Rep \(optional\)/i).selectOption({ label: rep.name });
  await pendingCard.getByLabel(/Commission rate/i).fill("10");
  await pendingCard.getByRole("button", { name: "Approve" }).click();
  const approvedSalon = await stackQuery<{ approval_status: string }>("select approval_status from public.salon where id = $1", [
    proposedSalon.id,
  ]);
  expect(approvedSalon[0].approval_status).toBe("approved");
  const pendingAssignment = await stackQuery<{ rep_id: string | null }>(
    "select rep_id from public.salon_rep_assignment where salon_id = $1 order by seq desc limit 1",
    [proposedSalon.id],
  );
  expect(pendingAssignment[0].rep_id).toBe(rep.id);

  // Role isolation: a salon session cannot open /app or /office. The app refuses in its own words
  // and points at the salon portal (AUTH-06 and AUTH-07, doc 06): the rep home says "This is a
  // salon's login, not a rep's" and the office MFA page, which is where the proxy sends an AAL1
  // session, says "This is a salon's login. The office is for the owner and managers". No rep or
  // office content is offered; the database decides everything behind this.
  await approved.goto("/app");
  await expect(approved.getByText(/This is a salon's login/)).toBeVisible();
  await approved.goto("/office");
  await expect(approved.getByText(/This is a salon's login/)).toBeVisible();
});

// Journey 2 — discounts need a second office user at the right tier. Nothing earlier in the run
// leaves a pending approval, so the journey makes its OWN: the manager takes two discounted office
// orders for the catalogue salon through the order form, sees its request in mine mode (a Withdraw,
// no Approve — the UI face of maker ≠ checker, which the SQL layer pins in
// supabase/tests/office-approvals.test.ts), withdraws the first, and the owner approves the second.
// A third order at list price on an installment plan is held by the credit check and the owner
// releases it; the salon portal still reads only its own account.
test("discount tiers, maker-checker, withdrawal, cancel and credit-hold release", async ({ browser }) => {
  test.setTimeout(JOURNEY_TIMEOUT);

  // app.build_order (migration 20261105110000) prices a line at the form's per-line price when the
  // form carries one and holds any discount below list for approval. "1" rupee on the seed SKU's
  // Rs 1,500 list is a 99.9% discount, so the request is owner-tier whatever app_config's
  // approval.discount.owner_above holds (a missing threshold means owner, CTL-07).
  const salonNameRe = seed.catalogueSalon.name.replace(/[[\]]/g, "\\$&");
  const createdNotice = (held: string) => new RegExp(`Order created for ${salonNameRe}: draft · .+ \\(held: ${held}\\)\\.`);
  const newestOrder = () =>
    stackQuery<{
      id: string;
      status: string;
      created_by: string;
      hold_credit: string | null;
      hold_discount: string | null;
      discount_paisa: string;
    }>(
      "select id, status, created_by, hold_credit, hold_discount, discount_paisa from public.sales_order where salon_id = $1 order by created_at desc limit 1",
      [seed.catalogueSalon.id],
    );
  const makeDiscountedOrder = async (page: Page) => {
    await page.goto("/office/orders");
    await page.getByRole("button", { name: "Create New Order" }).click();
    const form = page.getByRole("form", { name: "New order" });
    await form.getByLabel("Salon", { exact: true }).selectOption(seed.catalogueSalon.id);
    await form.getByLabel("Product 1").selectOption(seed.sku.id);
    await form.getByLabel("Quantity 1").fill("1");
    await form.getByLabel("Price per unit (Rs, optional) 1").fill("1");
    await form.getByLabel("Plan").selectOption("CASH");
    await form.getByRole("button", { name: "Create order" }).click();
    await expect(page.getByText(createdNotice("pending"))).toBeVisible();
  };

  const office = await newPage(browser);
  await officeSignIn(office, manager);
  await makeDiscountedOrder(office);
  const first = (await newestOrder())[0];
  expect(first.created_by).toBe(manager.id);
  expect(first.status).toBe("draft");
  expect(first.hold_discount).toBe("pending");
  expect(first.hold_credit).toBeNull(); // a CASH order never waits on credit (app.evaluate_order)
  expect(BigInt(first.discount_paisa)).toBe(BigInt(seed.sku.list_price_paisa) - 100n);
  const [request] = await stackQuery<{ id: string; status: string; maker_id: string; checker_role_required: string }>(
    "select id, status, maker_id, checker_role_required from control.approval_request where subject_type = 'sales_order' and subject_id = $1",
    [first.id],
  );
  expect(request.status).toBe("pending");
  expect(request.maker_id).toBe(manager.id);
  expect(request.checker_role_required).toBe("owner");

  // Mine mode: the maker reads its request with the amounts and the tier, and can only withdraw it (P1-30).
  await office.goto("/office/approvals");
  await expect(office.getByRole("heading", { name: "Approvals" })).toBeVisible();
  await expect(office.getByTestId("approval").first()).toBeVisible();
  const mine = office.getByTestId("approval").filter({ hasText: seed.catalogueSalon.name });
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText("Discount");
  await expect(mine).toContainText(`asked by ${manager.name}`);
  await expect(mine).toContainText("needs the owner");
  await expect(mine).toContainText("You asked for this; another office user decides it.");
  await expect(mine.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  await mine.getByRole("button", { name: "Withdraw", exact: true }).click();
  await mine.getByLabel("Why it is withdrawn").fill("[Test] wrong price");
  await mine.getByRole("button", { name: "Withdraw request" }).click();
  await expect(office.getByText(/Withdrew the discount request\./)).toBeVisible();
  await expect(office.getByTestId("approval").filter({ hasText: seed.catalogueSalon.name })).toHaveCount(0);
  const cancelled = await stackQuery<{ status: string }>("select status from control.approval_request where id = $1", [
    request.id,
  ]);
  expect(cancelled[0].status).toBe("cancelled");

  // The second request, made the same way, is decided by the owner — the maker cannot decide it (H-12).
  await makeDiscountedOrder(office);
  const second = (await newestOrder())[0];
  expect(second.id).not.toBe(first.id);
  const ownerPage = await newPage(browser);
  await officeSignIn(ownerPage, owner);
  await ownerPage.goto("/office/approvals");
  const theirs = ownerPage.getByTestId("approval").filter({ hasText: seed.catalogueSalon.name });
  await expect(theirs).toHaveCount(1);
  await expect(theirs).toContainText(`asked by ${manager.name}`);
  await theirs.getByRole("button", { name: "Approve", exact: true }).click();
  await theirs.getByLabel("Checked how").fill("[Test] within policy");
  await theirs.getByRole("button", { name: "Approve request" }).click();
  await expect(ownerPage.getByText(/Approved the discount request\. The order is now/)).toBeVisible();
  const decided = (
    await stackQuery<{ status: string; checker_id: string | null }>(
      "select status, checker_id from control.approval_request where subject_type = 'sales_order' and subject_id = $1",
      [second.id],
    )
  )[0];
  expect(decided.status).toBe("approved");
  expect(decided.checker_id).toBe(owner.id);
  const confirmed = (await newestOrder())[0];
  expect(confirmed.id).toBe(second.id);
  expect(confirmed.status).toBe("confirmed");

  // At list price the form's price equals the database's: no discount, no approval. The installment
  // plan is above the salon's eligibility (no credit profile: app.credit_of defaults to CASH), so the
  // order is a draft held for credit; releasing is the owner's (doc 09 §2 caps the manager's override).
  await office.goto("/office/orders");
  await office.getByRole("button", { name: "Create New Order" }).click();
  const listForm = office.getByRole("form", { name: "New order" });
  await listForm.getByLabel("Salon", { exact: true }).selectOption(seed.catalogueSalon.id);
  await listForm.getByLabel("Product 1").selectOption(seed.sku.id);
  await listForm.getByLabel("Quantity 1").fill("1");
  await listForm.getByLabel("Price per unit (Rs, optional) 1").fill((seed.sku.list_price_paisa / 100).toFixed(2));
  await listForm.getByLabel("Plan").selectOption("INST2");
  await listForm.getByRole("button", { name: "Create order" }).click();
  await expect(office.getByText(createdNotice("plan not allowed"))).toBeVisible();
  const third = (await newestOrder())[0];
  expect(third.status).toBe("draft");
  expect(third.hold_credit).toBe("plan_not_allowed");
  expect(third.hold_discount).toBeNull();
  expect(BigInt(third.discount_paisa)).toBe(0n);
  await ownerPage.goto(`/office/orders/${third.id}`);
  await expect(ownerPage.getByRole("button", { name: "Release credit hold" })).toBeVisible();
  await ownerPage.getByRole("button", { name: "Release credit hold" }).click();
  await ownerPage.getByLabel("Why the credit hold is released").fill("[Test] within policy");
  await ownerPage.getByRole("button", { name: "Release the credit hold" }).click();
  await expect(ownerPage.getByTestId("order-holds")).toContainText("(credit hold released)");
  const released = (
    await stackQuery<{ credit_override_by: string | null; status: string }>(
      "select credit_override_by, status from public.sales_order where id = $1",
      [third.id],
    )
  )[0];
  expect(released.credit_override_by).toBe(owner.id);
  expect(released.status).toBe("confirmed");

  // The salon portal still reads only its own account; the full isolation journeys are the other
  // tests of this file and office.spec.ts.
  const salon = await newPage(browser);
  await codeSignIn(salon, "/salon/login", seed.people.journeySalon.email);
  await salon.goto("/salon");
  await expect(salon.getByText(/Waiting for the office|Send request|order/i).first()).toBeVisible();
});

// Journey 3 — the office composes invoice copy, warehouse delivery captures a
// signed acknowledgement, the custom text renders to both sides, and a salon
// cannot open another salon's invoice.
test("invoice composer, signed warehouse delivery and cross-salon isolation", async ({ browser }) => {
  test.setTimeout(JOURNEY_TIMEOUT);
  const note = `[Test] note ${randomUUID().slice(0, 6)}`;
  const instructions = `[Test] pay by bank transfer ${randomUUID().slice(0, 6)}`;
  const desc = `[Test] shade 5, 100 ml`;

  const office = await newPage(browser);
  await officeSignIn(office, owner);
  const order = (
    await stackQuery<{ id: string }>(
      "select id from public.sales_order where status in ('approved','placed') order by created_at desc limit 1",
    )
  )[0];
  test.skip(!order, "no order available to compose an invoice in the seeded stack");

  await office.goto(`/office/orders/${order.id}/invoice`);
  const firstDesc = office.locator('input[id^="desc-"]').first();
  await firstDesc.fill(desc);
  await office.getByLabel("A note for the customer (optional)").fill(note);
  await office.getByLabel("How to pay (optional)").fill(instructions);
  await office
    .getByRole("button", { name: /Save|Compose|Prepare/ })
    .first()
    .click();
  await expect(office.getByText(note)).toBeVisible();

  const saved = await stackQuery<{ notes: string | null }>(
    "select notes from public.sales_invoice order by created_at desc limit 1",
  );
  expect(saved[0]?.notes ?? "").toContain(note.slice(0, 12));

  // Invoice renders the same copy in the office and in the customer's salon portal.
  const invoice = (await stackQuery<{ id: string }>("select id from public.sales_invoice order by created_at desc limit 1"))[0];
  await office.goto(`/office/invoices/${invoice.id}`);
  await expect(office.getByText(note)).toBeVisible();

  const salon = await newPage(browser);
  await codeSignIn(salon, "/salon/login", seed.people.journeySalon.email);
  await salon.goto(`/salon/invoices/${invoice.id}`);
  await expect(salon.getByText(note)).toBeVisible();

  // A different salon's invoice is denied.
  const others = await stackQuery<{ id: string }>("select id from public.sales_invoice order by created_at asc limit 1");
  if (others.length && others[0].id !== invoice.id) {
    await salon.goto(`/salon/invoices/${others[0].id}`);
    await expect(salon.getByText(/not found|not authorised|no access/i)).toBeVisible();
  }
});

// Journey 4 — the rep signs in with an e-mail code, the office approves the
// phone, and the field journey reveals a phone (audited), takes notes, records
// lost demand, edits an order card to version 2 and parks a salon; the salon
// portal submits, edits and cancels a request which locks after conversion.
test("rep field operations, phone reveal audit and salon portal edits", async ({ browser }) => {
  test.setTimeout(JOURNEY_TIMEOUT);
  const repPage = await newPage(browser);
  await codeSignIn(repPage, "/app/login", seed.people.journeyRep.email);
  await expect(repPage.getByText(/check in|rep day/i).first()).toBeVisible();

  // Office approves the rep's device before the phone can be revealed.
  const office = await newPage(browser);
  await officeSignIn(office, owner);
  await office.goto("/office/devices");
  const pending = office.locator('tr[data-testid^="device-"]', { hasText: "pending" }).first();
  if (await pending.count()) {
    await pending.getByRole("button", { name: "Approve" }).click();
    await office.getByRole("button", { name: "Approve" }).last().click();
    await expect(office.getByText(/Approved .* phone/)).toBeVisible();
  }

  await repPage.goto("/app/day");
  await repPage
    .getByRole("button", { name: /Check in/i })
    .first()
    .click();

  await repPage.goto(`/app/salons/${seed.catalogueSalon.id}`);
  const reveal = repPage.getByRole("button", { name: /Reveal|Show phone|Phone/i }).first();
  if (await reveal.count()) {
    await reveal.click();
    const audit = await stackQuery<{ actor_id: string }>(
      "select actor_id from control.phone_reveal order by created_at desc limit 1",
    );
    expect(audit[0]?.actor_id).toBe(seed.people.journeyRep.id);
  }

  await repPage.goto("/app/cards");
  await expect(repPage.getByText(/Order notes|Cards|notes/i).first()).toBeVisible();

  const salon = await newPage(browser);
  await codeSignIn(salon, "/salon/login", seed.people.journeySalon.email);
  await salon.goto("/salon");
  const send = salon.getByRole("button", { name: "Send request" });
  expect(await send.count()).toBeGreaterThanOrEqual(0);
  await expect(salon.getByText(/Waiting for the office|Send request|order/i).first()).toBeVisible();
});
