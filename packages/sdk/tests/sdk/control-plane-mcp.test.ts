import { describe, expect, test } from "bun:test";
import {
  createWorkflowAppHost,
  step,
  workflow,
  workflowApp,
} from "../../src/sdk/index.js";
import {
  createWorkflowControlPlaneMcpProvider,
} from "@dromio/workflow/workflow-control-plane/mcp";
import type {
  EnqueueTriggerInput,
  TriggerDescriptor,
  TriggerJobSnapshot,
  WorkflowControlPlane,
} from "@dromio/workflow/workflow-control-plane";
import { z } from "zod";

describe("workflow control-plane MCP provider", () => {
  test("advertises a stable MCP App resource while preserving structured fallback data", async () => {
    const provider = createWorkflowControlPlaneMcpProvider({
      controlPlane: mockControlPlane(),
      toolPrefix: "dromio",
    });
    const resource = (await provider.listResources()).resources[0];
    const html = (await provider.readResource(resource!.uri)).contents[0];
    const getRun = (await provider.listTools()).tools.find((item) => item.name === "dromio.get_run");

    expect(resource).toMatchObject({
      mimeType: "text/html;profile=mcp-app",
      uri: "ui://dromio/workflow-run",
    });
    expect(getRun?._meta).toEqual({ ui: { resourceUri: "ui://dromio/workflow-run" } });
    expect(html && "text" in html ? html.text : "").toContain('method==="ui/notifications/tool-result"');
    expect(html && "text" in html ? html.text : "").toContain('call("resume_hook"');
    expect(html && "text" in html ? html.text : "").toContain('call("answer_question"');
    expect(html && "text" in html ? html.text : "").toContain('call("get_run"');
    expect(html && "text" in html ? html.text : "").toContain('id="approve"');
    expect(html && "text" in html ? html.text : "").toContain('id="reject"');
    expect(html && "text" in html ? html.text : "").toContain('aria-label="Workflow graph"');
    expect(html && "text" in html ? html.text : "").toContain('id="question-actions"');
    expect(html && "text" in html ? html.text : "").toContain("prefers-reduced-motion:reduce");
    expect(html && "text" in html ? html.text : "").toContain("handoff_requested");
    expect(html && "text" in html ? html.text : "").toContain("failed");

    const fallback = await provider.callTool("dromio.get_run", { runId: "run-mcp" });
    expect(fallback.content[0]).toMatchObject({ type: "text" });
    expect(fallback.structuredContent).toMatchObject({ run: { runId: "run-mcp" } });
  });

  test("lists workflow tools without exposing protocol discovery as a user tool", async () => {
    const controlPlane = mockControlPlane();
    const provider = createWorkflowControlPlaneMcpProvider({ controlPlane, toolPrefix: "dromio" });

    const tools = (await provider.listTools()).tools.map((tool) => tool.name);

    expect(tools).toContain("dromio.list_workflows");
    expect(tools).toContain("dromio.fire_trigger");
    expect(tools).toContain("dromio.answer_question");
    expect(tools).toContain("dromio.resume_hook");
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

  test("resumes hooks through the canonical control-plane operation", async () => {
    const resumed: Array<Record<string, unknown>> = [];
    const controlPlane = mockControlPlane({ resumed });
    const provider = createWorkflowControlPlaneMcpProvider({
      controlPlane,
      toolPrefix: "dromio",
    });

    const result = await provider.callTool("dromio.resume_hook", {
      source: { adapter: "codex", participant: "agent-7" },
      token: "hook:run-mcp:delegate:1:0:research",
      value: { report: "complete" },
    });

    expect(result.isError).not.toBe(true);
    expect(resumed).toEqual([{
      source: { adapter: "codex", participant: "agent-7" },
      token: "hook:run-mcp:delegate:1:0:research",
      value: { report: "complete" },
    }]);
    expect(result.structuredContent).toMatchObject({
      run: { runId: "run-mcp", status: "completed" },
    });
  });

  test("answers questions through the canonical control-plane operation", async () => {
    const answered: Array<{ input: { questionId: string; value: unknown }; runId: string }> = [];
    const controlPlane = mockControlPlane({ answered });
    const provider = createWorkflowControlPlaneMcpProvider({ controlPlane, toolPrefix: "dromio" });

    const result = await provider.callTool("dromio.answer_question", {
      questionId: "stage",
      runId: "run-question",
      value: "mvp",
    });

    expect(result.isError).not.toBe(true);
    expect(answered).toEqual([{
      input: { questionId: "stage", value: "mvp" },
      runId: "run-question",
    }]);
    expect(result.structuredContent).toMatchObject({
      run: { runId: "run-question", status: "completed" },
    });
  });

  test("answers a real waiting workflow question through MCP and returns the updated run", async () => {
    const askStage = step.ask({
      answer: z.enum(["prototype", "mvp", "production"]),
      id: "requirements.ask-stage",
      input: { request: z.string() },
      mapAnswer: ({ answer }) => ({ stage: answer }),
      output: { stage: z.string() },
      question: () => ({
        id: "stage",
        options: ["prototype", "mvp", "production"].map((value) => ({ label: value, value })),
        prompt: "How far should this app go?",
        type: "choice",
      }),
    });
    const askWorkflow = workflow({
      catalog: [askStage],
      document: {
        edges: [
          { id: "trigger-ask", source: "trigger", target: "ask" },
          { id: "ask-end", source: "ask", target: "end" },
        ],
        end: { id: "end", output: { stage: { jsonSchema: { type: "string" } } }, type: "result" },
        id: "requirements",
        nodes: [{ catalogItemId: askStage.id, id: "ask", kind: "question" }],
        trigger: { id: "trigger", input: { request: { jsonSchema: { type: "string" } } }, type: "manual" },
        version: 1,
      },
      input: { request: z.string() },
      output: { stage: z.string() },
    });
    const app = workflowApp({ id: "requirements-app", workflows: [askWorkflow] });
    const host = await createWorkflowAppHost(app, { storage: { kind: "memory" } });
    const provider = createWorkflowControlPlaneMcpProvider({
      controlPlane: host.controlPlane,
      toolPrefix: "dromio",
    });
    const started = await host.controlPlane.startRun({
      input: "create a todo app",
      runId: "run-answer-question-mcp",
      workflowId: "requirements",
    });

    expect(started.status).toBe("waiting");
    expect(started.pendingQuestions?.[0]).toMatchObject({
      answerSchema: { enum: ["prototype", "mvp", "production"] },
      id: "stage",
    });
    expect(started.pendingHooks?.[0]?.schema).toMatchObject({
      enum: ["prototype", "mvp", "production"],
    });
    const unknownQuestion = await provider.callTool("dromio.answer_question", {
      questionId: "missing",
      runId: started.runId,
      value: "mvp",
    });
    expect(unknownQuestion.isError).toBe(true);
    expect((await host.controlPlane.getRun(started.runId))).toMatchObject({
      pendingQuestions: [{ id: "stage" }],
      status: "waiting",
    });

    const invalid = await provider.callTool("dromio.answer_question", {
      questionId: "stage",
      runId: started.runId,
      value: "enterprise",
    });
    expect(invalid.isError).not.toBe(true);
    expect(invalid.structuredContent).toMatchObject({
      run: { pendingQuestions: [{ id: "stage" }], status: "waiting" },
    });

    const answered = await provider.callTool("dromio.answer_question", {
      questionId: "stage",
      runId: started.runId,
      value: "mvp",
    });

    expect(answered.isError).not.toBe(true);
    expect(answered.structuredContent).toMatchObject({
      run: {
        runId: started.runId,
        state: { stage: "mvp" },
        status: "completed",
      },
    });
    const unknown = await provider.callTool("dromio.answer_question", {
      questionId: "stage",
      runId: "run-unknown",
      value: "mvp",
    });
    expect(unknown.isError).toBe(true);
  });

  test("resumes hooks through Streamable HTTP JSON-RPC", async () => {
    const resumed: Array<Record<string, unknown>> = [];
    const provider = createWorkflowControlPlaneMcpProvider({
      controlPlane: mockControlPlane({ resumed }),
      toolPrefix: "dromio",
    });
    const response = await provider.fetch(new Request("http://local/mcp", {
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: {
            token: "hook:run-http-mcp:delegate:1:0:research",
            value: { report: "complete over HTTP" },
          },
          name: "dromio.resume_hook",
        },
      }),
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      method: "POST",
    }));
    const body = await response.json() as {
      result?: { structuredContent?: { run?: { status?: string } } };
    };

    expect(response.status).toBe(200);
    expect(resumed).toEqual([{
      token: "hook:run-http-mcp:delegate:1:0:research",
      value: { report: "complete over HTTP" },
    }]);
    expect(body.result?.structuredContent?.run?.status).toBe("completed");
  });

  test("serves the MCP App resource through Streamable HTTP", async () => {
    const provider = createWorkflowControlPlaneMcpProvider({
      controlPlane: mockControlPlane(),
      toolPrefix: "dromio",
    });
    const response = await provider.fetch(new Request("http://local/mcp", {
      body: JSON.stringify({
        id: 2,
        jsonrpc: "2.0",
        method: "resources/read",
        params: { uri: "ui://dromio/workflow-run" },
      }),
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      method: "POST",
    }));
    const body = await response.json() as {
      result?: { contents?: Array<{ mimeType?: string; text?: string }> };
    };

    expect(response.status).toBe(200);
    expect(body.result?.contents?.[0]).toMatchObject({
      mimeType: "text/html;profile=mcp-app",
    });
    expect(body.result?.contents?.[0]?.text).toContain("Dromio workflow run");
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

function mockControlPlane(input: {
  answered?: Array<{ input: { questionId: string; value: unknown }; runId: string }>;
  enqueued?: EnqueueTriggerInput[];
  resumed?: Array<Record<string, unknown>>;
} = {}): WorkflowControlPlane {
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
    async answerQuestion(runId: string, answerInput: { questionId: string; value: unknown }) {
      input.answered?.push({ input: answerInput, runId });
      return {
        events: [],
        input: {},
        origin: { type: "mcp" },
        runId,
        status: "completed",
        workflowId: "planner",
      };
    },
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
    async getWorkflow(id: string) {
      return { description: "Plan things.", id, title: "Planner" };
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
    async resumeHook(resumeInput: {
      source?: { adapter?: string; participant?: string };
      token: string;
      value: unknown;
    }) {
      input.resumed?.push(resumeInput);
      return {
        events: [],
        input: {},
        origin: { type: "mcp" },
        runId: resumeInput.token.split(":")[1] ?? "run-mcp",
        status: "completed",
        workflowId: "planner",
      };
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
