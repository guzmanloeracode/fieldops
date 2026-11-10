import { expenses, ROLE_LABELS } from "@fieldops/core";
import Link from "next/link";
import { CommandPalette, SearchButton } from "@/components/app/command-palette";
import { Logo } from "@/components/app/logo";
import { MobileNav } from "@/components/app/mobile-nav";
import { Nav } from "@/components/app/nav";
import { UserMenu } from "@/components/app/user-menu";
import { env } from "@/env";
import { requireActor, runService } from "@/server/context";
import { listMemberships } from "@/server/memberships";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const [memberships, pendingApprovals] = await Promise.all([
    listMemberships(actor.userId),
    // Pending approvals badge (EXP-03): one count query, zero for people who can't approve.
    runService((ctx) => expenses.countPendingExpenses(ctx), actor),
  ]);
  const counts = { "/approvals": pendingApprovals };
  const userMenu = (
    <UserMenu
      name={actor.name}
      email={actor.email}
      roleLabel={`${ROLE_LABELS[actor.role]} · ${actor.organization.name}`}
      organizations={memberships.map((m) => ({ id: m.organizationId, name: m.name, role: m.role }))}
      activeOrganizationId={actor.organizationId}
      canCreateOrganization={!actor.isDemoUser}
    />
  );
  const orgHeader = (
    <Link href="/dashboard" className="flex items-center gap-2.5">
      <Logo />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{actor.organization.name}</span>
        <span className="text-muted-foreground block text-xs">FieldOps</span>
      </span>
    </Link>
  );
  return (
    <div className="flex min-h-dvh flex-col">
      {env.DEMO_MODE ? (
        <div className="bg-primary text-primary-foreground flex flex-wrap items-center justify-center gap-x-3 px-4 py-1.5 text-center text-xs">
          <span>Public demo with fictional data. Demo data resets daily at 00:00 UTC.</span>
          <span>
            v{env.APP_VERSION} · {env.APP_COMMIT.slice(0, 7)}
          </span>
        </div>
      ) : null}
      <div className="flex flex-1">
        <aside className="bg-sidebar border-sidebar-border sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 border-r p-4 lg:flex">
          {orgHeader}
          <SearchButton />
          <Nav role={actor.role} counts={counts} />
          {userMenu}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="bg-background/90 sticky top-0 z-30 flex items-center gap-2 border-b px-4 py-2 backdrop-blur lg:hidden">
            <MobileNav role={actor.role} header={orgHeader} counts={counts} footer={userMenu} />
            {orgHeader}
            <SearchButton compact className="ml-auto" />
          </header>
          <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>
      <CommandPalette role={actor.role} />
    </div>
  );
}
