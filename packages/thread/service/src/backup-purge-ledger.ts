import type { DromioBackupPurgeLedgerEntryV1, DromioRestorePurgeReceiptV1 } from "@dromio/protocols";
import type { ThreadStore } from "./ports.js";
import { propagateThreadPurge, type ThreadPurgePropagationPorts } from "./purge-worker.js";
import type { ThreadScope } from "./types.js";

export interface BackupPurgeLedgerPort {
  putEntry(entry: DromioBackupPurgeLedgerEntryV1): Promise<void>;
  listEntries(scope: ThreadScope): Promise<readonly DromioBackupPurgeLedgerEntryV1[]>;
  putRestoreReceipt(receipt: DromioRestorePurgeReceiptV1): Promise<void>;
  listRestoreReceipts(restoreId: string): Promise<readonly DromioRestorePurgeReceiptV1[]>;
}

export class MemoryBackupPurgeLedger implements BackupPurgeLedgerPort {
  private readonly entries = new Map<string, DromioBackupPurgeLedgerEntryV1>(); private readonly receipts = new Map<string, DromioRestorePurgeReceiptV1>();
  async putEntry(entry: DromioBackupPurgeLedgerEntryV1): Promise<void> { this.entries.set(entry.id, structuredClone(entry)); }
  async listEntries(scope: ThreadScope): Promise<readonly DromioBackupPurgeLedgerEntryV1[]> { return structuredClone([...this.entries.values()].filter((entry) => entry.tenantId === scope.tenantId && entry.applicationId === scope.applicationId)); }
  async putRestoreReceipt(receipt: DromioRestorePurgeReceiptV1): Promise<void> { this.receipts.set(receipt.id, structuredClone(receipt)); }
  async listRestoreReceipts(restoreId: string): Promise<readonly DromioRestorePurgeReceiptV1[]> { return structuredClone([...this.receipts.values()].filter((receipt) => receipt.restoreId === restoreId)); }
}

export class BackupPurgeLedgerWorker {
  constructor(private readonly options: { readonly store: ThreadStore; readonly ledger: BackupPurgeLedgerPort; readonly now?: () => string }) {}
  async dispatchPending(limit = 100): Promise<number> { let count = 0; for (const entry of await this.options.store.readOutbox(limit, "governance.jobs")) { if (entry.payload.operation !== "record_backup_purge") continue; const tenantId = field(entry.payload.tenantId, "tenantId"); const applicationId = field(entry.payload.applicationId, "applicationId"); const threadId = field(entry.payload.threadId, "threadId"); const receipt = await this.options.store.getPurgeReceipt({ tenantId, applicationId }, threadId); if (!receipt || receipt.id !== field(entry.payload.purgeReceiptId, "purgeReceiptId")) throw new Error(`Backup purge receipt for ${threadId} is missing.`); if (receipt.status !== "completed") continue; const ledgerEntry: DromioBackupPurgeLedgerEntryV1 = { schemaVersion: "dromio.backup-purge-ledger-entry.v1", id: `backup_purge_${receipt.id}`, tenantId, applicationId, threadId, purgeReceipt: receipt, backupExpiresAt: field(entry.payload.backupExpiresAt, "backupExpiresAt"), recordedAt: this.options.now?.() ?? new Date().toISOString() }; await this.options.ledger.putEntry(ledgerEntry); await this.options.store.markOutboxPublished(entry.id, ledgerEntry.recordedAt); count += 1; } return count; }
}

export class RestoredBackupPurgeWorker {
  constructor(private readonly options: { readonly store: ThreadStore; readonly ledger: BackupPurgeLedgerPort; readonly ports: ThreadPurgePropagationPorts; readonly now?: () => string }) {}
  async enforce(scope: ThreadScope, restoreId: string): Promise<readonly DromioRestorePurgeReceiptV1[]> { const existing = await this.options.ledger.listRestoreReceipts(restoreId); const completed = new Set(existing.map((receipt) => receipt.ledgerEntryId)); const results = [...existing]; for (const entry of await this.options.ledger.listEntries(scope)) { if (completed.has(entry.id)) continue; const deletedResources = await this.options.store.transaction(async (tx) => { const deleted = await tx.purgeThreadData(entry.threadId); const thread = await tx.getThread(entry.threadId); if (thread) await tx.putThread({ ...thread, title: "Purged thread", status: "purged", metadata: undefined, lastItemOrdinal: 0, lastTurnOrdinal: 0, version: thread.version + 1, updatedAt: this.options.now?.() ?? new Date().toISOString() }); await tx.putPurgeReceipt(entry.purgeReceipt); return deleted; }); await propagateThreadPurge({ ...scope, threadId: entry.threadId }, this.options.ports); const receipt: DromioRestorePurgeReceiptV1 = { schemaVersion: "dromio.restore-purge-receipt.v1", id: `restore_purge_${restoreId}_${entry.purgeReceipt.id}`, restoreId, ledgerEntryId: entry.id, threadId: entry.threadId, deletedResources, propagationTargets: entry.purgeReceipt.propagationTargets, enforcedAt: this.options.now?.() ?? new Date().toISOString() }; await this.options.ledger.putRestoreReceipt(receipt); results.push(receipt); } return results; }
}

function field(value: import("@dromio/protocols").DromioJsonValue | undefined, name: string): string { if (typeof value !== "string" || !value) throw new Error(`Backup purge command is missing ${name}.`); return value; }
