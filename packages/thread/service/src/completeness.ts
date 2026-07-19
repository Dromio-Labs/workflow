import type {
  DromioAuditRecordV1,
  DromioLegalHoldV1,
  DromioPurgeReceiptV1,
  DromioRetentionPolicyV1,
  DromioThreadAccessGrantV1,
  DromioThreadDraftV1,
  DromioThreadEventType,
  DromioThreadEventV1,
  DromioThreadExportV1,
  DromioThreadShareLinkV1,
  DromioThreadV1,
  DromioUsageRecordV1,
} from "@dromio/protocols";
import { ThreadServiceError, threadNotFound } from "./errors.js";
import { persistCommand, replayCommand } from "./idempotency.js";
import { appendPrivateUserEvent } from "./user-events.js";
import { correlation } from "./lineage.js";
import type { ThreadIdFactory, ThreadPolicyPort, ThreadServiceClock, ThreadStore, ThreadTransaction } from "./ports.js";
import type { CreateExportInput, CreateShareLinkInput, PlaceLegalHoldInput, SaveDraftInput, SetRetentionPolicyInput, ThreadCommandContext, ThreadReceipt, ThreadScope } from "./types.js";

export class ThreadCompletenessService {
  constructor(private readonly options: { readonly store: ThreadStore; readonly policy: ThreadPolicyPort; readonly clock: ThreadServiceClock; readonly ids: ThreadIdFactory }) {}

  async createShareLink(context: ThreadCommandContext, input: CreateShareLinkInput): Promise<ThreadReceipt<DromioThreadShareLinkV1>> {
    const scope = fromContext(context); const thread = await this.thread(scope, input.threadId); await this.authorize(context, scope, thread, "access.manage");
    return this.options.store.transaction(async (tx) => {
      const replay = await replayCommand<DromioThreadShareLinkV1>(tx, scope, context, "share_links.create", input); if (replay) return replay;
      const now = this.options.clock.now(); const link: DromioThreadShareLinkV1 = { schemaVersion: "dromio.thread-share-link.v1", id: this.options.ids.create("share"), threadId: thread.id, tokenDigest: input.tokenDigest, role: input.role, createdBy: context.actor.subject, createdAt: now, ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}) };
      await tx.putShareLink(link); const next = await this.event(tx, thread, context, "thread.access.changed", { shareLinkId: link.id, action: "created" }); await tx.putThread(next); await this.audit(tx, context, "share_links.create", thread.id); const result = receipt(context, link, next.lastSequence); await persistCommand(tx, scope, context, "share_links.create", input, result); return result;
    });
  }

  async revokeAccess(context: ThreadCommandContext, threadId: string, resourceId: string): Promise<ThreadReceipt<DromioThreadAccessGrantV1 | DromioThreadShareLinkV1>> {
    const scope = fromContext(context); const thread = await this.thread(scope, threadId); await this.authorize(context, scope, thread, "access.manage");
    return this.options.store.transaction(async (tx) => {
      const input = { threadId, resourceId }; const replay = await replayCommand<DromioThreadAccessGrantV1 | DromioThreadShareLinkV1>(tx, scope, context, "access.revoke", input); if (replay) return replay;
      const now = this.options.clock.now(); const grant = (await tx.listGrants(threadId)).find((value) => value.id === resourceId); const link = (await this.options.store.listShareLinks(scope, threadId)).find((value) => value.id === resourceId);
      if (!grant && !link) throw new ThreadServiceError({ code: "resource_not_found", message: `Access resource ${resourceId} was not found.` });
      const revoked = grant ? { ...grant, revokedAt: now } : { ...required(link), revokedAt: now };
      if (grant) await tx.putGrant(revoked as DromioThreadAccessGrantV1); else await tx.putShareLink(revoked as DromioThreadShareLinkV1);
      const next = await this.event(tx, thread, context, "thread.access.changed", { resourceId, action: "revoked" }); await tx.putThread(next); await this.audit(tx, context, "participants.revoke", thread.id); const result = receipt(context, revoked, next.lastSequence); await persistCommand(tx, scope, context, "access.revoke", input, result); return result;
    });
  }

  async saveDraft(context: ThreadCommandContext, input: SaveDraftInput): Promise<ThreadReceipt<DromioThreadDraftV1>> {
    const scope = fromContext(context); const thread = await this.thread(scope, input.threadId); await this.authorize(context, scope, thread, "thread.read");
    return this.options.store.transaction(async (tx) => {
      const replay = await replayCommand<DromioThreadDraftV1>(tx, scope, context, "drafts.save", input); if (replay) return replay;
      const previous = await tx.getDraft(thread.id, context.actor.subject.id); if (input.expectedVersion !== undefined && (previous?.version ?? 0) !== input.expectedVersion) throw new ThreadServiceError({ code: "version_conflict", message: "Draft version changed." });
      const draft: DromioThreadDraftV1 = { schemaVersion: "dromio.thread-draft.v1", threadId: thread.id, userId: context.actor.subject.id, content: input.content, updatedAt: this.options.clock.now(), version: (previous?.version ?? 0) + 1 };
      await tx.putDraft(draft);
      const event = await appendPrivateUserEvent({ tx, ids: this.options.ids, clock: this.options.clock, context, scope, threadId: thread.id, type: "draft.saved", payload: { version: draft.version } });
      const result = userReceipt(context, draft, event.sequence); await persistCommand(tx, scope, context, "drafts.save", input, result); return result;
    });
  }

  async deleteDraft(context: ThreadCommandContext, threadId: string): Promise<void> { const scope = fromContext(context); const thread = await this.thread(scope, threadId); await this.authorize(context, scope, thread, "thread.read"); await this.options.store.transaction(async (tx) => { const input = { threadId }; const replay = await replayCommand<DromioThreadV1>(tx, scope, context, "drafts.delete", input); if (replay) return; await tx.deleteDraft(threadId, context.actor.subject.id); const event = await appendPrivateUserEvent({ tx, ids: this.options.ids, clock: this.options.clock, context, scope, threadId, type: "draft.deleted", payload: {} }); await persistCommand(tx, scope, context, "drafts.delete", input, userReceipt(context, thread, event.sequence)); }); }

  async createExport(context: ThreadCommandContext, input: CreateExportInput): Promise<ThreadReceipt<DromioThreadExportV1>> {
    const scope = fromContext(context); const thread = await this.thread(scope, input.threadId); await this.authorize(context, scope, thread, "thread.read");
    return this.options.store.transaction(async (tx) => {
      const replay = await replayCommand<DromioThreadExportV1>(tx, scope, context, "exports.create", input); if (replay) return replay;
      const current = await requireThread(tx, scope, thread.id); const now = this.options.clock.now(); const value: DromioThreadExportV1 = { schemaVersion: "dromio.thread-export.v1", id: this.options.ids.create("export"), threadId: current.id, throughSequence: current.lastSequence, format: input.format, includeFiles: input.includeFiles ?? false, includeAudit: input.includeAudit ?? false, status: "queued", createdAt: now };
      await tx.putExport(value); await this.audit(tx, context, "threads.export", current.id); await tx.putExportSnapshot({ exportId: value.id, throughSequence: value.throughSequence, thread: current, items: await tx.listItems(current.id), turns: await tx.listTurns(current.id), audit: value.includeAudit ? await tx.listAudit(current.id) : [] }); await tx.appendOutbox({ id: this.options.ids.create("outbox"), topic: "governance.jobs", aggregateId: current.id, payload: { operation: "create_thread_export", threadId: current.id, exportId: value.id, ...scope }, createdAt: now, attempts: 0 }); const result = receipt(context, value, current.lastSequence); await persistCommand(tx, scope, context, "exports.create", input, result); return result;
    });
  }

  async setRetentionPolicy(context: ThreadCommandContext, input: SetRetentionPolicyInput): Promise<ThreadReceipt<DromioRetentionPolicyV1>> {
    validateRetention(input);
    const scope = fromContext(context); await this.options.policy.authorize({ action: "governance.manage", actor: context.actor, scope });
    return this.options.store.transaction(async (tx) => { const replay = await replayCommand<DromioRetentionPolicyV1>(tx, scope, context, "retention.set", input); if (replay) return replay; const value: DromioRetentionPolicyV1 = { schemaVersion: "dromio.retention-policy.v1", id: this.options.ids.create("retention"), ...scope, ...input, updatedAt: this.options.clock.now(), updatedBy: context.actor.subject }; await tx.putRetentionPolicy(value); const result = receipt(context, value); await persistCommand(tx, scope, context, "retention.set", input, result); return result; });
  }

  async placeLegalHold(context: ThreadCommandContext, input: PlaceLegalHoldInput): Promise<ThreadReceipt<DromioLegalHoldV1>> {
    const scope = fromContext(context); const thread = await this.thread(scope, input.threadId); await this.authorize(context, scope, thread, "governance.manage");
    return this.options.store.transaction(async (tx) => { const replay = await replayCommand<DromioLegalHoldV1>(tx, scope, context, "legal_holds.create", input); if (replay) return replay; const value: DromioLegalHoldV1 = { schemaVersion: "dromio.legal-hold.v1", id: this.options.ids.create("hold"), threadId: thread.id, reason: input.reason, placedAt: this.options.clock.now(), placedBy: context.actor.subject }; await tx.putLegalHold(value); await this.audit(tx, context, "legal_holds.create", thread.id); const result = receipt(context, value, thread.lastSequence); await persistCommand(tx, scope, context, "legal_holds.create", input, result); return result; });
  }

  async releaseLegalHold(context: ThreadCommandContext, threadId: string, holdId: string): Promise<ThreadReceipt<DromioLegalHoldV1>> {
    const scope = fromContext(context); const thread = await this.thread(scope, threadId); await this.authorize(context, scope, thread, "governance.manage");
    return this.options.store.transaction(async (tx) => { const input = { threadId, holdId }; const replay = await replayCommand<DromioLegalHoldV1>(tx, scope, context, "legal_holds.release", input); if (replay) return replay; const hold = (await tx.listLegalHolds(threadId)).find((value) => value.id === holdId); if (!hold) throw new ThreadServiceError({ code: "resource_not_found", message: `Legal hold ${holdId} was not found.` }); const value = { ...hold, releasedAt: this.options.clock.now(), releasedBy: context.actor.subject }; await tx.putLegalHold(value); await this.audit(tx, context, "legal_holds.release", thread.id); const result = receipt(context, value, thread.lastSequence); await persistCommand(tx, scope, context, "legal_holds.release", input, result); return result; });
  }

  async requestDeletion(context: ThreadCommandContext, threadId: string): Promise<ThreadReceipt<DromioThreadV1>> {
    const scope = fromContext(context); const thread = await this.thread(scope, threadId); await this.authorize(context, scope, thread, "thread.delete"); await this.assertNotHeld(scope, threadId);
    return this.options.store.transaction(async (tx) => {
      const input = { threadId }; const replay = await replayCommand<DromioThreadV1>(tx, scope, context, "threads.delete", input); if (replay) return replay; const current = await requireThread(tx, scope, threadId); const now = this.options.clock.now(); const next = await this.event(tx, { ...current, status: "deleting", version: current.version + 1, updatedAt: now }, context, "thread.deleted", { phase: "requested" });
      await tx.putThread(next); await tx.appendOutbox({ id: this.options.ids.create("outbox"), topic: "governance.jobs", aggregateId: threadId, payload: { operation: "request_thread_purge", ...scope, threadId }, createdAt: now, attempts: 0 }); await this.audit(tx, context, "threads.delete", threadId); const result = receipt(context, next, next.lastSequence); await persistCommand(tx, scope, context, "threads.delete", input, result); return result;
    });
  }

  async purge(context: ThreadCommandContext, threadId: string): Promise<ThreadReceipt<DromioPurgeReceiptV1>> {
    const scope = fromContext(context); const thread = await this.thread(scope, threadId); await this.authorize(context, scope, thread, "governance.manage"); await this.assertNotHeld(scope, threadId);
    return this.options.store.transaction(async (tx) => {
      const input = { threadId }; const replay = await replayCommand<DromioPurgeReceiptV1>(tx, scope, context, "threads.purge", input); if (replay) return replay;
      const policy = await tx.getRetentionPolicy(scope); const deletedResources = await tx.purgeThreadData(threadId); const now = this.options.clock.now(); const propagationTargets = ["context", "search", "files", "execution", "cache"]; const value: DromioPurgeReceiptV1 = { schemaVersion: "dromio.purge-receipt.v1", id: this.options.ids.create("purge"), ...scope, threadId, deletedResources, propagationTargets, propagation: Object.fromEntries(propagationTargets.map((target) => [target, { status: "pending" as const }])), status: "pending", purgedAt: now, purgedBy: context.actor.subject };
      const tombstone: DromioThreadV1 = { ...thread, title: "Purged thread", status: "purged", updatedAt: now, version: thread.version + 1, lastItemOrdinal: 0, lastTurnOrdinal: 0, metadata: undefined };
      await tx.putThread(tombstone); await tx.putPurgeReceipt(value); const next = await this.event(tx, tombstone, context, "thread.deleted", { phase: "purged", purgeReceiptId: value.id }); await tx.putThread(next); await tx.appendOutbox({ id: this.options.ids.create("outbox"), topic: "governance.jobs", aggregateId: threadId, payload: { operation: "propagate_thread_purge", ...scope, threadId, purgeReceiptId: value.id, targets: value.propagationTargets }, createdAt: now, attempts: 0 }); await tx.appendOutbox({ id: this.options.ids.create("outbox"), topic: "governance.jobs", aggregateId: threadId, payload: { operation: "record_backup_purge", ...scope, threadId, purgeReceiptId: value.id, backupExpiresAt: addDays(now, policy?.backupRetentionDays ?? policy?.retainForDays ?? 30) }, createdAt: now, attempts: 0 }); await this.audit(tx, context, "threads.purge", threadId); const result = receipt(context, value, next.lastSequence); await persistCommand(tx, scope, context, "threads.purge", input, result); return result;
    });
  }

  async recordUsage(context: ThreadCommandContext, input: Omit<DromioUsageRecordV1, "schemaVersion" | "id" | "tenantId" | "applicationId" | "correlationId" | "occurredAt">): Promise<DromioUsageRecordV1> {
    const scope = fromContext(context); if (input.threadId) { const thread = await this.thread(scope, input.threadId); await this.authorize(context, scope, thread, "governance.manage"); }
    return this.options.store.transaction(async (tx) => { const replay = await replayCommand<DromioUsageRecordV1>(tx, scope, context, "usage.record", input); if (replay) return replay.resource; const existing = (await tx.listUsage(input.threadId)).filter((record) => record.tenantId === scope.tenantId && record.applicationId === scope.applicationId); validateUsage(input, existing); const value: DromioUsageRecordV1 = { schemaVersion: "dromio.usage-record.v1", id: this.options.ids.create("usage"), ...scope, correlationId: correlation(context).correlationId, ...input, occurredAt: this.options.clock.now() }; await tx.putUsage(value); await persistCommand(tx, scope, context, "usage.record", input, receipt(context, value)); return value; });
  }

  private async assertNotHeld(scope: ThreadScope, threadId: string): Promise<void> { if ((await this.options.store.listLegalHolds(scope, threadId)).some((value) => !value.releasedAt)) throw new ThreadServiceError({ code: "retention_locked", message: `Thread ${threadId} is under legal hold.` }); }
  private async thread(scope: ThreadScope, threadId: string): Promise<DromioThreadV1> { const value = await this.options.store.getThread(scope, threadId); if (!value) throw threadNotFound(threadId); return value; }
  private async authorize(context: ThreadCommandContext, scope: ThreadScope, thread: DromioThreadV1, action: "thread.read" | "thread.delete" | "access.manage" | "governance.manage"): Promise<void> { await this.options.policy.authorize({ action, actor: context.actor, scope, thread }); }
  private async audit(tx: ThreadTransaction, context: ThreadCommandContext, action: string, threadId: string): Promise<void> { const scope = fromContext(context); const value: DromioAuditRecordV1 = { schemaVersion: "dromio.audit-record.v1", id: this.options.ids.create("audit"), ...scope, actor: context.actor.subject, action, target: { type: "thread", id: threadId }, outcome: "allowed", correlationId: context.correlationId ?? context.commandId, createdAt: this.options.clock.now() }; await tx.putAudit(value); }
  private async event(tx: ThreadTransaction, thread: DromioThreadV1, context: ThreadCommandContext, type: DromioThreadEventType, payload: Record<string, string>): Promise<DromioThreadV1> { const scope = fromContext(context); const next = { ...thread, lastSequence: thread.lastSequence + 1 }; const event: DromioThreadEventV1 = { schemaVersion: "dromio.thread-event.v1", eventId: this.options.ids.create("event"), type, ...scope, threadId: thread.id, sequence: next.lastSequence, applicationSequence: await tx.nextApplicationSequence(scope), timestamp: this.options.clock.now(), ...correlation(context), payload }; await tx.appendEvent(event); await tx.appendOutbox({ id: this.options.ids.create("outbox"), topic: "thread.events", aggregateId: thread.id, payload: { eventId: event.eventId, type, ...scope, threadId: thread.id, sequence: event.sequence, applicationSequence: event.applicationSequence }, createdAt: event.timestamp, attempts: 0 }); return next; }
}

function fromContext(context: ThreadCommandContext): ThreadScope { return { tenantId: context.actor.tenantId, applicationId: context.actor.applicationId }; }
function receipt<Resource>(context: ThreadCommandContext, resource: Resource, threadSequence?: number): ThreadReceipt<Resource> { return { schemaVersion: "dromio.command-receipt.v1", commandId: context.commandId, resource, ...(threadSequence !== undefined ? { threadSequence } : {}), replayed: false }; }
function userReceipt<Resource>(context: ThreadCommandContext, resource: Resource, userSequence: number): ThreadReceipt<Resource> { return { schemaVersion: "dromio.command-receipt.v1", commandId: context.commandId, resource, userSequence, replayed: false }; }
async function requireThread(tx: ThreadTransaction, scope: ThreadScope, id: string): Promise<DromioThreadV1> { const value = await tx.getThread(id); if (!value || value.tenantId !== scope.tenantId || value.applicationId !== scope.applicationId) throw threadNotFound(id); return value; }
function required<Value>(value: Value | undefined): Value { if (value === undefined) throw new Error("Required value was missing."); return value; }
function addDays(timestamp: string, days: number): string { const value = new Date(timestamp); value.setUTCDate(value.getUTCDate() + days); return value.toISOString(); }
function validateUsage(input: Omit<DromioUsageRecordV1, "schemaVersion" | "id" | "tenantId" | "applicationId" | "correlationId" | "occurredAt">, existing: readonly DromioUsageRecordV1[]): void { const references = input.reconcilesUsageRecordIds ?? []; if (input.status === "reconciled" && !references.length) throw new ThreadServiceError({ code: "validation_failed", message: "Reconciled usage must reference estimated and final records." }); if (input.status !== "reconciled" && references.length) throw new ThreadServiceError({ code: "validation_failed", message: "Only reconciled usage may reference prior records." }); if (!references.length) return; const alreadyReconciled = new Set(existing.flatMap((record) => record.reconcilesUsageRecordIds ?? [])); for (const id of references) { const record = existing.find((candidate) => candidate.id === id); if (!record || record.status === "reconciled" || record.runId !== input.runId || record.attemptId !== input.attemptId || record.providerId !== input.providerId || record.threadId !== input.threadId || alreadyReconciled.has(id)) throw new ThreadServiceError({ code: "validation_failed", message: `Usage record ${id} cannot be reconciled by this attempt.` }); } }

function validateRetention(input: SetRetentionPolicyInput): void {
  for (const [name, value] of Object.entries(input)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ThreadServiceError({
        code: "validation_failed",
        message: `${name} must be a non-negative integer.`,
      });
    }
  }
  if (input.deleteAfterDays !== undefined && input.deleteAfterDays < input.retainForDays) {
    throw new ThreadServiceError({
      code: "validation_failed",
      message: "deleteAfterDays cannot be earlier than retainForDays.",
    });
  }
  if (
    input.archiveAfterDays !== undefined &&
    input.deleteAfterDays !== undefined &&
    input.archiveAfterDays > input.deleteAfterDays
  ) {
    throw new ThreadServiceError({
      code: "validation_failed",
      message: "archiveAfterDays cannot be later than deleteAfterDays.",
    });
  }
}
