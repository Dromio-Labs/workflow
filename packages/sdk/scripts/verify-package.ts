#!/usr/bin/env bun

import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  spawnSync,
} from "node:child_process";

type ExportTarget = {import: string; require?: string; types: string};

const packageManifest = JSON.parse(await readFile("package.json", "utf8")) as {
  exports: Record<string, ExportTarget>;
};
const packageSpecifiers = Object.keys(packageManifest.exports).map((subpath) => (
  subpath === "." ? "@dromio/workflow" : `@dromio/workflow/${subpath.slice(2)}`
));
const commonJsPackageSpecifiers = Object.entries(packageManifest.exports)
  .filter(([, target]) => target.require !== undefined)
  .map(([subpath]) => `@dromio/workflow/${subpath.slice(2)}`);

const protocolDir = path.resolve("..", "room", "protocol");
const protocolsDir = path.resolve("..", "protocols");
const workflowKernelDir = path.resolve("..", "workflow", "kernel");
const localDependencyPackages = [
  {
    directory: path.resolve("..", "shell", "chat-shell-ui"),
    name: "@dromio/chat-shell-ui",
    tarballPrefix: "dromio-chat-shell-ui-",
  },
  {
    directory: path.resolve("..", "execution"),
    name: "@dromio/execution",
    tarballPrefix: "dromio-execution-",
  },
  {
    directory: path.resolve("..", "thread", "service"),
    name: "@dromio/thread-service",
    tarballPrefix: "dromio-thread-service-",
  },
  {
    directory: path.resolve("..", "trigger"),
    name: "@dromio/trigger",
    tarballPrefix: "dromio-trigger-",
  },
  {
    directory: path.resolve("..", "workflow", "canvas-protocol"),
    name: "@dromio/workflow-canvas-protocol",
    tarballPrefix: "dromio-workflow-canvas-protocol-",
  },
] as const;
const tempParent = process.env.WORKFLOW_SDK_PACKAGE_TEMP_PARENT ?? "/private/tmp";
const tempRoot = await mkdtemp(path.join(tempParent || os.tmpdir(), "workflow-sdk-package-"));
const bunTempDir = path.join(tempRoot, "tmp");
await mkdir(bunTempDir, { recursive: true });

try {
  run("bun", ["run", "build"], protocolsDir);
  run("bun", ["pm", "pack", "--destination", tempRoot, "--ignore-scripts"], protocolsDir);
  run("bun", ["run", "build"], protocolDir);
  run("bun", ["pm", "pack", "--destination", tempRoot, "--ignore-scripts"], protocolDir);
  run("bun", ["run", "build"], workflowKernelDir);
  run("bun", ["pm", "pack", "--destination", tempRoot, "--ignore-scripts"], workflowKernelDir);
  run("bun", ["run", "build"]);
  for (const dependency of localDependencyPackages) {
    run("bun", ["pm", "pack", "--destination", tempRoot, "--ignore-scripts"], dependency.directory);
  }
  run("bun", ["pm", "pack", "--destination", tempRoot, "--ignore-scripts"]);
  const protocolsTarball = await findTarball(tempRoot, "dromio-protocols-");
  const protocolTarball = await findTarball(tempRoot, "dromio-workflow-room-protocol-");
  const workflowKernelTarball = await findTarball(tempRoot, "dromio-workflow-kernel-");
  const sdkTarball = await findTarball(tempRoot, "dromio-workflow-");
  const localDependencyTarballs = Object.fromEntries(
    await Promise.all(localDependencyPackages.map(async (dependency) => [
      dependency.name,
      `file:${await findTarball(tempRoot, dependency.tarballPrefix)}`,
    ])),
  );
  const consumerDir = path.join(tempRoot, "consumer");
  await mkdir(consumerDir);
  await writeFile(path.join(consumerDir, "package.json"), JSON.stringify({
    dependencies: {
      "@dromio/workflow": `file:${sdkTarball}`,
      "@dromio/protocols": `file:${protocolsTarball}`,
      "@dromio/workflow-kernel": `file:${workflowKernelTarball}`,
      "@dromio/workflow-room-protocol": `file:${protocolTarball}`,
      ...localDependencyTarballs,
    },
    name: "workflow-sdk-package-smoke",
    overrides: {
      "@dromio/protocols": `file:${protocolsTarball}`,
      "@dromio/workflow-kernel": `file:${workflowKernelTarball}`,
      "@dromio/workflow-room-protocol": `file:${protocolTarball}`,
      ...localDependencyTarballs,
    },
    private: true,
    type: "module",
  }, null, 2));

  run("bun", ["install"], consumerDir);
  await assertPublishedDependencySpec(consumerDir);
  await writeFile(
    path.join(consumerDir, "smoke.mjs"),
    [
      "const specifiers = " + JSON.stringify(packageSpecifiers) + ";",
      "for (const specifier of specifiers) {",
      "  await import(specifier);",
      "}",
      "console.log(`imported ${specifiers.length} public entry points`);",
      "",
    ].join("\n"),
  );
  run("bun", ["smoke.mjs"], consumerDir);
  await writeFile(
    path.join(consumerDir, "smoke.cjs"),
    [
      "const specifiers = " + JSON.stringify(commonJsPackageSpecifiers) + ";",
      "for (const specifier of specifiers) {",
      "  require(specifier);",
      "}",
      "console.log(`required ${specifiers.length} public entry points`);",
      "",
    ].join("\n"),
  );
  run("node", ["smoke.cjs"], consumerDir);
  console.log("Verified @dromio/workflow package tarball.");
} finally {
  await rm(tempRoot, {
    force: true,
    recursive: true,
  });
}

async function findTarball(directory: string, prefix: string): Promise<string> {
  const entries = await readdir(directory);
  const tarball = entries.find((entry) =>
    entry.startsWith(prefix) && entry.endsWith(".tgz")
  );
  if (!tarball) throw new Error(`bun pm pack did not produce a ${prefix}*.tgz file.`);
  return path.join(directory, tarball);
}

async function assertPublishedDependencySpec(consumerDir: string): Promise<void> {
  const sdkPackageJsonPath = path.join(
    consumerDir,
    "node_modules",
    "@dromio",
    "workflow",
    "package.json",
  );
  const sdkPackageJson = JSON.parse(await readFile(sdkPackageJsonPath, "utf8")) as {
    bin?: Record<string, string> | string;
    dependencies?: Record<string, string>;
  };
  if (sdkPackageJson.bin !== undefined) {
    throw new Error("@dromio/workflow package must not publish a command-line bin.");
  }
  const protocolSpec = sdkPackageJson.dependencies?.["@dromio/workflow-room-protocol"];
  if (typeof protocolSpec !== "string" || protocolSpec.startsWith("file:")) {
    throw new Error(
      `@dromio/workflow package must depend on a publishable @dromio/workflow-room-protocol version, got ${protocolSpec ?? "missing"}.`,
    );
  }
}

function run(command: string, args: string[], cwd = process.cwd()): void {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      BUN_TMPDIR: bunTempDir,
      TEMP: bunTempDir,
      TMP: bunTempDir,
      TMPDIR: bunTempDir,
    },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
