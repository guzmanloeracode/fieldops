import { requireActor } from "@/server/context";
import { PageHeader } from "@/components/app/page-header";

export default async function DashboardPage() {
  const actor = await requireActor();
  return <PageHeader title={`Good day, ${actor.name.split(" ")[0]}`} description={actor.organization.name} />;
}
