import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const uiEntry = await readFile(path.join(root, "dist", "chat-shell.js"), "utf8");
const contractEntry = await readFile(path.join(root, "dist", "chat-shell-contracts.js"), "utf8");
const versionedContractEntry = await readFile(path.join(root, "dist", "chat-shell-contracts", "v1.js"), "utf8");

if (!uiEntry.startsWith("\"use client\";") && !uiEntry.startsWith("'use client';")) {
  throw new Error('dist/chat-shell.js must start with "use client" so SSR consumers see the UI entry as client-only.');
}

if (contractEntry.startsWith("\"use client\";") || contractEntry.startsWith("'use client';")) {
  throw new Error("dist/chat-shell-contracts.js must remain server-importable and must not carry a client directive.");
}

if (versionedContractEntry.startsWith("\"use client\";") || versionedContractEntry.startsWith("'use client';")) {
  throw new Error("dist/chat-shell-contracts/v1.js must remain server-importable and must not carry a client directive.");
}

for (const exportKey of [".", "./chat-shell"]) {
  if (packageJson.exports?.[exportKey]?.["react-server"]) {
    throw new Error(`${exportKey} must not advertise a react-server condition; ChatShell is a client entry.`);
  }
}

const contracts = await import("@dromio/chat-shell-ui/chat-shell-contracts/v1");

if (contracts.chatShellSchemaVersion !== "chat-shell.v1") {
  throw new Error("Server-side contract import returned the wrong schema version.");
}

if (typeof contracts.ChatShellManifestSchema?.parse !== "function") {
  throw new Error("Server-side contract import did not expose ChatShellManifestSchema.parse.");
}

console.log("Package SSR/client-boundary smoke passed.");
