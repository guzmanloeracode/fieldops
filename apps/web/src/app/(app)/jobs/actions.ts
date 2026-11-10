"use server";
import { customers, formatJobNumber, jobs, organization } from "@fieldops/core";
import type { AttachmentUploadInput, JobAssignmentInput, JobCreateInput, JobTransitionInput, NoteCreate } from "@fieldops/shared";
import { revalidatePath } from "next/cache";
import { action, runService } from "@/server/context";

export async function searchCustomersAction(q: string) {
  return action(() =>
    runService(async (ctx) => {
      const page = await customers.listCustomers(ctx, { q: q || undefined, sort: "name", limit: 12 });
      return page.rows.map((c) => ({ id: c.id, name: c.name, type: c.type, city: c.billingAddress?.city ?? null, siteCount: c.siteCount }));
    }),
  );
}

export async function customerSitesAction(customerId: string) {
  return action(() =>
    runService(async (ctx) => {
      const sites = await customers.listSites(ctx, customerId);
      return Promise.all(
        sites.map(async (s) => ({
          id: s.id,
          label: s.label,
          line1: s.address.line1,
          city: s.address.city,
          equipment: (await ctx.store.equipment.listBySite(s.id)).map((e) => ({
            id: e.id,
            label: [e.type, e.brand, e.model].filter(Boolean).join(" · "),
          })),
        })),
      );
    }),
  );
}

export async function createJobAction(input: JobCreateInput) {
  const result = await action(() => runService((ctx) => jobs.createJob(ctx, input)));
  if (!result.ok) return result;
  revalidatePath("/jobs");
  return { ok: true as const, data: { number: formatJobNumber(result.data.number) } };
}

export async function updateJobAction(id: string, input: unknown, version: number) {
  const result = await action(() => runService((ctx) => jobs.updateJob(ctx, id, input, version)));
  if (result.ok) revalidatePath(`/jobs/${formatJobNumber(result.data.number)}`);
  return result.ok ? { ok: true as const, data: null } : result;
}

export async function transitionJobAction(id: string, input: JobTransitionInput, version: number) {
  const result = await action(() => runService((ctx) => jobs.transitionJob(ctx, id, input, version)));
  if (result.ok) {
    revalidatePath(`/jobs/${formatJobNumber(result.data.number)}`);
    revalidatePath("/jobs");
  }
  return result.ok ? { ok: true as const, data: { status: result.data.status } } : result;
}

export async function assignJobAction(id: string, input: JobAssignmentInput) {
  const result = await action(() => runService((ctx) => jobs.assignJob(ctx, id, input)));
  if (result.ok) {
    revalidatePath(`/jobs/${formatJobNumber(result.data.number)}`);
    revalidatePath("/jobs");
  }
  return result.ok ? { ok: true as const, data: { status: result.data.status } } : result;
}

export async function addNoteAction(jobId: string, input: NoteCreate) {
  const result = await action(() => runService((ctx) => jobs.addNote(ctx, jobId, input)));
  if (result.ok) revalidatePath("/jobs/[number]", "page");
  return result.ok ? { ok: true as const, data: null } : result;
}

export async function requestUploadAction(jobId: string, input: AttachmentUploadInput) {
  return action(() =>
    runService(async (ctx) => {
      const r = await jobs.requestAttachmentUpload(ctx, jobId, input);
      return { attachmentId: r.attachment.id, uploadUrl: r.uploadUrl, thumbnailUploadUrl: r.thumbnailUploadUrl, headers: r.headers };
    }),
  );
}

export async function confirmUploadAction(attachmentId: string) {
  const result = await action(() => runService((ctx) => jobs.confirmAttachmentUpload(ctx, attachmentId)));
  if (result.ok) revalidatePath("/jobs/[number]", "page");
  return result.ok ? { ok: true as const, data: null } : result;
}

export async function removeAttachmentAction(attachmentId: string) {
  const result = await action(() => runService((ctx) => jobs.removeAttachment(ctx, attachmentId)));
  if (result.ok) revalidatePath("/jobs/[number]", "page");
  return result;
}

export async function deleteJobAction(id: string) {
  const result = await action(() => runService((ctx) => jobs.deleteJob(ctx, id)));
  if (result.ok) revalidatePath("/jobs");
  return result;
}

export async function assignableMembersAction() {
  return action(() =>
    runService(async (ctx) => (await organization.listAssignableMembers(ctx)).map((m) => ({ id: m.id, name: m.name, role: m.role }))),
  );
}
