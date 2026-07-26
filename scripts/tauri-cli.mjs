#!/usr/bin/env node
/**
 * Forwards to the Tauri CLI, routing `build` through scripts/tauri-build.mjs
 * so local builds do not fail when updater signing secrets are missing.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriCli = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const args = process.argv.slice(2);

if (args[0] === "build") {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "tauri-build.mjs"), ...args.slice(1)],
    { cwd: root, stdio: "inherit", env: process.env },
  );
  process.exit(result.status ?? 1);
}

const result = spawnSync(process.execPath, [tauriCli, ...args], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
