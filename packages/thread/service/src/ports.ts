import type {
  DromioActorContextV1,
  DromioInteractionRequestV1,
  DromioMessageRevision,
  DromioThreadAccessGrantV1,
  DromioThreadEventV1,
  DromioThreadItemV1,
  DromioThreadV1,
  DromioTurnV1,
  DromioUserThreadStateV1,
  DromioThreadDraftV1,
  DromioThreadExportV1,
  DromioThreadShareLinkV1,
  DromioRetentionPolicyV1,
  DromioLegalHoldV1,
  DromioPurgeReceiptV1,
  DromioAuditRecordV1,
  DromioUsageRecordV1,
  DromioThreadAuthorityReceiptV1,
  DromioUserEventV1,
} from "@dromio/protocols";
import type {
  StoredCommandReceipt,
  ThreadListPage,
  ThreadListQuery,
  ThreadOutboxEntry,
  ThreadScope,
  ThreadExportSnapshot,
} from "./types.js";

export type ThreadAction =
  | "thread.create"
  | "thread.read"
  | "thread.update"
  | "thread.archive"
  | "thread.fork"
  | "thread.delete"
  | "turn.create"
  | "turn.control"
  | "interaction.resolve"
  | "access.manage"
  | "governance.manage";

export interface ThreadPolicyPort {
  authorize(input: {
    readonly action: ThreadAction;
    readonly actor: DromioActorContextV1;
    readonly scope: ThreadScope;
    readonly thread?: DromioThreadV1;
  }): Promise<void>;
}

export interface ThreadTransaction {
  getThread(id: string): Promise<DromioThreadV1 | undefined>;
  putThread(thread: DromioThreadV1): Promise<void>;
  listItems(threadId: string): Promise<readonly DromioThreadItemV1[]>;
  putItem(item: DromioThreadItemV1): Promise<void>;
  listTurns(threadId: string): Promise<readonly DromioTurnV1[]>;
  putTurn(turn: DromioTurnV1): Promise<void>;
  getReceipt(scope: ThreadScope, idempotencyKey: string): Promise<StoredCommandReceipt | undefined>;
  putReceipt(receipt: StoredCommandReceipt): Promise<void>;
  appendEvent(event: DromioThreadEventV1): Promise<void>;
  appendUserEvent(event: DromioUserEventV1): Promise<void>;
  appendOutbox(entry: ThreadOutboxEntry): Promise<void>;
  nextApplicationSequence(scope: ThreadScope): Promise<number>;
  nextUserSequence(scope: ThreadScope, userId: string): Promise<number>;
  getInteraction(id: string): Promise<DromioInteractionRequestV1 | undefined>;
  putInteraction(interaction: DromioInteractionRequestV1): Promise<void>;
  listGrants(threadId: string): Promise<readonly DromioThreadAccessGrantV1[]>;
  putGrant(grant: DromioThreadAccessGrantV1): Promise<void>;
  getUserState(threadId: string, userId: string): Promise<DromioUserThreadStateV1 | undefined>;
  putUserState(state: DromioUserThreadStateV1): Promise<void>;
  listMessageRevisions(messageId: string): Promise<readonly DromioMessageRevision[]>;
  deleteMessageRevisions(messageId: string): Promise<void>;
  putMessageRevision(revision: DromioMessageRevision): Promise<void>;
  putShareLink(link: DromioThreadShareLinkV1): Promise<void>;
  getDraft(threadId: string, userId: string): Promise<DromioThreadDraftV1 | undefined>;
  putDraft(draft: DromioThreadDraftV1): Promise<void>;
  deleteDraft(threadId: string, userId: string): Promise<void>;
  putExport(value: DromioThreadExportV1): Promise<void>;
  putExportSnapshot(value: ThreadExportSnapshot): Promise<void>;
  listExports(threadId: string): Promise<readonly DromioThreadExportV1[]>;
  putRetentionPolicy(value: DromioRetentionPolicyV1): Promise<void>;
  getRetentionPolicy(scope: ThreadScope): Promise<DromioRetentionPolicyV1 | undefined>;
  putLegalHold(value: DromioLegalHoldV1): Promise<void>;
  listLegalHolds(threadId: string): Promise<readonly DromioLegalHoldV1[]>;
  putPurgeReceipt(value: DromioPurgeReceiptV1): Promise<void>;
  putAudit(value: DromioAuditRecordV1): Promise<void>;
  listAudit(threadId: string): Promise<readonly DromioAuditRecordV1[]>;
  putUsage(value: DromioUsageRecordV1): Promise<void>;
  listUsage(threadId?: string): Promise<readonly DromioUsageRecordV1[]>;
  putAuthorityReceipt(value: DromioThreadAuthorityReceiptV1): Promise<void>;
  getAuthorityReceipt(threadId: string): Promise<DromioThreadAuthorityReceiptV1 | undefined>;
  purgeThreadData(threadId: string): Promise<Readonly<Record<string, number>>>;
}

export interface ThreadStore {
  transaction<Result>(work: (transaction: ThreadTransaction) => Promise<Result>): Promise<Result>;
  getThread(scope: ThreadScope, id: string): Promise<DromioThreadV1 | undefined>;
  listThreads(query: ThreadListQuery): Promise<ThreadListPage>;
  listItems(scope: ThreadScope, threadId: string): Promise<readonly DromioThreadItemV1[]>;
  listTurns(scope: ThreadScope, threadId: string): Promise<readonly DromioTurnV1[]>;
  readThreadEvents(scope: ThreadScope, threadId: string, after: number, limit: number): Promise<readonly DromioThreadEventV1[]>;
  readApplicationEvents(scope: ThreadScope, after: number, limit: number): Promise<readonly DromioThreadEventV1[]>;
  readUserEvents(scope: ThreadScope, userId: string, after: number, limit: number): Promise<readonly DromioUserEventV1[]>;
  readEventCursorBounds(scope: ThreadScope, feed: { readonly kind: "application" } | { readonly kind: "thread"; readonly threadId: string } | { readonly kind: "user"; readonly userId: string }): Promise<{ readonly oldest: number; readonly latest: number }>;
  readOutbox(limit: number, topic?: ThreadOutboxEntry["topic"]): Promise<readonly ThreadOutboxEntry[]>;
  markOutboxPublished(id: string, publishedAt: string): Promise<void>;
  getInteraction(scope: ThreadScope, id: string): Promise<DromioInteractionRequestV1 | undefined>;
  listInteractions(scope: ThreadScope, threadId: string): Promise<readonly DromioInteractionRequestV1[]>;
  listExpiredInteractions(before: string, limit: number): Promise<readonly { readonly scope: ThreadScope; readonly interaction: DromioInteractionRequestV1 }[]>;
  listGrants(scope: ThreadScope, threadId: string): Promise<readonly DromioThreadAccessGrantV1[]>;
  getUserState(scope: ThreadScope, threadId: string, userId: string): Promise<DromioUserThreadStateV1 | undefined>;
  listMessageRevisions(scope: ThreadScope, threadId: string, messageId: string): Promise<readonly DromioMessageRevision[]>;
  listShareLinks(scope: ThreadScope, threadId: string): Promise<readonly DromioThreadShareLinkV1[]>;
  resolveShareLink(threadId: string, tokenDigest: string): Promise<{ readonly thread: DromioThreadV1; readonly link: DromioThreadShareLinkV1 } | undefined>;
  getDraft(scope: ThreadScope, threadId: string, userId: string): Promise<DromioThreadDraftV1 | undefined>;
  listExports(scope: ThreadScope, threadId: string): Promise<readonly DromioThreadExportV1[]>;
  getExportSnapshot(scope: ThreadScope, exportId: string): Promise<ThreadExportSnapshot | undefined>;
  getRetentionPolicy(scope: ThreadScope): Promise<DromioRetentionPolicyV1 | undefined>;
  listLegalHolds(scope: ThreadScope, threadId: string): Promise<readonly DromioLegalHoldV1[]>;
  getPurgeReceipt(scope: ThreadScope, threadId: string): Promise<DromioPurgeReceiptV1 | undefined>;
  listAudit(scope: ThreadScope, threadId: string): Promise<readonly DromioAuditRecordV1[]>;
  listUsage(scope: ThreadScope, threadId?: string): Promise<readonly DromioUsageRecordV1[]>;
  getAuthorityReceipt(scope: ThreadScope, threadId: string): Promise<DromioThreadAuthorityReceiptV1 | undefined>;
}

export interface ThreadServiceClock {
  now(): string;
}

export interface ThreadIdFactory {
  create(kind: "thread" | "item" | "turn" | "event" | "outbox" | "interaction" | "grant" | "revision" | "share" | "export" | "retention" | "hold" | "purge" | "audit" | "usage" | "authority"): string;
}

export const allowAllThreadPolicy: ThreadPolicyPort = {
  authorize: async () => undefined,
};
