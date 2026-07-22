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
  },
  {
    directory: path.resolve("..", "execution"),
    name: "@dromio/execution",
  },
  {
    directory: path.resolve("..", "thread", "service"),
    name: "@dromio/thread-service",
  },
  {
    directory: path.resolve("..", "trigger"),
    name: "@dromio/trigger",
  },
  {
    directory: path.resolve("..", "workflow", "canvas-protocol"),
    name: "@dromio/workflow-canvas-protocol",
  },
] as const;
const tempParent = process.env.WORKFLOW_SDK_PACKAGE_TEMP_PARENT || os.tmpdir();
const tempRoot = await mkdtemp(path.join(tempParent, "workflow-sdk-package-"));
const bunTempDir = path.join(tempRoot, "tmp");
const releaseArtifactDir = process.env.WORKFLOW_RELEASE_ARTIFACT_DIR;
const packageArtifactDir = releaseArtifactDir ? path.resolve(releaseArtifactDir) : tempRoot;
await mkdir(bunTempDir, { recursive: true });

try {
  if (!releaseArtifactDir) {
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
  }
  const protocolsTarball = await findTarball(packageArtifactDir, "@dromio/protocols");
  const protocolTarball = await findTarball(packageArtifactDir, "@dromio/workflow-room-protocol");
  const workflowKernelTarball = await findTarball(packageArtifactDir, "@dromio/workflow-kernel");
  const sdkTarball = await findTarball(packageArtifactDir, "@dromio/workflow");
  const localDependencyTarballs = Object.fromEntries(
    await Promise.all(localDependencyPackages.map(async (dependency) => [
      dependency.name,
      `file:${await findTarball(packageArtifactDir, dependency.name)}`,
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
    devDependencies: {
      "@modelcontextprotocol/sdk": "1.29.0",
      "@opentui/core": "0.2.6",
      "@opentui/solid": "0.2.6",
      "@types/node": "24.13.2",
      typescript: "5.9.3",
    },
    overrides: {
      "@dromio/protocols": `file:${protocolsTarball}`,
      "@dromio/workflow-kernel": `file:${workflowKernelTarball}`,
      "@dromio/workflow-room-protocol": `file:${protocolTarball}`,
      ...localDependencyTarballs,
    },
    private: true,
    type: "module",
  }, null, 2));

  run("bun", ["install", "--ignore-scripts"], consumerDir);
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
  await writeFile(
    path.join(consumerDir, "workflow.ts"),
    [
      'import { step, workflow } from "@dromio/workflow";',
      'import { z } from "zod";',
      '',
      'const greet = step({',
      '  id: "greet",',
      '  input: { name: z.string() },',
      '  output: { message: z.string() },',
      '  run: ({ input }) => ({ message: `Hello, ${input.name}!` }),',
      '});',
      '',
      'const greetingWorkflow = workflow({',
      '  catalog: [greet],',
      '  document: {',
      '    edges: [',
      '      { id: "trigger-to-greet", source: "trigger", target: "greet" },',
      '      { id: "greet-to-end", source: "greet", target: "end" },',
      '    ],',
      '    end: { id: "end", output: { message: { jsonSchema: { type: "string" } } }, type: "result" },',
      '    id: "greeting-workflow",',
      '    nodes: [{ catalogItemId: greet.id, id: "greet" }],',
      '    trigger: { id: "trigger", input: { name: { jsonSchema: { type: "string" } } }, type: "manual" },',
      '    version: 1,',
      '  },',
      '});',
      '',
      'const session = await greetingWorkflow.start({ name: "Dromio" });',
      'if (session.status !== "completed" || session.state.message !== "Hello, Dromio!") {',
      '  throw new Error(`Unexpected workflow result: ${JSON.stringify(session.state)}`);',
      '}',
      'console.log(session.state.message);',
      '',
    ].join("\n"),
  );
  await writeFile(path.join(consumerDir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      module: "NodeNext",
      moduleResolution: "NodeNext",
      noEmit: true,
      strict: true,
      target: "ES2022",
    },
    include: ["workflow.ts"],
  }, null, 2));
  const tsc = path.join(consumerDir, "node_modules", "typescript", "bin", "tsc");
  run("node", [tsc, "--project", "tsconfig.json"], consumerDir);
  run("bun", ["workflow.ts"], consumerDir);
  console.log("Verified @dromio/workflow package tarball.");
} finally {
  await rm(tempRoot, {
    force: true,
    recursive: true,
  });
}

async function findTarball(directory: string, packageName: string): Promise<string> {
  for (const entry of (await readdir(directory)).filter((value) => value.endsWith(".tgz")).sort()) {
    const tarball = path.join(directory, entry);
    const result = spawnSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" });
    if (result.status !== 0) continue;
    const manifest = JSON.parse(result.stdout) as { name?: string };
    if (manifest.name === packageName) return tarball;
  }
  throw new Error(`Package artifacts do not contain ${packageName}.`);
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
