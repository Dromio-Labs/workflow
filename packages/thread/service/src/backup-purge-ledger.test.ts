import { expect, test } from "bun:test";
import type { DromioActorContextV1 } from "@dromio/protocols";
import { BackupPurgeLedgerWorker, MemoryBackupPurgeLedger, RestoredBackupPurgeWorker } from "./backup-purge-ledger.js";
import { MemoryThreadStore } from "./memory-store.js";
import { ThreadService } from "./service.js";
import { ThreadPurgePropagationWorker } from "./purge-worker.js";

const actor: DromioActorContextV1 = { schemaVersion: "dromio.actor-context.v1", subject: { type: "user", id: "owner" }, tenantId: "tenant-1", applicationId: "app-1", roles: ["owner"], groupIds: [] };
const clock = { now: () => "2026-01-01T00:00:00.000Z" };

function fixture(store: MemoryThreadStore) { let next = 0; return new ThreadService({ store, clock, ids: { create: (kind) => `${kind}-${++next}` } }); }

test("external purge ledger re-enforces erasure when a backup is restored", async () => {
  const authoritativeStore = new MemoryThreadStore(); const restoredStore = new MemoryThreadStore();
  const authoritative = fixture(authoritativeStore); const restored = fixture(restoredStore);
  const first = (await authoritative.createThread({ actor, commandId: "create" }, { title: "Sensitive" })).resource;
  const backup = (await restored.createThread({ actor, commandId: "create" }, { title: "Sensitive" })).resource;
  expect(backup.id).toBe(first.id);
  await authoritative.createTurn({ actor, commandId: "send" }, { threadId: first.id, content: [{ type: "text", text: "erase me" }] });
  await restored.createTurn({ actor, commandId: "send" }, { threadId: backup.id, content: [{ type: "text", text: "erase me" }] });
  await authoritative.setRetentionPolicy({ actor, commandId: "retention" }, { retainForDays: 90, backupRetentionDays: 14 });
  const purge = (await authoritative.purgeThread({ actor, commandId: "purge" }, first.id)).resource;

  const ledger = new MemoryBackupPurgeLedger();
  const recorder = new BackupPurgeLedgerWorker({ store: authoritativeStore, ledger, now: () => "2026-01-01T00:00:01.000Z" });
  expect(await recorder.dispatchPending()).toBe(0);
  expect(await new ThreadPurgePropagationWorker({ store: authoritativeStore, ports: {} }).dispatchPending()).toBe(1);
  expect(await recorder.dispatchPending()).toBe(1); expect(await recorder.dispatchPending()).toBe(0);
  expect(await ledger.listEntries(actor)).toMatchObject([{ threadId: first.id, purgeReceipt: { id: purge.id }, backupExpiresAt: "2026-01-15T00:00:00.000Z" }]);

  const calls: string[] = []; const enforcer = new RestoredBackupPurgeWorker({ store: restoredStore, ledger, now: () => "2026-01-02T00:00:00.000Z", ports: { context: { purgeThread: async () => { calls.push("context"); } }, search: { purgeThread: async () => { calls.push("search"); } }, files: { purgeThread: async () => { calls.push("files"); } }, execution: { purgeThread: async () => { calls.push("execution"); } }, cache: { purgeThread: async () => { calls.push("cache"); } } } });
  const receipts = await enforcer.enforce(actor, "restore-1");
  expect(receipts).toMatchObject([{ restoreId: "restore-1", threadId: first.id, ledgerEntryId: `backup_purge_${purge.id}` }]);
  expect((await restored.getThread({ actor, commandId: "read" }, first.id)).thread.status).toBe("purged");
  expect((await restored.getThread({ actor, commandId: "read-again" }, first.id)).items).toEqual([]);
  expect(calls.sort()).toEqual(["cache", "context", "execution", "files", "search"]);
  expect(await enforcer.enforce(actor, "restore-1")).toEqual(receipts); expect(calls).toHaveLength(5);
});
