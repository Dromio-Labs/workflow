import type {
  WorkflowRunProjection,
} from "./workflow-run-projection.js";
import type {
  WorkflowRunSemanticRow,
} from "./workflow-run-store.js";

export type WorkflowDiagramSnapshot = Pick<
  WorkflowRunProjection,
  "currentStepId" | "graph" | "status" | "steps"
> & {
  transcript?: WorkflowRunSemanticRow[];
};
