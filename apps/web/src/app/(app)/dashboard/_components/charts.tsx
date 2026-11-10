"use client";
import { STATUS_LABELS } from "@fieldops/core";
import { JOB_STATUSES, type JobStatus } from "@fieldops/shared";
import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Charts for the overview (DSH-02). They are a visual layer: each sits next to a data table with the same
// numbers and the same drill-down links, which is what screen readers and keyboards use (aria-hidden here).

export const STATUS_COLORS: Record<JobStatus, string> = {
  new: "#94a3b8",
  scheduled: "#0ea5e9",
  en_route: "#6366f1",
  in_progress: "#f59e0b",
  on_hold: "#f97316",
  completed: "#10b981",
  canceled: "#a1a1aa",
};

const axis = { fill: "var(--muted-foreground)", fontSize: 12 };
const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--popover-foreground)",
  fontSize: 12,
};

type ChartClick = { activeIndex?: number | string | null } | null | undefined;
const indexOf = (s: ChartClick) => {
  const i = Number(s?.activeIndex);
  return Number.isInteger(i) && i >= 0 ? i : null;
};

export interface StatusPoint {
  label: string;
  counts: Record<JobStatus, number>;
  hrefs: Record<JobStatus, string>;
}

export function StatusChart({ data }: { data: StatusPoint[] }) {
  const router = useRouter();
  const rows = data.map((d) => ({ label: d.label, ...d.counts }));
  const used = JOB_STATUSES.filter((s) => data.some((d) => d.counts[s] > 0));
  return (
    <div aria-hidden className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} accessibilityLayer={false} margin={{ left: -12, right: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={12} />
          <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} width={40} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {used.map((s) => (
            <Bar
              key={s}
              dataKey={s}
              name={STATUS_LABELS[s]}
              stackId="status"
              fill={STATUS_COLORS[s]}
              cursor="pointer"
              onClick={(_d: unknown, index: number) => {
                const href = data[index]?.hrefs[s];
                if (href) router.push(href);
              }}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface SlaPoint {
  label: string;
  rate: number | null;
  href: string;
}

export function SlaChart({ data, name }: { data: SlaPoint[]; name: string }) {
  const router = useRouter();
  const rows = data.map((d) => ({ label: d.label, rate: d.rate === null ? null : Math.round(d.rate * 100) }));
  return (
    <div aria-hidden className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={rows}
          accessibilityLayer={false}
          margin={{ left: -12, right: 8 }}
          onClick={(s: ChartClick) => {
            const i = indexOf(s);
            if (i !== null && data[i]) router.push(data[i].href);
          }}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={12} />
          <YAxis domain={[0, 100]} unit="%" tick={axis} tickLine={false} axisLine={false} width={48} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}%`, name]} />
          <Line
            type="monotone"
            dataKey="rate"
            name={name}
            stroke="#0284c7"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
            cursor="pointer"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface PairPoint {
  label: string;
  a: number;
  b: number;
  href: string | null;
}

/** Two horizontal bars per row: service types (created, completed) or technicians (scheduled, working). */
export function PairChart({
  data,
  names,
  colors,
  unit,
}: {
  data: PairPoint[];
  names: [string, string];
  colors: [string, string];
  unit?: string;
}) {
  const router = useRouter();
  const height = Math.max(160, data.length * 44 + 48);
  return (
    <div aria-hidden style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          accessibilityLayer={false}
          margin={{ left: 8, right: 16 }}
          onClick={(s: ChartClick) => {
            const i = indexOf(s);
            const href = i === null ? null : data[i]?.href;
            if (href) router.push(href);
          }}
        >
          <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            type="number"
            tick={axis}
            tickLine={false}
            axisLine={false}
            unit={unit}
            allowDecimals={false}
          />
          <YAxis type="category" dataKey="label" tick={axis} tickLine={false} axisLine={false} width={120} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="a" name={names[0]} fill={colors[0]} radius={[0, 3, 3, 0]} cursor="pointer" />
          <Bar dataKey="b" name={names[1]} fill={colors[1]} radius={[0, 3, 3, 0]} cursor="pointer" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
