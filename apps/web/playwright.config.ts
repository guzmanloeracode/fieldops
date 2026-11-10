import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";

// Local runs use the dev server that is already running (PLAYWRIGHT_BASE_URL, default :3100).
// In CI, Playwright starts the production build itself.
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? (process.env.CI ? "http://127.0.0.1:3000" : "http://localhost:3100");

// Locally, artifacts go outside the repository: files written inside the Next.js project make the dev server
// rebuild and reload pages in a loop. In CI they stay next to the config so they can be uploaded.
const artifacts = process.env.CI ? import.meta.dirname : path.join(tmpdir(), "fieldops-e2e");

export default defineConfig({
  testDir: "./e2e",
  outputDir: path.join(artifacts, "test-results"),
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [
        ["list"],
        ["html", { open: "never", outputFolder: path.join(artifacts, "playwright-report") }],
        ["github"],
      ]
    : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "America/Chicago",
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
  ],
  webServer: process.env.CI
    ? {
        command: "node .next/standalone/apps/web/server.js",
        url: `${baseURL}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: { PORT: "3000", HOSTNAME: "127.0.0.1" },
      }
    : undefined,
});
