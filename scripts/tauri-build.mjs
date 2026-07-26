#!/usr/bin/env node
/**
 * Local/CI wrapper for `tauri build`.
 *
 * With createUpdaterArtifacts:true, Tauri requires TAURI_SIGNING_PRIVATE_KEY.
 * - Default / local: disable updater artifacts so MSI/NSIS still build.
 * - Signed: `--signed`, or when TAURI_SIGNING_PRIVATE_KEY is already in the env
 *   (CI). Loads ~/.tauri/nexttorrent.key or scripts/tauri-signing.key if needed.
 *
 * Usage:
 *   node scripts/tauri-build.mjs
 *   node scripts/tauri-build.mjs --signed
 *   node scripts/tauri-build.mjs -- --bundles nsis
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriCli = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const argv = process.argv.slice(2);
const forceSigned = argv.includes("--signed");
const passthrough = argv.filter((a) => a !== "--signed");

const keyCandidates = [
  process.env.TAURI_SIGNING_PRIVATE_KEY_PATH,
  path.join(os.homedir(), ".tauri", "nexttorrent.key"),
  path.join(root, "scripts", "tauri-signing.key"),
].filter(Boolean);

function loadPrivateKeyFromDisk() {
  for (const keyPath of keyCandidates) {
    if (fs.existsSync(keyPath)) {
      process.env.TAURI_SIGNING_PRIVATE_KEY = fs
        .readFileSync(keyPath, "utf8")
        .trim();
      console.log(`Using signing key from ${keyPath}`);
      return true;
    }
  }
  return false;
}

const envHasKey = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY?.trim());
const wantSigned = forceSigned || envHasKey;

if (wantSigned && !envHasKey) {
  if (!loadPrivateKeyFromDisk()) {
    console.error(
      "Signed build requested but no private key found.\n" +
        "Set TAURI_SIGNING_PRIVATE_KEY, or place the key at:\n" +
        `  ${path.join(os.homedir(), ".tauri", "nexttorrent.key")}\n` +
        "  or scripts/tauri-signing.key",
    );
    process.exit(1);
  }
}

const args = ["build", ...passthrough];
let unsignedConfigPath = null;
if (!wantSigned) {
  // Merge config file — avoids Windows shell mangling of inline JSON / paths.
  unsignedConfigPath = path.join(root, "src-tauri", ".tauri-build-unsigned.json");
  fs.writeFileSync(
    unsignedConfigPath,
    `${JSON.stringify({ bundle: { createUpdaterArtifacts: false } }, null, 2)}\n`,
  );
  args.push("-c", unsignedConfigPath);
  console.log(
    "Building without updater signatures.\n" +
      "For a signed release build: npm run build:win:signed " +
      "(requires key + TAURI_SIGNING_PRIVATE_KEY_PASSWORD if protected).",
  );
} else if (!process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  console.log(
    "Note: TAURI_SIGNING_PRIVATE_KEY_PASSWORD is unset. " +
      "If the key is password-protected, set it before building.",
  );
}

const result = spawnSync(process.execPath, [tauriCli, ...args], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

if (unsignedConfigPath) {
  try {
    fs.unlinkSync(unsignedConfigPath);
  } catch {
    /* ignore */
  }
}

process.exit(result.status ?? 1);
