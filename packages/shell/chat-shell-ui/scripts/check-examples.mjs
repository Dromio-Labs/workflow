import {spawnSync} from "node:child_process";
import {readFile, readdir, rm} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {assertSpawnSucceeded, resolveWorkspaceBinary} from "./package-harness-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = path.join(root, "examples");
const forbiddenPatterns = [
  "../../src/",
  "../src/",
  "chat-shell-mock-backend",
  "streamingMode",
  "ChatShellStreamingMode",
];

const files = await listFiles(examplesRoot);
const failures = [];

for (const file of files) {
  if (!/\.(ts|tsx|md)$/.test(file)) {
    continue;
  }

  const source = await readFile(path.join(examplesRoot, file), "utf8");
  for (const pattern of forbiddenPatterns) {
    if (source.includes(pattern)) {
      failures.push(`${path.join("examples", file)} contains forbidden consumer example text: ${pattern}`);
    }
  }
}

const protectedBackendExamples = [
  {
    forbidden: [
      "../shared",
      "createMinimalChatShellManifest",
      "chat-shell-mock-backend",
      "mockChatShell",
      "DemoChatShell",
      "src/data",
      "src/showcase",
    ],
    name: "BYO backend control-plane example",
    required: [
      "@dromio/chat-shell-ui",
      "@dromio/chat-shell-ui/chat-shell-contracts/v1",
      "ChatShellManifestSchema",
      "chatShellSchemaVersion",
    ],
    root: "byo-backend-control-plane",
  },
];

for (const example of protectedBackendExamples) {
  const exampleFiles = files.filter((file) => file.startsWith(`${example.root}/`) && /\.(ts|tsx|md)$/.test(file));
  const combinedSource = (await Promise.all(
    exampleFiles.map((file) => readFile(path.join(examplesRoot, file), "utf8")),
  )).join("\n");

  if (!combinedSource) {
    failures.push(`${example.name} is missing or has no TypeScript/Markdown files.`);
    continue;
  }

  for (const pattern of example.forbidden) {
    if (combinedSource.includes(pattern)) {
      failures.push(`${example.name} must not depend on development/mock helpers: ${pattern}`);
    }
  }

  for (const pattern of example.required) {
    if (!combinedSource.includes(pattern)) {
      failures.push(`${example.name} must keep backend-owned manifest validation evidence: ${pattern}`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Example package import check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}

const tsc = resolveWorkspaceBinary(root, "tsc");
const typecheck = spawnSync(tsc, ["--noEmit", "-p", path.join(examplesRoot, "tsconfig.json")], {
  cwd: root,
  encoding: "utf8",
});

assertSpawnSucceeded(typecheck, "Example package typecheck");

const buildExamples = ["basic-render", "renderer-registration"];
const vite = resolveWorkspaceBinary(root, "vite");

try {
  for (const example of buildExamples) {
    const exampleRoot = path.join(examplesRoot, example);
    const build = spawnSync(vite, ["build", "--config", "vite.config.ts"], {
      cwd: exampleRoot,
      encoding: "utf8",
    });

    assertSpawnSucceeded(build, `Example ${example} production build`);
  }
} finally {
  await Promise.all(
    buildExamples.map((example) => rm(path.join(examplesRoot, example, "dist"), {force: true, recursive: true})),
  );
}

console.log("Example package smoke passed.");

async function listFiles(dir, prefix = "") {
  const entries = await readdir(dir, {withFileTypes: true});
  const files = [];

  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(dir, entry.name), relative));
    } else {
      files.push(relative);
    }
  }

  return files.sort();
}
