"use client";
import type { AttachmentTag } from "@fieldops/shared";
import { Camera, FileText, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { confirmUploadAction, removeAttachmentAction, requestUploadAction } from "../actions";

type Item = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  tag: AttachmentTag | null;
  url: string | null;
  thumbUrl: string | null;
  uploadedBy: string | null;
};

/** Resizes an image in the browser to a small WebP thumbnail, so the server never processes images. */
async function makeThumbnail(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/webp", 0.8));
  } catch {
    return null;
  }
}

/** Photos and documents upload straight to object storage through presigned URLs (JOB-06). */
export function Attachments({
  jobId,
  items,
  canUpload,
  actorUserId,
  canRemoveAny,
  storageReady,
}: {
  storageReady: boolean;
  jobId: string;
  items: Item[];
  canUpload: boolean;
  actorUserId: string;
  canRemoveAny: boolean;
}) {
  const t = useTranslations("jobs");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [tag, setTag] = useState<"none" | AttachmentTag>("none");
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const upload = async (files: FileList) => {
    setBusy(true);
    let done = 0;
    for (const file of Array.from(files)) {
      const isImage = file.type.startsWith("image/");
      const thumb = isImage ? await makeThumbnail(file) : null;
      const req = await requestUploadAction(jobId, {
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        kind: isImage ? "photo" : "document",
        tag: tag === "none" ? null : tag,
        with_thumbnail: Boolean(thumb),
      });
      if (!req.ok) {
        toast.error(`${file.name}: ${req.error.fields?.[0]?.message ?? req.error.message}`);
        continue;
      }
      const put = await fetch(req.data.uploadUrl, { method: "PUT", body: file, headers: req.data.headers });
      if (!put.ok) {
        toast.error(t("attachments.uploadFailed", { name: file.name }));
        continue;
      }
      if (thumb && req.data.thumbnailUploadUrl) {
        await fetch(req.data.thumbnailUploadUrl, {
          method: "PUT",
          body: thumb,
          headers: { "Content-Type": "image/webp" },
        });
      }
      const confirmed = await confirmUploadAction(req.data.attachmentId);
      if (confirmed.ok) done++;
      else toast.error(confirmed.error.message);
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    if (done) {
      toast.success(t("attachments.uploaded", { count: done }));
      router.refresh();
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">
          {t("attachments.title")} <span className="text-muted-foreground font-normal">({items.length})</span>
        </CardTitle>
        {canUpload ? (
          <div className="flex items-center gap-2">
            <Select value={tag} onValueChange={(v) => setTag(v as typeof tag)}>
              <SelectTrigger className="h-8 w-28" aria-label={t("attachments.tag")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("attachments.noTag")}</SelectItem>
                <SelectItem value="before">{t("attachments.before")}</SelectItem>
                <SelectItem value="after">{t("attachments.after")}</SelectItem>
              </SelectContent>
            </Select>
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              multiple
              className="sr-only"
              id="attachment-input"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => e.target.files?.length && void upload(e.target.files)}
            />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <Loader2 className="animate-spin" /> : <Camera />}
              {t("attachments.add")}
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {storageReady ? t("attachments.empty") : t("attachments.storageOff")}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {items.map((a) => (
              <li key={a.id} className="group relative overflow-hidden rounded-lg border">
                <a href={a.url ?? "#"} target="_blank" rel="noreferrer" className="block">
                  {a.mimeType.startsWith("image/") && (a.thumbUrl ?? a.url) ? (
                    <img
                      src={a.thumbUrl ?? a.url ?? ""}
                      alt={a.fileName}
                      className="aspect-[4/3] w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="bg-muted flex aspect-[4/3] items-center justify-center">
                      <FileText className="text-muted-foreground size-8" aria-hidden />
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-1 p-2 text-xs">
                    <span className="truncate">{a.fileName}</span>
                    {a.tag ? (
                      <span className="bg-secondary rounded px-1.5 py-0.5 font-medium capitalize">
                        {t(`attachments.${a.tag}`)}
                      </span>
                    ) : null}
                  </div>
                </a>
                {canRemoveAny || a.uploadedBy === actorUserId ? (
                  <Button
                    size="icon"
                    variant="secondary"
                    className="absolute top-1.5 right-1.5 size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={t("attachments.remove", { name: a.fileName })}
                    onClick={() =>
                      startTransition(async () => {
                        const r = await removeAttachmentAction(a.id);
                        if (!r.ok) toast.error(r.error.message);
                        else router.refresh();
                      })
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
