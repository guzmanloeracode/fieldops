// Shared Vitest defaults for the workspace packages.
export const baseTest = {
  environment: "node" as const,
  include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  restoreMocks: true,
};
