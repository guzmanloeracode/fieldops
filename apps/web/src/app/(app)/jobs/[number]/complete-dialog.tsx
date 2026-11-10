"use client";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { transitionJobAction } from "../actions";
import { captureSignatureAction } from "./fieldwork-actions";
import { SignaturePad, signatureBlob, type SignatureState } from "./signature-pad";
import { uploadToJob } from "./upload";

export interface CompletionInfo {
  requireSignature: boolean;
  /** The signature already captured, if any. */
  signedBy: string | null;
  /** Required checklist items that are still open. */
  missingItems: string[];
  /** Default signer: the customer's primary contact. */
  suggestedSigner: string | null;
}

/** Completing a job: open required checklist items block it; the customer signs here (JOB-08, JOB-10). */
export function CompleteDialog({
  jobId,
  version,
  info,
  onClose,
}: {
  jobId: string;
  version: number;
  info: CompletionInfo;
  onClose: () => void;
}) {
  const t = useTranslations("fieldwork.complete");
  const tj = useTranslations("jobs");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sig, setSig] = useState<SignatureState>({
    mode: "draw",
    name: info.suggestedSigner ?? "",
    hasInk: false,
  });
  const [error, setError] = useState<string | null>(null);
  const blocked = info.missingItems.length > 0;
  const needsSignature = info.requireSignature && !info.signedBy;
  const signing = !info.signedBy;
  const ready = sig.name.trim().length > 0 && (sig.mode === "type" || sig.hasInk);

  const complete = (withSignature: boolean) =>
    startTransition(async () => {
      setError(null);
      if (withSignature) {
        const name = sig.name.trim();
        const blob = await signatureBlob({ ...sig, name }, canvasRef.current);
        if (!blob || !name) {
          setError(t("signFirst"));
          return;
        }
        const up = await uploadToJob(jobId, new File([blob], "signature.png", { type: "image/png" }), {
          fileName: "signature.png",
          kind: "signature",
          caption: name,
          confirm: false,
          failedMessage: t("uploadFailed"),
        });
        if (!up.ok) {
          setError(up.message);
          return;
        }
        const captured = await captureSignatureAction(jobId, { attachment_id: up.attachmentId, signer_name: name });
        if (!captured.ok) {
          setError(captured.error.message);
          return;
        }
      }
      const r = await transitionJobAction(jobId, { to: "completed", reason: null, hold_reason: null }, version);
      if (!r.ok) {
        const missing = (r.error.details?.missing as string[] | undefined) ?? [];
        setError(missing.length ? `${r.error.message}: ${missing.join(", ")}` : r.error.message);
        router.refresh();
        return;
      }
      toast.success(tj("transition.done", { action: tj("transition.complete") }));
      onClose();
      router.refresh();
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{signing ? t("signHint") : t("confirmHint")}</DialogDescription>
        </DialogHeader>
        {blocked ? (
          <div role="alert" className="border-destructive/40 bg-destructive/5 rounded-md border p-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <TriangleAlert className="text-destructive size-4" aria-hidden /> {t("missingTitle")}
            </p>
            <ul className="mt-1 list-disc pl-6">
              {info.missingItems.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {info.signedBy ? (
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-green-700 dark:text-green-500" aria-hidden />
            {t("signedBy", { name: info.signedBy })}
          </p>
        ) : (
          <SignaturePad state={sig} onChange={setSig} canvasRef={canvasRef} />
        )}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tj("cancel")}
          </Button>
          {signing && !needsSignature ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending || blocked}
              data-testid="complete-without-signature"
              onClick={() => complete(false)}
            >
              {t("withoutSignature")}
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={pending || blocked || (signing && !ready)}
            data-testid="complete-confirm"
            onClick={() => complete(signing)}
          >
            {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
            {signing ? t("signAndComplete") : t("complete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
