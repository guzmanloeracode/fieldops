import { Button, Link, Text } from "@react-email/components";
import { Layout, button, paragraph } from "./layout";
import type { Dictionary, EmailLocale } from "./i18n";

const SIGN_IN: Dictionary<{
  subject: (org: string) => string;
  title: (org: string) => string;
  footer: (org: string) => string;
  hi: (name: string) => string;
  body: (org: string, minutes: number) => string;
  cta: string;
  paste: string;
}> = {
  en: {
    subject: (org) => `Your sign-in link for ${org}`,
    title: (org) => `Sign in to ${org}`,
    footer: (org) =>
      `You asked to sign in to the ${org} customer portal. If it wasn't you, you can ignore this email.`,
    hi: (name) => `Hi ${name},`,
    body: (org, minutes) =>
      `Use this link to request service and follow your jobs with ${org}. It works once, for ${minutes} minutes.`,
    cta: "Open the customer portal",
    paste: "Or paste this link into your browser:",
  },
  id: {
    subject: (org) => `Tautan masuk Anda untuk ${org}`,
    title: (org) => `Masuk ke ${org}`,
    footer: (org) =>
      `Anda meminta masuk ke portal pelanggan ${org}. Jika itu bukan Anda, abaikan saja email ini.`,
    hi: (name) => `Halo ${name},`,
    body: (org, minutes) =>
      `Gunakan tautan ini untuk meminta layanan dan memantau pekerjaan Anda bersama ${org}. Tautan hanya bisa dipakai sekali, selama ${minutes} menit.`,
    cta: "Buka portal pelanggan",
    paste: "Atau tempel tautan ini di browser Anda:",
  },
};

export const portalSignInSubject = (organizationName: string, locale: EmailLocale) =>
  SIGN_IN[locale].subject(organizationName);

/** One-time sign-in link to a business's customer portal (POR-01), in the customer's language. */
export function PortalSignIn({
  name,
  organizationName,
  url,
  minutes,
  locale = "en",
}: {
  name: string;
  organizationName: string;
  url: string;
  minutes: number;
  locale?: EmailLocale;
}) {
  const c = SIGN_IN[locale];
  return (
    <Layout
      locale={locale}
      preview={c.subject(organizationName)}
      title={c.title(organizationName)}
      footer={c.footer(organizationName)}
    >
      <Text style={paragraph}>{c.hi(name)}</Text>
      <Text style={paragraph}>{c.body(organizationName, minutes)}</Text>
      <Button href={url} style={button}>
        {c.cta}
      </Button>
      <Text style={{ ...paragraph, fontSize: 13, color: "#64748b" }}>
        {c.paste} <Link href={url}>{url}</Link>
      </Text>
    </Layout>
  );
}
