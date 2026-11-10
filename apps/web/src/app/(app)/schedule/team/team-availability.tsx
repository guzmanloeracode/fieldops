"use client";
import { SUGGESTED_SKILLS } from "@fieldops/shared";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatCalendarDate, fromLocalInput } from "@/lib/format";
import { createTimeOffAction, deleteTimeOffAction, updateAvailabilityAction } from "../actions";

type Hours = { day: number; open: string; close: string }[];

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  skills: string[];
  workingHours: Hours | null;
  timeOff: { id: string; from: string; to: string; reason: string | null; past: boolean }[];
}

/** Monday first. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
// 15 Nov 2026 is a Sunday; day names follow the reader's language.
const dayName = (day: number, locale: string, style: "weekday" | "weekdayLong" = "weekdayLong") =>
  formatCalendarDate(`2026-11-${15 + day}`, style, locale);
const shortDate = (date: string, locale: string) => formatCalendarDate(date, "date", locale);

function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function TeamAvailability(props: { timeZone: string; businessHours: Hours; members: TeamMember[] }) {
  const locale = useLocale();
  const business = props.businessHours.length
    ? WEEK.filter((d) => props.businessHours.some((h) => h.day === d))
        .map((d) => {
          const h = props.businessHours.find((x) => x.day === d)!;
          return `${dayName(d, locale, "weekday")} ${h.open}–${h.close}`;
        })
        .join(", ")
    : null;
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {props.members.map((m) => (
        <MemberCard key={m.id} member={m} timeZone={props.timeZone} businessText={business} />
      ))}
    </div>
  );
}

function MemberCard({
  member,
  timeZone,
  businessText,
}: {
  member: TeamMember;
  timeZone: string;
  businessText: string | null;
}) {
  const t = useTranslations("dispatch.team");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [own, setOwn] = useState(member.workingHours !== null);
  const [hours, setHours] = useState<Record<number, { on: boolean; open: string; close: string }>>(() =>
    Object.fromEntries(
      WEEK.map((d) => {
        const h = member.workingHours?.find((x) => x.day === d);
        return [
          d,
          {
            on: Boolean(h) || (!member.workingHours && d >= 1 && d <= 5),
            open: h?.open ?? "08:00",
            close: h?.close ?? "17:00",
          },
        ];
      }),
    ),
  );
  const [skills, setSkills] = useState(member.skills);
  const [skill, setSkill] = useState("");
  const [error, setError] = useState<string | null>(null);
  // UUIDv7 prefixes are timestamps and repeat across members, so ids come from React instead.
  const p = useId();
  const roleKey = `role${member.role[0]!.toUpperCase()}${member.role.slice(1)}` as
    "roleTechnician" | "roleDispatcher" | "roleAdmin" | "roleOwner";

  const addSkill = () => {
    const s = skill.trim().toLowerCase();
    if (s && !skills.includes(s)) setSkills([...skills, s].sort());
    setSkill("");
  };

  const save = () =>
    startTransition(async () => {
      setError(null);
      const working_hours = own
        ? WEEK.filter((d) => hours[d]!.on).map((d) => ({
            day: d,
            open: hours[d]!.open,
            close: hours[d]!.close,
          }))
        : null;
      const r = await updateAvailabilityAction(member.id, { working_hours, skills });
      if (!r.ok) {
        setError(r.error.fields?.[0]?.message ?? r.error.message);
        return;
      }
      toast.success(t("saved", { name: member.name }));
      router.refresh();
    });

  return (
    <Card data-testid="team-member" data-member={member.name}>
      <CardHeader>
        <CardTitle className="text-base">{member.name}</CardTitle>
        <CardDescription>{t(roleKey)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t("hoursLegend", { name: member.name })}</legend>
          <RadioGroup
            value={own ? "own" : "business"}
            onValueChange={(v) => setOwn(v === "own")}
            className="flex flex-wrap gap-4"
          >
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="business" /> {t("businessHours")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="own" /> {t("custom")}
            </label>
          </RadioGroup>
          {own ? (
            <div className="space-y-1.5">
              {WEEK.map((d) => {
                const h = hours[d]!;
                const set = (patch: Partial<typeof h>) => setHours({ ...hours, [d]: { ...h, ...patch } });
                return (
                  <div key={d} className="grid grid-cols-[8rem_1fr_1fr] items-center gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={h.on} onCheckedChange={(v) => set({ on: v === true })} />
                      {dayName(d, locale)}
                    </label>
                    <Input
                      type="time"
                      step={900}
                      value={h.open}
                      disabled={!h.on}
                      aria-label={`${dayName(d, locale)}: ${t("open")}`}
                      onChange={(e) => set({ open: e.target.value })}
                      className="h-8"
                    />
                    <Input
                      type="time"
                      step={900}
                      value={h.close}
                      disabled={!h.on}
                      aria-label={`${dayName(d, locale)}: ${t("close")}`}
                      onChange={(e) => set({ close: e.target.value })}
                      className="h-8"
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              {businessText ? t("followsBusiness", { hours: businessText }) : t("noBusinessHours")}
            </p>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("skills")}</legend>
          <p className="text-muted-foreground text-xs">{t("skillsHint")}</p>
          {skills.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {skills.map((s) => (
                <li
                  key={s}
                  className="bg-muted inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs font-medium"
                >
                  {s}
                  <button
                    type="button"
                    onClick={() => setSkills(skills.filter((x) => x !== s))}
                    className="hover:bg-background rounded-full p-0.5"
                    aria-label={t("removeSkill", { skill: s })}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">{t("noSkills")}</p>
          )}
          <div className="flex gap-2">
            <Label htmlFor={`${p}-skill`} className="sr-only">
              {t("newSkill")}
            </Label>
            <Input
              id={`${p}-skill`}
              list={`${p}-skills`}
              value={skill}
              onChange={(e) => setSkill(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSkill();
                }
              }}
              placeholder={t("newSkill")}
              className="h-8 max-w-48"
            />
            <datalist id={`${p}-skills`}>
              {SUGGESTED_SKILLS.filter((s) => !skills.includes(s)).map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <Button type="button" variant="outline" size="sm" onClick={addSkill} disabled={!skill.trim()}>
              <Plus aria-hidden /> {t("addSkill")}
            </Button>
          </div>
        </fieldset>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <Button onClick={save} disabled={pending} data-testid="availability-save">
          {pending ? <Loader2 className="animate-spin" /> : null}
          {t("save")}
        </Button>

        <TimeOff member={member} timeZone={timeZone} idPrefix={p} />
      </CardContent>
    </Card>
  );
}

function TimeOff({ member, timeZone, idPrefix }: { member: TeamMember; timeZone: string; idPrefix: string }) {
  const t = useTranslations("dispatch.team");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () =>
    startTransition(async () => {
      setError(null);
      const r = await createTimeOffAction({
        member_id: member.id,
        starts_at: fromLocalInput(`${from}T00:00`, timeZone),
        ends_at: fromLocalInput(`${nextDate(to || from)}T00:00`, timeZone),
        reason: reason || null,
      });
      if (!r.ok) {
        setError(r.error.fields?.[0]?.message ?? r.error.message);
        return;
      }
      toast.success(t("added"));
      setFrom("");
      setTo("");
      setReason("");
      router.refresh();
    });

  const remove = (id: string) =>
    startTransition(async () => {
      const r = await deleteTimeOffAction(id);
      if (!r.ok) toast.error(r.error.message);
      else {
        toast.success(t("removed"));
        router.refresh();
      }
    });

  return (
    <section className="space-y-3 border-t pt-4" aria-labelledby={`${idPrefix}-off`}>
      <h3 id={`${idPrefix}-off`} className="text-sm font-medium">
        {t("timeOff")}
      </h3>
      {member.timeOff.length ? (
        <ul className="space-y-1.5">
          {member.timeOff.map((o) => {
            const range =
              o.from === o.to
                ? shortDate(o.from, locale)
                : `${shortDate(o.from, locale)} – ${shortDate(o.to, locale)}`;
            return (
              <li key={o.id} className="flex items-center gap-2 text-sm">
                <span className={o.past ? "text-muted-foreground" : undefined}>
                  {range}
                  {o.reason ? ` · ${o.reason}` : ""}
                  {o.past ? ` (${t("past")})` : ""}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-8"
                  onClick={() => remove(o.id)}
                  disabled={pending}
                  aria-label={t("remove", { range })}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">{t("noTimeOff")}</p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-off-from`} className="text-xs">
            {t("from")}
          </Label>
          <Input
            id={`${idPrefix}-off-from`}
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-off-to`} className="text-xs">
            {t("to")}
          </Label>
          <Input
            id={`${idPrefix}-off-to`}
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`${idPrefix}-off-reason`} className="text-xs">
            {t("reason")}
          </Label>
          <div className="flex gap-2">
            <Input
              id={`${idPrefix}-off-reason`}
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              className="h-8"
            />
            <Button type="button" size="sm" variant="outline" onClick={add} disabled={pending || !from}>
              <Plus aria-hidden /> {t("addTimeOff")}
            </Button>
          </div>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </section>
  );
}
