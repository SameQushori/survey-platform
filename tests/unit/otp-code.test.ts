import { describe, expect, it } from "vitest";

import {
  clearOrganizerOtpDigit,
  emptyOrganizerOtp,
  fillOrganizerOtp,
  normalizeOrganizerOtp,
} from "../../src/vecta/otpCode";

describe("organizer OTP input", () => {
  it("keeps only the first six digits", () => {
    expect(normalizeOrganizerOtp(" 12-34 56abc78 ")).toBe("123456");
  });

  it("distributes pasted digits from the selected cell", () => {
    expect(fillOrganizerOtp(["1", "", "", "", "", ""], 1, "23 45-6")).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
  });

  it("does not overflow the six cells", () => {
    expect(fillOrganizerOtp(emptyOrganizerOtp(), 4, "9876")).toEqual(["", "", "", "", "9", "8"]);
  });

  it("clears a single cell without shifting the remaining code", () => {
    expect(clearOrganizerOtpDigit(["1", "2", "3", "4", "5", "6"], 2)).toEqual([
      "1",
      "2",
      "",
      "4",
      "5",
      "6",
    ]);
  });
});
