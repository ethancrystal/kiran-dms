import { expect, test } from "@playwright/test";

// Rep sign-in on the phone doc 01 assumes (SPEC.md §3 J1, §5). No real auth server: the one
// request the page makes is intercepted.

test("the rep sign-in page fits a small phone and is English only (D-42)", async ({ page }) => {
  await page.goto("/app/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.locator('[lang="ur"]')).toHaveCount(0);
  const email = page.getByLabel(/Email/);
  await expect(email).toHaveAttribute("type", "email");
  await expect(email).toHaveAttribute("inputmode", "email");
  // Nothing wider than the screen: no sideways scrolling on a 360 px phone.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a refused sign-in request is shown to the rep, not swallowed (NFR-01 rejection handling)", async ({ page }) => {
  let asked = 0;
  await page.route("**/auth/v1/otp**", async (route) => {
    asked += 1;
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: 400, msg: "refused" }) });
  });
  await page.goto("/app/login");
  await page.getByLabel(/Email/).fill("rep.test@example.test");
  await page.getByRole("button", { name: /Send code/ }).click();
  // Next.js adds its own empty role="alert" route announcer, so match the alert by its message.
  await expect(page.getByRole("alert").filter({ hasText: /Could not send the code/ })).toBeVisible();
  expect(asked).toBe(1);
  // The rep stays on the email step and can try again.
  await expect(page.getByRole("button", { name: /Send code/ })).toBeEnabled();
});

test("the rep sign-in page loads at most 300 KB of gzipped JavaScript (NFR-02)", async ({ page }) => {
  const scripts: Promise<number>[] = [];
  page.on("requestfinished", (req) => {
    if (req.resourceType() === "script") scripts.push(req.sizes().then((s) => s.responseBodySize));
  });
  await page.goto("/app/login", { waitUntil: "networkidle" });
  const bytes = (await Promise.all(scripts)).reduce((a, b) => a + b, 0);
  console.log(`rep sign-in JavaScript transferred: ${(bytes / 1024).toFixed(1)} KB`);
  expect(bytes).toBeGreaterThan(0);
  expect(bytes).toBeLessThanOrEqual(300 * 1024);
});

test("security headers are served (doc 06 §7)", async ({ page }) => {
  const res = await page.goto("/app/login");
  const h = res?.headers() ?? {};
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-powered-by"]).toBeUndefined();
});
