import "server-only";
import { portal } from "@fieldops/core";
import { cache } from "react";
import { runPortal } from "@/server/portal/session";

/** One load per request, shared by the guard layout and the page. */
export const loadPortalJob = cache((slug: string, number: number) =>
  runPortal(slug, (ctx) => portal.getPortalJob(ctx, number)),
);
