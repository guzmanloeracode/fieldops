import { formatJobNumber, parseJobNumber } from "@fieldops/core";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatWindow } from "@/lib/format";
import { getPortalOrg } from "@/server/portal/session";
import { PortalStatus } from "../../status";
import { loadPortalJob } from "./load";
import { PortalReportCard } from "./report-card";

/** One job as the customer sees it (POR-03): status, visit, technician's first name, request and history. */
export default async function PortalJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; number: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { slug, number } = await params;
  const { created } = await searchParams;
  const org = (await getPortalOrg(slug))!;
  const t = await getTranslations("portal.job");
  const ts = await getTranslations("portal.job.step");
  const d = await loadPortalJob(slug, parseJobNumber(number)!);
  const tz = org.timezone;
  const j = d.job;
  return (
    <div className="space-y-6">
      <Link
        href={`/portal/${slug}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft aria-hidden className="size-4" /> {t("back")}
      </Link>
      {created ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
          data-testid="portal-request-sent"
        >
          <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t("created", { number: formatJobNumber(j.number) })}
        </p>
      ) : null}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground font-mono text-sm">{formatJobNumber(j.number)}</span>
          <PortalStatus status={j.status} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{j.title}</h1>
      </div>
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground text-xs">{t("visit")}</p>
            <p className="text-sm font-medium">
              {j.scheduledStart ? formatWindow(j.scheduledStart, j.scheduledEnd, tz) : t("noVisit")}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t("technician")}</p>
            <p className="text-sm font-medium">{j.technicianFirstName ?? "—"}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-muted-foreground text-xs">{t("address")}</p>
            <p className="text-sm font-medium">
              {j.site.label} · {j.site.line1}, {j.site.city}
            </p>
          </div>
        </CardContent>
      </Card>
      <PortalReportCard slug={slug} number={j.number} timeZone={tz} />
      {j.description || d.requestedWindows.length || d.photos.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>{t("request")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {j.description ? <p className="text-sm whitespace-pre-line">{j.description}</p> : null}
            {d.requestedWindows.length ? (
              <div>
                <h3 className="text-muted-foreground text-xs">{t("windows")}</h3>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {d.requestedWindows.map((w) => (
                    <li key={w.start.toISOString()}>{formatWindow(w.start, w.end, tz)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {d.photos.length ? (
              <div>
                <h3 className="text-muted-foreground text-xs">{t("photos")}</h3>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {d.photos.map((p) =>
                    p.url ? (
                      <li key={p.id}>
                        <a href={p.url} target="_blank" rel="noreferrer" className="block">
                          <img
                            src={p.thumbUrl ?? p.url}
                            alt={t("photo", { name: p.fileName })}
                            className="size-24 rounded-lg border object-cover"
                          />
                        </a>
                      </li>
                    ) : null,
                  )}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {d.notes.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>{t("notes", { org: org.name })}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {d.notes.map((n, i) => (
              <div key={i}>
                <p className="text-sm whitespace-pre-line">{n.body}</p>
                <time className="text-muted-foreground text-xs" dateTime={n.createdAt.toISOString()}>
                  {formatDateTime(n.createdAt, tz)}
                </time>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>{t("history")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="relative space-y-4 border-l pl-5" data-testid="portal-history">
            {d.steps.map((s, i) => (
              <li key={i} className="relative">
                <span
                  aria-hidden
                  className="bg-background ring-border absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-2"
                />
                <p className="text-sm">
                  {s.status === "scheduled" && s.window
                    ? ts("scheduled", { window: formatWindow(s.window.start, s.window.end, tz) })
                    : ts(s.status)}
                </p>
                <time className="text-muted-foreground text-xs" dateTime={s.at.toISOString()}>
                  {formatDateTime(s.at, tz)}
                </time>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
