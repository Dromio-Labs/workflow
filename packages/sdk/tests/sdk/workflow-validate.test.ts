import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  validateDromioWorkbench,
  workflowValidateErrorCodes,
} from "@dromio/workflow/product";

const legacyWorkflowValidateErrorCodes = [
  "MISSING_WORKFLOW_ID",
  "MISSING_TRIGGER",
  "MISSING_END",
  "UNREACHABLE_NODE",
  "ORPHAN_EDGE",
  "END_UNREACHABLE",
  "UNRESOLVED_CATALOG_ITEM",
  "INFRA_IN_WORKFLOW_DOCUMENT",
  "GLUE_FOLDER_MISMATCH",
  "MULTIPLE_WORKFLOWS_IN_GLUE",
  "MISSING_GLUE_FOLDER",
  "ORPHAN_GLUE_FOLDER",
  "MISSING_CATALOG_ITEM_FILE",
  "MISSING_STEP_IMPLEMENTATION",
] as const;

const projects: string[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) {
    rmSync(project, { force: true, recursive: true });
  }
});

describe("dromio workflow validation", () => {
  test("validates one workflow without reporting unrelated orphan glue folders", async () => {
    const project = createWorkbench();
    writeCatalog(project);
    writeWorkflow(project, "valid", "known.step");
    writeGlue(project, "valid", [".dromio/workflows/valid.workflow.json"]);
    writeGlue(project, "orphan", []);

    const output = await validateDromioWorkbench({ cwd: project, workflowId: "valid" });

    expect(output.valid).toBe(true);
    expect(output.summary).toEqual({ errorCount: 0, failed: 0, passed: 1, total: 1 });
    expect(output.workflows).toHaveLength(1);
    expect(output.workflows[0]?.id).toBe("valid");
  });

  test("reports document, catalog, glue, and render validation errors", async () => {
    const project = createWorkbench();
    writeCatalog(project);
    writeWorkflow(project, "valid", "known.step");
    writeGlue(project, "valid", [".dromio/workflows/valid.workflow.json"]);
    writeMissingFieldsWorkflow(project);
    writeBadGraphWorkflow(project);
    writeInfraWorkflow(project);
    writeWorkflow(project, "missing-step", "missing.step");
    writeWorkflow(project, "missing-manifest", "missing.manifest");
    writeWorkflow(project, "multi", "known.step");
    writeGlue(project, "multi", [
      ".dromio/workflows/multi.workflow.json",
      ".dromio/workflows/valid.workflow.json",
    ]);
    writeWorkflow(project, "wrong", "known.step");
    writeGlue(project, "wrong", [".dromio/workflows/valid.workflow.json"]);
    writeGlue(project, "orphan", []);

    const output = await validateDromioWorkbench({ cwd: project });
    const codes = new Set(output.workflows.flatMap((workflow) => workflow.errors.map((error) => error.code)));

    expect(output.valid).toBe(false);
    expect(output.summary.errorCount).toBeGreaterThan(0);
    for (const code of [
      "RENDER_EDGE_SOURCE_MISSING",
      "RENDER_EDGE_TARGET_MISSING",
    ] as const) {
      expect([...workflowValidateErrorCodes]).toContain(code);
    }
    for (const code of [
      ...legacyWorkflowValidateErrorCodes,
      "RENDER_EDGE_SOURCE_MISSING",
      "RENDER_EDGE_TARGET_MISSING",
    ] as const) {
      expect([...codes]).toContain(code);
    }
  });

  test("can run renderability-only validation without dogfood glue conventions", async () => {
    const project = createWorkbench();
    writeCatalog(project);
    writeSemanticIdWorkflow(project);

    const full = await validateDromioWorkbench({ cwd: project });
    const renderOnly = await validateDromioWorkbench({ cwd: project, mode: "render-only" });

    expect(full.valid).toBe(false);
    expect(full.workflows[0]?.errors.map((error) => error.code)).toContain("GLUE_FOLDER_MISMATCH");
    expect(renderOnly.valid).toBe(true);
    expect(renderOnly.summary).toEqual({ errorCount: 0, failed: 0, passed: 1, total: 1 });
  });

  test("does not treat catalog ids containing fs.write as infrastructure references", async () => {
    const project = createWorkbench();
    writeCatalog(project);
    writeWorkflow(project, "pdf-item", "pdfs.write-embedding");
    writeGlue(project, "pdf-item", [".dromio/workflows/pdf-item.workflow.json"]);

    const output = await validateDromioWorkbench({ cwd: project, workflowId: "pdf-item" });

    expect(output.valid).toBe(true);
    expect(output.workflows[0]?.errors.map((error) => error.code)).not.toContain("INFRA_IN_WORKFLOW_DOCUMENT");
  });

  test("prints machine-readable CLI JSON and exits 1 when validation errors exist", async () => {
    const project = createWorkbench();
    writeCatalog(project);
    writeBadGraphWorkflow(project);

    const proc = runDromioCli([
      "validate",
      "--all",
      "--json",
      "--cwd",
      project,
    ]);
    const stdout = proc.stdout;
    const stderr = proc.stderr;

    expect(stderr).toBe("");
    expect(proc.status).toBe(1);
    const parsed = JSON.parse(stdout) as { valid: boolean; workflows: { id: string }[] };
    expect(parsed.valid).toBe(false);
    expect(parsed.workflows.map((workflow) => workflow.id)).toContain("bad-graph");
  });

  test("CLI render-only mode exits 0 for renderable workflows with dogfood conventions", async () => {
    const project = createWorkbench();
    writeCatalog(project);
    writeSemanticIdWorkflow(project);

    const proc = runDromioCli([
      "validate",
      "--all",
      "--render-only",
      "--json",
      "--cwd",
      project,
    ]);
    const stdout = proc.stdout;
    const stderr = proc.stderr;

    expect(stderr).toBe("");
    expect(proc.status).toBe(0);
    const parsed = JSON.parse(stdout) as { valid: boolean; summary: { passed: number } };
    expect(parsed.valid).toBe(true);
    expect(parsed.summary.passed).toBe(1);
  });

  test("exits 0 for a valid workflow and 2 for a missing workflow", async () => {
    const project = createWorkbench();
    writeCatalog(project);
    writeWorkflow(project, "valid", "known.step");
    writeGlue(project, "valid", [".dromio/workflows/valid.workflow.json"]);

    const valid = runDromioCli(["validate", "valid", "--cwd", project]);
    const missing = runDromioCli(["validate", "missing", "--cwd", project]);
    const validStdout = valid.stdout;
    const missingStderr = missing.stderr;

    expect(valid.status).toBe(0);
    expect(validStdout).toContain("dromio validate passed");
    expect(missing.status).toBe(2);
    expect(missingStderr).toContain("Workflow not found: missing");
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
  const project = mkdtempSync(path.join(tmpdir(), "dromio-validate-"));
  projects.push(project);
  mkdirSync(path.join(project, ".dromio/workflows"), { recursive: true });
  mkdirSync(path.join(project, "catalog/known"), { recursive: true });
  mkdirSync(path.join(project, "workflows"), { recursive: true });
  writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "validate-fixture" }));
  return project;
}

function writeCatalog(project: string): void {
  writeFileSync(path.join(project, "catalog/known/step.ts"), "export const run = true;\n");
  writeFileSync(
    path.join(project, "catalog/index.ts"),
    [
      "export const workflowCatalogItems = [",
      "  { id: 'known.step', label: 'Known step', implementation: { kind: 'typescript', source: 'catalog/known/step' } },",
      "  { id: 'pdfs.write-embedding', label: 'Write PDF embedding', implementation: { kind: 'typescript', source: 'catalog/known/step' } },",
      "  { id: 'missing.step', label: 'Missing step', implementation: { kind: 'typescript', source: 'catalog/missing/step' } },",
      "  { id: 'missing.manifest', label: 'Missing manifest', implementation: { kind: 'typescript', source: 'catalog/items/missing.json' } },",
      "];",
    ].join("\n"),
  );
}

function writeWorkflow(project: string, id: string, catalogItemId: string): void {
  writeWorkflowJson(project, `${id}.workflow.json`, {
    edges: [
      { id: "request->step", source: "request", target: "step" },
      { id: "step->done", source: "step", target: "done" },
    ],
    end: { id: "done", output: { result: { jsonSchema: { type: "object" } } }, type: "result" },
    id,
    nodes: [{ catalogItemId, id: "step" }],
    trigger: { id: "request", input: { request: { jsonSchema: { type: "object" } } }, type: "manual" },
    version: 1,
  });
}

function writeMissingFieldsWorkflow(project: string): void {
  writeWorkflowJson(project, "missing-fields.workflow.json", {
    edges: [],
    nodes: [],
    version: 1,
  });
}

function writeBadGraphWorkflow(project: string): void {
  writeWorkflowJson(project, "bad-graph.workflow.json", {
    edges: [
      { id: "request->missing-catalog", source: "request", target: "missing-catalog" },
      { id: "request->ghost-target", source: "request", target: "ghost-target" },
      { id: "ghost->done", source: "ghost", target: "done" },
    ],
    end: { id: "done", type: "result" },
    id: "bad-graph",
    nodes: [
      { catalogItemId: "not.real", id: "missing-catalog" },
      { catalogItemId: "known.step", id: "unreachable" },
    ],
    trigger: { id: "request", type: "manual" },
    version: 1,
  });
}

function writeSemanticIdWorkflow(project: string): void {
  writeWorkflowJson(project, "semantic-file.workflow.json", {
    edges: [
      { id: "request->step", source: "request", target: "step" },
      { id: "step->done", source: "step", target: "done" },
    ],
    end: { id: "done", type: "result" },
    id: "semantic.workflow",
    nodes: [{ catalogItemId: "known.step", id: "step" }],
    trigger: { id: "request", type: "manual" },
    version: 1,
  });
}

function writeInfraWorkflow(project: string): void {
  writeWorkflowJson(project, "infra.workflow.json", {
    edges: [
      { id: "request->step", source: "request", target: "step" },
      { id: "step->done", source: "step", target: "done" },
    ],
    end: { id: "done", type: "result" },
    id: "infra",
    nodes: [{
      catalogItemId: "known.step",
      config: {
        adapter: "fetch('/api/private')",
        path: ["", "Users", "example-user", "private.txt"].join("/"),
      },
      id: "step",
    }],
    trigger: { id: "request", type: "manual" },
    version: 1,
  });
}

function writeGlue(project: string, id: string, workflowRefs: string[]): void {
  const glueDir = path.join(project, "workflows", id);
  mkdirSync(glueDir, { recursive: true });
  writeFileSync(
    path.join(glueDir, "workflow.ts"),
    workflowRefs.map((ref) => `readWorkflowJson("${ref}");`).join("\n") || "export const workflow = true;\n",
  );
}

function writeWorkflowJson(project: string, fileName: string, value: unknown): void {
  writeFileSync(
    path.join(project, ".dromio/workflows", fileName),
    JSON.stringify(value, null, 2),
  );
}
