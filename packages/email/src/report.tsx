import { Button, Link, Text } from "@react-email/components";
import { Layout, button, paragraph } from "./layout";

// "Job completed" email to the customer with the service report (§8.7, AI-03), in the customer's language. The
// templates render outside the web app, so the words live here rather than in its message files.

export type ReportEmailLocale = "en" | "id";

export interface JobCompletedEmailProps {
  locale: ReportEmailLocale;
  contactName: string | null;
  organizationName: string;
  jobNumber: string;
  jobTitle: string;
  /** YYYY-MM-DD */
  completedOn: string;
  url: string;
  /** YYYY-MM-DD: the last day the link works. */
  expiresOn: string;
}

const COPY = {
  en: {
    subject: (p: JobCompletedEmailProps) =>
      `Your service report for ${p.jobNumber} from ${p.organizationName}`,
    title: "Your job is complete",
    hello: (name: string | null) => (name ? `Hi ${name},` : "Hello,"),
    body: (p: JobCompletedEmailProps, date: string) =>
      `${p.organizationName} completed ${p.jobNumber} (${p.jobTitle}) on ${date}. The service report describes the work, what the technician found and what we recommend next.`,
    button: "Download the service report (PDF)",
    expires: (date: string) => `The link works until ${date}. After that, ask us for a copy.`,
    paste: "Or paste this link into your browser:",
    footer: (org: string) => `You received this email because ${org} completed work for you.`,
  },
  id: {
    subject: (p: JobCompletedEmailProps) => `Laporan servis ${p.jobNumber} dari ${p.organizationName}`,
    title: "Pekerjaan Anda sudah selesai",
    hello: (name: string | null) => (name ? `Halo ${name},` : "Halo,"),
    body: (p: JobCompletedEmailProps, date: string) =>
      `${p.organizationName} telah menyelesaikan ${p.jobNumber} (${p.jobTitle}) pada ${date}. Laporan servis menjelaskan pekerjaan yang dilakukan, temuan teknisi, dan rekomendasi kami.`,
    button: "Unduh laporan servis (PDF)",
    expires: (date: string) => `Tautan berlaku sampai ${date}. Setelah itu, minta salinannya kepada kami.`,
    paste: "Atau salin tautan ini ke browser Anda:",
    footer: (org: string) =>
      `Anda menerima email ini karena ${org} telah menyelesaikan pekerjaan untuk Anda.`,
  },
} satisfies Record<ReportEmailLocale, unknown>;

const copyFor = (locale: ReportEmailLocale) => COPY[locale] ?? COPY.en;

/** "2026-11-10" → "November 10, 2026" or "10 November 2026". */
export function formatEmailDate(isoDate: string, locale: ReportEmailLocale): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function jobCompletedSubject(props: JobCompletedEmailProps): string {
  return copyFor(props.locale).subject(props);
}

export function JobCompletedEmail(props: JobCompletedEmailProps) {
  const c = copyFor(props.locale);
  return (
    <Layout
      lang={props.locale}
      preview={c.subject(props)}
      title={c.title}
      footer={c.footer(props.organizationName)}
    >
      <Text style={paragraph}>{c.hello(props.contactName)}</Text>
      <Text style={paragraph}>{c.body(props, formatEmailDate(props.completedOn, props.locale))}</Text>
      <Button href={props.url} style={button}>
        {c.button}
      </Button>
      <Text style={{ ...paragraph, fontSize: 13, color: "#64748b" }}>
        {c.expires(formatEmailDate(props.expiresOn, props.locale))}
      </Text>
      <Text style={{ ...paragraph, fontSize: 13, color: "#64748b" }}>
        {c.paste} <Link href={props.url}>{props.url}</Link>
      </Text>
    </Layout>
  );
}
