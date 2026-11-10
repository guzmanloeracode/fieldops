import { z } from "zod";
import { JOB_PRIORITIES, SLA_TARGETS } from "./constants";

// SLA policies (SLA-01, SET-03). Targets are stored in minutes; the settings page enters hours or days.

/** Longest targets a policy accepts: 30 days to respond, 90 days to resolve. */
export const SLA_MAX_RESPONSE_MIN = 30 * 24 * 60;
export const SLA_MAX_RESOLUTION_MIN = 90 * 24 * 60;

const priority = z.enum(JOB_PRIORITIES);

export const slaPolicyInputSchema = z
  .object({
    priority,
    response_min: z.number().int().min(15).max(SLA_MAX_RESPONSE_MIN),
    resolution_min: z.number().int().min(30).max(SLA_MAX_RESOLUTION_MIN),
    business_hours: z.boolean(),
  })
  .refine((p) => p.response_min < p.resolution_min, {
    message: "The response target must be shorter than the resolution target",
    path: ["resolution_min"],
  })
  .meta({ id: "SlaPolicyInput" });
export type SlaPolicyInput = z.output<typeof slaPolicyInputSchema>;

/** All four priorities in one call, so the targets stay consistent with each other. */
export const slaPoliciesUpdateSchema = z
  .object({ policies: z.array(slaPolicyInputSchema).length(JOB_PRIORITIES.length) })
  .refine((v) => new Set(v.policies.map((p) => p.priority)).size === JOB_PRIORITIES.length, {
    message: "Give one policy per priority",
    path: ["policies"],
  })
  .meta({ id: "SlaPoliciesUpdate" });
export type SlaPoliciesUpdate = z.output<typeof slaPoliciesUpdateSchema>;

export const slaPolicySchema = z
  .object({
    priority,
    response_min: z.number().int(),
    resolution_min: z.number().int(),
    business_hours: z.boolean(),
    is_default: z
      .boolean()
      .meta({ description: "True when the organization hasn't saved a policy and the defaults apply" }),
  })
  .meta({ id: "SlaPolicy" });
export type SlaPolicyDto = z.infer<typeof slaPolicySchema>;

export const slaPolicyListSchema = z.object({ data: z.array(slaPolicySchema) }).meta({ id: "SlaPolicyList" });

export const slaTargetSchema = z.enum(SLA_TARGETS).meta({ id: "SlaTarget" });
