import { Button, Link, Text } from "@react-email/components";
import { Layout, button, paragraph } from "./layout";

// One template for every notification event (NOT-02). The copy is built from the event and its payload; the
// in-app text uses the same facts through next-intl.

export type NotificationEmailEvent =
  | "job_assigned"
  | "job_rescheduled"
  | "portal_request"
  | "sla_at_risk"
  | "sla_breached"
  | "expense_requested"
  | "expense_decided";

export interface NotificationEmailProps {
  event: NotificationEmailEvent;
  payload: {
    job_number?: number;
    job_title?: string;
    customer_name?: string;
    actor_name?: string;
    scheduled_start?: string;
    item?: string;
    decision?: "approved" | "rejected";
    target?: "response" | "resolution";
    due_at?: string;
  };
  recipientName: string;
  organizationName: string;
  /** Absolute link to the record in the app. */
  url: string;
  /** Absolute link to the recipient's notification settings. */
  preferencesUrl: string;
  /** The organization's time zone, for dates in the text. */
  timeZone: string;
}

const jobLabel = (n?: number) => (n === undefined ? "a job" : `JOB-${String(n).padStart(6, "0")}`);

function when(iso: string | undefined, timeZone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(d);
}

/** Subject, heading, body and button text for an event. */
export function notificationCopy(p: Pick<NotificationEmailProps, "event" | "payload" | "timeZone">) {
  const { payload: x, timeZone } = p;
  const job = jobLabel(x.job_number);
  const title = x.job_title ?? job;
  const customer = x.customer_name ? ` for ${x.customer_name}` : "";
  const start = when(x.scheduled_start, timeZone);
  const due = when(x.due_at, timeZone);
  const target =
    x.target === "response" ? "response (scheduled with a technician)" : "resolution (completed)";
  switch (p.event) {
    case "job_assigned":
      return {
        subject: `New job ${job}: ${title}`,
        heading: "You have a new job",
        body: `${x.actor_name ?? "A dispatcher"} assigned you to ${title}${customer}${start ? ` on ${start}` : ""}.`,
        cta: "Open the job",
      };
    case "job_rescheduled":
      return {
        subject: `Rescheduled ${job}: ${title}`,
        heading: "A visit was rescheduled",
        body: `${title}${customer} now starts ${start || "at a new time"}.`,
        cta: "See the new time",
      };
    case "portal_request":
      return {
        subject: `New service request ${job}: ${title}`,
        heading: "New request from the customer portal",
        body: `${x.customer_name ?? "A customer"} asked for service: ${title}. Review it and confirm the job.`,
        cta: "Review the request",
      };
    case "sla_at_risk":
      return {
        subject: `SLA at risk ${job}: ${title}`,
        heading: "A job is at risk of missing its SLA",
        body: `The ${target} target of ${title}${customer} is due ${due || "soon"}.`,
        cta: "Open the job",
      };
    case "sla_breached":
      return {
        subject: `SLA breached ${job}: ${title}`,
        heading: "A job missed its SLA",
        body: `${title}${customer} missed its ${target} target${due ? ` (due ${due})` : ""}.`,
        cta: "Open the job",
      };
    case "expense_requested":
      return {
        subject: `Approval needed: ${x.item ?? "a part"} on ${job}`,
        heading: "A part or expense needs approval",
        body: `${x.actor_name ?? "A technician"} requested ${x.item ?? "a part"} for ${title}.`,
        cta: "Review the request",
      };
    case "expense_decided":
      return {
        subject: `${x.decision === "rejected" ? "Rejected" : "Approved"}: ${x.item ?? "your request"} on ${job}`,
        heading: x.decision === "rejected" ? "Your request was rejected" : "Your request was approved",
        body: `${x.actor_name ?? "An approver"} ${x.decision ?? "decided"} ${x.item ?? "your request"} for ${title}.`,
        cta: "Open the job",
      };
  }
}

export function NotificationEmail(props: NotificationEmailProps) {
  const copy = notificationCopy(props);
  return (
    <Layout
      preview={copy.body}
      title={copy.heading}
      footer={`You get this email because of your notification settings in ${props.organizationName} on FieldOps.`}
    >
      <Text style={paragraph}>Hi {props.recipientName},</Text>
      <Text style={paragraph}>{copy.body}</Text>
      <Button href={props.url} style={button}>
        {copy.cta}
      </Button>
      <Text style={{ ...paragraph, fontSize: 13, color: "#64748b" }}>
        <Link href={props.preferencesUrl}>Change which emails you get</Link>
      </Text>
    </Layout>
  );
}
