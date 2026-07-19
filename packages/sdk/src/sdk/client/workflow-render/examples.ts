import {
  projectWorkflowDocumentRenderModel,
} from "./projection.js";
import {
  validateWorkflowRenderability,
} from "./validation.js";
import type { WorkflowRenderDocumentLike } from "./types.js";

const starterDocument: WorkflowRenderDocumentLike = {
  description: "Generated starter workbench workflow.",
  edges: [
    { id: "intent->draft", source: "intent", target: "draft" },
    { id: "draft->review", source: "draft", target: "review" },
    { id: "review->done", source: "review", target: "done" },
  ],
  end: { id: "done", label: "Publishable workflow" },
  id: "starter-workbench-workflow",
  label: "Starter Workbench Workflow",
  nodes: [
    { catalogItemId: "example.draft-workflow", id: "draft", label: "Draft workflow" },
    { catalogItemId: "example.review-policy", id: "review", label: "Review policy" },
  ],
  trigger: { id: "intent", input: { prompt: {} }, label: "Intent" },
};

export function starterWorkbenchWorkflowRenderExample() {
  const model = projectWorkflowDocumentRenderModel({
    document: starterDocument,
  });
  return {
    model,
    validation: validateWorkflowRenderability(model),
  };
}

export function runningWorkflowRenderExample() {
  const model = projectWorkflowDocumentRenderModel({
    document: starterDocument,
    statuses: {
      done: "pending",
      draft: "completed",
      intent: "completed",
      review: "running",
    },
  });
  return {
    model,
    validation: validateWorkflowRenderability(model),
  };
}

export function incompleteLayoutRenderExample() {
  const model = projectWorkflowDocumentRenderModel({
    document: starterDocument,
  });
  return {
    model,
    validation: validateWorkflowRenderability(model),
  };
}

export function childWorkflowRenderExample() {
  const model = projectWorkflowDocumentRenderModel({
    catalog: {
      get(id) {
        if (id !== "example.child-review") return undefined;
        return {
          execution: { childWorkflowDocumentId: "child-review-workflow" },
          id,
          kind: "workflow",
          label: "Child review workflow",
        };
      },
    },
    childWorkflows: {
      "child-review-workflow": {
        document: {
          edges: [
            { id: "child-start->inspect", source: "child-start", target: "inspect" },
            { id: "inspect->repair", source: "inspect", target: "repair" },
            { id: "repair->child-done", source: "repair", target: "child-done" },
          ],
          end: { id: "child-done", label: "Child review complete" },
          id: "child-review-workflow",
          label: "Child Review Workflow",
          loops: [{
            backTo: "inspect",
            end: "repair",
            id: "review-repair-loop",
            label: "repeat review until accepted",
            start: "inspect",
          }],
          nodes: [
            { id: "inspect", label: "Inspect draft" },
            { id: "repair", label: "Repair findings" },
          ],
          trigger: { id: "child-start", label: "Draft ready" },
        },
      },
    },
    document: {
      ...starterDocument,
      edges: [
        { id: "intent->child-review", source: "intent", target: "child-review" },
        { id: "child-review->done", source: "child-review", target: "done" },
      ],
      id: "workflow-with-child",
      label: "Workflow With Child",
      nodes: [
        { catalogItemId: "example.child-review", id: "child-review" },
      ],
    },
  });
  return {
    model,
    validation: validateWorkflowRenderability(model),
  };
}

export function validationFailureRenderExample() {
  const model = projectWorkflowDocumentRenderModel({
    document: {
      edges: [
        { id: "intent->approve", source: "intent", target: "approve" },
        { id: "approve->missing", source: "approve", target: "missing" },
      ],
      id: "refund-review",
      label: "Refund Review",
      nodes: [{ id: "approve", label: "Approve refund" }],
      trigger: { id: "intent", label: "Refund request" },
    },
    selectedNodeId: "approve-details",
  });
  return {
    model,
    validation: validateWorkflowRenderability(model),
  };
}

export const workflowRenderExamples = {
  childWorkflow: childWorkflowRenderExample,
  incompleteLayout: incompleteLayoutRenderExample,
  runningWorkflow: runningWorkflowRenderExample,
  starterWorkbenchWorkflow: starterWorkbenchWorkflowRenderExample,
  validationFailure: validationFailureRenderExample,
};
