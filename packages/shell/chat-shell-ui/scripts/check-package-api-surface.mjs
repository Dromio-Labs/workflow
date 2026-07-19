import {existsSync} from "node:fs";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const snapshotPath = path.join(root, "docs/chat-shell/api-surface.md");

if (!existsSync(dist)) {
  throw new Error("dist is missing. Run npm run build before npm run check:package:api-surface.");
}

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const rootTypes = await readDeclaration("chat-shell.d.ts");
const contractsTypes = await readDeclaration("chat-shell-contracts.d.ts");
const v1Types = await readDeclaration("chat-shell-contracts-v1.d.ts");
const snapshot = formatSnapshot({
  exports: Object.keys(packageJson.exports ?? {}).sort(),
  packageName: packageJson.name,
  root: collectExports(rootTypes),
  unversionedContractsForwarder: contractsTypes.includes('export * from "./chat-shell-contracts-v1.js"'),
  v1: collectExports(v1Types),
  version: packageJson.version,
});

if (!existsSync(snapshotPath)) {
  throw new Error(`API surface snapshot is missing at docs/chat-shell/api-surface.md.\n\nExpected contents:\n${snapshot}`);
}

const existing = await readFile(snapshotPath, "utf8");
if (normalizeNewlines(existing) !== normalizeNewlines(snapshot)) {
  throw new Error([
    "API surface snapshot is stale. Update docs/chat-shell/api-surface.md intentionally when public exports change.",
    "",
    "Expected contents:",
    snapshot,
  ].join("\n"));
}

console.log("Package API surface snapshot passed.");

async function readDeclaration(file) {
  const fullPath = path.join(dist, file);
  if (!existsSync(fullPath)) {
    throw new Error(`dist is missing expected declaration: ${file}`);
  }

  return readFile(fullPath, "utf8");
}

function collectExports(source) {
  return {
    types: collectNamedExports(source, true),
    values: collectNamedExports(source, false),
  };
}

function collectNamedExports(source, typeOnly) {
  const names = new Set();
  const pattern = /export\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+["'][^"']+["']/g;
  let match;

  while ((match = pattern.exec(source))) {
    const isTypeExport = Boolean(match[1]);

    if (isTypeExport !== typeOnly) {
      continue;
    }

    for (const item of match[2].split(",")) {
      const name = normalizeExportName(item);

      if (name) {
        names.add(name);
      }
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

function normalizeExportName(raw) {
  const cleaned = raw.trim();
  if (!cleaned) {
    return undefined;
  }

  const alias = cleaned.split(/\s+as\s+/).at(-1)?.trim();
  return alias || cleaned;
}

function formatSnapshot(details) {
  return `${[
    "# ChatShell API Surface Snapshot",
    "",
    "This snapshot is generated from built declaration files and package exports by `npm run check:package:api-surface`.",
    "It is a private-beta stability guard: update it only when a public package export change is intentional.",
    "",
    `Package: \`${details.packageName}@${details.version}\``,
    "",
    "## Package Exports",
    "",
    ...formatList(details.exports),
    "",
    "## Root UI Entry",
    "",
    "Import path: `@dromio/chat-shell-ui` or `@dromio/chat-shell-ui/chat-shell`",
    "",
    "### Values",
    "",
    ...formatList(details.root.values),
    "",
    "### Types",
    "",
    ...formatList(details.root.types),
    "",
    "## Contracts Entry",
    "",
    "Import path: `@dromio/chat-shell-ui/chat-shell-contracts`",
    "",
    details.unversionedContractsForwarder
      ? "- forwards to `@dromio/chat-shell-ui/chat-shell-contracts/v1`"
      : "- does not forward to the versioned v1 contract entry",
    "",
    "## Versioned V1 Contracts Entry",
    "",
    "Import path: `@dromio/chat-shell-ui/chat-shell-contracts/v1`",
    "",
    "### Values",
    "",
    ...formatList(details.v1.values),
    "",
    "### Types",
    "",
    ...formatList(details.v1.types),
    "",
  ].join("\n")}\n`;
}

function formatList(items) {
  return items.length > 0 ? items.map((item) => `- \`${item}\``) : ["- none"];
}

function normalizeNewlines(source) {
  return source.replace(/\r\n/g, "\n").replace(/\n+$/, "\n");
}
