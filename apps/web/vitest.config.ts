import { defineConfig } from "vitest/config";

// Unit tests of the web app's own pure modules (the office sheet upload's parser first, MJ 2026-11-20).
// lib/email/reminder-job.test.ts is a node:test suite (P1-38) and is not part of this runner; the
// Playwright suites (e2e/, e2e-stack/) have their own configs.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    exclude: ["lib/email/**"],
  },
});
