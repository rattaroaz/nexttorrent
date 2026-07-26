#!/usr/bin/env node
/**
 * Ensures Rust #[tauri::command] handler names match src/ipc/contracts.ts IPC_COMMANDS values.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const libRs = fs.readFileSync(path.join(root, "src-tauri/src/lib.rs"), "utf8");
const contractsTs = fs.readFileSync(
  path.join(root, "src/ipc/contracts.ts"),
  "utf8",
);
const clientTs = fs.readFileSync(path.join(root, "src/ipc/client.ts"), "utf8");

const handlerBlock = libRs.match(
  /invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/,
);
if (!handlerBlock) {
  console.error("Could not find generate_handler! in lib.rs");
  process.exit(1);
}

const rustCommands = [
  ...handlerBlock[1].matchAll(/::([a-z][a-z0-9_]*)[,\s]/g),
].map((m) => m[1]);

const commandsBlock = contractsTs.match(
  /export const IPC_COMMANDS = \{([\s\S]*?)\} as const;/,
);
if (!commandsBlock) {
  console.error("Could not find IPC_COMMANDS in contracts.ts");
  process.exit(1);
}

const tsCommands = [
  ...commandsBlock[1].matchAll(/:\s*"([a-z][a-z0-9_]*)"/g),
].map((m) => m[1]);

const rustSet = new Set(rustCommands);
const tsSet = new Set(tsCommands);

const missingInTs = rustCommands.filter((c) => !tsSet.has(c));
const missingInRust = [...tsSet].filter((c) => !rustSet.has(c));

if (missingInTs.length || missingInRust.length) {
  if (missingInTs.length) {
    console.error("Rust commands missing from IPC_COMMANDS:", missingInTs);
  }
  if (missingInRust.length) {
    console.error("IPC_COMMANDS not registered in Rust:", missingInRust);
  }
  process.exit(1);
}

const clientExports = [
  ...clientTs.matchAll(/export async function (\w+)/g),
].map((m) => m[1]);

const commandKeys = [...commandsBlock[1].matchAll(/^\s+(\w+):\s*"/gm)].map(
  (m) => m[1],
);

const EXPORT_OVERRIDES = {
  torrentPieceBitmapDump: "torrentPieceDump",
};

const camelToExport = (key) => EXPORT_OVERRIDES[key] ?? key;

const exportSet = new Set(clientExports);
const missingClient = commandKeys.filter(
  (k) => !exportSet.has(camelToExport(k)),
);

if (missingClient.length) {
  console.error(
    "IPC_COMMANDS keys without client.ts export:",
    missingClient.map((k) => camelToExport(k)),
  );
  process.exit(1);
}

console.log(
  `IPC contract OK (${rustCommands.length} commands, ${clientExports.length} client wrappers)`,
);
