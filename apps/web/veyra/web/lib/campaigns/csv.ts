export function safeSpreadsheetValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "object"
      ? JSON.stringify(value)
      : typeof value === "string"
        ? value
        : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function csvCell(value: unknown): string {
  return `"${safeSpreadsheetValue(value).replaceAll('"', '""')}"`;
}
