import { describe, expect, it } from "vitest";
import { csvCell, neutralizeSpreadsheetFormula } from "../../shared/csv";

describe("CSV spreadsheet safety", () => {
  it.each([
    ["=HYPERLINK(\"https://example.test\")", "'=HYPERLINK(\"https://example.test\")"],
    [" +SUM(1,2)", "' +SUM(1,2)"],
    ["-1+2", "'-1+2"],
    ["@cmd", "'@cmd"],
    ["\t=1+1", "'\t=1+1"],
  ])("neutralizes a formula-like value", (input, expected) => {
    expect(neutralizeSpreadsheetFormula(input)).toBe(expected);
  });

  it("keeps normal values and escapes CSV quotes", () => {
    expect(neutralizeSpreadsheetFormula("Анна Петрова")).toBe("Анна Петрова");
    expect(csvCell('Участник "А"')).toBe('"Участник ""А"""');
  });
});
