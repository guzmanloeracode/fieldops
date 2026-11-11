import { env } from "@/env";

export const dynamic = "force-dynamic";

// The public demo's webhook test receiver (PLT-03, ADR 022): demo endpoints may only point here or at webhook.site,
// so the delivery log shows real attempts without the demo sending requests to anyone else. It answers 204 and
// keeps nothing. Outside the demo it doesn't exist.

const MAX_BODY_BYTES = 256 * 1024;

export async function POST(req: Request): Promise<Response> {
  if (!env.DEMO_MODE) return new Response(null, { status: 404 });
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return new Response(null, { status: 413 });
  await req.body?.cancel().catch(() => {});
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
