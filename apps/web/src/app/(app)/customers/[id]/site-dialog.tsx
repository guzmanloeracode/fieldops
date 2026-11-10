"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { siteCreateSchema, type SiteDto } from "@fieldops/shared";
import { Loader2, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm, type Path } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createSiteAction, updateSiteAction } from "../actions";
import { SiteFields } from "../_components/site-fields";

type FormInput = z.input<typeof siteCreateSchema>;
type FormOutput = z.output<typeof siteCreateSchema>;
type SiteValues = Pick<SiteDto, "label" | "address" | "latitude" | "longitude" | "access_notes" | "onsite_contact_name" | "onsite_contact_phone">;

export function SiteDialog({ customerId, defaultCountry, site }: { customerId: string; defaultCountry: string; site?: SiteValues & { id: string } }) {
  const t = useTranslations("customers");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const defaults: FormInput = site
    ? {
        label: site.label,
        address: { ...site.address, line2: site.address.line2 ?? "", region: site.address.region ?? "", postal_code: site.address.postal_code ?? "" },
        latitude: site.latitude,
        longitude: site.longitude,
        access_notes: site.access_notes ?? "",
        onsite_contact_name: site.onsite_contact_name ?? "",
        onsite_contact_phone: site.onsite_contact_phone ?? "",
      }
    : {
        label: "",
        address: { line1: "", line2: "", city: "", region: "", postal_code: "", country: defaultCountry },
        latitude: null,
        longitude: null,
        access_notes: "",
        onsite_contact_name: "",
        onsite_contact_phone: "",
      };
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(siteCreateSchema), defaultValues: defaults });

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const res = site ? await updateSiteAction(customerId, site.id, values) : await createSiteAction(customerId, values);
      if (!res.ok) {
        for (const f of res.error.fields ?? []) form.setError(f.path as Path<FormInput>, { message: f.message });
        toast.error(res.error.message);
        return;
      }
      toast.success(site ? t("detail.siteUpdated") : t("detail.siteAdded"));
      setOpen(false);
      if (!site) form.reset(defaults);
      router.refresh();
    }),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {site ? (
          <Button variant="ghost" size="icon-sm" aria-label={`${t("detail.editSite")}: ${site.label}`}>
            <Pencil />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Plus /> {t("detail.addSite")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{site ? t("site.editTitle") : t("site.title")}</DialogTitle>
          <DialogDescription>{t("site.description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <SiteFields form={form} prefix="" idPrefix={site ? `site-${site.id}` : "new-site"} />
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null} {t("site.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
