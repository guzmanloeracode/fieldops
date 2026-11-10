import { Document, Page, Text } from "@react-pdf/renderer";
import {
  Footer,
  Letterhead,
  Parties,
  PartyBlock,
  Stamp,
  Table,
  TextBlock,
  TopBar,
  Totals,
  dateMeta,
  lineTable,
} from "./components";
import { documentLabels, statusMark } from "./labels";
import { DANGER, MUTED, SUCCESS, accentFor, styles } from "./theme";
import type { InvoiceDocument, QuoteDocument } from "./types";
import type { Currency } from "@fieldops/shared";

// Quote and invoice layouts (FIN-02, FIN-03, FIN-04).

/** US customers get Letter paper, everyone else A4. */
export const paperFor = (currency: Currency) => (currency === "USD" ? "LETTER" : "A4");

export function QuotePdf({ doc }: { doc: QuoteDocument }) {
  const l = documentLabels(doc.locale);
  const accent = accentFor(doc.brand.brandColor);
  const table = lineTable(doc.lines, doc.currency, doc.locale);
  return (
    <Document title={`${l.quote} ${doc.number}`} author={doc.brand.name} language={doc.locale}>
      <Page size={paperFor(doc.currency)} style={styles.page}>
        <TopBar accent={accent} />
        <Letterhead
          brand={doc.brand}
          accent={accent}
          title={l.quote}
          meta={[
            [l.number, doc.number],
            ...dateMeta(
              [
                [l.issued, doc.issuedOn],
                [l.validUntil, doc.validUntil],
              ],
              doc.locale,
            ),
          ]}
        />
        <Parties>
          <PartyBlock label={l.customer} party={doc.customer} />
          {doc.site ? <PartyBlock label={l.serviceSite} party={doc.site} /> : null}
        </Parties>
        <Text style={{ fontSize: 12, lineHeight: 1.3, fontWeight: 700, marginTop: 14 }}>{doc.title}</Text>
        <Table columns={table.columns} rows={table.rows} accent={accent} />
        <Totals totals={doc.totals} currency={doc.currency} labels={l} accent={accent} />
        {doc.notes ? <TextBlock title={l.notes} text={doc.notes} /> : null}
        <Text style={[styles.section, styles.muted]}>{l.thankYou}</Text>
        <Footer left={`${doc.brand.name} · ${doc.number}`} labels={l} />
      </Page>
    </Document>
  );
}

export function InvoicePdf({ doc }: { doc: InvoiceDocument }) {
  const l = documentLabels(doc.locale);
  const accent = accentFor(doc.brand.brandColor);
  const table = lineTable(doc.lines, doc.currency, doc.locale);
  const mark = statusMark(doc.status, doc.locale);
  return (
    <Document title={`${l.invoice} ${doc.number}`} author={doc.brand.name} language={doc.locale}>
      <Page size={paperFor(doc.currency)} style={styles.page}>
        <TopBar accent={accent} />
        <Letterhead
          brand={doc.brand}
          accent={accent}
          title={l.invoice}
          chip={
            doc.status === "draft" || doc.status === "overdue"
              ? { text: mark!, color: doc.status === "overdue" ? DANGER : MUTED }
              : null
          }
          meta={[
            [l.number, doc.number],
            ...(doc.jobNumber ? ([[l.job, doc.jobNumber]] as [string, string][]) : []),
            ...dateMeta(
              [
                [l.issueDate, doc.issueDate],
                [l.dueDate, doc.dueDate],
              ],
              doc.locale,
            ),
          ]}
        />
        <Parties>
          <PartyBlock label={l.billTo} party={doc.billTo} />
          {doc.site ? <PartyBlock label={l.serviceSite} party={doc.site} /> : null}
        </Parties>
        <Table columns={table.columns} rows={table.rows} accent={accent} />
        <Totals
          totals={doc.totals}
          currency={doc.currency}
          labels={l}
          accent={accent}
          paid={{ amountPaidMinor: doc.totals.amountPaidMinor, balanceMinor: doc.totals.balanceMinor }}
          stamp={
            doc.status === "paid" || doc.status === "void" ? (
              <Stamp text={mark!} color={doc.status === "paid" ? SUCCESS : DANGER} />
            ) : null
          }
        />
        {doc.paymentInstructions && doc.status !== "paid" && doc.status !== "void" ? (
          <TextBlock title={l.paymentInstructions} text={doc.paymentInstructions} color={accent.text} />
        ) : null}
        {doc.notes ? <TextBlock title={l.notes} text={doc.notes} /> : null}
        <Text style={[styles.section, styles.muted]}>{l.thankYou}</Text>
        <Footer left={`${doc.brand.name} · ${doc.number}`} labels={l} />
      </Page>
    </Document>
  );
}
