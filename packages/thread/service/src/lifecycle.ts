import type { DromioMessageItem, DromioThreadEventType, DromioThreadEventV1, DromioThreadItemV1, DromioThreadV1, DromioTurnV1 } from "@dromio/protocols";
import { ThreadServiceError, threadNotFound } from "./errors.js";
import type { ThreadIdFactory, ThreadPolicyPort, ThreadServiceClock, ThreadStore, ThreadTransaction } from "./ports.js";
import type { ForkThreadInput, ReviseMessageInput, ThreadCommandContext, ThreadReceipt, ThreadScope } from "./types.js";
import { correlation, provenance } from "./lineage.js";

export class ThreadLifecycleService {
  constructor(private readonly options: { readonly store: ThreadStore; readonly policy: ThreadPolicyPort; readonly clock: ThreadServiceClock; readonly ids: ThreadIdFactory }) {}

  async fork(context: ThreadCommandContext, input: ForkThreadInput): Promise<ThreadReceipt<DromioThreadV1>> {
    const scope = fromContext(context); const source = await this.options.store.getThread(scope, input.sourceThreadId);
    if (!source) throw threadNotFound(input.sourceThreadId);
    await this.options.policy.authorize({ action: "thread.fork", actor: context.actor, scope, thread: source });
    return this.options.store.transaction(async (tx) => {
      const replayed = await replay(tx, scope, context, input); if (replayed) return replayed;
      const locked = await requireThread(tx, scope, source.id); const sourceTurns = await tx.listTurns(source.id); const sourceItems = await tx.listItems(source.id);
      const through = input.throughTurnId ? sourceTurns.find((turn) => turn.id === input.throughTurnId) : sourceTurns.at(-1);
      if (input.throughTurnId && !through) throw new ThreadServiceError({ code: "resource_not_found", message: `Turn ${input.throughTurnId} was not found.` });
      const copiedTurns = sourceTurns.filter((turn) => !through || turn.ordinal <= through.ordinal);
      const copiedTurnIds = new Map<string, string>(); const now = this.options.clock.now(); const threadId = this.options.ids.create("thread");
      for (const turn of copiedTurns) copiedTurnIds.set(turn.id, this.options.ids.create("turn"));
      const copiedItems = sourceItems.filter((item) => !item.turnId || copiedTurnIds.has(item.turnId));
      const copiedItemIds = new Map(copiedItems.map((item) => [item.id, this.options.ids.create("item")]));
      for (const turn of copiedTurns) await tx.putTurn(copyTurn(turn, threadId, requiredMap(copiedTurnIds, turn.id), copiedItemIds, context, now));
      for (const item of copiedItems) {
        const copiedId = requiredMap(copiedItemIds, item.id); await tx.putItem(copyItem(item, threadId, copiedTurnIds, copiedId, context, now));
        if (item.type === "message") for (const revision of await tx.listMessageRevisions(item.id)) await tx.putMessageRevision({ ...revision, id: this.options.ids.create("revision"), messageId: copiedId });
      }
      const thread: DromioThreadV1 = { schemaVersion: "dromio.thread.v1", id: threadId, ...scope, title: input.title?.trim() || `${locked.title} (fork)`, labels: locked.labels, status: "active", createdBy: context.actor.subject, createdAt: now, updatedAt: now, version: 1, lastSequence: 1, lastItemOrdinal: copiedItems.at(-1)?.ordinal ?? 0, lastTurnOrdinal: copiedTurns.at(-1)?.ordinal ?? 0, provenance: provenance(context, { threadId }), parentThreadId: locked.id, ...(through ? { forkedFromTurnId: through.id } : {}), ...(input.metadata ? { metadata: input.metadata } : locked.metadata ? { metadata: locked.metadata } : {}), ...(locked.metadataSchema ? { metadataSchema: locked.metadataSchema } : {}), ...(locked.metadataIndex ? { metadataIndex: locked.metadataIndex } : {}) };
      await tx.putThread(thread); const event: DromioThreadEventV1 = { schemaVersion: "dromio.thread-event.v1", eventId: this.options.ids.create("event"), type: "thread.forked", ...scope, threadId, sequence: 1, applicationSequence: await tx.nextApplicationSequence(scope), timestamp: now, ...correlation(context), payload: { parentThreadId: source.id, ...(through ? { forkedFromTurnId: through.id } : {}) } };
      await tx.appendEvent(event); await tx.appendOutbox({ id: this.options.ids.create("outbox"), topic: "thread.events", aggregateId: threadId, payload: { eventId: event.eventId, type: event.type, ...scope, threadId, sequence: 1, applicationSequence: event.applicationSequence }, createdAt: now, attempts: 0 });
      const receipt = makeReceipt(context.commandId, thread); if (context.idempotencyKey) await tx.putReceipt({ scope, idempotencyKey: context.idempotencyKey, commandName: "threads.fork", inputDigest: digest(input), receipt }); return receipt;
    });
  }

  async editFork(context: ThreadCommandContext, input: ReviseMessageInput): Promise<ThreadReceipt<DromioThreadItemV1>> {
    const scope = fromContext(context); const source = await this.options.store.getThread(scope, input.threadId); if (!source) throw threadNotFound(input.threadId);
    await this.options.policy.authorize({ action: "thread.fork", actor: context.actor, scope, thread: source });
    return this.options.store.transaction(async (tx) => {
      const digestValue = JSON.stringify(["items.revise", input]);
      if (context.idempotencyKey) { const stored = await tx.getReceipt(scope, context.idempotencyKey); if (stored) { if (stored.commandName !== "items.revise" || stored.inputDigest !== digestValue) throw new ThreadServiceError({ code: "idempotency_conflict", message: "The idempotency key was already used with a different command." }); return { ...stored.receipt, replayed: true } as ThreadReceipt<DromioThreadItemV1>; } }
      const locked = await requireThread(tx, scope, source.id); const sourceTurns = await tx.listTurns(source.id); const sourceItems = await tx.listItems(source.id);
      const original = sourceItems.find((item): item is DromioMessageItem => item.id === input.messageId && item.type === "message" && item.role === "user");
      if (!original?.turnId) throw new ThreadServiceError({ code: "resource_not_found", message: `Editable user message ${input.messageId} was not found.` });
      const editedTurn = sourceTurns.find((turn) => turn.id === original.turnId); if (!editedTurn) throw new ThreadServiceError({ code: "resource_not_found", message: `Turn ${original.turnId} was not found.` });
      const stable = sourceTurns.filter((turn) => turn.ordinal < editedTurn.ordinal && terminal(turn.status)).at(-1); const copiedTurns = sourceTurns.filter((turn) => Boolean(stable) && turn.ordinal <= stable!.ordinal);
      const turnIds = new Map<string, string>(copiedTurns.map((turn) => [turn.id, this.options.ids.create("turn")])); const copiedItems = sourceItems.filter((item) => item.ordinal < original.ordinal && (!item.turnId || turnIds.has(item.turnId)));
      const itemIds = new Map(copiedItems.map((item) => [item.id, this.options.ids.create("item")])); const now = this.options.clock.now(); const threadId = this.options.ids.create("thread");
      for (const turn of copiedTurns) await tx.putTurn(copyTurn(turn, threadId, requiredMap(turnIds, turn.id), itemIds, context, now));
      for (const item of copiedItems) { const copiedId = requiredMap(itemIds, item.id); await tx.putItem(copyItem(item, threadId, turnIds, copiedId, context, now)); if (item.type === "message") for (const revision of await tx.listMessageRevisions(item.id)) await tx.putMessageRevision({ ...revision, id: this.options.ids.create("revision"), messageId: copiedId }); }
      const messageId = this.options.ids.create("item"); const turnId = this.options.ids.create("turn"); const itemOrdinal = (copiedItems.at(-1)?.ordinal ?? 0) + 1; const turnOrdinal = (copiedTurns.at(-1)?.ordinal ?? 0) + 1;
      const message: DromioMessageItem = { ...original, id: messageId, threadId, turnId, ordinal: itemOrdinal, createdAt: now, createdBy: context.actor.subject, provenance: provenance(context, { threadId, turnId, itemId: messageId }), author: context.actor.subject, content: input.content, status: "completed", revision: 1, contextVisibility: "model_and_user" };
      const turn: DromioTurnV1 = { schemaVersion: "dromio.turn.v1", id: turnId, threadId, ordinal: turnOrdinal, status: "eligible", inputItemIds: [messageId], createdBy: context.actor.subject, createdAt: now, updatedAt: now, version: 1, provenance: provenance(context, { threadId, turnId, itemId: messageId }), regeneratedFromTurnId: editedTurn.id };
      let branch: DromioThreadV1 = { schemaVersion: "dromio.thread.v1", id: threadId, ...scope, title: `${locked.title} (edited)`, labels: locked.labels, status: "active", createdBy: context.actor.subject, createdAt: now, updatedAt: now, version: 1, lastSequence: 0, lastItemOrdinal: itemOrdinal, lastTurnOrdinal: turnOrdinal, provenance: provenance(context, { threadId }), parentThreadId: locked.id, ...(stable ? { forkedFromTurnId: stable.id } : {}), metadata: { ...(locked.metadata ?? {}), editFork: { sourceItemId: original.id, sourceTurnId: editedTurn.id } }, ...(locked.metadataSchema ? { metadataSchema: locked.metadataSchema } : {}), ...(locked.metadataIndex ? { metadataIndex: locked.metadataIndex } : {}) };
      await tx.putItem(message); await tx.putMessageRevision({ id: this.options.ids.create("revision"), messageId, revision: 1, content: input.content, createdAt: now, createdBy: context.actor.subject, reason: "author_edit" }); await tx.putTurn(turn);
      branch = await this.branchEvent(tx, branch, context, "thread.forked", { parentThreadId: locked.id, editedItemId: original.id }); branch = await this.branchEvent(tx, branch, context, "item.created", { itemId: messageId, turnId }); branch = await this.branchEvent(tx, branch, context, "turn.queued", { turnId, ordinal: turnOrdinal }); branch = await this.branchEvent(tx, branch, context, "turn.eligible", { turnId, ordinal: turnOrdinal }); await tx.putThread(branch);
      const executionCommandId = this.options.ids.create("outbox"); await tx.appendOutbox({ id: executionCommandId, topic: "execution.commands", aggregateId: threadId, payload: { schemaVersion: "dromio.execution-command.v1", ...correlation(context), operation: "execute_thread_turn", ...scope, threadId, turnId, turnOrdinal, generation: turn.version, createdAt: now }, createdAt: now, attempts: 0 });
      const receipt: ThreadReceipt<DromioThreadItemV1> = { schemaVersion: "dromio.command-receipt.v1", commandId: context.commandId, resource: message, threadSequence: branch.lastSequence, replayed: false }; if (context.idempotencyKey) await tx.putReceipt({ scope, idempotencyKey: context.idempotencyKey, commandName: "items.revise", inputDigest: digestValue, receipt }); return receipt;
    });
  }

  async ancestry(context: ThreadCommandContext, threadId: string): Promise<readonly DromioThreadV1[]> {
    const scope = fromContext(context); const values: DromioThreadV1[] = []; let current = await this.options.store.getThread(scope, threadId);
    if (!current) throw threadNotFound(threadId);
    await this.options.policy.authorize({ action: "thread.read", actor: context.actor, scope, thread: current });
    while (current.parentThreadId) { const parent = await this.options.store.getThread(scope, current.parentThreadId); if (!parent) break; values.unshift(parent); current = parent; }
    return values;
  }

  async children(context: ThreadCommandContext, threadId: string): Promise<readonly DromioThreadV1[]> {
    const scope = fromContext(context); const thread = await this.options.store.getThread(scope, threadId); if (!thread) throw threadNotFound(threadId);
    await this.options.policy.authorize({ action: "thread.read", actor: context.actor, scope, thread });
    const values: DromioThreadV1[] = []; let cursor: string | undefined;
    do { const page = await this.options.store.listThreads({ ...scope, parentThreadId: threadId, cursor, limit: 100 }); values.push(...page.data); cursor = page.nextCursor; } while (cursor);
    return values;
  }

  private async branchEvent(tx: ThreadTransaction, thread: DromioThreadV1, context: ThreadCommandContext, type: DromioThreadEventType, payload: Record<string, string | number>): Promise<DromioThreadV1> { const next = { ...thread, lastSequence: thread.lastSequence + 1 }; const scope = fromContext(context); const event: DromioThreadEventV1 = { schemaVersion: "dromio.thread-event.v1", eventId: this.options.ids.create("event"), type, ...scope, threadId: thread.id, sequence: next.lastSequence, applicationSequence: await tx.nextApplicationSequence(scope), timestamp: this.options.clock.now(), ...correlation(context), payload }; await tx.appendEvent(event); await tx.appendOutbox({ id: this.options.ids.create("outbox"), topic: "thread.events", aggregateId: thread.id, payload: { eventId: event.eventId, type, ...scope, threadId: thread.id, sequence: event.sequence, applicationSequence: event.applicationSequence }, createdAt: event.timestamp, attempts: 0 }); return next; }
}

function copyTurn(turn: DromioTurnV1, threadId: string, id: string, itemIds: ReadonlyMap<string, string>, context: ThreadCommandContext, now: string): DromioTurnV1 { return { ...turn, id, threadId, status: terminal(turn.status) ? turn.status : "cancelled", inputItemIds: turn.inputItemIds.map((itemId) => requiredMap(itemIds, itemId)), provenance: provenance(context, { threadId, turnId: id }), updatedAt: now, version: 1 }; }
function copyItem(item: DromioThreadItemV1, threadId: string, turnIds: ReadonlyMap<string, string>, id: string, context: ThreadCommandContext, now: string): DromioThreadItemV1 { const turnId = item.turnId ? requiredMap(turnIds, item.turnId) : undefined; return { ...item, id, threadId, ...(turnId ? { turnId } : {}), provenance: provenance(context, { threadId, ...(turnId ? { turnId } : {}), itemId: id }), createdAt: now, createdBy: context.actor.subject }; }
function terminal(status: DromioTurnV1["status"]): status is "completed" | "failed" | "cancelled" { return status === "completed" || status === "failed" || status === "cancelled"; }
function fromContext(context: ThreadCommandContext): ThreadScope { return { tenantId: context.actor.tenantId, applicationId: context.actor.applicationId }; }
async function requireThread(tx: ThreadTransaction, scope: ThreadScope, id: string): Promise<DromioThreadV1> { const value = await tx.getThread(id); if (!value || value.tenantId !== scope.tenantId || value.applicationId !== scope.applicationId) throw threadNotFound(id); return value; }
async function replay(tx: ThreadTransaction, scope: ThreadScope, context: ThreadCommandContext, input: ForkThreadInput): Promise<ThreadReceipt<DromioThreadV1> | undefined> { if (!context.idempotencyKey) return undefined; const value = await tx.getReceipt(scope, context.idempotencyKey); if (!value) return undefined; if (value.commandName !== "threads.fork" || value.inputDigest !== digest(input)) throw new ThreadServiceError({ code: "idempotency_conflict", message: "The idempotency key was already used with a different command." }); return { ...value.receipt, replayed: true } as ThreadReceipt<DromioThreadV1>; }
function digest(input: ForkThreadInput): string { return JSON.stringify(["threads.fork", input]); }
function makeReceipt(commandId: string, resource: DromioThreadV1): ThreadReceipt<DromioThreadV1> { return { schemaVersion: "dromio.command-receipt.v1", commandId, resource, threadSequence: 1, replayed: false }; }
function requiredMap(map: ReadonlyMap<string, string>, key: string): string { const value = map.get(key); if (!value) throw new Error(`Missing fork identity for ${key}.`); return value; }
