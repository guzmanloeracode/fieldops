"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/server/auth";
import { action, getSession } from "@/server/context";
import { listMemberships } from "@/server/memberships";
import { NotFoundError } from "@fieldops/core";

/** Makes another of the user's organizations the active one for this session (AUTH-06). */
export async function switchOrganizationAction(organizationId: string) {
  return action(async () => {
    const session = await getSession();
    const id = z.uuid().safeParse(organizationId);
    if (!session || !id.success) throw new NotFoundError("Organization");
    const memberships = await listMemberships(session.user.id);
    const target = memberships.find((m) => m.organizationId === id.data);
    if (!target) throw new NotFoundError("Organization");
    await auth.api.setActiveOrganization({
      body: { organizationId: target.organizationId },
      headers: await headers(),
    });
    return { name: target.name };
  });
}
