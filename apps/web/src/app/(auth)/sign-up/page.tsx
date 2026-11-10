import type { Metadata } from "next";
import { env, googleConfigured } from "@/env";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; next?: string }>;
}) {
  const { email, next } = await searchParams;
  return (
    <SignUpForm
      demo={env.DEMO_MODE}
      defaultEmail={email ?? ""}
      next={next?.startsWith("/") ? next : undefined}
      google={googleConfigured}
    />
  );
}
