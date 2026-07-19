import {
  expect,
  test,
} from "bun:test";
import {
  projectWorkflowGraphRenderModel,
  projectWorkflowOutline,
  workflowRenderExamples,
} from "@dromio/workflow/client/workflow-render";

test("projects a nested workflow into a compact outline", () => {
  const model = workflowRenderExamples.childWorkflow().model;
  const outline = projectWorkflowOutline({
    model,
    nodeDetails: new Map([
      ["child-review", { label: "Review draft", status: "running" }],
      ["inspect", { status: "completed" }],
    ]),
  });

  expect(outline.items).toEqual([expect.objectContaining({
    children: [
      expect.objectContaining({ id: "inspect", status: "completed" }),
      expect.objectContaining({ id: "repair" }),
    ],
    childrenMode: "sequence",
    id: "child-review",
    label: "Review draft",
    status: "running",
  })]);
});

test("preserves concurrent child branches without boundary noise", () => {
  const model = projectWorkflowGraphRenderModel({
    graph: {
      edges: [],
      id: "parallel-review",
      label: "Parallel review",
      nodes: [{
        catalog: {
          execution: {
            branches: [
              { childWorkflowDocumentId: "architecture", id: "architect" },
              { childWorkflowDocumentId: "delivery", id: "implementer" },
            ],
            kind: "fork",
          },
          id: "review.fork",
          label: "Review fork",
        },
        childNodes: [
          { branch: { id: "architect" }, id: "architect.run", label: "Architecture review" },
          { branch: { id: "implementer" }, id: "implementer.run", label: "Delivery review" },
        ],
        id: "parallel",
        kind: "step",
        label: "Parallel reviewers",
        maxRetries: 0,
      }],
    },
  });
  const outline = projectWorkflowOutline({
    model,
    statuses: { "architect.run": "completed", "implementer.run": "running" },
  });

  expect(outline.items).toEqual([expect.objectContaining({
    children: [
      expect.objectContaining({ id: "architect.run", status: "completed" }),
      expect.objectContaining({ id: "implementer.run", status: "running" }),
    ],
    childrenMode: "parallel",
    id: "parallel",
  })]);
  expect(outline.items[0]?.children.map((child) => child.kind)).toEqual(["step", "step"]);
});

test("can include explicit workflow boundaries when a surface needs them", () => {
  const model = workflowRenderExamples.starterWorkbenchWorkflow().model;
  const outline = projectWorkflowOutline({ includeBoundaries: true, model });

  expect(outline.items.map((item) => item.kind)).toEqual(["initial", "trigger", "step", "step", "end"]);
});
