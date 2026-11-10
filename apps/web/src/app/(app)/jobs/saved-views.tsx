"use client";
import { Bookmark, Loader2, Trash2, Users } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createViewAction, deleteViewAction } from "./insights-actions";

export interface ViewOption {
  id: string;
  name: string;
  query: string;
  shared: boolean;
  ownerName: string;
  canDelete: boolean;
}

/** Same filters, in any order, without paging. */
function sameQuery(a: string, b: string): boolean {
  const norm = (q: string) =>
    [...new URLSearchParams(q).entries()]
      .filter(([k, v]) => k !== "page" && v)
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join("&");
  return norm(a) === norm(b);
}

/** Saved views of the jobs table filters (JOB-04): apply, save the current filters, delete. */
export function SavedViews({ views, canShare }: { views: ViewOption[]; canShare: boolean }) {
  const t = useTranslations("insights.views");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [saveOpen, setSaveOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const current = params.toString();
  const active = current ? views.find((v) => sameQuery(v.query, current)) : undefined;

  const open = (v: ViewOption) => router.push(v.query ? `${pathname}?${v.query}` : pathname);

  const save = () =>
    startTransition(async () => {
      const res = await createViewAction({ name, query: current, shared });
      if (!res.ok) {
        setError(res.error.fields?.[0]?.message ?? res.error.message);
        return;
      }
      toast.success(t("savedToast"));
      setSaveOpen(false);
      setName("");
      setShared(false);
      setError(null);
      router.refresh();
    });

  const remove = (v: ViewOption) =>
    startTransition(async () => {
      const res = await deleteViewAction(v.id);
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success(t("deleted"));
      router.refresh();
    });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" data-testid="views-menu" className="max-w-56">
            <Bookmark />
            <span className="truncate">{active ? t("current", { name: active.name }) : t("menu")}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>{t("saved")}</DropdownMenuLabel>
          {views.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1.5 text-sm">{t("none")}</p>
          ) : (
            views.map((v) => (
              <DropdownMenuItem key={v.id} onSelect={() => open(v)} className="justify-between gap-2">
                <span className="truncate">{v.name}</span>
                {v.shared ? (
                  <Users aria-label={t("shared")} className="text-muted-foreground size-3.5" />
                ) : null}
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSaveOpen(true)} data-testid="views-save">
            {t("save")}
          </DropdownMenuItem>
          {views.length ? (
            <DropdownMenuItem onSelect={() => setManageOpen(true)}>{t("manage")}</DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("saveTitle")}</DialogTitle>
            <DialogDescription>{t("saveDescription")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="view-name">{t("name")}</Label>
              <Input
                id="view-name"
                value={name}
                maxLength={60}
                required
                onChange={(e) => setName(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "view-name-error" : undefined}
              />
              {error ? (
                <p id="view-name-error" className="text-destructive text-sm">
                  {error}
                </p>
              ) : null}
            </div>
            {canShare ? (
              <div className="flex items-start gap-2">
                <Checkbox id="view-shared" checked={shared} onCheckedChange={(v) => setShared(v === true)} />
                <div className="grid gap-0.5">
                  <Label htmlFor="view-shared">{t("share")}</Label>
                  <p className="text-muted-foreground text-xs">{t("shareHint")}</p>
                </div>
              </div>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={pending || !name.trim()} data-testid="view-save-submit">
                {pending ? <Loader2 className="animate-spin" /> : null} {t("saveButton")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("manageTitle")}</DialogTitle>
            <DialogDescription>{t("manageDescription")}</DialogDescription>
          </DialogHeader>
          <ul className="divide-y">
            {views.map((v) => (
              <li key={v.id} className="flex items-center gap-2 py-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left text-sm font-medium hover:underline"
                  onClick={() => {
                    setManageOpen(false);
                    open(v);
                  }}
                >
                  <span className="block truncate">{v.name}</span>
                  <span className="text-muted-foreground block text-xs font-normal">
                    {t("by", { name: v.ownerName })}
                  </span>
                </button>
                {v.shared ? <Badge variant="secondary">{t("shared")}</Badge> : null}
                {v.canDelete ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("delete", { name: v.name })}
                    disabled={pending}
                    onClick={() => remove(v)}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
