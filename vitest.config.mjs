import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["tests/helpers/setup.ts"],
    testTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/cadfly/**/*.ts"],
      exclude: ["src/cadfly/**/*.bundle.ts", "src/cadfly/**/*.d.ts"],
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
