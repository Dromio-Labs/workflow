import type {
  EventRecord,
  HookRequest,
  LoopCheckpoint,
  LoopConfig,
  LoopHydrateOptions,
  LoopHydrationSnapshot,
  LoopSessionDurableSnapshot,
  LoopStatus,
  StepState,
} from "../loop.types.js";
import { LoopSession } from "../session.js";
import { cloneSnapshot, isTerminalStatus } from "./utils.js";

export class UnresumableRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnresumableRunError";
  }
}

export function hydrateLoopSession<TUse, TInput>(
  config: LoopConfig<TUse, TInput>,
  snapshot: LoopHydrationSnapshot<TInput>,
  options: LoopHydrateOptions = {},
): LoopSession<TUse, TInput> {
  const durable = snapshot.durable ?? deriveLegacyDurable(config, snapshot);
  const status = parseStatus(snapshot.status);
  const events = cloneSnapshot(snapshot.events ?? []);
  const checkpoints = cloneSnapshot(snapshot.checkpoints ?? []) as Array<LoopCheckpoint<TInput>>;
  const session = new LoopSession(
    config,
    snapshot.input,
    {
      ...options,
      answers: cloneSnapshot(snapshot.answers ?? {}),
      runId: snapshot.runId,
    },
    {
      initialState: parseState(snapshot.state),
      parentCheckpointId: snapshot.parentCheckpointId,
      parentRunId: snapshot.parentRunId,
      startStepIndex: durable.currentStepIndex,
    },
  );

  session.events.push(...events);
  session.checkpoints.push(...checkpoints);
  Object.assign(session.hookAnswers, cloneSnapshot(durable.hookAnswers));
  Object.assign(
    session.questionResolutionHistory,
    cloneSnapshot(durable.questionResolutionHistory ?? {}),
  );
  session.consumedHookTokens = new Set(durable.consumedHookTokens);
  session.createdStepIds = new Set(durable.createdStepIds);
  session.currentStepIndex = durable.currentStepIndex;
  session.hasStarted = durable.hasStarted;
  session.nextEventIndex = Math.max(durable.nextEventIndex, nextEventIndex(events));
  session.pendingHooks = cloneSnapshot(snapshot.pendingHooks ?? []);
  session.pendingQuestions = cloneSnapshot(snapshot.pendingQuestions ?? []);
  session.retryCounts = recordToNumberMap(durable.retryCounts);
  session.status = status;
  session.stepRunCounts = recordToNumberMap(durable.stepRunCounts);
  session.hookRequests = new Map(
    session.pendingHooks.map((hookRequest) => [hookRequest.token, hookRequest]),
  );

  return session;
}

function deriveLegacyDurable<TUse, TInput>(
  config: LoopConfig<TUse, TInput>,
  snapshot: LoopHydrationSnapshot<TInput>,
): LoopSessionDurableSnapshot {
  const events = snapshot.events ?? [];
  const checkpoints = snapshot.checkpoints ?? [];
  const pendingHook = snapshot.pendingHooks?.[0];
  const currentStepIndex = legacyStepIndex(config, snapshot, pendingHook);
  const stepRunCounts = legacyStepRunCounts(events, checkpoints);
  if (pendingHook) {
    stepRunCounts[pendingHook.stepId] = legacyHookAttempt(pendingHook);
  }
  const lastCheckpoint = checkpoints.at(-1);
  if (!pendingHook && lastCheckpoint) {
    stepRunCounts[lastCheckpoint.stepId] = Math.max(
      stepRunCounts[lastCheckpoint.stepId] ?? 0,
      lastCheckpoint.attempt,
    );
  }
  return {
    consumedHookTokens: [],
    createdStepIds: createdStepIds(events),
    currentStepIndex,
    hasStarted: events.some((event) => event.type === "run.started"),
    hookAnswers: {},
    nextEventIndex: nextEventIndex(events),
    retryCounts: retryCounts(events),
    stepRunCounts,
    version: 1,
  };
}

function legacyStepIndex<TUse, TInput>(
  config: LoopConfig<TUse, TInput>,
  snapshot: LoopHydrationSnapshot<TInput>,
  pendingHook: HookRequest | undefined,
) {
  if (pendingHook) {
    const index = config.steps.findIndex((step) => step.id === pendingHook.stepId);
    if (index !== -1) return index;
    throw new UnresumableRunError(`Snapshot references unknown step: ${pendingHook.stepId}`);
  }
  const checkpoint = snapshot.checkpoints?.at(-1);
  if (checkpoint) return checkpoint.stepIndex;
  const status = parseStatus(snapshot.status);
  if (isTerminalStatus(status)) return config.steps.length;
  throw new UnresumableRunError("Snapshot is missing durable state and has no pending hook or checkpoint.");
}

function legacyHookAttempt(hookRequest: HookRequest) {
  const attempt = Number(hookRequest.token.split(":")[3]);
  if (Number.isInteger(attempt) && attempt > 0) return attempt;
  throw new UnresumableRunError(`Snapshot has underivable hook attempt: ${hookRequest.token}`);
}

function legacyStepRunCounts(
  events: readonly EventRecord[],
  checkpoints: readonly LoopCheckpoint[],
) {
  const counts: Record<string, number> = {};
  for (const event of events) {
    if (!event.stepId || typeof event.attempt !== "number") continue;
    counts[event.stepId] = Math.max(counts[event.stepId] ?? 0, event.attempt);
  }
  for (const checkpoint of checkpoints) {
    counts[checkpoint.stepId] = Math.max(counts[checkpoint.stepId] ?? 0, checkpoint.attempt);
  }
  return counts;
}

function retryCounts(events: readonly EventRecord[]) {
  const counts: Record<string, number> = {};
  for (const event of events) {
    if (event.type !== "step.retrying" || !event.stepId) continue;
    const detail = event.detail;
    if (!isRecord(detail) || typeof detail.retries !== "number") continue;
    counts[event.stepId] = Math.max(counts[event.stepId] ?? 0, detail.retries);
  }
  return counts;
}

function createdStepIds(events: readonly EventRecord[]) {
  return events
    .filter((event) => event.type === "step.created" && typeof event.stepId === "string")
    .map((event) => event.stepId as string);
}

function nextEventIndex(events: readonly EventRecord[]) {
  return events.reduce((next, event) => Math.max(next, event.index + 1), 0);
}

function parseState(value: unknown): StepState {
  if (value === undefined) return {};
  if (isRecord(value)) return cloneSnapshot(value);
  throw new UnresumableRunError("Snapshot state must be an object.");
}

function parseStatus(value: string): LoopStatus {
  if (
    value === "idle" ||
    value === "running" ||
    value === "waiting" ||
    value === "paused" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  throw new UnresumableRunError(`Snapshot has unsupported status: ${value}`);
}

function recordToNumberMap(record: Record<string, number>) {
  return new Map(
    Object.entries(record).filter((entry): entry is [string, number] =>
      typeof entry[1] === "number"
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
