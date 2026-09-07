export const ORGANIZER_OTP_LENGTH = 6;

export function emptyOrganizerOtp(): string[] {
  return Array.from({ length: ORGANIZER_OTP_LENGTH }, () => "");
}

export function normalizeOrganizerOtp(value: string): string {
  return value.replace(/\D/g, "").slice(0, ORGANIZER_OTP_LENGTH);
}

export function fillOrganizerOtp(current: readonly string[], startIndex: number, value: string): string[] {
  const next = [...current].slice(0, ORGANIZER_OTP_LENGTH);
  while (next.length < ORGANIZER_OTP_LENGTH) next.push("");

  const digits = normalizeOrganizerOtp(value);
  digits.slice(0, ORGANIZER_OTP_LENGTH - startIndex).split("").forEach((digit, offset) => {
    next[startIndex + offset] = digit;
  });
  return next;
}

export function clearOrganizerOtpDigit(current: readonly string[], index: number): string[] {
  const next = [...current];
  next[index] = "";
  return next;
}
