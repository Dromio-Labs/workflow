import {spawnSync} from "node:child_process";
import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCache = await mkdtemp(path.join(os.tmpdir(), "chatshell-npm-cache-"));

try {
  const pack = spawnSync("npm", ["--cache", npmCache, "pack", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8",
  });

  if (pack.status !== 0) {
    throw new Error(`npm pack --dry-run failed:\n${pack.stdout}\n${pack.stderr}`);
  }

  const payload = JSON.parse(pack.stdout);
  const packageReview = payload[0];
  const files = packageReview.files.map((file) => file.path).sort();
  const fileSet = new Set(files);

  const requiredFiles = [
    "package.json",
    "README.md",
    "dist/chat-shell.js",
    "dist/chat-shell.d.ts",
    "dist/chat-shell-contracts.js",
    "dist/chat-shell-contracts.d.ts",
    "dist/chat-shell-contracts/v1.js",
    "dist/chat-shell-contracts-v1.d.ts",
    "dist/styles.css",
  ];
  const missing = requiredFiles.filter((file) => !fileSet.has(file));

  const forbidden = files.filter((file) => {
    const lower = file.toLowerCase();
    return (
      lower === "index.html" ||
      lower.startsWith("dist-demo/") ||
      lower.startsWith("public/") ||
      lower.startsWith("test-results/") ||
      lower.startsWith("tests/") ||
      lower.startsWith("src/") ||
      lower.includes("/mock") ||
      lower.includes("mock-backend") ||
      lower.includes("fixture") ||
      lower.includes("showcase") ||
      lower.includes("demo.css") ||
      lower.includes("_next/")
    );
  });

  if (missing.length > 0 || forbidden.length > 0) {
    throw new Error(
      [
        "Packed package output review failed.",
        `Missing required files: ${missing.join(", ") || "none"}.`,
        `Forbidden files: ${forbidden.join(", ") || "none"}.`,
      ].join("\n"),
    );
  }

  console.log(
    `Packed output review passed: ${packageReview.entryCount} files, ${formatBytes(packageReview.unpackedSize)} unpacked.`,
  );
} finally {
  await rm(npmCache, {force: true, recursive: true});
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
