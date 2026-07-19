#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const debtPath = path.join(repoRoot, "scripts", "source-size-debt.json");
const sourceSizeConfigPath = path.join(repoRoot, "scripts", "source-size.config.json");
const threshold = sourceLineThreshold();
const sourceExtensions = new Set([".cts", ".cjs", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const skippedDirectories = new Set([
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  "fixtures",
  "generated",
  "gen",
  "migrations",
  "mocks",
  "node_modules",
  "out",
  "test",
  "tests",
  "__fixtures__",
  "__generated__",
  "__mocks__",
  "__tests__",
  "__workflow_step_files__",
]);

const scopes = {
  capabilities: "packages/capabilities/machine-pack",
  cloud: "packages/cloud/control-plane",
  providers: "packages/providers",
  room: "packages/room/protocol",
  runtime: "packages/runtime",
  "runtime-bun": "apps/runtime-bun",
  "runtime-host": "packages/runtime/host",
  shell: "packages/shell",
  "workflow-agent": "packages/workflow/agent-adapter",
  workflow: "packages/sdk",
  workbench: "apps/workbench",
};

const sourceSizeDebt = readSourceSizeDebt();

const scopeNames = selectedScopes();
let failed = false;

for (const scopeName of scopeNames) {
  const scopeRoot = path.join(repoRoot, scopes[scopeName]);
  const files = listSourceFiles(scopeRoot);
  const violations = [];
  const migrationDebt = [];

  for (const absolutePath of files) {
    const relativePath = posix(path.relative(repoRoot, absolutePath));
    const lineCount = sourceLineCount(fs.readFileSync(absolutePath, "utf8"));
    if (lineCount <= threshold) continue;
    const debt = sourceSizeDebt.get(relativePath);
    if (debt) {
      migrationDebt.push({ ...debt, relativePath, lineCount });
    } else {
      violations.push({ relativePath, lineCount });
    }
  }

  failed = failed || violations.length > 0;
  console.log(
    `${violations.length > 0 ? "FAIL" : "PASS"} ${scopeName}: checked ${files.length} source files.`,
  );

  for (const violation of violations) {
    console.log(
      `- ${violation.relativePath}: ${violation.lineCount} source lines exceeds ${threshold}. Split by responsibility before adding this file to the migrated workspace.`,
    );
  }

  if (migrationDebt.length > 0) {
    console.log(
      `  Explicit source-size debt remains (${migrationDebt.length} files). Split these before touching their behavior:`,
    );
    for (const debt of migrationDebt.sort((a, b) => b.lineCount - a.lineCount || a.relativePath.localeCompare(b.relativePath))) {
      console.log(`  - ${debt.relativePath}: ${debt.lineCount} source lines. LLM cleanup hint: ${debt.guidance}`);
    }
  }
}

if (failed) process.exitCode = 1;

function selectedScopes() {
  if (process.argv.includes("--all")) return Object.keys(scopes);
  const scopeIndex = process.argv.indexOf("--scope");
  if (scopeIndex === -1 || !process.argv[scopeIndex + 1]) {
    fail(`Usage: node scripts/maintainability-lint.mjs [--all|--scope <${Object.keys(scopes).join("|")}>]`);
  }
  const scopeName = process.argv[scopeIndex + 1];
  if (!scopes[scopeName]) fail(`Unknown maintainability lint scope: ${scopeName}`);
  return [scopeName];
}

function listSourceFiles(directory) {
  const files = [];
  walk(directory, files);
  return files;
}

function walk(directory, files) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) walk(absolutePath, files);
      continue;
    }
    if (!entry.isFile() || !sourceExtensions.has(path.extname(entry.name))) continue;
    if (entry.name.endsWith(".d.ts")) continue;
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) continue;
    files.push(absolutePath);
  }
}

function sourceLineCount(source) {
  return source
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith("//")).length;
}

function sourceLineThreshold() {
  const config = JSON.parse(fs.readFileSync(sourceSizeConfigPath, "utf8"));
  if (!Number.isInteger(config.sourceLineThreshold) || config.sourceLineThreshold <= 0) {
    fail("source-size.config.json must declare a positive integer sourceLineThreshold");
  }
  return config.sourceLineThreshold;
}

function readSourceSizeDebt() {
  const entries = JSON.parse(fs.readFileSync(debtPath, "utf8"));
  const debts = new Map();
  for (const entry of entries) {
    if (!entry.path || !entry.guidance) {
      fail("Every source-size debt entry must include path and guidance");
    }
    if (debts.has(entry.path)) {
      fail(`Duplicate source-size debt entry: ${entry.path}`);
    }
    debts.set(entry.path, entry);
  }
  return debts;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function posix(relativePath) {
  return relativePath.split(path.sep).join("/");
}
