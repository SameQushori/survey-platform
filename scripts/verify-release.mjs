import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workspace = process.cwd();
const trackedResult = spawnSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: workspace, encoding: "utf8" },
);
if (trackedResult.status !== 0) throw new Error(trackedResult.stderr || "Unable to list repository files");

const trackedFiles = trackedResult.stdout.split("\0").filter(Boolean);
const existingTrackedFiles = trackedFiles.filter((file) => existsSync(resolve(workspace, file)));
const retiredArtifacts = new Set([
  "CACHE_FIX.md",
  "FIXES_SUMMARY.md",
  "RESPONSIVE_IMPROVEMENTS.md",
  "SURVEY_FIX.md",
  "UI_IMPROVEMENTS.md",
  "firestore.rules",
  "survey_platform_homepage.html",
]);
const forbiddenTracked = existingTrackedFiles.filter((file) =>
  retiredArtifacts.has(file)
  || /(^|\/)\.env(?:\.|$)/.test(file)
  || /(^|\/)\.dev\.vars(?:\.|$)/.test(file)
  || /(^|\/)\.wrangler(?:\/|$)/.test(file)
  || /(^|\/)(coverage|dist)(?:\/|$)/.test(file),
);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

const builtFiles = await walk(resolve(workspace, "dist")).catch(() => []);
const forbiddenBuildFiles = builtFiles.filter((file) =>
  /(^|[\\/])\.env(?:\..*)?$/.test(file)
  || /(^|[\\/])\.dev\.vars(?:\..*)?$/.test(file),
);

const secretPatterns = [
  { label: "Brevo API key", value: /xkeysib-[A-Za-z0-9_-]{16,}/g },
  { label: "Resend API key", value: /re_[A-Za-z0-9_-]{20,}/g },
  { label: "private key", value: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];
const secretMatches = [];
async function scanForSecrets(files, labelPath) {
  for (const file of files) {
    const relativeFile = labelPath(file);
    if (relativeFile === "worker-configuration.d.ts" || relativeFile === "package-lock.json") continue;
    if (/\.(?:png|jpe?g|webp|woff2?|ico|pdf|zip|cpuprofile)$/i.test(file)) continue;
    const content = await readFile(file, "utf8").catch(() => "");
    for (const pattern of secretPatterns) {
      pattern.value.lastIndex = 0;
      if (pattern.value.test(content)) secretMatches.push(`${relativeFile}: ${pattern.label}`);
    }
  }
}

await scanForSecrets(
  existingTrackedFiles.map((file) => resolve(workspace, file)),
  (file) => file.slice(workspace.length + 1).replaceAll("\\", "/"),
);
await scanForSecrets(
  builtFiles,
  (file) => `dist/${file.slice(resolve(workspace, "dist").length + 1).replaceAll("\\", "/")}`,
);

const failures = [
  ...forbiddenTracked.map((file) => `forbidden tracked artifact: ${file}`),
  ...forbiddenBuildFiles.map((file) => `secret file copied to build: ${file}`),
  ...secretMatches.map((match) => `possible secret in Git: ${match}`),
];
if (failures.length > 0) throw new Error(`Release verification failed:\n${failures.join("\n")}`);

console.log(`Release verification passed: ${existingTrackedFiles.length} repository files, ${builtFiles.length} build files checked.`);
