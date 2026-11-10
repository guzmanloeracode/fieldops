import { Button, Column, Link, Row, Section, Text } from "@react-email/components";
import { Layout, button, paragraph } from "./layout";

// The owner's daily digest (NOT-04): yesterday's figures, overdue jobs and pending approvals, with links into
// the app. Tables only, so it renders the same in every mail client.

export interface DailyDigestProps {
  recipientName: string;
  organizationName: string;
  /** The local date summarized ("YYYY-MM-DD"). */
  date: string;
  figures: {
    jobsCreated: number;
    jobsCompleted: number;
    /** Completed jobs that met their resolution target, of those measured. */
    slaMet: number;
    slaMeasured: number;
    /** Completed jobs that needed no other visit. */
    firstVisit: number;
    /** Already formatted in the organization's currency, e.g. "$1,250.00". */
    invoiced: string;
    collected: string;
  };
  overdue: { label: string; title: string; customerName: string; url: string }[];
  overdueCount: number;
  pendingApprovals: number;
  urls: { dashboard: string; overdue: string; approvals: string; preferences: string };
}

const muted = { ...paragraph, fontSize: 13, color: "#64748b" } as const;
const cell = { padding: "10px 12px", borderBottom: "1px solid #e3e8ef", verticalAlign: "top" } as const;
const label = { margin: 0, fontSize: 13, color: "#475569" } as const;
const value = { margin: 0, fontSize: 18, fontWeight: 700, color: "#0b1220", textAlign: "right" } as const;
const sectionTitle = { fontSize: 16, fontWeight: 700, color: "#0b1220", margin: "28px 0 8px" } as const;

/** "Thursday, November 12" for a local date. */
export function digestDay(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

export function digestSubject(p: Pick<DailyDigestProps, "organizationName" | "date">): string {
  return `${p.organizationName}: your summary for ${digestDay(p.date)}`;
}

export function DailyDigestEmail(p: DailyDigestProps) {
  const f = p.figures;
  const rows: [string, string][] = [
    ["Jobs created", String(f.jobsCreated)],
    ["Jobs completed", String(f.jobsCompleted)],
    [
      "SLA compliance",
      `${percent(f.slaMet, f.slaMeasured)}${f.slaMeasured ? ` (${f.slaMet} of ${f.slaMeasured})` : ""}`,
    ],
    ["First-visit completion", percent(f.firstVisit, f.jobsCompleted)],
    ["Revenue invoiced", f.invoiced],
    ["Revenue collected", f.collected],
  ];
  const more = p.overdueCount - p.overdue.length;
  return (
    <Layout
      preview={`${f.jobsCompleted} jobs completed, ${p.overdueCount} overdue, ${p.pendingApprovals} waiting for approval`}
      title={`Your summary for ${digestDay(p.date)}`}
      footer={`You get this summary because of your notification settings in ${p.organizationName} on FieldOps.`}
    >
      <Text style={paragraph}>
        Hi {p.recipientName}, here is how {p.organizationName} did yesterday.
      </Text>

      <Section style={{ border: "1px solid #e3e8ef", borderRadius: 8 }}>
        {rows.map(([name, v]) => (
          <Row key={name}>
            <Column style={cell}>
              <Text style={label}>{name}</Text>
            </Column>
            <Column style={cell}>
              <Text style={value}>{v}</Text>
            </Column>
          </Row>
        ))}
      </Section>

      <Text style={sectionTitle}>Overdue jobs</Text>
      {p.overdueCount === 0 ? (
        <Text style={muted}>No open job has missed its SLA.</Text>
      ) : (
        <>
          <Section style={{ border: "1px solid #e3e8ef", borderRadius: 8 }}>
            {p.overdue.map((j) => (
              <Row key={j.label}>
                <Column style={{ ...cell, width: 110 }}>
                  <Link href={j.url} style={{ fontSize: 13, fontFamily: "monospace" }}>
                    {j.label}
                  </Link>
                </Column>
                <Column style={cell}>
                  <Text style={{ margin: 0, fontSize: 14, color: "#0b1220" }}>{j.title}</Text>
                  <Text style={{ ...label, fontSize: 12 }}>{j.customerName}</Text>
                </Column>
              </Row>
            ))}
          </Section>
          <Text style={muted}>
            {more > 0 ? `And ${more} more. ` : ""}
            <Link href={p.urls.overdue}>See every overdue job</Link>
          </Text>
        </>
      )}

      <Text style={sectionTitle}>Pending approvals</Text>
      <Text style={paragraph}>
        {p.pendingApprovals === 0
          ? "No parts or expenses are waiting for a decision."
          : `${p.pendingApprovals} ${p.pendingApprovals === 1 ? "request is" : "requests are"} waiting for a decision. `}
        {p.pendingApprovals > 0 ? <Link href={p.urls.approvals}>Review them</Link> : null}
      </Text>

      <Button href={p.urls.dashboard} style={button}>
        Open the dashboard
      </Button>
      <Text style={muted}>
        <Link href={p.urls.preferences}>Change which emails you get</Link>
      </Text>
    </Layout>
  );
}
