"use client";
import type { NotificationDto } from "@fieldops/shared";
import { Bell, Settings } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { markNotificationsReadAction, recentNotificationsAction } from "@/app/(app)/notifications/actions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatRelative } from "@/lib/format";
import { describeNotification } from "@/lib/notification-text";
import { cn } from "@/lib/utils";
import { useLiveEvents } from "./live-events";

/**
 * The notification center in the header (NOT-01): an unread badge kept current by live events (NOT-05), the
 * latest notifications in a popover, deep links, and mark as read.
 */
export function NotificationBell({
  initialUnread,
  timeZone,
  announce = true,
  className,
}: {
  initialUnread: number;
  timeZone: string;
  /** Only one bell per page announces arrivals (the layout renders one for phones and one for desktops). */
  announce?: boolean;
  className?: string;
}) {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();
  const newest = useRef<string | null>(null);

  const load = useCallback(
    async (announce: boolean) => {
      const res = await recentNotificationsAction();
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setItems(res.data.items);
      setUnread(res.data.unread);
      const first = res.data.items[0];
      // Announce a new arrival once (the toast region is polite and never takes focus).
      if (announce && first && !first.read_at && first.id !== newest.current) {
        const text = describeNotification(t, first, timeZone, locale);
        toast.info(text.title, {
          description: text.detail ?? undefined,
          action: { label: t("page.title"), onClick: () => setOpen(true) },
        });
      }
      newest.current = first?.id ?? newest.current;
    },
    [t, timeZone, locale],
  );

  useLiveEvents(["notification"], (m) => {
    startTransition(() => load(announce && m.kind === "notification"));
  });

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) startTransition(() => load(false));
  };

  const markAll = () =>
    startTransition(async () => {
      const res = await markNotificationsReadAction({ all: true });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      setUnread(res.data.unread);
      setItems(
        (prev) => prev?.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })) ?? prev,
      );
    });

  const follow = (n: NotificationDto) => {
    setOpen(false);
    if (n.read_at) return;
    setUnread((u) => Math.max(0, u - 1));
    setItems(
      (prev) => prev?.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ?? prev,
    );
    void markNotificationsReadAction({ ids: [n.id] });
  };

  const badge = unread > 99 ? "99+" : String(unread);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative shrink-0", className)}
          aria-label={unread > 0 ? t("bell.labelUnread", { count: unread }) : t("bell.label")}
          data-testid="notification-bell"
        >
          <Bell />
          {unread > 0 ? (
            <span
              aria-hidden
              data-testid="notification-count"
              className="bg-destructive absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold text-white"
            >
              {badge}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(24rem,calc(100vw-2rem))] p-0"
        data-testid="notification-popover"
      >
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">{t("bell.title")}</h2>
          <div className="flex items-center gap-1">
            {unread > 0 ? (
              <Button variant="ghost" size="sm" onClick={markAll} data-testid="notification-mark-all">
                {t("bell.markAll")}
              </Button>
            ) : null}
            <Button variant="ghost" size="icon" className="size-8" asChild>
              <Link
                href="/notifications/preferences"
                aria-label={t("bell.settings")}
                title={t("bell.settings")}
                onClick={() => setOpen(false)}
              >
                <Settings />
              </Link>
            </Button>
          </div>
        </div>
        <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
          {items === null ? (
            <p className="text-muted-foreground px-4 py-6 text-sm" role="status">
              {failed ? t("bell.error") : t("bell.loading")}
            </p>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">{t("bell.empty")}</p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const text = describeNotification(t, n, timeZone, locale);
                return (
                  <li key={n.id}>
                    <Link
                      href={n.href}
                      onClick={() => follow(n)}
                      className="hover:bg-muted/60 focus-visible:bg-muted/60 flex gap-3 px-4 py-3 outline-none"
                      data-testid="notification-item"
                      data-unread={n.read_at ? undefined : "true"}
                    >
                      <span
                        className={cn(
                          "mt-1.5 size-2 shrink-0 rounded-full",
                          n.read_at ? "bg-transparent" : "bg-primary",
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-sm", !n.read_at && "font-semibold")}>
                          {!n.read_at ? <span className="sr-only">{t("page.unreadDot")}: </span> : null}
                          {text.title}
                        </span>
                        {text.detail ? (
                          <span className="text-muted-foreground block truncate text-xs">{text.detail}</span>
                        ) : null}
                        <span className="text-muted-foreground block text-xs">
                          {formatRelative(n.created_at, locale)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t p-1.5">
          <Button variant="ghost" size="sm" className="w-full" asChild>
            <Link href="/notifications" onClick={() => setOpen(false)}>
              {t("bell.viewAll")}
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
