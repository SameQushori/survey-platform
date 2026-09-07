import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const organizerOrigins = {
  "staging-public": "https://vecta-staging-organizer.alimbekov1234567890.workers.dev",
  "staging-organizer": "https://vecta-staging-organizer.alimbekov1234567890.workers.dev",
  "production-public": "https://vecta-organizer.alimbekov1234567890.workers.dev",
  "production-organizer": "https://vecta-organizer.alimbekov1234567890.workers.dev",
};
const allowedEnvironments = new Set(Object.keys(organizerOrigins));
const targetEnvironment = process.argv[2];
const checkOnly = process.argv.includes("--check-only");

if (!targetEnvironment || !allowedEnvironments.has(targetEnvironment)) {
  throw new Error(`Expected one of: ${[...allowedEnvironments].join(", ")}`);
}

const fileEnvironment = loadEnv("production", process.cwd(), "");
const clerkPublishableKey = (
  process.env.VITE_CLERK_PUBLISHABLE_KEY
  ?? fileEnvironment.VITE_CLERK_PUBLISHABLE_KEY
  ?? ""
).trim();
const expectedClerkKeyPrefix = targetEnvironment.startsWith("production-")
  ? "pk_live_"
  : "pk_test_";

if (!clerkPublishableKey) {
  throw new Error("VITE_CLERK_PUBLISHABLE_KEY is required for Cloudflare builds");
}

if (!clerkPublishableKey.startsWith(expectedClerkKeyPrefix)) {
  const expectedInstance = expectedClerkKeyPrefix === "pk_live_" ? "Production" : "Development";
  throw new Error(
    `${targetEnvironment} requires a Clerk ${expectedInstance} publishable key (${expectedClerkKeyPrefix}*)`,
  );
}

const encodedFrontendApi = clerkPublishableKey.slice(expectedClerkKeyPrefix.length);
const decodedFrontendApi = Buffer.from(encodedFrontendApi, "base64url")
  .toString("utf8")
  .replace(/\$$/, "");
let clerkFrontendApiUrl;

try {
  clerkFrontendApiUrl = new URL(`https://${decodedFrontendApi}`);
} catch {
  throw new Error("Clerk publishable key does not contain a valid Frontend API hostname");
}

if (
  !decodedFrontendApi
  || clerkFrontendApiUrl.hostname !== decodedFrontendApi
  || clerkFrontendApiUrl.protocol !== "https:"
) {
  throw new Error("Clerk publishable key does not contain a valid Frontend API hostname");
}

if (checkOnly) process.exit(0);

const viteCli = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const child = spawn(process.execPath, [viteCli, "build"], {
  env: {
    ...process.env,
    CLOUDFLARE_ENV: targetEnvironment,
    VITE_ORGANIZER_ORIGIN: organizerOrigins[targetEnvironment],
    VITE_CLERK_PUBLISHABLE_KEY: clerkPublishableKey,
  },
  stdio: "inherit",
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});

if (exitCode !== 0) {
  process.exitCode = exitCode;
} else {
  const headersTemplatePath = fileURLToPath(new URL("./cloudflare-headers.template", import.meta.url));
  const headersOutputPath = fileURLToPath(new URL("../dist/client/_headers", import.meta.url));
  const headersTemplate = await readFile(headersTemplatePath, "utf8");
  const renderedHeaders = headersTemplate.replaceAll(
    "{{CLERK_FAPI_ORIGIN}}",
    clerkFrontendApiUrl.origin,
  );

  await writeFile(headersOutputPath, renderedHeaders, "utf8");
}
