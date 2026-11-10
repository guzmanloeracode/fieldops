import { openApiDocument } from "@/server/api/openapi";

/** OpenAPI 3.1 description of /api/v1, generated from the shared Zod schemas. Public. */
export function GET() {
  return Response.json(openApiDocument(), {
    headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
