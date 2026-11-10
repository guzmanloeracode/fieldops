"use server";
import { assertCan, ConflictError, NotFoundError, organization } from "@fieldops/core";
import { schema } from "@fieldops/db";
import { inviteSchema, parseRole } from "./schemas";
import { parseInput } from "@fieldops/core";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/server/auth";
import { action, requireActor, runService } from "@/server/context";
import { db } from "@/server/db";

const PATH = "/settings/members";

/** Better Auth reports problems as APIError; surface its message as a normal form error. */
async function viaAuth<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof APIError) throw new ConflictError(err.message || "The request was rejected");
    throw err;
  }
}

export async function inviteMemberAction(input: unknown) {
  const result = await action(async () => {
    const actor = await requireActor();
    assertCan(actor, "members.invite");
    const { email, role } = parseInput(inviteSchema, input);
    await viaAuth(async () =>
      auth.api.createInvitation({
        body: { email, role, organizationId: actor.organizationId },
        headers: await headers(),
      }),
    );
    return { email };
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}

async function findInvitation(organizationId: string, invitationId: string) {
  const [inv] = await db
    .select()
    .from(schema.invitation)
    .where(and(eq(schema.invitation.id, invitationId), eq(schema.invitation.organizationId, organizationId)));
  if (!inv) throw new NotFoundError("Invitation");
  return inv;
}

export async function resendInvitationAction(invitationId: string) {
  const result = await action(async () => {
    const actor = await requireActor();
    assertCan(actor, "members.invite");
    const inv = await findInvitation(actor.organizationId, invitationId);
    const role = parseRole(inv.role);
    await viaAuth(async () =>
      auth.api.createInvitation({
        body: { email: inv.email, role, organizationId: actor.organizationId, resend: true },
        headers: await headers(),
      }),
    );
    return { id: invitationId };
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function revokeInvitationAction(invitationId: string) {
  const result = await action(async () => {
    const actor = await requireActor();
    assertCan(actor, "members.invite");
    await findInvitation(actor.organizationId, invitationId);
    await viaAuth(async () =>
      auth.api.cancelInvitation({ body: { invitationId }, headers: await headers() }),
    );
    return { id: invitationId };
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function changeRoleAction(memberId: string, role: string) {
  const result = await action(() =>
    runService((ctx) => organization.changeMemberRole(ctx, memberId, parseRole(role, true))).then(() => ({
      memberId,
    })),
  );
  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function removeMemberAction(memberId: string) {
  const result = await action(() =>
    runService((ctx) => organization.removeMember(ctx, memberId)).then(() => ({ memberId })),
  );
  if (result.ok) revalidatePath(PATH);
  return result;
}
