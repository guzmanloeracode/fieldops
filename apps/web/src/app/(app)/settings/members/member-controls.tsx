"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { inviteSchema, type Role } from "@fieldops/shared";
import { Loader2, Send, Trash2, UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { FieldError } from "@/components/app/field-error";
import { NativeSelect } from "@/components/app/native-select";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  changeRoleAction,
  inviteMemberAction,
  removeMemberAction,
  resendInvitationAction,
  revokeInvitationAction,
} from "./actions";

type InviteInput = z.input<typeof inviteSchema>;
type InviteOutput = z.output<typeof inviteSchema>;

export function InviteForm({ roleLabels }: { roleLabels: Record<Role, string> }) {
  const t = useTranslations("settings.members");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<InviteInput, unknown, InviteOutput>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: "technician" },
  });
  const errors = form.formState.errors;
  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const res = await inviteMemberAction(values);
      if (!res.ok) {
        for (const f of res.error.fields ?? []) form.setError(f.path as "email" | "role", { message: f.message });
        toast.error(res.error.message);
        return;
      }
      toast.success(t("invited", { email: res.data.email }));
      form.reset({ email: "", role: values.role });
      router.refresh();
    }),
  );
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
      <div className="space-y-1.5">
        <Label htmlFor="invite-email">{t("email")}</Label>
        <Input id="invite-email" type="email" autoComplete="off" aria-invalid={Boolean(errors.email)} {...form.register("email")} />
        <FieldError message={errors.email?.message} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="invite-role">{t("role")}</Label>
        <NativeSelect id="invite-role" {...form.register("role")}>
          {(["admin", "dispatcher", "technician"] as const).map((r) => (
            <option key={r} value={r}>
              {roleLabels[r]}
            </option>
          ))}
        </NativeSelect>
        <FieldError message={errors.role?.message} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Send />} {t("sendInvite")}
      </Button>
    </form>
  );
}

export function RoleSelect({
  memberId,
  name,
  role,
  options,
  disabled,
}: {
  memberId: string;
  name: string;
  role: Role;
  options: { value: Role; label: string }[];
  disabled: boolean;
}) {
  const t = useTranslations("settings.members");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (disabled) return <span className="text-sm">{options.find((o) => o.value === role)?.label ?? role}</span>;
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={`role-${memberId}`} className="sr-only">
        {t("changeRole", { name })}
      </Label>
      <NativeSelect
        id={`role-${memberId}`}
        defaultValue={role}
        disabled={pending}
        className="w-40"
        onChange={(e) => {
          const next = e.currentTarget.value;
          const select = e.currentTarget;
          startTransition(async () => {
            const res = await changeRoleAction(memberId, next);
            if (!res.ok) {
              select.value = role;
              toast.error(res.error.message);
              return;
            }
            toast.success(t("roleChanged"));
            router.refresh();
          });
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
      {pending ? <Loader2 aria-hidden className="text-muted-foreground size-4 animate-spin" /> : null}
    </div>
  );
}

export function RemoveButton({ memberId, name }: { memberId: string; name: string }) {
  const t = useTranslations("settings.members");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("removeLabel", { name })}>
          <UserMinus />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("removeTitle", { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("removeBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className="bg-destructive hover:bg-destructive/90 text-white"
            onClick={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const res = await removeMemberAction(memberId);
                if (!res.ok) {
                  toast.error(res.error.message);
                  return;
                }
                toast.success(t("removed"));
                router.refresh();
              });
            }}
          >
            {t("removeConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function InvitationActions({ invitationId, email }: { invitationId: string; email: string }) {
  const t = useTranslations("settings.members");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, success: string) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error?.message ?? "Error");
        return;
      }
      toast.success(success);
      router.refresh();
    });
  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => resendInvitationAction(invitationId), t("resent"))}>
        <Send /> {t("resend")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={t("revokeLabel", { email })}
        onClick={() => run(() => revokeInvitationAction(invitationId), t("revoked"))}
      >
        <Trash2 /> {t("revoke")}
      </Button>
    </div>
  );
}
