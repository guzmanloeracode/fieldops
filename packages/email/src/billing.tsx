import { Button, Link, Section, Text } from "@react-email/components";
import { Layout, button, paragraph } from "./layout";

// Billing emails to customers (FIN-02, FIN-03, FIN-05, FIN-06): a quote or invoice was sent, a payment arrived, an
// invoice is overdue. They go to the customer's contact in the customer's language (English or Bahasa Indonesia),
// with a link to the document in the customer portal. Amounts and dates arrive already formatted.

export type BillingLocale = "en" | "id";
export type PaymentMethodName = "card" | "bank_transfer" | "cash" | "other";

interface Base {
  contactName: string;
  organizationName: string;
  locale: BillingLocale;
  /** Absolute link to the document in the customer portal. */
  url: string;
}

export type BillingEmailProps =
  | (Base & { kind: "quote_sent"; number: string; title: string; total: string; validUntil: string | null })
  | (Base & {
      kind: "invoice_sent";
      number: string;
      total: string;
      balance: string;
      dueDate: string | null;
      paymentInstructions: string | null;
    })
  | (Base & {
      kind: "payment_receipt";
      number: string;
      amount: string;
      balance: string;
      paidAt: string;
      method: PaymentMethodName;
      paidInFull: boolean;
    })
  | (Base & {
      kind: "invoice_reminder";
      number: string;
      balance: string;
      dueDate: string;
      daysOverdue: number;
      paymentInstructions: string | null;
    });

const METHOD: Record<BillingLocale, Record<PaymentMethodName, string>> = {
  en: { card: "by card", bank_transfer: "by bank transfer", cash: "in cash", other: "" },
  id: { card: "dengan kartu", bank_transfer: "melalui transfer bank", cash: "secara tunai", other: "" },
};

interface Copy {
  subject: string;
  heading: string;
  lines: string[];
  instructions: string | null;
  cta: string;
}

/** Subject, heading, body and button text of a billing email in the customer's language. */
export function billingCopy(p: BillingEmailProps): Copy {
  const org = p.organizationName;
  const id = p.locale === "id";
  switch (p.kind) {
    case "quote_sent":
      return {
        subject: id ? `Penawaran ${p.number} dari ${org}` : `Quote ${p.number} from ${org}`,
        heading: id ? `Penawaran dari ${org}` : `Your quote from ${org}`,
        lines: [
          id
            ? `${org} mengirimkan penawaran untuk ${p.title}, sebesar ${p.total}.`
            : `${org} sent you a quote for ${p.title}: ${p.total}.`,
          ...(p.validUntil
            ? [id ? `Penawaran berlaku sampai ${p.validUntil}.` : `The quote is valid until ${p.validUntil}.`]
            : []),
        ],
        instructions: null,
        cta: id ? "Lihat dan setujui penawaran" : "View and approve the quote",
      };
    case "invoice_sent":
      return {
        subject: id ? `Faktur ${p.number} dari ${org}` : `Invoice ${p.number} from ${org}`,
        heading: id ? `Faktur dari ${org}` : `Your invoice from ${org}`,
        lines: [
          id
            ? `Faktur ${p.number} sebesar ${p.total}${p.dueDate ? ` jatuh tempo pada ${p.dueDate}` : ""}.`
            : `Invoice ${p.number} for ${p.total}${p.dueDate ? ` is due on ${p.dueDate}` : ""}.`,
          ...(p.balance !== p.total
            ? [id ? `Sisa tagihan: ${p.balance}.` : `Balance due: ${p.balance}.`]
            : []),
        ],
        instructions: p.paymentInstructions,
        cta: id ? "Lihat faktur" : "View the invoice",
      };
    case "payment_receipt": {
      const how = METHOD[p.locale][p.method];
      return {
        subject: id
          ? `Pembayaran diterima untuk faktur ${p.number}`
          : `Payment received for invoice ${p.number}`,
        heading: id ? "Terima kasih atas pembayaran Anda" : "Thank you for your payment",
        lines: [
          id
            ? `${org} telah menerima ${p.amount}${how ? ` ${how}` : ""} pada ${p.paidAt} untuk faktur ${p.number}.`
            : `${org} received ${p.amount}${how ? ` ${how}` : ""} on ${p.paidAt} for invoice ${p.number}.`,
          p.paidInFull
            ? id
              ? "Faktur sudah lunas."
              : "The invoice is paid in full."
            : id
              ? `Sisa tagihan: ${p.balance}.`
              : `Balance still due: ${p.balance}.`,
        ],
        instructions: null,
        cta: id ? "Lihat faktur" : "View the invoice",
      };
    }
    case "invoice_reminder":
      return {
        subject: id
          ? `Pengingat: faktur ${p.number} lewat jatuh tempo ${p.daysOverdue} hari`
          : `Reminder: invoice ${p.number} is ${p.daysOverdue} days overdue`,
        heading: id ? "Pengingat pembayaran" : "A friendly payment reminder",
        lines: [
          id
            ? `Faktur ${p.number} jatuh tempo pada ${p.dueDate}. Sisa tagihan ${p.balance} belum kami terima.`
            : `Invoice ${p.number} was due on ${p.dueDate}, and a balance of ${p.balance} is still open.`,
          id
            ? "Abaikan email ini jika Anda sudah membayar."
            : "If you've already paid, thank you, and please ignore this email.",
        ],
        instructions: p.paymentInstructions,
        cta: id ? "Lihat faktur" : "View the invoice",
      };
  }
}

export function BillingEmail(props: BillingEmailProps) {
  const copy = billingCopy(props);
  const id = props.locale === "id";
  return (
    <Layout
      preview={copy.lines[0]!}
      title={copy.heading}
      footer={
        id
          ? `Email ini dikirim oleh ${props.organizationName} melalui FieldOps.`
          : `You received this email from ${props.organizationName} through FieldOps.`
      }
    >
      <Text style={paragraph}>
        {id ? "Halo" : "Hi"} {props.contactName},
      </Text>
      {copy.lines.map((line) => (
        <Text key={line} style={paragraph}>
          {line}
        </Text>
      ))}
      {copy.instructions ? (
        <Section
          style={{ backgroundColor: "#f1f5f9", borderRadius: 8, padding: "4px 16px", margin: "8px 0 16px" }}
        >
          <Text style={{ ...paragraph, fontWeight: 600, marginBottom: 0 }}>
            {id ? "Cara pembayaran" : "How to pay"}
          </Text>
          <Text style={{ ...paragraph, marginTop: 4, whiteSpace: "pre-line" }}>{copy.instructions}</Text>
        </Section>
      ) : null}
      <Button href={props.url} style={button}>
        {copy.cta}
      </Button>
      <Text style={{ ...paragraph, fontSize: 13, color: "#64748b" }}>
        {id ? "Atau buka tautan ini di browser: " : "Or paste this link into your browser: "}
        <Link href={props.url}>{props.url}</Link>
      </Text>
    </Layout>
  );
}
