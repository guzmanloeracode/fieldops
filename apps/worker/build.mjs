// Bundles the worker with all its dependencies into one ESM file, so the runtime image needs only Node,
// dist/ and the SQL migrations.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // The email templates (packages/email) are TSX with the automatic runtime.
  jsx: "automatic",
  outfile: "dist/index.js",
  sourcemap: "linked",
  minifySyntax: true,
  external: ["pg-native"],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; import { dirname as __dn } from 'node:path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);",
  },
  logLevel: "warning",
});
console.log("worker built");
