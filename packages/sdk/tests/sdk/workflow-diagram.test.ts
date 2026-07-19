import { describe, expect, test } from "bun:test";
import {
  createWorkflowApp,
  createWorkflowAppRuntime,
  projectWorkflowGraphDiagram,
} from "@dromio/workflow/client";
import {
  done,
  loop,
  createRuntimeStep,
  type LoopGraphProjection,
} from "@dromio/workflow/core";

function graphFixture(input?: {
  childNodes?: NonNullable<LoopGraphProjection["nodes"][number]["childNodes"]>;
}): LoopGraphProjection {
  return {
    edges: [
      { from: "start", id: "start-to-prepare", kind: "sequence", to: "prepare" },
      { from: "prepare", id: "prepare-to-batch", kind: "sequence", to: "process-batch" },
      { from: "process-batch", id: "batch-to-done", kind: "sequence", to: "done" },
    ],
    end: {
      boundary: "end",
      id: "done",
      label: "Images processed",
    },
    id: "process-images",
    label: "Process Images",
    nodes: [
      {
        id: "prepare",
        kind: "step",
        label: "Prepare images",
        maxRetries: 0,
      },
      {
        catalog: {
          execution: {
            childWorkflowDocumentId: "process-image-item",
            itemSource: "images",
            kind: "forEach",
            label: "for each image",
          },
          id: "images.process-image-batch",
          kind: "composite",
          label: "Process image batch",
        },
        childNodes: input?.childNodes,
        id: "process-batch",
        kind: "composite",
        label: "Process batch",
        maxRetries: 0,
      },
    ],
    trigger: {
      boundary: "trigger",
      id: "start",
      label: "Process images request",
      type: "manual",
    },
  };
}

describe("workflow diagram projection", () => {
  test("projects a workflow graph into stable Mermaid flowchart nodes and edges", () => {
    const projection = projectWorkflowGraphDiagram({
      graph: graphFixture(),
      selectedStepId: "prepare",
    });

    expect(projection.content).toContain("flowchart TD");
    expect(projection.content).toContain("wf_start([");
    expect(projection.content).toContain("wf_prepare[");
    expect(projection.content).toContain("wf_process-batch[[");
    expect(projection.content).toContain("wf_done([");
    expect(projection.content).toContain("wf_start --> wf_prepare");
    expect(projection.content).toContain("wf_prepare --> wf_process-batch");
    expect(projection.activeNode).toBe(projection.nodeIdByStepId.prepare);
    expect(projection.stepIdByNodeId[projection.nodeIdByStepId.prepare!]).toBe("prepare");
  });

  test("projects workflow-backed loop children with local indexes and a repeat edge", () => {
    const projection = projectWorkflowGraphDiagram({
      graph: graphFixture({
        childNodes: [
          { id: "fingerprint", label: "fingerprint" },
          { id: "check-catalog", label: "check-catalog" },
          {
            id: "read-metadata",
            label: "read-metadata",
            loop: {
              endNodeId: "describe-image",
              id: "per-image",
              label: "per image",
              role: "start",
              startNodeId: "read-metadata",
            },
          },
          {
            id: "extract-ocr",
            label: "extract-ocr",
            loop: {
              endNodeId: "describe-image",
              id: "per-image",
              label: "per image",
              role: "body",
              startNodeId: "read-metadata",
            },
          },
          {
            id: "describe-image",
            label: "describe-image",
            loop: {
              backToNodeId: "describe-image",
              endNodeId: "describe-image",
              id: "per-image",
              label: "per image",
              role: "end",
              startNodeId: "read-metadata",
            },
          },
          { id: "write-embedding", label: "write-embedding" },
        ],
      }),
    });

    expect(projection.content).toContain("subgraph sg_process-batch_children [Process batch child workflow]");
    expect(projection.content).toContain("subgraph loop_process-batch_per-image [per image]");
    expect(projection.content).toContain("01 fingerprint");
    expect(projection.content).toContain("03 read-metadata");
    expect(projection.content).toContain("05 describe-image");
    expect(projection.content).toContain("06 write-embedding");
    expect(projection.content).toContain("-.-> |repeat|");
    expect(projection.content).not.toContain("03.01");
  });

  test("renders the merman canvas in the wide TUI shell", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const { WorkflowAppTuiShell } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "diagram-tui",
      steps: [
        createRuntimeStep("draft", () => done({ title: "Drafted" })),
        createRuntimeStep("publish", () => done({ ok: true })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "Diagram App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship it",
      onExit() {},
      runtime,
    }), {
      height: 36,
      width: 180,
    });

    await view.renderOnce();
    const frame = view.captureCharFrame();
    expect(frame).toContain("Workflow Canvas");
    expect(frame).toContain("merman");
    expect(frame).toContain("Draft");
    expect(frame).toContain("Publish");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

});
