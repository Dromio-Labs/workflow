import type { DromioJsonObject, DromioUserEventType, DromioUserEventV1 } from "@dromio/protocols";
import type { ThreadIdFactory, ThreadServiceClock, ThreadTransaction } from "./ports.js";
import type { ThreadCommandContext, ThreadScope } from "./types.js";

export async function appendPrivateUserEvent(input: {
  readonly tx: ThreadTransaction;
  readonly ids: ThreadIdFactory;
  readonly clock: ThreadServiceClock;
  readonly context: ThreadCommandContext;
  readonly scope: ThreadScope;
  readonly threadId: string;
  readonly type: DromioUserEventType;
  readonly payload: DromioJsonObject;
}): Promise<DromioUserEventV1> {
  const userId = input.context.actor.subject.id;
  const timestamp = input.clock.now();
  const event: DromioUserEventV1 = {
    schemaVersion: "dromio.user-event.v1",
    eventId: input.ids.create("event"),
    type: input.type,
    ...input.scope,
    userId,
    threadId: input.threadId,
    sequence: await input.tx.nextUserSequence(input.scope, userId),
    timestamp,
    correlationId: input.context.correlationId ?? input.context.commandId,
    requestId: input.context.requestId ?? input.context.commandId,
    commandId: input.context.commandId,
    payload: input.payload,
  };
  await input.tx.appendUserEvent(event);
  await input.tx.appendOutbox({
    id: input.ids.create("outbox"),
    topic: "user.events",
    aggregateId: input.threadId,
    payload: {
      eventId: event.eventId,
      type: event.type,
      ...input.scope,
      userId,
      threadId: input.threadId,
      sequence: event.sequence,
    },
    createdAt: timestamp,
    attempts: 0,
  });
  return event;
}
