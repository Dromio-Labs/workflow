import {readFile, readdir} from "node:fs/promises";
import path from "node:path";
import {gzipSync} from "node:zlib";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const uiChunkNames = (await readdir(path.join(root, "dist")))
  .filter((name) => name.endsWith(".js") && name !== "chat-shell-contracts.js");
const uiChunks = await Promise.all(
  uiChunkNames.map((name) => readFile(path.join(root, "dist", name))),
);
const uiBytes = uiChunks.reduce((total, bytes) => total + bytes.length, 0);
const uiGzipBytes = uiChunks.reduce(
  (total, bytes) => total + gzipSync(bytes, {level: 9}).length,
  0,
);
const uiBudget = {
  maxBytes: 2400 * 1024,
  maxGzipBytes: 450 * 1024,
};
const budgets = [
  {
    file: "dist/chat-shell-contracts.js",
    maxBytes: 8 * 1024,
    maxGzipBytes: 3 * 1024,
    note: "Unversioned contract entry budget covers the tiny compatibility forwarder only.",
  },
  {
    file: "dist/chat-shell-contracts/v1.js",
    maxBytes: 145 * 1024,
    maxGzipBytes: 35 * 1024,
    note: "Versioned v1 contract entry budget includes the bundled schema runtime.",
  },
];

const failures = [];

if (uiBytes > uiBudget.maxBytes) {
  failures.push(`UI chunk graph is ${formatBytes(uiBytes)} raw; budget is ${formatBytes(uiBudget.maxBytes)}.`);
}
if (uiGzipBytes > uiBudget.maxGzipBytes) {
  failures.push(`UI chunk graph is ${formatBytes(uiGzipBytes)} gzip; budget is ${formatBytes(uiBudget.maxGzipBytes)}.`);
}
console.log(
  `UI chunk graph (${uiChunkNames.sort().join(", ")}): ${formatBytes(uiBytes)} raw / ` +
    `${formatBytes(uiGzipBytes)} gzip (budgets ${formatBytes(uiBudget.maxBytes)} raw / ` +
    `${formatBytes(uiBudget.maxGzipBytes)} gzip). Includes the lazy Streamdown renderer and bounded Shiki highlighter; ` +
    "React peers remain external.",
);

for (const budget of budgets) {
  const bytes = await readFile(path.join(root, budget.file));
  const gzipBytes = gzipSync(bytes, {level: 9}).length;

  if (bytes.length > budget.maxBytes) {
    failures.push(`${budget.file} is ${formatBytes(bytes.length)} raw; budget is ${formatBytes(budget.maxBytes)}.`);
  }

  if (gzipBytes > budget.maxGzipBytes) {
    failures.push(`${budget.file} is ${formatBytes(gzipBytes)} gzip; budget is ${formatBytes(budget.maxGzipBytes)}.`);
  }

  console.log(
    `${budget.file}: ${formatBytes(bytes.length)} raw / ${formatBytes(gzipBytes)} gzip ` +
      `(budgets ${formatBytes(budget.maxBytes)} raw / ${formatBytes(budget.maxGzipBytes)} gzip). ${budget.note}`,
  );
}

if (failures.length > 0) {
  throw new Error(`Package bundle budget failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}

console.log("Package bundle budgets passed.");

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
