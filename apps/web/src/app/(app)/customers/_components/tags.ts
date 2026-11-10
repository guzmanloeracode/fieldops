/** Splits the comma-separated tag input into the shared schema's array (max 20 tags). */
export function splitTags(text: string | undefined | null): string[] {
  return (text ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
}
