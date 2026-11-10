import { Faker, base, en, en_US, id_ID } from "@faker-js/faker";
import type { Tx } from "../client";
import type * as s from "../schema";
import type { OrgSpec } from "./data";

/** What the core seed produced for one organization, handed to the 0.2 seed extensions. */
export interface SeedContext {
  tx: Tx;
  orgId: string;
  spec: OrgSpec;
  now: Date;
  seed: number;
  timeZone: string;
  members: { id: string; userId: string; name: string; role: string; skills: string[] }[];
  serviceTypes: {
    id: string;
    name: string;
    defaultDurationMin: number;
    defaultPriceMinor: number;
    requiredSkills: string[];
    color: string | null;
    spec: OrgSpec["serviceTypes"][number];
  }[];
  customers: { id: string; name: string; commercial: boolean; createdAt: Date }[];
  sites: (typeof s.site.$inferInsert & { id: string; customerId: string })[];
  equipment: (typeof s.equipment.$inferInsert & { id: string; siteId: string })[];
  /** Every job with its timeline and assignees, numbered and already inserted. */
  jobs: (typeof s.job.$inferInsert & {
    id: string;
    number: number;
    events: (typeof s.jobEvent.$inferInsert)[];
    assignees: { memberId: string; isLead: boolean }[];
  })[];
}

/** A Faker for one extension: same locale as the organization, seeded from the org seed plus an offset. */
export function extensionFaker(ctx: SeedContext, offset: number): Faker {
  const f = new Faker({
    locale: ctx.spec.fakerLocale === "en_US" ? [en_US, en, base] : [id_ID, en, base],
  });
  f.seed(ctx.seed * 10 + offset);
  return f;
}
