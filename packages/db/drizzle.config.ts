import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL ?? "postgres://fieldops:fieldops@localhost:5432/fieldops" },
  casing: "snake_case",
});
