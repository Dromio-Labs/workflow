import type {
  LoopGraphChildNode,
  LoopGraphNode,
} from "../../core/index.js";
import type {
  WorkflowRenderInteraction,
  WorkflowRenderDocumentNodeLike,
} from "./types.js";
import type {
  WorkflowRenderInteractionKind,
  WorkflowRenderNodeSemantic,
  WorkflowRenderStatus,
  WorkflowRenderTerminalOutcome,
  WorkflowRenderTriggerInputMode,
  WorkflowRenderTriggerType,
} from "@dromio/workflow-canvas-protocol";

export function graphNodeSemantic(input: {
  interaction?: WorkflowRenderInteraction;
  node: LoopGraphNode;
  selectedRouteId?: string;
  status?: WorkflowRenderStatus;
}): WorkflowRenderNodeSemantic {
  if (input.interaction) {
    return interactionSemantic(input.interaction.kind, input.status, input.interaction);
  }
  const execution = input.node.catalog?.execution;
  if (execution?.kind === "router") {
    return {
      mode: "exactly-one",
      role: "router",
      routes: (execution.routes ?? []).map((route) => ({
        id: route.id,
        label: route.label ?? route.id,
        selected: route.id === input.selectedRouteId,
      })),
    };
  }
  if (execution?.kind === "fork") {
    return {
      branches: (execution.branches ?? []).map((branch) => ({
        id: branch.id,
        label: branch.label ?? branch.id,
      })),
      role: "fork",
    };
  }
  const interactionKind = interactionKindFromCatalog(input.node.catalog?.kind);
  if (interactionKind) return interactionSemantic(interactionKind, input.status, input.interaction);
  const catalogRole = catalogActionRole(input.node.catalog?.kind);
  if (catalogRole) return { role: catalogRole };
  if (input.node.kind === "group") return { role: "group" };
  if (input.node.catalog?.kind === "workflow" || execution?.childWorkflowDocumentId || input.node.childNodes?.length) {
    return { role: "workflow" };
  }
  return { role: "action" };
}

export function childNodeSemantic(
  node: LoopGraphChildNode,
  status?: WorkflowRenderStatus,
): WorkflowRenderNodeSemantic {
  const interactionKind = interactionKindFromCatalog(node.catalog?.kind);
  if (interactionKind) return interactionSemantic(interactionKind, status);
  const catalogRole = catalogActionRole(node.catalog?.kind);
  if (catalogRole) return { role: catalogRole };
  if (node.catalog?.kind === "workflow" || node.catalog?.execution?.childWorkflowDocumentId) {
    return { role: "workflow" };
  }
  return { role: "action" };
}

export function documentNodeSemantic(input: {
  branches?: readonly { id: string; label?: string }[];
  catalogKind?: string;
  executionKind?: string;
  hasChildWorkflow: boolean;
  node: WorkflowRenderDocumentNodeLike;
  routes?: readonly { id: string; label?: string }[];
  status?: WorkflowRenderStatus;
}): WorkflowRenderNodeSemantic {
  if (input.executionKind === "router") {
    return {
      mode: "exactly-one",
      role: "router",
      routes: (input.routes ?? []).map((route) => ({
        id: route.id,
        label: route.label ?? route.id,
        selected: false,
      })),
    };
  }
  if (input.executionKind === "fork") {
    return {
      branches: (input.branches ?? []).map((branch) => ({
        id: branch.id,
        label: branch.label ?? branch.id,
      })),
      role: "fork",
    };
  }
  const interactionKind = interactionKindFromCatalog(input.catalogKind);
  if (interactionKind) return interactionSemantic(interactionKind, input.status);
  const catalogRole = catalogActionRole(input.catalogKind);
  if (catalogRole) return { role: catalogRole };
  if (
    input.node.type === "group" || input.node.kind === "group"
    || input.node.config?.type === "group" || input.catalogKind === "group"
  ) return { role: "group" };
  if (input.hasChildWorkflow || input.catalogKind === "workflow") return { role: "workflow" };
  return { role: "action" };
}

export function interactionSemantic(
  interactionKind: WorkflowRenderInteractionKind,
  status?: WorkflowRenderStatus,
  interaction?: WorkflowRenderInteraction,
): WorkflowRenderNodeSemantic {
  const state = interaction?.state
    ?? (status === "waiting" ? "waiting"
      : status === "failed" ? "failed"
      : status === "completed" ? "resolved"
      : "idle");
  return { interactionKind, role: "interaction", state };
}

export function terminalSemantic(
  outcome: WorkflowRenderTerminalOutcome = "result",
): WorkflowRenderNodeSemantic {
  return { outcome, role: "terminal" };
}

export function triggerSemantic(
  triggerType: WorkflowRenderTriggerType,
  inputMode: WorkflowRenderTriggerInputMode = "none",
): WorkflowRenderNodeSemantic {
  return { inputMode, role: "trigger", triggerType };
}

export function workflowRenderTriggerType(value: string | undefined): WorkflowRenderTriggerType {
  if (value === undefined) return "manual";
  if (
    value === "block" || value === "event" || value === "http" || value === "manual"
    || value === "schedule" || value === "webhook"
  ) return value;
  throw new Error(`Unsupported workflow render trigger type: ${value}`);
}

function interactionKindFromCatalog(value: string | undefined): WorkflowRenderInteractionKind | undefined {
  if (value === "wait") return "timer";
  if (value === "approval" || value === "question" || value === "timer") return value;
  return undefined;
}

function catalogActionRole(value: string | undefined): "evaluation" | "gate" | "model" | undefined {
  if (value === "evaluation" || value === "gate" || value === "model") return value;
  return undefined;
}
