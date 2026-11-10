import "server-only";
import {
  pageOf,
  recurrenceCreateSchema,
  recurrenceListQuerySchema,
  recurrenceSchema,
  recurrenceUpdateSchema,
} from "@fieldops/shared";
import type { z } from "zod";
import type {
  ZodOpenApiOperationObject,
  ZodOpenApiPathsObject,
  ZodOpenApiResponseObject,
  ZodOpenApiResponsesObject,
} from "zod-openapi";

// Maintenance plans (JOB-13) in the OpenAPI document. openapi.ts passes its helpers so the descriptions,
// errors and headers match the other resources.

type Code = 400 | 404 | 409 | 415 | 422;

export interface OpenApiHelpers {
  op: (
    tag: string,
    summary: string,
    rest: Omit<ZodOpenApiOperationObject, "tags" | "summary">,
  ) => ZodOpenApiOperationObject;
  json: <T extends z.ZodType>(schema: T, description: string) => ZodOpenApiResponseObject;
  body: <T extends z.ZodType>(schema: T) => ZodOpenApiOperationObject["requestBody"];
  errors: (...codes: Code[]) => ZodOpenApiResponsesObject;
  uuidParam: (what: string) => z.ZodObject;
  idempotencyHeader: z.ZodObject;
}

export const RECURRENCES_TAG = {
  name: "Maintenance plans",
  description: "Recurring jobs for maintenance contracts: a rule that creates each visit's job ahead of time",
};

export function recurrencePaths(h: OpenApiHelpers): ZodOpenApiPathsObject {
  const tag = RECURRENCES_TAG.name;
  return {
    "/recurrences": {
      get: h.op(tag, "List maintenance plans", {
        operationId: "listRecurrences",
        description: "Office roles. Ordered by the next date without a job.",
        requestParams: { query: recurrenceListQuerySchema },
        responses: {
          "200": h.json(pageOf(recurrenceSchema, "RecurrencePage"), "A page of plans"),
          ...h.errors(422),
        },
      }),
      post: h.op(tag, "Create a maintenance plan", {
        operationId: "createRecurrence",
        description:
          "Office roles. Occurrence n is `starts_on` + n × the interval (month ends are clamped and never drift). A start in the past begins with the first date from today. The jobs of every date up to today + `lead_days` are created right away (source `recurring`, unassigned, with the preferred window); later ones follow daily.",
        requestParams: { header: h.idempotencyHeader },
        requestBody: h.body(recurrenceCreateSchema),
        responses: { "201": h.json(recurrenceSchema, "The new plan"), ...h.errors(400, 415, 422) },
      }),
    },
    "/recurrences/{id}": {
      get: h.op(tag, "Get a maintenance plan", {
        operationId: "getRecurrence",
        requestParams: { path: h.uuidParam("Plan") },
        responses: { "200": h.json(recurrenceSchema, "The plan"), ...h.errors(404) },
      }),
      patch: h.op(tag, "Update, pause or resume a maintenance plan", {
        operationId: "updateRecurrence",
        description:
          "A new rule, or `active: true` after a pause, continues from today after the dates that already have jobs; dates missed while paused aren't created. Other changes apply to jobs generated from now on.",
        requestParams: { path: h.uuidParam("Plan") },
        requestBody: h.body(recurrenceUpdateSchema),
        responses: { "200": h.json(recurrenceSchema, "The updated plan"), ...h.errors(404, 415, 422) },
      }),
      delete: h.op(tag, "Delete a maintenance plan", {
        operationId: "deleteRecurrence",
        description: "The jobs the plan already generated stay.",
        requestParams: { path: h.uuidParam("Plan") },
        responses: { "204": { description: "Deleted" }, ...h.errors(404) },
      }),
    },
  };
}
