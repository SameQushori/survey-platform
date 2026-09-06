import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const targetEnvironment = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
const allowedEnvironments = new Set([
  "staging-public",
  "staging-organizer",
  "production-public",
  "production-organizer",
]);

if (!targetEnvironment || !allowedEnvironments.has(targetEnvironment)) {
  throw new Error(`Expected one of: ${[...allowedEnvironments].join(", ")}`);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? 1}`)));
  });
}

const buildScript = fileURLToPath(new URL("./build-cloudflare.mjs", import.meta.url));
const wranglerCli = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

await run(process.execPath, [buildScript, targetEnvironment]);
await run(process.execPath, [
  wranglerCli,
  "deploy",
  "--config",
  "dist/vecta/wrangler.json",
  ...(dryRun ? ["--dry-run"] : []),
]);
