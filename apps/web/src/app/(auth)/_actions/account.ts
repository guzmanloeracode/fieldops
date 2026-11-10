"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { env } from "@/env";
import { auth } from "@/server/auth";
import { rememberDemoInbox } from "@/server/demo-inbox";
import { logger } from "@/server/logger";

type Result = { ok: true } | { ok: false; message: string; fields?: Record<string, string> };

const signUpSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  email: z.email("Enter a valid email").max(254).toLowerCase(),
  password: z.string().min(10, "Use at least 10 characters").max(128),
  next: z.string().optional(),
});

function fieldErrors(error: z.ZodError): Record<string, string> {
  return Object.fromEntries(error.issues.map((i) => [String(i.path[0]), i.message]));
}

function messageOf(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "body" in err) {
    const body = (err as { body?: { message?: string } }).body;
    if (body?.message) return body.message;
  }
  return fallback;
}

export async function signUpAction(input: z.input<typeof signUpSchema>): Promise<Result> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: "Check the highlighted fields", fields: fieldErrors(parsed.error) };
  const { name, email, password, next } = parsed.data;
  try {
    await auth.api.signUpEmail({
      body: { name, email, password, callbackURL: next?.startsWith("/invite/") ? next : "/onboarding" },
      headers: await headers(),
    });
  } catch (err) {
    logger.info({ err: messageOf(err, "") }, "sign-up rejected");
    return { ok: false, message: messageOf(err, "Couldn't create the account") };
  }
  await rememberDemoInbox(email);
  return { ok: true };
}

export async function requestPasswordResetAction(email: string): Promise<Result> {
  const parsed = z.email().safeParse(email.trim().toLowerCase());
  if (!parsed.success) return { ok: false, message: "Enter a valid email" };
  try {
    await auth.api.requestPasswordReset({
      body: { email: parsed.data, redirectTo: `${env.APP_URL}/reset-password` },
      headers: await headers(),
    });
  } catch (err) {
    return { ok: false, message: messageOf(err, "Couldn't send the email") };
  }
  await rememberDemoInbox(parsed.data);
  // Same answer whether or not the account exists, so emails can't be enumerated.
  return { ok: true };
}

export async function resendVerificationAction(email: string): Promise<Result> {
  try {
    await auth.api.sendVerificationEmail({
      body: { email, callbackURL: "/onboarding" },
      headers: await headers(),
    });
  } catch (err) {
    return { ok: false, message: messageOf(err, "Couldn't send the email") };
  }
  await rememberDemoInbox(email);
  return { ok: true };
}
