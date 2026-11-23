import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "python/.venv/**",
      "packages/db/migrations/**",
      "owner-test-scripts/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  // The boundaries that keep features independent. A violation here is a design problem.
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "discord.js",
                "postgres",
                "drizzle-orm",
                "drizzle-orm/*",
                "@scrimbot/db",
                "hono",
              ],
              message: "packages/core is pure logic and must not do I/O.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/**/*.ts", "apps/web/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["discord.js"],
              message: "The web container has no Discord access. Enqueue a bot job instead.",
            },
          ],
        },
      ],
    },
  },
);
