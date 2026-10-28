import { defineConfig } from "@playwright/test";

// Browser tests for the rep PWA (SPEC.md §9, MJ L-0136). They run against a production build
// with placeholder public settings: no real Supabase project is contacted, and tests that
// need the auth server intercept its requests.
const PORT = 3100;
// Not a key: the app needs some value to build, and every auth request is intercepted or fails.
const PLACEHOLDER = "e2e-placeholder";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [
    {
      // The phone doc 01 assumes: a 3-4 year old Android, small screen, touch only.
      name: "low-end-android",
      use: {
        browserName: "chromium",
        viewport: { width: 360, height: 640 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (Linux; Android 10; SM-A105F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/app/login`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: `https://${PLACEHOLDER}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: PLACEHOLDER,
    },
  },
});
