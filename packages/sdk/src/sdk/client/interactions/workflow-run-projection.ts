import type {
  EventRecord,
  LoopGraphProjection,
  Question,
} from "../../core/index.js";
import {
  activityStatus,
  boundaryStep,
  durationNote,
  errorNote,
  isMeaningfulActivityEvent,
  markStaleAfter,
  markStaleBetween,
  mergeRuntimeOutput,
  modelNote,
  operationNote,
  questionsFromEvent,
  retryNote,
  runtimeInputForStep,
  scoreFromEvent,
  scoreNote,
  scoreStatus,
  stepIdFromEvent,
  waitingStateFromEvent,
} from "./workflow-run-projection-helpers.js";
import type {
  WorkflowRunActivityView,
  WorkflowRunLoopView,
  WorkflowRunModelView,
  WorkflowRunProjection,
  WorkflowRunStepView,
} from "./workflow-run-projection.types.js";

export type {
  WorkflowRunActivityView,
  WorkflowRunLoopView,
  WorkflowRunModelView,
  WorkflowRunProjection,
  WorkflowRunStepModelView,
  WorkflowRunStepPromptView,
  WorkflowRunStepStatus,
  WorkflowRunStepView,
} from "./workflow-run-projection.types.js";

export function projectWorkflowRun(input: {
  activityLimit?: number;
  events: EventRecord[];
  graph: LoopGraphProjection;
  input?: unknown;
}): WorkflowRunProjection {
  const triggerStep = boundaryStep(input.graph.trigger, "trigger", 0);
  const executableSteps: WorkflowRunStepView[] = input.graph.nodes.map((node, index) => ({
    catalog: node.catalog,
    catalogItemId: node.catalogItemId,
    childNodes: node.childNodes,
    description: node.description,
    id: node.id,
    input: node.input,
    index: index + 1,
    label: node.label,
    models: node.models?.map((model) => ({
      label: model.label,
      operation: model.operation,
      prompt: model.prompt,
      requested: model.requested,
      selected: model.requested,
    })),
    output: node.output,
    status: "pending" as const,
  }));
  const endStep = boundaryStep(input.graph.end, "end", executableSteps.length + 1);
  const steps: WorkflowRunStepView[] = [
    triggerStep,
    ...executableSteps,
    endStep,
  ];
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const runtimeState: Record<string, unknown> = {};
  const loops: WorkflowRunLoopView[] = [];
  const activity: WorkflowRunActivityView[] = [];
  let currentStepId: string | undefined;
  let pendingQuestions: Question[] = [];
  let runId: string | undefined;
  let status: WorkflowRunProjection["status"] = "idle";

  const pushActivity = (event: EventRecord, item: Omit<WorkflowRunActivityView, "type"> & { type?: string }) => {
    activity.push({
      type: item.type ?? event.type,
      ...item,
    });
    const limit = input.activityLimit ?? 5;
    while (activity.length > limit) activity.shift();
  };

  for (const event of input.events) {
    runId = event.runId ?? runId;
    const stepId = stepIdFromEvent(event) ?? currentStepId;
    const step = stepId ? stepById.get(stepId) : undefined;

    if (event.type === "run.started" || event.type === "run.resumed") {
      status = "running";
      triggerStep.status = "done";
      triggerStep.note = event.type === "run.resumed" ? "resumed" : "started";
      triggerStep.runtimeInput = input.input;
      triggerStep.runtimeOutput = input.input;
      mergeRuntimeOutput(runtimeState, triggerStep.id, input.input);
      pushActivity(event, { message: event.message, status: "running" });
      continue;
    }
    if (event.type === "run.completed") {
      status = "completed";
      currentStepId = undefined;
      pendingQuestions = [];
      triggerStep.status = "done";
      endStep.status = "done";
      endStep.note = durationNote(event) ?? "completed";
      endStep.runtimeInput = { ...runtimeState };
      endStep.runtimeOutput = { ...runtimeState };
      pushActivity(event, { message: event.message, status: "ok" });
      continue;
    }
    if (event.type === "run.rerun.created") {
      const detail = event.detail as {
        childRunId?: string;
        checkpoint?: { stepId?: string };
      } | undefined;
      const targetStepId = detail?.checkpoint?.stepId;
      const targetStep = targetStepId ? stepById.get(targetStepId) : undefined;
      if (targetStepId && targetStep) {
        targetStep.status = "revisiting";
        targetStep.note = "resume from this step";
        markStaleAfter(steps, targetStepId);
        currentStepId = targetStepId;
        status = "running";
      }
      pushActivity(event, {
        message: detail?.childRunId && targetStepId
          ? `Created revision ${detail.childRunId} from ${targetStepId}.`
          : event.message,
        status: "waiting",
        stepId: targetStepId,
      });
      continue;
    }
    if (event.type === "run.failed") {
      status = "failed";
      currentStepId = undefined;
      pendingQuestions = [];
      triggerStep.status = triggerStep.status === "pending" ? "done" : triggerStep.status;
      endStep.status = "failed";
      endStep.note = errorNote(event) ?? "failed";
      pushActivity(event, { message: event.message, status: "error" });
      continue;
    }

    if (event.type === "run.state.updated") {
      if (event.detail && typeof event.detail === "object" && !Array.isArray(event.detail)) {
        mergeRuntimeOutput(runtimeState, stepId ?? "$state", event.detail);
      }
      pushActivity(event, { message: event.message, status: "info", stepId });
      continue;
    }

    if (event.type === "step.started" && step) {
      status = "running";
      currentStepId = step.id;
      pendingQuestions = [];
      step.status = event.attempt && event.attempt > 1 ? "revisiting" : "running";
      step.attempt = event.attempt;
      step.runtimeInput = runtimeInputForStep(step.input, runtimeState, input.input);
      step.note = event.attempt && event.attempt > 1 ? `attempt ${event.attempt}` : undefined;
      pushActivity(event, { message: event.message, status: "running", stepId: step.id });
      continue;
    }

    if (event.type === "step.waiting" && step) {
      status = "waiting";
      currentStepId = step.id;
      step.status = "waiting";
      step.attempt = event.attempt;
      const waitingState = waitingStateFromEvent(event);
      if (waitingState) {
        step.runtimeOutput = waitingState;
        mergeRuntimeOutput(runtimeState, step.id, waitingState);
      }
      const questions = questionsFromEvent(event);
      if (questions.length > 0) pendingQuestions = questions;
      step.note = pendingQuestions.length > 0
        ? `${pendingQuestions.length} question${pendingQuestions.length === 1 ? "" : "s"}`
        : "waiting";
      pushActivity(event, { message: event.message, status: "waiting", stepId: step.id });
      continue;
    }

    if (event.type === "question.requested") {
      const questions = questionsFromEvent(event);
      if (questions.length > 0) pendingQuestions = questions;
      if (step) {
        status = "waiting";
        currentStepId = step.id;
        step.status = "waiting";
        step.note = `${pendingQuestions.length} question${pendingQuestions.length === 1 ? "" : "s"}`;
      }
      pushActivity(event, { message: event.message, status: "waiting", stepId });
      continue;
    }

    if (event.type === "question.answered") {
      const detail = event.detail as { questionId?: string } | undefined;
      if (detail?.questionId) {
        pendingQuestions = pendingQuestions.filter((question) => question.id !== detail.questionId);
      }
      if (pendingQuestions.length === 0 && status === "waiting") {
        status = "running";
        if (step?.status === "waiting") {
          step.status = "running";
          step.note = undefined;
        }
      }
      pushActivity(event, { message: event.message, status: "ok", stepId });
      continue;
    }

    if (event.type === "model.worker.selected" && step) {
      const detail = event.detail as {
        requested?: WorkflowRunModelView;
        selected?: WorkflowRunModelView;
        target?: { operation?: string };
      } | undefined;
      const operation = detail?.target?.operation ?? "model";
      const models = step.models ?? [];
      const index = models.findIndex((model) => model.operation === operation);
      const next = {
        label: operation,
        operation,
        requested: detail?.requested,
        selected: detail?.selected,
      };
      step.models = index >= 0
        ? models.map((model, modelIndex) => modelIndex === index
          ? {
              ...model,
              requested: detail?.requested ?? model.requested,
              selected: detail?.selected ?? model.selected,
            }
          : model)
        : [...models, next];
      step.note = modelNote(detail?.selected) ?? step.note;
      pushActivity(event, { message: event.message, status: "ok", stepId: step.id });
      continue;
    }

    if (event.type === "step.completed" && step) {
      pendingQuestions = [];
      if (currentStepId === step.id) currentStepId = undefined;
      if (status !== "completed" && status !== "failed") status = "running";
      step.status = "done";
      step.attempt = event.attempt;
      step.runtimeOutput = event.detail;
      mergeRuntimeOutput(runtimeState, step.id, event.detail);
      step.note = durationNote(event) ?? step.note;
      pushActivity(event, { message: event.message, status: "ok", stepId: step.id });
      continue;
    }

    if (event.type === "step.failed" && step) {
      status = "failed";
      currentStepId = step.id;
      pendingQuestions = [];
      step.status = "failed";
      step.note = errorNote(event) ?? event.message;
      pushActivity(event, { message: event.message, status: "error", stepId: step.id });
      continue;
    }

    if (event.type === "step.retrying" && step) {
      step.status = "retrying";
      step.note = retryNote(event) ?? "retrying";
      pushActivity(event, { message: event.message, status: "waiting", stepId: step.id });
      continue;
    }

    if (event.type === "step.goto") {
      const detail = event.detail as { fromStepId?: string; reason?: string; targetStepId?: string } | undefined;
      const fromStepId = detail?.fromStepId ?? stepId;
      const targetStepId = detail?.targetStepId;
      if (!fromStepId || !targetStepId) continue;
      const fromStep = stepById.get(fromStepId);
      const targetStep = stepById.get(targetStepId);
      if (fromStep) {
        fromStep.status = "looped";
        fromStep.note = detail?.reason ?? "looped";
      }
      if (targetStep) {
        targetStep.status = "revisiting";
        targetStep.note = "revisiting";
      }
      markStaleBetween(steps, targetStepId, fromStepId);
      loops.push({ fromStepId, reason: detail?.reason, targetStepId });
      currentStepId = targetStepId;
      status = "running";
      pushActivity(event, {
        message: detail?.reason
          ? `${fromStepId} -> ${targetStepId}: ${detail.reason}`
          : `${fromStepId} -> ${targetStepId}`,
        status: "waiting",
        stepId: fromStepId,
      });
      continue;
    }

    if ((event.type === "score.gated" || event.type === "evaluation.completed") && step) {
      const score = scoreFromEvent(event);
      if (score !== undefined) {
        step.score = score;
        step.note = scoreNote(event) ?? step.note;
      }
      pushActivity(event, { message: event.message, status: scoreStatus(event), stepId: step.id });
      continue;
    }

    if (isMeaningfulActivityEvent(event)) {
      if (step && event.type.endsWith(".started")) {
        step.note = operationNote(event) ?? step.note;
      }
      pushActivity(event, {
        message: event.message,
        status: activityStatus(event),
        stepId,
      });
    }
  }

  const currentStep = currentStepId ? stepById.get(currentStepId) : undefined;
  return {
    activity,
    currentStep,
    currentStepId,
    graph: input.graph,
    input: input.input,
    loops,
    pendingQuestions,
    runId,
    state: { ...runtimeState },
    status,
    steps,
  };
}
