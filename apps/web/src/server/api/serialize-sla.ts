import type { sla } from "@fieldops/core";
import type { SlaPolicyDto } from "@fieldops/shared";

export function toSlaPolicyDto(p: sla.EffectivePolicy): SlaPolicyDto {
  return {
    priority: p.priority,
    response_min: p.responseMin,
    resolution_min: p.resolutionMin,
    business_hours: p.businessHours,
    is_default: p.isDefault,
  };
}
