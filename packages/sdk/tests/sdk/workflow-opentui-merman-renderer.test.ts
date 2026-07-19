import { describe, expect, test } from "bun:test";
import {
  done,
  loop,
  createRuntimeStep,
} from "@dromio/workflow/core";
import {
  createWorkflowApp,
  projectWorkflowGraphDiagram,
} from "@dromio/workflow/client";
import {
  workflowOpenTuiMermanRenderer,
} from "@dromio/workflow/client/opentui-merman";
import {
  projectWorkflowGraphRenderModel,
} from "@dromio/workflow/client/workflow-render";

describe("OpenTUI Merman workflow renderer", () => {
  test("adapts workflow render models and TUI diagram projections", () => {
    const workflow = loop({
      id: "opentui-merman-test",
      steps: [
        createRuntimeStep("draft", () => done({ title: "Drafted" })),
        createRuntimeStep("publish", () => done({ ok: true })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "Renderer Adapter App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });

    expect(workflowOpenTuiMermanRenderer.id).toBe("sdk.opentui.merman.workflow");
    expect(workflowOpenTuiMermanRenderer.target).toBe("opentui");
    expect(workflowOpenTuiMermanRenderer.engine).toBe("merman");

    const modelPlan = workflowOpenTuiMermanRenderer.render(
      projectWorkflowGraphRenderModel({ graph: app.graph("planner") }),
      { direction: "TB" },
    );
    expect(modelPlan.content).toContain("flowchart TB");
    expect(modelPlan.renderable).toBe(workflowOpenTuiMermanRenderer.renderable);

    const projection = projectWorkflowGraphDiagram({ graph: app.graph("planner") });
    const projectionPlan = workflowOpenTuiMermanRenderer.renderProjection(projection);
    expect(projectionPlan.content).toBe(projection.content);
    expect(workflowOpenTuiMermanRenderer.renderPlainProjection(projection)).toContain("Draft");
    expect(workflowOpenTuiMermanRenderer.parse(projection.content).nodes.length).toBeGreaterThan(0);
  });
});
