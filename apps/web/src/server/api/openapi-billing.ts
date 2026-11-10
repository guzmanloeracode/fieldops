import "server-only";
import {
  catalogItemSchema,
  catalogQuerySchema,
  documentSendSchema,
  invoiceCreateSchema,
  invoiceListQuerySchema,
  invoiceSchema,
  invoiceSummarySchema,
  invoiceUpdateSchema,
  invoiceVoidSchema,
  paymentCreateSchema,
  paymentSchema,
  quoteCreateSchema,
  quoteDecisionSchema,
  quoteListQuerySchema,
  quoteSchema,
  quoteSummarySchema,
  quoteUpdateSchema,
} from "@fieldops/shared";
import { z } from "zod";
import type {
  ZodOpenApiOperationObject,
  ZodOpenApiPathsObject,
  ZodOpenApiRequestBodyObject,
  ZodOpenApiResponseObject,
  ZodOpenApiResponsesObject,
} from "zod-openapi";

// Quotes, invoices, payments and the catalog in the OpenAPI document (§17.2, 0.4). The helpers come from
// openapi.ts so every path is described the same way.

type Code = 400 | 401 | 403 | 404 | 409 | 412 | 415 | 422 | 429 | 503;
interface Helpers {
  op: (
    tag: string,
    summary: string,
    rest: Omit<ZodOpenApiOperationObject, "tags" | "summary">,
  ) => ZodOpenApiOperationObject;
  json: <T extends z.ZodType>(
    schema: T,
    description: string,
    headers?: z.ZodObject,
  ) => ZodOpenApiResponseObject;
  body: <T extends z.ZodType>(schema: T) => ZodOpenApiRequestBodyObject;
  errors: (...codes: Code[]) => ZodOpenApiResponsesObject;
  list: <T extends z.ZodType>(item: T, id: string) => z.ZodType;
  etagHeader: z.ZodObject;
  idempotencyHeader: z.ZodObject;
  ifMatchHeader: z.ZodObject;
  uuidParam: (what: string) => z.ZodObject;
}

export const billingTags = [
  {
    name: "Billing",
    description:
      "Quotes, invoices, payments and the parts and fees catalog. Owners, admins and dispatchers. Money is in minor units of the organization's currency.",
  },
];

export function billingPaths(h: Helpers): ZodOpenApiPathsObject {
  const T = "Billing";
  const quoteId = z.object({
    id: z
      .string()
      .meta({ description: "Quote UUID or number such as QUO-2026-0042", example: "QUO-2026-0042" }),
  });
  const pdf = {
    description: "The PDF",
    content: { "application/pdf": { schema: z.string().meta({ format: "binary" }) } },
  };
  return {
    "/quotes": {
      get: h.op(T, "List quotes", {
        operationId: "listQuotes",
        requestParams: { query: quoteListQuerySchema.omit({ page: true }) },
        responses: {
          "200": h.json(h.list(quoteSummarySchema, "QuotePage"), "Quotes, newest first"),
          ...h.errors(422),
        },
      }),
      post: h.op(T, "Create a quote", {
        operationId: "createQuote",
        description:
          "A draft numbered QUO-<year>-<n>. Totals are computed from the lines: net = quantity × unit price, the document discount is spread over the lines in proportion to their net, and each line's tax applies after its share.",
        requestParams: { header: h.idempotencyHeader },
        requestBody: h.body(quoteCreateSchema),
        responses: { "201": h.json(quoteSchema, "The new quote", h.etagHeader), ...h.errors(415, 422) },
      }),
    },
    "/quotes/{id}": {
      get: h.op(T, "Get a quote", {
        operationId: "getQuote",
        requestParams: { path: quoteId },
        responses: { "200": h.json(quoteSchema, "The quote", h.etagHeader), ...h.errors(404) },
      }),
      patch: h.op(T, "Update a draft quote", {
        operationId: "updateQuote",
        description: "Only drafts can be edited. `lines` replaces every line.",
        requestParams: { path: quoteId, header: h.ifMatchHeader },
        requestBody: h.body(quoteUpdateSchema),
        responses: {
          "200": h.json(quoteSchema, "The updated quote", h.etagHeader),
          ...h.errors(404, 409, 412, 415, 422),
        },
      }),
    },
    "/quotes/{id}/send": {
      post: h.op(T, "Send a quote", {
        operationId: "sendQuote",
        description:
          "Emails the quote to its contact (or `contact_id`) with a link to the customer portal. A sent quote can be sent again.",
        requestParams: { path: quoteId, header: h.idempotencyHeader },
        requestBody: { ...h.body(documentSendSchema), required: false },
        responses: { "200": h.json(quoteSchema, "The sent quote"), ...h.errors(404, 409, 415, 422) },
      }),
    },
    "/quotes/{id}/decision": {
      post: h.op(T, "Record the customer's decision", {
        operationId: "decideQuote",
        description:
          "For a sent quote that hasn't expired. An approval creates a New job (source `quote`) for the quote's customer and site; a decline needs a reason. Office roles are notified.",
        requestParams: { path: quoteId, header: h.idempotencyHeader },
        requestBody: h.body(quoteDecisionSchema),
        responses: { "200": h.json(quoteSchema, "The decided quote"), ...h.errors(404, 409, 415, 422) },
      }),
    },
    "/quotes/{id}/pdf": {
      get: h.op(T, "Download a quote as PDF", {
        operationId: "getQuotePdf",
        requestParams: { path: quoteId },
        responses: { "200": pdf, ...h.errors(404) },
      }),
    },
    "/invoices": {
      get: h.op(T, "List invoices", {
        operationId: "listInvoices",
        requestParams: { query: invoiceListQuerySchema.omit({ page: true }) },
        responses: {
          "200": h.json(h.list(invoiceSummarySchema, "InvoicePage"), "Invoices, newest first"),
          ...h.errors(422),
        },
      }),
      post: h.op(T, "Create a draft invoice", {
        operationId: "createInvoice",
        description:
          "For a completed job (`job_id`; without `lines` they are prefilled from the service or the approved quote, recorded labor rounded up to the quarter hour, and approved parts and expenses not billed yet) or for a customer. Drafts have no number.",
        requestParams: { header: h.idempotencyHeader },
        requestBody: h.body(invoiceCreateSchema),
        responses: {
          "201": h.json(invoiceSchema, "The new draft", h.etagHeader),
          ...h.errors(404, 409, 415, 422),
        },
      }),
    },
    "/invoices/{id}": {
      get: h.op(T, "Get an invoice", {
        operationId: "getInvoice",
        requestParams: { path: h.uuidParam("Invoice") },
        responses: {
          "200": h.json(invoiceSchema, "The invoice with its lines and payments", h.etagHeader),
          ...h.errors(404),
        },
      }),
      patch: h.op(T, "Update a draft invoice", {
        operationId: "updateInvoice",
        description: "Only drafts can be edited. `lines` replaces every line.",
        requestParams: { path: h.uuidParam("Invoice"), header: h.ifMatchHeader },
        requestBody: h.body(invoiceUpdateSchema),
        responses: {
          "200": h.json(invoiceSchema, "The updated invoice", h.etagHeader),
          ...h.errors(404, 409, 412, 415, 422),
        },
      }),
    },
    "/invoices/{id}/send": {
      post: h.op(T, "Issue and send an invoice", {
        operationId: "sendInvoice",
        description:
          "A draft gets the next number of the year (no gaps), today's date and a due date after the payment terms, and is emailed to the bill-to contact with a link to the customer portal. An issued, unpaid invoice is emailed again.",
        requestParams: { path: h.uuidParam("Invoice"), header: h.idempotencyHeader },
        requestBody: { ...h.body(documentSendSchema), required: false },
        responses: { "200": h.json(invoiceSchema, "The issued invoice"), ...h.errors(404, 409, 415, 422) },
      }),
    },
    "/invoices/{id}/void": {
      post: h.op(T, "Void an invoice", {
        operationId: "voidInvoice",
        description:
          "Drafts and unpaid invoices without payments. Its parts and expenses can be billed again.",
        requestParams: { path: h.uuidParam("Invoice"), header: h.idempotencyHeader },
        requestBody: h.body(invoiceVoidSchema),
        responses: { "200": h.json(invoiceSchema, "The void invoice"), ...h.errors(404, 409, 415, 422) },
      }),
    },
    "/invoices/{id}/payments": {
      get: h.op(T, "List an invoice's payments", {
        operationId: "listPayments",
        requestParams: { path: h.uuidParam("Invoice") },
        responses: {
          "200": h.json(h.list(paymentSchema, "PaymentPage"), "Payments, oldest first"),
          ...h.errors(404),
        },
      }),
      post: h.op(T, "Record a payment", {
        operationId: "recordPayment",
        description:
          "A manual payment on a sent or overdue invoice, at most the balance. The invoice becomes paid when payments cover the total; owners are notified and the bill-to contact gets a receipt.",
        requestParams: { path: h.uuidParam("Invoice"), header: h.idempotencyHeader },
        requestBody: h.body(paymentCreateSchema),
        responses: {
          "201": h.json(invoiceSchema, "The invoice with the payment"),
          ...h.errors(404, 409, 415, 422),
        },
      }),
    },
    "/invoices/{id}/pdf": {
      get: h.op(T, "Download an invoice as PDF", {
        operationId: "getInvoicePdf",
        requestParams: { path: h.uuidParam("Invoice") },
        responses: { "200": pdf, ...h.errors(404) },
      }),
    },
    "/catalog-items": {
      get: h.op(T, "List catalog items", {
        operationId: "listCatalogItems",
        description: "Active parts and fees; `q` searches the name and SKU.",
        requestParams: { query: catalogQuerySchema },
        responses: {
          "200": h.json(h.list(catalogItemSchema, "CatalogItemPage"), "Parts and fees"),
          ...h.errors(422),
        },
      }),
    },
  };
}
