import "server-only";
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1).default("postgres://fieldops_app:app-dev@127.0.0.1:55432/fieldops"),
  BETTER_AUTH_SECRET: z.string().min(32).default("dev-secret-dev-secret-dev-secret-dev-secret"),
  DEMO_MODE: bool,
  DEMO_PASSWORD: z.string().min(8).default("demo-dev-password"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  APP_VERSION: z.string().default("dev"),
  APP_COMMIT: z.string().default("local"),
  GITHUB_URL: z.string().default("https://github.com/guzmanloeracode/fieldops"),
});

export const env = schema.parse(process.env);
export const fileStorageConfigured = Boolean(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
