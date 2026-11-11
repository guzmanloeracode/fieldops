"use server";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { env } from "@/env";
import { auth } from "@/server/auth";
import { rememberDemoInbox } from "@/server/demo-inbox";
import { logger } from "@/server/logger";

type Result = { ok: true } | { ok: false; message: string; fields?: Record<string, string> };

type Translate = (key: string) => string;

const signUpSchema = (t: Translate) =>
  z.object({
    name: z.string().trim().min(2, t("errors.name")).max(120),
    email: z.email(t("errors.email")).max(254).toLowerCase(),
    password: z.string().min(10, t("errors.password")).max(128),
    next: z.string().optional(),
  });
type SignUpInput = z.input<ReturnType<typeof signUpSchema>>;

function fieldErrors(error: z.ZodError): Record<string, string> {
  return Object.fromEntries(error.issues.map((i) => [String(i.path[0]), i.message]));
}

/** Better Auth's error code (`USER_ALREADY_EXISTS`, …), for logs and for picking a translated message. */
function codeOf(err: unknown): string | undefined {
  if (err && typeof err === "object" && "body" in err)
    return (err as { body?: { code?: string } }).body?.code;
  return undefined;
}

export async function signUpAction(input: SignUpInput): Promise<Result> {
  const t = await getTranslations("auth");
  const parsed = signUpSchema(t).safeParse(input);
  if (!parsed.success) return { ok: false, message: t("errors.check"), fields: fieldErrors(parsed.error) };
  const { name, email, password, next } = parsed.data;
  try {
    await auth.api.signUpEmail({
      body: { name, email, password, callbackURL: next?.startsWith("/invite/") ? next : "/onboarding" },
      headers: await headers(),
    });
  } catch (err) {
    const code = codeOf(err);
    logger.info({ code }, "sign-up rejected");
    return {
      ok: false,
      message: code?.startsWith("USER_ALREADY_EXISTS") ? t("errors.userExists") : t("errors.signUpFailed"),
    };
  }
  await rememberDemoInbox(email);
  return { ok: true };
}

export async function requestPasswordResetAction(email: string): Promise<Result> {
  const t = await getTranslations("auth");
  const parsed = z.email().safeParse(email.trim().toLowerCase());
  if (!parsed.success) return { ok: false, message: t("errors.email") };
  try {
    await auth.api.requestPasswordReset({
      body: { email: parsed.data, redirectTo: `${env.APP_URL}/reset-password` },
      headers: await headers(),
    });
  } catch (err) {
    logger.info({ code: codeOf(err) }, "password reset request rejected");
    return { ok: false, message: t("errors.emailFailed") };
  }
  await rememberDemoInbox(parsed.data);
  // Same answer whether or not the account exists, so emails can't be enumerated.
  return { ok: true };
}

export async function resendVerificationAction(email: string): Promise<Result> {
  const t = await getTranslations("auth");
  try {
    await auth.api.sendVerificationEmail({
      body: { email, callbackURL: "/onboarding" },
      headers: await headers(),
    });
  } catch (err) {
    logger.info({ code: codeOf(err) }, "verification email request rejected");
    return { ok: false, message: t("errors.emailFailed") };
  }
  await rememberDemoInbox(email);
  return { ok: true };
}
