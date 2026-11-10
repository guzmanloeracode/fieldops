import { describe, expect, it } from "vitest";
import { imageFormat, imageSource, lineTable } from "./components";
import {
  documentLabels,
  formatAmount,
  formatDate,
  formatQuantity,
  formatTaxRate,
  statusMark,
} from "./labels";
import { MAX_REPORT_PHOTOS, reportPhotos } from "./report";
import { accentFor, monogram, DEFAULT_ACCENT } from "./theme";
import { SAMPLE_JPEG, brand, sampleInvoice, sampleQuote, sampleReport, solidPng } from "./test-fixtures";
import { renderInvoicePdf, renderQuotePdf, renderServiceReportPdf } from "./index";
import type { Locale } from "@fieldops/shared";

const LOCALES: Locale[] = ["en", "id"];

/** A complete PDF: header, trailer and its page count from the page tree. */
function pdfInfo(bytes: Uint8Array) {
  const text = Buffer.from(bytes).toString("latin1");
  expect(text.startsWith("%PDF-")).toBe(true);
  expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  const pages = text.match(/\/Type \/Page\b(?!s)/g)?.length ?? 0;
  return { pages, size: bytes.length, text };
}

describe("labels and formatting", () => {
  it("has every label in English and Indonesian", () => {
    const en = documentLabels("en");
    const id = documentLabels("id");
    expect(Object.keys(id).sort()).toEqual(Object.keys(en).sort());
    expect(en.invoice).toBe("Invoice");
    expect(id.invoice).toBe("Faktur");
    expect(en.page(1, 2)).toBe("Page 1 of 2");
    expect(id.page(1, 2)).toBe("Halaman 1 dari 2");
    expect(id.signedBy("Budi")).toBe("Ditandatangani oleh Budi");
    expect(documentLabels("xx" as Locale)).toBe(en);
  });

  it("formats money like the app: USD with cents, IDR without decimals", () => {
    expect(formatAmount(123_456, "USD")).toBe("$1,234.56");
    expect(formatAmount(15_000_000, "IDR").replace(/\s/g, " ")).toBe("Rp 150.000");
  });

  it("formats dates, quantities and tax rates in the document's language", () => {
    expect(formatDate("2026-11-10", "en")).toBe("Nov 10, 2026");
    expect(formatDate("2026-05-09", "id")).toBe("9 Mei 2026");
    expect(formatDate("not a date", "en")).toBe("not a date");
    expect(formatQuantity(1.5, "h", "en")).toBe("1.5 h");
    expect(formatQuantity(1.5, "jam", "id")).toBe("1,5 jam");
    expect(formatQuantity(3, null, "en")).toBe("3");
    expect(formatTaxRate(1100, "id")).toBe("11%");
    expect(formatTaxRate(825, "en")).toBe("8.25%");
    expect(formatTaxRate(825, "id")).toBe("8,25%");
  });

  it("marks invoice statuses that need a stamp or chip", () => {
    expect(statusMark("paid", "en")).toBe("Paid");
    expect(statusMark("void", "id")).toBe("Batal");
    expect(statusMark("draft", "en")).toBe("Draft");
    expect(statusMark("overdue", "id")).toBe("Lewat jatuh tempo");
    expect(statusMark("sent", "en")).toBeNull();
  });
});

describe("branding", () => {
  it("derives readable accents from the brand color", () => {
    const teal = accentFor("#0f766e");
    expect(teal.fill).toBe("#0f766e");
    expect(teal.onFill).toBe("#ffffff");
    expect(teal.text).toBe("#0f766e");
    const yellow = accentFor("#fde047");
    expect(yellow.onFill).not.toBe("#ffffff");
    expect(yellow.text).not.toBe("#fde047"); // darkened to read on white
    expect(accentFor("#abc").fill).toBe("#aabbcc");
    expect(accentFor(null).fill).toBe(DEFAULT_ACCENT);
    expect(accentFor("teal").fill).toBe(DEFAULT_ACCENT);
  });

  it("draws a monogram from the organization's name", () => {
    expect(monogram("Acme Air & Clean")).toBe("AA");
    expect(monogram("acme")).toBe("A");
    expect(monogram("PT Sejuk Abadi")).toBe("PS");
    expect(monogram("  & ")).toBe("•");
  });

  it("only embeds PNG and JPEG images", () => {
    expect(imageFormat(SAMPLE_JPEG)).toBe("jpg");
    expect(imageFormat(solidPng(2, 2, [0, 0, 0]))).toBe("png");
    expect(imageFormat(new TextEncoder().encode("RIFF....WEBPVP8 "))).toBeNull();
    expect(imageSource(null)).toBeNull();
    expect(imageSource(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(imageSource(SAMPLE_JPEG)?.format).toBe("jpg");
  });
});

describe("line tables", () => {
  it("shows a tax column only when a line is taxed", () => {
    const taxed = lineTable(sampleQuote(2).lines, "USD", "en");
    expect(taxed.columns.map((c) => c.label)).toEqual(["Description", "Qty", "Unit price", "Tax", "Amount"]);
    expect(taxed.rows[1]).toEqual(["Part 2", "2 pc", "$96.25", "8.25%", "$192.50"]);
    const untaxed = lineTable(
      sampleQuote(2).lines.map((x) => ({ ...x, taxRateBps: 0 })),
      "IDR",
      "id",
    );
    expect(untaxed.columns.map((c) => c.label)).toEqual(["Deskripsi", "Jml", "Harga satuan", "Jumlah"]);
  });
});

describe("renderers", () => {
  for (const locale of LOCALES) {
    it(`renders a quote, an invoice and a service report in ${locale}`, async () => {
      const quote = pdfInfo(await renderQuotePdf(sampleQuote(3, { locale })));
      const invoice = pdfInfo(await renderInvoicePdf(sampleInvoice({ locale })));
      const report = pdfInfo(await renderServiceReportPdf(sampleReport({ locale })));
      expect(quote.pages).toBe(1);
      expect(invoice.pages).toBe(1);
      expect(report.pages).toBeGreaterThanOrEqual(1);
      // The fonts are embedded (subset), not the standard Helvetica.
      expect(quote.text).toContain("/FontFile2");
      expect(quote.text).not.toContain("/Helvetica");
    });
  }

  it("renders every invoice status, with and without optional parts", async () => {
    for (const status of ["draft", "sent", "overdue", "paid", "void"] as const) {
      const pdf = pdfInfo(await renderInvoicePdf(sampleInvoice({ status })));
      expect(pdf.pages).toBe(1);
    }
    const bare = pdfInfo(
      await renderInvoicePdf(
        sampleInvoice({
          site: null,
          jobNumber: null,
          dueDate: null,
          notes: "Thanks",
          paymentInstructions: null,
          brand: { ...brand, email: null, phone: null, addressLines: [], brandColor: null },
        }),
      ),
    );
    expect(bare.pages).toBe(1);
    const quote = pdfInfo(
      await renderQuotePdf(
        sampleQuote(1, { site: null, validUntil: null, notes: null, currency: "IDR", locale: "id" }),
      ),
    );
    expect(quote.pages).toBe(1);
    // A4 for everyone but US-dollar documents, which use Letter.
    expect(quote.text).toMatch(/\/MediaBox \[0 0 595\.28\d* 841\.89/);
    const usd = pdfInfo(await renderQuotePdf(sampleQuote(1)));
    expect(usd.text).toMatch(/\/MediaBox \[0 0 612 792\]/);
  });

  it("draws the logo when there is one, instead of the monogram", async () => {
    const withLogo = pdfInfo(
      await renderQuotePdf(sampleQuote(1, { brand: { ...brand, logo: solidPng(40, 40, [3, 105, 161]) } })),
    );
    expect(withLogo.text).toContain("/Subtype /Image");
    const unreadable = pdfInfo(
      await renderQuotePdf(sampleQuote(1, { brand: { ...brand, logo: new Uint8Array([1, 2, 3]) } })),
    );
    expect(unreadable.text).not.toContain("/Subtype /Image");
  });

  it("continues long tables on the next pages", async () => {
    const long = pdfInfo(await renderQuotePdf(sampleQuote(80)));
    expect(long.pages).toBeGreaterThanOrEqual(3);
    const longReport = pdfInfo(
      await renderServiceReportPdf(
        sampleReport({
          checklist: Array.from({ length: 70 }, (_, i) => ({
            label: `Check ${i + 1}`,
            value: null,
            done: true,
          })),
        }),
      ),
    );
    expect(longReport.pages).toBeGreaterThanOrEqual(3);
  });

  it("renders a report with only the required fields", async () => {
    const pdf = pdfInfo(
      await renderServiceReportPdf(
        sampleReport({
          technicians: [],
          findings: null,
          recommendations: null,
          nextServiceDate: null,
          checklist: [],
          partsUsed: [],
          photos: [],
          signature: null,
          brand: { ...brand, brandColor: null },
        }),
      ),
    );
    expect(pdf.pages).toBe(1);
    expect(pdf.text).not.toContain("/Subtype /Image");
    const unnamed = pdfInfo(
      await renderServiceReportPdf(
        sampleReport({ signature: { name: null, image: solidPng(20, 10, [0, 0, 0]) }, photos: [] }),
      ),
    );
    expect(unnamed.pages).toBe(1);
  });

  it("renders well under a second", async () => {
    // About 130 ms warm on the server; coverage instrumentation makes it several times slower.
    await renderServiceReportPdf(sampleReport());
    const started = performance.now();
    await renderServiceReportPdf(sampleReport());
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("report photos", () => {
  it("prints readable photos, before ones first, up to the limit", () => {
    const png = solidPng(4, 4, [0, 0, 0]);
    const webp = new TextEncoder().encode("RIFF....WEBPVP8 ");
    const photos = reportPhotos([
      { tag: null, caption: "other", image: png },
      { tag: "after", caption: "after", image: SAMPLE_JPEG },
      { tag: "before", caption: "webp", image: webp },
      { tag: "before", caption: "before", image: png },
      ...Array.from({ length: 8 }, (_, i) => ({ tag: null, caption: `x${i}`, image: png })),
    ]);
    expect(photos).toHaveLength(MAX_REPORT_PHOTOS);
    expect(photos.slice(0, 3).map((p) => p.caption)).toEqual(["before", "after", "other"]);
    expect(photos.some((p) => p.caption === "webp")).toBe(false);
  });
});

describe("embedded fonts", () => {
  it("match the committed TTF files (regenerate with `pnpm --filter @fieldops/documents fonts`)", async () => {
    const { readFileSync } = await import("node:fs");
    const { INTER_BOLD, INTER_REGULAR } = await import("./fonts.generated");
    const ttf = (name: string) =>
      readFileSync(new URL(`../fonts/${name}`, import.meta.url)).toString("base64");
    expect(INTER_REGULAR).toBe(`data:font/ttf;base64,${ttf("Inter-Regular.ttf")}`);
    expect(INTER_BOLD).toBe(`data:font/ttf;base64,${ttf("Inter-Bold.ttf")}`);
  });
});
