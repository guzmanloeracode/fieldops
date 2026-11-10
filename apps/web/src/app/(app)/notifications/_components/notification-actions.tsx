"use client";
import { CheckCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markNotificationsReadAction } from "../actions";

export function MarkAllReadButton() {
  const t = useTranslations("notifications.page");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      data-testid="notifications-mark-all"
      onClick={() =>
        start(async () => {
          const res = await markNotificationsReadAction({ all: true });
          if (!res.ok) toast.error(res.error.message);
          router.refresh();
        })
      }
    >
      <CheckCheck /> {t("markAll")}
    </Button>
  );
}

export function MarkReadButton({ id, label }: { id: string; label: string }) {
  const t = useTranslations("notifications.page");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-label={`${t("markRead")}: ${label}`}
      onClick={() =>
        start(async () => {
          const res = await markNotificationsReadAction({ ids: [id] });
          if (!res.ok) toast.error(res.error.message);
          else toast.success(t("marked"));
          router.refresh();
        })
      }
    >
      {t("markRead")}
    </Button>
  );
}

/** A link to what the notification is about; following an unread one marks it as read. */
export function NotificationLink({
  id,
  href,
  unread,
  children,
}: {
  id: string;
  href: string;
  unread: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="hover:underline"
      onClick={() => {
        if (unread) void markNotificationsReadAction({ ids: [id] });
      }}
    >
      {children}
    </Link>
  );
}
