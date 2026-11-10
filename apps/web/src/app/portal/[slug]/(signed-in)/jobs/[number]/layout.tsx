import { NotFoundError, parseJobNumber } from "@fieldops/core";
import { foundOr404 } from "@/server/guards";
import { loadPortalJob } from "./load";

/** Another customer's job, or one that doesn't exist, is a 404, decided before the skeleton streams. */
export default async function PortalJobLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string; number: string }>;
}) {
  const { slug, number } = await params;
  const n = parseJobNumber(number);
  await foundOr404(n ? loadPortalJob(slug, n) : Promise.reject(new NotFoundError("Job")));
  return children;
}
