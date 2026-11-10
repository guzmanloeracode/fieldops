import { customers } from "@fieldops/core";
import { apiRoute, weakEtag } from "@/server/api/handler";
import { ApiProblem } from "@/server/api/problem";
import { toCustomerDto } from "@/server/api/serialize";

type Params = { id: string };

export const GET = apiRoute<Params>(async ({ req, params, ctx }) => {
  const d = await customers.getCustomerDetail(ctx, params.id);
  const etag = weakEtag(d.customer.updatedAt);
  if (req.headers.get("if-none-match") === etag) return { status: 304, headers: { ETag: etag } };
  return { body: toCustomerDto(d.customer, d.contacts, d.sites.length), headers: { ETag: etag } };
});

export const PATCH = apiRoute<Params>(async ({ req, params, body, ctx }) => {
  const ifMatch = req.headers.get("if-match");
  if (ifMatch !== null) {
    const current = await customers.getCustomer(ctx, params.id);
    if (ifMatch.trim() !== weakEtag(current.updatedAt)) {
      throw new ApiProblem(
        412,
        "precondition_failed",
        "The customer changed since you loaded it. Reload and try again.",
      );
    }
  }
  await customers.updateCustomer(ctx, params.id, body ?? {});
  const d = await customers.getCustomerDetail(ctx, params.id);
  return {
    body: toCustomerDto(d.customer, d.contacts, d.sites.length),
    headers: { ETag: weakEtag(d.customer.updatedAt) },
  };
});

export const DELETE = apiRoute<Params>(async ({ params, ctx }) => {
  await customers.deleteCustomer(ctx, params.id);
  return { status: 204 };
});
