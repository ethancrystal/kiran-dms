import { expect, test } from "@playwright/test";

// Salon sign-up (MJ, 2026-11-09). No real auth server: the one request the page makes is intercepted.

const HTTP_OK = 200;

test("a signed-out visitor reaches sign-up from the salon sign-in page and gets the email step", async ({ page }) => {
  await page.goto("/salon/login");
  await page.getByRole("link", { name: "Sign up" }).click();

  // Not bounced back to sign-in: the sign-up page is open to a signed-out visitor.
  await expect.poll(() => new URL(page.url()).pathname).toBe("/salon/signup");
  await expect(page.getByRole("heading", { name: "Sign up your salon" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send code" })).toBeVisible();
  // The application form only appears after the email is confirmed with the code.
  await expect(page.getByLabel("Salon name")).toHaveCount(0);
});

test("sign-up asks for the emailed code, and a mistyped email is not a dead end", async ({ page }) => {
  let asked = 0;
  await page.route("**/auth/v1/otp**", async (route) => {
    asked += 1;
    await route.fulfill({ status: HTTP_OK, contentType: "application/json", body: "{}" });
  });
  await page.goto("/salon/signup");
  await page.getByLabel("Email").fill("new.salon@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText("We emailed a 6-digit code to new.salon@example.test.")).toBeVisible();

  await page.getByRole("button", { name: "Use a different email" }).click();

  await expect(page.getByRole("button", { name: "Send code" })).toBeVisible();
  await expect(page.getByLabel("Code")).toHaveCount(0);
  expect(asked).toBe(1);
});

test("the invitation page keeps the same email step", async ({ page }) => {
  await page.goto("/invite/not-a-real-token");
  await expect(page.getByText("Enter the email address this invitation was sent to.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send code" })).toBeVisible();
});
