import { Cause, Effect, Exit } from "effect";

export class RuntimeLifecycleError extends Error {
  constructor(
    readonly operation: string,
    readonly error: unknown,
  ) {
    super(`Runtime lifecycle operation failed: ${operation}`);
    this.name = "RuntimeLifecycleError";
  }
}

export async function runRuntimeEffect<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  const failure = Cause.failureOption(exit.cause);
  if (failure._tag === "Some") {
    throw unwrapRuntimeFailure(failure.value);
  }
  throw new Error(Cause.pretty(exit.cause));
}

export function runtimeOperationEffect<A>(
  operation: string,
  run: () => Promise<A> | A,
): Effect.Effect<A, RuntimeLifecycleError> {
  return Effect.tryPromise({
    try: async () => run(),
    catch: (error) => new RuntimeLifecycleError(operation, error),
  });
}

function unwrapRuntimeFailure(error: unknown): unknown {
  return error instanceof RuntimeLifecycleError ? error.error : error;
}
