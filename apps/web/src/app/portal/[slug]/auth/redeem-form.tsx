"use client";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { redeemPortalLinkAction } from "../actions";

export function RedeemForm({ slug, token }: { slug: string; token: string }) {
  const t = useTranslations("portal.auth");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <Button
        className="w-full"
        disabled={pending}
        data-testid="portal-continue"
        onClick={() =>
          startTransition(async () => {
            const r = await redeemPortalLinkAction(slug, token);
            if (r && !r.ok) setError(r.message);
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {t("continue")}
      </Button>
    </div>
  );
}
