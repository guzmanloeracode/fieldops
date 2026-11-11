import { apiKeys } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toApiKeyDto } from "@/server/api/serialize-platform";

// API keys (PLT-02). Owners and admins, signed in: a key can't list, create or revoke keys.

export const GET = apiRoute(
  async ({ ctx }) => ({ body: { data: (await apiKeys.listApiKeys(ctx)).map(toApiKeyDto) } }),
  { sessionOnly: true },
);

export const POST = apiRoute(
  async ({ body, ctx }) => {
    const { record, key } = await apiKeys.createApiKey(ctx, body);
    return {
      status: 201,
      body: { ...toApiKeyDto(record), key },
      headers: { Location: `/api/v1/api-keys/${record.id}` },
    };
  },
  { sessionOnly: true },
);
