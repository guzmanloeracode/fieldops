import { formatJobNumber, reports } from "@fieldops/core";
import { Download, FileText } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { runPortal } from "@/server/portal/session";

/** "Service report" on the customer's job page (POR-04): a download once the business has sent it. */
export async function PortalReportCard({
  slug,
  number,
  timeZone,
}: {
  slug: string;
  number: number;
  timeZone: string;
}) {
  const found = await runPortal(slug, (ctx) => reports.portalReport(ctx, number));
  if (!found) return null;
  const t = await getTranslations("reports.portal");
  const { report } = found;
  return (
    <Card data-testid="portal-report">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-4" aria-hidden />
          <h2>{t("title")}</h2>
        </CardTitle>
        <CardDescription>
          {report.sentAt ? t("sent", { date: formatDateTime(report.sentAt, timeZone) }) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {report.workPerformed ? (
          <p className="text-muted-foreground line-clamp-3 text-sm whitespace-pre-line">
            {report.workPerformed}
          </p>
        ) : null}
        <Button asChild>
          <a href={`/portal/${slug}/jobs/${formatJobNumber(number)}/report`} download>
            <Download aria-hidden /> {t("download")}
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
