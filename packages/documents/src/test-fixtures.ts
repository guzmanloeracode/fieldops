import { deflateSync, crc32 } from "node:zlib";
import type { DocumentBrand, InvoiceDocument, QuoteDocument, ServiceReportDocument } from "./types";

// Sample documents for the renderer tests and for previewing layouts by hand.

/** A 96×72 JPEG test card. */
export const SAMPLE_JPEG = new Uint8Array(
  Buffer.from(
    "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",
    "base64",
  ),
);

/** A solid-color RGB PNG, built in code. */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

export const brand: DocumentBrand = {
  name: "Acme Air & Clean",
  logo: null,
  brandColor: "#0f766e",
  addressLines: ["4410 Burnet Rd, Suite 120", "Austin, TX 78756"],
  email: "office@acme-air.example",
  phone: "(512) 555-0199",
  timeZone: "America/Chicago",
};

const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    description:
      i === 0 ? "AC tune-up: coil cleaning, refrigerant check and electrical test" : `Part ${i + 1}`,
    quantity: i === 0 ? 1.5 : i + 1,
    unit: i === 0 ? "h" : "pc",
    unitPriceMinor: 9500 + i * 125,
    taxRateBps: i % 2 ? 825 : 0,
    netMinor: Math.round((i === 0 ? 1.5 : i + 1) * (9500 + i * 125)),
  }));

export function sampleQuote(lineCount = 3, extra: Partial<QuoteDocument> = {}): QuoteDocument {
  return {
    locale: "en",
    currency: "USD",
    brand,
    number: "QUO-000042",
    title: "Replace the condenser fan motor",
    customer: { name: "Cara Lopez", lines: ["12 Elm St", "Austin, TX 78704", "cara@example.com"] },
    site: { name: "Home", lines: ["12 Elm St", "Austin, TX 78704"] },
    issuedOn: "2026-11-10",
    validUntil: "2026-12-10",
    notes: "Prices include disposal of the old motor.",
    lines: lines(lineCount),
    totals: { subtotalMinor: 64_250, discountMinor: 5_000, taxMinor: 2_150, totalMinor: 61_400 },
    ...extra,
  };
}

export function sampleInvoice(extra: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    locale: "en",
    currency: "USD",
    brand,
    number: "INV-000007",
    status: "sent",
    billTo: { name: "Cara Lopez", lines: ["12 Elm St", "Austin, TX 78704"] },
    site: { name: "Home", lines: ["12 Elm St", "Austin, TX 78704"] },
    jobNumber: "JOB-000123",
    issueDate: "2026-11-10",
    dueDate: "2026-11-24",
    notes: null,
    paymentInstructions: "Bank transfer to Acme Air & Clean, account 0012 3456 7890.",
    lines: lines(4),
    totals: {
      subtotalMinor: 64_250,
      discountMinor: 0,
      taxMinor: 2_150,
      totalMinor: 66_400,
      amountPaidMinor: 10_000,
      balanceMinor: 56_400,
    },
    ...extra,
  };
}

export function sampleReport(extra: Partial<ServiceReportDocument> = {}): ServiceReportDocument {
  return {
    locale: "en",
    currency: "USD",
    brand,
    jobNumber: "JOB-000123",
    title: "Bedroom AC leaking water",
    customer: { name: "Cara Lopez", lines: ["(512) 555-0142"] },
    site: { name: "Home", lines: ["12 Elm St", "Austin, TX 78704"] },
    completedOn: "2026-11-09",
    technicians: ["Tom Rivera", "Ana Diaz"],
    workPerformed:
      "Flushed the condensate drain line, cleaned the evaporator coil and checked the refrigerant charge. The unit cools normally again.",
    findings: "The drain line was partly clogged with algae, which made the pan overflow.",
    recommendations: "Clean the drain line every six months. Consider a drain pan sensor.",
    nextServiceDate: "2027-05-09",
    checklist: [
      { label: "Check the condensate drain line", value: null, done: true },
      { label: "Supply air temperature", value: "13.5 °C", done: true },
      { label: "Photo of the unit after service", value: null, done: false },
    ],
    partsUsed: [{ description: "Drain line tablets", quantity: 2, unit: "pc" }],
    photos: [
      { tag: "after", caption: "Coil after cleaning", image: SAMPLE_JPEG },
      { tag: "before", caption: "Clogged drain pan", image: solidPng(80, 60, [180, 83, 9]) },
    ],
    signature: { name: "Cara Lopez", image: solidPng(120, 40, [15, 23, 42]) },
    ...extra,
  };
}
