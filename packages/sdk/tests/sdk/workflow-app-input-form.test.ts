import { describe, expect, test } from "bun:test";
import { workflowInputPlaceholder } from "../../src/sdk/client/interactions/workflow-app-tui-parts/input-form.js";
import type { WorkflowAppWorkflowDescriptor } from "../../src/sdk/client/interactions/workflow-app.js";

describe("workflow app TUI input form", () => {
  test("uses placeholders only for prompt trigger inputs", () => {
    expect(workflowInputPlaceholder(workflowWithInput({
      kind: "prompt",
      placeholder: "Describe the workflow",
    }))).toBe("Describe the workflow");
    expect(workflowInputPlaceholder(workflowWithInput({
      accept: ["application/pdf"],
      kind: "artifact",
    }))).toBeUndefined();
  });
});

function workflowWithInput(input: WorkflowAppWorkflowDescriptor["input"]): WorkflowAppWorkflowDescriptor {
  return {
    id: "input-test",
    input,
    title: "Input test",
  } as WorkflowAppWorkflowDescriptor;
}
