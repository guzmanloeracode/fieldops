"use server";
import { schema, withStore } from "@fieldops/db";
import { organizationCreateSchema } from "@fieldops/shared";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getSession } from "@/server/context";
import { db } from "@/server/db";

const STARTER_SERVICES = [
  { name: "Inspection", defaultDurationMin: 60, price: { USD: 9_900, IDR: 15_000_000 } },
  { name: "Repair", defaultDurationMin: 120, price: { USD: 18_900, IDR: 25_000_000 } },
  { name: "Maintenance", defaultDurationMin: 90, price: { USD: 12_900, IDR: 8_500_000 } },
] as const;

export async function createOrganizationAction(input: unknown): Promise<{ ok: false; message: string; fields?: Record<string, string> }> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const parsed = organizationCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the highlighted fields", fields: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  }
  const v = parsed.data;
  let orgId: string;
  try {
    const org = await auth.api.createOrganization({
      body: { name: v.name, slug: v.slug, timezone: v.timezone, currency: v.currency, country: v.country },
      headers: await headers(),
    });
    if (!org) return { ok: false, message: "Couldn't create the organization" };
    orgId = org.id;
  } catch (err) {
    const message = (err as { body?: { message?: string } }).body?.message ?? "Couldn't create the organization";
    return { ok: false, message: /slug/i.test(message) ? "That URL is taken. Try another." : message, fields: /slug/i.test(message) ? { slug: "Already taken" } : undefined };
  }
  // A few starter service types so the first job can be created right away.
  await withStore(db, orgId, async (_store, tx) => {
    await tx.insert(schema.serviceType).values(
      STARTER_SERVICES.map((s) => ({ organizationId: orgId, name: s.name, defaultDurationMin: s.defaultDurationMin, defaultPriceMinor: s.price[v.currency], currency: v.currency })),
    );
  });
  redirect("/dashboard");
}
