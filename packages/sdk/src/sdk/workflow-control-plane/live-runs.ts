import type {
  EventPayload,
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
  persistRun(run: WorkflowAppRun): Promise<void>;
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
      const answered = await input.runtime.answerQuestion(run.runId, answerInput);
      await persistRun(answered);
      const resumed = await input.runtime.resumeRun(answered.runId);
      await persistRun(resumed);
      return snapshotWorkflowAppRun(input.app, resumed);
    },
    ensureLiveRun,
    getLiveRun,
    persistRun,
    readRun,
    async resumeHook(resumeInput) {
      const run = await ensureLiveRun(runIdFromHookToken(resumeInput.token, input.error));
      await applyHookAnswer(run, resumeInput);
      await persistRun(run);
      const resumed = await input.runtime.resumeRun(run.runId);
      await persistRun(resumed);
      return snapshotWorkflowAppRun(input.app, resumed);
    },
    async resumeRun(runId) {
      const run = await ensureLiveRun(runId);
      const resumed = await input.runtime.resumeRun(run.runId);
      await persistRun(resumed);
      return snapshotWorkflowAppRun(input.app, resumed);
    },
  };

  async function persistRun(run: WorkflowAppRun): Promise<void> {
    const snapshot = snapshotWorkflowAppRun(input.app, run);
    await input.runtimeStore.putWorkflowRun(snapshot);
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
    if (hook.kind === "question") {
      await run.session.answer({
        questionId: hook.id,
        value: resumeInput.value,
      });
      run.status = run.session.status;
      return;
    }
    session.hookAnswers[resumeInput.token] = resumeInput.value;
    session.consumedHookTokens.add(resumeInput.token);
    session.emit({
      detail: {
        hook,
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
