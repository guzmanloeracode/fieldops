/** Normalization used for duplicate detection (CUS-05). */
export function normalizeEmail(email: string | null | undefined): string | null {
  const v = email?.trim().toLowerCase();
  return v ? v : null;
}

const COUNTRY_CODES: Record<string, string> = { US: "1", ID: "62" };

/**
 * Reduces a phone number to digits with a country code, e.g. "0812-3456-789" (ID) → "628123456789",
 * "(512) 555-0142" (US) → "15125550142". Returns null for input with fewer than 6 digits.
 */
export function normalizePhone(phone: string | null | undefined, defaultCountry = "US"): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (digits.length < 6) return null;
  if (trimmed.startsWith("+")) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  const cc = COUNTRY_CODES[defaultCountry.toUpperCase()];
  if (!cc) return digits;
  if (cc === "62") {
    if (digits.startsWith("62")) return digits;
    if (digits.startsWith("0")) digits = digits.slice(1);
    return cc + digits;
  }
  if (cc === "1" && digits.length === 10) return cc + digits;
  return digits;
}
