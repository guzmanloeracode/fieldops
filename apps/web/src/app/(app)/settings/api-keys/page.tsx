import { apiKeys } from "@fieldops/core";
import { MCP_PATH } from "@fieldops/shared";
import { BookOpen, KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/env";
import { formatDate, formatDateTime } from "@/lib/format";
import { requireActor, runService } from "@/server/context";
import { CodeBlock, CreateApiKeyDialog, RevokeApiKeyButton } from "./api-key-controls";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("apiKeys");
  return { title: t("pageTitle") };
}

/** API keys (PLT-02), the REST API's limits (PLT-04) and connecting an MCP client (PLT-05). Owners and admins. */
export default async function ApiKeysPage() {
  const actor = await requireActor();
  const t = await getTranslations("apiKeys");
  const locale = await getLocale();
  const tz = actor.organization.timezone;
  const now = new Date();
  const keys = await runService((ctx) => apiKeys.listApiKeys(ctx), actor);
  const base = env.APP_URL.replace(/\/$/, "");
  const mcpUrl = `${base}${MCP_PATH}`;
  const curl = `curl ${base}/api/v1/jobs?limit=5 \\\n  -H "Authorization: Bearer fo_…"`;
  const cli = `claude mcp add --transport http fieldops ${mcpUrl} \\\n  --header "Authorization: Bearer fo_…"`;
  const json = JSON.stringify(
    { mcpServers: { fieldops: { type: "http", url: mcpUrl, headers: { Authorization: "Bearer fo_…" } } } },
    null,
    2,
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>
              {t("description")}
              {env.DEMO_MODE ? ` ${t("demoNote")}` : null}
            </CardDescription>
          </div>
          <CreateApiKeyDialog baseUrl={base} />
        </CardHeader>
        <CardContent>
          {keys.length === 0 ? (
            <EmptyState icon={<KeyRound />} title={t("empty")} description={t("emptyHint")} />
          ) : (
            <ul aria-label={t("listLabel")} className="divide-y rounded-lg border" data-testid="api-key-list">
              {keys.map((k) => {
                const state = apiKeys.apiKeyState(k, now);
                return (
                  <li
                    key={k.id}
                    data-testid="api-key-row"
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{k.name}</span>
                        <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{k.prefix}…</code>
                        <Badge variant={state === "active" ? "secondary" : "outline"}>
                          {t(`state.${state}`)}
                        </Badge>
                        <Badge variant="outline">
                          {t(k.scopes.includes("write") ? "scope.write" : "scope.read")}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {[
                          t("createdBy", { name: k.memberName }),
                          t("createdAt", { date: formatDate(k.createdAt, tz, locale) }),
                          k.lastUsedAt
                            ? t("lastUsed", { date: formatDateTime(k.lastUsedAt, tz, locale) })
                            : t("neverUsed"),
                          k.revokedAt
                            ? t("revokedAt", { date: formatDate(k.revokedAt, tz, locale) })
                            : k.expiresAt
                              ? t(state === "expired" ? "expired" : "expires", {
                                  date: formatDate(k.expiresAt, tz, locale),
                                })
                              : t("noExpiry"),
                        ].join(" · ")}
                      </p>
                    </div>
                    {state === "active" ? <RevokeApiKeyButton id={k.id} name={k.name} /> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("rest.title")}</CardTitle>
          <CardDescription>{t("rest.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <CodeBlock code={curl} label={t("rest.title")} />
          <p className="text-muted-foreground text-sm">
            {env.API_KEY_RATE_LIMIT > 0
              ? t("rest.limits", { perKey: env.API_KEY_RATE_LIMIT })
              : t("rest.limitsOff")}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/docs/api" target="_blank" rel="noopener">
              <BookOpen /> {t("rest.reference")}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("mcp.title")}</CardTitle>
          <CardDescription>{t("mcp.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <h3 className="text-sm font-medium">{t("mcp.url")}</h3>
            <CodeBlock code={mcpUrl} label={t("mcp.url")} testId="mcp-url" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-sm font-medium">{t("mcp.cli")}</h3>
            <CodeBlock code={cli} label={t("mcp.cli")} />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-sm font-medium">{t("mcp.json")}</h3>
            <CodeBlock code={json} label={t("mcp.json")} />
          </div>
          <p className="text-muted-foreground text-sm">
            {t("mcp.tools")} {t("mcp.replace")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
