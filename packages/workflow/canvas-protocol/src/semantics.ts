export type WorkflowRenderTriggerType =
  | "block"
  | "event"
  | "http"
  | "manual"
  | "schedule"
  | "webhook";

export type WorkflowRenderTriggerInputMode =
  | "artifact"
  | "json-render"
  | "none"
  | "prompt"
  | "questions";

export type WorkflowRenderBranch = {
  id: string;
  label: string;
};

export type WorkflowRenderRoute = WorkflowRenderBranch & {
  selected: boolean;
};

export type WorkflowRenderInteractionKind = "approval" | "question" | "timer";

export type WorkflowRenderInteractionState =
  | "failed"
  | "idle"
  | "resolved"
  | "waiting";

export type WorkflowRenderTerminalOutcome =
  | "cancelled"
  | "failed"
  | "result";

export type WorkflowRenderNodeSemantic =
  | { role: "action" }
  | { boundary: "initial"; role: "boundary" }
  | { role: "fork"; branches: readonly WorkflowRenderBranch[] }
  | { role: "evaluation" }
  | { role: "gate" }
  | { role: "group" }
  | {
      interactionKind: WorkflowRenderInteractionKind;
      role: "interaction";
      state: WorkflowRenderInteractionState;
    }
  | { policy: "all" | "any"; role: "join" }
  | { mode: "exclusive"; role: "merge" }
  | { role: "model" }
  | {
      mode: "exactly-one";
      role: "router";
      routes: readonly WorkflowRenderRoute[];
    }
  | { outcome: WorkflowRenderTerminalOutcome; role: "terminal" }
  | {
      inputMode: WorkflowRenderTriggerInputMode;
      role: "trigger";
      triggerType: WorkflowRenderTriggerType;
    }
  | { role: "workflow" };

export type WorkflowRenderEdgeSemantic =
  | { role: "composition" }
  | { branch: WorkflowRenderBranch; role: "branch" }
  | { policy: "all" | "any"; role: "join" }
  | { role: "loop" }
  | { mode: "exclusive"; role: "merge" }
  | { role: "route"; route: WorkflowRenderRoute }
  | { role: "sequence" };

export function workflowRenderSemanticLabel(semantic: WorkflowRenderNodeSemantic): string {
  if (semantic.role === "interaction") return `${semantic.interactionKind} ${semantic.state}`;
  if (semantic.role === "trigger") return `${semantic.triggerType} trigger, ${semantic.inputMode} input`;
  if (semantic.role === "terminal") return `${semantic.outcome} terminal`;
  if (semantic.role === "join") return `${semantic.policy} join`;
  return semantic.role;
}
