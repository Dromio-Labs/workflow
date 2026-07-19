import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  describe,
  expect,
  test,
} from "bun:test";
import {
  createWorkbenchStarter,
} from "@dromio/workflow/init/workbench";

describe("workbench starter generator", () => {
  test("creates a reusable starter that depends on the published SDK", async () => {
    const targetDir = await mkdtemp(path.join(os.tmpdir(), "dromio-workbench-starter-"));
    try {
      const result = await createWorkbenchStarter({
        packageName: "@acme/workbench",
        targetDir,
      });

      expect(result.packageName).toBe("@acme/workbench");
      expect(result.files).toContain("package.json");
      expect(result.files).toContain(".dromio/workflows/echo.workflow.json");
      expect(result.files).toContain("catalog/starter/echo-message/schema.ts");
      expect(result.files).toContain("catalog/starter/echo-message/step.ts");
      expect(result.files).toContain("bin/cli.ts");
      expect(result.files).not.toContain("catalog/items/starter/echo-message/manifest.ts");
      expect(result.files).not.toContain("workflows/document-files.ts");
      expect(result.files).not.toContain("catalog/echo/index.ts");

      const packageJson = JSON.parse(await readFile(path.join(targetDir, "package.json"), "utf8"));
      expect(packageJson.dependencies["@dromio/workflow"]).toBe("^0.1.3");
      expect(packageJson.scripts.check).toBe(
        "tsc --noEmit && dromio check && dromio validate --all && dromio compile --all",
      );

      const npmrc = await readFile(path.join(targetDir, ".npmrc"), "utf8");
      expect(npmrc).toContain("${NPM_TOKEN}");
      expect(npmrc).toContain("https://registry.npmjs.org/");

      expect(result.files).not.toContain("README.md");
      expect(result.files).not.toContain("AGENTS.md");

      const catalogIndex = await readFile(path.join(targetDir, "catalog", "index.ts"), "utf8");
      expect(catalogIndex).toContain("catalog([");
      expect(catalogIndex).toContain("./starter/echo-message/step.js");

      const stepSource = await readFile(
        path.join(targetDir, "catalog", "starter", "echo-message", "step.ts"),
        "utf8",
      );
      expect(stepSource).toContain("step({");
      expect(stepSource).toContain('from "@dromio/workflow"');
      expect(stepSource).not.toContain("createContractedRuntimeStep");

      const workflowSource = await readFile(
        path.join(targetDir, "workflows", "echo", "workflow.ts"),
        "utf8",
      );
      expect(workflowSource).toContain("workflow({");
      expect(workflowSource).not.toContain("compileWorkflowDocument");

      const workflow = JSON.parse(
        await readFile(path.join(targetDir, ".dromio", "workflows", "echo.workflow.json"), "utf8"),
      );
      expect(workflow).toEqual(expect.objectContaining({
        id: "echo",
        version: 1,
      }));
      expect(workflow.nodes).toEqual([
        expect.objectContaining({
          catalogItemId: "starter.echo-message",
        }),
      ]);

      const appSource = await readFile(path.join(targetDir, "src", "app.ts"), "utf8");
      expect(appSource).toContain("workflowApp");
      expect(appSource).toContain("starterWorkflowApp");
      expect(appSource).not.toContain(" as ");
      expect(appSource).toContain('from "@dromio/workflow"');
      expect(appSource).not.toContain("createWorkflowApp");
      expect(appSource).not.toContain("../workflow-sdk");
      expect(appSource).not.toContain("dromio-workbench");
    } finally {
      await rm(targetDir, {
        force: true,
        recursive: true,
      });
    }
  });
});
