"use server";
import { ConflictError, portal, ValidationError } from "@fieldops/core";
import { DEMO_PORTAL_LOGINS } from "@fieldops/db/seed";
import { PORTAL_LINK_TTL_MIN, portalLinkRequestSchema, type PortalPhotoUploadInput } from "@fieldops/shared";
import { redirect } from "next/navigation";
import { env } from "@/env";
import { action } from "@/server/context";
import { rememberDemoInbox } from "@/server/demo-inbox";
import { logger } from "@/server/logger";
import { queueEmail } from "@/server/mailer";
import { allowRequest } from "@/server/portal/rate-limit";
import {
  clearPortalCookie,
  getPortalOrg,
  hashToken,
  newToken,
  requirePortal,
  runPortal,
  setPortalCookie,
  withPortalStore,
} from "@/server/portal/session";
import { signPhoto, verifyPhoto } from "@/server/portal/upload-token";
import { requestMeta } from "@/server/request-meta";

type Result = { ok: true } | { ok: false; message: string };

/**
 * Emails a one-time sign-in link (POR-01). The answer is the same whether or not the email belongs to a customer,
 * so the form can't be used to find out who is one.
 */
export async function requestPortalLinkAction(slug: string, email: string): Promise<Result> {
  const org = await getPortalOrg(slug);
  if (!org) return { ok: false, message: "This portal doesn't exist" };
  const parsed = portalLinkRequestSchema.safeParse({ email: email.trim().toLowerCase() });
  if (!parsed.success) return { ok: false, message: "Enter a valid email" };
  const address = parsed.data.email;
  const { ip } = await requestMeta();
  const allowed =
    (await allowRequest(`portal-link:email:${org.id}:${address}`, 5, 3600)) &&
    (await allowRequest(`portal-link:ip:${ip ?? "unknown"}`, 20, 3600));
  if (!allowed) return { ok: false, message: "Too many sign-in links were requested. Try again in an hour." };

  const token = newToken();
  const contact = await withPortalStore(org, async (store) => {
    const c = await portal.findPortalContact(store, address);
    if (c) await portal.issuePortalLink(store, c.id, hashToken(token), new Date());
    return c;
  });
  if (contact) {
    await queueEmail(
      {
        kind: "portal.magic_link",
        to: address,
        props: {
          name: contact.name,
          organizationName: org.name,
          url: `${env.APP_URL}/portal/${org.slug}/auth?token=${token}`,
          minutes: PORTAL_LINK_TTL_MIN,
        },
      },
      org.id,
    );
  } else {
    logger.info({ orgId: org.id }, "portal link requested for an unknown email");
  }
  // In the demo, the visitor may read what was sent to this address (nothing, for unknown addresses).
  await rememberDemoInbox(address);
  return { ok: true };
}

/** Uses a sign-in link and starts a 30-day portal session. */
export async function redeemPortalLinkAction(slug: string, token: string): Promise<Result> {
  const org = await getPortalOrg(slug);
  if (!org || !token || token.length > 100) return { ok: false, message: "This link isn't valid" };
  const session = newToken();
  const meta = await requestMeta();
  const redeemed = await withPortalStore(org, (store) =>
    portal.redeemPortalLink(store, {
      linkHash: hashToken(token),
      sessionHash: hashToken(session),
      now: new Date(),
      ip: meta.ip,
      userAgent: meta.userAgent,
    }),
  );
  if (!redeemed) return { ok: false, message: "This link has expired or was already used" };
  await setPortalCookie(org.slug, session, redeemed.expiresAt);
  redirect(`/portal/${org.slug}`);
}

/** One click into the portal as the demo organization's fictional customer (demo only). */
export async function demoPortalSignInAction(slug: string): Promise<void> {
  const org = await getPortalOrg(slug);
  const login = org ? DEMO_PORTAL_LOGINS[org.slug as keyof typeof DEMO_PORTAL_LOGINS] : undefined;
  if (!env.DEMO_MODE || !org?.isDemo || !login) redirect(`/portal/${slug}/sign-in`);
  const session = newToken();
  const meta = await requestMeta();
  const expiresAt = await withPortalStore(org, async (store) => {
    const contact = await portal.findPortalContact(store, login.email);
    if (!contact) return null;
    return portal.openPortalSession(store, {
      contact,
      sessionHash: hashToken(session),
      now: new Date(),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });
  if (!expiresAt) redirect(`/portal/${slug}/sign-in`);
  await setPortalCookie(org.slug, session, expiresAt);
  redirect(`/portal/${org.slug}`);
}

export async function portalSignOutAction(slug: string): Promise<void> {
  const org = await getPortalOrg(slug);
  const token = await clearPortalCookie(slug);
  if (org && token) await withPortalStore(org, (store) => portal.closePortalSession(store, hashToken(token)));
  redirect(`/portal/${slug}/sign-in`);
}

/** Signed upload URLs for one request photo, plus a token to send with the request. */
export async function requestPortalPhotoAction(slug: string, input: PortalPhotoUploadInput) {
  return action(async () => {
    const { actor } = await requirePortal(slug);
    const r = await runPortal(slug, (ctx) => portal.requestPortalPhotoUpload(ctx, input));
    return {
      uploadUrl: r.uploadUrl,
      thumbnailUploadUrl: r.thumbnailUploadUrl,
      headers: r.headers,
      token: signPhoto(r.photo, actor.contactId),
    };
  });
}

/** Sends a service request (POR-02). Returns the new job's number for the confirmation page. */
export async function submitPortalRequestAction(slug: string, input: unknown, photoTokens: string[]) {
  return action(async () => {
    const { actor } = await requirePortal(slug);
    if (!(await allowRequest(`portal-request:${actor.contactId}`, 10, 86_400))) {
      throw new ConflictError("You've sent a lot of requests today. Please call us if it's urgent.");
    }
    const photos = photoTokens.slice(0, 10).map((t) => verifyPhoto(t, actor.contactId));
    if (photos.some((p) => p === null)) {
      throw new ValidationError("A photo couldn't be attached", [
        { path: "photos", message: "Upload the photo again" },
      ]);
    }
    return runPortal(slug, (ctx) =>
      portal.createPortalRequest(
        ctx,
        input,
        photos.filter((p) => p !== null),
      ),
    );
  });
}
