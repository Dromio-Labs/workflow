import type {
  EventRecord,
  LoopCheckpoint,
} from "../../../core/index.js";
import {
  resolveWorkflowAppStartInput,
} from "./commands.js";
import {
  durableWorkflowAppSession,
} from "./durable-session.js";
import {
  createWorkflowAppThreadEventBridge,
} from "./thread-events.js";
import { artifactsFromEvents } from "./artifacts-from-events.js";
import { isWorkflowAppRunSnapshotNewer } from "./run-revision.js";
import type {
  WorkflowApp,
  WorkflowAppArtifact,
  WorkflowAppEntry,
  WorkflowAppModelWorkerSelection,
  WorkflowAppQuestion,
  WorkflowAppRun,
  WorkflowAppRunSnapshot,
  WorkflowAppRuntime,
  WorkflowAppRuntimeOptions,
  WorkflowAppSession,
} from "./types.js";

export function createWorkflowAppRuntime(
  app: WorkflowApp,
  options: WorkflowAppRuntimeOptions = {},
): WorkflowAppRuntime {
  const runs = new Map<string, WorkflowAppRun>();
  const listeners = new Map<string, Set<(event: EventRecord) => void>>();
  const finalizedRunIds = new Set<string>();
  const threadEvents = createWorkflowAppThreadEventBridge(options);

  return {
    app,
    async answerQuestion(runId, input) {
      const run = requireRun(runId);
      await run.session.answer(input);
      run.status = run.session.status;
      await finalizeRun(run);
      return run;
    },
    formatResult(runId) {
      const run = requireRun(runId);
      return formatWorkflowAppResult(app.getWorkflow(run.workflowId), run.session);
    },
    getRun: requireRun,
    async hydrateRun(snapshot) {
      if (isWorkflowAppTerminalStatus(snapshot.status)) {
        throw new Error(`Cannot hydrate terminal run ${snapshot.runId} with status ${snapshot.status}.`);
      }
      const current = runs.get(snapshot.runId);
      if (
        current &&
        !isWorkflowAppRunSnapshotNewer(snapshot, snapshotWorkflowAppRun(app, current))
      ) {
        return current;
      }
      const entry = app.getWorkflow(snapshot.workflowId);
      if (!entry.workflow.hydrate) {
        throw new Error(`Workflow ${snapshot.workflowId} does not support run hydration.`);
      }
      const events = [...snapshot.events];
      const session = await entry.workflow.hydrate(snapshot, {
        onEvent(event) {
          events.push(event);
          for (const listener of listeners.get(event.runId) ?? []) listener(event);
        },
      });
      const run = {
        artifactError: snapshot.artifactError,
        attachments: snapshot.attachments,
        artifacts: snapshot.artifacts,
        events,
        input: snapshot.input,
        origin: snapshot.origin,
        runId: session.runId,
        session,
        status: session.status,
        workflowId: snapshot.workflowId,
      };
      runs.set(run.runId, run);
      threadEvents.emitRunSuspended(run);
      return run;
    },
    listRuns() {
      return [...runs.values()];
    },
    listModelWorkers() {
      return app.modelRouter?.options() ?? [];
    },
    listWorkflows() {
      return app.listWorkflows();
    },
    selectModelWorker(input) {
      const router = app.modelRouter;
      if (!router) return undefined;
      router.select(input);
      const run = input.runId ? runs.get(input.runId) : undefined;
      if (!run) return undefined;
      const requestedModelId = input.requestedModelId ?? input.modelId;
      const selection = router.selection({
        requested: requestedModelId,
        target: input,
      });
      appendRuntimeEvent(run, modelWorkerSelectedRuntimeEvent(selection), undefined);
      return run;
    },
    async resumeHook(input) {
      const run = requireRunForHook(input.token);
      if (!run.session.resumeHook) {
        throw new Error(`Run ${run.runId} does not support hook resume.`);
      }
      await run.session.resumeHook(input);
      run.status = run.session.status;
      await finalizeRun(run);
      return run;
    },
    async rerunFromStep(runId, input) {
      const run = requireRun(runId);
      if (!run.session.rerunFromCheckpoint) {
        throw new Error(`Run ${run.runId} does not support checkpoint reruns.`);
      }
      const checkpoint = (run.session.checkpoints ?? [])
        .find((item) => item.stepId === input.stepId);
      if (!checkpoint) {
        throw new Error(`No checkpoint is available for step ${input.stepId}.`);
      }
      const events: EventRecord[] = [];
      const child = await run.session.rerunFromCheckpoint({
        answers: answersBeforeCheckpoint(run, checkpoint),
        checkpointId: checkpoint.checkpointId,
        onEvent(event) {
          events.push(event);
          for (const listener of listeners.get(event.runId) ?? []) listener(event);
        },
      });
      const childRun = rerunChildWorkflowAppRun(run, child, events);
      runs.set(child.runId, childRun);
      await finalizeRun(childRun);
      threadEvents.emitRunSuspended(childRun);
      return childRun;
    },
    async resumeRun(runId) {
      const run = requireRun(runId);
      await run.session.resume();
      run.status = run.session.status;
      run.artifacts = artifactsFromEvents(run.events);
      await finalizeRun(run);
      return run;
    },
    async startRun(input) {
      const resolved = resolveWorkflowAppStartInput(app, input);
      const workflowId = resolved.workflowId;
      const entry = app.getWorkflow(workflowId);
      const trigger = app.listWorkflows()
        .find((workflow) => workflow.id === workflowId)?.triggers
        .find((item) => item.id === resolved.triggerId);
      const events: EventRecord[] = [];
      const session = await entry.workflow.start(resolved.input, {
        answers: input.answers,
        onEvent(event) {
          events.push(event);
          input.onEvent?.(event);
          for (const listener of listeners.get(event.runId) ?? []) listener(event);
        },
        questionResolvers: input.questionResolvers,
        runId: input.runId,
      });
      const run = {
        attachments: input.attachments,
        artifacts: artifactsFromEvents(events),
        events,
        input: resolved.input,
        origin: input.origin ?? (trigger ? { triggerId: trigger.id, type: trigger.type } : undefined),
        runId: session.runId,
        session,
        status: session.status,
        workflowId,
      };
      runs.set(session.runId, run);
      await finalizeRun(run, input.onEvent);
      threadEvents.emitRunSuspended(run);
      return run;
    },
    subscribe(runId, listener) {
      let set = listeners.get(runId);
      if (!set) {
        set = new Set();
        listeners.set(runId, set);
      }
      set.add(listener);
      return () => {
        set?.delete(listener);
      };
    },
  };

  function requireRun(runId: string) {
    const run = runs.get(runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    return run;
  }

  function requireRunForHook(token: string) {
    for (const run of runs.values()) {
      if (run.session.pendingHooks?.some((hook) => hook.token === token)) return run;
    }
    throw new Error(`Unknown hook token: ${token}`);
  }

  async function finalizeRun(
    run: WorkflowAppRun,
    eventSink?: (event: EventRecord) => void,
  ) {
    if (!isWorkflowAppTerminalStatus(run.status)) return;
    if (finalizedRunIds.has(run.runId)) return;
    const hooks = options.endHooks ?? [];
    if (hooks.length === 0) return;
    finalizedRunIds.add(run.runId);
    const endStepId = app.graph(run.workflowId).end?.id ?? "$end";

    appendRuntimeEvent(run, {
      message: "Running workflow end hooks.",
      stepId: endStepId,
      type: "workflow.end.started",
    }, eventSink);

    const artifacts: WorkflowAppArtifact[] = [];
    const errors: string[] = [];
    for (const hook of hooks) {
      try {
        const output = await hook({
          artifactName: workflowAppResultArtifactName(app.getWorkflow(run.workflowId)),
          run: snapshotWorkflowAppRun(app, run),
        });
        if (output?.length) artifacts.push(...output);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (artifacts.length > 0) run.artifacts = [...run.artifacts, ...artifacts];
    if (errors.length > 0) {
      run.artifactError = errors.join("\n");
      appendRuntimeEvent(run, {
        detail: { error: run.artifactError },
        message: "Workflow end hook failed.",
        stepId: endStepId,
        type: "workflow.end.failed",
      }, eventSink);
      return;
    }

    appendRuntimeEvent(run, {
      detail: { artifacts: run.artifacts },
      message: "Completed workflow end hooks.",
      stepId: endStepId,
      type: "workflow.end.completed",
    }, eventSink);
  }

  function appendRuntimeEvent(
    run: WorkflowAppRun,
    event: Omit<EventRecord, "correlationId" | "index" | "runId" | "timestamp"> & Partial<Pick<EventRecord, "correlationId" | "index" | "runId" | "timestamp">>,
    eventSink?: (event: EventRecord) => void,
  ) {
    const record = workflowAppRuntimeEventRecord(run, event);
    run.events.push(record);
    eventSink?.(record);
    for (const listener of listeners.get(run.runId) ?? []) listener(record);
  }

}

export function formatWorkflowAppResult(
  entry: WorkflowAppEntry,
  session: WorkflowAppSession,
) {
  return entry.result?.format?.(session) ?? JSON.stringify(session.state ?? {}, null, 2);
}

export function snapshotWorkflowAppRun(
  app: WorkflowApp,
  run: WorkflowAppRun,
): WorkflowAppRunSnapshot {
  return {
    answers: run.session.answers,
    artifactError: run.artifactError,
    attachments: run.attachments,
    artifacts: run.artifacts,
    checkpoints: run.session.checkpoints,
    durable: durableWorkflowAppSession(run.session),
    events: run.events,
    input: run.input,
    origin: run.origin,
    parentCheckpointId: run.session.parentCheckpointId,
    parentRunId: run.session.parentRunId,
    pendingHooks: run.session.pendingHooks,
    pendingQuestions: run.session.pendingQuestions,
    result: run.session.status === "completed" ? formatWorkflowAppResult(app.getWorkflow(run.workflowId), run.session) : undefined,
    runId: run.runId,
    state: run.session.state,
    status: run.status,
    workflowId: run.workflowId,
  };
}

function answersBeforeCheckpoint(
  run: WorkflowAppRun,
  checkpoint: LoopCheckpoint<unknown>,
) {
  const answers = { ...(run.session.answers ?? {}) };
  const questionIdsToRevise = new Set<string>();
  for (const event of run.events) {
    if (event.index < checkpoint.eventIndex) continue;
    if (event.type !== "question.requested") continue;
    for (const question of eventQuestions(event)) questionIdsToRevise.add(question.id);
  }
  for (const questionId of questionIdsToRevise) delete answers[questionId];
  return answers;
}

function eventQuestions(event: EventRecord): WorkflowAppQuestion[] {
  const detail = event.detail as { questions?: unknown } | undefined;
  if (!Array.isArray(detail?.questions)) return [];
  return detail.questions.filter((item): item is WorkflowAppQuestion =>
    Boolean(item && typeof item === "object" && "id" in item && typeof item.id === "string")
  );
}

function rerunChildWorkflowAppRun(
  run: WorkflowAppRun,
  child: WorkflowAppSession,
  events: EventRecord[],
): WorkflowAppRun {
  const parentRevisionEvent = [...run.events].reverse().find((event) => {
    if (event.type !== "run.rerun.created") return false;
    const detail = event.detail as { childRunId?: string } | undefined;
    return detail?.childRunId === child.runId;
  });
  const childEvents = parentRevisionEvent
    ? [
        {
          ...parentRevisionEvent,
          correlationId: `${parentRevisionEvent.correlationId ?? `run:${run.runId}:rerun`}:child:${child.runId}`,
          runId: child.runId,
        },
        ...events,
      ]
    : events;
  return {
    attachments: run.attachments,
    artifacts: [],
    events: childEvents,
    input: run.input,
    origin: run.origin,
    runId: child.runId,
    session: child,
    status: child.status,
    workflowId: run.workflowId,
  };
}

function modelWorkerSelectedRuntimeEvent(selection: WorkflowAppModelWorkerSelection) {
  const operation = selection.target.operation ?? "model";
  const label = selection.selected.model
    ? `${selection.selected.label ?? selection.selected.id} (${selection.selected.model})`
    : selection.selected.label ?? selection.selected.id;
  return {
    detail: selection,
    message: `Selected ${label} for ${selection.target.stepId}/${operation}.`,
    stepId: selection.target.stepId,
    trace: {
      attributes: {
        model: selection.selected.model ?? "",
        modelId: selection.selected.id,
        operation,
        phase: "model",
        provider: selection.selected.worker ?? "",
        requestedModelId: selection.requested.id,
        stepId: selection.target.stepId,
        ...(selection.target.workflowId ? { workflowId: selection.target.workflowId } : {}),
      },
      kind: "internal" as const,
      name: `Select model for ${operation}`,
      parentSpanId: selection.target.runId ? `run:${selection.target.runId}` : undefined,
      spanId: `model-router:${selection.target.stepId}:${operation}`,
      status: "ok" as const,
      traceId: selection.target.runId ?? "model-router",
    },
    type: "model.worker.selected",
  };
}

function workflowAppRuntimeEventRecord(
  run: WorkflowAppRun,
  event: Omit<EventRecord, "correlationId" | "index" | "runId" | "timestamp"> & Partial<Pick<EventRecord, "correlationId" | "index" | "runId" | "timestamp">>,
): EventRecord {
  const index = event.index ?? ((run.events.at(-1)?.index ?? -1) + 1);
  const eventType = event.type as string;
  const trace = event.trace as EventRecord["trace"] | undefined;
  const stepId = typeof event.stepId === "string" ? event.stepId : "$end";
  return {
    ...event,
    correlationId: event.correlationId ?? `run:${run.runId}:end:${index}`,
    index,
    message: String(event.message),
    runId: event.runId ?? run.runId,
    timestamp: event.timestamp ?? new Date().toISOString(),
    trace: trace ?? {
      attributes: {
        eventType,
        workflowId: run.workflowId,
      },
      kind: "internal",
      name: stepId,
      parentSpanId: `run:${run.runId}`,
      spanId: `step:${stepId}:attempt:1`,
      status: eventType.endsWith(".failed") ? "error" : eventType.endsWith(".completed") ? "ok" : "unset",
      traceId: run.runId,
    },
    type: eventType,
  };
}

function workflowAppResultArtifactName(entry: WorkflowAppEntry) {
  return entry.result?.artifactName ?? "result.md";
}

function isWorkflowAppTerminalStatus(status: string) {
  return status === "completed" || status === "failed" || status === "cancelled";
}
