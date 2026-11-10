import "server-only";
import pino from "pino";
import { env } from "@/env";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "web", version: env.APP_VERSION },
  redact: ["req.headers.cookie", "req.headers.authorization", "password", "*.password", "token"],
});
