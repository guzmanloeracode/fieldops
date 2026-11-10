import { Briefcase, HardHat, LineChart } from "lucide-react";
import { useTranslations } from "next-intl";
import { demoSignIn } from "@/app/(auth)/_actions/demo";
import { Button } from "@/components/ui/button";

const ROLES = [
  { role: "owner", icon: LineChart },
  { role: "dispatcher", icon: Briefcase },
  { role: "technician", icon: HardHat },
] as const;

export function DemoSignIn({
  org = "acme-air",
  compact = false,
}: {
  org?: "acme-air" | "acme-teknik";
  compact?: boolean;
}) {
  const t = useTranslations("auth.demo");
  const tRole = useTranslations("common.role");
  return (
    <div className={compact ? "grid gap-2 sm:grid-cols-3" : "grid gap-2"}>
      {ROLES.map(({ role, icon: Icon }) => (
        <form key={role} action={demoSignIn}>
          <input type="hidden" name="org" value={org} />
          <input type="hidden" name="role" value={role} />
          <Button
            type="submit"
            variant="outline"
            className="h-auto w-full justify-start gap-3 py-3 text-left"
            data-testid={`demo-${role}`}
          >
            <Icon className="text-primary size-5 shrink-0" aria-hidden />
            <span className="min-w-0">
              <span className="block font-medium">{t("signInAs", { role: tRole(role) })}</span>
              {!compact ? (
                <span className="text-muted-foreground block text-xs font-normal">{t(`hint.${role}`)}</span>
              ) : null}
            </span>
          </Button>
        </form>
      ))}
    </div>
  );
}
