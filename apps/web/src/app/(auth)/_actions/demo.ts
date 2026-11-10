"use server";
import { DEMO_LOGINS, type DemoOrg, type DemoRole } from "@fieldops/db/seed";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/env";
import { auth } from "@/server/auth";

/** One-click sign-in as a demo Owner, Dispatcher or Technician (AUTH-09). Only in the demo environment. */
export async function demoSignIn(formData: FormData) {
  if (!env.DEMO_MODE) redirect("/sign-in");
  const org = String(formData.get("org") ?? "acme-air") as DemoOrg;
  const role = String(formData.get("role") ?? "owner") as DemoRole;
  const email = DEMO_LOGINS[org]?.[role];
  if (!email) redirect("/sign-in");
  await auth.api.signInEmail({
    body: { email, password: env.DEMO_PASSWORD, rememberMe: false },
    headers: await headers(),
  });
  redirect(role === "technician" ? "/jobs?view=my-day" : "/dashboard");
}
