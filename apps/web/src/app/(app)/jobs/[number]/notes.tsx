"use client";
import type { NoteVisibility } from "@fieldops/shared";
import { Eye, Loader2, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import { addNoteAction } from "../actions";

type Note = {
  id: string;
  body: string;
  visibility: NoteVisibility;
  author: string | null;
  createdAt: string;
};

/** Internal notes stay inside the team; customer-visible notes appear in the portal and reports (JOB-07). */
export function Notes({
  jobId,
  notes,
  canAdd,
  timeZone,
}: {
  jobId: string;
  notes: Note[];
  canAdd: boolean;
  timeZone: string;
}) {
  const t = useTranslations("jobs");
  const router = useRouter();
  const [body, setBody] = useState("");
  const [customerVisible, setCustomerVisible] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t("notes.title")} <span className="text-muted-foreground font-normal">({notes.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canAdd ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!body.trim()) return;
              // Clear the form right away (restored on failure), so a late reset can't wipe the next note.
              const draft = { body, visibility: customerVisible ? "customer" : "internal" } as const;
              setBody("");
              setCustomerVisible(false);
              startTransition(async () => {
                const r = await addNoteAction(jobId, draft);
                if (!r.ok) {
                  setBody(draft.body);
                  setCustomerVisible(draft.visibility === "customer");
                  toast.error(r.error.message);
                  return;
                }
                router.refresh();
              });
            }}
          >
            <Label htmlFor="note" className="sr-only">
              {t("notes.add")}
            </Label>
            <Textarea
              id="note"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("notes.placeholder")}
              rows={3}
              maxLength={8000}
            />
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={customerVisible} onCheckedChange={setCustomerVisible} />
                {t("notes.customerVisible")}
              </label>
              <Button type="submit" size="sm" disabled={pending || !body.trim()}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                {t("notes.add")}
              </Button>
            </div>
          </form>
        ) : null}
        {notes.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("notes.empty")}</p>
        ) : (
          <ul className="space-y-3">
            {notes.map((n) => (
              <li key={n.id} className="rounded-lg border p-3">
                <div className="text-muted-foreground mb-1 flex flex-wrap items-center gap-x-2 text-xs">
                  <span className="text-foreground font-medium">{n.author ?? t("notes.unknown")}</span>
                  <span>{formatDateTime(n.createdAt, timeZone)}</span>
                  <span className="ml-auto inline-flex items-center gap-1">
                    {n.visibility === "customer" ? (
                      <Eye className="size-3" aria-hidden />
                    ) : (
                      <Lock className="size-3" aria-hidden />
                    )}
                    {n.visibility === "customer" ? t("notes.visibleToCustomer") : t("notes.internal")}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-line">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
