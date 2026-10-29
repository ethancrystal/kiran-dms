import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

/**
 * Files run one at a time against one shared database, and module tests commit their setup rows
 * (catalogue, territories, salons, one rep day per Karachi day). Vitest's default order puts last
 * run's failures and the slowest files first, so the order changes between runs; files are run in
 * name order instead, every time, locally and in CI.
 */
class ByName extends BaseSequencer {
  async sort(files: TestSpecification[]) {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}

export default defineConfig({
  test: {
    root: "supabase/tests",
    include: ["**/*.test.ts"],
    globalSetup: ["./setup/global-setup.ts"],
    // One shared throwaway database; tests isolate themselves with rolled-back transactions.
    fileParallelism: false,
    sequence: { sequencer: ByName },
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
