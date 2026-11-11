import { apiKeys } from "@fieldops/core";
import { z } from "zod";
import { apiRoute } from "@/server/api/handler";
import { ApiProblem } from "@/server/api/problem";
import { toApiKeyDto } from "@/server/api/serialize-platform";

type Params = { id: string };

const keyId = (id: string) => {
  if (!z.uuid().safeParse(id).success) throw new ApiProblem(404, "not_found", "API key not found");
  return id;
};

/** Revokes the key at once; it stays in the list as revoked. Revoking it again changes nothing. */
export const DELETE = apiRoute<Params>(
  async ({ params, ctx }) => ({ body: toApiKeyDto(await apiKeys.revokeApiKey(ctx, keyId(params.id))) }),
  { sessionOnly: true },
);
