import "server-only";
import { portalBilling } from "@fieldops/core";
import { cache } from "react";
import { runPortal } from "@/server/portal/session";

/** One load per request, shared by the guard layout and the page. */
export const loadPortalInvoice = cache((slug: string, id: string) =>
  runPortal(slug, (ctx) => portalBilling.getPortalInvoice(ctx, id)),
);
