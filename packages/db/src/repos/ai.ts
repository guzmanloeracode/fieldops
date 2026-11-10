import type { AiRepo } from "@fieldops/core";
import type { Tx } from "../client";
import { aiInteraction } from "../schema";

// AI usage log (§9.7) and intake drafts (AI-01). The AI slice extends this repository.

export function aiRepo(tx: Tx, orgId: string): AiRepo {
  return {
    async logInteraction(row) {
      const [r] = await tx
        .insert(aiInteraction)
        .values({ organizationId: orgId, ...row, output: row.output ?? null })
        .returning({ id: aiInteraction.id });
      return { id: r!.id };
    },
  };
}
