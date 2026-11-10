import { ApiReference } from "@scalar/nextjs-api-reference";

/** Interactive API reference (Scalar) for /api/v1. Public. */
export const GET = ApiReference({
  url: "/api/v1/openapi.json",
  pageTitle: "FieldOps API reference",
  theme: "default",
  hideClientButton: false,
  metaData: { description: "REST API reference for FieldOps, an open-source field service management SaaS." },
});
