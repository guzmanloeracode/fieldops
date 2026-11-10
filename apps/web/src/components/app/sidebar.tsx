"use client";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";
import { cn } from "@/lib/utils";

const SidebarContext = createContext({ collapsed: false });

/** Whether the desktop sidebar is collapsed to icons (false everywhere else, e.g. the mobile menu). */
export function useSidebar() {
  return useContext(SidebarContext);
}

const editable = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/**
 * The desktop sidebar. It collapses to an icon rail and expands again with its button or Ctrl/⌘ B; the choice is
 * kept in a cookie. Children style themselves for the rail with `group-data-[collapsed=true]/sidebar:*`.
 */
export function Sidebar({
  defaultCollapsed,
  header,
  tools,
  footer,
  children,
}: {
  defaultCollapsed: boolean;
  header: React.ReactNode;
  tools: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("common.sidebar");
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const toggle = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  useEffect(() => {
    document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  }, [collapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "b" || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (editable(e.target)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const label = collapsed ? t("expand") : t("collapse");
  return (
    <SidebarContext.Provider value={{ collapsed }}>
      <aside
        id="app-sidebar"
        data-collapsed={collapsed}
        data-testid="app-sidebar"
        className={cn(
          "group/sidebar bg-sidebar border-sidebar-border sticky top-0 hidden h-dvh shrink-0 flex-col gap-6 overflow-x-hidden overflow-y-auto border-r py-4 lg:flex motion-safe:transition-[width] motion-safe:duration-200",
          collapsed ? "w-16 px-2" : "w-64 px-4",
        )}
      >
        <div className={cn("flex gap-1", collapsed ? "flex-col items-center gap-3" : "items-center")}>
          <div className={cn("min-w-0", !collapsed && "flex-1")}>{header}</div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={label}
            title={`${label} (Ctrl B)`}
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
            aria-keyshortcuts="Control+B Meta+B"
            data-testid="sidebar-toggle"
            className="text-muted-foreground shrink-0"
          >
            {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
          </Button>
        </div>
        <div className={cn("flex gap-1", collapsed ? "flex-col items-center" : "items-center")}>{tools}</div>
        {children}
        {footer}
      </aside>
    </SidebarContext.Provider>
  );
}
