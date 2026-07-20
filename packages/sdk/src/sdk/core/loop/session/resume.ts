import { Cause, Effect, Exit } from "effect";
import type {
  HookDefinition,
  SleepOptions,
  StepDefinition,
  StepResult,
  StepRuntimeMetadata,
} from "../loop.types.js";
import type { LoopSession } from "../session.js";
import { sleep } from "../sleep.js";
import { runStepOperation } from "../operation.js";
import {
  runLoopEffect,
  StepExecutionError,
  unwrapLoopFailure,
} from "./effects.js";
import {
  HookWaitSignal,
  isTerminalStatus,
  mergeOutput,
} from "./utils.js";

export async function resumeSession<TUse, TInput>(
  session: LoopSession<TUse, TInput>,
) {
  if (isTerminalStatus(session.status)) {
    return session.snapshot();
  }
  let resumedWaitingStepId =
    session.status === "waiting" || session.status === "paused"
      ? session.pendingHooks[0]?.stepId
      : undefined;
  if (!session.hasStarted) {
    session.hasStarted = true;
    session.emit({
      message: `Run ${session.runId} started.`,
      type: "run.started",
    });
  } else if (session.status === "paused") {
    session.emit({
      message: `Run ${session.runId} resumed.`,
      type: "run.resumed",
    });
  }
  session.status = "running";
  session.pendingHooks = [];
  session.pendingQuestions = [];
  while (session.currentStepIndex < session.config.steps.length) {
    const current = session.config.steps[session.currentStepIndex];
    const attempt =
      resumedWaitingStepId === current.id
        ? session.stepRunCounts.get(current.id) ?? 1
        : (session.stepRunCounts.get(current.id) ?? 0) + 1;
    session.stepRunCounts.set(current.id, attempt);
    const stepMetadata = session.stepMetadata(current.id, attempt);
    if (!session.createdStepIds.has(current.id)) {
      session.createdStepIds.add(current.id);
      session.emit({
        message: `Created ${current.id}.`,
        stepId: current.id,
        type: "step.created",
      }, stepMetadata);
    }
    session.emit({
      message: `Starting ${current.id}.`,
      stepId: current.id,
      type: "step.started",
    }, stepMetadata);
    const stepStartedAt = performance.now();
    session.createCheckpoint(current.id, session.currentStepIndex, stepMetadata);
    const attemptExit = await Effect.runPromiseExit(
      stepAttemptEffect(session, current, stepMetadata),
    );
    let result: StepResult;
    if (Exit.isSuccess(attemptExit)) {
      result = attemptExit.value;
      if (resumedWaitingStepId === current.id) resumedWaitingStepId = undefined;
    } else {
      const waitSignal = stepAttemptWaitSignal(attemptExit.cause);
      if (!waitSignal) {
        throw stepAttemptError(attemptExit.cause);
      }
      session.pendingHooks = [waitSignal.request];
      session.status = "waiting";
      session.emit({
        detail: { hook: waitSignal.request },
        message: `Created hook ${waitSignal.request.id}.`,
        stepId: current.id,
        type: "hook.created",
      }, stepMetadata);
      session.emit({
        detail: { hook: waitSignal.request },
        durationMs: elapsedMs(stepStartedAt),
        message: `Waiting for hook ${waitSignal.request.id}.`,
        stepId: current.id,
        type: "step.waiting",
      }, stepMetadata);
      session.emit({
        detail: { hook: waitSignal.request },
        message: `Waiting for hook ${waitSignal.request.id}.`,
        stepId: current.id,
        type: "hook.waiting",
      }, stepMetadata);
      return session.snapshot();
    }
    if (result.state) {
      Object.assign(session.state, result.state);
    }
    if (result.type === "ask") {
      session.pendingQuestions = result.questions;
      session.pendingHooks = result.questions.map((question) =>
        session.questionHookRequest(question, stepMetadata)
      );
      session.status = "waiting";
      for (const hookRequest of session.pendingHooks) {
        session.emit({
          detail: { hook: hookRequest },
          message: `Created hook ${hookRequest.id}.`,
          stepId: current.id,
          type: "hook.created",
        }, stepMetadata);
      }
      session.emit({
        detail: {
          hooks: session.pendingHooks,
          questions: result.questions,
          ...(result.state ? { state: result.state } : {}),
        },
        durationMs: elapsedMs(stepStartedAt),
        message: `Waiting for ${result.questions.length} answer${result.questions.length === 1 ? "" : "s"}.`,
        stepId: current.id,
        type: "step.waiting",
      }, stepMetadata);
      for (const hookRequest of session.pendingHooks) {
        session.emit({
          detail: { hook: hookRequest },
          message: `Waiting for hook ${hookRequest.id}.`,
          stepId: current.id,
          type: "hook.waiting",
        }, stepMetadata);
      }
      session.emit({
        detail: { questions: result.questions },
        message: `Waiting for ${result.questions.length} answer${result.questions.length === 1 ? "" : "s"}.`,
        stepId: current.id,
        type: "question.requested",
      }, stepMetadata);
      return session.snapshot();
    }
    if (result.type === "wait") {
      session.pendingQuestions = result.questions ?? [];
      session.pendingHooks = [
        ...result.hooks,
        ...session.pendingQuestions.map((question) =>
          session.questionHookRequest(question, stepMetadata)
        ),
      ];
      for (const hookRequest of result.hooks) {
        session.hookRequests.set(hookRequest.token, hookRequest);
      }
      session.status = "waiting";
      for (const hookRequest of session.pendingHooks) {
        session.emit({
          detail: { hook: hookRequest },
          message: `Created hook ${hookRequest.id}.`,
          stepId: current.id,
          type: "hook.created",
        }, stepMetadata);
      }
      session.emit({
        detail: {
          hooks: session.pendingHooks,
          ...(session.pendingQuestions.length > 0 ? { questions: session.pendingQuestions } : {}),
          ...(result.state ? { state: result.state } : {}),
        },
        durationMs: elapsedMs(stepStartedAt),
        message: `Waiting for ${session.pendingHooks.length} hook${session.pendingHooks.length === 1 ? "" : "s"}.`,
        stepId: current.id,
        type: "step.waiting",
      }, stepMetadata);
      for (const hookRequest of session.pendingHooks) {
        session.emit({
          detail: { hook: hookRequest },
          message: `Waiting for hook ${hookRequest.id}.`,
          stepId: current.id,
          type: "hook.waiting",
        }, stepMetadata);
      }
      if (session.pendingQuestions.length > 0) {
        session.emit({
          detail: { questions: session.pendingQuestions },
          message: `Waiting for ${session.pendingQuestions.length} answer${session.pendingQuestions.length === 1 ? "" : "s"}.`,
          stepId: current.id,
          type: "question.requested",
        }, stepMetadata);
      }
      return session.snapshot();
    }
    if (result.type === "fail") {
      session.status = "failed";
      session.emit({
        detail: { error: result.error },
        durationMs: elapsedMs(stepStartedAt),
        message: result.error,
        stepId: current.id,
        type: "step.failed",
      }, stepMetadata);
      session.emit({
        detail: { error: result.error },
        message: `Run ${session.runId} failed.`,
        type: "run.failed",
      });
      return session.snapshot();
    }
    if (result.type === "retry") {
      const retries = session.retryCounts.get(current.id) ?? 0;
      const maxRetries = current.maxRetries ?? 1;
      session.retryCounts.set(current.id, retries + 1);
      session.emit({
        detail: { maxRetries, reason: result.reason, retries: retries + 1 },
        durationMs: elapsedMs(stepStartedAt),
        message: `Retry requested: ${result.reason}`,
        stepId: current.id,
        type: "step.retrying",
      }, stepMetadata);
      if (retries >= maxRetries) {
        session.status = "failed";
        session.emit({
          detail: { maxRetries, reason: result.reason, retries: retries + 1 },
          durationMs: elapsedMs(stepStartedAt),
          message: `Retry limit reached for ${current.id}.`,
          stepId: current.id,
          type: "step.failed",
        }, stepMetadata);
        session.emit({
          detail: { reason: result.reason },
          message: `Run ${session.runId} failed.`,
          type: "run.failed",
        });
        return session.snapshot();
      }
      continue;
    }
    if (result.type === "goto") {
      const targetStepIndex = session.config.steps.findIndex((item) =>
        item.id === result.stepId
      );
      if (targetStepIndex === -1) {
        session.status = "failed";
        session.emit({
          detail: {
            fromStepId: current.id,
            reason: result.reason,
            targetStepId: result.stepId,
          },
          message: `Unknown step target: ${result.stepId}`,
          stepId: current.id,
          type: "step.failed",
        }, stepMetadata);
        session.emit({
          detail: { reason: `Unknown step target: ${result.stepId}` },
          message: `Run ${session.runId} failed.`,
          type: "run.failed",
        });
        return session.snapshot();
      }
      session.emit({
        detail: {
          fromStepId: current.id,
          reason: result.reason,
          targetStepId: result.stepId,
        },
        durationMs: elapsedMs(stepStartedAt),
        message: result.reason
          ? `Continuing at ${result.stepId}: ${result.reason}`
          : `Continuing at ${result.stepId}.`,
        stepId: current.id,
        type: "step.goto",
      }, stepMetadata);
      session.currentStepIndex = targetStepIndex;
      continue;
    }
    mergeOutput(session.state, current.id, result.output);
    session.emit({
      detail: result.output,
      durationMs: elapsedMs(stepStartedAt),
      message: `Completed ${current.id}.`,
      stepId: current.id,
      type: "step.completed",
    }, stepMetadata);
    session.currentStepIndex += 1;
  }
  session.status = "completed";
  session.emit({
    message: `Run ${session.runId} completed.`,
    type: "run.completed",
  });
  return session.snapshot();
}

function elapsedMs(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function stepAttemptEffect<TUse, TInput>(
  session: LoopSession<TUse, TInput>,
  step: StepDefinition<TUse, TInput>,
  stepMetadata: StepRuntimeMetadata,
): Effect.Effect<StepResult, HookWaitSignal | StepExecutionError> {
  let hookOrdinal = 0;
  return Effect.tryPromise({
    try: async () =>
      step.run({
        answers: session.answers,
        emit: (event) => session.emit(event, stepMetadata),
        hookAnswers: session.hookAnswers,
        input: session.input,
        operation: (operationInput, run) => runStepOperation({
          emit: (event) => session.emit(event, stepMetadata),
          operation: operationInput,
          run,
          step: stepMetadata,
        }),
        sleep: (sleepInput: SleepOptions) =>
          runLoopEffect(waitForHookEffect(
            session,
            sleep(sleepInput),
            sleepInput,
            stepMetadata,
            hookOrdinal++,
          )),
        state: session.state,
        step: stepMetadata,
        use: session.config.use as TUse,
        waitFor: <THookInput, THookOutput>(
          hookDefinition: HookDefinition<THookInput, THookOutput>,
          hookInput: THookInput,
        ) =>
          runLoopEffect(waitForHookEffect(
            session,
            hookDefinition,
            hookInput,
            stepMetadata,
            hookOrdinal++,
          )),
      }),
    catch: (error) =>
      error instanceof HookWaitSignal
        ? error
        : new StepExecutionError(step.id, stepMetadata.attempt, error),
  });
}

function waitForHookEffect<TUse, TInput, THookInput, THookOutput>(
  session: LoopSession<TUse, TInput>,
  hookDefinition: HookDefinition<THookInput, THookOutput>,
  hookInput: THookInput,
  stepMetadata: StepRuntimeMetadata,
  hookOrdinal: number,
): Effect.Effect<THookOutput, HookWaitSignal> {
  return Effect.sync(() =>
    session.createHookRequest(
      hookDefinition,
      hookInput,
      stepMetadata,
      hookOrdinal,
    )
  ).pipe(
    Effect.flatMap((hookRequest) =>
      hookRequest.token in session.hookAnswers
        ? Effect.succeed(session.hookAnswers[hookRequest.token] as THookOutput)
        : Effect.fail(new HookWaitSignal(hookRequest))
    ),
  );
}

function stepAttemptWaitSignal(
  cause: Cause.Cause<HookWaitSignal | StepExecutionError>,
): HookWaitSignal | undefined {
  const failure = Cause.failureOption(cause);
  return failure._tag === "Some" && failure.value instanceof HookWaitSignal
    ? failure.value
    : undefined;
}

function stepAttemptError(
  cause: Cause.Cause<HookWaitSignal | StepExecutionError>,
): unknown {
  const failure = Cause.failureOption(cause);
  if (failure._tag === "Some") {
    return unwrapLoopFailure(failure.value);
  }
  return new Error(Cause.pretty(cause));
}
