import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { unlink } from "node:fs/promises";
import { SqliteTriggerStore } from "./sqlite-store.js";
import { TriggerService } from "./service.js";

test("SQLite trigger definitions and occurrence receipts survive restart", async () => {
  const file = `/tmp/dromio-trigger-${crypto.randomUUID()}.sqlite`; const firstDb = new Database(file); const first = new TriggerService({ store: new SqliteTriggerStore(firstDb), execution: { enqueue: async () => ({ id: "run-1" }) }, now: () => "2026-01-01T00:00:00Z" });
  await first.define({ id: "manual-1", tenantId: "tenant-1", applicationId: "app-1", type: "manual", enabled: true, target: { sourceType: "task", sourceIdTemplate: "{taskId}" }, config: {} }); const input = { triggerId: "manual-1", type: "manual" as const, tenantId: "tenant-1", applicationId: "app-1", idempotencyKey: "once", payload: { taskId: "task-1" } }; await first.occur(input); firstDb.close();
  const secondDb = new Database(file); const second = new TriggerService({ store: new SqliteTriggerStore(secondDb), execution: { enqueue: async () => { throw new Error("must not enqueue replay"); } } }); expect((await second.occur(input)).replayed).toBe(true); secondDb.close(); await unlink(file);
});
