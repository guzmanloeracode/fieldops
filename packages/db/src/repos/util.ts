import type { Address } from "@fieldops/shared";

export function toAddress(row: {
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
}): Address {
  return {
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    region: row.region,
    postal_code: row.postalCode,
    country: row.country,
  };
}

export function fromAddress(a: Address) {
  return {
    line1: a.line1,
    line2: a.line2 ?? null,
    city: a.city,
    region: a.region ?? null,
    postalCode: a.postal_code ?? null,
    country: a.country,
  };
}

export function definedOnly<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Escapes LIKE wildcards in user input. */
export function likeEscape(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}
