import type { DromioTurnV1 } from "@dromio/protocols";
import { ThreadServiceError } from "./errors.js";
import type { ThreadCommandContext } from "./types.js";

export function assertExecutionFence(
  turn: DromioTurnV1,
  context: ThreadCommandContext,
  now: string,
  mode: "claim" | "current",
): void {
  const execution = context.execution;
  if (!execution) return;
  if (Date.parse(execution.leaseExpiresAt) <= Date.parse(now)) stale("The execution lease expired.");
  if (turn.executionRunId && turn.executionRunId !== execution.runId) stale("The execution run does not own this turn.");
  const currentToken = turn.executionFencingToken;
  if (currentToken !== undefined && execution.fencingToken < currentToken) stale("A newer execution attempt owns this turn.");
  if (mode === "current") {
    if (
      currentToken !== execution.fencingToken ||
      turn.executionAttemptId !== execution.attemptId
    ) {
      stale("The execution attempt has not claimed this turn.");
    }
  }
}

function stale(message: string): never {
  throw new ThreadServiceError({ code: "stale_execution_attempt", message });
}
