import { Briefcase, HardHat, LineChart } from "lucide-react";
import { demoSignIn } from "@/app/(auth)/_actions/demo";
import { Button } from "@/components/ui/button";

const ROLES = [
  { role: "owner", label: "Owner", hint: "Dashboard, settings, approvals", icon: LineChart },
  { role: "dispatcher", label: "Dispatcher", hint: "Jobs, customers, scheduling", icon: Briefcase },
  { role: "technician", label: "Technician", hint: "My day on a phone screen", icon: HardHat },
] as const;

export function DemoSignIn({ org = "acme-air", compact = false }: { org?: "acme-air" | "acme-teknik"; compact?: boolean }) {
  return (
    <div className={compact ? "grid gap-2 sm:grid-cols-3" : "grid gap-2"}>
      {ROLES.map(({ role, label, hint, icon: Icon }) => (
        <form key={role} action={demoSignIn}>
          <input type="hidden" name="org" value={org} />
          <input type="hidden" name="role" value={role} />
          <Button type="submit" variant="outline" className="h-auto w-full justify-start gap-3 py-3 text-left" data-testid={`demo-${role}`}>
            <Icon className="text-primary size-5 shrink-0" aria-hidden />
            <span className="min-w-0">
              <span className="block font-medium">Sign in as {label}</span>
              {!compact ? <span className="text-muted-foreground block text-xs font-normal">{hint}</span> : null}
            </span>
          </Button>
        </form>
      ))}
    </div>
  );
}
