import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import { paperFor } from "./billing";
import {
  Footer,
  Heading,
  Letterhead,
  Parties,
  PartyBlock,
  Table,
  TextBlock,
  TopBar,
  imageSource,
} from "./components";
import { documentLabels, formatDate, formatQuantity } from "./labels";
import { MUTED, RULE, accentFor, styles } from "./theme";
import type { ReportPhoto, ServiceReportDocument } from "./types";

// The customer-facing service report (AI-03, FIN-04).

/** At most this many photos are printed; before and after photos come first. */
export const MAX_REPORT_PHOTOS = 6;

/** The photos to print: readable images only, before ones, then after ones, then the rest. */
export function reportPhotos(
  photos: ReportPhoto[],
): (ReportPhoto & { src: NonNullable<ReturnType<typeof imageSource>> })[] {
  const rank = (p: ReportPhoto) => (p.tag === "before" ? 0 : p.tag === "after" ? 1 : 2);
  return photos
    .map((p, i) => ({ p, i, src: imageSource(p.image) }))
    .filter((x) => x.src !== null)
    .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
    .slice(0, MAX_REPORT_PHOTOS)
    .map((x) => ({ ...x.p, src: x.src! }));
}

export function ServiceReportPdf({ doc }: { doc: ServiceReportDocument }) {
  const l = documentLabels(doc.locale);
  const accent = accentFor(doc.brand.brandColor);
  const photos = reportPhotos(doc.photos);
  const photoRows = Array.from({ length: Math.ceil(photos.length / 2) }, (_, i) =>
    photos.slice(i * 2, i * 2 + 2),
  );
  const signature = doc.signature ? imageSource(doc.signature.image) : null;
  return (
    <Document title={`${l.serviceReport} ${doc.jobNumber}`} author={doc.brand.name} language={doc.locale}>
      <Page size={paperFor(doc.currency)} style={styles.page}>
        <TopBar accent={accent} />
        <Letterhead
          brand={doc.brand}
          accent={accent}
          title={l.serviceReport}
          meta={[
            [l.job, doc.jobNumber],
            [l.completed, formatDate(doc.completedOn, doc.locale)],
          ]}
        />
        <Parties>
          <PartyBlock label={l.customer} party={doc.customer} />
          <PartyBlock label={l.serviceSite} party={doc.site} />
          {doc.technicians.length ? (
            <PartyBlock label={l.technicians} party={{ name: doc.technicians.join(", "), lines: [] }} />
          ) : null}
        </Parties>
        <Text style={{ fontSize: 12, lineHeight: 1.3, fontWeight: 700, marginTop: 14 }}>{doc.title}</Text>

        <TextBlock title={l.workPerformed} text={doc.workPerformed} color={accent.text} />
        {doc.findings ? <TextBlock title={l.findings} text={doc.findings} color={accent.text} /> : null}
        {doc.recommendations ? (
          <TextBlock title={l.recommendations} text={doc.recommendations} color={accent.text} />
        ) : null}
        {doc.nextServiceDate ? (
          <View
            wrap={false}
            style={{
              marginTop: 14,
              flexDirection: "row",
              alignItems: "center",
              padding: 10,
              borderRadius: 6,
              backgroundColor: accent.tint,
              borderLeftWidth: 3,
              borderLeftColor: accent.fill,
            }}
          >
            <View style={{ flexGrow: 1 }}>
              <Text style={[styles.bold, { color: accent.text }]}>{l.nextService}</Text>
              <Text style={[styles.small, styles.muted]}>{l.nextServiceHint}</Text>
            </View>
            <Text style={{ fontSize: 12, lineHeight: 1.2, fontWeight: 700 }}>
              {formatDate(doc.nextServiceDate, doc.locale)}
            </Text>
          </View>
        ) : null}

        {doc.checklist.length ? (
          <View style={styles.section}>
            <Heading color={accent.text}>{l.checklist}</Heading>
            <Table
              accent={accent}
              columns={[
                { label: l.item, width: "64%" },
                { label: l.result, width: "36%", align: "right" },
              ]}
              rows={doc.checklist.map((c) => [c.label, c.value ?? (c.done ? `✓ ${l.done}` : l.notDone)])}
            />
          </View>
        ) : null}

        {doc.partsUsed.length ? (
          <View style={styles.section}>
            <Heading color={accent.text}>{l.partsUsed}</Heading>
            <Table
              accent={accent}
              columns={[
                { label: l.part, width: "76%" },
                { label: l.quantity, width: "24%", align: "right" },
              ]}
              rows={doc.partsUsed.map((p) => [p.description, formatQuantity(p.quantity, p.unit, doc.locale)])}
            />
          </View>
        ) : null}

        {photoRows.map((row, r) => (
          // The heading travels with the first row, so it never sits alone at the bottom of a page.
          <View key={r} wrap={false} style={r === 0 ? styles.section : undefined}>
            {r === 0 ? <Heading color={accent.text}>{l.photos}</Heading> : null}
            <View style={{ flexDirection: "row", marginHorizontal: -5 }}>
              {row.map((p, i) => (
                <View key={i} style={{ width: "50%", padding: 5 }}>
                  <View style={{ borderWidth: 0.5, borderColor: RULE, borderRadius: 4, padding: 4 }}>
                    <Image src={p.src} style={{ height: 170, objectFit: "contain" }} />
                    {p.tag || p.caption ? (
                      <Text style={[styles.small, { marginTop: 4, color: MUTED }]}>
                        {p.tag ? (
                          <Text style={[styles.bold, { color: accent.text }]}>
                            {p.tag === "before" ? l.before : l.after}
                            {p.caption ? " · " : ""}
                          </Text>
                        ) : null}
                        {p.caption ?? ""}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}

        {signature ? (
          <View wrap={false} style={[styles.section, { width: 220 }]}>
            <Heading color={accent.text}>{l.signature}</Heading>
            <Image
              src={signature}
              style={{ height: 70, objectFit: "contain", objectPosition: "left", marginBottom: 2 }}
            />
            <View style={{ borderTopWidth: 0.75, borderTopColor: MUTED, paddingTop: 3 }}>
              <Text style={[styles.small, styles.muted]}>
                {doc.signature?.name ? l.signedBy(doc.signature.name) : l.signature}
              </Text>
            </View>
          </View>
        ) : null}

        <Footer left={`${doc.brand.name} · ${doc.jobNumber}`} labels={l} />
      </Page>
    </Document>
  );
}
