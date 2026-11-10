import { defineConfig } from "vitest/config";

// Integration tests against a real PostgreSQL 18 in Docker (testcontainers). One container per run;
// migrations go into a template database and every test file gets its own copy, so files run in parallel.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: true,
  },
});
