import pino from "pino";
import { env } from "./env";

export const log = pino({ level: env.logLevel, base: { service: "worker", version: env.version } });
