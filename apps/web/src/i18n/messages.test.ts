import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every namespace has the same keys in English and Bahasa Indonesia, with the same ICU arguments (SET-05). A
// missing key would fall back to English at runtime; this keeps translations from drifting silently.

const MESSAGES = path.join(import.meta.dirname, "../../messages");
const LOCALES = ["en", "id"] as const;

// 0.4 namespaces: English first, translated after the release's slices are merged.
const NOT_YET_TRANSLATED = new Set(["billing", "reports", "recurrences", "assistant"]);

type Tree = { [key: string]: string | Tree };

function load(locale: string, ns: string): Tree {
  return JSON.parse(readFileSync(path.join(MESSAGES, locale, `${ns}.json`), "utf8")) as Tree;
}

function flatten(tree: Tree, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[full] = value;
    else flatten(value, full, out);
  }
  return out;
}

/**
 * The arguments of an ICU message: `name`, `name:type`, each `select` option (`name:select:key`) and rich-text tags
 * (`<b>`). Plural options aren't compared: Indonesian has only `other`.
 */
export function icuArguments(message: string): string[] {
  const out = new Set<string>();
  let i = 0;
  const skipSpace = () => {
    while (i < message.length && /\s/.test(message[i]!)) i++;
  };
  const text = (depth: number): void => {
    while (i < message.length) {
      const c = message[i]!;
      if (c === "'") {
        const next = message[i + 1];
        if (next === "'") i += 2;
        else if (next === "{" || next === "}" || next === "#" || next === "<") {
          const end = message.indexOf("'", i + 1);
          i = end === -1 ? message.length : end + 1;
        } else i++;
      } else if (c === "{") {
        i++;
        argument();
      } else if (c === "}") {
        if (depth > 0) return;
        throw new Error(`unbalanced } at ${i}`);
      } else {
        const tag = c === "<" ? /^<\/?([a-zA-Z][a-zA-Z0-9]*)>/.exec(message.slice(i)) : null;
        if (tag) {
          out.add(`<${tag[1]}>`);
          i += tag[0].length;
        } else i++;
      }
    }
    if (depth > 0) throw new Error("unclosed {");
  };
  const argument = () => {
    let name = "";
    while (i < message.length && message[i] !== "," && message[i] !== "}") name += message[i++];
    name = name.trim();
    if (i >= message.length) throw new Error(`unclosed argument ${name}`);
    if (message[i] === "}") {
      i++;
      out.add(name);
      return;
    }
    i++;
    let type = "";
    while (i < message.length && message[i] !== "," && message[i] !== "}") type += message[i++];
    type = type.trim();
    out.add(`${name}:${type}`);
    if (message[i] === "}") {
      i++;
      return;
    }
    i++;
    if (type === "plural" || type === "select" || type === "selectordinal") {
      for (;;) {
        skipSpace();
        if (i >= message.length) throw new Error("unclosed options");
        if (message[i] === "}") {
          i++;
          return;
        }
        let key = "";
        while (i < message.length && !/[\s{]/.test(message[i]!)) key += message[i++];
        if (key.startsWith("offset:")) continue;
        skipSpace();
        if (message[i] !== "{") throw new Error(`option ${key} has no message`);
        i++;
        if (type === "select") out.add(`${name}:select:${key}`);
        text(1);
        i++;
      }
    }
    let depth = 1;
    while (i < message.length && depth > 0) {
      if (message[i] === "{") depth++;
      else if (message[i] === "}") depth--;
      i++;
    }
  };
  text(0);
  return [...out].sort();
}

const namespaces = readdirSync(path.join(MESSAGES, "en"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

describe("message files", () => {
  it("exist for every namespace in both languages, and request.ts registers each one", () => {
    for (const locale of LOCALES) {
      const files = readdirSync(path.join(MESSAGES, locale)).filter((f) => f.endsWith(".json"));
      expect(files.map((f) => f.replace(/\.json$/, "")).sort(), locale).toEqual(namespaces);
    }
    const request = readFileSync(path.join(import.meta.dirname, "request.ts"), "utf8");
    for (const ns of namespaces) {
      expect(request, ns).toContain(`messages/en/${ns}.json`);
      expect(request, ns).toContain(`messages/id/${ns}.json`);
    }
  });

  for (const ns of namespaces.filter((n) => !NOT_YET_TRANSLATED.has(n))) {
    it(`${ns}: Indonesian has the same keys and ICU arguments as English`, () => {
      const en = flatten(load("en", ns));
      const id = flatten(load("id", ns));
      expect(Object.keys(id).sort()).toEqual(Object.keys(en).sort());
      for (const [key, english] of Object.entries(en)) {
        expect(id[key]!.trim(), `${ns}.${key} is empty`).not.toBe("");
        expect(icuArguments(id[key]!), `${ns}.${key}`).toEqual(icuArguments(english));
      }
    });
  }

  it("parse as ICU messages", () => {
    for (const locale of LOCALES)
      for (const ns of namespaces)
        for (const [key, message] of Object.entries(flatten(load(locale, ns))))
          expect(() => icuArguments(message), `${locale}/${ns}.${key}`).not.toThrow();
  });
});

describe("icuArguments", () => {
  it("lists arguments, select options and tags, but not plural options", () => {
    expect(icuArguments("Hi {name}, {count, plural, one {# job} other {# jobs}}")).toEqual([
      "count:plural",
      "name",
    ]);
    expect(icuArguments("{d, select, approved {OK} other {No}} <b>{n, number}</b>")).toEqual([
      "<b>",
      "d:select",
      "d:select:approved",
      "d:select:other",
      "n:number",
    ]);
    expect(icuArguments("It''s '{literal}' text")).toEqual([]);
    expect(() => icuArguments("broken {name")).toThrow();
    expect(() => icuArguments("broken }")).toThrow();
  });
});
