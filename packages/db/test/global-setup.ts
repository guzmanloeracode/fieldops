import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";
import { runMigrations } from "../src/migrate";

declare module "vitest" {
  export interface ProvidedContext {
    pg: { host: string; port: number; user: string; password: string; template: string; appPassword: string };
  }
}

let container: StartedPostgreSqlContainer | undefined;

export default async function setup(project: TestProject) {
  container = await new PostgreSqlContainer("postgres:18-alpine")
    .withUsername("fieldops")
    .withPassword("fieldops")
    .withDatabase("fieldops_tpl")
    .withTmpFs({ "/var/lib/postgresql": "rw" })
    .start();
  const appPassword = "app-test-password";
  await runMigrations({
    url: container.getConnectionUri(),
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    appPassword,
  });
  project.provide("pg", {
    host: container.getHost(),
    port: container.getPort(),
    user: "fieldops",
    password: "fieldops",
    template: "fieldops_tpl",
    appPassword,
  });
  return async () => {
    await container?.stop();
  };
}
