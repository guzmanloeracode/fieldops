import { customers, parseInput } from "@fieldops/core";
import { customerListQuerySchema } from "@fieldops/shared";
import { apiRoute, queryObject, weakEtag } from "@/server/api/handler";
import { toCustomerDto, toCustomerSummaryDto } from "@/server/api/serialize";

export const GET = apiRoute(async ({ url, ctx }) => {
  const query = parseInput(customerListQuerySchema, queryObject(url));
  const page = await customers.listCustomers(ctx, { ...query, page: undefined });
  return { body: { data: page.rows.map(toCustomerSummaryDto), next_cursor: page.nextCursor } };
});

export const POST = apiRoute(async ({ body, ctx }) => {
  const created = await customers.createCustomer(ctx, body);
  return {
    status: 201,
    body: {
      ...toCustomerDto(created.customer, created.contacts, 0),
      possible_duplicates: created.duplicates.map((d) => ({
        id: d.id,
        name: d.name,
        matched_on: d.matchedOn,
      })),
    },
    headers: {
      Location: `/api/v1/customers/${created.customer.id}`,
      ETag: weakEtag(created.customer.updatedAt),
    },
  };
});
