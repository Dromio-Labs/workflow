import type {
  DromioAuditRecordV1,
  DromioInteractionRequestV1,
  DromioJsonObject,
  DromioJsonValue,
  DromioMessageItem,
  DromioReferenceItem,
  DromioThreadAccessGrantV1,
  DromioThreadEventType,
  DromioThreadEventV1,
  DromioThreadItemV1,
  DromioThreadV1,
  DromioUserThreadStateV1,
} from "@dromio/protocols";
import { ThreadServiceError, threadNotFound } from "./errors.js";
import { assertExecutionFence } from "./execution-fence.js";
import { appendPrivateUserEvent } from "./user-events.js";
import { correlation } from "./lineage.js";
import { validateAnswer, validateAnswerSchema, validateApprovalBinding } from "./interaction-validation.js";
import type { ThreadIdFactory, ThreadPolicyPort, ThreadServiceClock, ThreadStore, ThreadTransaction } from "./ports.js";
import type {
  CreateInteractionInput,
  GrantThreadAccessInput,
  MigrateMessageInput,
  ResolveInteractionInput,
  ReviseMessageInput,
  ThreadCommandContext,
  ThreadReceipt,
  ThreadScope,
  UpdateUserThreadStateInput,
} from "./types.js";

export class ThreadGovernanceService {
  constructor(private readonly options: { readonly store: ThreadStore; readonly policy: ThreadPolicyPort; readonly clock: ThreadServiceClock; readonly ids: ThreadIdFactory }) {}

  async createInteraction(context: ThreadCommandContext, input: CreateInteractionInput): Promise<ThreadReceipt<DromioInteractionRequestV1>> {
    const scope = scopeFrom(context); const thread = await this.requireThread(scope, input.threadId);
    await this.authorize("turn.control", context, scope, thread);
    return this.options.store.transaction(async (tx) => {
      const replay = await this.replay<DromioInteractionRequestV1>(tx, scope, context, "interactions.create", input); if (replay) return replay;
      let locked = await requireThread(tx, scope, input.threadId); const now = this.options.clock.now();
      const turn = (await tx.listTurns(input.threadId)).find((value) => value.id === input.turnId);
      if (!turn || !["running", "waiting_for_approval", "waiting_for_input"].includes(turn.status)) throw new ThreadServiceError({ code: "validation_failed", message: "Interactions require an active turn." });
      if (context.execution) assertExecutionFence(turn, context, now, "current");
      if (input.expiresAt && Date.parse(input.expiresAt) <= Date.parse(now)) throw new ThreadServiceError({ code: "validation_failed", message: "Interaction expiry must be in the future." });
      const items = await tx.listItems(input.threadId);
      if (input.kind === "approval") {
        const tool = items.find((item) => item.id === input.itemId && item.type === "tool_call");
        await validateApprovalBinding(input, tool?.type === "tool_call" ? tool : undefined, turn.id);
      } else validateAnswerSchema(input.answerSchema);
      const common = { schemaVersion: "dromio.interaction-request.v1" as const, id: input.id ?? this.options.ids.create("interaction"), threadId: input.threadId, turnId: input.turnId, itemId: input.itemId, status: "pending" as const, requestedAt: now, version: 1, ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}) };
      const interaction: DromioInteractionRequestV1 = input.kind === "approval"
        ? { ...common, kind: "approval", operation: input.operation, toolVersion: input.toolVersion, ...(input.capabilityId ? { capabilityId: input.capabilityId } : {}), argumentsDigest: input.argumentsDigest, requestedPermissions: input.requestedPermissions, ...(input.risk ? { risk: input.risk } : {}) }
        : { ...common, kind: input.kind, prompt: input.prompt, answerSchema: input.answerSchema };
      await tx.putInteraction(interaction);
      if (interaction.kind === "approval") { const tool = items.find((item) => item.id === input.itemId && item.type === "tool_call"); if (tool?.type === "tool_call") await tx.putItem({ ...tool, status: "waiting_for_approval", approvalRequestId: interaction.id }); }
      const requestItem: DromioReferenceItem = { id: this.options.ids.create("item"), threadId: locked.id, turnId: turn.id, ordinal: locked.lastItemOrdinal + 1, createdAt: now, createdBy: context.actor.subject, type: interaction.kind === "approval" ? "approval_request" : interaction.kind, resourceId: interaction.id, status: interaction.status };
      await tx.putItem(requestItem);
      locked = await this.event(tx, { ...locked, lastItemOrdinal: requestItem.ordinal }, context, "interaction.created", { interactionId: interaction.id, requestItemId: requestItem.id, turnId: interaction.turnId, kind: interaction.kind, summary: interaction.kind === "approval" ? interaction.operation : interaction.prompt });
      await this.audit(tx, context, "interactions.create", locked.id);
      await tx.putThread(locked);
      const receipt = makeReceipt(context.commandId, interaction, locked.lastSequence);
      await this.persist(tx, scope, context, "interactions.create", input, receipt);
      return receipt;
    });
  }

  async resolveInteraction(context: ThreadCommandContext, input: ResolveInteractionInput): Promise<ThreadReceipt<DromioInteractionRequestV1>> {
    const scope = scopeFrom(context); const existing = await this.options.store.getInteraction(scope, input.interactionId);
    if (!existing) throw new ThreadServiceError({ code: "resource_not_found", message: `Interaction ${input.interactionId} was not found.` });
    const thread = await this.requireThread(scope, existing.threadId); await this.authorize("interaction.resolve", context, scope, thread);
    if (existing.expiresAt && Date.parse(existing.expiresAt) <= Date.parse(this.options.clock.now())) {
      await this.expireInteraction(context, existing.id);
      throw new ThreadServiceError({ code: "validation_failed", message: `Interaction ${existing.id} expired before it was resolved.` });
    }
    return this.options.store.transaction(async (tx) => {
      const replay = await this.replay<DromioInteractionRequestV1>(tx, scope, context, "interactions.resolve", input); if (replay) return replay;
      const current = await tx.getInteraction(input.interactionId);
      if (!current || current.status !== "pending") throw new ThreadServiceError({ code: "interaction_already_resolved", message: `Interaction ${input.interactionId} is no longer pending.` });
      if (current.kind === "approval" && !input.decision) throw new ThreadServiceError({ code: "validation_failed", message: "Approval resolution requires a decision." });
      if (current.kind !== "approval" && input.answer === undefined) throw new ThreadServiceError({ code: "validation_failed", message: "Question resolution requires an answer." });
      const now = this.options.clock.now();
      if (current.expiresAt && Date.parse(current.expiresAt) <= Date.parse(now)) throw new ThreadServiceError({ code: "validation_failed", message: `Interaction ${current.id} expired before it was resolved.` });
      if (current.kind !== "approval") validateAnswer(current.answerSchema, requiredAnswer(input.answer));
      const resolved: DromioInteractionRequestV1 = current.kind === "approval"
        ? { ...current, status: "resolved", resolvedAt: now, resolvedBy: context.actor.subject, version: current.version + 1, decision: requiredDecision(input.decision) }
        : { ...current, status: "resolved", resolvedAt: now, resolvedBy: context.actor.subject, version: current.version + 1, answer: requiredAnswer(input.answer) };
      await tx.putInteraction(resolved);
      if (resolved.kind === "approval") { const tool = (await tx.listItems(resolved.threadId)).find((item) => item.id === resolved.itemId && item.type === "tool_call"); if (tool?.type === "tool_call") await tx.putItem({ ...tool, status: resolved.decision === "approved" ? "queued" : "cancelled" }); }
      const requestItem = (await tx.listItems(resolved.threadId)).find((item): item is DromioReferenceItem => (item.type === "approval_request" || item.type === "question" || item.type === "form") && item.resourceId === resolved.id);
      if (!requestItem) throw new ThreadServiceError({ code: "validation_failed", message: `Interaction ${resolved.id} has no timeline item.` });
      await tx.putItem({ ...requestItem, status: resolved.status });
      const turn = (await tx.listTurns(resolved.threadId)).find((value) => value.id === resolved.turnId);
      if (!turn) throw new ThreadServiceError({ code: "validation_failed", message: `Interaction ${resolved.id} has no turn.` });
      let locked = await requireThread(tx, scope, current.threadId);
      locked = await this.event(tx, locked, context, "interaction.resolved", { interactionId: resolved.id, turnId: resolved.turnId, ...(resolved.kind === "approval" ? { decision: resolved.decision } : {}) });
      await this.audit(tx, context, "interactions.resolve", locked.id);
      await tx.appendOutbox({ id: this.options.ids.create("outbox"), topic: "execution.commands", aggregateId: locked.id, payload: { schemaVersion: "dromio.execution-command.v1", ...correlation(context), operation: "resume_thread_turn", ...scope, threadId: locked.id, turnId: resolved.turnId, turnOrdinal: turn.ordinal, generation: turn.version, interactionId: resolved.id, ...(resolved.kind === "approval" && resolved.decision ? { decision: resolved.decision } : { answer: resolved.kind === "approval" ? null : resolved.answer ?? null }), createdAt: now }, createdAt: now, attempts: 0 });
      await tx.putThread(locked);
      const receipt = makeReceipt(context.commandId, resolved, locked.lastSequence); await this.persist(tx, scope, context, "interactions.resolve", input, receipt); return receipt;
    });
  }

  async expireInteraction(context: ThreadCommandContext, interactionId: string): Promise<boolean> {
    const scope = scopeFrom(context); const existing = await this.options.store.getInteraction(scope, interactionId);
    if (!existing) return false;
    const thread = await this.requireThread(scope, existing.threadId); await this.authorize("turn.control", context, scope, thread);
    return this.options.store.transaction(async (tx) => {
      const current = await tx.getInteraction(interactionId); const now = this.options.clock.now();
      if (!current || current.status !== "pending" || !current.expiresAt || Date.parse(current.expiresAt) > Date.parse(now)) return false;
      const expired: DromioInteractionRequestV1 = { ...current, status: "expired", version: current.version + 1 };
      await tx.putInteraction(expired);
      const items = await tx.listItems(expired.threadId);
      if (expired.kind === "approval") { const tool = items.find((item) => item.id === expired.itemId && item.type === "tool_call"); if (tool?.type === "tool_call") await tx.putItem({ ...tool, status: "cancelled" }); }
      const requestItem = items.find((item): item is DromioReferenceItem => (item.type === "approval_request" || item.type === "question" || item.type === "form") && item.resourceId === expired.id);
      if (requestItem) await tx.putItem({ ...requestItem, status: "expired" });
      const turn = (await tx.listTurns(expired.threadId)).find((value) => value.id === expired.turnId);
      if (!turn) throw new ThreadServiceError({ code: "validation_failed", message: `Interaction ${expired.id} has no turn.` });
      let locked = await requireThread(tx, scope, expired.threadId);
      locked = await this.event(tx, locked, context, "interaction.expired", { interactionId: expired.id, turnId: expired.turnId });
      await tx.appendOutbox({ id: this.options.ids.create("outbox"), topic: "execution.commands", aggregateId: locked.id, payload: { schemaVersion: "dromio.execution-command.v1", ...correlation(context), operation: "resume_thread_turn", ...scope, threadId: locked.id, turnId: expired.turnId, turnOrdinal: turn.ordinal, generation: turn.version, interactionId: expired.id, ...(expired.kind === "approval" ? { decision: "denied" } : { answer: null }), createdAt: now }, createdAt: now, attempts: 0 });
      await tx.putThread(locked); return true;
    });
  }

  async reviseMessage(context: ThreadCommandContext, input: ReviseMessageInput | MigrateMessageInput, mode: "revise" | "withdraw" | "redact" | "delete" | "migration" = "revise"): Promise<ThreadReceipt<DromioThreadItemV1>> {
    const scope = scopeFrom(context); const thread = await this.requireThread(scope, input.threadId); await this.authorize("thread.update", context, scope, thread);
    return this.options.store.transaction(async (tx) => {
      const replay = await this.replay<DromioThreadItemV1>(tx, scope, context, `items.${mode}`, input); if (replay) return replay;
      const items = await tx.listItems(input.threadId); const current = items.find((item): item is DromioMessageItem => item.id === input.messageId && item.type === "message");
      if (!current) throw new ThreadServiceError({ code: "resource_not_found", message: `Message ${input.messageId} was not found.` });
      if (mode === "migration" && "expectedRevision" in input && input.expectedRevision !== current.revision) throw new ThreadServiceError({ code: "version_conflict", message: `Expected message revision ${input.expectedRevision}, received ${current.revision}.` });
      const turn = current.turnId ? (await tx.listTurns(input.threadId)).find((candidate) => candidate.id === current.turnId) : undefined;
      if (mode === "withdraw" && (!turn || turn.status !== "queued" || current.role !== "user")) throw new ThreadServiceError({ code: "validation_failed", message: "Only queued user input can be withdrawn in place." });
      const now = this.options.clock.now(); const revision = current.revision + 1;
      const content = mode === "redact" ? [{ type: "text" as const, text: "[redacted]" }] : mode === "delete" || mode === "withdraw" ? [] : input.content;
      if (mode !== "revise" && mode !== "migration") await tx.deleteMessageRevisions(current.id);
      await tx.putMessageRevision({ id: this.options.ids.create("revision"), messageId: current.id, revision, content, createdAt: now, createdBy: context.actor.subject, reason: mode === "migration" ? "migration" : mode === "revise" ? "author_edit" : mode === "withdraw" ? "withdrawal" : mode === "redact" ? "redaction" : "deletion" });
      const updated: DromioMessageItem = { ...current, content, revision, status: mode === "withdraw" ? "withdrawn" : mode === "redact" ? "redacted" : mode === "delete" ? "deleted" : current.status, contextVisibility: mode === "revise" || mode === "migration" ? current.contextVisibility : "excluded" };
      await tx.putItem(updated); let locked = await requireThread(tx, scope, input.threadId);
      if (mode === "withdraw" && turn) await tx.putTurn({ ...turn, status: "cancelled", statusReason: "input_withdrawn", updatedAt: now, version: turn.version + 1 });
      const eventType = mode === "revise" || mode === "migration" ? "item.revised" : mode === "withdraw" ? "item.withdrawn" : mode === "redact" ? "item.redacted" : "item.deleted";
      locked = await this.event(tx, locked, context, eventType, { itemId: updated.id, revision, previousRevision: current.revision }); await tx.putThread(locked);
      await this.audit(tx, context, `items.${mode}`, locked.id);
      const receipt = makeReceipt(context.commandId, updated, locked.lastSequence); await this.persist(tx, scope, context, `items.${mode}`, input, receipt); return receipt;
    });
  }

  async grantAccess(context: ThreadCommandContext, input: GrantThreadAccessInput): Promise<ThreadReceipt<DromioThreadAccessGrantV1>> {
    const scope = scopeFrom(context); const thread = await this.requireThread(scope, input.threadId); await this.authorize("access.manage", context, scope, thread);
    return this.options.store.transaction(async (tx) => {
      const replay = await this.replay<DromioThreadAccessGrantV1>(tx, scope, context, "participants.grant", input); if (replay) return replay;
      const grant: DromioThreadAccessGrantV1 = { schemaVersion: "dromio.thread-access-grant.v1", id: this.options.ids.create("grant"), threadId: input.threadId, principal: input.principal, role: input.role, grantedBy: context.actor.subject, createdAt: this.options.clock.now(), ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}) };
      await tx.putGrant(grant); let locked = await requireThread(tx, scope, input.threadId); locked = await this.event(tx, locked, context, "thread.access.changed", { grantId: grant.id, action: "granted" }); await tx.putThread(locked);
      await this.audit(tx, context, "participants.grant", locked.id);
      const receipt = makeReceipt(context.commandId, grant, locked.lastSequence); await this.persist(tx, scope, context, "participants.grant", input, receipt); return receipt;
    });
  }

  async updateUserState(context: ThreadCommandContext, threadId: string, patch: UpdateUserThreadStateInput): Promise<ThreadReceipt<DromioUserThreadStateV1>> {
    const scope = scopeFrom(context); const thread = await this.requireThread(scope, threadId); await this.authorize("thread.read", context, scope, thread);
    return this.options.store.transaction(async (tx) => {
      const commandInput = { threadId, ...patch }; const replay = await this.replay<DromioUserThreadStateV1>(tx, scope, context, "user_state.update", commandInput); if (replay) return replay;
      const previous = await tx.getUserState(threadId, context.actor.subject.id); const now = this.options.clock.now();
      if (patch.expectedVersion !== undefined && patch.expectedVersion !== (previous?.version ?? 0)) throw new ThreadServiceError({ code: "version_conflict", message: "User state version changed." });
      const changes = applyUserStatePatch(previous, patch);
      const state: DromioUserThreadStateV1 = { schemaVersion: "dromio.user-thread-state.v1", ...scope, threadId, userId: context.actor.subject.id, lastReadItemOrdinal: 0, notificationLevel: "all", ...changes, version: (previous?.version ?? 0) + 1, updatedAt: now };
      await tx.putUserState(state);
      const event = await appendPrivateUserEvent({ tx, ids: this.options.ids, clock: this.options.clock, context, scope, threadId, type: "user_state.updated", payload: { version: state.version } });
      const receipt: ThreadReceipt<DromioUserThreadStateV1> = { schemaVersion: "dromio.command-receipt.v1", commandId: context.commandId, resource: state, userSequence: event.sequence, replayed: false };
      await this.persist(tx, scope, context, "user_state.update", commandInput, receipt); return receipt;
    });
  }

  private async event(tx: ThreadTransaction, thread: DromioThreadV1, context: ThreadCommandContext, type: DromioThreadEventType, payload: DromioJsonObject): Promise<DromioThreadV1> {
    const next = { ...thread, lastSequence: thread.lastSequence + 1, version: thread.version + 1, updatedAt: this.options.clock.now() };
    const event: DromioThreadEventV1 = { schemaVersion: "dromio.thread-event.v1", eventId: this.options.ids.create("event"), type, ...scopeFrom(context), threadId: thread.id, sequence: next.lastSequence, applicationSequence: await tx.nextApplicationSequence(scopeFrom(context)), timestamp: this.options.clock.now(), ...correlation(context), payload };
    await tx.appendEvent(event); await tx.appendOutbox({ id: this.options.ids.create("outbox"), topic: "thread.events", aggregateId: thread.id, payload: { eventId: event.eventId, type, ...scopeFrom(context), threadId: thread.id, sequence: event.sequence, applicationSequence: event.applicationSequence }, createdAt: event.timestamp, attempts: 0 }); return next;
  }
  private async audit(tx: ThreadTransaction, context: ThreadCommandContext, action: string, threadId: string): Promise<void> {
    const scope = scopeFrom(context);
    const record: DromioAuditRecordV1 = {
      schemaVersion: "dromio.audit-record.v1",
      id: this.options.ids.create("audit"),
      ...scope,
      actor: context.actor.subject,
      action,
      target: { type: "thread", id: threadId },
      outcome: "allowed",
      correlationId: context.correlationId ?? context.commandId,
      createdAt: this.options.clock.now(),
    };
    await tx.putAudit(record);
  }
  private async requireThread(scope: ThreadScope, threadId: string): Promise<DromioThreadV1> { const value = await this.options.store.getThread(scope, threadId); if (!value) throw threadNotFound(threadId); return value; }
  private async authorize(action: "thread.read" | "thread.update" | "turn.control" | "interaction.resolve" | "access.manage", context: ThreadCommandContext, scope: ThreadScope, thread: DromioThreadV1): Promise<void> { await this.options.policy.authorize({ action, actor: context.actor, scope, thread }); }
  private async replay<Resource>(tx: ThreadTransaction, scope: ThreadScope, context: ThreadCommandContext, name: string, input: object): Promise<ThreadReceipt<Resource> | undefined> { if (!context.idempotencyKey) return undefined; const value = await tx.getReceipt(scope, context.idempotencyKey); if (!value) return undefined; const digest = JSON.stringify([name, input]); if (value.commandName !== name || value.inputDigest !== digest) throw new ThreadServiceError({ code: "idempotency_conflict", message: "The idempotency key was already used with a different command." }); return { ...value.receipt, replayed: true } as ThreadReceipt<Resource>; }
  private async persist(tx: ThreadTransaction, scope: ThreadScope, context: ThreadCommandContext, name: string, input: object, receipt: Parameters<ThreadTransaction["putReceipt"]>[0]["receipt"]): Promise<void> { if (context.idempotencyKey) await tx.putReceipt({ scope, idempotencyKey: context.idempotencyKey, commandName: name, inputDigest: JSON.stringify([name, input]), receipt }); }
}

type MutableUserStatePatch = {
  -readonly [Key in keyof DromioUserThreadStateV1]?: DromioUserThreadStateV1[Key];
};

function applyUserStatePatch(
  previous: DromioUserThreadStateV1 | undefined,
  patch: UpdateUserThreadStateInput,
): MutableUserStatePatch {
  const {
    expectedVersion: _,
    pinnedAt,
    pinRank,
    ...changes
  } = patch;
  const next: MutableUserStatePatch = { ...previous, ...changes };
  if (pinnedAt === null) delete next.pinnedAt;
  else if (pinnedAt !== undefined) next.pinnedAt = pinnedAt;
  if (pinRank === null) delete next.pinRank;
  else if (pinRank !== undefined) next.pinRank = pinRank;
  return next;
}

function scopeFrom(context: ThreadCommandContext): ThreadScope { return { tenantId: context.actor.tenantId, applicationId: context.actor.applicationId }; }
async function requireThread(tx: ThreadTransaction, scope: ThreadScope, id: string): Promise<DromioThreadV1> { const value = await tx.getThread(id); if (!value || value.tenantId !== scope.tenantId || value.applicationId !== scope.applicationId) throw threadNotFound(id); return value; }
function makeReceipt<Resource>(commandId: string, resource: Resource, sequence: number): ThreadReceipt<Resource> { return { schemaVersion: "dromio.command-receipt.v1", commandId, resource, threadSequence: sequence, replayed: false }; }
function requiredDecision(value: ResolveInteractionInput["decision"]): "approved" | "denied" { if (!value) throw new ThreadServiceError({ code: "validation_failed", message: "Approval resolution requires a decision." }); return value; }
function requiredAnswer(value: ResolveInteractionInput["answer"]): DromioJsonValue { if (value === undefined) throw new ThreadServiceError({ code: "validation_failed", message: "Question resolution requires an answer." }); return value; }
