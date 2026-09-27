/**
 * Packages dist/ into a Chrome Web Store upload-ready zip:
 *   super-debug-extension-v<version>.zip
 *
 * Uses the system `zip` CLI (available on macOS/Linux) to avoid extra deps.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, access, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

try {
  await access(dist);
} catch {
  console.error("[zip] dist/ not found. Run `npm run build` first.");
  process.exit(1);
}

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const zipName = `super-debug-extension-v${pkg.version}.zip`;
const zipPath = join(root, zipName);

await rm(zipPath, { force: true });

// Zip the CONTENTS of dist/ (so the archive root is the extension root, not a dist/ folder).
await run("zip", ["-r", "-X", "-q", zipPath, "."], { cwd: dist });

console.log(`[zip] Created ${zipName} (upload-ready) at repo root`);
