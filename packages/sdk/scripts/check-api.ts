import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  exports?: Record<string, string | { import?: string; require?: string; types?: string }>;
};

const failures: string[] = [];

const requiredPackageExports = new Map([
  [".", "./dist/src/sdk/index.js"],
  ["./app", "./dist/src/sdk/client/interactions/workflow-app.js"],
  ["./core", "./dist/src/sdk/core/index.js"],
  ["./workflow-control-plane", "./dist/src/sdk/workflow-control-plane/index.js"],
  ["./workflow-control-plane/control-plane", "./dist/src/sdk/workflow-control-plane/control-plane.js"],
  ["./workflow-control-plane/http", "./dist/src/sdk/workflow-control-plane/http.js"],
  ["./workflow-control-plane/in-memory-signal-store", "./dist/src/sdk/workflow-control-plane/in-memory-signal-store.js"],
  ["./workflow-control-plane/json-trigger-store", "./dist/src/sdk/workflow-control-plane/json-trigger-store.js"],
  ["./workflow-control-plane/runtime-store-contracts", "./dist/src/sdk/workflow-control-plane/runtime-store-contracts.js"],
  ["./workflow-control-plane/runtime-store-conformance", "./dist/src/sdk/workflow-control-plane/runtime-store-conformance.js"],
  ["./workflow-control-plane/sqlite-runtime-store", "./dist/src/sdk/workflow-control-plane/sqlite-runtime-store.js"],
  ["./workflow-control-plane/types", "./dist/src/sdk/workflow-control-plane/types.js"],
  ["./workflow-control-plane/worker", "./dist/src/sdk/workflow-control-plane/worker.js"],
  ["./distribution", "./dist/src/sdk/distribution/index.js"],
  ["./init/workbench", "./dist/src/sdk/init/workbench.js"],
  ["./agents/runtime", "./dist/src/sdk/agents/runtime/index.js"],
  ["./client-surfaces", "./dist/src/sdk/client-surfaces/index.js"],
  ["./product", "./dist/src/sdk/product/index.js"],
  ["./tools/surface", "./dist/src/sdk/tools/surface/index.js"],
  ["./client", "./dist/src/sdk/client/index.js"],
  ["./client/workflow-field-svg", "./dist/src/sdk/client/workflow-field-svg/index.js"],
  ["./client/workflow-render", "./dist/src/sdk/client/workflow-render/index.js"],
  ["./client/workflow-room", "./dist/src/sdk/client/workflow-room/index.js"],
  ["./client/opentui-merman", "./dist/src/sdk/client/interactions/workflow-opentui-merman-renderer.js"],
  ["./client/workflow-tui-test-surface", "./dist/src/sdk/client/workflow-tui-test-surface.js"],
  ["./client/workflow-tui-shell-test-surface", "./dist/src/sdk/client/workflow-tui-shell-test-surface.js"],
  ["./react", "./dist/src/sdk/react/index.js"],
  ["./config", "./dist/src/sdk/config/index.js"],
]);

const requiredPackageRequireExports = new Map([
  ["./client", "./dist/cjs/client/index.cjs"],
  ["./client/workflow-field-svg", "./dist/cjs/client/workflow-field-svg/index.cjs"],
  ["./client/workflow-render", "./dist/cjs/client/workflow-render/index.cjs"],
  ["./client/workflow-room", "./dist/cjs/client/workflow-room/index.cjs"],
  ["./react", "./dist/cjs/react/index.cjs"],
]);

for (const [subpath, target] of requiredPackageExports) {
  if (packageExportImport(packageJson.exports?.[subpath]) !== target) {
    failures.push(`Missing package export ${subpath} -> ${target}`);
  }
}

for (const [subpath, target] of requiredPackageRequireExports) {
  if (packageExportRequire(packageJson.exports?.[subpath]) !== target) {
    failures.push(`Missing package require export ${subpath} -> ${target}`);
  }
}

for (const subpath of Object.keys(packageJson.exports ?? {})) {
  if (!requiredPackageExports.has(subpath)) {
    failures.push(`Unexpected package export ${subpath}`);
  }
}

const requiredPublicNames = new Map([
  ["src/sdk/index.ts", [
    "workflowApp",
    "catalog",
    "createWorkflowAppHost",
    "defineSignal",
    "promptFile",
    "runWorkflowCli",
    "runWorkflowServer",
    "runWorkflowTui",
    "step",
    "workflow",
    "AuthoredWorkflowApp",
    "AuthoredStepDefinition",
    "AuthoredWorkflow",
  ]],
  ["src/sdk/core/index.ts", [
    "loop",
    "createRuntimeStep",
    "createAiRuntimeStep",
    "createContractedRuntimeStep",
    "ask",
    "done",
    "retry",
    "goto",
    "fail",
    "createHook",
    "defineCandidateScorePolicy",
    "defineOperationContract",
    "definePromptedOperation",
    "definePromptedContractLoop",
    "defineEvaluationBar",
    "defineScorePolicy",
    "runPromptedContractLoop",
    "runPromptedOperation",
    "EvaluationBar",
    "createIntentRuntime",
    "RuntimeSessionStore",
    "LoopStore",
    "IntentRuntime",
    "RuntimeSessionSnapshot",
    "QuestionResolution",
    "CandidateEvaluation",
    "CandidateScorePolicy",
    "PromptedOperationDefinition",
    "PromptedOperationResult",
  ]],
  ["src/sdk/product/index.ts", [
    "capability",
    "capabilities",
    "domain",
    "llmCandidateEvaluator",
    "llmQuestionResolver",
    "primitive",
    "resolveIntent",
    "createWorkflow",
    "buildWorkflow",
    "streamWorkflow",
    "CapabilityPlan",
    "IntentContract",
    "WorkflowEvent",
  ]],
  ["src/sdk/client/index.ts", [
    "createClient",
    "createInteraction",
    "createQuestionFlow",
    "createTraceStream",
    "createTraceTree",
    "createTerminalTraceRenderer",
    "createOpenTuiWorkflowRenderer",
    "createTerminalWorkflowRenderer",
    "createWorkflowRunStore",
    "projectCandidateEvaluations",
    "projectEvaluationBars",
    "projectQuestionResolutions",
    "projectWorkflowRun",
    "renderTerminalWorkflowFrame",
    "runTerminalWorkflow",
    "runTerminalQuestionLoop",
    "answerTerminalQuestions",
    "defaultTerminalQuestionAnswer",
    "parseTerminalQuestionAnswer",
    "readTerminalQuestionAnswer",
    "resolveTerminalQuestionOption",
    "terminalQuestionSignature",
    "writeTerminalQuestion",
    "createHttpAdapter",
    "createHttpRoutes",
    "createExpressRouter",
    "IntentClient",
    "Interaction",
    "EvaluationBarFeedback",
    "QuestionFlow",
    "TraceStream",
    "TraceTree",
    "TerminalQuestion",
    "TerminalQuestionOptions",
    "TerminalQuestionSession",
    "TerminalTraceRenderer",
    "TerminalWorkflowRenderer",
    "TerminalWorkflowSession",
    "OpenTuiWorkflowRenderer",
    "WorkflowRunProjection",
    "WorkflowRunSemanticRow",
    "WorkflowRunStore",
    "WorkflowRunStoreSnapshot",
    "IntentHttpAdapter",
  ]],
  ["src/sdk/react/index.ts", [
    "WorkflowCanvas",
    "workflowReactCanvasAdapter",
    "WorkflowCanvasProps",
    "WorkflowReactCanvasAdapterOptions",
    "WorkflowCanvasPreview",
    "workflowReactPreviewAdapter",
    "WorkflowCanvasPreviewProps",
    "WorkflowReactPreviewAdapterOptions",
  ]],
]);

for (const [path, names] of requiredPublicNames) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  for (const name of names) {
    const starExportPattern = /export\s+\*\s+from\s+"[^"]+"/;
    const namedReexportPattern = new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`);
    const namedTypeReexportPattern = new RegExp(`export\\s+type\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`);
    if (!starExportPattern.test(source) && !namedReexportPattern.test(source) && !namedTypeReexportPattern.test(source)) {
      failures.push(`Missing public API name ${name} in ${path}`);
    }
  }
}

const nakedProviderCallFailures = [
  "src/sdk/product/intent/resolution.ts",
  "src/sdk/product/questions/llm-question-resolver.ts",
  "src/sdk/product/evaluation/llm-candidate-evaluator.ts",
].flatMap((path) => {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  if (!source.includes("runPromptedOperation")) {
    return [`${path} calls the provider path without runPromptedOperation`];
  }
  if (!source.includes("definePromptedOperation")) {
    return [`${path} does not define a prompted operation around the provider call`];
  }
  return [];
});

failures.push(...nakedProviderCallFailures);
failures.push(...await removedAuthoringApiFailures());

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("SDK API surface check passed");

async function removedAuthoringApiFailures() {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const forbidden = [
    ["legacy define step", new RegExp(`\\bdefine${"Step"}\\s*\\(`)],
    ["duplicate step manifest", new RegExp(`\\bdefine${"StepCatalogItem"}\\s*\\(`)],
    ["hidden prompted step", new RegExp(`\\bdefine${"PromptedStep"}\\s*\\(`)],
    ["manual workflow reference", new RegExp(`\\bdefine${"WorkflowReference"}\\s*\\(`)],
    ["manual fork branch", new RegExp(`\\bworkflow${"ForkBranch"}\\s*\\(`)],
    ["legacy product step", new RegExp(`\\bproduct${"Step"}\\s*\\.`)],
    ["positional runtime step", /\bstep\s*\(\s*["'`]/],
    ["removed workflow control-plane import", /@dromio\/sdk\/control-plane(?:\/|["'])/],
  ] as const;
  const glob = new Bun.Glob("**/*.{ts,tsx,js,mjs,md}");
  const findings: string[] = [];
  for await (const relativePath of glob.scan({ cwd: repoRoot })) {
    if (
      relativePath.startsWith("node_modules/")
      || relativePath.includes("/node_modules/")
      || relativePath.startsWith("dist/")
      || relativePath.includes("/dist/")
    ) continue;
    if (relativePath === "packages/sdk/scripts/check-api.ts") continue;
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    for (const [label, pattern] of forbidden) {
      if (pattern.test(source)) findings.push(`${relativePath} still uses ${label}`);
    }
  }
  return findings;
}

function packageExportImport(value: string | { import?: string } | undefined): string | undefined {
  return typeof value === "string" ? value : value?.import;
}

function packageExportRequire(
  value: string | { require?: string } | undefined,
): string | undefined {
  return typeof value === "string" ? value : value?.require;
}
