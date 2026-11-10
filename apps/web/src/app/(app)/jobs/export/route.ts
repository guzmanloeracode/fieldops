import {
  can,
  formatJobNumber,
  jobs,
  NotFoundError,
  STATUS_LABELS,
  PRIORITY_LABELS,
  type JobView,
} from "@fieldops/core";
import { jobListQuerySchema } from "@fieldops/shared";
import { format } from "date-fns";
import { z } from "zod";
import { csvRow } from "@/lib/csv";
import { inZone } from "@/lib/format";
import { getSession, resolveActor, runService, type ResolvedActor } from "@/server/context";

// CSV export of the jobs table (JOB-04): the current filters, or the selected jobs (?ids=…). Office roles
// only. Rows stream page by page (keyset pagination, one short transaction per page), capped at 10,000.

export const dynamic = "force-dynamic";

const MAX_ROWS = 10_000;
const BOM = String.fromCharCode(0xfeff);
const PAGE = 100;
const HEADER = [
  "Number",
  "Title",
  "Status",
  "Priority",
  "Customer",
  "Site",
  "Address",
  "City",
  "Service type",
  "Technicians",
  "Scheduled start",
  "Scheduled end",
  "Created",
  "Completed",
];

function problem(status: number, title: string) {
  return Response.json(
    { type: "about:blank", title, status },
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}

function row(j: JobView, tz: string): string {
  const at = (d: Date | null) => (d ? format(inZone(d, tz), "yyyy-MM-dd HH:mm") : "");
  return csvRow([
    formatJobNumber(j.number),
    j.title,
    STATUS_LABELS[j.status],
    PRIORITY_LABELS[j.priority],
    j.customer.name,
    j.site.label,
    j.site.address.line1,
    j.site.address.city,
    j.serviceType?.name ?? "",
    j.assignees.map((a) => a.name).join("; "),
    at(j.scheduledStart),
    at(j.scheduledEnd),
    at(j.createdAt),
    at(j.completedAt),
  ]);
}

async function* selected(actor: ResolvedActor, ids: string[]): AsyncGenerator<JobView> {
  for (const id of ids) {
    const job = await runService((ctx) => jobs.getJob(ctx, id), actor).catch((err: unknown) => {
      if (err instanceof NotFoundError) return null;
      throw err;
    });
    if (job) yield job;
  }
}

async function* filtered(actor: ResolvedActor, url: URL): AsyncGenerator<JobView> {
  const raw: Record<string, string> = {};
  for (const [k, v] of url.searchParams) if (v && k !== "page" && k !== "cursor" && k !== "limit") raw[k] = v;
  const parsed = jobListQuerySchema.safeParse({ ...raw, limit: PAGE });
  const query = parsed.success ? parsed.data : jobListQuerySchema.parse({ limit: PAGE });
  let cursor: string | undefined;
  let sent = 0;
  do {
    const page = await runService((ctx) => jobs.listJobs(ctx, { ...query, cursor }), actor);
    for (const j of page.rows) {
      if (sent >= MAX_ROWS) return;
      sent += 1;
      yield j;
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return problem(401, "Sign in to export jobs");
  const actor = await resolveActor(session.user.id, session.session.activeOrganizationId);
  if (!actor) return problem(403, "You don't belong to an organization yet");
  if (!can(actor, "jobs.update")) return problem(403, "Only the office team can export jobs");

  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids");
  let source: AsyncGenerator<JobView>;
  if (idsParam) {
    const ids = z.array(z.uuid()).min(1).max(100).safeParse(idsParam.split(",").filter(Boolean));
    if (!ids.success) return problem(400, "`ids` must be 1–100 job IDs");
    source = selected(actor, ids.data);
  } else {
    source = filtered(actor, url);
  }

  const tz = actor.organization.timezone;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // A byte order mark so spreadsheet apps read UTF-8 names correctly.
      controller.enqueue(encoder.encode(BOM + csvRow(HEADER)));
    },
    async pull(controller) {
      try {
        const next = await source.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(row(next.value, tz)));
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
      "Content-Disposition": `attachment; filename="jobs-${actor.organization.slug}-${today}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
