import { Cause, Effect, Exit } from "effect";

export class StepExecutionError extends Error {
  constructor(
    readonly stepId: string,
    readonly attempt: number,
    readonly error: unknown,
  ) {
    super(`Step ${stepId} attempt ${attempt} failed.`);
    this.name = "StepExecutionError";
  }
}

export class SessionOperationError extends Error {
  constructor(
    readonly operation: string,
    readonly error: unknown,
  ) {
    super(`Loop session operation failed: ${operation}`);
    this.name = "SessionOperationError";
  }
}

export class SessionPersistenceError extends Error {
  constructor(
    readonly operation: string,
    readonly error: unknown,
  ) {
    super(`Loop session persistence failed: ${operation}`);
    this.name = "SessionPersistenceError";
  }
}

export async function runLoopEffect<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  const failure = Cause.failureOption(exit.cause);
  if (failure._tag === "Some") {
    throw unwrapLoopFailure(failure.value);
  }
  throw new Error(Cause.pretty(exit.cause));
}

export function sessionOperationEffect<A>(
  operation: string,
  run: () => Promise<A> | A,
): Effect.Effect<A, SessionOperationError> {
  return Effect.tryPromise({
    try: async () => run(),
    catch: (error) => new SessionOperationError(operation, error),
  });
}

export function persistenceEffect(
  operation: string,
  run: () => Promise<unknown> | unknown,
): Effect.Effect<void, SessionPersistenceError> {
  return Effect.tryPromise({
    try: async () => {
      await run();
    },
    catch: (error) => new SessionPersistenceError(operation, error),
  });
}

export function unwrapLoopFailure(error: unknown): unknown {
  if (
    error instanceof StepExecutionError ||
    error instanceof SessionOperationError ||
    error instanceof SessionPersistenceError
  ) {
    return error.error;
  }
  return error;
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
