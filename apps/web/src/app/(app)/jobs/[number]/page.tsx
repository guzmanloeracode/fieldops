import {
  can,
  checklists,
  DomainError,
  formatJobNumber,
  jobs,
  organization,
  signatures,
  STATUS_LABELS,
  timeEntries,
} from "@fieldops/core";
import { ArrowLeft, Inbox, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PriorityBadge, StatusBadge } from "@/components/app/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatWindow } from "@/lib/format";
import { requireActor, runService } from "@/server/context";
import { AiReview } from "./ai-review";
import { AssignCard } from "./assign-card";
import { Attachments } from "./attachments";
import { JobExpenses } from "./expenses";
import { Checklist } from "./checklist";
import { JobMenu } from "./job-menu";
import { Notes } from "./notes";
import { ServiceReport } from "./service-report";
import { SignatureCard } from "./signature-card";
import { SlaCard } from "./sla-card";
import { SiteMap } from "./site-map";
import { TimeEntries } from "./time-entries";
import { Timeline } from "./timeline";
import { TransitionButtons } from "./transition-buttons";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ number: string }>;
}): Promise<Metadata> {
  const { number } = await params;
  return { title: number.toUpperCase() };
}

export default async function JobPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const actor = await requireActor();
  const t = await getTranslations("jobs");
  const tz = actor.organization.timezone;
  const office = can(actor, "jobs.update");

  const data = await runService(async (ctx) => {
    let job;
    try {
      job = await jobs.getJob(ctx, number);
    } catch (err) {
      if (err instanceof DomainError && err.code === "not_found") return null;
      throw err;
    }
    const [
      actions,
      notes,
      events,
      attachments,
      members,
      serviceTypes,
      contacts,
      equipment,
      checklistItems,
      time,
      org,
    ] = await Promise.all([
      jobs.getJobActions(ctx, job),
      jobs.listNotes(ctx, job.id),
      jobs.listJobEvents(ctx, job.id),
      jobs.listAttachments(ctx, job.id),
      office ? organization.listAssignableMembers(ctx) : Promise.resolve([]),
      office ? organization.listServiceTypes(ctx) : Promise.resolve([]),
      ctx.store.customers.contacts(job.customerId),
      job.equipmentId ? ctx.store.equipment.get(job.equipmentId) : Promise.resolve(null),
      checklists.getChecklist(ctx, job.id),
      timeEntries.listTimeEntries(ctx, job.id),
      ctx.store.organization.get(),
    ]);
    return {
      job,
      actions,
      notes,
      events,
      attachments,
      members,
      serviceTypes,
      contacts,
      equipment,
      checklistItems,
      time,
      requireSignature: org.settings.requireSignature,
    };
  });
  if (!data) notFound();
  const { job } = data;
  const jobNumber = formatJobNumber(job.number);
  const primary = data.contacts[0];
  const assigned = job.assignees.some((a) => a.memberId === actor.memberId);
  const canWork = can(actor, "jobs.work", { assigned });
  const technician = actor.role === "technician";
  const open = job.status !== "completed" && job.status !== "canceled";
  const signature = signatures.latestSignature(data.attachments);
  const gallery = data.attachments.filter((a) => a.kind !== "signature");
  const photos = gallery
    .filter((a) => a.kind === "photo")
    .map((a) => ({ id: a.id, fileName: a.fileName, url: a.url, thumbUrl: a.thumbUrl }));

  return (
    <div className={technician ? "space-y-6 pb-24 lg:pb-0" : "space-y-6"}>
      <div>
        <Link
          href="/jobs"
          className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" /> {t("title")}
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground font-mono">{jobNumber}</span>
              <span data-testid="job-status">
                <StatusBadge status={job.status} />
              </span>
              <PriorityBadge priority={job.priority} />
              {job.needsReview ? (
                <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  <Inbox className="size-3" aria-hidden /> {t("needsReview")}
                </span>
              ) : null}
              {job.holdReason ? (
                <span className="text-muted-foreground text-xs">{t(`holdReason.${job.holdReason}`)}</span>
              ) : null}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-balance">{job.title}</h1>
            <p className="text-muted-foreground text-sm">
              <Link
                href={`/customers/${job.customer.id}`}
                className="hover:text-foreground font-medium underline-offset-2 hover:underline"
              >
                {job.customer.name}
              </Link>{" "}
              · {job.site.label}, {job.site.address.city}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* On phones, technicians get the status buttons in a bar at the bottom of the screen (TEC-02). */}
            <div
              data-testid="action-bar"
              className={
                technician
                  ? "bg-background/95 fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur empty:hidden lg:static lg:z-auto lg:flex-wrap lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none"
                  : "contents"
              }
            >
              <TransitionButtons
                jobId={job.id}
                version={job.version}
                bar={technician}
                actions={data.actions.map((a) => ({
                  to: a.to,
                  name: a.name,
                  requiresReason: Boolean(a.requiresReason),
                }))}
                completion={{
                  requireSignature: data.requireSignature,
                  signedBy: signature ? (signature.caption ?? primary?.name ?? "—") : null,
                  missingItems: data.checklistItems
                    .filter((i) => i.required && !i.doneAt)
                    .map((i) => i.label),
                  suggestedSigner: primary?.name ?? null,
                }}
              />
            </div>
            {office ? (
              <JobMenu
                job={{
                  id: job.id,
                  version: job.version,
                  title: job.title,
                  description: job.description,
                  priority: job.priority,
                  serviceTypeId: job.serviceTypeId,
                  estimatedDurationMin: job.estimatedDurationMin,
                  preferredStart: job.preferredStart?.toISOString() ?? null,
                  preferredEnd: job.preferredEnd?.toISOString() ?? null,
                }}
                serviceTypes={data.serviceTypes.map((s) => ({ id: s.id, name: s.name }))}
                canDelete={can(actor, "jobs.delete")}
                timeZone={tz}
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {office && job.needsReview ? <AiReview jobId={job.id} /> : null}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("detail.details")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {job.description ? (
                <p className="text-sm whitespace-pre-line">{job.description}</p>
              ) : (
                <p className="text-muted-foreground text-sm">{t("detail.noDescription")}</p>
              )}
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Item label={t("col.serviceType")}>{job.serviceType?.name ?? "—"}</Item>
                <Item label={t("detail.equipment")}>
                  {data.equipment
                    ? [data.equipment.type, data.equipment.brand, data.equipment.model]
                        .filter(Boolean)
                        .join(" · ")
                    : "—"}
                </Item>
                <Item label={t("detail.preferredWindow")}>
                  {job.preferredStart ? formatWindow(job.preferredStart, job.preferredEnd, tz) : "—"}
                </Item>
                <Item label={t("detail.estimate")}>
                  {job.estimatedDurationMin ? t("detail.minutes", { n: job.estimatedDurationMin }) : "—"}
                </Item>
                <Item label={t("detail.source")}>{t(`source.${job.source}`)}</Item>
                <Item label={t("detail.created")}>{formatDateTime(job.createdAt, tz)}</Item>
                {job.completedAt ? (
                  <Item label={STATUS_LABELS.completed}>{formatDateTime(job.completedAt, tz)}</Item>
                ) : null}
                {job.canceledAt ? (
                  <Item label={STATUS_LABELS.canceled}>{formatDateTime(job.canceledAt, tz)}</Item>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <ServiceReport jobId={job.id} completed={job.status === "completed"} />

          <Checklist
            jobId={job.id}
            canEdit={canWork && open}
            timeZone={tz}
            photos={photos}
            items={data.checklistItems.map((i) => ({
              id: i.id,
              label: i.label,
              kind: i.kind,
              unit: i.unit,
              required: i.required,
              value: i.value,
              doneAt: i.doneAt?.toISOString() ?? null,
              doneBy: i.doneBy?.name ?? null,
            }))}
          />

          <Notes
            jobId={job.id}
            canAdd={canWork}
            timeZone={tz}
            notes={data.notes.map((n) => ({
              id: n.id,
              body: n.body,
              visibility: n.visibility,
              author: n.author?.name ?? null,
              createdAt: n.createdAt.toISOString(),
            }))}
          />

          <Attachments
            jobId={job.id}
            canUpload={canWork}
            storageReady
            actorUserId={actor.userId}
            canRemoveAny={office}
            items={gallery.map((a) => ({
              id: a.id,
              fileName: a.fileName,
              mimeType: a.mimeType,
              sizeBytes: a.sizeBytes,
              tag: a.tag,
              url: a.url,
              thumbUrl: a.thumbUrl,
              uploadedBy: a.uploadedBy,
            }))}
          />

          {signature ? (
            <SignatureCard
              url={signature.url}
              signer={signature.caption}
              signedAt={signature.createdAt.toISOString()}
              timeZone={tz}
            />
          ) : null}

          <TimeEntries
            jobId={job.id}
            timeZone={tz}
            actorMemberId={actor.memberId}
            canEditAll={office}
            canAddOwn={assigned && canWork}
            members={job.assignees.map((a) => ({ id: a.memberId, name: a.name }))}
            entries={data.time.entries.map((e) => ({
              id: e.id,
              memberId: e.member.id,
              memberName: e.member.name,
              kind: e.kind,
              startedAt: e.startedAt.toISOString(),
              endedAt: e.endedAt?.toISOString() ?? null,
              source: e.source,
              editedReason: e.editedReason,
            }))}
          />

          <JobExpenses jobId={job.id} status={job.status} assigned={assigned} />

          <Timeline
            timeZone={tz}
            events={data.events.map((e) => ({
              id: e.id,
              type: e.type,
              fromStatus: e.fromStatus,
              toStatus: e.toStatus,
              actor: e.actor?.name ?? null,
              payload: e.payload,
              createdAt: e.createdAt.toISOString(),
            }))}
            members={Object.fromEntries([
              ...data.members.map((m) => [m.id, m.name]),
              ...job.assignees.map((a) => [a.memberId, a.name]),
            ])}
          />
        </div>

        <div className="space-y-6">
          <AssignCard
            jobId={job.id}
            status={job.status}
            canAssign={office && job.status !== "completed" && job.status !== "canceled"}
            timeZone={tz}
            assignees={job.assignees}
            scheduledStart={job.scheduledStart?.toISOString() ?? null}
            scheduledEnd={job.scheduledEnd?.toISOString() ?? null}
            estimatedDurationMin={job.estimatedDurationMin}
            members={data.members.map((m) => ({ id: m.id, name: m.name, role: m.role }))}
          />

          <SlaCard job={job} timeZone={tz} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("detail.location")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {job.site.latitude !== null && job.site.longitude !== null ? (
                <SiteMap latitude={job.site.latitude} longitude={job.site.longitude} label={job.site.label} />
              ) : null}
              <div className="flex gap-2">
                <MapPin className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                <div>
                  <p className="font-medium">{job.site.label}</p>
                  <p className="text-muted-foreground">
                    {job.site.address.line1}
                    {job.site.address.line2 ? `, ${job.site.address.line2}` : ""}
                    <br />
                    {[job.site.address.city, job.site.address.region, job.site.address.postal_code]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                  {job.site.latitude !== null && job.site.longitude !== null ? (
                    <a
                      className="text-primary text-xs hover:underline"
                      href={`https://www.google.com/maps/dir/?api=1&destination=${job.site.latitude},${job.site.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("detail.directions")}
                    </a>
                  ) : null}
                </div>
              </div>
              {job.site.accessNotes ? (
                <p className="bg-muted rounded-md p-2 text-xs">
                  <span className="font-medium">{t("detail.access")}:</span> {job.site.accessNotes}
                </p>
              ) : null}
              {primary ? (
                <div className="flex gap-2 border-t pt-3">
                  <Phone className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                  <div>
                    <p className="font-medium">{primary.name}</p>
                    {primary.phone ? (
                      <a
                        href={`tel:${primary.phone.replace(/[^\d+]/g, "")}`}
                        className="text-primary hover:underline"
                      >
                        {primary.phone}
                      </a>
                    ) : null}
                    {primary.email ? <p className="text-muted-foreground text-xs">{primary.email}</p> : null}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
