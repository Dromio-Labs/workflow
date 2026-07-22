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
import {
  headlessWorkflowSource,
  representativeWorkflowSource,
} from "./verify-package-workflow-fixtures.js";

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
  const localPackageOverrides = {
    "@dromio/protocols": `file:${protocolsTarball}`,
    "@dromio/workflow-kernel": `file:${workflowKernelTarball}`,
    "@dromio/workflow-room-protocol": `file:${protocolTarball}`,
    ...localDependencyTarballs,
  };
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
    },
    overrides: localPackageOverrides,
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
    representativeWorkflowSource(),
    /* The expanded bundle smoke is covered by judgment-clarification-lifecycle.test.ts.
    [
      'import { step, workflow } from "@dromio/workflow";',
      'import { z } from "zod";',
      '',
      'for (const builder of [workflow.judge, workflow.judgeUntil, workflow.clarifyUntil]) {',
      '  if (typeof builder !== "function") throw new Error("Missing workflow bundle builder.");',
      '}',
      'if (typeof step.evaluate !== "function" || typeof step.promptedContract !== "function") {',
      '  throw new Error("Missing compatibility authoring aliases.");',
      '}',
      '',
      'const evaluationContract = z.object({',
      '  message: z.string().optional(),',
      '  nextAction: z.enum(["ask", "suggest", "confirm", "revise", "execute", "complete", "cancel"]),',
      '  score: z.number().min(0).max(1),',
      '  status: z.enum(["pass", "needs_input", "revise", "fail"]),',
      '});',
      'const blockersContract = z.array(z.object({ id: z.string(), message: z.string() }));',
      'const candidateContract = z.object({ ready: z.boolean(), text: z.string() });',
      'const scorePolicy = {',
      '  gaps: [],',
      '  gates: [',
      '    { id: "pass", minScore: 0.8, nextAction: "complete", status: "pass" },',
      '    { id: "revise", minScore: 0, nextAction: "revise", status: "revise" },',
      '  ],',
      '  id: "package.score",',
      '  risks: [],',
      '  satisfies: [],',
      '} as const;',
      'const assessor = step({',
      '  id: "package.assess",',
      '  input: { candidate: candidateContract },',
      '  output: { evaluation: evaluationContract },',
      '  run: ({ input }) => ({ evaluation: input.candidate.ready',
      '    ? { nextAction: "complete" as const, score: 1, status: "pass" as const }',
      '    : { nextAction: "revise" as const, score: 0.4, status: "revise" as const },',
      '  }),',
      '});',
      'const packageJudge = workflow.judge({',
      '  assessor,',
      '  id: "package.judge",',
      '  input: { candidate: candidateContract },',
      '  policy: scorePolicy,',
      '});',
      'if (packageJudge.graph().nodes.map((node) => node.id).join(",") !== "assess,gate") {',
      '  throw new Error("workflow.judge did not author its real assessor and gate nodes.");',
      '}',
      'const packageJudgeRun = await packageJudge.start({ candidate: { ready: true, text: "ready" } });',
      'if (packageJudgeRun.status !== "completed" || (packageJudgeRun.state.decision as { status?: string })?.status !== "completed") {',
      '  throw new Error("workflow.judge did not run from the public package.");',
      '}',
      'const packageJudgeUntil = workflow.judgeUntil({',
      '  id: "package.judge-until",',
      '  input: { request: z.string() },',
      '  judge: packageJudge,',
      '  maxAttempts: 2,',
      '  produce: step({',
      '    id: "package.produce",',
      '    input: { request: z.string() },',
      '    output: { candidate: candidateContract },',
      '    run: ({ input }) => ({ candidate: { ready: false, text: input.request } }),',
      '  }),',
      '  revise: step({',
      '    id: "package.revise",',
      '    input: { candidate: candidateContract, evaluation: evaluationContract },',
      '    output: { candidate: candidateContract },',
      '    run: ({ input }) => ({ candidate: { ...input.candidate, ready: true } }),',
      '  }),',
      '});',
      'const packageJudgeUntilRun = await packageJudgeUntil.start({ request: "draft" });',
      'if (packageJudgeUntilRun.status !== "completed" || packageJudgeUntilRun.state.attempts !== 2) {',
      '  throw new Error("workflow.judgeUntil did not author and execute its revision loop.");',
      '}',
      'const packageClarifyJudge = workflow.judge({',
      '  assessor: step({',
      '    id: "package.contract-assess",',
      '    input: { contract: candidateContract },',
      '    output: { evaluation: evaluationContract },',
      '    run: () => ({ evaluation: { nextAction: "complete" as const, score: 1, status: "pass" as const } }),',
      '  }),',
      '  id: "package.contract-judge",',
      '  input: { contract: candidateContract },',
      '  policy: scorePolicy,',
      '});',
      'const packageClarify = workflow.clarifyUntil({',
      '  answer: z.string().min(1),',
      '  blockers: blockersContract,',
      '  contract: candidateContract,',
      '  id: "package.clarify",',
      '  input: { request: z.string() },',
      '  judge: packageClarifyJudge,',
      '  maxRounds: 2,',
      '  merge: ({ contract }) => ({ blockers: [], contract }),',
      '  question: () => ({ id: "detail", prompt: "Add detail", type: "text" }),',
      '  resolve: step({',
      '    id: "package.resolve",',
      '    input: { request: z.string() },',
      '    output: { blockers: blockersContract, contract: candidateContract },',
      '    run: ({ input }) => ({ blockers: [], contract: { ready: true, text: input.request } }),',
      '  }),',
      '  revise: step({',
      '    id: "package.contract-revise",',
      '    input: { blockers: blockersContract, contract: candidateContract },',
      '    output: { blockers: blockersContract, contract: candidateContract },',
      '    run: ({ input }) => input,',
      '  }),',
      '});',
      'const packageClarifyRun = await packageClarify.start({ request: "typed contract" });',
      'if (packageClarifyRun.status !== "completed" || (packageClarifyRun.state.contract as { text?: string })?.text !== "typed contract") {',
      '  throw new Error("workflow.clarifyUntil did not author and execute from the public package.");',
      '}',
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
      'const research = step.delegate({',
      '  capabilities: ["browser", "search"],',
      '  context: ({ input }) => ({ topic: input.topic }),',
      '  id: "research",',
      '  input: { topic: z.string() },',
      '  instructions: ({ input }) => `Research ${input.topic}`,',
      '  output: { report: z.string() },',
      '});',
      '',
      'const researchWorkflow = workflow({',
      '  catalog: [research],',
      '  document: {',
      '    edges: [',
      '      { id: "trigger-to-research", source: "trigger", target: "research" },',
      '      { id: "research-to-end", source: "research", target: "end" },',
      '    ],',
      '    end: { id: "end", output: { report: { jsonSchema: { type: "string" } } }, type: "result" },',
      '    id: "research-workflow",',
      '    nodes: [{ catalogItemId: research.id, id: "research" }],',
      '    trigger: { id: "trigger", input: { topic: { jsonSchema: { type: "string" } } }, type: "manual" },',
      '    version: 1,',
      '  },',
      '  input: { topic: z.string() },',
      '  output: { report: z.string() },',
      '});',
      '',
      'const delegated = await researchWorkflow.start({ topic: "Dromio" });',
      'const handoff = delegated.pendingHooks[0];',
      'if (delegated.status !== "waiting" || handoff?.kind !== "handoff_requested") {',
      '  throw new Error(`Unexpected delegated workflow state: ${delegated.status}`);',
      '}',
      'await delegated.resumeHook({ token: handoff.token, value: { report: "Verified" } });',
      'const completedDelegation = delegated.snapshot();',
      'if (completedDelegation.status !== "completed" || delegated.state.report !== "Verified") {',
      '  throw new Error(`Unexpected delegated result: ${JSON.stringify(delegated.state)}`);',
      '}',
      'console.log(delegated.state.report);',
      '',
    ].join("\n"), */
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
  await verifyHeadlessIsolatedTarball(
    tempRoot,
    sdkTarball,
    localPackageOverrides,
  );
  console.log("Verified @dromio/workflow package tarball.");
} finally {
  await rm(tempRoot, {
    force: true,
    recursive: true,
  });
}

async function verifyHeadlessIsolatedTarball(
  parent: string,
  sdkTarball: string,
  overrides: Readonly<Record<string, string>>,
): Promise<void> {
  const consumerDir = path.join(parent, "headless-isolated-consumer");
  await mkdir(consumerDir);
  await writeFile(path.join(consumerDir, "package.json"), JSON.stringify({
    dependencies: {
      "@dromio/workflow": `file:${sdkTarball}`,
      zod: "4.4.3",
    },
    name: "workflow-sdk-headless-isolated-smoke",
    overrides,
    private: true,
    type: "module",
  }, null, 2));
  await writeFile(
    path.join(consumerDir, "headless.mjs"),
    headlessWorkflowSource(),
  );
  run("bun", [
    "install",
    "--ignore-scripts",
    "--linker=isolated",
    "--omit=peer",
    "--omit=optional",
  ], consumerDir);
  await assertPublishedDependencySpec(consumerDir);
  run("bun", ["headless.mjs"], consumerDir);
  console.log("Verified no-hoist headless package graph with the supported Bun runtime.");
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
  if (sdkPackageJson.dependencies?.["cron-parser"] !== "5.5.0") {
    throw new Error("@dromio/workflow must own cron-parser@5.5.0 as an exact runtime dependency.");
  }
  if (sdkPackageJson.dependencies?.typescript !== "5.9.3") {
    throw new Error("@dromio/workflow must own typescript@5.9.3 as an exact runtime dependency.");
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
