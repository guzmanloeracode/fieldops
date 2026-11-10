const bool = (v: string | undefined) => v === "true" || v === "1";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export const env = {
  databaseUrl: required("MIGRATION_DATABASE_URL"),
  demoMode: bool(process.env.DEMO_MODE),
  /** Public URL of the web app, for links in notification emails. */
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  demoPassword: process.env.DEMO_PASSWORD ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "FieldOps <no-reply@fieldops.local>",
  resendApiKey: process.env.RESEND_API_KEY,
  smtpUrl: process.env.SMTP_URL,
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "auto",
    bucket: process.env.S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  /** Local upload directory shared with the web container when R2 isn't configured (ADR 015). */
  filesDir: process.env.FILES_DIR,
  migrationsFolder: process.env.MIGRATIONS_FOLDER ?? "/app/drizzle",
  appDbPassword: process.env.APP_DB_PASSWORD,
  logLevel: process.env.LOG_LEVEL ?? "info",
  version: process.env.APP_VERSION ?? "dev",
  /** AI drafts for portal requests (AI-01); without a key requests are marked "skipped". */
  ai: {
    apiKey: process.env.ANTHROPIC_API_KEY || undefined,
    provider: process.env.AI_PROVIDER || undefined,
    intakeModel: process.env.AI_MODEL_INTAKE || undefined,
    /** Service report drafts (AI-03). */
    reportModel: process.env.AI_MODEL_REPORT || undefined,
  },
};
