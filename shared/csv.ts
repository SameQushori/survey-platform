export function neutralizeSpreadsheetFormula(value: string): string {
  const normalized = value.replaceAll("\0", "");
  const firstVisible = normalized.trimStart()[0] ?? "";
  return ["=", "+", "-", "@"].includes(firstVisible) ? `'${normalized}` : normalized;
}

export function csvCell(value: string | number | null): string {
  const normalized = neutralizeSpreadsheetFormula(value === null ? "" : String(value));
  return `"${normalized.replaceAll('"', '""')}"`;
}

export function csvRow(values: ReadonlyArray<string | number | null>): string {
  return values.map(csvCell).join(",");
}
