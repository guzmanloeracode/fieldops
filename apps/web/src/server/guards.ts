import { NotFoundError } from "@fieldops/core";
import { notFound } from "next/navigation";

// Guards for segment layouts. A page with a loading skeleton (loading.tsx) starts streaming before it renders, and
// once the skeleton is on its way the response is a 200: a notFound() in the page still shows "not found" but can
// no longer change the status. Checks that must answer 404 (a role that can't use the page, another organization's
// record, a missing record) therefore run in the segment's layout, which renders before the skeleton. No ancestor
// segment may have a loading.tsx, or its skeleton streams first.

export function notFoundUnless(allowed: boolean): void {
  if (!allowed) notFound();
}

/** Resolves the record, or answers 404 when the service says it doesn't exist or isn't visible to the actor. */
export async function foundOr404<T>(load: Promise<T>): Promise<T> {
  try {
    return await load;
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
