import { describe, expect, test } from "bun:test";
import {
  createWorkflowControlPlaneMcpProvider,
} from "@dromio/workflow/workflow-control-plane/mcp";
import type {
  EnqueueTriggerInput,
  TriggerDescriptor,
  TriggerJobSnapshot,
  WorkflowControlPlane,
} from "@dromio/workflow/workflow-control-plane";

describe("workflow control-plane MCP provider", () => {
  test("lists workflow tools without exposing protocol discovery as a user tool", async () => {
    const controlPlane = mockControlPlane();
    const provider = createWorkflowControlPlaneMcpProvider({ controlPlane, toolPrefix: "dromio" });

    const tools = (await provider.listTools()).tools.map((tool) => tool.name);

    expect(tools).toContain("dromio.list_workflows");
    expect(tools).toContain("dromio.fire_trigger");
    expect(tools).toContain("dromio.trigger.process-images.request");
    expect(tools).not.toContain("tools/list");
  });

  test("enqueues trigger-specific tools through the shared control plane", async () => {
    const enqueued: EnqueueTriggerInput[] = [];
    const controlPlane = mockControlPlane({ enqueued });
    const provider = createWorkflowControlPlaneMcpProvider({ controlPlane, toolPrefix: "dromio" });

    const result = await provider.callTool("dromio.trigger.process-images.request", {
      dryRun: true,
      rootDir: ".",
    });

    expect(result.isError).not.toBe(true);
    expect(enqueued[0]).toMatchObject({
      input: {
        dryRun: true,
        rootDir: ".",
      },
      source: "mcp",
      triggerId: "process-images.request",
      trusted: true,
    });
    expect(result.structuredContent).toMatchObject({
      created: true,
      job: {
        status: "queued",
        triggerId: "process-images.request",
      },
    });
  });

  test("supports a generic fire_trigger tool with idempotency", async () => {
    const enqueued: EnqueueTriggerInput[] = [];
    const controlPlane = mockControlPlane({ enqueued });
    const provider = createWorkflowControlPlaneMcpProvider({
      auth: {
        bearerToken: "token",
        trusted: false,
      },
      controlPlane,
      toolPrefix: "dromio",
    });

    await provider.callTool("dromio.fire_trigger", {
      idempotencyKey: "mcp-1",
      input: { prompt: "hello" },
      triggerId: "planner.request",
    });

    expect(enqueued[0]).toMatchObject({
      bearerToken: "token",
      idempotencyKey: "mcp-1",
      input: { prompt: "hello" },
      source: "mcp",
      triggerId: "planner.request",
      trusted: false,
    });
  });

  test("allows app-owned extra tools beside workflow tools", async () => {
    const controlPlane = mockControlPlane();
    const provider = createWorkflowControlPlaneMcpProvider({
      controlPlane,
      extraTools: [{
        description: "Check runtime prerequisites.",
        handler: () => ({ ok: true }),
        name: "dromio.doctor",
        readOnly: true,
      }],
      toolPrefix: "dromio",
    });

    const tools = (await provider.listTools()).tools.map((tool) => tool.name);
    const result = await provider.callTool("dromio.doctor");

    expect(tools).toContain("dromio.doctor");
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ ok: true });
  });
});

function mockControlPlane(input: { enqueued?: EnqueueTriggerInput[] } = {}): WorkflowControlPlane {
  const triggers: TriggerDescriptor[] = [{
    enabled: true,
    id: "process-images.request",
    input: {
      contentType: "application/json",
      jsonSchema: {
        properties: {
          dryRun: { type: "boolean" },
          rootDir: { type: "string" },
        },
        required: ["rootDir"],
        type: "object",
      },
      mode: "body",
    },
    label: "Process Images",
    type: "http",
    workflowId: "process-images",
  }, {
    enabled: true,
    id: "planner.request",
    label: "Planner",
    type: "http",
    workflowId: "planner",
  }];

  return {
    async enqueueTrigger(enqueueInput: EnqueueTriggerInput) {
      input.enqueued?.push(enqueueInput);
      return {
        created: true,
        job: triggerJob(enqueueInput.triggerId, enqueueInput.input),
      };
    },
    async getRun(runId: string) {
      return { events: [], input: {}, origin: { type: "mcp" }, runId, status: "completed", workflowId: "planner" };
    },
    async getTrigger(id: string) {
      return triggers.find((trigger) => trigger.id === id)!;
    },
    async getTriggerJob(id: string) {
      return triggerJob("process-images.request", {}, id);
    },
    async listRuns() {
      return [];
    },
    async listTriggerJobs() {
      return [];
    },
    async listTriggers() {
      return triggers;
    },
    async listWorkflows() {
      return [{ description: "Plan things.", id: "planner", title: "Planner" }];
    },
  } as unknown as WorkflowControlPlane;
}

function triggerJob(triggerId: string, payloadInput: unknown, id = "job_mcp"): TriggerJobSnapshot {
  return {
    attempts: 0,
    availableAt: "2026-05-10T00:00:00.000Z",
    createdAt: "2026-05-10T00:00:00.000Z",
    id,
    kind: "trigger",
    maxAttempts: 3,
    occurrenceId: "occ_mcp",
    payload: {
      input: payloadInput,
      source: "mcp",
    },
    status: "queued",
    triggerId,
    updatedAt: "2026-05-10T00:00:00.000Z",
    workflowId: triggerId.split(".")[0] ?? triggerId,
  };
}
