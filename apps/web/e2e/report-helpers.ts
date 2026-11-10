import { expect } from "@playwright/test";
import { signViaApi } from "./fieldwork-helpers";
import { api, assign, futureWindow, json, memberByEmail, USERS, type JobDto } from "./fixtures";

// Helpers for service report journeys (AI-03, POR-04).

export const JAMIE = "jamie.rivera@example.com";

/** A job for the portal demo customer (Jamie Rivera), done by Tom and completed with a signature. */
export async function completedJobForJamie(title: string): Promise<JobDto> {
  const dispatcher = await api("dispatcher");
  const tech = await api("technician");
  const customers = await json<{ data: { id: string }[] }>(
    await dispatcher.get(`/api/v1/customers?q=${encodeURIComponent(JAMIE)}&limit=1`),
  );
  const customerId = customers.data[0]!.id;
  const sites = await json<{ data: { id: string }[] }>(
    await dispatcher.get(`/api/v1/customers/${customerId}/sites`),
  );
  const job = await json<JobDto>(
    await dispatcher.post("/api/v1/jobs", {
      data: { customer_id: customerId, site_id: sites.data[0]!.id, title },
    }),
  );
  const tom = await memberByEmail(dispatcher, USERS.technician);
  await assign(dispatcher, job.id, tom.id, futureWindow());
  const start = await tech.post(`/api/v1/jobs/${job.id}/transitions`, { data: { to: "in_progress" } });
  expect(start.ok(), await start.text()).toBeTruthy();
  // Acme Air asks for the customer's signature before completing (JOB-10).
  await signViaApi(tech, job.id, "Jamie Rivera");
  const done = await tech.post(`/api/v1/jobs/${job.id}/transitions`, { data: { to: "completed" } });
  expect(done.ok(), await done.text()).toBeTruthy();
  await dispatcher.dispose();
  await tech.dispose();
  return job;
}

/** Sends the job's report to Jamie through the API, so the portal shows it. */
export async function sendReportToJamie(jobId: string) {
  const client = await api("dispatcher");
  const res = await client.post(`/api/v1/jobs/${jobId}/report/send`, { data: { to: JAMIE } });
  expect(res.status(), await res.text()).toBe(200);
  await client.dispose();
}
