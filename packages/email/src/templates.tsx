import { Button, Link, Text } from "@react-email/components";
import { Layout, button, paragraph } from "./layout";
import { ROLE_NAMES, type Dictionary, type EmailLocale } from "./i18n";

const VERIFY: Dictionary<{
  subject: string;
  preview: string;
  title: string;
  hi: (name: string) => string;
  body: string;
  cta: string;
  paste: string;
}> = {
  en: {
    subject: "Confirm your email for FieldOps",
    preview: "Confirm your email to start using FieldOps",
    title: "Confirm your email",
    hi: (name) => `Hi ${name},`,
    body: "Confirm your email address to finish creating your FieldOps account.",
    cta: "Confirm email",
    paste: "Or paste this link into your browser:",
  },
  id: {
    subject: "Konfirmasi email Anda untuk FieldOps",
    preview: "Konfirmasi email Anda untuk mulai memakai FieldOps",
    title: "Konfirmasi email Anda",
    hi: (name) => `Halo ${name},`,
    body: "Konfirmasi alamat email Anda untuk menyelesaikan pembuatan akun FieldOps.",
    cta: "Konfirmasi email",
    paste: "Atau tempel tautan ini di browser Anda:",
  },
};

export const verifyEmailSubject = (locale: EmailLocale) => VERIFY[locale].subject;

export function VerifyEmail({
  name,
  url,
  locale = "en",
}: {
  name: string;
  url: string;
  locale?: EmailLocale;
}) {
  const c = VERIFY[locale];
  return (
    <Layout locale={locale} preview={c.preview} title={c.title}>
      <Text style={paragraph}>{c.hi(name)}</Text>
      <Text style={paragraph}>{c.body}</Text>
      <Button href={url} style={button}>
        {c.cta}
      </Button>
      <Text style={{ ...paragraph, fontSize: 13, color: "#64748b" }}>
        {c.paste} <Link href={url}>{url}</Link>
      </Text>
    </Layout>
  );
}

const RESET: Dictionary<{
  subject: string;
  title: string;
  hi: (name: string) => string;
  body: string;
  cta: string;
  ignore: string;
}> = {
  en: {
    subject: "Reset your FieldOps password",
    title: "Reset your password",
    hi: (name) => `Hi ${name},`,
    body: "Someone asked to reset the password for your FieldOps account. The link works for one hour.",
    cta: "Choose a new password",
    ignore: "If you didn't ask for this, you can ignore this email.",
  },
  id: {
    subject: "Atur ulang kata sandi FieldOps Anda",
    title: "Atur ulang kata sandi Anda",
    hi: (name) => `Halo ${name},`,
    body: "Ada permintaan untuk mengatur ulang kata sandi akun FieldOps Anda. Tautan ini berlaku selama satu jam.",
    cta: "Buat kata sandi baru",
    ignore: "Jika Anda tidak memintanya, abaikan saja email ini.",
  },
};

export const resetPasswordSubject = (locale: EmailLocale) => RESET[locale].subject;

export function ResetPassword({
  name,
  url,
  locale = "en",
}: {
  name: string;
  url: string;
  locale?: EmailLocale;
}) {
  const c = RESET[locale];
  return (
    <Layout locale={locale} preview={c.subject} title={c.title}>
      <Text style={paragraph}>{c.hi(name)}</Text>
      <Text style={paragraph}>{c.body}</Text>
      <Button href={url} style={button}>
        {c.cta}
      </Button>
      <Text style={{ ...paragraph, fontSize: 13, color: "#64748b" }}>{c.ignore}</Text>
    </Layout>
  );
}

const INVITATION: Dictionary<{
  subject: (inviter: string, org: string) => string;
  title: (org: string) => string;
  /** The sentence around the organization and role, which are bold. */
  body: [string, string, string];
  cta: string;
  expires: string;
}> = {
  en: {
    subject: (inviter, org) => `${inviter} invited you to ${org} on FieldOps`,
    title: (org) => `Join ${org}`,
    body: [" invited you to join ", " on FieldOps as a ", "."],
    cta: "Accept invitation",
    expires: "The invitation expires in 7 days.",
  },
  id: {
    subject: (inviter, org) => `${inviter} mengundang Anda ke ${org} di FieldOps`,
    title: (org) => `Bergabung dengan ${org}`,
    body: [" mengundang Anda bergabung dengan ", " di FieldOps sebagai ", "."],
    cta: "Terima undangan",
    expires: "Undangan ini berlaku selama 7 hari.",
  },
};

export const invitationSubject = (
  p: { inviterName: string; organizationName: string },
  locale: EmailLocale,
) => INVITATION[locale].subject(p.inviterName, p.organizationName);

export function Invitation({
  inviterName,
  organizationName,
  role,
  url,
  locale = "en",
}: {
  inviterName: string;
  organizationName: string;
  role: string;
  url: string;
  locale?: EmailLocale;
}) {
  const c = INVITATION[locale];
  return (
    <Layout
      locale={locale}
      preview={c.subject(inviterName, organizationName)}
      title={c.title(organizationName)}
    >
      <Text style={paragraph}>
        {inviterName}
        {c.body[0]}
        <strong>{organizationName}</strong>
        {c.body[1]}
        <strong>{ROLE_NAMES[locale][role] ?? role}</strong>
        {c.body[2]}
      </Text>
      <Button href={url} style={button}>
        {c.cta}
      </Button>
      <Text style={{ ...paragraph, fontSize: 13, color: "#64748b" }}>{c.expires}</Text>
    </Layout>
  );
}
