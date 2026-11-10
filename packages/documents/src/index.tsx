import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { InvoiceDocument, QuoteDocument, ServiceReportDocument } from "./types";

export * from "./types";

// Branded PDFs for quotes, invoices and service reports (FIN-04). This first version is a plain layout so the
// billing pages can link real files; the documents slice replaces it with the branded templates.

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
  title: { fontSize: 18, marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
});

function Plain({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <Document title={title}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{title}</Text>
        {rows.map(([k, v], i) => (
          <View key={i} style={styles.row}>
            <Text>{k}</Text>
            <Text>{v}</Text>
          </View>
        ))}
      </Page>
    </Document>
  );
}

const money = (minor: number) => (minor / 100).toFixed(2);

async function toBytes(el: React.ReactElement<React.ComponentProps<typeof Document>>): Promise<Uint8Array> {
  return new Uint8Array(await renderToBuffer(el));
}

export function renderQuotePdf(doc: QuoteDocument): Promise<Uint8Array> {
  return toBytes(
    <Plain
      title={`${doc.brand.name} · ${doc.number}`}
      rows={[
        ...doc.lines.map((l): [string, string] => [l.description, money(l.netMinor)]),
        ["Total", `${doc.currency} ${money(doc.totals.totalMinor)}`],
      ]}
    />,
  );
}

export function renderInvoicePdf(doc: InvoiceDocument): Promise<Uint8Array> {
  return toBytes(
    <Plain
      title={`${doc.brand.name} · ${doc.number}`}
      rows={[
        ...doc.lines.map((l): [string, string] => [l.description, money(l.netMinor)]),
        ["Total", `${doc.currency} ${money(doc.totals.totalMinor)}`],
        ["Balance", `${doc.currency} ${money(doc.totals.balanceMinor)}`],
      ]}
    />,
  );
}

export function renderServiceReportPdf(doc: ServiceReportDocument): Promise<Uint8Array> {
  return toBytes(
    <Plain
      title={`${doc.brand.name} · ${doc.jobNumber}`}
      rows={[
        ["Work performed", doc.workPerformed],
        ["Completed", doc.completedOn],
      ]}
    />,
  );
}
