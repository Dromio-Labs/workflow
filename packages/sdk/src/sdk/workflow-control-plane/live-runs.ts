import {
  assertHookOutput,
  HookOutputValidationError,
  type EventPayload,
} from "../core/index.js";
import {
  snapshotWorkflowAppRun,
  type WorkflowApp,
  type WorkflowAppResumeHookInput,
  type WorkflowAppRun,
  type WorkflowAppRunSnapshot,
  type WorkflowAppSession,
  type WorkflowAppRuntime,
} from "../client/interactions/workflow-app.js";
import { isWorkflowAppRunSnapshotNewer } from "../client/interactions/workflow-app/run-revision.js";
import type {
  Clock,
  IdGenerator,
  WorkflowRuntimeStore,
} from "./types.js";
import {
  timerJobsForRunSnapshot,
} from "./timer-jobs.js";
import { signalWaitsForRunSnapshot } from "./signal-waits.js";

export type ControlPlaneErrorFactory = (
  code: string,
  message: string,
  status?: number,
) => Error;

export type LiveRunController = {
  answerQuestion(runId: string, input: { questionId: string; value: unknown }): Promise<WorkflowAppRunSnapshot>;
  ensureLiveRun(runId: string): Promise<WorkflowAppRun>;
  getLiveRun(runId: string): WorkflowAppRun | undefined;
  persistRun(run: WorkflowAppRun): Promise<WorkflowAppRunSnapshot>;
  readRun(runId: string): Promise<WorkflowAppRunSnapshot>;
  resumeHook(input: WorkflowAppResumeHookInput): Promise<WorkflowAppRunSnapshot>;
  resumeRun(runId: string): Promise<WorkflowAppRunSnapshot>;
};

export function createLiveRunController(input: {
  app: WorkflowApp;
  clock: Clock;
  error: ControlPlaneErrorFactory;
  idGenerator: IdGenerator;
  runtime: WorkflowAppRuntime;
  runtimeStore: WorkflowRuntimeStore;
}): LiveRunController {
  const subscribedRunIds = new Set<string>();

  return {
    async answerQuestion(runId, answerInput) {
      const run = await ensureLiveRun(runId);
      return answerAndResume(run, answerInput);
    },
    ensureLiveRun,
    getLiveRun,
    persistRun,
    readRun,
    async resumeHook(resumeInput) {
      const run = await ensureLiveRun(runIdFromHookToken(resumeInput.token, input.error));
      const durableSession = run.session as WorkflowAppSession & Partial<DurableHookAnswerSession>;
      if (durableSession.consumedHookTokens?.has(resumeInput.token)) {
        return readRun(run.runId);
      }
      const hook = run.session.pendingHooks?.find((item) => item.token === resumeInput.token);
      if (!hook) throw input.error("HOOK_NOT_FOUND", "Hook token not found.", 404);
      if (hook.kind === "question") {
        return answerAndResume(run, { questionId: hook.id, value: resumeInput.value });
      }
      await applyHookAnswer(run, resumeInput);
      const answerPersistence = await persistRunResult(run);
      if (!answerPersistence.written) return answerPersistence.snapshot;
      const resumed = await input.runtime.resumeRun(run.runId);
      return persistRun(resumed);
    },
    async resumeRun(runId) {
      const run = await ensureLiveRun(runId);
      const resumed = await input.runtime.resumeRun(run.runId);
      return persistRun(resumed);
    },
  };

  async function persistRun(run: WorkflowAppRun): Promise<WorkflowAppRunSnapshot> {
    return (await persistRunResult(run)).snapshot;
  }

  async function answerAndResume(
    run: WorkflowAppRun,
    answerInput: { questionId: string; value: unknown },
  ): Promise<WorkflowAppRunSnapshot> {
    const questionHook = run.session.pendingHooks?.find((hook) =>
      hook.kind === "question" && hook.id === answerInput.questionId
    );
    const answered = await input.runtime.answerQuestion(run.runId, answerInput);
    const answerPersistence = await persistRunResult(answered);
    if (!answerPersistence.written) return answerPersistence.snapshot;
    if (
      questionHook &&
      !(answered.session as WorkflowAppSession & Partial<DurableHookAnswerSession>)
        .consumedHookTokens?.has(questionHook.token)
    ) {
      return answerPersistence.snapshot;
    }
    const resumed = await input.runtime.resumeRun(answered.runId);
    return persistRun(resumed);
  }

  async function persistRunResult(run: WorkflowAppRun) {
    const snapshot = snapshotWorkflowAppRun(input.app, run);
    const persisted = await input.runtimeStore.putWorkflowRun(snapshot);
    if (!persisted.written) return persisted;
    const now = input.clock.now().toISOString();
    await input.runtimeStore.syncSignalWaits({
      now,
      runId: run.runId,
      waits: signalWaitsForRunSnapshot(snapshot, now),
    });
    for (const job of timerJobsForRunSnapshot({
      id: () => input.idGenerator.id("timer"),
      now,
      snapshot,
    })) {
      await input.runtimeStore.enqueueTriggerJob(job);
    }
    await input.runtimeStore.appendWorkflowRunEvents(run.runId, run.events);
    return persisted;
  }

  async function ensureLiveRun(runId: string): Promise<WorkflowAppRun> {
    const live = getLiveRun(runId);
    const stored = await input.runtimeStore.getWorkflowRun(runId);
    if (
      live &&
      (!stored || !isWorkflowAppRunSnapshotNewer(stored, snapshotWorkflowAppRun(input.app, live)))
    ) {
      return live;
    }
    if (!stored) throw input.error("RUN_NOT_FOUND", "Run not found.", 404);
    if (!isResumableRunStatus(stored.status)) {
      throw input.error(
        "RUN_NOT_RESUMABLE",
        `Run ${runId} is ${stored.status} and cannot be resumed.`,
        409,
      );
    }
    if (!input.runtime.hydrateRun) {
      throw input.error(
        "RUN_NOT_RESUMABLE",
        `Run ${runId} is not live and this runtime does not support hydration.`,
        409,
      );
    }
    try {
      const hydrated = await input.runtime.hydrateRun(stored);
      subscribeToRun(hydrated.runId);
      return hydrated;
    } catch (error) {
      throw input.error(
        "RUN_UNRESUMABLE",
        error instanceof Error ? error.message : String(error),
        409,
      );
    }
  }

  async function readRun(runId: string): Promise<WorkflowAppRunSnapshot> {
    const live = getLiveRun(runId);
    const stored = await input.runtimeStore.getWorkflowRun(runId);
    if (!live) {
      if (!stored) throw input.error("RUN_NOT_FOUND", "Run not found.", 404);
      if (!isResumableRunStatus(stored.status)) return stored;
      return snapshotWorkflowAppRun(input.app, await ensureLiveRun(runId));
    }
    const current = snapshotWorkflowAppRun(input.app, live);
    if (!stored || !isWorkflowAppRunSnapshotNewer(stored, current)) return current;
    if (!isResumableRunStatus(stored.status)) return stored;
    return snapshotWorkflowAppRun(input.app, await ensureLiveRun(runId));
  }

  function subscribeToRun(runId: string): void {
    if (subscribedRunIds.has(runId)) return;
    subscribedRunIds.add(runId);
    input.runtime.subscribe(runId, (event) => {
      void input.runtimeStore.appendWorkflowRunEvents(event.runId, [event]);
    });
  }

  async function applyHookAnswer(
    run: WorkflowAppRun,
    resumeInput: WorkflowAppResumeHookInput,
  ): Promise<void> {
    const session = durableHookAnswerSession(run.session, input.error);
    if (session.consumedHookTokens.has(resumeInput.token)) return;
    const hook = run.session.pendingHooks?.find((item) => item.token === resumeInput.token);
    if (!hook) throw input.error("HOOK_NOT_FOUND", "Hook token not found.", 404);
    assertRequiredHandoffCapabilities(hook, resumeInput.source?.capabilities, input.error);
    try {
      assertHookOutput(hook, resumeInput.value);
    } catch (error) {
      if (error instanceof HookOutputValidationError) {
        throw input.error("HOOK_OUTPUT_VALIDATION_FAILED", error.message, 422);
      }
      throw error;
    }
    session.hookAnswers[resumeInput.token] = resumeInput.value;
    session.consumedHookTokens.add(resumeInput.token);
    session.emit({
      detail: {
        hook,
        ...(resumeInput.source ? { source: resumeInput.source } : {}),
        value: resumeInput.value,
      },
      message: `Resumed hook ${hook.id}.`,
      type: "hook.resumed",
    });
    run.status = session.status;
  }

  function getLiveRun(runId: string): WorkflowAppRun | undefined {
    return input.runtime.listRuns().find((run) => run.runId === runId);
  }
}

function assertRequiredHandoffCapabilities(
  hook: { input?: unknown; kind?: string },
  supported: string[] | undefined,
  error: (code: string, message: string, status: number) => Error,
): void {
  if (hook.kind !== "handoff_requested" || !isRecord(hook.input)) return;
  const requirements = hook.input.capabilityRequirements;
  if (!isRecord(requirements) || !Array.isArray(requirements.required)) return;
  const required = requirements.required.filter((item): item is string => typeof item === "string");
  const available = new Set(supported ?? []);
  const missing = required.filter((item) => !available.has(item));
  if (missing.length === 0) return;
  throw error(
    "HANDOFF_CAPABILITY_REQUIRED",
    `External harness is missing required capabilities: ${missing.join(", ")}.`,
    422,
  );
}

type DurableHookAnswerSession = WorkflowAppSession & {
  consumedHookTokens: Set<string>;
  emit(event: EventPayload): void;
  hookAnswers: Record<string, unknown>;
};

export function isResumableRunStatus(status: string) {
  return status === "paused" || status === "waiting";
}

function durableHookAnswerSession(
  session: WorkflowAppSession,
  error: ControlPlaneErrorFactory,
): DurableHookAnswerSession {
  const candidate = session as WorkflowAppSession & Partial<DurableHookAnswerSession>;
  if (
    candidate.consumedHookTokens instanceof Set &&
    typeof candidate.emit === "function" &&
    isRecord(candidate.hookAnswers)
  ) {
    return candidate as DurableHookAnswerSession;
  }
  throw error("RUN_UNRESUMABLE", "Run session does not support durable hook answers.", 409);
}

function runIdFromHookToken(
  token: string,
  error: ControlPlaneErrorFactory,
): string {
  const [kind, runId] = token.split(":");
  if ((kind === "hook" || kind === "question") && runId) return runId;
  throw error("INVALID_HOOK_TOKEN", `Cannot determine run id from hook token: ${token}`, 400);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
