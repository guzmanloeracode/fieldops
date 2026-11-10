import { and, asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import * as s from "../schema";
import type { SeedContext } from "./context";
import { DEMO_LOGINS } from "./data";
import { DAY } from "./time";

/** Shared views of the jobs table every office member sees (JOB-04). */
const SHARED_VIEWS = {
  "acme-air": [
    {
      name: "Urgent and open",
      query: "status=new%2Cscheduled%2Cen_route%2Cin_progress%2Con_hold&priority=urgent",
    },
    { name: "Waiting for parts", query: "status=on_hold&sort=-created_at" },
    { name: "Unassigned", query: "status=new&unassigned=true&sort=-priority" },
    { name: "Needed a second visit", query: "status=completed&revisit=true&sort=-created_at" },
  ],
  "acme-teknik": [
    {
      name: "Mendesak dan terbuka",
      query: "status=new%2Cscheduled%2Cen_route%2Cin_progress%2Con_hold&priority=urgent",
    },
    { name: "Menunggu suku cadang", query: "status=on_hold&sort=-created_at" },
    { name: "Belum ditugaskan", query: "status=new&unassigned=true&sort=-priority" },
    { name: "Perlu kunjungan ulang", query: "status=completed&revisit=true&sort=-created_at" },
  ],
} as const;

/**
 * Saved views, and a second membership for the demo owner (AUTH-06): Olivia of Acme Air is also an admin of
 * Acme Teknik Nusantara, so the organization switcher has something to show. Her Acme Air membership stays
 * the older one, so sign-in without an active organization still lands in Acme Air.
 */
export async function seedInsights(ctx: SeedContext): Promise<void> {
  const owner = ctx.members.find((m) => m.role === "owner") ?? ctx.members[0]!;
  const dispatcher = ctx.members.find((m) => m.role === "dispatcher") ?? owner;
  const views = SHARED_VIEWS[ctx.spec.key];
  await ctx.tx.insert(s.savedView).values(
    views.map((v, i) => ({
      organizationId: ctx.orgId,
      memberId: i % 2 === 0 ? dispatcher.id : owner.id,
      resource: "jobs",
      name: v.name,
      query: v.query,
      shared: true,
      createdAt: new Date(ctx.now.getTime() - (30 - i) * DAY),
    })),
  );

  if (ctx.spec.key !== "acme-teknik") return;
  const [olivia] = await ctx.tx
    .select({ userId: s.user.id, memberCreatedAt: s.member.createdAt })
    .from(s.user)
    .innerJoin(s.member, eq(s.member.userId, s.user.id))
    .where(and(eq(s.user.email, DEMO_LOGINS["acme-air"].owner)))
    .orderBy(asc(s.member.createdAt))
    .limit(1);
  if (!olivia) return;
  await ctx.tx.insert(s.member).values({
    id: uuidv7(),
    organizationId: ctx.orgId,
    userId: olivia.userId,
    role: "admin",
    createdAt: new Date(olivia.memberCreatedAt.getTime() + 60_000),
  });
}
