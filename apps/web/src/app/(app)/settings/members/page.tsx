import { canChangeRole, organization } from "@fieldops/core";
import { schema } from "@fieldops/db";
import { ROLES } from "@fieldops/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { env } from "@/env";
import { formatDate } from "@/lib/format";
import { requireActor, runService } from "@/server/context";
import { db } from "@/server/db";
import { InvitationActions, InviteForm, RemoveButton, RoleSelect } from "./member-controls";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.pageTitle");
  return { title: t("members") };
}

export default async function MembersPage() {
  const actor = await requireActor();
  const t = await getTranslations("settings.members");
  const locale = await getLocale();
  const tz = actor.organization.timezone;
  const [members, invitations] = await Promise.all([
    runService((ctx) => organization.listMembers(ctx), actor),
    db
      .select()
      .from(schema.invitation)
      .where(
        and(
          eq(schema.invitation.organizationId, actor.organizationId),
          eq(schema.invitation.status, "pending"),
        ),
      )
      .orderBy(desc(schema.invitation.createdAt)),
  ]);
  const now = Date.now();
  const roleLabels = Object.fromEntries(ROLES.map((r) => [r, t(`roles.${r}`)])) as Record<
    (typeof ROLES)[number],
    string
  >;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("invite")}</CardTitle>
          <CardDescription>
            {t("inviteDescription")} {env.DEMO_MODE ? t("demoHint") : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InviteForm roleLabels={roleLabels} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.role")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("columns.joined")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("remove")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const self = m.id === actor.memberId;
                const assignable = ROLES.filter((r) => r === m.role || canChangeRole(actor, m.role, r));
                const locked = (env.DEMO_MODE && m.isDemo) || assignable.length <= 1;
                return (
                  <TableRow key={m.id}>
                    <TableCell className="max-w-64">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        <span className="truncate">{m.name}</span>
                        {self ? <Badge variant="secondary">{t("you")}</Badge> : null}
                        {env.DEMO_MODE && m.isDemo ? (
                          <Badge variant="outline" className="font-normal">
                            {t("demoAccount")}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">{m.email}</span>
                    </TableCell>
                    <TableCell>
                      <RoleSelect
                        memberId={m.id}
                        name={m.name}
                        role={m.role}
                        options={assignable.map((r) => ({ value: r, label: roleLabels[r] }))}
                        disabled={locked}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden text-sm sm:table-cell">
                      {formatDate(m.createdAt, tz, locale)}
                    </TableCell>
                    <TableCell className="text-right">
                      {!self &&
                      !(env.DEMO_MODE && m.isDemo) &&
                      (m.role !== "owner" || actor.role === "owner") ? (
                        <RemoveButton memberId={m.id} name={m.name} />
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("pending")}</CardTitle>
        </CardHeader>
        <CardContent>
          {invitations.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noPending")}</p>
          ) : (
            <ul className="divide-y">
              {invitations.map((inv) => {
                const expired = inv.expiresAt ? inv.expiresAt.getTime() < now : false;
                return (
                  <li
                    key={inv.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{inv.email}</p>
                      <p className="text-muted-foreground text-xs">
                        {roleLabels[inv.role as keyof typeof roleLabels] ?? inv.role} ·{" "}
                        {expired
                          ? t("expired")
                          : t("expires", { date: formatDate(inv.expiresAt, tz, locale) })}
                      </p>
                    </div>
                    <InvitationActions invitationId={inv.id} email={inv.email} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
