"use client";
import {
  PORTAL_MAX_PHOTO_BYTES,
  PORTAL_MAX_PHOTOS,
  PORTAL_PHOTO_TYPES,
  PORTAL_TIME_SLOTS,
  type PortalTimeSlot,
} from "@fieldops/shared";
import { ImagePlus, Loader2, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, useTransition } from "react";
import { FieldError } from "@/components/app/field-error";
import { NativeSelect } from "@/components/app/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { makeThumbnail } from "@/lib/thumbnail";
import { requestPortalPhotoAction, submitPortalRequestAction } from "../../actions";

type Site = { id: string; label: string; line1: string; city: string };
type Window = { key: number; date: string; slot: PortalTimeSlot };

const NEW = "new";

export function RequestForm({
  slug,
  sites,
  minDate,
  maxDate,
}: {
  slug: string;
  sites: Site[];
  minDate: string;
  maxDate: string;
}) {
  const t = useTranslations("portal.request");
  const router = useRouter();
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [site, setSite] = useState<string>(sites[0]?.id ?? NEW);
  const [windows, setWindows] = useState<Window[]>([{ key: 0, date: minDate, slot: "anytime" }]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const addPhotos = (list: FileList | null) => {
    if (!list) return;
    const next = [...photos];
    for (const f of Array.from(list)) {
      if (!(PORTAL_PHOTO_TYPES as readonly string[]).includes(f.type))
        return setError(t("wrongType", { name: f.name }));
      if (f.size > PORTAL_MAX_PHOTO_BYTES) return setError(t("tooLarge", { name: f.name }));
      if (next.length >= PORTAL_MAX_PHOTOS) return setError(t("tooMany"));
      next.push(f);
    }
    setError(null);
    setPhotos(next);
  };

  async function upload(file: File): Promise<string | null> {
    const thumb = await makeThumbnail(file);
    const r = await requestPortalPhotoAction(slug, {
      file_name: file.name,
      mime_type: file.type as (typeof PORTAL_PHOTO_TYPES)[number],
      size_bytes: file.size,
      with_thumbnail: Boolean(thumb),
    });
    if (!r.ok) return null;
    const put = await fetch(r.data.uploadUrl, { method: "PUT", body: file, headers: r.data.headers });
    if (!put.ok) return null;
    if (thumb && r.data.thumbnailUploadUrl) {
      await fetch(r.data.thumbnailUploadUrl, {
        method: "PUT",
        body: thumb,
        headers: { "Content-Type": "image/webp" },
      });
    }
    return r.data.token;
  }

  const err = (path: string) => fields[path];
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const text = (k: string) => String(form.get(k) ?? "");
        const input = {
          description: text("description"),
          site_id: site === NEW ? null : site,
          new_site:
            site === NEW
              ? {
                  line1: text("line1"),
                  line2: text("line2"),
                  city: text("city"),
                  postal_code: text("postal_code"),
                  access_notes: text("access_notes"),
                }
              : null,
          windows: windows.map(({ date, slot }) => ({ date, slot })),
        };
        setError(null);
        setFields({});
        startTransition(async () => {
          const tokens: string[] = [];
          if (photos.length) setStatus(t("uploading"));
          for (const p of photos) {
            const token = await upload(p);
            if (!token) {
              setStatus(null);
              setError(t("uploadFailed"));
              return;
            }
            tokens.push(token);
          }
          setStatus(null);
          const r = await submitPortalRequestAction(slug, input, tokens);
          if (r.ok) {
            router.push(`/portal/${slug}/jobs/${r.data.number}?created=1`);
            return;
          }
          setError(r.error.message);
          setFields(Object.fromEntries((r.error.fields ?? []).map((f) => [f.path, f.message])));
        });
      }}
    >
      <Card>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor={`${id}-description`}>{t("what")}</Label>
            <Textarea
              id={`${id}-description`}
              name="description"
              rows={5}
              required
              maxLength={4000}
              aria-invalid={Boolean(err("description"))}
              aria-describedby={`${id}-description-hint${err("description") ? ` ${id}-description-error` : ""}`}
              data-testid="portal-description"
            />
            <p id={`${id}-description-hint`} className="text-muted-foreground text-xs">
              {t("whatHint")}
            </p>
            <FieldError id={`${id}-description-error`} message={err("description")} />
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">{t("where")}</legend>
            {sites.map((s) => (
              <label
                key={s.id}
                className="has-checked:border-primary flex items-start gap-3 rounded-lg border p-3 text-sm"
              >
                <input
                  type="radio"
                  name="site"
                  value={s.id}
                  checked={site === s.id}
                  onChange={() => setSite(s.id)}
                  className="accent-primary mt-0.5 size-4"
                />
                <span>
                  <span className="block font-medium">{s.label}</span>
                  <span className="text-muted-foreground block">
                    {s.line1}, {s.city}
                  </span>
                </span>
              </label>
            ))}
            <label className="has-checked:border-primary flex items-center gap-3 rounded-lg border p-3 text-sm">
              <input
                type="radio"
                name="site"
                value={NEW}
                checked={site === NEW}
                onChange={() => setSite(NEW)}
                className="accent-primary size-4"
              />
              <span className="font-medium">{t("newAddress")}</span>
            </label>
            <FieldError message={err("site_id")} />
            {site === NEW ? (
              <div className="grid gap-3 pt-2 sm:grid-cols-2">
                {(
                  [
                    ["line1", t("line1"), true, "street-address", "sm:col-span-2"],
                    ["line2", t("line2"), false, "address-line2", "sm:col-span-2"],
                    ["city", t("city"), true, "address-level2", ""],
                    ["postal_code", t("postal"), false, "postal-code", ""],
                    ["access_notes", t("access"), false, "off", "sm:col-span-2"],
                  ] as const
                ).map(([name, label, required, auto, span]) => (
                  <div key={name} className={`space-y-1.5 ${span}`}>
                    <Label htmlFor={`${id}-${name}`}>{label}</Label>
                    <Input
                      id={`${id}-${name}`}
                      name={name}
                      required={required}
                      autoComplete={auto}
                      aria-invalid={Boolean(err(`new_site.${name}`))}
                    />
                    <FieldError message={err(`new_site.${name}`)} />
                  </div>
                ))}
              </div>
            ) : null}
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">{t("when")}</legend>
            <p className="text-muted-foreground text-xs">{t("whenHint")}</p>
            {windows.map((w, i) => (
              <div key={w.key} className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
                <div className="min-w-36 flex-1 space-y-1.5">
                  <Label htmlFor={`${id}-date-${w.key}`}>
                    {t("day")} <span className="sr-only">{t("time", { n: i + 1 })}</span>
                  </Label>
                  <Input
                    id={`${id}-date-${w.key}`}
                    type="date"
                    min={minDate}
                    max={maxDate}
                    value={w.date}
                    required
                    aria-invalid={Boolean(err(`windows.${i}.date`))}
                    onChange={(e) =>
                      setWindows(windows.map((x) => (x.key === w.key ? { ...x, date: e.target.value } : x)))
                    }
                  />
                </div>
                <div className="min-w-44 flex-1 space-y-1.5">
                  <Label htmlFor={`${id}-slot-${w.key}`}>
                    {t("slot")} <span className="sr-only">{t("time", { n: i + 1 })}</span>
                  </Label>
                  <NativeSelect
                    id={`${id}-slot-${w.key}`}
                    value={w.slot}
                    onChange={(e) =>
                      setWindows(
                        windows.map((x) =>
                          x.key === w.key ? { ...x, slot: e.target.value as PortalTimeSlot } : x,
                        ),
                      )
                    }
                  >
                    {PORTAL_TIME_SLOTS.map((s) => (
                      <option key={s} value={s}>
                        {t(`slots.${s}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                {windows.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("removeTime", { n: i + 1 })}
                    onClick={() => setWindows(windows.filter((x) => x.key !== w.key))}
                  >
                    <X aria-hidden />
                  </Button>
                ) : null}
                <FieldError message={err(`windows.${i}.date`)} />
              </div>
            ))}
            <FieldError message={err("windows")} />
            {windows.length < 3 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setWindows([
                    ...windows,
                    { key: Math.max(...windows.map((x) => x.key)) + 1, date: minDate, slot: "anytime" },
                  ])
                }
              >
                <Plus aria-hidden /> {t("addTime")}
              </Button>
            ) : null}
          </fieldset>

          <div className="space-y-2">
            <p className="text-sm font-medium" id={`${id}-photos`}>
              {t("photos")}
            </p>
            <p className="text-muted-foreground text-xs">{t("photosHint")}</p>
            {photos.length ? (
              <ul className="flex flex-wrap gap-2" aria-labelledby={`${id}-photos`}>
                {photos.map((p, i) => (
                  <li
                    key={`${p.name}-${i}`}
                    className="flex items-center gap-1 rounded-md border py-1 pr-1 pl-2 text-xs"
                  >
                    <span className="max-w-40 truncate">{p.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label={t("removePhoto", { name: p.name })}
                      onClick={() => setPhotos(photos.filter((_, k) => k !== i))}
                    >
                      <X aria-hidden className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            {photos.length < PORTAL_MAX_PHOTOS ? (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept={PORTAL_PHOTO_TYPES.join(",")}
                  multiple
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  data-testid="portal-photo-input"
                  onChange={(e) => {
                    addPhotos(e.target.files);
                    e.target.value = "";
                  }}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                  <ImagePlus aria-hidden /> {t("addPhotos")}
                </Button>
              </>
            ) : null}
          </div>

          {status ? (
            <p role="status" className="text-muted-foreground text-sm">
              {status}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button asChild variant="ghost">
              <Link href={`/portal/${slug}`}>{t("cancel")}</Link>
            </Button>
            <Button type="submit" disabled={pending} data-testid="portal-submit">
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t("submit")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
