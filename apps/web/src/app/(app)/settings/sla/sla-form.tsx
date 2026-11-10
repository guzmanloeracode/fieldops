"use client";
import { JOB_PRIORITIES, type JobPriority } from "@fieldops/shared";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FieldError } from "@/components/app/field-error";
import { NativeSelect } from "@/components/app/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { updateSlaPoliciesAction } from "./actions";

type Unit = "minutes" | "hours" | "days";
const FACTOR: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };
type Target = "response" | "resolution";

interface Policy {
  priority: JobPriority;
  responseMin: number;
  resolutionMin: number;
  businessHours: boolean;
  isDefault: boolean;
}

interface Row {
  priority: JobPriority;
  response: { value: string; unit: Unit };
  resolution: { value: string; unit: Unit };
  businessHours: boolean;
  isDefault: boolean;
}

/** Minutes as the largest unit that keeps a whole number: 1440 → 1 day, 90 → 90 minutes. */
function split(minutes: number): { value: string; unit: Unit } {
  if (minutes % 1440 === 0) return { value: String(minutes / 1440), unit: "days" };
  if (minutes % 60 === 0) return { value: String(minutes / 60), unit: "hours" };
  return { value: String(minutes), unit: "minutes" };
}

const toMinutes = (v: { value: string; unit: Unit }) =>
  /^\d+$/.test(v.value.trim()) ? Number(v.value.trim()) * FACTOR[v.unit] : null;

/** Priorities from most to least urgent, as dispatchers think of them. */
const ORDER = [...JOB_PRIORITIES].reverse();

export function SlaForm({ policies }: { policies: Policy[] }) {
  const t = useTranslations("sla.settings");
  const tp = useTranslations("common.priority");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>(() =>
    ORDER.map((priority) => {
      const p = policies.find((x) => x.priority === priority)!;
      return {
        priority,
        response: split(p.responseMin),
        resolution: split(p.resolutionMin),
        businessHours: p.businessHours,
        isDefault: p.isDefault,
      };
    }),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (priority: JobPriority, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.priority === priority ? { ...r, ...patch } : r)));

  const submit = () => {
    const next: Record<string, string> = {};
    const payload = rows.map((r) => {
      const response = toMinutes(r.response);
      const resolution = toMinutes(r.resolution);
      if (response === null) next[`${r.priority}.response`] = t("invalid");
      if (resolution === null) next[`${r.priority}.resolution`] = t("invalid");
      return {
        priority: r.priority,
        response_min: response ?? 0,
        resolution_min: resolution ?? 0,
        business_hours: r.businessHours,
      };
    });
    setErrors(next);
    if (Object.keys(next).length) return;
    startTransition(async () => {
      const r = await updateSlaPoliciesAction({ policies: payload });
      if (!r.ok) {
        // Paths look like "policies.2.resolution_min": map them back to the row and target.
        const fields: Record<string, string> = {};
        for (const f of r.error.fields ?? []) {
          const m = /^policies\.(\d+)\.(response|resolution)_min$/.exec(f.path);
          if (m) fields[`${payload[Number(m[1])]!.priority}.${m[2]}`] = f.message;
        }
        setErrors(fields);
        if (!Object.keys(fields).length) toast.error(r.error.message);
        return;
      }
      toast.success(t("saved"));
      router.refresh();
    });
  };

  const targetCell = (r: Row, target: Target) => {
    const id = `sla-${r.priority}-${target}`;
    const error = errors[`${r.priority}.${target}`];
    const label = t("amount", { priority: tp(r.priority), target: t(target).toLowerCase() });
    return (
      <TableCell>
        <div className="flex items-center gap-2">
          <Input
            id={id}
            inputMode="numeric"
            className="w-20"
            value={r[target].value}
            aria-label={label}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            data-testid={id}
            onChange={(e) => set(r.priority, { [target]: { ...r[target], value: e.target.value } })}
          />
          <NativeSelect
            className="w-28"
            aria-label={`${label}, ${t("unit").toLowerCase()}`}
            value={r[target].unit}
            onChange={(e) => set(r.priority, { [target]: { ...r[target], unit: e.target.value as Unit } })}
          >
            {(["minutes", "hours", "days"] as const).map((u) => (
              <option key={u} value={u}>
                {t(u)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <FieldError id={`${id}-error`} message={error} />
      </TableCell>
    );
  };

  return (
    <form
      className="max-w-4xl space-y-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("priority")}</TableHead>
                  <TableHead scope="col">{t("response")}</TableHead>
                  <TableHead scope="col">{t("resolution")}</TableHead>
                  <TableHead scope="col">{t("businessHours")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.priority} data-testid={`sla-row-${r.priority}`}>
                    <TableCell className="font-medium">
                      {tp(r.priority)}
                      {r.isDefault ? (
                        <span className="text-muted-foreground ml-2 text-xs font-normal">{t("default")}</span>
                      ) : null}
                    </TableCell>
                    {targetCell(r, "response")}
                    {targetCell(r, "resolution")}
                    <TableCell>
                      <Switch
                        checked={r.businessHours}
                        onCheckedChange={(v) => set(r.priority, { businessHours: v })}
                        aria-label={`${tp(r.priority)}: ${t("businessHours").toLowerCase()}`}
                        data-testid={`sla-${r.priority}-business-hours`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-muted-foreground text-sm">{t("businessHoursHint")}</p>
          <p className="text-muted-foreground text-sm">{t("existingJobs")}</p>
        </CardContent>
      </Card>
      <Button type="submit" disabled={pending} data-testid="sla-save">
        {pending ? <Loader2 className="animate-spin" /> : null}
        {t("save")}
      </Button>
    </form>
  );
}
