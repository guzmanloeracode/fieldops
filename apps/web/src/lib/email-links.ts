/** Call-to-action links in an email, shown as buttons: links inside the sandboxed preview can't navigate. */
export function emailLinks(html: string): { href: string; label: string }[] {
  const links: { href: string; label: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = (m[1] ?? "").replace(/&amp;/g, "&");
    const label = (m[2] ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!label || label === href || links.some((l) => l.href === href) || !/^https?:\/\//.test(href))
      continue;
    links.push({ href, label });
  }
  return links;
}
