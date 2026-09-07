import { describe, expect, it } from "vitest";

import { organizerLoginUrl, requiresOrganizerHandoff } from "../../src/vecta/organizerLogin";

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
