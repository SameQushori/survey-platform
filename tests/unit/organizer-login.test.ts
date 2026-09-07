import { describe, expect, it } from "vitest";

import {
  clerkErrorCode,
  organizerAuthDestination,
  organizerLoginUrl,
  requiresOrganizerHandoff,
  requiresSignUpTransfer,
} from "../../src/vecta/organizerLogin";

describe("organizer login routing", () => {
  const publicOrigin = "https://vecta-staging-public.example.workers.dev";
  const organizerOrigin = "https://vecta-staging-organizer.example.workers.dev";

  it("hands public users to the configured organizer host", () => {
    const target = organizerLoginUrl(publicOrigin, `${organizerOrigin}/`);

    expect(target).toBe(`${organizerOrigin}/login`);
    expect(requiresOrganizerHandoff(publicOrigin, target)).toBe(true);
  });

  it("keeps organizer login on the current organizer host", () => {
    const target = organizerLoginUrl(organizerOrigin, organizerOrigin);

    expect(target).toBe(`${organizerOrigin}/login`);
    expect(requiresOrganizerHandoff(organizerOrigin, target)).toBe(false);
  });

  it("keeps local development login on the current origin", () => {
    expect(organizerLoginUrl("http://127.0.0.1:5173")).toBe("http://127.0.0.1:5173/login");
  });
});

describe("organizer auth callback", () => {
  it("allows only organizer workspace destinations", () => {
    expect(organizerAuthDestination("/app")).toBe("/app");
    expect(organizerAuthDestination("/app/tests/onboarding/edit?tab=settings")).toBe("/app/tests/onboarding/edit?tab=settings");
    expect(organizerAuthDestination("/join")).toBe("/app");
    expect(organizerAuthDestination("//example.com/app")).toBe("/app");
    expect(organizerAuthDestination("https://example.com/app")).toBe("/app");
  });

  it("reads Clerk error codes from direct and response-shaped errors", () => {
    expect(clerkErrorCode({ code: "code_incorrect" })).toBe("code_incorrect");
    expect(clerkErrorCode({ errors: [{ code: "sign_up_if_missing_transfer" }] })).toBe("sign_up_if_missing_transfer");
    expect(clerkErrorCode(new Error("unknown"))).toBe("");
  });

  it("recognizes a sign-in that Clerk needs to transfer to sign-up", () => {
    expect(requiresSignUpTransfer({ code: "sign_up_if_missing_transfer" }, false)).toBe(true);
    expect(requiresSignUpTransfer(null, true)).toBe(true);
    expect(requiresSignUpTransfer({ code: "code_incorrect" }, false)).toBe(false);
  });
});
