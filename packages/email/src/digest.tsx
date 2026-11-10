import { Button, Column, Link, Row, Section, Text } from "@react-email/components";
import { Layout, button, paragraph } from "./layout";
import { INTL_LOCALE, type Dictionary, type EmailLocale } from "./i18n";

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
  /** The recipient's language (SET-05); English when left out. */
  locale?: EmailLocale;
}

const COPY: Dictionary<{
  subject: (org: string, day: string) => string;
  preview: (completed: number, overdue: number, pending: number) => string;
  title: (day: string) => string;
  footer: (org: string) => string;
  hi: (name: string, org: string) => string;
  rows: [string, string, string, string, string, string];
  of: (met: number, measured: number) => string;
  overdueTitle: string;
  noOverdue: string;
  more: (n: number) => string;
  seeOverdue: string;
  approvalsTitle: string;
  noApprovals: string;
  waiting: (n: number) => string;
  review: string;
  cta: string;
  preferences: string;
}> = {
  en: {
    subject: (org, day) => `${org}: your summary for ${day}`,
    preview: (c, o, p) => `${c} jobs completed, ${o} overdue, ${p} waiting for approval`,
    title: (day) => `Your summary for ${day}`,
    footer: (org) => `You get this summary because of your notification settings in ${org} on FieldOps.`,
    hi: (name, org) => `Hi ${name}, here is how ${org} did yesterday.`,
    rows: [
      "Jobs created",
      "Jobs completed",
      "SLA compliance",
      "First-visit completion",
      "Revenue invoiced",
      "Revenue collected",
    ],
    of: (met, measured) => ` (${met} of ${measured})`,
    overdueTitle: "Overdue jobs",
    noOverdue: "No open job has missed its SLA.",
    more: (n) => `And ${n} more. `,
    seeOverdue: "See every overdue job",
    approvalsTitle: "Pending approvals",
    noApprovals: "No parts or expenses are waiting for a decision.",
    waiting: (n) => `${n} ${n === 1 ? "request is" : "requests are"} waiting for a decision. `,
    review: "Review them",
    cta: "Open the dashboard",
    preferences: "Change which emails you get",
  },
  id: {
    subject: (org, day) => `${org}: ringkasan Anda untuk ${day}`,
    preview: (c, o, p) => `${c} pekerjaan selesai, ${o} terlambat, ${p} menunggu persetujuan`,
    title: (day) => `Ringkasan Anda untuk ${day}`,
    footer: (org) => `Anda menerima ringkasan ini karena pengaturan notifikasi Anda di ${org} pada FieldOps.`,
    hi: (name, org) => `Halo ${name}, berikut kinerja ${org} kemarin.`,
    rows: [
      "Pekerjaan dibuat",
      "Pekerjaan selesai",
      "Kepatuhan SLA",
      "Selesai di kunjungan pertama",
      "Pendapatan ditagihkan",
      "Pendapatan diterima",
    ],
    of: (met, measured) => ` (${met} dari ${measured})`,
    overdueTitle: "Pekerjaan terlambat",
    noOverdue: "Tidak ada pekerjaan aktif yang melewati SLA.",
    more: (n) => `Dan ${n} lainnya. `,
    seeOverdue: "Lihat semua pekerjaan terlambat",
    approvalsTitle: "Persetujuan tertunda",
    noApprovals: "Tidak ada suku cadang atau biaya yang menunggu keputusan.",
    waiting: (n) => `${n} pengajuan menunggu keputusan. `,
    review: "Tinjau",
    cta: "Buka dasbor",
    preferences: "Atur email yang Anda terima",
  },
};

const muted = { ...paragraph, fontSize: 13, color: "#64748b" } as const;
const cell = { padding: "10px 12px", borderBottom: "1px solid #e3e8ef", verticalAlign: "top" } as const;
const label = { margin: 0, fontSize: 13, color: "#475569" } as const;
const value = { margin: 0, fontSize: 18, fontWeight: 700, color: "#0b1220", textAlign: "right" } as const;
const sectionTitle = { fontSize: 16, fontWeight: 700, color: "#0b1220", margin: "28px 0 8px" } as const;

/** "Thursday, November 12" ("Kamis, 12 November") for a local date. */
export function digestDay(date: string, locale: EmailLocale = "en"): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

export function digestSubject(p: Pick<DailyDigestProps, "organizationName" | "date" | "locale">): string {
  const locale = p.locale ?? "en";
  return COPY[locale].subject(p.organizationName, digestDay(p.date, locale));
}

export function DailyDigestEmail(p: DailyDigestProps) {
  const f = p.figures;
  const locale = p.locale ?? "en";
  const c = COPY[locale];
  const rows: [string, string][] = [
    [c.rows[0], String(f.jobsCreated)],
    [c.rows[1], String(f.jobsCompleted)],
    [c.rows[2], `${percent(f.slaMet, f.slaMeasured)}${f.slaMeasured ? c.of(f.slaMet, f.slaMeasured) : ""}`],
    [c.rows[3], percent(f.firstVisit, f.jobsCompleted)],
    [c.rows[4], f.invoiced],
    [c.rows[5], f.collected],
  ];
  const more = p.overdueCount - p.overdue.length;
  return (
    <Layout
      locale={locale}
      preview={c.preview(f.jobsCompleted, p.overdueCount, p.pendingApprovals)}
      title={c.title(digestDay(p.date, locale))}
      footer={c.footer(p.organizationName)}
    >
      <Text style={paragraph}>{c.hi(p.recipientName, p.organizationName)}</Text>

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

      <Text style={sectionTitle}>{c.overdueTitle}</Text>
      {p.overdueCount === 0 ? (
        <Text style={muted}>{c.noOverdue}</Text>
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
            {more > 0 ? c.more(more) : ""}
            <Link href={p.urls.overdue}>{c.seeOverdue}</Link>
          </Text>
        </>
      )}

      <Text style={sectionTitle}>{c.approvalsTitle}</Text>
      <Text style={paragraph}>
        {p.pendingApprovals === 0 ? c.noApprovals : c.waiting(p.pendingApprovals)}
        {p.pendingApprovals > 0 ? <Link href={p.urls.approvals}>{c.review}</Link> : null}
      </Text>

      <Button href={p.urls.dashboard} style={button}>
        {c.cta}
      </Button>
      <Text style={muted}>
        <Link href={p.urls.preferences}>{c.preferences}</Link>
      </Text>
    </Layout>
  );
}
