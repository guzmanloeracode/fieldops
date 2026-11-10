import { Repeat } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// The "Recurring" pill on jobs a maintenance plan created (JOB-13). Works in server and client components.

export function RecurringBadge({
  href,
  title,
  className,
}: {
  /** The plan, for roles that can open it. */
  href: string | null;
  title: string;
  className?: string;
}) {
  const t = useTranslations("recurrences");
  const style = cn(
    "inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-violet-800 ring-1 ring-violet-200 ring-inset dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-800",
    className,
  );
  const content = (
    <>
      <Repeat aria-hidden className="size-3" />
      {t("badge.label")}
      <span className="sr-only">: {title}</span>
    </>
  );
  return href ? (
    <Link
      href={href}
      prefetch={false}
      title={title}
      // At least 24 px tall: a pointer target (WCAG 2.5.8).
      className={cn(style, "min-h-6 hover:underline")}
      data-testid="recurring-badge"
    >
      {content}
    </Link>
  ) : (
    <span title={title} className={style} data-testid="recurring-badge">
      {content}
    </span>
  );
}
