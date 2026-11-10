import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // Rendering embeds fonts and images; the first render in a worker also loads the fonts.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/fonts.generated.ts", "src/test-fixtures.ts"],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 80 },
      reporter: ["text-summary"],
    },
  },
});
