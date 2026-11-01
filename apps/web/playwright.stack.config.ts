import { defineConfig } from "@playwright/test";

// Office browser tests against a REAL local Supabase stack (`supabase start`: Auth, PostgREST,
// Postgres with supabase/migrations applied), seeded by scripts/e2e-stack-seed.mjs. Nothing is
// intercepted: every page talks to the real database functions (execution map, gate G2).
// CI only (`e2e-stack` job): this repository's Windows host has no Docker.
const PORT = 3200;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) {
  throw new Error("playwright.stack.config.ts runs only against a local stack (NEXT_PUBLIC_SUPABASE_URL on 127.0.0.1)");
}

export default defineConfig({
  testDir: "./e2e-stack",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-stack" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "office-desktop", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/office/login`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: key },
  },
});
