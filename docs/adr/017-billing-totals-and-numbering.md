# ADR 017: Billing totals in BigInt minor units, gap-free document numbers

**Status:** accepted · 2026-11-10 · implemented in 0.4

**Context.** Quotes and invoices (FIN-02, FIN-03, FIN-07) show the same totals in the app, the PDF, the email,
the API and the customer's own books, in USD and IDR. Money is already stored as integer minor units (ADR 009),
but the products behind a total can outgrow JavaScript's safe integers: a large IDR price in minor units times a
quantity in hundredths times a tax rate in basis points passes 2^53. Rounding also has to be defined once: per line
or on the total, before or after a discount. Invoice numbers are read by customers and accountants, who expect a
sequence without gaps, and a draft someone abandons shouldn't use one up. Two invoices must never bill the same
approved part (EXP-04).

**Decision.**

- Pure functions in `packages/core/src/domain/billing.ts` compute every amount. The quote and invoice services,
  the seed and the API all use them, and the stored line amounts (`net_minor`, `tax_minor`) and document totals
  are written from their output.
- Products and sums are BigInt. Quantities have at most two decimals and are multiplied as hundredths. A result
  outside the safe integer range is a validation error, never a rounded number.
- Rounding is half away from zero (ADR 009), on each line and never again on the total:
  - line net = quantity × unit price;
  - a billed part or expense is priced at cost × (1 + markup);
  - the document discount (a percentage in basis points, or an amount) is capped at the subtotal and split across
    the lines in proportion to their net with the largest-remainder method, ties to the earlier line, so the
    shares add up exactly;
  - each line's tax = its net after its discount share × its own rate in basis points;
  - total = subtotal − discount + the sum of line taxes.
- Numbers come from `org_counter` rows named `invoice:<year>` and `quote:<year>`, incremented by an upsert in the
  same transaction as the document. An invoice is numbered when it is issued (draft → sent), from the year of its
  issue date in the organization's time zone; drafts have no number, which a partial unique index allows. A quote
  is numbered when it is created, so a draft quote already has its number. The format is `INV-2026-0042`; the
  prefix comes from billing settings and isn't part of the counter's name, so changing it continues the year's
  sequence.
- Neither quotes nor invoices are ever deleted: a wrong invoice is voided and keeps its number.
- A part or expense request counts as billed when a line on an invoice that isn't void names it, drafts included.
  Saving or issuing an invoice first locks the named requests (`SELECT … FOR UPDATE`, in id order), then checks,
  so two invoices billing the same part wait for each other and the second is refused with a 409. Issuing checks
  again, because another invoice may have billed the part after this draft was saved.

**Consequences.** The same lines give the same minor units everywhere, and unit tests pin the edge cases: a 100%
discount, an amount discount above the subtotal, IDR with 12% tax on large amounts, half-unit ties. Rounding each
line can make the total differ by a minor unit from tax computed on the subtotal; that is the defined behavior.
The counter row stays locked until the transaction commits, so concurrent issues get consecutive numbers, a
rolled-back issue gives its number back, and with no deletes neither sequence has gaps. The price is that issuing
is serialized per organization and year on one row, which is fine at this scale. An abandoned draft quote keeps a
visible number; drafts of invoices are found by customer or job, since they have none.
