import { expect, type APIRequestContext } from "@playwright/test";
import { futureWindow, json, memberByEmail, USERS, type JobDto } from "./fixtures";

// Helpers for 0.2 field work journeys: checklists (JOB-08), time (TEC-04) and signatures (JOB-10).

/** A 1×1 PNG, enough for a signature or a checklist photo. */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Uploads a file to a job through the presigned flow. Signatures are linked, other files confirmed. */
export async function uploadToJob(
  client: APIRequestContext,
  jobId: string,
  opts: { kind: "photo" | "signature"; caption?: string; fileName?: string },
): Promise<string> {
  const upload = await json<{ attachment_id: string; upload_url: string; headers: Record<string, string> }>(
    await client.post(`/api/v1/jobs/${jobId}/attachments`, {
      data: {
        file_name: opts.fileName ?? `${opts.kind}.png`,
        mime_type: "image/png",
        size_bytes: PNG.length,
        kind: opts.kind,
        caption: opts.caption ?? null,
      },
    }),
  );
  const put = await client.put(upload.upload_url, { data: PNG, headers: upload.headers });
  expect(put.ok(), `upload → ${put.status()} ${await put.text()}`).toBeTruthy();
  if (opts.kind !== "signature") {
    const confirmed = await client.post(`/api/v1/attachments/${upload.attachment_id}/confirm`);
    expect(confirmed.ok(), await confirmed.text()).toBeTruthy();
  }
  return upload.attachment_id;
}

/** Captures a customer signature through the API (needed to complete jobs where it's required). */
export async function signViaApi(client: APIRequestContext, jobId: string, name = "Cara Example") {
  const attachmentId = await uploadToJob(client, jobId, { kind: "signature", caption: name });
  const res = await client.post(`/api/v1/jobs/${jobId}/signature`, {
    data: { attachment_id: attachmentId, signer_name: name },
  });
  expect(res.status(), await res.text()).toBe(201);
}

/** Creates a job of a service type (so it gets that type's checklist) and assigns it to Tom. */
export async function jobForTom(
  client: APIRequestContext,
  title: string,
  serviceTypeName: string,
): Promise<JobDto> {
  const types = await json<{ data: { id: string; name: string }[] }>(
    await client.get("/api/v1/service-types"),
  );
  const type = types.data.find((t) => t.name === serviceTypeName);
  if (!type) throw new Error(`service type ${serviceTypeName} not found`);
  const customers = await json<{ data: { id: string }[] }>(
    await client.get("/api/v1/customers?limit=5&sort=name"),
  );
  for (const c of customers.data) {
    const sites = await json<{ data: { id: string }[] }>(await client.get(`/api/v1/customers/${c.id}/sites`));
    if (!sites.data[0]) continue;
    const job = await json<JobDto>(
      await client.post("/api/v1/jobs", {
        data: { customer_id: c.id, site_id: sites.data[0].id, title, service_type_id: type.id },
      }),
    );
    const tom = await memberByEmail(client, USERS.technician);
    const w = futureWindow(2);
    const res = await client.put(`/api/v1/jobs/${job.id}/assignments`, {
      data: {
        member_ids: [tom.id],
        lead_member_id: tom.id,
        scheduled_start: w.start.toISOString(),
        scheduled_end: w.end.toISOString(),
        // The checklist tests pick service types by name, some of which need skills Tom lacks (SCH-03).
        override_reason: "E2E: checklist test",
      },
    });
    expect(res.status(), await res.text()).toBe(200);
    return job;
  }
  throw new Error("No customer with a site");
}
