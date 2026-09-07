import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.resolve("migrations")),
          TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
          ATTEMPT_TOKEN_SECRET: "worker-test-attempt-secret-with-enough-entropy",
        },
      },
    })),
  ],
  test: {
    include: ["tests/worker/**/*.test.ts"],
    setupFiles: ["./tests/worker/apply-migrations.ts", "./tests/worker/network-setup.ts"],
  },
});
