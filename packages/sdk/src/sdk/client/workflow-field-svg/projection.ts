import type {
  WorkflowRenderModel,
  WorkflowRenderStatus,
} from "../workflow-render/index.js";
import type {
  WorkflowFieldEvent,
  WorkflowFieldEvaluationState,
  WorkflowFieldRunInput,
  WorkflowFieldVisualState,
} from "./types.js";

export function projectWorkflowFieldVisualState(
  model: WorkflowRenderModel,
  run?: WorkflowFieldRunInput,
): WorkflowFieldVisualState {
  if (!run) {
    return { activeNodeIds: [], elapsedMs: 0, phase: "idle", statuses: pendingStatuses(model) };
  }
  const statuses = pendingStatuses(model);
  const initial = model.nodes.find((node) => node.semantic.role === "boundary");
  if (initial) statuses[initial.id] = "completed";
  if (run.triggerId) statuses[run.triggerId] = run.events.length ? "completed" : "running";

  let activeNodeId: string | undefined;
  let evaluation: WorkflowFieldEvaluationState | undefined;
  let waitingKind: WorkflowFieldVisualState["waitingKind"];
  let waitingLabel: string | undefined;
  for (const event of run.events) {
    const status = statusFromEvent(event);
    const resolvedNodeId = resolveEventNodeId(model, event);
    if (resolvedNodeId && status) {
      statuses[resolvedNodeId] = status;
      if (status === "running" || status === "waiting") activeNodeId = resolvedNodeId;
      if (status === "completed" || status === "failed" || status === "skipped") {
        if (activeNodeId === resolvedNodeId) activeNodeId = undefined;
      }
    }
    if (event.type === "question.requested" || event.type === "hook.waiting") {
      waitingLabel = waitingText(event);
      waitingKind = event.type === "question.requested" ? "human" : hookWaitingKind(event);
    }
    if (event.type === "question.answered" || event.type === "hook.resumed") {
      waitingLabel = undefined;
      waitingKind = undefined;
    }
    if (event.type === "evaluation.completed" && resolvedNodeId) {
      evaluation = evaluationFromEvent(event, resolvedNodeId);
    }
  }

  projectChildBoundaryStatuses(model, statuses);

  const end = model.nodes.find(isSemanticExit);
  if (end && run.status === "completed") statuses[end.id] = "completed";
  if (end && run.status === "failed") statuses[end.id] = "failed";
  const phase = runPhase(run.status, waitingLabel);
  const firstTimestamp = Date.parse(run.events[0]?.timestamp ?? "");
  const lastTimestamp = Date.parse(run.events.at(-1)?.timestamp ?? "");
  return {
    ...(activeNodeId ? { activeNodeId } : {}),
    activeNodeIds: activeNodes(model, statuses),
    elapsedMs: Number.isFinite(firstTimestamp) && Number.isFinite(lastTimestamp)
      ? Math.max(0, lastTimestamp - firstTimestamp)
      : 0,
    phase,
    statuses,
    ...(evaluation ? { evaluation } : {}),
    ...(waitingKind ? { waitingKind } : {}),
    ...(waitingLabel ? { waitingLabel } : {}),
  };
}

function resolveEventNodeId(model: WorkflowRenderModel, event: WorkflowFieldEvent) {
  const ids = modelNodeIds(model);
  const detail = recordDetail(event.detail);
  const itemId = stringValue(detail?.itemId);
  const itemStepId = stringValue(detail?.itemWorkflowStepId);
  const candidates = [
    event.stepId,
    itemId && itemStepId ? `${itemId}.${itemStepId}` : undefined,
    itemStepId,
  ];
  for (const candidate of candidates) if (candidate && ids.has(candidate)) return candidate;
  if (!event.stepId) return undefined;
  const suffixMatches = [...ids].filter((id) => event.stepId === id || event.stepId?.endsWith(`.${id}`));
  return suffixMatches.sort((left, right) => right.length - left.length)[0];
}

function modelNodeIds(model: WorkflowRenderModel, result = new Set<string>()) {
  for (const node of model.nodes) {
    result.add(node.id);
    if (node.childWorkflow) modelNodeIds(node.childWorkflow.model, result);
  }
  return result;
}

function activeNodes(
  model: WorkflowRenderModel,
  statuses: Readonly<Record<string, WorkflowRenderStatus>>,
) {
  return [...modelNodeIds(model)].filter((id) => statuses[id] === "running" || statuses[id] === "waiting");
}

function projectChildBoundaryStatuses(
  model: WorkflowRenderModel,
  statuses: Record<string, WorkflowRenderStatus>,
) {
  for (const node of model.nodes) {
    const child = node.childWorkflow?.model;
    if (!child) continue;
    projectChildBoundaryStatuses(child, statuses);
    const childIds = [...modelNodeIds(child)];
    const childStarted = childIds.some((id) => !isBoundaryNode(child, id) && statuses[id] !== "pending");
    if (childStarted || statuses[node.id] === "completed" || statuses[node.id] === "failed") {
      for (const boundary of child.nodes.filter(isSemanticEntry)) {
        statuses[boundary.id] = "completed";
      }
    }
    const end = child.nodes.find(isSemanticExit);
    if (end && statuses[node.id] === "completed") statuses[end.id] = "completed";
    if (end && statuses[node.id] === "failed") statuses[end.id] = "failed";
  }
}

function isBoundaryNode(model: WorkflowRenderModel, nodeId: string) {
  const node = model.nodes.find((item) => item.id === nodeId);
  return node ? isSemanticEntry(node) || isSemanticExit(node) : false;
}

function isSemanticEntry(node: WorkflowRenderModel["nodes"][number]) {
  return node.semantic.role === "boundary" || node.semantic.role === "trigger" ||
    node.semantic.role === "router" || node.semantic.role === "fork";
}

function isSemanticExit(node: WorkflowRenderModel["nodes"][number]) {
  return node.semantic.role === "terminal" || node.semantic.role === "join" || node.semantic.role === "merge";
}

function recordDetail(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function evaluationFromEvent(
  event: WorkflowFieldEvent,
  nodeId: string,
): WorkflowFieldEvaluationState | undefined {
  const detail = event.detail as {
    evaluation?: { score?: unknown; status?: unknown; threshold?: unknown };
  } | undefined;
  const score = detail?.evaluation?.score;
  const status = detail?.evaluation?.status;
  const threshold = detail?.evaluation?.threshold;
  if (typeof score !== "number" || !Number.isFinite(score)) return undefined;
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) return undefined;
  if (typeof status !== "string") return undefined;
  return {
    ...(typeof event.attempt === "number" && event.attempt > 0 ? { attempt: event.attempt } : {}),
    nodeId,
    score: clampScore(score),
    status,
    threshold: clampScore(threshold),
  };
}

function clampScore(value: number) {
  return Math.max(0, Math.min(1, value));
}

function pendingStatuses(model: WorkflowRenderModel): Record<string, WorkflowRenderStatus> {
  const statuses: Record<string, WorkflowRenderStatus> = {};
  for (const node of model.nodes) {
    statuses[node.id] = node.status ?? "pending";
    if (node.childWorkflow) Object.assign(statuses, pendingStatuses(node.childWorkflow.model));
  }
  return statuses;
}

function statusFromEvent(event: WorkflowFieldEvent): WorkflowRenderStatus | undefined {
  if (/^(fork|join|node|operation|step|workflow\.end)\.started$/.test(event.type)) return "running";
  if (/^(fork|join|node|operation|step|workflow\.end)\.completed$/.test(event.type)) return "completed";
  if (/^(fork|node|operation|step|workflow\.end)\.failed$/.test(event.type)) return "failed";
  if (event.type === "step.skipped") return "skipped";
  if (event.type === "question.requested" || event.type === "hook.waiting") return "waiting";
  if (event.type === "question.answered" || event.type === "hook.resumed") return "running";
  return undefined;
}

function waitingText(event: WorkflowFieldEvent) {
  const detail = event.detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const questions = (detail as { questions?: readonly { prompt?: string }[] }).questions;
    const prompt = questions?.find((question) => typeof question.prompt === "string")?.prompt;
    if (prompt) return prompt;
  }
  return event.message || "Waiting for human input";
}

function hookWaitingKind(event: WorkflowFieldEvent): "human" | "signal" {
  const detail = recordDetail(event.detail);
  const hook = recordDetail(detail?.hook);
  return hook?.kind === "signal" ? "signal" : "human";
}

function runPhase(status: string, waitingLabel?: string): WorkflowFieldVisualState["phase"] {
  if (waitingLabel || status === "waiting") return "waiting";
  if (status === "completed") return "completed";
  if (status === "failed" || status === "cancelled") return "failed";
  return "running";
}
