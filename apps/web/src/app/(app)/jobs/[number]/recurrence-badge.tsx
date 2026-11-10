import { can, type Actor, type JobView } from "@fieldops/core";
import { getLocale, getTranslations } from "next-intl/server";
import { RecurringBadge } from "@/components/app/recurring-badge";
import { formatDay, planHref } from "@/lib/recurrence";
import { runService } from "@/server/context";

/**
 * On a job a maintenance plan created (JOB-13): the "Recurring" badge, linking office roles to the plan, and the
 * plan's preferred technician while nobody is assigned yet (it is a suggestion, not an assignment).
 */
export async function JobRecurrence({ job, actor }: { job: JobView; actor: Actor }) {
  if (!job.recurrenceId) return null;
  const t = await getTranslations("recurrences.badge");
  const locale = await getLocale();
  const office = can(actor, "recurrences.manage");
  const plan = office ? await runService((ctx) => ctx.store.recurrences.get(job.recurrenceId!), actor) : null;
  const open = job.status !== "completed" && job.status !== "canceled";
  const suggested = plan?.leadMember && open && job.assignees.length === 0 ? plan.leadMember.name : null;
  return (
    <>
      <RecurringBadge
        href={plan ? planHref(job.customer.id, plan.id) : null}
        title={t("title", { date: job.occurrenceDate ? formatDay(job.occurrenceDate, "long", locale) : "—" })}
      />
      {suggested ? (
        <span className="text-muted-foreground text-xs" data-testid="suggested-technician">
          {t("suggested", { name: suggested })}
        </span>
      ) : null}
    </>
  );
}
