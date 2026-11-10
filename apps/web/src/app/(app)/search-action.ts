"use server";
import { search } from "@fieldops/core";
import { action, runService } from "@/server/context";

/** Command palette search (JOB-11): jobs, customers and sites the signed-in member may see. */
export async function searchAction(q: string) {
  return action(() => runService((ctx) => search.searchAll(ctx, typeof q === "string" ? q : "")));
}
