import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: "supabase/tests",
    include: ["**/*.test.ts"],
    globalSetup: ["./setup/global-setup.ts"],
    // One shared throwaway database; tests isolate themselves with rolled-back transactions.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
