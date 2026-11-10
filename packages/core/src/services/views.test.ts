import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors";
import { world } from "../test/fixtures";
import * as views from "./views";

describe("saved views (JOB-04)", () => {
  it("keeps only valid job filters, normalized", () => {
    expect(
      views.normalizeViewQuery("?status=new,scheduled&page=3&cursor=x&foo=1&q= leak &sort=-priority"),
    ).toBe("q=leak&status=new%2Cscheduled&sort=-priority");
    expect(views.normalizeViewQuery("")).toBe("");
    expect(() => views.normalizeViewQuery("status=bogus")).toThrow(ValidationError);
  });

  it("creates personal views and shared views for the office", async () => {
    const w = world();
    const mine = await views.createView(w.ctx(w.tom), { name: "My urgent", query: "priority=urgent" });
    expect(mine).toMatchObject({
      name: "My urgent",
      shared: false,
      query: "priority=urgent",
      resource: "jobs",
    });
    await expect(views.createView(w.ctx(w.tom), { name: "Team", query: "", shared: true })).rejects.toThrow(
      ForbiddenError,
    );
    const team = await views.createView(w.ctx(w.dispatcher), {
      name: "Unassigned",
      query: "status=new&unassigned=true",
      shared: true,
    });
    expect(team.ownerName).toBe("Dan Dispatcher");

    // Tom sees his own view and the shared one; Rina only the shared one.
    expect((await views.listViews(w.ctx(w.tom))).map((v) => v.name)).toEqual(["My urgent", "Unassigned"]);
    expect((await views.listViews(w.ctx(w.rina))).map((v) => v.name)).toEqual(["Unassigned"]);
  });

  it("limits the number of views per member", async () => {
    const w = world();
    for (let i = 0; i < views.MAX_VIEWS_PER_MEMBER; i++) {
      await views.createView(w.ctx(w.dispatcher), { name: `v${i}`, query: "" });
    }
    await expect(views.createView(w.ctx(w.dispatcher), { name: "one more", query: "" })).rejects.toThrow(
      ValidationError,
    );
  });

  it("deletes own views; managers also remove shared views; private views of others stay hidden", async () => {
    const w = world();
    const shared = await views.createView(w.ctx(w.dispatcher), { name: "Shared", query: "", shared: true });
    const priv = await views.createView(w.ctx(w.dispatcher), { name: "Private", query: "" });
    const ctxOf = (m: typeof w.owner) => w.ctx(m);

    expect(views.canDeleteView(ctxOf(w.dispatcher), shared)).toBe(true);
    expect(views.canDeleteView(ctxOf(w.owner), shared)).toBe(true);
    expect(views.canDeleteView(ctxOf(w.owner), priv)).toBe(false);
    expect(views.canDeleteView(ctxOf(w.tom), shared)).toBe(false);

    await expect(views.deleteView(w.ctx(w.tom), shared.id)).rejects.toThrow(ForbiddenError);
    await expect(views.deleteView(w.ctx(w.owner), priv.id)).rejects.toThrow(NotFoundError);
    await expect(views.deleteView(w.ctx(w.owner), "missing")).rejects.toThrow(NotFoundError);
    await views.deleteView(w.ctx(w.owner), shared.id);
    await views.deleteView(w.ctx(w.dispatcher), priv.id);
    expect(await views.listViews(w.ctx(w.dispatcher))).toEqual([]);
  });
});
