import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";

/** The customer's signature captured on completion (JOB-10). */
export async function SignatureCard({
  url,
  signer,
  signedAt,
  timeZone,
}: {
  url: string | null;
  signer: string | null;
  signedAt: string;
  timeZone: string;
}) {
  const t = await getTranslations("fieldwork.signature");
  const locale = await getLocale();
  return (
    <Card data-testid="signature">
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {url ? (
          <img
            src={url}
            alt={t("imageAlt", { name: signer ?? t("customer") })}
            className="aspect-[3/1] w-full max-w-sm rounded-md border bg-white object-contain"
          />
        ) : null}
        <p className="text-sm">
          <span className="font-medium">{signer ?? t("customer")}</span>
          <span className="text-muted-foreground"> · {formatDateTime(signedAt, timeZone, locale)}</span>
        </p>
      </CardContent>
    </Card>
  );
}
