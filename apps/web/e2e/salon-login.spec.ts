import { expect, test } from "@playwright/test";

// Salon sign-in (AUTH-16). No real auth server: the one request the page makes is intercepted.

const HTTP_OK = 200;

test("a salon that mistyped its email can go back from the code step", async ({ page }) => {
  let asked = 0;
  await page.route("**/auth/v1/otp**", async (route) => {
    asked += 1;
    await route.fulfill({ status: HTTP_OK, contentType: "application/json", body: "{}" });
  });
  await page.goto("/salon/login");
  await page.getByLabel("Email").fill("salon.typo@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText("We emailed a 6-digit code to salon.typo@example.test.")).toBeVisible();

  await page.getByRole("button", { name: "Use a different email" }).click();

  // Back on the email step, with a button to send again and no code box.
  await expect(page.getByRole("button", { name: "Send code" })).toBeVisible();
  await expect(page.getByLabel("Code")).toHaveCount(0);
  expect(asked).toBe(1);
});
