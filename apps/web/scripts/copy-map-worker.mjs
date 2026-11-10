// MapLibre starts its worker from a file next to its own module. The Next.js bundle moves the module, so the
// worker would 404 and maps would draw no tiles. Copy the worker into public/ and point MapLibre at it
// (src/lib/maplibre.ts). Runs before `next dev` and `next build`.
import { copyFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
copyFileSync(
  require.resolve("maplibre-gl/dist/maplibre-gl-worker.mjs"),
  new URL("../public/maplibre-gl-worker.mjs", import.meta.url),
);
