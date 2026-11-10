import "server-only";
import { DomainError, HTTP_STATUS, type Actor, type ServiceContext } from "@fieldops/core";
import { schema, withStore } from "@fieldops/db";
import type { Role } from "@fieldops/shared";
import { and, asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { env } from "@/env";
import { auth } from "./auth";
import { db } from "./db";
import { files } from "./files";
import { logger } from "./logger";

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

export interface ResolvedActor extends Actor {
  email: string;
  organization: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    currency: string;
    isDemo: boolean;
  };
  isDemoUser: boolean;
}

/** Resolves the member for a user in an organization, falling back to their first membership. */
export async function resolveActor(
  userId: string,
  activeOrganizationId: string | null | undefined,
): Promise<ResolvedActor | null> {
  const rows = await db
    .select({ m: schema.member, u: schema.user, o: schema.organization })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(
      and(
        eq(schema.member.userId, userId),
        activeOrganizationId ? eq(schema.member.organizationId, activeOrganizationId) : undefined,
      ),
    )
    .orderBy(asc(schema.member.createdAt))
    .limit(1);
  const r = rows[0];
  // The active organization may be gone (left, removed or reset); fall back to the first membership.
  if (!r) return activeOrganizationId ? resolveActor(userId, null) : null;
  return {
    userId: r.u.id,
    memberId: r.m.id,
    organizationId: r.o.id,
    role: r.m.role as Role,
    name: r.u.name,
    email: r.u.email,
    isDemoUser: r.u.isDemo,
    organization: {
      id: r.o.id,
      name: r.o.name,
      slug: r.o.slug,
      timezone: r.o.timezone,
      currency: r.o.currency,
      isDemo: r.o.isDemo,
    },
  };
}

/** For pages: the signed-in member, or a redirect to sign-in / onboarding. */
export const requireActor = cache(async (): Promise<ResolvedActor> => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const actor = await resolveActor(session.user.id, session.session.activeOrganizationId);
  if (!actor) redirect("/onboarding");
  return actor;
});

function context(actor: Actor, store: ServiceContext["store"]): ServiceContext {
  return { actor, store, now: new Date(), demo: env.DEMO_MODE, files };
}

/** Runs a core service for the signed-in member in one tenant-scoped transaction. */
export async function runService<T>(fn: (ctx: ServiceContext) => Promise<T>, actor?: Actor): Promise<T> {
  const a = actor ?? (await requireActor());
  return withStore(db, a.organizationId, (store) => fn(context(a, store)));
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        fields?: { path: string; message: string }[];
        details?: Record<string, unknown>;
      };
    };

/** Wraps a server action: domain errors become typed results the form can show; anything else is logged. */
export async function action<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof DomainError) {
      return {
        ok: false,
        error: {
          code: err.code,
          message: err.message,
          fields: (err.details?.fields as { path: string; message: string }[] | undefined) ?? undefined,
          details: err.details,
        },
      };
    }
    // Next.js uses thrown errors for redirect() and notFound(); let them through.
    if (
      err &&
      typeof err === "object" &&
      "digest" in err &&
      String((err as { digest: unknown }).digest).startsWith("NEXT_")
    )
      throw err;
    logger.error({ err }, "server action failed");
    return { ok: false, error: { code: "internal", message: "Something went wrong. Please try again." } };
  }
}

export function statusFor(err: DomainError): number {
  return HTTP_STATUS[err.code];
}
