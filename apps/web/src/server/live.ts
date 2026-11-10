import "server-only";
import pg from "pg";
import { env } from "@/env";
import { logger } from "./logger";

// Live events (NOT-05, SCH-06, ADR 011). Database triggers publish a small JSON message on the "fieldops_live"
// channel when a change commits (migration 0003). Each web process holds ONE listening connection and fans the
// messages out to its server-sent-event streams, which filter them per organization and user.

export const LIVE_KINDS = ["job", "time_off", "expense", "notification", "quote", "invoice"] as const;
export type LiveKind = (typeof LIVE_KINDS)[number];

export interface LiveEvent {
  org: string;
  kind: LiveKind;
  id: string | null;
  /** The recipient, for notifications. */
  user: string | null;
}

type Listener = (event: LiveEvent) => void;

export function parseLiveEvent(payload: string | undefined): LiveEvent | null {
  if (!payload) return null;
  try {
    const raw = JSON.parse(payload) as Partial<LiveEvent>;
    if (typeof raw.org !== "string" || !LIVE_KINDS.includes(raw.kind as LiveKind)) return null;
    return { org: raw.org, kind: raw.kind as LiveKind, id: raw.id ?? null, user: raw.user ?? null };
  } catch {
    return null;
  }
}

class LiveHub {
  private readonly listeners = new Set<Listener>();
  private client: pg.Client | null = null;
  private connecting = false;
  private attempt = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  /** Adds a listener and makes sure the listening connection is up. Returns the unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    void this.connect();
    return () => {
      this.listeners.delete(listener);
      // Keep the connection a little while for page reloads; close it when nobody listens.
      if (this.listeners.size === 0 && !this.idleTimer) {
        this.idleTimer = setTimeout(() => {
          this.idleTimer = null;
          if (this.listeners.size === 0) void this.disconnect();
        }, 60_000);
        this.idleTimer.unref();
      }
    };
  }

  private async connect(): Promise<void> {
    if (this.client || this.connecting) return;
    this.connecting = true;
    const client = new pg.Client({ connectionString: env.DATABASE_URL, application_name: "fieldops-live" });
    client.on("notification", (msg) => {
      const event = parseLiveEvent(msg.payload);
      if (!event) return;
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch (err) {
          logger.warn({ err }, "live listener failed");
        }
      }
    });
    const lost = (err?: unknown) => {
      if (this.client !== client) return;
      this.client = null;
      if (err) logger.warn({ err }, "live connection lost");
      client.end().catch(() => undefined);
      this.scheduleReconnect();
    };
    client.on("error", lost);
    client.on("end", () => lost());
    try {
      await client.connect();
      await client.query("LISTEN fieldops_live");
      this.client = client;
      this.attempt = 0;
    } catch (err) {
      logger.warn({ err }, "live connection failed");
      client.end().catch(() => undefined);
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private scheduleReconnect() {
    if (this.retryTimer || this.listeners.size === 0) return;
    const delay = Math.min(30_000, 1_000 * 2 ** this.attempt);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
    this.retryTimer.unref();
  }

  private async disconnect() {
    const client = this.client;
    this.client = null;
    await client?.end().catch(() => undefined);
  }
}

// One hub per server process (kept across hot reloads in development).
const globalForLive = globalThis as unknown as { fieldopsLive?: LiveHub };
export const liveHub = (globalForLive.fieldopsLive ??= new LiveHub());
