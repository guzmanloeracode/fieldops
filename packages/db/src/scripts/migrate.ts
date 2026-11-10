import { fileURLToPath } from "node:url";
import { runMigrations } from "../migrate";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is not set");
const folder = process.env.MIGRATIONS_FOLDER ?? fileURLToPath(new URL("../../drizzle", import.meta.url));
await runMigrations({ url, migrationsFolder: folder, appPassword: process.env.APP_DB_PASSWORD });
console.log("migrations applied");
