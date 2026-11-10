import type { QuoteLineRecord } from "@fieldops/core";
import type { Currency } from "@fieldops/shared";
import { getTranslations } from "next-intl/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money, percent } from "./money";

/** The lines and totals of a sent quote or an issued invoice, read-only. */
export async function DocumentLines({
  lines,
  currency,
  totals,
  extra = [],
}: {
  lines: readonly QuoteLineRecord[];
  currency: Currency;
  totals: { subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number };
  /** More rows under the total, such as paid and balance due. */
  extra?: { label: string; minor: number; strong?: boolean; testId?: string }[];
}) {
  const t = await getTranslations("billing.lines");
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <caption className="sr-only">{t("caption")}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t("description")}</TableHead>
              <TableHead scope="col" className="text-right">
                {t("quantity")}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t("unitPriceShort")}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t("tax")}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t("amount")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="max-w-80 whitespace-normal">
                  <span className="block">{l.description}</span>
                  <span className="text-muted-foreground text-xs">{t(`kinds.${l.kind}`)}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {l.quantity}
                  {l.unit ? ` ${l.unit}` : ""}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(l.unitPriceMinor, currency)}</TableCell>
                <TableCell className="text-right tabular-nums">{percent(l.taxRateBps)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(l.netMinor, currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <dl className="ml-auto max-w-xs space-y-1 text-sm" data-testid="totals">
        <Row label={t("subtotal")} value={money(totals.subtotalMinor, currency)} />
        {totals.discountMinor ? (
          <Row label={t("discountTotal")} value={`−${money(totals.discountMinor, currency)}`} />
        ) : null}
        <Row label={t("taxTotal")} value={money(totals.taxMinor, currency)} />
        <Row label={t("total")} value={money(totals.totalMinor, currency)} strong testId="total" />
        {extra.map((e) => (
          <Row
            key={e.label}
            label={e.label}
            value={money(e.minor, currency)}
            strong={e.strong}
            testId={e.testId}
          />
        ))}
      </dl>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  testId,
}: {
  label: string;
  value: string;
  strong?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={
        strong ? "flex justify-between gap-8 border-t pt-1 font-semibold" : "flex justify-between gap-8"
      }
    >
      <dt className={strong ? undefined : "text-muted-foreground"}>{label}</dt>
      <dd className="tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
