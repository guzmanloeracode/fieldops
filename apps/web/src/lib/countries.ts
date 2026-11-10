/** Countries offered in address and organization forms. Names come from Intl, so they stay localized. */
export const COUNTRY_CODES = [
  "US",
  "ID",
  "AU",
  "CA",
  "GB",
  "IE",
  "NZ",
  "SG",
  "MY",
  "PH",
  "TH",
  "VN",
  "IN",
  "AE",
  "SA",
  "DE",
  "FR",
  "NL",
  "ES",
  "IT",
  "SE",
  "NO",
  "DK",
  "JP",
  "KR",
  "BR",
  "MX",
  "ZA",
] as const;

export function countryOptions(locale = "en"): { code: string; name: string }[] {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  return COUNTRY_CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) =>
    a.code === "US" || a.code === "ID"
      ? -1
      : b.code === "US" || b.code === "ID"
        ? 1
        : a.name.localeCompare(b.name),
  );
}

export function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [
      "UTC",
      "America/Chicago",
      "America/New_York",
      "America/Los_Angeles",
      "Europe/London",
      "Asia/Jakarta",
      "Asia/Singapore",
    ];
  }
}
