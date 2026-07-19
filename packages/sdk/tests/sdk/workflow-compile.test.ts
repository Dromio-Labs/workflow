import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  compileDromioWorkbench,
  formatCompileOutput,
} from "@dromio/workflow/product";

const projects: string[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) {
    rmSync(project, { force: true, recursive: true });
  }
});

describe("dromio workflow compile", () => {
  test("writes a .dromio compile artifact with workflow facts and BDD scenarios", async () => {
    const project = createWorkbench();
    writeStarterCatalog(project);
    writeEchoWorkflow(project);
    writeGlue(project, "echo");

    const output = await compileDromioWorkbench({ cwd: project, workflowId: "echo" });

    expect(output.valid).toBe(true);
    expect(output.summary).toEqual({ compiled: 1, total: 1, written: 1 });
    expect(formatCompileOutput(output)).toContain("dromio compile passed");

    const artifact = JSON.parse(
      readFileSync(path.join(project, ".dromio", "compile", "echo.json"), "utf8"),
    ) as {
      bddScenarios: Array<{ id: string; title: string }>;
      dependencies: {
        implementationSources: Array<{ catalogItemId: string; resolvedPath: string; source: string }>;
        sideEffects: string[];
      };
      governance: { publishable: boolean; schemaGaps: string[] };
      paths: { compileArtifact: string; document: string; glue: string };
      runtimeTools: Array<{
        approval: string;
        bddScenarioIds: string[];
        dependencies: {
          configRequirementIds: string[];
          runtimeDependencies: Array<{
            catalogItemIds: string[];
            id: string;
            kind: string;
            label?: string;
            required: boolean;
          }>;
          sideEffects: string[];
        };
        description: string;
        effect: string;
        id: string;
        inputSchema: unknown;
        outputSchema: unknown;
        title: string;
        workflowId: string;
        workflowVersion: number;
      }>;
      steps: Array<{ catalogItemId: string; implementation: { source: string }; inputKeys: string[] }>;
      topology: { kind: string; reachableNodeIds: string[] };
      trigger: { input: Array<{ key: string }> };
      validation: { valid: boolean };
      workflow: { id: string };
    };

    expect(artifact.workflow.id).toBe("echo");
    expect(artifact.paths).toEqual({
      compileArtifact: ".dromio/compile/echo.json",
      document: ".dromio/workflows/echo.workflow.json",
      glue: "workflows/echo/workflow.ts",
    });
    expect(artifact.trigger.input.map((field) => field.key)).toEqual(["prompt"]);
    expect(artifact.steps).toEqual([
      expect.objectContaining({
        catalogItemId: "starter.echo-message",
        implementation: expect.objectContaining({
          source: "catalog/steps/starter/echo-message/step.ts",
        }),
        inputKeys: ["prompt"],
      }),
    ]);
    expect(artifact.dependencies.implementationSources).toEqual([
      {
        catalogItemId: "starter.echo-message",
        resolvedPath: "catalog/steps/starter/echo-message/step.ts",
        source: "catalog/steps/starter/echo-message/step.ts",
      },
    ]);
    expect(artifact.dependencies.sideEffects).toEqual(["console.write"]);
    expect(artifact.topology).toEqual(expect.objectContaining({
      kind: "linear",
      reachableNodeIds: ["echo-message"],
    }));
    expect(artifact.governance.publishable).toBe(true);
    expect(artifact.governance.schemaGaps).toEqual([
      "workflow documents do not yet declare evaluations",
      "workflow documents do not yet declare approval gates",
    ]);
    expect(artifact.validation.valid).toBe(true);
    expect(artifact.bddScenarios.map((scenario) => scenario.id)).toEqual([
      "echo.accepts-trigger-input",
      "echo.runs-catalog-steps",
      "echo.resolves-catalog-implementations",
      "echo.returns-end-output",
      "echo.reviews-side-effects",
    ]);
    expect(artifact.runtimeTools).toEqual([
      {
        approval: "on-risky",
        bddScenarioIds: [
          "echo.accepts-trigger-input",
          "echo.resolves-catalog-implementations",
          "echo.returns-end-output",
          "echo.reviews-side-effects",
          "echo.runs-catalog-steps",
        ],
        dependencies: {
          configRequirementIds: ["echo.prefix"],
          runtimeDependencies: [
            {
              catalogItemIds: ["starter.echo-message"],
              id: "echo-mode",
              kind: "env",
              label: "Echo mode",
              required: false,
            },
          ],
          sideEffects: ["console.write"],
        },
        description: "Run workflow echo.",
        effect: "write",
        id: "workflow.echo.run",
        inputSchema: {
          additionalProperties: false,
          properties: {
            prompt: { minLength: 1, type: "string" },
          },
          required: ["prompt"],
          type: "object",
        },
        outputSchema: {
          additionalProperties: false,
          properties: {
            echoResult: { type: "object" },
          },
          required: ["echoResult"],
          type: "object",
        },
        title: "echo",
        workflowId: "echo",
        workflowVersion: 1,
      },
    ]);
  });

  test("prints machine-readable CLI JSON and writes compile artifacts", async () => {
    const project = createWorkbench();
    writeStarterCatalog(project);
    writeEchoWorkflow(project);
    writeGlue(project, "echo");

    const proc = runDromioCli([
      "compile",
      "--all",
      "--json",
      "--cwd",
      project,
    ]);
    const stdout = proc.stdout;
    const stderr = proc.stderr;

    expect(stderr).toBe("");
    expect(proc.status).toBe(0);
    const parsed = JSON.parse(stdout) as { artifacts: Array<{ workflow: { id: string } }>; valid: boolean };
    expect(parsed.valid).toBe(true);
    expect(parsed.artifacts.map((artifact) => artifact.workflow.id)).toEqual(["echo"]);
    expect(readFileSync(path.join(project, ".dromio", "compile", "echo.json"), "utf8")).toContain(
      "\"artifactVersion\": 1",
    );
  });

  test("supports render-only compile facts without marking workflows publishable", async () => {
    const project = createWorkbench();
    writeStarterCatalog(project);
    writeEchoWorkflow(project);
    writeGlue(project, "echo");

    const output = await compileDromioWorkbench({
      cwd: project,
      mode: "render-only",
      workflowId: "echo",
      write: false,
    });

    expect(output.valid).toBe(true);
    expect(output.mode).toBe("render-only");
    expect(output.summary).toEqual({ compiled: 1, total: 1, written: 0 });
    expect(formatCompileOutput(output)).toContain("dromio compile (render-only) passed");
    expect(output.artifacts[0]?.validation).toEqual(expect.objectContaining({
      mode: "render-only",
      valid: true,
    }));
    expect(output.artifacts[0]?.governance.publishable).toBe(false);
    expect(output.artifacts[0]?.governance.riskNotes).toContain(
      "render-only compile does not prove publish readiness",
    );
  });

  test("keeps selected workflow compile isolated from unrelated glue errors", async () => {
    const project = createWorkbench();
    writeStarterCatalog(project);
    writeEchoWorkflow(project);
    writeGlue(project, "echo");
    writeMultiWorkflowGlue(project, "unrelated");

    const selected = await compileDromioWorkbench({
      cwd: project,
      workflowId: "echo",
      write: false,
    });

    expect(selected.valid).toBe(true);
    expect(selected.validation.workflows.map((workflow) => workflow.id)).toEqual(["echo"]);
    expect(selected.artifacts.map((artifact) => artifact.workflow.id)).toEqual(["echo"]);

    const all = await compileDromioWorkbench({ cwd: project, write: false });
    expect(all.valid).toBe(false);
    expect(all.validation.workflows.some((workflow) => workflow.id === "unrelated")).toBe(true);
  });
});

function runDromioCli(args: string[]) {
  const outputDir = mkdtempSync(path.join(tmpdir(), "dromio-cli-output-"));
  projects.push(outputDir);
  const stdoutPath = path.join(outputDir, "stdout.txt");
  const stderrPath = path.join(outputDir, "stderr.txt");
  const command = [
    ["bun", path.join(import.meta.dir, "../../../cli/src/cli.ts"), ...args]
      .map(shellQuote)
      .join(" "),
    ">",
    shellQuote(stdoutPath),
    "2>",
    shellQuote(stderrPath),
  ].join(" ");
  const result = spawnSync(
    "zsh",
    ["-lc", command],
    { encoding: "utf8" },
  );
  return {
    status: result.status,
    stderr: readFileSync(stderrPath, "utf8"),
    stdout: readFileSync(stdoutPath, "utf8"),
  };
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function createWorkbench(): string {
  const project = mkdtempSync(path.join(tmpdir(), "dromio-compile-"));
  projects.push(project);
  mkdirSync(path.join(project, ".dromio/workflows"), { recursive: true });
  mkdirSync(path.join(project, "catalog/steps/starter/echo-message"), { recursive: true });
  mkdirSync(path.join(project, "workflows/echo"), { recursive: true });
  writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "compile-fixture" }));
  return project;
}

function writeStarterCatalog(project: string): void {
  writeFileSync(path.join(project, "catalog/steps/starter/echo-message/step.ts"), "export const run = true;\n");
  writeFileSync(
    path.join(project, "catalog/index.ts"),
    [
      "export const starterCatalog = {",
      "  items() {",
      "    return [",
      "      {",
      "        configRequirements: [{ id: 'echo.prefix', inputKey: 'prefix', label: 'Echo prefix', required: true, type: 'string' }],",
      "        id: 'starter.echo-message',",
      "        label: 'Echo message',",
      "        implementation: { factory: 'createEchoMessageStep', kind: 'typescript', source: 'catalog/steps/starter/echo-message/step.ts' },",
      "        inputs: { prompt: true },",
      "        kind: 'step',",
      "        outputs: { echoResult: true },",
      "        runtimeDependencies: [{ env: 'ECHO_MODE', id: 'echo-mode', kind: 'env', label: 'Echo mode', required: false }],",
      "        sideEffects: ['console.write'],",
      "      },",
      "    ];",
      "  },",
      "};",
    ].join("\n"),
  );
}

function writeEchoWorkflow(project: string): void {
  writeFileSync(
    path.join(project, ".dromio/workflows/echo.workflow.json"),
    JSON.stringify({
      edges: [
        { id: "prompt->echo-message", source: "prompt", target: "echo-message" },
        { id: "echo-message->echo-ready", source: "echo-message", target: "echo-ready" },
      ],
      end: {
        id: "echo-ready",
        output: { echoResult: { jsonSchema: { type: "object" } } },
        type: "result",
      },
      id: "echo",
      nodes: [{ catalogItemId: "starter.echo-message", id: "echo-message" }],
      trigger: {
        id: "prompt",
        input: { prompt: { jsonSchema: { minLength: 1, type: "string" } } },
        type: "manual",
      },
      version: 1,
    }),
  );
}

function writeGlue(project: string, workflowId: string): void {
  writeFileSync(
    path.join(project, "workflows", workflowId, "workflow.ts"),
    `import doc from "../../.dromio/workflows/${workflowId}.workflow.json";\nexport const workflow = doc;\n`,
  );
}

function writeMultiWorkflowGlue(project: string, workflowId: string): void {
  mkdirSync(path.join(project, "workflows", workflowId), { recursive: true });
  writeFileSync(
    path.join(project, "workflows", workflowId, "workflow.ts"),
    [
      'import first from "../../.dromio/workflows/first.workflow.json";',
      'import second from "../../.dromio/workflows/second.workflow.json";',
      "export const workflows = [first, second];",
    ].join("\n"),
  );
}
