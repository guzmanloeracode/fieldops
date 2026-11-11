import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isLocale, mergeMessages, negotiateLocale } from "./locales";
import { translateServerMessage } from "./server-messages";
import { zodErrorMap } from "./zod";

describe("negotiateLocale", () => {
  it("picks the best supported language by weight, then header order", () => {
    expect(negotiateLocale("id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7")).toBe("id");
    expect(negotiateLocale("en-US,en;q=0.9,id;q=0.8")).toBe("en");
    expect(negotiateLocale("fr-FR,fr;q=0.9,id;q=0.5,en;q=0.4")).toBe("id");
    expect(negotiateLocale("en;q=0.5, id;q=0.6")).toBe("id");
    expect(negotiateLocale("in")).toBe("id");
  });

  it("is null when nothing matches or the header is missing", () => {
    expect(negotiateLocale("fr, de;q=0.5")).toBeNull();
    expect(negotiateLocale("id;q=0")).toBeNull();
    expect(negotiateLocale("")).toBeNull();
    expect(negotiateLocale(null)).toBeNull();
    expect(negotiateLocale(undefined)).toBeNull();
  });
});

describe("isLocale", () => {
  it("accepts the supported locales only", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("id")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe("mergeMessages", () => {
  it("keeps English for keys the translation doesn't have, and drops keys English doesn't have", () => {
    const en = { a: "A", nested: { b: "B", c: "C" }, d: { e: "E" } };
    const id = { a: "A-id", nested: { b: "B-id" }, d: "not an object", extra: "X", f: { g: "G" } };
    expect(mergeMessages(en, id)).toEqual({ a: "A-id", nested: { b: "B-id", c: "C" }, d: { e: "E" } });
    expect(en.nested.b).toBe("B");
  });
});

describe("translateServerMessage", () => {
  it("translates known domain messages and patterns into Indonesian", () => {
    expect(translateServerMessage("An organization needs at least one owner", "id")).toBe(
      "Organisasi harus memiliki minimal satu pemilik",
    );
    expect(translateServerMessage("Job not found", "id")).toBe("Pekerjaan tidak ditemukan");
    expect(translateServerMessage("Gadget not found", "id")).toBe("Gadget tidak ditemukan");
    expect(translateServerMessage("A job can't move from New to Completed", "id")).toBe(
      "Status pekerjaan tidak dapat diubah dari Baru menjadi Selesai",
    );
    expect(translateServerMessage("Add up to 3 photos", "id")).toBe("Tambahkan maksimal 3 foto");
    expect(translateServerMessage("A void invoice can't be paid online", "id")).toBe(
      "Faktur dibatalkan tidak dapat dibayar online",
    );
  });

  it("leaves English and unknown messages as they are", () => {
    expect(translateServerMessage("Job not found", "en")).toBe("Job not found");
    expect(translateServerMessage("Something new", "id")).toBe("Something new");
  });
});

describe("zodErrorMap", () => {
  const t = (key: string, values?: Record<string, string | number>) =>
    values ? `${key}(${Object.values(values).join(",")})` : key;
  const schema = z.object({
    name: z.string().min(1),
    code: z.string().min(3).max(5),
    email: z.email(),
    url: z.url(),
    hex: z.string().regex(/^#/),
    n: z.number().int().min(1).max(9),
    p: z.number().positive(),
    list: z.array(z.string()).min(2).max(3),
    kind: z.enum(["a", "b"]),
    count: z.number(),
    missing: z.string(),
    flag: z.boolean(),
  });
  const messages = (input: unknown) => {
    const r = schema.safeParse(input, { error: zodErrorMap(t) });
    return Object.fromEntries((r.error?.issues ?? []).map((i) => [i.path.join("."), i.message]));
  };

  it("uses plain messages for the common checks", () => {
    expect(
      messages({
        name: "",
        code: "ab",
        email: "x",
        url: "nope",
        hex: "1",
        n: 0,
        p: 0,
        list: ["a"],
        kind: "c",
        count: "1",
        flag: true,
      }),
    ).toEqual({
      name: "required",
      code: "minLength(3)",
      email: "email",
      url: "url",
      hex: "format",
      n: "min(1)",
      p: "above(0)",
      list: "minItems(2)",
      kind: "choose",
      count: "number",
      missing: "required",
    });
    expect(messages({ code: "abcdef", n: 10, list: ["a", "b", "c", "d"] })).toMatchObject({
      code: "maxLength(5)",
      n: "max(9)",
      list: "maxItems(3)",
    });
  });

  it("says the value is invalid for anything else", () => {
    expect(messages({ flag: "yes" }).flag).toBe("invalid");
  });
});
