import { Image, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import {
  documentLabels,
  formatAmount,
  formatDate,
  formatQuantity,
  formatTaxRate,
  type DocumentLabels,
} from "./labels";
import { RULE, ZEBRA, monogram, styles, type Accent } from "./theme";
import type { DocumentBrand, DocumentLine, DocumentParty, DocumentTotals } from "./types";
import type { Currency, Locale } from "@fieldops/shared";

// Building blocks shared by the quote, invoice and service report layouts.

/** The PNG or JPEG format of image bytes, from their signature; null for anything else. */
export function imageFormat(bytes: Uint8Array): "png" | "jpg" | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  return null;
}

/** An image source react-pdf can draw, or null when the bytes aren't a PNG or JPEG (they're skipped). */
export function imageSource(bytes: Uint8Array | null): { data: Buffer; format: "png" | "jpg" } | null {
  if (!bytes) return null;
  const format = imageFormat(bytes);
  return format ? { data: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), format } : null;
}

/** The brand color bar at the top of every page. */
export function TopBar({ accent }: { accent: Accent }) {
  return <View fixed style={[styles.bar, { backgroundColor: accent.fill }]} />;
}

export function Letterhead({
  brand,
  accent,
  title,
  meta,
  chip,
}: {
  brand: DocumentBrand;
  accent: Accent;
  title: string;
  /** Number and dates on the right, as label and value. */
  meta: [string, string][];
  /** A status chip under the title, such as "Draft" or "Overdue". */
  chip?: { text: string; color: string } | null;
}) {
  const logo = imageSource(brand.logo);
  const contact = [brand.email, brand.phone].filter(Boolean).join("  ·  ");
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 20 }}>
      <View style={{ flexDirection: "row", maxWidth: "58%" }}>
        {logo ? (
          <Image src={logo} style={{ width: 48, height: 48, objectFit: "contain", marginRight: 10 }} />
        ) : (
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 8,
              backgroundColor: accent.fill,
              alignItems: "center",
              justifyContent: "center",
              marginRight: 10,
            }}
          >
            <Text style={{ color: accent.onFill, fontSize: 16, fontWeight: 700, lineHeight: 1 }}>
              {monogram(brand.name)}
            </Text>
          </View>
        )}
        <View style={{ flexShrink: 1 }}>
          <Text style={{ fontSize: 13, lineHeight: 1.25, fontWeight: 700, marginBottom: 2 }}>
            {brand.name}
          </Text>
          {brand.addressLines.map((line, i) => (
            <Text key={i} style={[styles.small, styles.muted]}>
              {line}
            </Text>
          ))}
          {contact ? <Text style={[styles.small, styles.muted]}>{contact}</Text> : null}
        </View>
      </View>
      <View style={{ alignItems: "flex-end", maxWidth: "40%" }}>
        <Text
          style={{
            fontSize: 20,
            lineHeight: 1.2,
            fontWeight: 700,
            color: accent.text,
            textTransform: "uppercase",
            letterSpacing: 1,
            marginBottom: 6,
          }}
        >
          {title}
        </Text>
        {chip ? (
          <Text
            style={{
              fontSize: 7.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: chip.color,
              borderWidth: 0.75,
              borderColor: chip.color,
              borderRadius: 3,
              paddingVertical: 2,
              paddingHorizontal: 6,
              marginBottom: 6,
            }}
          >
            {chip.text}
          </Text>
        ) : null}
        {meta.map(([label, value]) => (
          <View key={label} style={{ flexDirection: "row", marginBottom: 1 }}>
            <Text style={[styles.small, styles.muted, { marginRight: 6 }]}>{label}</Text>
            <Text style={[styles.small, styles.bold]}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function PartyBlock({ label, party }: { label: string; party: DocumentParty }) {
  return (
    <View style={{ flex: 1, paddingRight: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.bold}>{party.name}</Text>
      {party.lines.map((line, i) => (
        <Text key={i} style={styles.muted}>
          {line}
        </Text>
      ))}
    </View>
  );
}

export function Parties({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: "row",
        paddingVertical: 10,
        borderTopWidth: 0.5,
        borderBottomWidth: 0.5,
        borderColor: RULE,
      }}
    >
      {children}
    </View>
  );
}

/** A column of a table: its share of the width and alignment. */
export interface Column {
  label: string;
  width: string;
  align?: "left" | "right";
}

/**
 * A table whose header repeats on every page it spans (a fixed child of the table's view) and whose rows never
 * split across pages.
 */
export function Table({ columns, rows, accent }: { columns: Column[]; rows: string[][]; accent: Accent }) {
  return (
    <View style={{ marginTop: 8 }}>
      <View
        fixed
        style={{
          flexDirection: "row",
          backgroundColor: accent.tint,
          borderBottomWidth: 1,
          borderBottomColor: accent.fill,
          paddingVertical: 5,
          paddingHorizontal: 6,
        }}
      >
        {columns.map((c) => (
          <Text
            key={c.label}
            style={{
              width: c.width,
              textAlign: c.align ?? "left",
              fontSize: 7.5,
              fontWeight: 700,
              color: accent.text,
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((cells, r) => (
        <View
          key={r}
          wrap={false}
          style={{
            flexDirection: "row",
            paddingVertical: 5,
            paddingHorizontal: 6,
            backgroundColor: r % 2 ? ZEBRA : undefined,
            borderBottomWidth: 0.5,
            borderBottomColor: RULE,
          }}
        >
          {cells.map((cell, i) => (
            <Text
              key={i}
              style={{
                width: columns[i]!.width,
                textAlign: columns[i]!.align ?? "left",
                paddingRight: i < cells.length - 1 ? 6 : 0,
              }}
            >
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Columns and cells of a quote or invoice line table. The tax column only shows when some line is taxed. */
export function lineTable(
  lines: DocumentLine[],
  currency: Currency,
  locale: Locale,
): { columns: Column[]; rows: string[][] } {
  const l = documentLabels(locale);
  const taxed = lines.some((x) => x.taxRateBps > 0);
  const columns: Column[] = [
    { label: l.description, width: taxed ? "42%" : "50%" },
    { label: l.quantity, width: "14%", align: "right" },
    { label: l.unitPrice, width: "16%", align: "right" },
    ...(taxed ? [{ label: l.tax, width: "10%", align: "right" as const }] : []),
    { label: l.amount, width: taxed ? "18%" : "20%", align: "right" },
  ];
  const rows = lines.map((x) => [
    x.description,
    formatQuantity(x.quantity, x.unit, locale),
    formatAmount(x.unitPriceMinor, currency),
    ...(taxed ? [formatTaxRate(x.taxRateBps, locale)] : []),
    formatAmount(x.netMinor, currency),
  ]);
  return { columns, rows };
}

/** Subtotal, discount, tax and total; invoices add what was paid and the balance due. */
export function Totals({
  totals,
  currency,
  labels,
  accent,
  paid,
  stamp,
}: {
  totals: DocumentTotals;
  currency: Currency;
  labels: DocumentLabels;
  accent: Accent;
  paid?: { amountPaidMinor: number; balanceMinor: number };
  /** A PAID or VOID stamp to the left of the totals. */
  stamp?: ReactNode;
}) {
  const row = (label: string, value: string, strong = false) => (
    <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 }}>
      <Text style={strong ? styles.bold : styles.muted}>{label}</Text>
      <Text style={strong ? styles.bold : undefined}>{value}</Text>
    </View>
  );
  return (
    <View wrap={false} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10 }}>
      <View style={{ flexGrow: 1, justifyContent: "center" }}>{stamp}</View>
      <View style={{ width: "42%" }}>
        {row(labels.subtotal, formatAmount(totals.subtotalMinor, currency))}
        {totals.discountMinor
          ? row(labels.discount, `−${formatAmount(totals.discountMinor, currency)}`)
          : null}
        {row(labels.tax, formatAmount(totals.taxMinor, currency))}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            marginTop: 4,
            paddingVertical: 6,
            paddingHorizontal: 6,
            backgroundColor: accent.tint,
            borderRadius: 4,
          }}
        >
          <Text style={[styles.bold, { color: accent.text }]}>{labels.total}</Text>
          <Text style={[styles.bold, { fontSize: 11, lineHeight: 1.2 }]}>
            {formatAmount(totals.totalMinor, currency)}
          </Text>
        </View>
        {paid ? (
          <View style={{ marginTop: 4 }}>
            {row(labels.amountPaid, formatAmount(paid.amountPaidMinor, currency))}
            {row(labels.balanceDue, formatAmount(paid.balanceMinor, currency), true)}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** A titled block of free text (notes, payment instructions, report sections). */
export function TextBlock({ title, text, color }: { title: string; text: string; color?: string }) {
  return (
    <View style={styles.section}>
      <Heading color={color}>{title}</Heading>
      <Text style={styles.paragraph}>{text}</Text>
    </View>
  );
}

/** A section heading that moves to the next page rather than stay alone at the bottom of one. */
export function Heading({ children, color }: { children: string; color?: string | undefined }) {
  return (
    <Text minPresenceAhead={48} style={[styles.h2, color ? { color } : {}]}>
      {children}
    </Text>
  );
}

/** A rotated, outlined stamp (PAID, VOID), drawn next to the totals. */
export function Stamp({ text, color }: { text: string; color: string }) {
  return (
    <View
      style={{
        alignSelf: "center",
        marginLeft: 30,
        transform: "rotate(-12deg)",
        borderWidth: 3,
        borderColor: color,
        borderRadius: 6,
        paddingVertical: 4,
        paddingHorizontal: 14,
        opacity: 0.85,
      }}
    >
      <Text
        style={{
          color,
          fontSize: 28,
          lineHeight: 1.2,
          fontWeight: 700,
          letterSpacing: 4,
          textTransform: "uppercase",
        }}
      >
        {text}
      </Text>
    </View>
  );
}

/** "Page 1 of 2" with the organization and the document number, on every page. */
export function Footer({ left, labels }: { left: string; labels: DocumentLabels }) {
  return (
    <View fixed style={styles.footer}>
      <Text>{left}</Text>
      <Text render={({ pageNumber, totalPages }) => labels.page(pageNumber, totalPages)} />
    </View>
  );
}

/** Meta rows for the letterhead, skipping missing dates. */
export function dateMeta(rows: [string, string | null][], locale: Locale): [string, string][] {
  return rows.filter((r): r is [string, string] => Boolean(r[1])).map(([k, v]) => [k, formatDate(v, locale)]);
}
