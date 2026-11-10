import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { portal, type PortalActor, type PortalContext, type Store } from "@fieldops/core";
import { schema, withStore, type Tx } from "@fieldops/db";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { env } from "@/env";
import { db } from "@/server/db";
import { files } from "@/server/files";
import { notificationMailer } from "@/server/notification-mailer";
import { requestMeta } from "@/server/request-meta";

// Customer portal sessions (POR-01). The cookie holds a random token scoped to /portal/<slug>; the database keeps
// only its SHA-256. Each portal request resolves the organization by slug, then works inside that organization's
// tenant transaction with the signed-in contact's customer as the only scope.

export const PORTAL_COOKIE = "fieldops_portal";

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export interface PortalOrg {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  brandColor: string | null;
  timezone: string;
  isDemo: boolean;
}

/** The organization of a portal URL. The organization table has no RLS, so this needs no tenant. */
export const getPortalOrg = cache(async (slug: string): Promise<PortalOrg | null> => {
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return null;
  const [o] = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      logo: schema.organization.logo,
      brandColor: schema.organization.brandColor,
      timezone: schema.organization.timezone,
      isDemo: schema.organization.isDemo,
    })
    .from(schema.organization)
    .where(eq(schema.organization.slug, slug));
  return o ?? null;
});

/** Runs `fn` in the organization's tenant transaction, with the visitor's IP and user agent for the audit log. */
export async function withPortalStore<T>(
  org: PortalOrg,
  fn: (store: Store, tx: Tx) => Promise<T>,
): Promise<T> {
  const meta = await requestMeta();
  return withStore(db, org.id, fn, { userId: null, ip: meta.ip, userAgent: meta.userAgent });
}

/** The signed-in portal customer of this organization, or null. */
export const getPortalActor = cache(async (slug: string): Promise<PortalActor | null> => {
  const org = await getPortalOrg(slug);
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!org || !token || token.length > 100) return null;
  return withPortalStore(org, (store) => portal.resolvePortalSession(store, hashToken(token), new Date()));
});

/** For portal pages: the organization (or a 404) and the signed-in customer (or the sign-in page). */
export async function requirePortal(slug: string): Promise<{ org: PortalOrg; actor: PortalActor }> {
  const org = await getPortalOrg(slug);
  if (!org) notFound();
  const actor = await getPortalActor(slug);
  if (!actor) redirect(`/portal/${slug}/sign-in`);
  return { org, actor };
}

/** Runs a portal service for the signed-in customer. Throws when signed out (actions check first). */
export async function runPortal<T>(slug: string, fn: (ctx: PortalContext) => Promise<T>): Promise<T> {
  const { org, actor } = await requirePortal(slug);
  return withPortalStore(org, (store, tx) =>
    fn({
      portal: actor,
      store,
      now: new Date(),
      demo: env.DEMO_MODE,
      files,
      mailer: notificationMailer(tx, org.id),
    }),
  );
}

export async function setPortalCookie(slug: string, token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(PORTAL_COOKIE, token, {
    httpOnly: true,
    secure: env.APP_URL.startsWith("https"),
    sameSite: "lax",
    path: `/portal/${slug}`,
    expires: expiresAt,
  });
}

export async function clearPortalCookie(slug: string): Promise<string | undefined> {
  const jar = await cookies();
  const token = jar.get(PORTAL_COOKIE)?.value;
  jar.set(PORTAL_COOKIE, "", { path: `/portal/${slug}`, maxAge: 0 });
  return token;
}
