import type {
  DromioMessageItem,
  DromioThreadEventV1,
  DromioThreadItemV1,
  DromioThreadV1,
} from "@dromio/protocols";
import { ThreadServiceError, threadNotFound } from "./errors.js";
import { persistCommand, replayCommand } from "./idempotency.js";
import type {
  ThreadIdFactory,
  ThreadPolicyPort,
  ThreadServiceClock,
  ThreadStore,
} from "./ports.js";
import type {
  SteerTurnInput,
  ThreadCommandContext,
  ThreadReceipt,
  ThreadScope,
} from "./types.js";
import { correlation, provenance } from "./lineage.js";

export class ThreadSteeringService {
  constructor(
    private readonly options: {
      readonly supported: boolean;
      readonly store: ThreadStore;
      readonly policy: ThreadPolicyPort;
      readonly clock: ThreadServiceClock;
      readonly ids: ThreadIdFactory;
    },
  ) {}

  async steer(
    context: ThreadCommandContext,
    input: SteerTurnInput,
  ): Promise<ThreadReceipt<DromioThreadItemV1>> {
    if (!this.options.supported) {
      throw new ThreadServiceError({
        code: "steering_not_supported",
        message: "The configured execution backend does not support live steering.",
      });
    }
    const scope = fromContext(context);
    const thread = await this.options.store.getThread(scope, input.threadId);
    if (!thread) throw threadNotFound(input.threadId);
    await this.options.policy.authorize({
      action: "turn.control",
      actor: context.actor,
      scope,
      thread,
    });

    return this.options.store.transaction(async (tx) => {
      const replay = await replayCommand<DromioThreadItemV1>(
        tx,
        scope,
        context,
        "turns.steer",
        input,
      );
      if (replay) return replay;
      let current = await tx.getThread(input.threadId);
      if (
        !current ||
        current.tenantId !== scope.tenantId ||
        current.applicationId !== scope.applicationId
      ) {
        throw threadNotFound(input.threadId);
      }
      const turns = await tx.listTurns(input.threadId);
      const turn = turns.find((value) => value.id === input.turnId);
      if (!turn || turn.status !== "running") {
        throw new ThreadServiceError({
          code: "validation_failed",
          message: "Only a running turn can be steered.",
        });
      }
      const now = this.options.clock.now();
      const itemId = this.options.ids.create("item");
      const item: DromioMessageItem = {
        id: itemId,
        threadId: current.id,
        turnId: turn.id,
        ordinal: current.lastItemOrdinal + 1,
        createdAt: now,
        createdBy: context.actor.subject,
        provenance: provenance(context, { threadId: current.id, turnId: turn.id, itemId }),
        type: "message",
        role: "user",
        author: context.actor.subject,
        content: input.content,
        status: "completed",
        revision: 1,
        contextVisibility: "model_and_user",
      };
      await tx.putItem(item);
      await tx.putTurn({
        ...turn,
        inputItemIds: [...turn.inputItemIds, item.id],
        updatedAt: now,
        version: turn.version + 1,
      });
      current = {
        ...current,
        lastItemOrdinal: item.ordinal,
        lastSequence: current.lastSequence + 1,
        updatedAt: now,
        version: current.version + 1,
      };
      const event: DromioThreadEventV1 = {
        schemaVersion: "dromio.thread-event.v1",
        eventId: this.options.ids.create("event"),
        type: "item.created",
        ...scope,
        threadId: current.id,
        sequence: current.lastSequence,
        applicationSequence: await tx.nextApplicationSequence(scope),
        timestamp: now,
        ...correlation(context),
        payload: { itemId: item.id, turnId: turn.id, steering: true },
      };
      await tx.appendEvent(event);
      await tx.appendOutbox({
        id: this.options.ids.create("outbox"),
        topic: "thread.events",
        aggregateId: current.id,
        payload: {
          eventId: event.eventId,
          type: event.type,
          ...scope,
          threadId: current.id,
          sequence: event.sequence,
          applicationSequence: event.applicationSequence,
        },
        createdAt: now,
        attempts: 0,
      });
      await tx.appendOutbox({
        id: this.options.ids.create("outbox"),
        topic: "execution.commands",
        aggregateId: current.id,
        payload: {
          schemaVersion: "dromio.execution-command.v1",
          ...correlation(context),
          operation: "steer_thread_turn",
          ...scope,
          threadId: current.id,
          turnId: turn.id,
          turnOrdinal: turn.ordinal,
          generation: turn.version + 1,
          createdAt: now,
          payload: { itemId: item.id },
        },
        createdAt: now,
        attempts: 0,
      });
      await tx.putThread(current);
      const result = receipt(context, item, current);
      await persistCommand(tx, scope, context, "turns.steer", input, result);
      return result;
    });
  }
}

function fromContext(context: ThreadCommandContext): ThreadScope {
  return {
    tenantId: context.actor.tenantId,
    applicationId: context.actor.applicationId,
  };
}

function receipt(
  context: ThreadCommandContext,
  resource: DromioThreadItemV1,
  thread: DromioThreadV1,
): ThreadReceipt<DromioThreadItemV1> {
  return {
    schemaVersion: "dromio.command-receipt.v1",
    commandId: context.commandId,
    resource,
    threadSequence: thread.lastSequence,
    replayed: false,
  };
}
