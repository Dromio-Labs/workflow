import type {
  LoopSessionDurableSnapshot,
} from "../../../core/index.js";
import type {
  WorkflowAppSession,
} from "./types.js";

type DurableWorkflowAppSession = WorkflowAppSession & {
  consumedHookTokens: Set<string>;
  createdStepIds: Set<string>;
  currentStepIndex: number;
  hasStarted: boolean;
  hookAnswers: Record<string, unknown>;
  nextEventIndex: number;
  questionResolutionHistory: LoopSessionDurableSnapshot["questionResolutionHistory"];
  retryCounts: Map<string, number>;
  stepRunCounts: Map<string, number>;
};

export function durableWorkflowAppSession(
  session: WorkflowAppSession,
): LoopSessionDurableSnapshot | undefined {
  if (!isDurableWorkflowAppSession(session)) return undefined;
  return {
    consumedHookTokens: [...session.consumedHookTokens],
    createdStepIds: [...session.createdStepIds],
    currentStepIndex: session.currentStepIndex,
    hasStarted: session.hasStarted,
    hookAnswers: session.hookAnswers,
    nextEventIndex: session.nextEventIndex,
    questionResolutionHistory: session.questionResolutionHistory,
    retryCounts: Object.fromEntries(session.retryCounts),
    stepRunCounts: Object.fromEntries(session.stepRunCounts),
    version: 1,
  };
}

function isDurableWorkflowAppSession(
  session: WorkflowAppSession,
): session is DurableWorkflowAppSession {
  const candidate = session as WorkflowAppSession & Partial<DurableWorkflowAppSession>;
  return typeof candidate.currentStepIndex === "number" &&
    typeof candidate.hasStarted === "boolean" &&
    typeof candidate.nextEventIndex === "number" &&
    isRecord(candidate.hookAnswers) &&
    candidate.consumedHookTokens instanceof Set &&
    candidate.createdStepIds instanceof Set &&
    candidate.retryCounts instanceof Map &&
    candidate.stepRunCounts instanceof Map;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
