import type { AvailabilityRepo, ScheduleRepo, TimeOffRecord } from "../services/dispatch-types";
import type { JobView, MemberRecord } from "../services/types";
import { uuid } from "./memory-store";

// In-memory availability and schedule repositories for unit tests (0.2 dispatch).

export function memoryDispatch(
  data: { members: MemberRecord[]; timeOff?: TimeOffRecord[] },
  jobs: () => Promise<JobView[]>,
): { availability: AvailabilityRepo; schedule: ScheduleRepo } {
  // Read lazily so tests can replace data.timeOff.
  const list = () => (data.timeOff ??= []);
  const availability: AvailabilityRepo = {
    async updateMember(memberId, patch) {
      const m = data.members.find((x) => x.id === memberId);
      if (!m) return false;
      if (patch.workingHours !== undefined) m.workingHours = patch.workingHours;
      if (patch.skills !== undefined) m.skills = patch.skills;
      return true;
    },
    async listTimeOff({ from, to, memberIds }) {
      return list()
        .filter((t) => t.startsAt < to && t.endsAt > from && (!memberIds || memberIds.includes(t.memberId)))
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    },
    async getTimeOff(id) {
      return list().find((t) => t.id === id) ?? null;
    },
    async createTimeOff(input) {
      const t: TimeOffRecord = {
        id: uuid(),
        memberId: input.memberId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        reason: input.reason,
        createdAt: new Date(),
      };
      list().push(t);
      return t;
    },
    async removeTimeOff(id) {
      const i = list().findIndex((t) => t.id === id);
      if (i < 0) return false;
      list().splice(i, 1);
      return true;
    },
  };
  const rank = { urgent: 3, high: 2, normal: 1, low: 0 } as const;
  const schedule: ScheduleRepo = {
    async scheduled({ from, to, memberId }) {
      return (await jobs())
        .filter(
          (j) =>
            j.status !== "canceled" &&
            j.scheduledStart &&
            j.scheduledEnd &&
            j.scheduledStart < to &&
            j.scheduledEnd > from &&
            (!memberId || j.assignees.some((a) => a.memberId === memberId)),
        )
        .sort((a, b) => a.scheduledStart!.getTime() - b.scheduledStart!.getTime());
    },
    async unscheduled(limit) {
      return (await jobs())
        .filter((j) => j.status === "new" && !j.scheduledStart)
        .sort((a, b) => rank[b.priority] - rank[a.priority] || a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit);
    },
  };
  return { availability, schedule };
}
