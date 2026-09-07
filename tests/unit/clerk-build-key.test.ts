import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const buildScript = resolve(projectRoot, "scripts/build-cloudflare.mjs");

function checkBuildKey(target: string, publishableKey?: string) {
  return spawnSync(process.execPath, [buildScript, target, "--check-only"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      VITE_CLERK_PUBLISHABLE_KEY: publishableKey ?? "",
    },
  });
}

describe("Cloudflare Clerk build key guard", () => {
  it("accepts development keys only for staging", () => {
    expect(checkBuildKey("staging-organizer", "pk_test_bG9jYWxob3N0JA").status).toBe(0);
    expect(checkBuildKey("staging-public", "pk_live_bG9jYWxob3N0JA").status).not.toBe(0);
  });

  it("accepts production keys only for production", () => {
    expect(checkBuildKey("production-organizer", "pk_live_bG9jYWxob3N0JA").status).toBe(0);
    expect(checkBuildKey("production-public", "pk_test_bG9jYWxob3N0JA").status).not.toBe(0);
  });

  it("rejects a missing publishable key", () => {
    const result = checkBuildKey("staging-organizer");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("VITE_CLERK_PUBLISHABLE_KEY is required");
  });

  it("rejects a key without a valid Frontend API hostname", () => {
    const result = checkBuildKey("staging-organizer", "pk_test_bm90IGEgaG9zdCQ");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("valid Frontend API hostname");
  });
});
