import { WEBHOOK_TEST_EVENT } from "@fieldops/shared";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EVENTS_BY_GROUP, VERIFY_SNIPPET, sampleEnvelope } from "@/lib/webhook-samples";

/** How to verify a request, with a dependency-free Node.js receiver. */
export async function VerifyCard() {
  const t = await getTranslations("webhooks.verify");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">{t("headers")}</p>
        <details className="rounded-md border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{t("example")}</summary>
          <pre className="bg-muted overflow-x-auto rounded-b-md p-3 text-xs" tabIndex={0}>
            <code>{VERIFY_SNIPPET}</code>
          </pre>
        </details>
      </CardContent>
    </Card>
  );
}

/** Every event FieldOps sends, grouped by record, with a sample body. */
export async function EventCatalog() {
  const t = await getTranslations("webhooks");
  const types = [...EVENTS_BY_GROUP.flatMap((g) => g.types), WEBHOOK_TEST_EVENT] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle id="webhook-events">{t("catalog.title")}</CardTitle>
        <CardDescription>{t("catalog.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-md border" aria-labelledby="webhook-events">
          {types.map((type) => (
            <li key={type}>
              <details className="group">
                <summary className="flex cursor-pointer flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-baseline sm:gap-3">
                  <code className="text-sm font-medium">{type}</code>
                  <span className="text-muted-foreground text-sm">{t(`events.${type}`)}</span>
                </summary>
                <pre
                  className="bg-muted mx-3 mb-3 overflow-x-auto rounded-md p-3 text-xs"
                  aria-label={t("catalog.sample", { type })}
                  tabIndex={0}
                >
                  <code>{JSON.stringify(sampleEnvelope(type), null, 2)}</code>
                </pre>
              </details>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
