import { describe, expect, it } from "vitest";
import { world } from "../test/fixtures";
import * as jobs from "./jobs";
import * as search from "./search";

describe("command palette search (JOB-11)", () => {
  it("finds jobs, customers and sites; ignores very short queries", async () => {
    const w = world();
    const job = await jobs.createJob(w.ctx(w.dispatcher), {
      customer_id: w.customerId,
      site_id: w.siteId,
      title: "Leaking condenser",
    });
    const ctx = w.ctx(w.dispatcher);
    expect(await search.searchAll(ctx, " l ")).toBe(search.EMPTY_SEARCH);
    expect((await search.searchAll(ctx, "leak")).jobs.map((j) => j.id)).toEqual([job.id]);
    expect((await search.searchAll(ctx, "JOB-000001")).jobs.map((j) => j.id)).toEqual([job.id]);
    expect((await search.searchAll(ctx, "cara")).customers.map((c) => c.name)).toEqual(["Cara Customer"]);
    expect((await search.searchAll(ctx, "main st")).sites).toHaveLength(2);
  });

  it("limits technicians to their assigned work (TEC-05)", async () => {
    const w = world();
    const job = await jobs.createJob(w.ctx(w.dispatcher), {
      customer_id: w.customerId,
      site_id: w.siteId,
      title: "Leaking condenser",
    });
    expect(await search.searchAll(w.ctx(w.tom), "leak")).toEqual({ jobs: [], customers: [], sites: [] });
    await jobs.assignJob(w.ctx(w.dispatcher), job.id, { member_ids: [w.tom.id] });
    const hits = await search.searchAll(w.ctx(w.tom), "main st");
    expect(hits.sites.map((s) => s.id)).toEqual([w.siteId]);
    expect((await search.searchAll(w.ctx(w.tom), "corp")).customers).toEqual([]);
    expect((await search.searchAll(w.ctx(w.tom), "cara")).customers.map((c) => c.id)).toEqual([w.customerId]);
  });
});
