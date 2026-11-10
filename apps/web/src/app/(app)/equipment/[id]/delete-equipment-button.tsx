"use client";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { deleteEquipmentAction } from "@/app/(app)/customers/equipment-actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function DeleteEquipmentButton({
  id,
  customerId,
  name,
}: {
  id: string;
  customerId: string;
  name: string;
}) {
  const t = useTranslations("insights.equipment");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" className="text-destructive hover:text-destructive">
          <Trash2 /> {t("delete")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deleteTitle", { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("deleteDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className="bg-destructive hover:bg-destructive/90 text-white"
            onClick={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const res = await deleteEquipmentAction(customerId, id);
                if (!res.ok) {
                  toast.error(res.error.message);
                  return;
                }
                toast.success(t("deleted"));
                router.push(`/customers/${customerId}`);
              });
            }}
          >
            {t("delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
