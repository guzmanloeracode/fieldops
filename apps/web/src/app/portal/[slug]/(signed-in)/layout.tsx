import { requirePortal } from "@/server/portal/session";

/** Every page in this group needs a portal session; without one the visitor goes to the sign-in page. */
export default async function SignedInLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  await requirePortal((await params).slug);
  return children;
}
