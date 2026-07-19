import { Ajv } from "ajv";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_LEASE_MS,
  retryDelayMsForAttempt,
} from "@dromio/workflow-kernel";
import type {
  EventRecord,
} from "../core/index.js";
import {
  createWorkflowAppRuntime,
  snapshotWorkflowAppRun,
  type WorkflowApp,
  type WorkflowAppRuntime,
  type WorkflowAppStartRunInput,
} from "../client/interactions/workflow-app.js";
import {
  createLiveRunController,
} from "./live-runs.js";
import {
  isTerminalJobStatus,
  isTerminalRunStatus,
  lastRunTimestamp,
  matchesRunFilter,
  stableTriggerPayloadHash,
  triggerOriginType,
  workflowInputFromJob,
} from "./job-support.js";
import type {
  AuthTokenVerifier,
  AuthorizeWorkflowControlPlaneInput,
  CancelTriggerJobInput,
  Clock,
  ClaimTriggerJobInput,
  CompleteTriggerJobInput,
  DeadLetterTriggerJobInput,
  EnqueueTriggerInput,
  EnqueueTriggerResult,
  FailTriggerJobInput,
  IdGenerator,
  PruneRuntimeInput,
  RetryTriggerJobInput,
  TriggerDescriptor,
  TriggerJobEvent,
  TriggerJobSnapshot,
  TriggerRegistryStore,
  WatchOptions,
  WorkflowControlPlane,
  WorkflowRuntimeStore,
} from "./types.js";
import type { CanonicalTriggerExecutionFacade } from "./canonical-trigger-facade.js";
import type { SignalDefinition } from "../authoring/signal.js";
import { createSignalControlPlane } from "./signal-control-plane.js";

export type CreateWorkflowControlPlaneInput = {
  app: WorkflowApp;
  auth?: AuthTokenVerifier;
  clock?: Clock;
  idGenerator?: IdGenerator;
  runtime?: WorkflowAppRuntime;
  runtimeStore: WorkflowRuntimeStore;
  signals?: readonly SignalDefinition[];
  triggerStore: TriggerRegistryStore;
  canonicalTriggerExecution?: CanonicalTriggerExecutionFacade;
};

export function createWorkflowControlPlane(input: CreateWorkflowControlPlaneInput): WorkflowControlPlane {
  const clock = input.clock ?? systemClock;
  const ids = input.idGenerator ?? randomIdGenerator;
  const runtime = input.runtime ?? createWorkflowAppRuntime(input.app);
  const liveRuns = createLiveRunController({
    app: input.app,
    clock,
    error: (code, message, status) => new ControlPlaneError(code, message, status),
    idGenerator: ids,
    runtime,
    runtimeStore: input.runtimeStore,
  });
  const jobListeners = new Map<string, Set<() => void>>();
  const signalPlane = createSignalControlPlane({
    authorize,
    clock,
    error: (code, message, status) => new ControlPlaneError(code, message, status),
    idGenerator: ids,
    runtimeStore: input.runtimeStore,
    signals: input.signals ?? [],
  });

  const controlPlane: WorkflowControlPlane = {
    answerQuestion: liveRuns.answerQuestion,
    async authorize(authInput) {
      await authorize(authInput);
    },
    async cancelTriggerJob(cancelInput) {
      if (input.canonicalTriggerExecution) { const job = await input.canonicalTriggerExecution.cancel(cancelInput.jobId); emitJobChanged(job.id); return job; }
      const job = await input.runtimeStore.cancelTriggerJob({
        error: cancelInput.reason ?? "Cancelled by operator.",
        jobId: cancelInput.jobId,
        now: clock.now().toISOString(),
      });
      emitJobChanged(job.id);
      return job;
    },
    async claimNextTriggerJob(claimInput) {
      if (input.canonicalTriggerExecution) { const job = await input.canonicalTriggerExecution.claim(claimInput.workerId, claimInput.leaseMs ?? DEFAULT_LEASE_MS); if (job) emitJobChanged(job.id); return job; }
      const job = await input.runtimeStore.claimNextTriggerJob({
        leaseMs: claimInput.leaseMs ?? DEFAULT_LEASE_MS,
        now: clock.now().toISOString(),
        workerId: claimInput.workerId,
      });
      if (job) emitJobChanged(job.id);
      return job;
    },
    async completeTriggerJob(completeInput) {
      if (input.canonicalTriggerExecution) { const job = await input.canonicalTriggerExecution.complete(completeInput.jobId, completeInput.runId); emitJobChanged(job.id); return job; }
      const job = await input.runtimeStore.completeTriggerJob({
        jobId: completeInput.jobId,
        leaseId: completeInput.leaseId,
        now: clock.now().toISOString(),
        reason: completeInput.reason,
        runId: completeInput.runId,
      });
      emitJobChanged(job.id);
      return job;
    },
    async deadLetterTriggerJob(deadLetterInput) {
      if (input.canonicalTriggerExecution) { const job = await input.canonicalTriggerExecution.fail(deadLetterInput.jobId, deadLetterInput.error ?? "Moved to dead letter by operator.", false); emitJobChanged(job.id); return job; }
      const job = await input.runtimeStore.deadLetterTriggerJob({
        error: deadLetterInput.error ?? "Moved to dead letter by operator.",
        jobId: deadLetterInput.jobId,
        now: clock.now().toISOString(),
      });
      emitJobChanged(job.id);
      return job;
    },
    async enqueueScheduledTriggerOccurrence(scheduleInput) {
      const trigger = await requireTrigger(scheduleInput.triggerId);
      if (!trigger.enabled) throw new ControlPlaneError("TRIGGER_DISABLED", "Trigger is disabled.", 410);
      if (input.canonicalTriggerExecution) { const result = await input.canonicalTriggerExecution.enqueueSchedule(scheduleInput); emitJobChanged(result.job.id); return result; }
      const now = clock.now().toISOString();
      const payload = {
        input: {
          occurrence: scheduleInput.availableAt,
          triggerId: trigger.id,
          workflowId: trigger.workflowId,
        },
        source: "schedule",
      };
      const result = await input.runtimeStore.enqueueTriggerJob({
        availableAt: scheduleInput.availableAt,
        createdAt: now,
        id: ids.id("job"),
        idempotencyKey: scheduleInput.idempotencyKey,
        kind: "trigger",
        maxAttempts: 3,
        occurrenceId: scheduleInput.occurrenceId,
        payload,
        payloadHash: stableTriggerPayloadHash(payload),
        status: "queued",
        triggerId: trigger.id,
        updatedAt: now,
        workflowId: trigger.workflowId,
      });
      emitJobChanged(result.job.id);
      return result;
    },
    async enqueueTrigger(enqueueInput) {
      const trigger = await requireTrigger(enqueueInput.triggerId);
      if (!trigger.enabled) throw new ControlPlaneError("TRIGGER_DISABLED", "Trigger is disabled.", 410);
      if (!enqueueInput.trusted) await verifyTriggerAuth(trigger, enqueueInput.bearerToken);
      validateTriggerInput(trigger, enqueueInput.input);
      if (input.canonicalTriggerExecution) { const result = await input.canonicalTriggerExecution.enqueue(enqueueInput); emitJobChanged(result.job.id); return result; }
      const now = clock.now().toISOString();
      const payload = {
        ...(enqueueInput.http ? { http: enqueueInput.http } : {}),
        input: enqueueInput.input,
        ...(enqueueInput.source ? { source: enqueueInput.source } : {}),
      };
      const payloadHash = stableTriggerPayloadHash(payload);
      if (enqueueInput.idempotencyKey) {
        const existing = (await input.runtimeStore.listTriggerJobs({ triggerId: trigger.id }))
          .find((job) => job.idempotencyKey === enqueueInput.idempotencyKey);
        if (existing) {
          if (stableTriggerPayloadHash(existing.payload) !== payloadHash) {
            throw new ControlPlaneError(
              "IDEMPOTENCY_CONFLICT",
              "Idempotency-Key was already used with a different request body.",
              409,
            );
          }
          return {
            created: false,
            job: existing,
          };
        }
      }
      const result = await input.runtimeStore.enqueueTriggerJob({
        availableAt: now,
        createdAt: now,
        id: ids.id("job"),
        idempotencyKey: enqueueInput.idempotencyKey,
        maxAttempts: 3,
        occurrenceId: ids.id("occ"),
        payload,
        payloadHash,
        status: "queued",
        triggerId: trigger.id,
        updatedAt: now,
        workflowId: trigger.workflowId,
      });
      emitJobChanged(result.job.id);
      return result;
    },
    async failTriggerJob(failInput) {
      const current = await controlPlane.getTriggerJob(failInput.jobId);
      const retry = failInput.retry ?? current.attempts < current.maxAttempts;
      if (input.canonicalTriggerExecution) { const job = await input.canonicalTriggerExecution.fail(failInput.jobId, failInput.error, retry); emitJobChanged(job.id); return job; }
      const job = await input.runtimeStore.failTriggerJob({
        error: failInput.error,
        jobId: failInput.jobId,
        leaseId: failInput.leaseId,
        now: clock.now().toISOString(),
        retry,
        retryDelayMs: failInput.retryDelayMs ?? retryDelayMsForAttempt(current.attempts),
      });
      emitJobChanged(job.id);
      return job;
    },
    getRun: liveRuns.readRun,
    getSignal: signalPlane.getSignal,
    getSignalOccurrence: signalPlane.getSignalOccurrence,
    async getTrigger(id) {
      return requireTrigger(id);
    },
    async getTriggerJob(id) {
      if (input.canonicalTriggerExecution) return input.canonicalTriggerExecution.get(id);
      const job = await input.runtimeStore.getTriggerJob(id);
      if (!job) throw new ControlPlaneError("TRIGGER_JOB_NOT_FOUND", "Trigger job not found.", 404);
      return job;
    },
    async getWorkflow(id) {
      const workflow = input.app.listWorkflows().find((item) => item.id === id);
      if (!workflow) throw new ControlPlaneError("WORKFLOW_NOT_FOUND", "Workflow not found.", 404);
      return workflow;
    },
    ...(input.runtimeStore.heartbeatTriggerJob ? {
      async heartbeatTriggerJob(heartbeatInput) {
        const job = await input.runtimeStore.heartbeatTriggerJob!({
          jobId: heartbeatInput.jobId,
          leaseId: heartbeatInput.leaseId,
          leaseMs: heartbeatInput.leaseMs ?? DEFAULT_LEASE_MS,
          now: clock.now().toISOString(),
        });
        emitJobChanged(job.id);
        return job;
      },
    } : {}),
    async listRuns(filter) {
      const liveRuns = runtime.listRuns().map((run) => snapshotWorkflowAppRun(input.app, run));
      const liveRunIds = new Set(liveRuns.map((run) => run.runId));
      const storedRuns = await input.runtimeStore.listWorkflowRuns(filter);
      return [
        ...liveRuns.filter((run) => matchesRunFilter(run, filter)),
        ...storedRuns.filter((run) => !liveRunIds.has(run.runId)),
      ].sort((left, right) => lastRunTimestamp(right).localeCompare(lastRunTimestamp(left)));
    },
    listSignals: signalPlane.listSignals,
    async listTriggerJobs(filter) {
      if (input.canonicalTriggerExecution) return input.canonicalTriggerExecution.list(filter);
      return input.runtimeStore.listTriggerJobs(filter);
    },
    async listTriggers() {
      const document = await input.triggerStore.read();
      return document.triggers;
    },
    async listWorkflows() {
      return input.app.listWorkflows();
    },
    async pruneRuntime(pruneInput) {
      return input.runtimeStore.pruneRuntime(pruneInput);
    },
    publishSignalOccurrence: signalPlane.publishSignalOccurrence,
    resumeHook: liveRuns.resumeHook,
    resumeRun: liveRuns.resumeRun,
    async retryTriggerJob(retryInput) {
      if (input.canonicalTriggerExecution) { const job = await input.canonicalTriggerExecution.retry(retryInput.jobId); emitJobChanged(job.id); return job; }
      const now = clock.now().toISOString();
      const job = await input.runtimeStore.retryTriggerJob({
        availableAt: new Date(Date.parse(now) + (retryInput.retryDelayMs ?? 0)).toISOString(),
        jobId: retryInput.jobId,
        now,
      });
      emitJobChanged(job.id);
      return job;
    },
    async startRun(startInput) {
      const run = await runtime.startRun({
        ...startInput,
        origin: startInput.origin ?? { type: "manual" },
        onEvent(event) {
          startInput.onEvent?.(event);
          void input.runtimeStore.appendWorkflowRunEvents(event.runId, [event]);
        },
      });
      await liveRuns.persistRun(run);
      return snapshotWorkflowAppRun(input.app, run);
    },
    async startRunFromTriggerJob(jobId, leaseId) {
      const job = await controlPlane.getTriggerJob(jobId);
      if (!["claimed", "queued", "retrying", "running"].includes(job.status)) {
        throw new ControlPlaneError("TRIGGER_JOB_NOT_RUNNABLE", `Trigger job ${job.id} is ${job.status}.`, 409);
      }
      const run = await runtime.startRun({
        input: workflowInputFromJob(job),
        origin: {
          occurrenceId: job.occurrenceId,
          triggerId: job.triggerId,
          triggerJobId: job.id,
          type: triggerOriginType(await requireTrigger(job.triggerId)),
        },
        onEvent(event) {
          void input.runtimeStore.appendWorkflowRunEvents(event.runId, [event]);
        },
        workflowId: job.workflowId,
      });
      if (!input.canonicalTriggerExecution) await input.runtimeStore.markTriggerJobRunning({ jobId: job.id, leaseId, now: clock.now().toISOString(), runId: run.runId });
      emitJobChanged(job.id);
      await liveRuns.persistRun(run);
      if (isTerminalRunStatus(run.status)) {
        if (run.status === "completed") {
          await controlPlane.completeTriggerJob({ jobId: job.id, leaseId, runId: run.runId });
        } else {
          await controlPlane.failTriggerJob({
            error: `Workflow run ${run.runId} finished with status ${run.status}.`,
            jobId: job.id,
            leaseId,
          });
        }
      } else if (run.status === "waiting") {
        await controlPlane.completeTriggerJob({
          jobId: job.id,
          leaseId,
          reason: "Workflow entered durable waiting state.",
          runId: run.runId,
        });
      }
      return snapshotWorkflowAppRun(input.app, run);
    },
    async *watchRun(runId, options = {}) {
      const fromIndex = options.fromIndex ?? 0;
      const live = liveRuns.getLiveRun(runId);
      if (!live) {
        const stored = await controlPlane.getRun(runId);
        for (const event of stored.events.filter((event) => event.index >= fromIndex)) yield event;
        return;
      }
      const seen = new Set<number>();
      const queue: EventRecord[] = [];
      let notify: (() => void) | undefined;
      const unsubscribe = runtime.subscribe(runId, (event) => {
        if (event.index < fromIndex || seen.has(event.index)) return;
        queue.push(event);
        notify?.();
        notify = undefined;
      });
      try {
        for (const event of live.events.filter((event) => event.index >= fromIndex)) {
          seen.add(event.index);
          yield event;
        }
        while (!isTerminalRunStatus(runtime.getRun(runId).status)) {
          while (queue.length > 0) {
            const event = queue.shift()!;
            if (seen.has(event.index)) continue;
            seen.add(event.index);
            yield event;
          }
          if (isTerminalRunStatus(runtime.getRun(runId).status)) return;
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
        }
      } finally {
        unsubscribe();
      }
    },
    async *watchTriggerJob(jobId, options = {}) {
      let index = options.fromIndex ?? 0;
      let previous = JSON.stringify(await controlPlane.getTriggerJob(jobId));
      yield {
        index: index++,
        job: JSON.parse(previous) as TriggerJobSnapshot,
        timestamp: clock.now().toISOString(),
        type: "trigger.job.changed",
      } satisfies TriggerJobEvent;
      while (!isTerminalJobStatus((JSON.parse(previous) as TriggerJobSnapshot).status)) {
        await waitForJobChange(jobId, options);
        const job = await controlPlane.getTriggerJob(jobId);
        const serialized = JSON.stringify(job);
        if (serialized === previous) continue;
        previous = serialized;
        yield {
          index: index++,
          job,
          timestamp: clock.now().toISOString(),
          type: "trigger.job.changed",
        };
      }
    },
  };
  return controlPlane;

  async function requireTrigger(id: string): Promise<TriggerDescriptor> {
    const trigger = (await input.triggerStore.read()).triggers.find((item) => item.id === id);
    if (!trigger) throw new ControlPlaneError("TRIGGER_NOT_FOUND", "Trigger not found.", 404);
    if (!input.app.workflowIds().includes(trigger.workflowId)) {
      throw new ControlPlaneError("WORKFLOW_NOT_FOUND", `Trigger workflow ${trigger.workflowId} was not found.`, 404);
    }
    return trigger;
  }


  async function verifyTriggerAuth(trigger: TriggerDescriptor, token: string | undefined): Promise<void> {
    if (trigger.auth?.mode === "none") return;
    if (!input.auth) return;
    if (!token) throw new ControlPlaneError("UNAUTHORIZED", "Missing bearer token.", 401);
    const allowed = await input.auth.verifyBearer({
      capability: `trigger.invoke:${trigger.id}`,
      token,
      trigger,
    });
    if (!allowed) throw new ControlPlaneError("FORBIDDEN", "Bearer token is not allowed for this trigger.", 403);
  }

  async function authorize(authInput: AuthorizeWorkflowControlPlaneInput): Promise<void> {
    const trigger = authInput.triggerId ? await requireTrigger(authInput.triggerId) : undefined;
    if (trigger?.auth?.mode === "none" && authInput.capability.startsWith("trigger.read:")) return;
    if (!input.auth) return;
    if (!authInput.bearerToken) throw new ControlPlaneError("UNAUTHORIZED", "Missing bearer token.", 401);
    const allowed = await input.auth.verifyBearer({
      capability: authInput.capability,
      token: authInput.bearerToken,
      trigger,
    });
    if (!allowed) throw new ControlPlaneError("FORBIDDEN", "Bearer token is not allowed for this operation.", 403);
  }

  function emitJobChanged(jobId: string): void {
    for (const listener of jobListeners.get(jobId) ?? []) listener();
  }

  function waitForJobChange(jobId: string, options: WatchOptions): Promise<void> {
    return new Promise((resolve) => {
      const listeners = jobListeners.get(jobId) ?? new Set<() => void>();
      jobListeners.set(jobId, listeners);
      const timeout = setTimeout(done, options.intervalMs ?? 1_000);
      listeners.add(done);
      function done() {
        clearTimeout(timeout);
        listeners.delete(done);
        resolve();
      }
    });
  }
}


export class ControlPlaneError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ControlPlaneError";
    this.code = code;
    this.status = status;
  }
}

export function createStaticBearerAuth(input: {
  tokens: Record<string, string[]>;
}): AuthTokenVerifier {
  return {
    verifyBearer({ capability, token }) {
      const capabilities = input.tokens[token] ?? [];
      return capabilities.includes("*") || capabilities.includes(capability);
    },
  };
}

const systemClock: Clock = {
  now() {
    return new Date();
  },
};

const randomIdGenerator: IdGenerator = {
  id(prefix) {
    return `${prefix}_${randomUUID().replaceAll("-", "")}`;
  },
};

const jsonSchemaValidator = new Ajv({
  allErrors: true,
  strict: false,
});

function validateTriggerInput(trigger: TriggerDescriptor, value: unknown): void {
  const schema = trigger.input?.jsonSchema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
  const validate = jsonSchemaValidator.compile(schema);
  if (validate(value)) return;
  const message = jsonSchemaValidator.errorsText(validate.errors, { separator: "; " });
  throw new ControlPlaneError("INPUT_VALIDATION_FAILED", message, 422);
}
