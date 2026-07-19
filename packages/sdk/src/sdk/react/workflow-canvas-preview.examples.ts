import {
  createElement,
  type ReactElement,
} from "react";
import {
  starterWorkbenchWorkflowRenderExample,
} from "../client/workflow-render/index.js";
import {
  WorkflowCanvasPreview,
} from "./workflow-canvas-preview.js";

export function workflowCanvasPreviewExample(): ReactElement {
  return createElement(WorkflowCanvasPreview, {
    model: starterWorkbenchWorkflowRenderExample().model,
  });
}
