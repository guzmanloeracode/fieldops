import type { Store } from "@fieldops/core";
import { withTenant, type Database, type Tx, type TxContext } from "./client";
import { customerRepo } from "./repos/customers";
import { expenseRepo } from "./repos/expenses";
import { dashboardRepo } from "./repos/dashboard";
import { searchRepo } from "./repos/search";
import { savedViewRepo } from "./repos/views";
import { checklistRepo, timeEntryRepo } from "./repos/fieldwork";
import { jobRepo } from "./repos/jobs";
import { attachmentRepo, noteRepo } from "./repos/notes";
import { memberRepo, organizationRepo, serviceTypeRepo } from "./repos/organization";
import { availabilityRepo, scheduleRepo } from "./repos/schedule";
import { equipmentRepo, siteRepo } from "./repos/sites";
import { aiRepo } from "./repos/ai";
import { auditRepo } from "./repos/audit";
import { notificationRepo } from "./repos/notifications";
import { portalRepo } from "./repos/portal";
import { slaRepo } from "./repos/sla";
import { billingRepo } from "./repos/billing";
import { reportRepo } from "./repos/reports";
import { digestRepo, recurrenceRepo } from "./repos/recurrences";
import { assistantRepo } from "./repos/assistant";
import { apiKeyRepo } from "./repos/api-keys";

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
    expenses: expenseRepo(tx, organizationId),
    // 0.2 insights
    dashboard: dashboardRepo(tx, organizationId),
    savedViews: savedViewRepo(tx, organizationId),
    search: searchRepo(tx, organizationId),
    checklist: checklistRepo(tx, organizationId),
    timeEntries: timeEntryRepo(tx, organizationId),
    availability: availabilityRepo(tx, organizationId),
    schedule: scheduleRepo(tx, organizationId),
    // 0.3 automate
    sla: slaRepo(tx, organizationId),
    notifications: notificationRepo(tx, organizationId),
    audit: auditRepo(tx, organizationId),
    portal: portalRepo(tx, organizationId),
    ai: aiRepo(tx, organizationId),
    // 0.4 get paid
    billing: billingRepo(tx, organizationId),
    reports: reportRepo(tx, organizationId),
    recurrences: recurrenceRepo(tx, organizationId),
    digest: digestRepo(tx, organizationId),
    assistant: assistantRepo(tx, organizationId),
    // 0.5 platform
    apiKeys: apiKeyRepo(tx, organizationId),
  };
}

/** Opens a tenant transaction (RLS scoped) and hands the repositories to `fn`. */
export function withStore<T>(
  db: Database,
  organizationId: string,
  fn: (store: Store, tx: Tx) => Promise<T>,
  context?: TxContext,
): Promise<T> {
  return withTenant(db, organizationId, (tx) => fn(createStore(tx, organizationId), tx), context);
}
