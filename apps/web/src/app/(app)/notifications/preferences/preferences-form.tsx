"use client";
import type { NotificationPreferenceDto } from "@fieldops/shared";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { savePreferencesAction } from "../actions";

export function PreferencesForm({ initial }: { initial: NotificationPreferenceDto[] }) {
  const t = useTranslations("notifications");
  const tr = useTranslations("recurrences.digest");
  const [rows, setRows] = useState(initial);
  const [pending, start] = useTransition();
  const set = (event: string, patch: Partial<NotificationPreferenceDto>) =>
    setRows((prev) => prev.map((r) => (r.event === event ? { ...r, ...patch } : r)));

  const save = () =>
    start(async () => {
      const res = await savePreferencesAction({ preferences: rows });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      setRows(res.data);
      toast.success(t("preferences.saved"));
    });

  return (
    <Card>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <table className="w-full text-sm">
            <caption className="sr-only">{t("preferences.title")}</caption>
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                <th scope="col" className="py-2 pr-4 font-medium">
                  {t("preferences.event")}
                </th>
                <th scope="col" className="w-24 py-2 text-center font-medium">
                  {t("preferences.inApp")}
                </th>
                <th scope="col" className="w-24 py-2 text-center font-medium">
                  {t("preferences.email")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const name = t(`eventNames.${r.event}`);
                return (
                  <tr key={r.event} className="border-b last:border-b-0" data-testid={`pref-${r.event}`}>
                    <th scope="row" className="py-3 pr-4 text-left font-normal">
                      {name}
                    </th>
                    <td className="py-3 text-center">
                      {/* Email-only events, such as the daily digest (NOT-04), have no in-app switch. */}
                      {r.in_app === null ? (
                        <span className="text-muted-foreground text-xs">{tr("emailOnly")}</span>
                      ) : (
                        <Checkbox
                          checked={r.in_app}
                          onCheckedChange={(v) => set(r.event, { in_app: v === true })}
                          aria-label={t("preferences.toggle", {
                            channel: t("preferences.inApp"),
                            event: name,
                          })}
                          data-testid={`pref-${r.event}-in_app`}
                        />
                      )}
                    </td>
                    <td className="py-3 text-center">
                      {r.email === null ? (
                        <span className="text-muted-foreground text-xs">{t("preferences.noEmail")}</span>
                      ) : (
                        <Checkbox
                          checked={r.email}
                          onCheckedChange={(v) => set(r.event, { email: v === true })}
                          aria-label={t("preferences.toggle", {
                            channel: t("preferences.email"),
                            event: name,
                          })}
                          data-testid={`pref-${r.event}-email`}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={pending} data-testid="pref-save">
              {t("preferences.save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
