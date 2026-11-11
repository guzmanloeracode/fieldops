import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests for the web app's pure modules (messages, formatting, locale helpers). Pages and actions are covered
// by the Playwright specs in e2e/.
export default defineConfig({
  resolve: { alias: { "@": path.join(import.meta.dirname, "src") } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
