import type {
  EventRecord,
  LoopCheckpoint,
  LoopStatus,
  HookRequest,
} from "../../core/loop/index.js";
import type { Question } from "../intent/index.js";
import type {
  WorkflowEvent,
  WorkflowRunOutput,
} from "./workflow.types.js";
import type { WorkflowState } from "./workflow-state.js";

export function acceptedQuestionAnswer(events: EventRecord[], fromIndex: number, questionId: string) {
  return events.slice(fromIndex).some((event) =>
    event.type === "question.answered" &&
    (event.detail as { questionId?: string } | undefined)?.questionId === questionId
  );
}

export function rejectedQuestionResolution(events: EventRecord[], fromIndex: number, questionId: string) {
  for (let index = events.length - 1; index >= fromIndex; index -= 1) {
    const event = events[index];
    if (
      event?.type === "question.resolution.rejected" &&
      (event.detail as { questionId?: string } | undefined)?.questionId === questionId
    ) {
      const detail = event.detail as { kind?: string; status?: string } | undefined;
      return {
        kind: detail?.kind,
        status: detail?.status,
      };
    }
  }
  return undefined;
}

export function outputFromSession<TArtifact>(session: {
  checkpoints: Array<LoopCheckpoint<{ prompt: string }>>;
  events: WorkflowEvent[];
  pendingHooks: HookRequest[];
  pendingQuestions: Question[];
  runId: string;
  state: Record<string, unknown>;
  status: LoopStatus;
}): WorkflowRunOutput<TArtifact> {
  const state = session.state as WorkflowState<TArtifact>;
  return {
    artifact: state.artifact,
    candidateEvaluation: state.candidateEvaluation,
    checkpoints: session.checkpoints,
    events: session.events,
    intent: state.intent,
    pendingHooks: session.pendingHooks,
    pendingQuestions: session.pendingQuestions,
    plan: state.plan,
    result: state.result,
    runId: session.runId,
    status: session.status,
  };
}
