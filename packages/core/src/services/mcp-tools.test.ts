import { describe, expect, it } from "vitest";
import { world } from "../test/fixtures";
import type { TxRunner } from "./ai-types";
import * as jobs from "./jobs";
import { mcpInputSchema, mcpToolsFor, runMcpTool } from "./mcp-tools";
import type { MemberRecord } from "./types";

type World = ReturnType<typeof world>;
const runner =
  (w: World, m: MemberRecord): TxRunner =>
  (fn) =>
    fn(w.ctx(m));

describe("MCP tools (PLT-05, AI-05)", () => {
  it("offers the assistant's tools by role", () => {
    const w = world();
    const owner = mcpToolsFor(w.owner).map((t) => t.name);
    expect(owner).toEqual([
      "search_jobs",
      "get_job",
      "list_sla_risks",
      "technician_workload",
      "revenue_summary",
      "customer_history",
      "pending_approvals",
    ]);
    expect(mcpToolsFor(w.dispatcher).map((t) => t.name)).not.toContain("revenue_summary");
    expect(mcpToolsFor(w.owner)[0]!.description).toMatch(/Search the organization's jobs/);
  });

  it("lets clients leave out nullable fields", () => {
    const schema = mcpInputSchema("search_jobs");
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ status: ["new"] }).success).toBe(true);
    expect(mcpInputSchema("get_job").safeParse({}).success).toBe(false);
  });

  it("runs a tool as the member and returns its data", async () => {
    const w = world();
    await jobs.createJob(w.ctx(w.dispatcher), {
      customer_id: w.customerId,
      site_id: w.siteId,
      title: "Compressor noise",
      priority: "high",
    });
    const out = await runMcpTool(runner(w, w.owner), w.owner, "search_jobs", { text: "compressor" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.count).toBe(1);
    expect(JSON.stringify(out.data)).toContain("Compressor noise");
  });

  it("refuses tools the role can't use, unknown tools and invalid input as results", async () => {
    const w = world();
    expect(await runMcpTool(runner(w, w.dispatcher), w.dispatcher, "revenue_summary", {})).toEqual({
      ok: false,
      error: "Unknown tool: revenue_summary",
    });
    expect(await runMcpTool(runner(w, w.owner), w.owner, "drop_tables", {})).toMatchObject({ ok: false });
    const bad = await runMcpTool(runner(w, w.owner), w.owner, "search_jobs", { status: ["bogus"] });
    expect(bad).toMatchObject({ ok: false, error: "Invalid input" });
    const missing = await runMcpTool(runner(w, w.owner), w.owner, "get_job", { number: "JOB-999999" });
    expect(missing).toMatchObject({ ok: false });
  });

  it("keeps technicians to their own jobs", async () => {
    const w = world();
    await jobs.createJob(w.ctx(w.dispatcher), {
      customer_id: w.customerId,
      site_id: w.siteId,
      title: "Someone else's job",
      priority: "normal",
    });
    const out = await runMcpTool(runner(w, w.tom), w.tom, "search_jobs", {});
    expect(out).toMatchObject({ ok: true, count: 0 });
  });
});
