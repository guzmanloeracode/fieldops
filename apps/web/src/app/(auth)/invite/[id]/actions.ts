"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";

export async function acceptInvitationAction(formData: FormData) {
  const invitationId = String(formData.get("id"));
  const h = await headers();
  const result = await auth.api.acceptInvitation({ body: { invitationId }, headers: h });
  if (result?.member) {
    await auth.api.setActiveOrganization({
      body: { organizationId: result.member.organizationId },
      headers: h,
    });
  }
  redirect("/dashboard");
}
