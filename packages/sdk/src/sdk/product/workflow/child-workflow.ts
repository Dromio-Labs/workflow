import type {
  EventPayload,
  EventRecord,
  LoopHydrateOptions,
  LoopHydrationSnapshot,
  LoopGraphProjection,
  Question,
  TraceContext,
} from "../../core/index.js";

export type RunnableChildWorkflow<TInput, TSession extends ChildWorkflowSession = ChildWorkflowSession> = {
  graph?(): LoopGraphProjection;
  hydrate?(snapshot: LoopHydrationSnapshot<TInput>, options?: LoopHydrateOptions): Promise<TSession> | TSession;
  id?: string;
  start(input: TInput, options?: {
    onEvent?: (event: EventRecord) => void;
    runId?: string;
  }): Promise<TSession> | TSession;
};

export type ChildWorkflowSession<TState = Record<string, unknown>> = {
  answer?(input: { questionId: string; value: unknown }): Promise<unknown> | unknown;
  answers?: Record<string, unknown>;
  events?: EventRecord[];
  pendingHooks?: unknown[];
  pendingQuestions?: Question[];
  resume?(): Promise<unknown> | unknown;
  runId: string;
  snapshot?(): LoopHydrationSnapshot;
  state: TState;
  status: string;
};

export type ChildWorkflowEventContext = {
  childRunId?: string;
  childWorkflowId: string;
  detail?: Record<string, unknown>;
  itemId?: string;
  itemKind?: string;
  iterationIndex?: number;
  iterationLabel?: string;
  iterationTotal?: number;
  messagePrefix?: string;
  parentStepId?: string;
  parentTrace?: Pick<TraceContext, "spanId" | "traceId">;
  phase?: string;
  spanIdPrefix?: string;
  stepIdPrefix?: string;
};

export type RunChildWorkflowInput<TInput, TSession extends ChildWorkflowSession = ChildWorkflowSession> =
  ChildWorkflowEventContext & {
    allowWaiting?: boolean;
    answers?: Record<string, unknown>;
    emit?: (event: EventPayload) => void;
    input: TInput;
    session?: TSession;
    snapshot?: LoopHydrationSnapshot<TInput>;
    workflow: RunnableChildWorkflow<TInput, TSession>;
  };

export type RunForEachWorkflowInput<TItem, TChildInput, TSession extends ChildWorkflowSession = ChildWorkflowSession> = {
  childWorkflowId: string;
  continueOnError?: boolean;
  emit?: (event: EventPayload) => void;
  input(item: TItem, context: ChildWorkflowIterationContext<TItem>): TChildInput;
  itemId?(item: TItem, context: ChildWorkflowIterationContext<TItem>): string;
  itemKind?: string;
  itemLabel?(item: TItem, context: ChildWorkflowIterationContext<TItem>): string;
  items: readonly TItem[];
  onItemCompleted?(context: ChildWorkflowCompletedContext<TItem, TSession>): Promise<void> | void;
  onItemFailed?(context: ChildWorkflowFailedContext<TItem, TSession>): Promise<void> | void;
  onItemStarted?(context: ChildWorkflowIterationContext<TItem>): Promise<void> | void;
  parentStepId?: string;
  parentTrace?: Pick<TraceContext, "spanId" | "traceId">;
  phase?: string;
  workflow(item: TItem, context: ChildWorkflowIterationContext<TItem>): RunnableChildWorkflow<TChildInput, TSession>;
};

export type ChildWorkflowIterationContext<TItem> = {
  index: number;
  item: TItem;
  itemId: string;
  itemLabel: string;
  total: number;
};

export type ChildWorkflowCompletedContext<TItem, TSession extends ChildWorkflowSession = ChildWorkflowSession> =
  ChildWorkflowIterationContext<TItem> & {
    session: TSession;
  };

export type ChildWorkflowFailedContext<TItem, TSession extends ChildWorkflowSession = ChildWorkflowSession> =
  ChildWorkflowIterationContext<TItem> & {
    error: unknown;
    session?: TSession;
  };

export type ChildWorkflowIterationResult<TItem, TSession extends ChildWorkflowSession = ChildWorkflowSession> =
  | (ChildWorkflowIterationContext<TItem> & {
      session: TSession;
      status: "completed";
    })
  | (ChildWorkflowIterationContext<TItem> & {
      error: unknown;
      session?: TSession;
      status: "failed";
    });

export class UnsupportedChildWorkflowWaitingError extends Error {
  constructor(readonly childWorkflowId: string, readonly childRunId: string) {
    super(`Child workflow ${childWorkflowId} (${childRunId}) is waiting for input; nested waiting is not supported yet.`);
    this.name = "UnsupportedChildWorkflowWaitingError";
  }
}

export class FailedChildWorkflowError<TSession extends ChildWorkflowSession = ChildWorkflowSession> extends Error {
  constructor(
    readonly childWorkflowId: string,
    readonly childRunId: string,
    readonly status: string,
    readonly session?: TSession,
  ) {
    super(`Child workflow ${childWorkflowId} (${childRunId}) finished with status ${status}.`);
    this.name = "FailedChildWorkflowError";
  }
}

/**
 * Low-level child runner used by `step.workflow(...)`.
 * This low-level execution helper remains available for SDK and adapter internals.
 */
export async function runChildWorkflow<TInput, TSession extends ChildWorkflowSession = ChildWorkflowSession>(
  input: RunChildWorkflowInput<TInput, TSession>,
): Promise<TSession> {
  let childRunId = input.snapshot?.runId;
  const onEvent = (event: EventRecord) => {
    childRunId = childRunId ?? event.runId;
    const forwarded = childWorkflowEventPayload(event, {
      ...input,
      childRunId: childRunId ?? event.runId,
    });
    if (forwarded) input.emit?.(forwarded);
  };
  const session = input.session
    ? await resumeChildWorkflow(input.session, input.answers)
    : input.snapshot
      ? await resumeChildWorkflow(await hydrateChildWorkflow(input.workflow, input.snapshot, onEvent), input.answers)
      : await input.workflow.start(input.input, { onEvent });
  childRunId = childRunId ?? session.runId;
  if (session.status === "waiting" || (session.pendingQuestions?.length ?? 0) > 0 || (session.pendingHooks?.length ?? 0) > 0) {
    if (input.allowWaiting && (session.pendingQuestions?.length ?? 0) > 0) return session;
    throw new UnsupportedChildWorkflowWaitingError(input.childWorkflowId, childRunId);
  }
  if (session.status !== "completed") {
    throw new FailedChildWorkflowError(input.childWorkflowId, childRunId, session.status, session);
  }
  return session;
}

async function hydrateChildWorkflow<TInput, TSession extends ChildWorkflowSession>(
  workflow: RunnableChildWorkflow<TInput, TSession>,
  snapshot: LoopHydrationSnapshot<TInput>,
  onEvent: (event: EventRecord) => void,
) {
  if (!workflow.hydrate) {
    throw new Error(`Child workflow ${snapshot.runId} cannot hydrate its durable snapshot.`);
  }
  return await workflow.hydrate(snapshot, { onEvent });
}

async function resumeChildWorkflow<TSession extends ChildWorkflowSession>(
  session: TSession,
  parentAnswers: Record<string, unknown> | undefined,
) {
  const questions = session.pendingQuestions ?? [];
  const answers = parentAnswers ?? {};
  const childAnswers = session.answers ?? {};
  if (questions.some((question) => !(question.id in answers) && !(question.id in childAnswers))) {
    return session;
  }
  if (!session.answer || !session.resume) {
    throw new Error(`Child workflow ${session.runId} cannot resume its pending questions.`);
  }
  for (const question of questions) {
    if (question.id in childAnswers) continue;
    await session.answer({
      questionId: question.id,
      value: answers[question.id],
    });
  }
  await session.resume();
  return session;
}

/**
 * Low-level fan-out runner used by `step.forEach(...)` and advanced adapters.
 * This low-level sequential helper remains available for SDK and adapter internals.
 */
export async function runForEachWorkflow<TItem, TChildInput, TSession extends ChildWorkflowSession = ChildWorkflowSession>(
  input: RunForEachWorkflowInput<TItem, TChildInput, TSession>,
): Promise<Array<ChildWorkflowIterationResult<TItem, TSession>>> {
  const results: Array<ChildWorkflowIterationResult<TItem, TSession>> = [];
  const total = input.items.length;
  for (const [index, item] of input.items.entries()) {
    const context = {
      index,
      item,
      itemId: input.itemId?.(item, {
        index,
        item,
        itemId: "",
        itemLabel: "",
        total,
      }) ?? String(index),
      itemLabel: "",
      total,
    };
    context.itemLabel = input.itemLabel?.(item, context) ?? context.itemId;
    try {
      await input.onItemStarted?.(context);
      const session = await runChildWorkflow({
        childWorkflowId: input.childWorkflowId,
        detail: {
          itemId: context.itemId,
          itemKind: input.itemKind,
        },
        emit: input.emit,
        input: input.input(item, context),
        itemId: context.itemId,
        itemKind: input.itemKind,
        iterationIndex: index,
        iterationLabel: context.itemLabel,
        iterationTotal: total,
        messagePrefix: context.itemLabel,
        parentStepId: input.parentStepId,
        parentTrace: input.parentTrace,
        phase: input.phase,
        spanIdPrefix: [
          "child",
          input.parentStepId ?? input.childWorkflowId,
          input.itemKind ? `${input.itemKind}:${context.itemId}` : context.itemId,
        ].join(":"),
        stepIdPrefix: [input.parentStepId, context.itemId].filter(Boolean).join("."),
        workflow: input.workflow(item, context),
      });
      const completed = { ...context, session, status: "completed" as const };
      await input.onItemCompleted?.(completed);
      results.push(completed);
    } catch (error) {
      const session = error instanceof FailedChildWorkflowError ? error.session as TSession | undefined : undefined;
      const failed = { ...context, error, session, status: "failed" as const };
      results.push(failed);
      await input.onItemFailed?.(failed);
      if (!input.continueOnError) throw error;
    }
  }
  return results;
}

export function childWorkflowEventPayload(
  event: EventRecord,
  context: ChildWorkflowEventContext,
): EventPayload | undefined {
  if (event.type === "run.started" || event.type === "run.completed" || event.type === "run.failed" || event.type === "run.cancelled") {
    return undefined;
  }
  const originalStepId = eventStepId(event);
  const stepId = originalStepId
    ? [context.stepIdPrefix, originalStepId].filter(Boolean).join(".")
    : context.parentStepId;
  const tracePrefix = context.spanIdPrefix
    ?? `child:${context.parentStepId ?? context.childWorkflowId}:${context.childRunId ?? "unknown"}`;
  const spanId = event.trace?.spanId
    ? `${tracePrefix}:${event.trace.spanId}`
    : `${tracePrefix}:event:${event.type}`;
  return {
    ...event,
    detail: {
      ...recordDetail(event.detail),
      ...(context.detail ?? {}),
      childRunId: context.childRunId,
      childWorkflowId: context.childWorkflowId,
      itemId: context.itemId,
      itemKind: context.itemKind,
      itemWorkflowStepId: originalStepId,
      iterationIndex: context.iterationIndex,
      iterationLabel: context.iterationLabel,
      iterationTotal: context.iterationTotal,
      parentStepId: context.parentStepId,
    },
    message: context.messagePrefix ? `${context.messagePrefix}: ${event.message}` : event.message,
    stepId,
    trace: {
      attributes: compactAttributes({
        ...(event.trace?.attributes ?? {}),
        childRunId: context.childRunId,
        childWorkflowId: context.childWorkflowId,
        itemId: context.itemId,
        itemKind: context.itemKind,
        itemWorkflowStepId: originalStepId,
        iterationIndex: context.iterationIndex,
        iterationLabel: context.iterationLabel,
        iterationTotal: context.iterationTotal,
        parentStepId: context.parentStepId,
        phase: context.phase ?? event.trace?.attributes?.phase ?? "child workflow",
        ...(stepId ? { stepId } : {}),
      }),
      kind: event.trace?.kind ?? "internal",
      name: context.messagePrefix && originalStepId ? `${context.messagePrefix}: ${originalStepId}` : event.trace?.name ?? event.message,
      parentSpanId: childParentSpanId(event, context, tracePrefix),
      spanId,
      status: event.trace?.status ?? (event.type.endsWith(".failed") ? "error" : event.type.endsWith(".completed") ? "ok" : "unset"),
      traceId: context.parentTrace?.traceId
        ?? context.childRunId
        ?? event.trace?.traceId
        ?? context.childWorkflowId,
    },
    type: event.type,
  };
}

function childParentSpanId(
  event: EventRecord,
  context: ChildWorkflowEventContext,
  tracePrefix: string,
) {
  const originalParentSpanId = event.trace?.parentSpanId;
  if (
    !originalParentSpanId
    || originalParentSpanId === `run:${context.childRunId}`
  ) {
    return context.parentTrace?.spanId ?? originalParentSpanId;
  }
  const stepParentWithoutAttempt = /^step:[^:]+$/.test(originalParentSpanId);
  const normalizedParentSpanId = stepParentWithoutAttempt && typeof event.attempt === "number"
    ? `${originalParentSpanId}:attempt:${event.attempt}`
    : originalParentSpanId;
  return `${tracePrefix}:${normalizedParentSpanId}`;
}

function eventStepId(event: EventRecord) {
  return event.stepId ?? stringAttribute(event.trace?.attributes?.stepId);
}

function stringAttribute(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function recordDetail(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function compactAttributes(input: Record<string, unknown>) {
  const output: Record<string, boolean | number | string | Array<boolean | number | string>> = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      (Array.isArray(value) && value.every((item) =>
        typeof item === "string" || typeof item === "number" || typeof item === "boolean"
      ))
    ) {
      output[key] = value;
    }
  }
  return output;
}
