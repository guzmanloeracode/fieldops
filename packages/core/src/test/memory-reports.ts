import type { MemoryData } from "./memory-store";
import type { ServiceReportRecord } from "../services/report-types";
import type { Store } from "../services/types";

/** The reports an in-memory store keeps, for assertions. */
export function memoryReportRows(data: MemoryData): ServiceReportRecord[] {
  return ((data as MemoryData & { reports?: ServiceReportRecord[] }).reports ??= []);
}

/** In-memory service reports (AI-03): one per job, versioned like the database. */
export function memoryReports(data: MemoryData, uuid: () => string): Pick<Store, "reports"> {
  const rows = memoryReportRows(data);
  const copy = (r: ServiceReportRecord | undefined) => (r ? { ...r } : null);
  return {
    reports: {
      async get(id) {
        return copy(rows.find((r) => r.id === id));
      },
      async getByJob(jobId) {
        return copy(rows.find((r) => r.jobId === jobId));
      },
      async create(input) {
        if (rows.some((r) => r.jobId === input.jobId)) return null;
        const now = new Date();
        const row: ServiceReportRecord = { ...input, id: uuid(), version: 1, createdAt: now, updatedAt: now };
        rows.push(row);
        return { ...row };
      },
      async update(id, patch, expectedVersion) {
        const row = rows.find((r) => r.id === id);
        if (!row || (expectedVersion !== undefined && row.version !== expectedVersion)) return null;
        Object.assign(row, patch, { version: row.version + 1, updatedAt: new Date() });
        return { ...row };
      },
      async setAiStatus(id, status, from) {
        const row = rows.find((r) => r.id === id);
        if (!row || (from !== undefined && row.aiStatus !== from)) return false;
        row.aiStatus = status;
        return true;
      },
    },
  };
}
