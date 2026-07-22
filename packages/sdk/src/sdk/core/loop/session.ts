import { Effect } from "effect";
import type {
  EventPayload,
  EventRecord,
  LoopCheckpoint,
  LoopConfig,
  LoopHydrationSnapshot,
  LoopRerunOptions,
  LoopSessionRecord,
  LoopStartOptions,
  LoopStatus,
  HookDefinition,
  HookRequest,
  HookResume,
  StepRuntimeMetadata,
  StepState,
} from "./loop.types.js";
import type {
  Question,
  QuestionResolutionHistoryItem,
} from "../questions/index.js";
import { resumeSession } from "./session/resume.js";
import { assertHookOutput } from "./hook-validation.js";
import {
  persistenceEffect,
  runLoopEffect,
  sessionOperationEffect,
  type SessionPersistenceError,
  toError,
} from "./session/effects.js";
import {
  defaultTraceContext,
  questionShapeToken,
  resolutionDetail,
} from "./session/trace.js";
import {
  cloneSnapshot,
  createRunId,
  hookToken,
  isTerminalStatus,
} from "./session/utils.js";

type LoopSessionSeed = {
  initialState?: StepState;
  parentCheckpointId?: string;
  parentRunId?: string;
  startStepIndex?: number;
};

export class LoopSession<TUse = unknown, TInput = unknown> {
  readonly answers: Record<string, unknown> = {};
  readonly checkpoints: Array<LoopCheckpoint<TInput>> = [];
  readonly events: EventRecord[] = [];
  readonly hookAnswers: Record<string, unknown> = {};
  readonly questionResolutionHistory: Record<string, QuestionResolutionHistoryItem[]> = {};
  readonly parentCheckpointId?: string;
  readonly parentRunId?: string;
  readonly runId: string;
  readonly state: StepState = {};
  pendingHooks: HookRequest[] = [];
  pendingQuestions: Question[] = [];
  status: LoopStatus = "idle";
  createdStepIds = new Set<string>();
  currentStepIndex = 0;
  hasStarted = false;
  hookRequests = new Map<string, HookRequest>();
  nextEventIndex = 0;
  retryCounts = new Map<string, number>();
  stepRunCounts = new Map<string, number>();
  consumedHookTokens = new Set<string>();
  private persistenceFailure?: Error;
  private persistenceTail: Promise<void> = Promise.resolve();

  constructor(
    readonly config: LoopConfig<TUse, TInput>,
    readonly input: TInput,
    readonly options: LoopStartOptions = {},
    seed: LoopSessionSeed = {},
  ) {
    Object.assign(this.answers, options.answers ?? {});
    Object.assign(this.state, seed.initialState ?? {});
    this.currentStepIndex = seed.startStepIndex ?? 0;
    this.parentCheckpointId = seed.parentCheckpointId;
    this.parentRunId = seed.parentRunId;
    this.runId = options.runId ?? createRunId();
  }

  async answer(input: { questionId: string; value: unknown }) {
    return runLoopEffect(sessionOperationEffect("answer", async () => {
      try {
        const question = this.pendingQuestions.find((item) => item.id === input.questionId);
        const legacyQuestionHook = this.pendingHooks.find((hook) =>
          hook.kind === "question" && hook.id === input.questionId
        );
        if (!question && !legacyQuestionHook) {
          throw new Error(`Unknown pending question: ${input.questionId}`);
        }
        const resolution = await this.resolveQuestionAnswer(question, input.value);
        if (resolution && resolution.status !== "accepted") {
          this.emit({
            detail: resolutionDetail(input.questionId, question?.resolverId, resolution),
            message: resolution.message ?? `Rejected answer for ${input.questionId}.`,
            type: "question.resolution.rejected",
          });
          return;
        }
        const value = resolution?.normalizedValue ?? input.value;
        this.answers[input.questionId] = value;
        this.emit({
          detail: { ...input, value },
          message: `Answered ${input.questionId}.`,
          type: "question.answered",
        });
        if (resolution) {
          this.emit({
            detail: resolutionDetail(input.questionId, question?.resolverId, resolution),
            message: resolution.message ?? `Accepted answer for ${input.questionId}.`,
            type: "question.resolution.accepted",
          });
        }
        const hookRequest = this.pendingHooks.find((hook) =>
          hook.kind === "question" && hook.id === input.questionId
        );
        if (hookRequest && !this.consumedHookTokens.has(hookRequest.token)) {
          this.hookAnswers[hookRequest.token] = value;
          this.consumedHookTokens.add(hookRequest.token);
          this.emit({
            detail: {
              hook: hookRequest,
              value,
            },
            message: `Resumed hook ${hookRequest.id}.`,
            type: "hook.resumed",
          });
        }
      } finally {
        await this.flushPersistence();
      }
    }));
  }

  private async resolveQuestionAnswer(question: Question | undefined, utterance: unknown) {
    if (!question?.resolverId) return undefined;
    const resolver = this.options.questionResolvers?.[question.resolverId] ?? this.config.questionResolvers?.[question.resolverId];
    if (!resolver) return undefined;
    this.emit({
      detail: {
        questionId: question.id,
        resolverId: question.resolverId,
      },
      message: `Resolving answer for ${question.id}.`,
      type: "question.resolution.started",
    });
    const result = await resolver({
      answers: { ...this.answers },
      history: cloneSnapshot(this.questionResolutionHistory[question.id] ?? []),
      onEvent: async (event) => {
        this.emit(event);
      },
      question,
      state: { ...this.state },
      trace: {
        parentSpanId: `run:${this.runId}`,
        spanId: `question-resolver:${question.id}`,
        traceId: this.runId,
      },
      utterance,
    });
    this.emit({
      detail: resolutionDetail(question.id, question.resolverId, result),
      message: result.message ?? `Resolved answer for ${question.id}.`,
      type: "question.resolution.completed",
    });
    this.questionResolutionHistory[question.id] = [
      ...(this.questionResolutionHistory[question.id] ?? []),
      {
        resolution: cloneSnapshot(result),
        utterance: cloneSnapshot(utterance),
      },
    ];
    return result;
  }

  async resumeHook<TOutput = unknown>(input: HookResume<TOutput>) {
    return runLoopEffect(sessionOperationEffect("resumeHook", async () => {
      try {
        const hookRequest = this.hookRequests.get(input.token);
        if (this.consumedHookTokens.has(input.token)) {
          throw new Error(`Hook token has already been consumed: ${input.token}`);
        }
        if (!hookRequest) {
          throw new Error(`Unknown hook token: ${input.token}`);
        }
        assertHookOutput(hookRequest, input.value);
        if (hookRequest.kind === "question") {
          await this.answer({
            questionId: hookRequest.id,
            value: input.value,
          });
          return this.resume();
        }
        this.hookAnswers[input.token] = input.value;
        this.consumedHookTokens.add(input.token);
        this.emit({
          detail: {
            hook: hookRequest,
            value: input.value,
          },
          message: `Resumed hook ${hookRequest.id}.`,
          type: "hook.resumed",
        });
        return this.resume();
      } finally {
        await this.flushPersistence();
      }
    }));
  }

  async pause(input: { reason?: string } = {}) {
    return runLoopEffect(sessionOperationEffect("pause", async () => {
      try {
        if (isTerminalStatus(this.status)) {
          return this.snapshot();
        }
        this.status = "paused";
        this.emit({
          detail: input,
          message: input.reason ? `Run ${this.runId} paused: ${input.reason}` : `Run ${this.runId} paused.`,
          type: "run.paused",
        });
        return this.snapshot();
      } finally {
        await this.flushPersistence();
      }
    }));
  }

  async cancel(input: { reason?: string } = {}) {
    return runLoopEffect(sessionOperationEffect("cancel", async () => {
      try {
        if (isTerminalStatus(this.status)) {
          return this.snapshot();
        }
        const pendingHooks = [...this.pendingHooks];
        this.status = "cancelled";
        for (const hookRequest of pendingHooks) {
          this.consumedHookTokens.add(hookRequest.token);
          this.emit({
            detail: {
              hook: hookRequest,
              reason: input.reason,
            },
            message: input.reason
              ? `Cancelled hook ${hookRequest.id}: ${input.reason}`
              : `Cancelled hook ${hookRequest.id}.`,
            stepId: hookRequest.stepId,
            type: "hook.cancelled",
          });
        }
        this.pendingHooks = [];
        this.pendingQuestions = [];
        this.emit({
          detail: input,
          message: input.reason ? `Run ${this.runId} cancelled: ${input.reason}` : `Run ${this.runId} cancelled.`,
          type: "run.cancelled",
        });
        return this.snapshot();
      } finally {
        await this.flushPersistence();
      }
    }));
  }

  async rerunFromCheckpoint(
    input: LoopRerunOptions<TInput>,
  ): Promise<LoopSession<TUse, TInput>> {
    return runLoopEffect(sessionOperationEffect("rerunFromCheckpoint", async () => {
      try {
        const checkpoint = this.checkpoints.find((item) =>
          item.checkpointId === input.checkpointId
        );
        if (!checkpoint) {
          throw new Error(`Unknown checkpoint: ${input.checkpointId}`);
        }
        const child = new LoopSession(
          this.config,
          input.input ?? cloneSnapshot(checkpoint.input),
          {
            answers: input.answers,
            onEvent: input.onEvent,
            runId: input.runId,
            store: input.store ?? this.options.store,
          },
          {
            initialState: input.state ?? cloneSnapshot(checkpoint.state),
            parentCheckpointId: checkpoint.checkpointId,
            parentRunId: this.runId,
            startStepIndex: checkpoint.stepIndex,
          },
        );
        this.emit({
          detail: {
            childRunId: child.runId,
            checkpoint,
          },
          message: `Created rerun ${child.runId} from checkpoint ${checkpoint.checkpointId}.`,
          type: "run.rerun.created",
        });
        this.recordAction("rerunFromCheckpoint", {
          checkpointId: checkpoint.checkpointId,
          childRunId: child.runId,
        });
        await child.resume();
        return child;
      } finally {
        await this.flushPersistence();
      }
    }));
  }

  async resume() {
    return runLoopEffect(sessionOperationEffect("resume", async () => {
      try {
        return await resumeSession(this);
      } finally {
        await this.flushPersistence();
      }
    }));
  }

  snapshot(): LoopHydrationSnapshot<TInput> {
    return {
      answers: this.answers,
      checkpoints: this.checkpoints,
      durable: {
        consumedHookTokens: [...this.consumedHookTokens],
        createdStepIds: [...this.createdStepIds],
        currentStepIndex: this.currentStepIndex,
        hasStarted: this.hasStarted,
        hookAnswers: this.hookAnswers,
        nextEventIndex: this.nextEventIndex,
        questionResolutionHistory: this.questionResolutionHistory,
        retryCounts: Object.fromEntries(this.retryCounts),
        stepRunCounts: Object.fromEntries(this.stepRunCounts),
        version: 1,
      },
      events: this.events,
      input: this.input,
      parentCheckpointId: this.parentCheckpointId,
      parentRunId: this.parentRunId,
      pendingHooks: this.pendingHooks,
      pendingQuestions: this.pendingQuestions,
      runId: this.runId,
      state: this.state,
      status: this.status,
    };
  }

  recordAction(name: string, input?: unknown) {
    const action = {
      actionId: `action_${crypto.randomUUID()}`,
      input: cloneSnapshot(input),
      name,
      runId: this.runId,
      timestamp: new Date().toISOString(),
    };
    this.enqueuePersistence(persistenceEffect(
      "appendAction",
      () => this.options.store?.appendAction?.(action),
    ));
    return action;
  }

  createCheckpoint(
    stepId: string,
    stepIndex: number,
    step: StepRuntimeMetadata,
  ) {
    const checkpoint = {
      attempt: step.attempt,
      checkpointId: `checkpoint_${crypto.randomUUID()}`,
      eventIndex: this.nextEventIndex,
      input: cloneSnapshot(this.input),
      runId: this.runId,
      state: cloneSnapshot(this.state),
      stepId,
      stepIndex,
      timestamp: new Date().toISOString(),
    };
    this.checkpoints.push(checkpoint);
    this.enqueuePersistence(persistenceEffect(
      "appendCheckpoint",
      () => this.options.store?.appendCheckpoint?.(checkpoint),
    ));
    this.emit({
      detail: { checkpoint },
      message: `Checkpointed ${stepId}.`,
      stepId,
      type: "checkpoint.created",
    }, step);
    return checkpoint;
  }

  emit(event: EventPayload, step?: StepRuntimeMetadata) {
    const index = this.nextEventIndex;
    const eventRecord = {
      ...event,
      attempt: step?.attempt ?? event.attempt,
      correlationId: step?.correlationId ?? `run:${this.runId}:event:${index}`,
      index,
      runId: this.runId,
      timestamp: new Date().toISOString(),
      trace: event.trace ?? defaultTraceContext({
        event,
        runId: this.runId,
        step,
        workflowId: this.config.id,
      }),
    };
    this.nextEventIndex += 1;
    this.events.push(eventRecord);
    const sessionRecord = this.sessionRecord();
    this.enqueuePersistence(
      persistenceEffect("appendEvent", () => this.options.store?.appendEvent?.(eventRecord))
        .pipe(Effect.flatMap(() =>
          persistenceEffect("saveSession", () => this.options.store?.saveSession?.(sessionRecord))
        )),
    );
    void this.options.onEvent?.(eventRecord);
  }

  private enqueuePersistence(effect: Effect.Effect<void, SessionPersistenceError>) {
    this.persistenceTail = this.persistenceTail
      .then(async () => {
        if (this.persistenceFailure) {
          throw this.persistenceFailure;
        }
        await runLoopEffect(effect);
      })
      .catch((error) => {
        this.persistenceFailure ??= toError(error);
      });
  }

  private async flushPersistence() {
    await this.persistenceTail;
    if (this.persistenceFailure) {
      throw this.persistenceFailure;
    }
  }

  sessionRecord(): LoopSessionRecord<TInput> {
    return {
      input: cloneSnapshot(this.input),
      parentCheckpointId: this.parentCheckpointId,
      parentRunId: this.parentRunId,
      runId: this.runId,
      status: this.status,
    };
  }

  stepMetadata(stepId: string, attempt: number): StepRuntimeMetadata {
    const correlationId = `run:${this.runId}:step:${stepId}:attempt:${attempt}`;
    return {
      attempt,
      correlationId,
      id: stepId,
      idempotencyKey: `${this.runId}:${stepId}:${attempt}`,
      runId: this.runId,
      workflowId: this.config.id,
    };
  }

  createHookRequest<TInput, TOutput>(
    hookDefinition: HookDefinition<TInput, TOutput>,
    input: TInput,
    step: StepRuntimeMetadata,
    ordinal: number,
  ): HookRequest<TInput> {
    const request = {
      correlationId: step.correlationId,
      ...(hookDefinition.expiresAt ? { expiresAt: hookDefinition.expiresAt } : {}),
      id: hookDefinition.id,
      input,
      ...(hookDefinition.kind ? { kind: hookDefinition.kind } : {}),
      ...(hookDefinition.render ? { render: hookDefinition.render } : {}),
      ...(hookDefinition.schema ? { schema: hookDefinition.schema } : {}),
      stepId: step.id,
      ...(hookDefinition.title ? { title: hookDefinition.title } : {}),
      token: hookToken(this.runId, step.id, step.attempt, hookDefinition.id, ordinal),
    };
    this.hookRequests.set(request.token, request);
    return request;
  }

  questionHookRequest(
    question: Question,
    step: StepRuntimeMetadata,
  ): HookRequest<Question> {
    const request = {
      correlationId: step.correlationId,
      id: question.id,
      input: question,
      kind: "question",
      schema: question.answerSchema,
      stepId: step.id,
      ...(question.title ? { title: question.title } : {}),
      token: `question:${this.runId}:${step.id}:${step.attempt}:${question.id}:${questionShapeToken(question)}`,
    };
    this.hookRequests.set(request.token, request);
    return request;
  }
}
