import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  transpilePackages: [
    "@fieldops/core",
    "@fieldops/shared",
    "@fieldops/db",
    "@fieldops/email",
    "@fieldops/ai",
    "@fieldops/documents",
    "@fieldops/payments",
    "@fieldops/relay",
  ],
  // @react-pdf/renderer runs in Node only (FIN-04 PDFs are rendered on the server).
  serverExternalPackages: ["pg", "pino", "@react-pdf/renderer"],
  poweredByHeader: false,
  typedRoutes: false,
  agentRules: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(config);
