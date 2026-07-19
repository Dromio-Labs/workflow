import { expect, test } from "bun:test";
import { ExecutionService, MemoryExecutionStore } from "@dromio/execution";
import { MemoryTriggerStore, TriggerService } from "@dromio/trigger";
import { CanonicalTriggerExecutionFacade } from "../../src/sdk/workflow-control-plane/canonical-trigger-facade.js";

test("SDK trigger compatibility facade delegates jobs to canonical Trigger and Execution", async () => {
  const execution = new ExecutionService({ store: new MemoryExecutionStore() }); const triggers = new TriggerService({ store: new MemoryTriggerStore(), execution }); const descriptor = { id: "manual", label: "Manual", enabled: true, type: "manual" as const, workflowId: "workflow-1" }; const facade = new CanonicalTriggerExecutionFacade({ tenantId: "tenant-1", applicationId: "app-1", triggers, execution, getTrigger: async () => descriptor });
  const queued = await facade.enqueue({ triggerId: "manual", idempotencyKey: "once", input: { value: 1 }, trusted: true }); expect(queued.created).toBe(true); expect((await facade.enqueue({ triggerId: "manual", idempotencyKey: "once", input: { value: 1 }, trusted: true })).created).toBe(false); const claimed = await facade.claim("worker-1", 30_000); expect(claimed?.id).toBe(queued.job.id); expect((await facade.complete(queued.job.id, "workflow-run-1")).runId).toBe("workflow-run-1"); expect(await execution.listRuns()).toHaveLength(1);
});
