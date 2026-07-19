import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import ts from "typescript";
import { checkIntentProject } from "@dromio/workflow/product";

describe("workflow SDK project checks", () => {
  test("passes when step config starts with id and follows SDK order", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "intent-check-pass-"));
    await writeFile(path.join(cwd, "step.ts"), `
      step.model({
        id: "draft-plan",
        label: "Draft plan",
        input: {},
        output: {},
        model,
        prompt,
      });
    `);

    const result = await checkIntentProject({ cwd });

    expect(result.issues).toEqual([]);
  });

  test("reports step configs that do not start with id", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "intent-check-fail-"));
    await writeFile(path.join(cwd, "step.ts"), `
      step.model({
        buildPrompt: () => ({}),
        id: "draft-plan",
        model,
        input: {},
        label: "Draft plan",
        output: {},
        prompt,
      });
    `);

    const result = await checkIntentProject({ cwd });

    expect(result.issues).toEqual([
      expect.objectContaining({
        filePath: "step.ts",
        message: 'step config should put "id" first.',
        rule: "workflow-sdk/step-config-order",
      }),
      expect.objectContaining({
        filePath: "step.ts",
        rule: "workflow-sdk/step-config-order",
      }),
    ]);
  });

  test("fixes step config order", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "intent-check-fix-"));
    const filePath = path.join(cwd, "step.ts");
    await writeFile(filePath, `
      step.model({
        buildPrompt: () => ({}),
        customThing,
        id: "draft-plan",
        model,
        input: {},
        label: "Draft plan",
        output: {},
        prompt,
      });
    `);

    const result = await checkIntentProject({ cwd, fix: true });
    const source = await readFile(filePath, "utf8");

    expect(result).toEqual({ fixedFiles: 1, issues: [] });
    expect(source.indexOf('id: "draft-plan"')).toBeLessThan(source.indexOf('label: "Draft plan"'));
    expect(source.indexOf('label: "Draft plan"')).toBeLessThan(source.indexOf("model,"));
    expect(source.indexOf("output:")).toBeLessThan(source.indexOf("model,"));
    expect(source.indexOf("buildPrompt")).toBeLessThan(source.indexOf("customThing"));
  });

  test("keeps a final method valid when the fixer moves it before metadata", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "intent-check-method-fix-"));
    const filePath = path.join(cwd, "step.ts");
    await writeFile(filePath, `
      step({
        capabilities: ["test"],
        id: "method-step",
        run() {
          return {};
        }
      });
    `);

    const result = await checkIntentProject({ cwd, fix: true });
    const checkedAgain = await checkIntentProject({ cwd });
    const source = await readFile(filePath, "utf8");

    expect(result).toEqual({ fixedFiles: 1, issues: [] });
    expect(checkedAgain.issues).toEqual([]);
    expect(ts.transpileModule(source, { reportDiagnostics: true }).diagnostics).toEqual([]);
  });

  test("validates workflow document JSON files", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "intent-check-workflow-json-"));
    const workflowDir = path.join(cwd, ".dromio", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(workflowDir, "valid.workflow.json"), JSON.stringify({
      edges: [],
      end: {
        id: "done",
      },
      id: "valid.workflow",
      nodes: [],
      trigger: {
        id: "prompt",
        type: "manual",
      },
      version: 1,
    }));
    const result = await checkIntentProject({ cwd });

    expect(result.issues).toEqual([]);
  });

  test("reports invalid workflow document JSON files", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "intent-check-workflow-json-fail-"));
    const workflowDir = path.join(cwd, ".dromio", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(workflowDir, "broken.workflow.json"), JSON.stringify({
      edges: [],
      end: {},
      id: "",
      nodes: [],
      trigger: {
        id: "prompt",
        type: "manual",
      },
      version: 1,
    }));
    const result = await checkIntentProject({ cwd });

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        filePath: path.join(".dromio", "workflows", "broken.workflow.json"),
        rule: "workflow-sdk/workflow-document-schema",
      }),
    ]));
  });

  test("reports workflow env config without a workflow config file", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "intent-check-workflow-env-config-"));
    const workflowDir = path.join(cwd, "workflows", "planner");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(workflowDir, "model-router.ts"), `
      export const model = process.env.INTENT_MODEL;
    `);

    const result = await checkIntentProject({ cwd });

    expect(result.issues).toEqual([
      expect.objectContaining({
        filePath: path.join("workflows", "planner", "model-router.ts"),
        message: expect.stringContaining(path.join("workflows", "planner", "config.json")),
        rule: "workflow-sdk/workflow-env-config-file",
      }),
    ]);
  });

  test("allows workflow env config with a workflow config file", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "intent-check-workflow-env-config-pass-"));
    const workflowDir = path.join(cwd, "workflows", "planner");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(workflowDir, "config.json"), JSON.stringify({
      model: "test-model",
    }));
    await writeFile(path.join(workflowDir, "model-router.ts"), `
      export const model = process.env.INTENT_MODEL;
    `);

    const result = await checkIntentProject({ cwd });

    expect(result.issues).toEqual([]);
  });
});
