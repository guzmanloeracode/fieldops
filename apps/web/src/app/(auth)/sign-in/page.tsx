import type { Metadata } from "next";
import Link from "next/link";
import { DemoSignIn } from "@/components/app/demo-sign-in";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/env";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; verified?: string }> }) {
  const { next, verified } = await searchParams;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>Welcome back. Sign in to your FieldOps workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {verified ? <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">Email confirmed. You can sign in now.</p> : null}
          <SignInForm next={next?.startsWith("/") ? next : "/dashboard"} />
          <div className="flex justify-between text-sm">
            <Link href="/forgot-password" className="text-primary hover:underline">
              Forgot password?
            </Link>
            <Link href="/sign-up" className="text-primary hover:underline">
              Create an account
            </Link>
          </div>
        </CardContent>
      </Card>
      {env.DEMO_MODE ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Try the demo</CardTitle>
            <CardDescription>One click, no sign-up. Acme Air &amp; Clean is a fictional AC and cleaning company.</CardDescription>
          </CardHeader>
          <CardContent>
            <DemoSignIn />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
