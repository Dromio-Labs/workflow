import type {
  HookRequest,
  LoopHydrationSnapshot,
  StepRuntimeMetadata,
  StepState,
} from "../../core/index.js";

const CHILD_WORKFLOW_STATE_KEY = "__childWorkflows";

type ChildWorkflowDurableEntry = {
  completedRunId?: string;
  completedState?: Record<string, unknown>;
  snapshot?: LoopHydrationSnapshot;
};

/** Deterministic parent-side token for a mirrored child hook. */
export function mirrorChildHookToken(namespace: string, childToken: string) {
  return `hook:child:${namespace}:${childToken}`;
}

export function namespacedChildQuestionId(namespace: string, questionId: string) {
  return `${namespace}.${questionId}`;
}

/**
 * Answers scoped for a child: namespaced parent answers win, raw answers pass
 * through so pre-namespacing consumers keep working at depth one.
 */
export function scopedChildAnswers(
  namespace: string,
  answers: Record<string, unknown>,
): Record<string, unknown> {
  const prefix = `${namespace}.`;
  const scoped: Record<string, unknown> = { ...answers };
  for (const [key, value] of Object.entries(answers)) {
    if (key.startsWith(prefix)) scoped[key.slice(prefix.length)] = value;
  }
  return scoped;
}

export function mirrorChildHookRequest(
  namespace: string,
  step: StepRuntimeMetadata,
  request: HookRequest,
): HookRequest {
  return {
    correlationId: step.correlationId,
    ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
    id: namespacedChildQuestionId(namespace, request.id),
    input: request.input,
    ...(request.kind ? { kind: request.kind } : {}),
    ...(request.render ? { render: request.render } : {}),
    ...(request.schema ? { schema: request.schema } : {}),
    stepId: step.id,
    ...(request.title ? { title: request.title } : {}),
    token: mirrorChildHookToken(namespace, request.token),
  };
}

export function childWorkflowStateRoot(state: StepState): Record<string, ChildWorkflowDurableEntry> {
  const container = state as Record<string, unknown>;
  const existing = container[CHILD_WORKFLOW_STATE_KEY];
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return existing as Record<string, ChildWorkflowDurableEntry>;
  }
  const created: Record<string, ChildWorkflowDurableEntry> = {};
  container[CHILD_WORKFLOW_STATE_KEY] = created;
  return created;
}

export function isTerminalChildWorkflowFailure(status: string) {
  return status === "failed" || status === "cancelled";
}
