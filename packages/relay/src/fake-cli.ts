import { startFakeRelay } from "./fake";

// Local development: `pnpm --filter @fieldops/relay fake` starts the fake Relay on RELAY_PORT (default 8099) with
// RELAY_API_KEY (default "rk_dev"). Point the web app and the worker at it with RELAY_URL and RELAY_API_KEY.
const port = Number(process.env.RELAY_PORT ?? 8099);
const apiKey = process.env.RELAY_API_KEY ?? "rk_dev";
const relay = await startFakeRelay({ port, apiKey, host: process.env.RELAY_HOST ?? "127.0.0.1" });
console.log(`fake Relay listening on ${relay.url}`);
