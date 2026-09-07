import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const organizerOrigins = {
  "staging-public": "https://vecta-staging-organizer.alimbekov1234567890.workers.dev",
  "staging-organizer": "https://vecta-staging-organizer.alimbekov1234567890.workers.dev",
  "production-public": "https://vecta-organizer.alimbekov1234567890.workers.dev",
  "production-organizer": "https://vecta-organizer.alimbekov1234567890.workers.dev",
};
const allowedEnvironments = new Set(Object.keys(organizerOrigins));
const targetEnvironment = process.argv[2];

if (!targetEnvironment || !allowedEnvironments.has(targetEnvironment)) {
  throw new Error(`Expected one of: ${[...allowedEnvironments].join(", ")}`);
}

const viteCli = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const child = spawn(process.execPath, [viteCli, "build"], {
  env: {
    ...process.env,
    CLOUDFLARE_ENV: targetEnvironment,
    VITE_ORGANIZER_ORIGIN: organizerOrigins[targetEnvironment],
  },
  stdio: "inherit",
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});

if (exitCode !== 0) process.exitCode = exitCode;
