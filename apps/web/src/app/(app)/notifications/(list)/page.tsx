import { notifications } from "@fieldops/core";
import { Bell, Settings } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LiveRefresh } from "@/components/app/live-refresh";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatRelative } from "@/lib/format";
import { describeNotification } from "@/lib/notification-text";
import { cn } from "@/lib/utils";
import { toNotificationDto } from "@/server/api/serialize-notifications";
import { requireActor, runService } from "@/server/context";
import { MarkAllReadButton, MarkReadButton, NotificationLink } from "../_components/notification-actions";

const PAGE_SIZE = 25;

/** Every notification of the signed-in user, with an unread filter (NOT-01). */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const page = Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1);
  const unreadOnly = one(sp.filter) === "unread";
  const actor = await requireActor();
  const t = await getTranslations("notifications");
  const { list, unread } = await runService(async (ctx) => {
    const [list, unread] = await Promise.all([
      notifications.listNotifications(ctx, { page, limit: PAGE_SIZE, unread: unreadOnly }),
      notifications.countUnread(ctx),
    ]);
    return { list, unread };
  }, actor);
  const rows = list.rows.map(toNotificationDto);
  const href = (p: { page?: number; unread?: boolean }) => {
    const q = new URLSearchParams();
    if (p.unread ?? unreadOnly) q.set("filter", "unread");
    if (p.page && p.page > 1) q.set("page", String(p.page));
    const s = q.toString();
    return s ? `/notifications?${s}` : "/notifications";
  };

  return (
    <div>
      <LiveRefresh kinds={["notification"]} />
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
        actions={
          <>
            {unread > 0 ? <MarkAllReadButton /> : null}
            <Button variant="outline" asChild>
              <Link href="/notifications/preferences">
                <Settings /> {t("page.settings")}
              </Link>
            </Button>
          </>
        }
      />
      <nav aria-label={t("page.filter")} className="mb-4 flex gap-1">
        {[
          { label: t("page.all"), active: !unreadOnly, to: href({ unread: false }) },
          { label: `${t("page.unread")} (${unread})`, active: unreadOnly, to: href({ unread: true }) },
        ].map((f) => (
          <Button key={f.to} variant={f.active ? "secondary" : "ghost"} size="sm" asChild>
            <Link href={f.to} aria-current={f.active ? "page" : undefined}>
              {f.label}
            </Link>
          </Button>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState
          icon={<Bell />}
          title={unreadOnly ? t("page.emptyUnread") : t("page.empty")}
          description={t("page.description")}
        />
      ) : (
        <>
          <ul className="bg-card divide-y rounded-xl border" data-testid="notification-list">
            {rows.map((n) => {
              const text = describeNotification(t, n, actor.organization.timezone);
              const isUnread = !n.read_at;
              return (
                <li
                  key={n.id}
                  className="flex items-start gap-3 px-4 py-3"
                  data-testid="notification-row"
                  data-unread={isUnread ? "true" : undefined}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-2 size-2 shrink-0 rounded-full",
                      isUnread ? "bg-primary" : "bg-transparent",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", isUnread && "font-semibold")}>
                      {isUnread ? <span className="sr-only">{t("page.unreadDot")}: </span> : null}
                      <NotificationLink id={n.id} href={n.href} unread={isUnread}>
                        {text.title}
                      </NotificationLink>
                    </p>
                    {text.detail ? <p className="text-muted-foreground text-sm">{text.detail}</p> : null}
                    <p className="text-muted-foreground text-xs">
                      <time
                        dateTime={n.created_at}
                        title={formatDateTime(n.created_at, actor.organization.timezone)}
                      >
                        {formatRelative(n.created_at)}
                      </time>
                    </p>
                  </div>
                  {isUnread ? <MarkReadButton id={n.id} label={text.title} /> : null}
                </li>
              );
            })}
          </ul>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={list.total ?? rows.length}
            buildHref={(p) => href({ page: p })}
          />
        </>
      )}
    </div>
  );
}
