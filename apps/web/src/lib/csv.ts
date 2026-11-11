// CSV exports (jobs, dashboard reports, audit log) stay in English whatever the reader's language (SET-05): their
// column names and values are stable keys for spreadsheets and scripts, like the REST API.

/**
 * One CSV cell (RFC 4180). Values that a spreadsheet would run as a formula (=, +, -, @, tab, carriage
 * return at the start) get a leading apostrophe so exported data can't execute in Excel or Sheets.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(values: (string | number | null | undefined)[]): string {
  return `${values.map(csvCell).join(",")}\r\n`;
}
