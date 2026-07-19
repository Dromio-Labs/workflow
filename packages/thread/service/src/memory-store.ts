import type {
  DromioInteractionRequestV1,
  DromioMessageRevision,
  DromioThreadAccessGrantV1,
  DromioThreadEventV1,
  DromioThreadItemV1,
  DromioThreadV1,
  DromioTurnV1,
  DromioUserThreadStateV1,
  DromioThreadDraftV1, DromioThreadExportV1, DromioThreadShareLinkV1, DromioRetentionPolicyV1, DromioLegalHoldV1, DromioPurgeReceiptV1, DromioAuditRecordV1, DromioUsageRecordV1, DromioThreadAuthorityReceiptV1, DromioUserEventV1,
} from "@dromio/protocols";
import type { ThreadStore, ThreadTransaction } from "./ports.js";
import type {
  StoredCommandReceipt,
  ThreadListPage,
  ThreadListQuery,
  ThreadOutboxEntry,
  ThreadScope,
  ThreadExportSnapshot,
} from "./types.js";
import { decodeThreadCursor, encodeThreadCursor } from "./cursor.js";
import { matchesThreadQuery } from "./thread-metadata.js";

interface MemoryState {
  readonly threads: Map<string, DromioThreadV1>;
  readonly items: Map<string, DromioThreadItemV1[]>;
  readonly turns: Map<string, DromioTurnV1[]>;
  readonly receipts: Map<string, StoredCommandReceipt>;
  readonly events: DromioThreadEventV1[];
  readonly userEvents: DromioUserEventV1[];
  readonly outbox: ThreadOutboxEntry[];
  readonly applicationSequences: Map<string, number>;
  readonly userSequences: Map<string, number>;
  readonly interactions: Map<string, DromioInteractionRequestV1>;
  readonly grants: Map<string, DromioThreadAccessGrantV1[]>;
  readonly userStates: Map<string, DromioUserThreadStateV1>;
  readonly revisions: Map<string, DromioMessageRevision[]>;
  readonly shareLinks: Map<string, DromioThreadShareLinkV1[]>;
  readonly drafts: Map<string, DromioThreadDraftV1>;
  readonly exports: Map<string, DromioThreadExportV1[]>;
  readonly exportSnapshots: Map<string, ThreadExportSnapshot>;
  readonly retentionPolicies: Map<string, DromioRetentionPolicyV1>;
  readonly legalHolds: Map<string, DromioLegalHoldV1[]>;
  readonly purgeReceipts: Map<string, DromioPurgeReceiptV1>;
  readonly audits: DromioAuditRecordV1[];
  readonly usage: DromioUsageRecordV1[];
  readonly authorityReceipts: Map<string, DromioThreadAuthorityReceiptV1>;
}

export class MemoryThreadStore implements ThreadStore {
  private state = emptyState();
  private pending: Promise<void> = Promise.resolve();

  async transaction<Result>(work: (transaction: ThreadTransaction) => Promise<Result>): Promise<Result> {
    const previous = this.pending;
    let release: () => void = () => undefined;
    this.pending = new Promise<void>((resolve) => { release = resolve; });
    await previous;

    try {
      const draft = cloneState(this.state);
      const result = await work(createTransaction(draft));
      this.state = draft;
      return result;
    } finally {
      release();
    }
  }

  async getThread(scope: ThreadScope, id: string): Promise<DromioThreadV1 | undefined> {
    const thread = this.state.threads.get(id);
    return thread && inScope(thread, scope) ? structuredClone(thread) : undefined;
  }

  async listThreads(query: ThreadListQuery): Promise<ThreadListPage> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const ordered = [...this.state.threads.values()]
      .filter((thread) => inScope(thread, query) && matchesThreadQuery(thread, query))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
    const cursor = decodeThreadCursor(query.cursor, query);
    const start = cursor ? ordered.findIndex((thread) => thread.updatedAt < cursor.updatedAt || (thread.updatedAt === cursor.updatedAt && thread.id > cursor.id)) : 0;
    const pageStart = start < 0 ? ordered.length : start;
    const data = ordered.slice(pageStart, pageStart + limit).map((thread) => structuredClone(thread));
    const last = data.at(-1);
    return { data, ...(last && pageStart + data.length < ordered.length ? { nextCursor: encodeThreadCursor(last, query) } : {}) };
  }

  async listItems(scope: ThreadScope, threadId: string): Promise<readonly DromioThreadItemV1[]> {
    if (!this.hasThread(scope, threadId)) return [];
    return structuredClone(this.state.items.get(threadId) ?? []);
  }

  async listTurns(scope: ThreadScope, threadId: string): Promise<readonly DromioTurnV1[]> {
    if (!this.hasThread(scope, threadId)) return [];
    return structuredClone(this.state.turns.get(threadId) ?? []);
  }

  async readThreadEvents(scope: ThreadScope, threadId: string, after: number, limit: number): Promise<readonly DromioThreadEventV1[]> {
    if (!this.hasThread(scope, threadId)) return [];
    return structuredClone(this.state.events.filter((event) => event.threadId === threadId && event.sequence > after).slice(0, limit));
  }

  async readApplicationEvents(scope: ThreadScope, after: number, limit: number): Promise<readonly DromioThreadEventV1[]> {
    return structuredClone(this.state.events.filter((event) => event.tenantId === scope.tenantId && event.applicationId === scope.applicationId && event.applicationSequence > after).slice(0, limit));
  }

  async readUserEvents(scope: ThreadScope, userId: string, after: number, limit: number): Promise<readonly DromioUserEventV1[]> {
    return structuredClone(this.state.userEvents.filter((event) => event.tenantId === scope.tenantId && event.applicationId === scope.applicationId && event.userId === userId && event.sequence > after).slice(0, limit));
  }

  async readEventCursorBounds(scope: ThreadScope, feed: { readonly kind: "application" } | { readonly kind: "thread"; readonly threadId: string } | { readonly kind: "user"; readonly userId: string }): Promise<{ readonly oldest: number; readonly latest: number }> {
    const sequences = feed.kind === "user"
      ? this.state.userEvents.filter((event) => event.tenantId === scope.tenantId && event.applicationId === scope.applicationId && event.userId === feed.userId).map((event) => event.sequence)
      : this.state.events.filter((event) => event.tenantId === scope.tenantId && event.applicationId === scope.applicationId && (feed.kind === "application" || event.threadId === feed.threadId)).map((event) => feed.kind === "application" ? event.applicationSequence : event.sequence);
    return { oldest: sequences.length ? Math.min(...sequences) : 0, latest: sequences.length ? Math.max(...sequences) : 0 };
  }

  async readOutbox(limit: number, topic?: ThreadOutboxEntry["topic"]): Promise<readonly ThreadOutboxEntry[]> {
    return structuredClone(this.state.outbox.filter((entry) => !entry.publishedAt && (!topic || entry.topic === topic)).slice(0, limit));
  }
  async markOutboxPublished(id: string, publishedAt: string): Promise<void> { const index = this.state.outbox.findIndex((entry) => entry.id === id); const entry = this.state.outbox[index]; if (index >= 0 && entry) this.state.outbox[index] = { ...entry, publishedAt }; }

  async getInteraction(scope: ThreadScope, id: string): Promise<DromioInteractionRequestV1 | undefined> { const value = this.state.interactions.get(id); return value && this.hasThread(scope, value.threadId) ? structuredClone(value) : undefined; }
  async listInteractions(scope: ThreadScope, threadId: string): Promise<readonly DromioInteractionRequestV1[]> { return this.hasThread(scope, threadId) ? [...this.state.interactions.values()].filter((value) => value.threadId === threadId).sort((left, right) => left.requestedAt.localeCompare(right.requestedAt) || left.id.localeCompare(right.id)).map((value) => structuredClone(value)) : []; }
  async listExpiredInteractions(before: string, limit: number): Promise<readonly { readonly scope: ThreadScope; readonly interaction: DromioInteractionRequestV1 }[]> { const values: { scope: ThreadScope; interaction: DromioInteractionRequestV1 }[] = []; for (const interaction of this.state.interactions.values()) { const thread = this.state.threads.get(interaction.threadId); if (thread && interaction.status === "pending" && interaction.expiresAt && interaction.expiresAt <= before) values.push({ scope: { tenantId: thread.tenantId, applicationId: thread.applicationId }, interaction }); } return structuredClone(values.sort((left, right) => (left.interaction.expiresAt ?? "").localeCompare(right.interaction.expiresAt ?? "") || left.interaction.id.localeCompare(right.interaction.id)).slice(0, limit)); }
  async listGrants(scope: ThreadScope, threadId: string): Promise<readonly DromioThreadAccessGrantV1[]> { return this.hasThread(scope, threadId) ? structuredClone(this.state.grants.get(threadId) ?? []) : []; }
  async getUserState(scope: ThreadScope, threadId: string, userId: string): Promise<DromioUserThreadStateV1 | undefined> { return this.hasThread(scope, threadId) ? structuredClone(this.state.userStates.get(`${threadId}\u0000${userId}`)) : undefined; }
  async listMessageRevisions(scope: ThreadScope, threadId: string, messageId: string): Promise<readonly DromioMessageRevision[]> { return this.hasThread(scope, threadId) ? structuredClone(this.state.revisions.get(messageId) ?? []) : []; }
  async listShareLinks(scope: ThreadScope, threadId: string): Promise<readonly DromioThreadShareLinkV1[]> { return this.hasThread(scope, threadId) ? structuredClone(this.state.shareLinks.get(threadId) ?? []) : []; }
  async resolveShareLink(threadId: string, tokenDigest: string): Promise<{ readonly thread: DromioThreadV1; readonly link: DromioThreadShareLinkV1 } | undefined> { const thread = this.state.threads.get(threadId); const link = (this.state.shareLinks.get(threadId) ?? []).find((value) => value.tokenDigest === tokenDigest); return thread && link ? structuredClone({ thread, link }) : undefined; }
  async getDraft(scope: ThreadScope, threadId: string, userId: string): Promise<DromioThreadDraftV1 | undefined> { return this.hasThread(scope, threadId) ? structuredClone(this.state.drafts.get(`${threadId}\u0000${userId}`)) : undefined; }
  async listExports(scope: ThreadScope, threadId: string): Promise<readonly DromioThreadExportV1[]> { return this.hasThread(scope, threadId) ? structuredClone(this.state.exports.get(threadId) ?? []) : []; }
  async getExportSnapshot(scope: ThreadScope, exportId: string): Promise<ThreadExportSnapshot | undefined> { const value = this.state.exportSnapshots.get(exportId); return value && this.hasThread(scope, value.thread.id) ? structuredClone(value) : undefined; }
  async getRetentionPolicy(scope: ThreadScope): Promise<DromioRetentionPolicyV1 | undefined> { return structuredClone(this.state.retentionPolicies.get(scopeKey(scope))); }
  async listLegalHolds(scope: ThreadScope, threadId: string): Promise<readonly DromioLegalHoldV1[]> { return this.hasThread(scope, threadId) ? structuredClone(this.state.legalHolds.get(threadId) ?? []) : []; }
  async getPurgeReceipt(scope: ThreadScope, threadId: string): Promise<DromioPurgeReceiptV1 | undefined> { const value = this.state.purgeReceipts.get(threadId); return value && value.tenantId === scope.tenantId && value.applicationId === scope.applicationId ? structuredClone(value) : undefined; }
  async listAudit(scope: ThreadScope, threadId: string): Promise<readonly DromioAuditRecordV1[]> { return structuredClone(this.state.audits.filter((value) => value.tenantId === scope.tenantId && value.target.id === threadId)); }
  async listUsage(scope: ThreadScope, threadId?: string): Promise<readonly DromioUsageRecordV1[]> { return structuredClone(this.state.usage.filter((value) => value.tenantId === scope.tenantId && value.applicationId === scope.applicationId && (!threadId || value.threadId === threadId))); }
  async getAuthorityReceipt(scope: ThreadScope, threadId: string): Promise<DromioThreadAuthorityReceiptV1 | undefined> { const value = this.state.authorityReceipts.get(threadId); return value && this.hasThread(scope, threadId) ? structuredClone(value) : undefined; }

  private hasThread(scope: ThreadScope, threadId: string): boolean {
    const thread = this.state.threads.get(threadId);
    return Boolean(thread && inScope(thread, scope));
  }
}

function createTransaction(state: MemoryState): ThreadTransaction {
  return {
    getThread: async (id) => state.threads.get(id),
    putThread: async (thread) => { state.threads.set(thread.id, structuredClone(thread)); },
    listItems: async (threadId) => structuredClone(state.items.get(threadId) ?? []),
    putItem: async (item) => { upsert(state.items, item.threadId, item, (value) => value.id); },
    listTurns: async (threadId) => structuredClone(state.turns.get(threadId) ?? []),
    putTurn: async (turn) => { upsert(state.turns, turn.threadId, turn, (value) => value.id); },
    getReceipt: async (scope, key) => state.receipts.get(receiptKey(scope, key)),
    putReceipt: async (receipt) => { state.receipts.set(receiptKey(receipt.scope, receipt.idempotencyKey), structuredClone(receipt)); },
    appendEvent: async (event) => { state.events.push(structuredClone(event)); },
    appendUserEvent: async (event) => { state.userEvents.push(structuredClone(event)); },
    appendOutbox: async (entry) => { state.outbox.push(structuredClone(entry)); },
    nextApplicationSequence: async (scope) => {
      const key = scopeKey(scope);
      const next = (state.applicationSequences.get(key) ?? 0) + 1;
      state.applicationSequences.set(key, next);
      return next;
    },
    nextUserSequence: async (scope, userId) => {
      const key = `${scopeKey(scope)}\u0000${userId}`;
      const next = (state.userSequences.get(key) ?? 0) + 1;
      state.userSequences.set(key, next);
      return next;
    },
    getInteraction: async (id) => state.interactions.get(id),
    putInteraction: async (value) => { state.interactions.set(value.id, structuredClone(value)); },
    listGrants: async (threadId) => structuredClone(state.grants.get(threadId) ?? []),
    putGrant: async (value) => { upsert(state.grants, value.threadId, value, (grant) => grant.id); },
    getUserState: async (threadId, userId) => state.userStates.get(`${threadId}\u0000${userId}`),
    putUserState: async (value) => { state.userStates.set(`${value.threadId}\u0000${value.userId}`, structuredClone(value)); },
    listMessageRevisions: async (messageId) => structuredClone(state.revisions.get(messageId) ?? []),
    deleteMessageRevisions: async (messageId) => { state.revisions.delete(messageId); },
    putMessageRevision: async (value) => { upsert(state.revisions, value.messageId, value, (revision) => revision.id); },
    putShareLink: async (value) => { upsert(state.shareLinks, value.threadId, value, (link) => link.id); },
    getDraft: async (threadId, userId) => state.drafts.get(`${threadId}\u0000${userId}`),
    putDraft: async (value) => { state.drafts.set(`${value.threadId}\u0000${value.userId}`, structuredClone(value)); },
    deleteDraft: async (threadId, userId) => { state.drafts.delete(`${threadId}\u0000${userId}`); },
    putExport: async (value) => { upsert(state.exports, value.threadId, value, (item) => item.id); },
    putExportSnapshot: async (value) => { state.exportSnapshots.set(value.exportId, structuredClone(value)); },
    listExports: async (threadId) => structuredClone(state.exports.get(threadId) ?? []),
    putRetentionPolicy: async (value) => { state.retentionPolicies.set(scopeKey(value), structuredClone(value)); },
    getRetentionPolicy: async (scope) => structuredClone(state.retentionPolicies.get(scopeKey(scope))),
    putLegalHold: async (value) => { upsert(state.legalHolds, value.threadId, value, (hold) => hold.id); },
    listLegalHolds: async (threadId) => structuredClone(state.legalHolds.get(threadId) ?? []),
    putPurgeReceipt: async (value) => { state.purgeReceipts.set(value.threadId, structuredClone(value)); },
    putAudit: async (value) => { state.audits.push(structuredClone(value)); },
    listAudit: async (threadId) => structuredClone(state.audits.filter((value) => value.target.type === "thread" && value.target.id === threadId)),
    putUsage: async (value) => { state.usage.push(structuredClone(value)); },
    listUsage: async (threadId) => structuredClone(state.usage.filter((value) => !threadId || value.threadId === threadId)),
    putAuthorityReceipt: async (value) => { state.authorityReceipts.set(value.threadId, structuredClone(value)); },
    getAuthorityReceipt: async (threadId) => state.authorityReceipts.get(threadId),
    purgeThreadData: async (threadId) => purgeMemoryThread(state, threadId),
  };
}

function upsert<Value>(map: Map<string, Value[]>, key: string, value: Value, id: (value: Value) => string): void {
  const values = map.get(key) ?? [];
  const index = values.findIndex((candidate) => id(candidate) === id(value));
  if (index === -1) values.push(structuredClone(value));
  else values[index] = structuredClone(value);
  map.set(key, values);
}

function emptyState(): MemoryState {
  return { threads: new Map(), items: new Map(), turns: new Map(), receipts: new Map(), events: [], userEvents: [], outbox: [], applicationSequences: new Map(), userSequences: new Map(), interactions: new Map(), grants: new Map(), userStates: new Map(), revisions: new Map(), shareLinks: new Map(), drafts: new Map(), exports: new Map(), exportSnapshots: new Map(), retentionPolicies: new Map(), legalHolds: new Map(), purgeReceipts: new Map(), audits: [], usage: [], authorityReceipts: new Map() };
}

function cloneState(state: MemoryState): MemoryState {
  return structuredClone(state);
}

function inScope(thread: DromioThreadV1, scope: ThreadScope): boolean {
  return thread.tenantId === scope.tenantId && thread.applicationId === scope.applicationId;
}

function scopeKey(scope: ThreadScope): string {
  return `${scope.tenantId}\u0000${scope.applicationId}`;
}

function receiptKey(scope: ThreadScope, key: string): string {
  return `${scopeKey(scope)}\u0000${key}`;
}

function purgeMemoryThread(state: MemoryState, threadId: string): Readonly<Record<string, number>> {
  const counts = { items: state.items.get(threadId)?.length ?? 0, turns: state.turns.get(threadId)?.length ?? 0, interactions: [...state.interactions.values()].filter((value) => value.threadId === threadId).length, grants: state.grants.get(threadId)?.length ?? 0, drafts: [...state.drafts.values()].filter((value) => value.threadId === threadId).length, exports: state.exports.get(threadId)?.length ?? 0, shareLinks: state.shareLinks.get(threadId)?.length ?? 0, events: state.events.filter((value) => value.threadId === threadId).length, userEvents: state.userEvents.filter((value) => value.threadId === threadId).length, outbox: state.outbox.filter((value) => value.aggregateId === threadId).length };
  state.items.delete(threadId); state.turns.delete(threadId); state.grants.delete(threadId); state.exports.delete(threadId); state.shareLinks.delete(threadId);
  for (const [key, value] of state.exportSnapshots) if (value.thread.id === threadId) state.exportSnapshots.delete(key);
  for (const [key, value] of state.interactions) if (value.threadId === threadId) state.interactions.delete(key);
  for (const [key, value] of state.drafts) if (value.threadId === threadId) state.drafts.delete(key);
  state.events.splice(0, state.events.length, ...state.events.filter((value) => value.threadId !== threadId));
  state.userEvents.splice(0, state.userEvents.length, ...state.userEvents.filter((value) => value.threadId !== threadId));
  state.outbox.splice(0, state.outbox.length, ...state.outbox.filter((value) => value.aggregateId !== threadId));
  return counts;
}
