import { defineConfig } from "vitest/config";
import base from "./vitest.config.ts";

// Needs TEST_DATABASE_URL. See "Run the database tests" in README.md.
export default defineConfig({
  resolve: base.resolve,
  test: {
    include: ["packages/*/test/**/*.db.test.ts", "apps/*/test/**/*.db.test.ts"],
    fileParallelism: false,
  },
});
