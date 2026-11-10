import { audit, can, formatJobNumber, type AuditEntryRecord } from "@fieldops/core";
import type { Currency } from "@fieldops/shared";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";
import { csvRow } from "@/lib/csv";
import { inZone } from "@/lib/format";
import { getSession, resolveActor, runService, type ResolvedActor } from "@/server/context";
import { actorLabel, describeAction, entityName, formatValue } from "../format";

// CSV export of the audit log with the viewer's filters (AUD-03). Owners and admins. Rows stream page by page
// (keyset pagination, one short transaction per page), capped at 10,000.

export const dynamic = "force-dynamic";

const MAX_ROWS = 10_000;
const PAGE = 200;
const BOM = String.fromCharCode(0xfeff);
const FILTERS = ["actor", "entity_type", "operation", "entity_id", "from", "to"];

function problem(status: number, title: string) {
  return Response.json(
    { type: "about:blank", title, status },
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}

async function* entries(
  actor: ResolvedActor,
  query: Record<string, string>,
): AsyncGenerator<AuditEntryRecord> {
  let cursor: string | undefined;
  let sent = 0;
  do {
    const page = await runService((ctx) => audit.listAuditLog(ctx, { ...query, cursor, limit: PAGE }), actor);
    for (const e of page.rows) {
      if (sent >= MAX_ROWS) return;
      sent += 1;
      yield e;
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return problem(401, "Sign in to export the audit log");
  const actor = await resolveActor(session.user.id, session.session.activeOrganizationId);
  if (!actor) return problem(403, "You don't belong to an organization yet");
  if (!can(actor, "audit.view")) return problem(403, "Only owners and admins can export the audit log");

  const url = new URL(req.url);
  const query: Record<string, string> = {};
  for (const k of FILTERS) {
    const v = url.searchParams.get(k);
    if (v) query[k] = v;
  }
  // Fail early on bad filters, with a problem instead of a half-written file.
  try {
    await runService((ctx) => audit.listAuditLog(ctx, { ...query, limit: 1 }), actor);
  } catch {
    return problem(400, "Check the filters");
  }
  const t = (await getTranslations("audit")) as unknown as (
    key: string,
    values?: Record<string, string>,
  ) => string;
  const tz = actor.organization.timezone;
  const fmt = { timeZone: tz, currency: actor.organization.currency as Currency };
  const header = [
    t("csv.time"),
    t("csv.actor"),
    t("csv.action"),
    t("csv.entityType"),
    t("csv.entityId"),
    t("csv.job"),
    t("csv.changes"),
    t("csv.ip"),
    t("csv.userAgent"),
  ];
  const line = (e: AuditEntryRecord) =>
    csvRow([
      format(inZone(e.createdAt, tz), "yyyy-MM-dd HH:mm:ss"),
      actorLabel(t, e),
      describeAction(t, e),
      entityName(t, e.entityType),
      e.entityId,
      e.job ? formatJobNumber(e.job.number) : "",
      audit
        .auditChanges(e)
        .map(
          (c) =>
            `${c.field}: ${formatValue(t, c.field, c.before, fmt)} → ${formatValue(t, c.field, c.after, fmt)}`,
        )
        .join("; "),
      e.ip,
      e.userAgent,
    ]);

  const source = entries(actor, query);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(BOM + csvRow(header)));
    },
    async pull(controller) {
      try {
        const next = await source.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(line(next.value)));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await source.return(undefined);
    },
  });
  const today = format(inZone(new Date(), tz), "yyyy-MM-dd");
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${actor.organization.slug}-${today}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
