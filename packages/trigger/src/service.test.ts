import { describe, expect, test } from "bun:test";
import { TriggerService } from "./service.js";
import { MemoryTriggerStore } from "./types.js";

describe("TriggerService", () => {
  test("maps an occurrence to one idempotent execution run", async () => {
    const store = new MemoryTriggerStore();
    const enqueues: object[] = [];
    const service = new TriggerService({
      store,
      execution: { enqueue: async (input) => { enqueues.push(input); return { id: "run-1" }; } },
      now: () => "2026-01-01T00:00:00Z",
      createId: () => "occurrence-1",
    });
    await service.define({
      id: "chat-default",
      tenantId: "tenant-1",
      applicationId: "app-1",
      type: "chat",
      enabled: true,
      target: { sourceType: "thread_turn", sourceIdTemplate: "{turnId}", concurrencyKeyTemplate: "{threadId}" },
      config: {},
    });

    const input = { triggerId: "chat-default", type: "chat" as const, tenantId: "tenant-1", applicationId: "app-1", idempotencyKey: "turn-1", payload: { threadId: "thread-1", turnId: "turn-1" } };
    expect((await service.occur(input)).runId).toBe("run-1");
    expect((await service.occur(input)).replayed).toBe(true);
    expect(enqueues).toHaveLength(1);
  });

  test("rejects disabled and mismatched sources", async () => {
    const store = new MemoryTriggerStore();
    const service = new TriggerService({ store, execution: { enqueue: async () => ({ id: "run-1" }) } });
    await service.define({ id: "schedule-1", tenantId: "tenant-1", applicationId: "app-1", type: "schedule", enabled: false, target: { sourceType: "workflow", sourceIdTemplate: "workflow-1" }, config: {} });
    expect(service.occur({ triggerId: "schedule-1", type: "schedule", tenantId: "tenant-1", applicationId: "app-1", idempotencyKey: "tick-1", correlationId: "correlation-1", requestId: "request-1", commandId: "command-1", payload: {} })).rejects.toMatchObject({ code: "disabled" });
  });
});
