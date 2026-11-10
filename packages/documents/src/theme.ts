import { Font, StyleSheet } from "@react-pdf/renderer";
import { INTER_BOLD, INTER_REGULAR } from "./fonts.generated";

// Fonts, colors and shared styles of the branded documents (FIN-04).

export const FONT = "Inter";

let registered = false;
/** Registers the embedded fonts once per process. Words are never hyphenated (Indonesian rules differ). */
export function registerFonts(): void {
  if (registered) return;
  Font.register({
    family: FONT,
    fonts: [
      { src: INTER_REGULAR, fontWeight: 400 },
      { src: INTER_BOLD, fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

export const DEFAULT_ACCENT = "#0369a1";
export const INK = "#0f172a";
export const MUTED = "#64748b";
export const RULE = "#e2e8f0";
export const ZEBRA = "#f8fafc";
export const DANGER = "#b91c1c";
export const SUCCESS = "#15803d";

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

const toHex = (rgb: number[]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

/** WCAG relative luminance of an sRGB color. */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const mix = (rgb: [number, number, number], target: number, t: number) =>
  rgb.map((c) => c + (target - c) * t) as [number, number, number];

export interface Accent {
  /** The brand color, for bars and the monogram. */
  fill: string;
  /** Text on the brand color: white or near-black, whichever reads better. */
  onFill: string;
  /** The brand color darkened until it reads as text on white (at least 4.5:1). */
  text: string;
  /** A light tint for table headers and boxes. */
  tint: string;
}

/** Colors derived from the organization's brand color; an invalid or missing color uses the default accent. */
export function accentFor(brandColor: string | null): Accent {
  const rgb = (brandColor && parseHex(brandColor)) || parseHex(DEFAULT_ACCENT)!;
  const l = luminance(rgb);
  let text = rgb;
  for (let t = 0; contrast(luminance(text), 1) < 4.5 && t <= 1; t += 0.1) text = mix(rgb, 0, t);
  return {
    fill: toHex(rgb),
    onFill: contrast(l, 1) >= contrast(l, luminance([15, 23, 42])) ? "#ffffff" : INK,
    text: toHex(text),
    tint: toHex(mix(rgb, 255, 0.9)),
  };
}

/** Up to two initials for the monogram when the organization has no logo: "Acme Air & Clean" → "AA". */
export function monogram(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase());
  return letters.join("") || "•";
}

export const styles = StyleSheet.create({
  page: {
    fontFamily: FONT,
    fontSize: 9,
    color: INK,
    paddingTop: 36,
    paddingBottom: 56,
    paddingHorizontal: 40,
    // No lineHeight here: an inherited unitless line height breaks the dynamic page-number text.
  },
  bar: { position: "absolute", top: 0, left: 0, right: 0, height: 5 },
  muted: { color: MUTED },
  small: { fontSize: 8 },
  bold: { fontWeight: 700 },
  h2: { fontSize: 10, fontWeight: 700, marginBottom: 4 },
  paragraph: { fontSize: 9, lineHeight: 1.45 },
  label: { fontSize: 7.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 },
  section: { marginTop: 16 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: MUTED,
    borderTopWidth: 0.5,
    borderTopColor: RULE,
    paddingTop: 6,
  },
});
