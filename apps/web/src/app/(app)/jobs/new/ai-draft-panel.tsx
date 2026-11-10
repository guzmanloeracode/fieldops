"use client";
import { MAX_INTAKE_PHOTOS } from "@fieldops/shared";
import { ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { draftJobAction, type DraftView } from "./ai-actions";

/** AI availability for this member, from the page (SET-04). */
export interface AiIntakeStatus {
  available: boolean;
  reason: "disabled" | "not_configured" | "quota" | null;
  used: number;
  limit: number;
}

type Photo = { name: string; previewUrl: string; media_type: "image/jpeg"; data: string };

/** Photos are downsized in the browser to 1024 px JPEG, so three fit in one request (and cost fewer tokens). */
async function toJpeg(file: File, maxSide = 1024): Promise<Photo> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
  return { name: file.name, previewUrl: dataUrl, media_type: "image/jpeg", data: dataUrl.split(",")[1]! };
}

/**
 * The "AI draft" panel on the new job form (AI-01). It sends the message and photos to the server, which drafts
 * the job; the form below is then prefilled and the dispatcher checks every field before saving (§9.1).
 */
export function AiDraftPanel({
  status,
  draft,
  keptChecklist,
  onKeptChecklist,
  onDraft,
  onClear,
}: {
  status: AiIntakeStatus;
  draft: DraftView | null;
  keptChecklist: string[];
  onKeptChecklist: (items: string[]) => void;
  onDraft: (d: DraftView) => void;
  onClear: () => void;
}) {
  const t = useTranslations("ai.intake");
  const ids = { message: useId(), photos: useId(), result: useId() };
  const [message, setMessage] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [used, setUsed] = useState(status.used);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  if (!status.available) {
    return (
      <Card data-testid="ai-panel" className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4" aria-hidden /> {t("title")}
          </CardTitle>
          <CardDescription data-testid="ai-unavailable">
            {t(`unavailable.${status.reason ?? "not_configured"}`)}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const room = MAX_INTAKE_PHOTOS - photos.length;
    const picked = [...files].filter((f) => f.type.startsWith("image/")).slice(0, room);
    if (files.length > room) toast.info(t("photoLimit", { max: MAX_INTAKE_PHOTOS }));
    const loaded: Photo[] = [];
    for (const f of picked) {
      try {
        loaded.push(await toJpeg(f));
      } catch {
        toast.error(t("photoUnreadable", { name: f.name }));
      }
    }
    setPhotos((p) => [...p, ...loaded]);
    if (fileInput.current) fileInput.current.value = "";
  };

  const submit = () => {
    setFailure(null);
    startTransition(async () => {
      const r = await draftJobAction({
        message,
        photos: photos.map((p) => ({ media_type: p.media_type, data: p.data })),
      });
      if (!r.ok) {
        setFailure(r.error.message);
        return;
      }
      setUsed(r.data.quota.used);
      if (r.data.status !== "drafted") {
        setFailure(t(r.data.status === "refused" ? "refused" : "failed"));
        return;
      }
      onDraft(r.data);
    });
  };

  return (
    <Card data-testid="ai-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4" aria-hidden /> {t("title")}
          <Badge variant="secondary">{t("badge")}</Badge>
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {draft ? (
          <div
            id={ids.result}
            role="status"
            data-testid="ai-result"
            className="space-y-3 rounded-lg border border-violet-300 bg-violet-50 p-4 text-sm text-violet-950 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-50"
          >
            <p className="font-medium">{t("applied")}</p>
            {draft.draft?.priority_reason ? (
              <p>
                <span className="font-medium">{t("priorityReason")}</span> {draft.draft.priority_reason}
              </p>
            ) : null}
            {draft.draft?.questions.length ? (
              <div>
                <p className="font-medium">{t("questions")}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5" data-testid="ai-questions">
                  {draft.draft.questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {draft.draft?.checklist.length ? (
              <fieldset>
                <legend className="font-medium">{t("checklist")}</legend>
                <div className="mt-1 space-y-1">
                  {draft.draft.checklist.map((item) => (
                    <label key={item} className="flex items-center gap-2">
                      <Checkbox
                        checked={keptChecklist.includes(item)}
                        onCheckedChange={(v) =>
                          onKeptChecklist(
                            v ? [...keptChecklist, item] : keptChecklist.filter((x) => x !== item),
                          )
                        }
                      />
                      {item}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={onClear} data-testid="ai-clear">
              <X aria-hidden /> {t("clear")}
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor={ids.message}>{t("message")}</Label>
              <Textarea
                id={ids.message}
                rows={5}
                maxLength={4000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("messagePlaceholder")}
                data-testid="ai-message"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={ids.photos}>{t("photos", { max: MAX_INTAKE_PHOTOS })}</Label>
              <div className="flex flex-wrap items-center gap-2">
                {photos.map((p, i) => (
                  <div key={`${p.name}-${i}`} className="relative">
                    <img src={p.previewUrl} alt={p.name} className="size-16 rounded-md border object-cover" />
                    <button
                      type="button"
                      className="bg-background absolute -top-2 -right-2 rounded-full border p-0.5"
                      onClick={() => setPhotos((list) => list.filter((_, j) => j !== i))}
                      aria-label={t("removePhoto", { name: p.name })}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
                {photos.length < MAX_INTAKE_PHOTOS ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInput.current?.click()}
                  >
                    <ImagePlus aria-hidden /> {t("addPhotos")}
                  </Button>
                ) : null}
                <input
                  ref={fileInput}
                  id={ids.photos}
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(e) => void addPhotos(e.target.files)}
                />
              </div>
            </div>
            {failure ? (
              <p role="alert" className="text-destructive text-sm" data-testid="ai-failure">
                {failure}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">{t("quota", { used, limit: status.limit })}</p>
              <Button
                type="button"
                onClick={submit}
                disabled={pending || message.trim().length < 10}
                data-testid="ai-draft"
              >
                {pending ? <Loader2 className="animate-spin" /> : <Sparkles aria-hidden />}
                {pending ? t("drafting") : t("draft")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
