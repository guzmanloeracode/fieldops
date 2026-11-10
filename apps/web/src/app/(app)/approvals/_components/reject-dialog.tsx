"use client";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FieldError } from "@/components/app/field-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Asks for the comment a rejection needs (EXP-02). */
export function RejectDialog({
  open,
  count,
  pending,
  onOpenChange,
  onReject,
}: {
  open: boolean;
  count: number;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onReject: (comment: string) => void;
}) {
  const t = useTranslations("expenses.rejectDialog");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | undefined>();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setComment("");
          setError(undefined);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{count > 1 ? t("titleMany", { count }) : t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!comment.trim()) {
              setError(t("commentRequired"));
              return;
            }
            onReject(comment.trim());
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="reject-comment">{t("comment")}</Label>
            <Textarea
              id="reject-comment"
              value={comment}
              maxLength={500}
              placeholder={t("commentPlaceholder")}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "reject-comment-error" : undefined}
              onChange={(e) => setComment(e.target.value)}
            />
            <FieldError id="reject-comment-error" message={error} />
          </div>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={pending} data-testid="reject-confirm">
              {pending ? <Loader2 className="animate-spin" /> : null}
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
