import type { Store } from "@fieldops/core";
import { withTenant, type Database, type Tx } from "./client";
import { customerRepo } from "./repos/customers";
import { checklistRepo, timeEntryRepo } from "./repos/fieldwork";
import { jobRepo } from "./repos/jobs";
import { attachmentRepo, noteRepo } from "./repos/notes";
import { memberRepo, organizationRepo, serviceTypeRepo } from "./repos/organization";
import { equipmentRepo, siteRepo } from "./repos/sites";

/** Builds the repositories for one organization on top of an open transaction. */
export function createStore(tx: Tx, organizationId: string): Store {
  return {
    organizationId,
    customers: customerRepo(tx, organizationId),
    sites: siteRepo(tx, organizationId),
    equipment: equipmentRepo(tx, organizationId),
    serviceTypes: serviceTypeRepo(tx, organizationId),
    jobs: jobRepo(tx, organizationId),
    notes: noteRepo(tx, organizationId),
    attachments: attachmentRepo(tx, organizationId),
    members: memberRepo(tx, organizationId),
    organization: organizationRepo(tx, organizationId),
    checklist: checklistRepo(tx, organizationId),
    timeEntries: timeEntryRepo(tx, organizationId),
  };
}

/** Opens a tenant transaction (RLS scoped) and hands the repositories to `fn`. */
export function withStore<T>(
  db: Database,
  organizationId: string,
  fn: (store: Store, tx: Tx) => Promise<T>,
): Promise<T> {
  return withTenant(db, organizationId, (tx) => fn(createStore(tx, organizationId), tx));
}
