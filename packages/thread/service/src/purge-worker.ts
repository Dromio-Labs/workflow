import type { DromioActorContextV1, DromioJsonObject, DromioPurgeReceiptV1 } from "@dromio/protocols";
import type { ThreadStore } from "./ports.js";
import type { ThreadService } from "./service.js";

export interface ThreadPurgePropagationPorts {
  readonly context?: { purgeThread(threadId: string): Promise<PurgeResult> };
  readonly search?: { purgeThread(tenantId: string, applicationId: string, threadId: string): Promise<PurgeResult> };
  readonly files?: { purgeThread(context: { readonly actor: DromioActorContextV1 }, threadId: string): Promise<PurgeResult> };
  readonly execution?: { purgeThread(threadId: string): Promise<PurgeResult> };
  readonly cache?: { purgeThread(tenantId: string, applicationId: string, threadId: string): Promise<PurgeResult> };
}
type PurgeResult = void | number | Readonly<Record<string, number>>;
export class ThreadPurgePropagationWorker {
  constructor(private readonly options: { readonly store: ThreadStore; readonly ports: ThreadPurgePropagationPorts; readonly service?: ThreadService; readonly now?: () => string }) {}
  async dispatchPending(limit = 100): Promise<number> { let count = 0; for (const entry of await this.options.store.readOutbox(limit, "governance.jobs")) { if (entry.payload.operation === "request_thread_purge" && this.options.service) await this.requestPurge(entry.id, entry.payload); else if (entry.payload.operation === "propagate_thread_purge") await this.propagate(entry.payload); else continue; await this.options.store.markOutboxPublished(entry.id, this.options.now?.() ?? new Date().toISOString()); count += 1; } return count; }
  private async requestPurge(commandId: string, payload: DromioJsonObject): Promise<void> { const service = this.options.service; if (!service) throw new Error("Thread purge service is unavailable."); const actor = purgeActor(payload); await service.purgeThread({ actor, commandId, idempotencyKey: commandId }, field(payload.threadId, "threadId")); }
  private async propagate(payload: DromioJsonObject): Promise<void> {
    const scope = { tenantId: field(payload.tenantId, "tenantId"), applicationId: field(payload.applicationId, "applicationId"), threadId: field(payload.threadId, "threadId") };
    const receiptId = field(payload.purgeReceiptId, "purgeReceiptId");
    let receipt = await this.options.store.getPurgeReceipt(scope, scope.threadId);
    if (!receipt || receipt.id !== receiptId) throw new Error(`Purge receipt ${receiptId} is missing.`);
    for (const target of receipt.propagationTargets) {
      const current = receipt.propagation[target];
      if (current?.status === "completed" || current?.status === "not_configured") continue;
      const operation = purgeOperation(target, scope, this.options.ports);
      if (!operation) {
        receipt = await this.updateReceipt(receipt, target, { status: "not_configured", completedAt: this.now() });
        continue;
      }
      try {
        const result = await operation();
        receipt = await this.updateReceipt(receipt, target, { status: "completed", completedAt: this.now(), ...(counts(result) ? { deletedResources: counts(result) } : {}) });
      } catch (error) {
        await this.updateReceipt(receipt, target, { status: "failed", errorCode: error instanceof Error ? error.name : "purge_failed" });
        throw error;
      }
    }
  }

  private async updateReceipt(receipt: DromioPurgeReceiptV1, target: string, state: DromioPurgeReceiptV1["propagation"][string]): Promise<DromioPurgeReceiptV1> {
    const propagation = { ...receipt.propagation, [target]: state };
    const complete = receipt.propagationTargets.every((name) => propagation[name]?.status === "completed" || propagation[name]?.status === "not_configured");
    const updated: DromioPurgeReceiptV1 = { ...receipt, propagation, status: complete ? "completed" : "pending", ...(complete ? { completedAt: this.now() } : {}) };
    await this.options.store.transaction(async (tx) => { await tx.putPurgeReceipt(updated); });
    return updated;
  }

  private now(): string { return this.options.now?.() ?? new Date().toISOString(); }
}
export async function propagateThreadPurge(scope: { readonly tenantId: string; readonly applicationId: string; readonly threadId: string }, ports: ThreadPurgePropagationPorts): Promise<void> { const actor: DromioActorContextV1 = { schemaVersion: "dromio.actor-context.v1", subject: { type: "system", id: "thread-purge-worker" }, tenantId: scope.tenantId, applicationId: scope.applicationId, roles: ["system"], groupIds: [] }; await Promise.all([ports.context?.purgeThread(scope.threadId), ports.search?.purgeThread(scope.tenantId, scope.applicationId, scope.threadId), ports.files?.purgeThread({ actor }, scope.threadId), ports.execution?.purgeThread(scope.threadId), ports.cache?.purgeThread(scope.tenantId, scope.applicationId, scope.threadId)]); }
function field(value: import("@dromio/protocols").DromioJsonValue | undefined, name: string): string { if (typeof value !== "string" || !value) throw new Error(`Purge command is missing ${name}.`); return value; }
function purgeActor(payload: DromioJsonObject): DromioActorContextV1 { return { schemaVersion: "dromio.actor-context.v1", subject: { type: "system", id: "thread-purge-worker" }, tenantId: field(payload.tenantId, "tenantId"), applicationId: field(payload.applicationId, "applicationId"), roles: ["system"], groupIds: [] }; }

function purgeOperation(target: string, scope: { readonly tenantId: string; readonly applicationId: string; readonly threadId: string }, ports: ThreadPurgePropagationPorts): (() => Promise<PurgeResult>) | undefined {
  const actor: DromioActorContextV1 = { schemaVersion: "dromio.actor-context.v1", subject: { type: "system", id: "thread-purge-worker" }, tenantId: scope.tenantId, applicationId: scope.applicationId, roles: ["system"], groupIds: [] };
  if (target === "context" && ports.context) return () => ports.context!.purgeThread(scope.threadId);
  if (target === "search" && ports.search) return () => ports.search!.purgeThread(scope.tenantId, scope.applicationId, scope.threadId);
  if (target === "files" && ports.files) return () => ports.files!.purgeThread({ actor }, scope.threadId);
  if (target === "execution" && ports.execution) return () => ports.execution!.purgeThread(scope.threadId);
  if (target === "cache" && ports.cache) return () => ports.cache!.purgeThread(scope.tenantId, scope.applicationId, scope.threadId);
  return undefined;
}

function counts(result: PurgeResult): Readonly<Record<string, number>> | undefined {
  if (typeof result === "number") return { deleted: result };
  return result && typeof result === "object" ? result : undefined;
}
