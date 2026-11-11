"use client";
import { formatMoney, toMajor } from "@fieldops/core";
import type { Currency } from "@fieldops/shared";
import { useLocale } from "next-intl";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { intlLocale } from "@/lib/format";

// The revenue trend (DSH-02): invoiced and collected per day or week. Like the other charts it is a visual layer
// next to a data table with the same numbers (aria-hidden here).

const axis = { fill: "var(--muted-foreground)", fontSize: 12 };
const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--popover-foreground)",
  fontSize: 12,
};

export function RevenueChart({
  data,
  currency,
  names,
}: {
  data: { label: string; invoicedMinor: number; collectedMinor: number }[];
  currency: Currency;
  names: [string, string];
}) {
  const rows = data.map((d) => ({
    label: d.label,
    invoiced: toMajor(d.invoicedMinor, currency),
    collected: toMajor(d.collectedMinor, currency),
  }));
  const locale = useLocale();
  const compact = new Intl.NumberFormat(intlLocale(locale), { notation: "compact" });
  return (
    <div aria-hidden className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} accessibilityLayer={false} margin={{ left: 0, right: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={12} />
          <YAxis
            tick={axis}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v: number) => compact.format(v)}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ fill: "var(--muted)" }}
            formatter={(v) =>
              formatMoney({ amountMinor: Math.round(Number(v) * 100), currency }, intlLocale(locale))
            }
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="invoiced" name={names[0]} fill="#0ea5e9" radius={[3, 3, 0, 0]} />
          <Bar dataKey="collected" name={names[1]} fill="#10b981" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
