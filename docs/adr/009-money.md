# ADR 009: Money as integer minor units with ISO currency codes

**Status:** accepted · 2026-11-10

**Decision.** Amounts are `bigint` minor units plus a `char(3)` currency. ISO 4217 gives both USD and IDR two
minor digits; IDR is displayed without decimals. Rounding is half away from zero; tax rates are basis points.

**Consequences.** No floating-point drift. Conversions happen only at the edges (`parseMajor`, `formatMoney`).
