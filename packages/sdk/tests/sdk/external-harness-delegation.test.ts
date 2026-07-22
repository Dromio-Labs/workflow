import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createWorkflowAppHost,
  step,
  workflow,
  workflowApp,
} from "../../src/sdk/index.js";
import {
  createWorkflowAppRuntime,
  type WorkflowAppThreadEventEmitInput,
} from "@dromio/workflow/app";
import {
  createWorkflowControlPlaneMcpProvider,
} from "@dromio/workflow/workflow-control-plane/mcp";
import { fail } from "@dromio/workflow/core";
import { z } from "zod";

describe("external harness delegation", () => {
  test("completes the workflow app lifecycle through control-plane MCP", async () => {
    const executions = { prepare: 0, publish: 0 };
    const app = delegatedApp(executions);
    const emitted: WorkflowAppThreadEventEmitInput[] = [];
    const runtime = createWorkflowAppRuntime(app, {
      threadEvents: { emit: (event) => emitted.push(event) },
    });
    const host = await createWorkflowAppHost(app, {
      runtime,
      storage: { kind: "memory" },
    });
    const mcp = createWorkflowControlPlaneMcpProvider({
      controlPlane: host.controlPlane,
      toolPrefix: "dromio",
    });

    const started = await host.controlPlane.startRun({
      input: "durable workflows",
      origin: { threadId: "thread-delegation", type: "manual" },
      runId: "run-delegation-mcp",
      workflowId: "delegated-content",
    });
    const hook = started.pendingHooks?.[0];

    expect(started.status).toBe("waiting");
    expect(hook).toMatchObject({
      input: {
        attempt: 1,
        capabilities: ["browser", "search"],
        context: { brief: "prepared:durable workflows" },
        instructions: "Research prepared:durable workflows",
        outputSchema: {
          required: ["report"],
          type: "object",
        },
        runId: "run-delegation-mcp",
        stepId: "research",
        workflowId: "delegated-content",
      },
      kind: "handoff_requested",
      title: "External research",
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.event).toMatchObject({
      interactions: [{
        id: "content.research",
        kind: "handoff_requested",
        summary: "Research prepared:durable workflows",
        title: "External research",
        token: hook?.token,
      }],
      runId: "run-delegation-mcp",
      type: "run.suspended",
    });

    await host.runtime.hydrateRun?.(started);
    expect(emitted).toHaveLength(1);

    const invalid = await mcp.callTool("dromio.resume_hook", {
      token: hook?.token,
      value: { report: 42 },
    });
    expect(invalid.isError).toBe(true);
    expect(invalid.structuredContent).toMatchObject({
      code: "HOOK_OUTPUT_VALIDATION_FAILED",
      error: expect.stringContaining("output does not match its schema"),
    });
    const afterInvalid = await host.controlPlane.getRun(started.runId);
    expect(afterInvalid.status).toBe("waiting");
    expect(afterInvalid.pendingHooks?.[0]?.token).toBe(hook?.token);
    expect(afterInvalid.durable?.consumedHookTokens).not.toContain(hook?.token);

    const unknown = await mcp.callTool("dromio.resume_hook", {
      token: `${hook?.token}_unknown`,
      value: { report: "ignored" },
    });
    expect(unknown.isError).toBe(true);
    expect(unknown.structuredContent).toMatchObject({
      code: "HOOK_NOT_FOUND",
      error: expect.stringContaining("Hook token not found"),
    });

    const completed = await mcp.callTool("dromio.resume_hook", {
      source: { adapter: "codex", participant: "researcher" },
      token: hook?.token,
      value: { report: "validated report" },
    });
    expect(completed.isError).not.toBe(true);
    expect(completed.structuredContent).toMatchObject({
      run: {
        runId: started.runId,
        state: {
          brief: "prepared:durable workflows",
          report: "validated report",
          result: "published:validated report",
        },
        status: "completed",
      },
    });
    const completedRun = (completed.structuredContent as {
      run: { events: Array<{ detail?: unknown; stepId?: string; type: string }> };
    }).run;
    expect(completedRun.events.filter((event) =>
      event.type === "step.completed" && event.stepId === "prepare"
    )).toHaveLength(1);
    expect(completedRun.events.find((event) => event.type === "hook.resumed")?.detail)
      .toMatchObject({ source: { adapter: "codex", participant: "researcher" } });
    expect(executions).toEqual({ prepare: 1, publish: 1 });

    const duplicate = await mcp.callTool("dromio.resume_hook", {
      token: hook?.token,
      value: { report: "validated report" },
    });
    expect(duplicate.isError).not.toBe(true);
    expect(duplicate.structuredContent).toMatchObject({
      run: { status: "completed" },
    });
    expect(executions).toEqual({ prepare: 1, publish: 1 });
  });

  test("hydrates the same durable handoff and resumes without replay", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-delegation-restart-"));
    const dbPath = path.join(directory, "runtime.sqlite");
    const executions = { prepare: 0, publish: 0 };

    try {
      const phaseAApp = delegatedApp(executions);
      const phaseA = await createWorkflowAppHost(phaseAApp, {
        storage: { kind: "sqlite", path: dbPath },
      });
      const started = await phaseA.controlPlane.startRun({
        input: "restart",
        runId: "run-delegation-restart",
        workflowId: "delegated-content",
      });
      const token = started.pendingHooks?.[0]?.token ?? "";

      const phaseBApp = delegatedApp(executions);
      const phaseB = await createWorkflowAppHost(phaseBApp, {
        storage: { kind: "sqlite", path: dbPath },
      });
      const restored = await phaseB.controlPlane.getRun(started.runId);
      const mcp = createWorkflowControlPlaneMcpProvider({
        controlPlane: phaseB.controlPlane,
        toolPrefix: "dromio",
      });
      const completed = await mcp.callTool("dromio.resume_hook", {
        token,
        value: { report: "after restart" },
      });

      expect(restored.status).toBe("waiting");
      expect(restored.pendingHooks?.[0]?.token).toBe(token);
      expect(restored.pendingHooks?.[0]?.input).toMatchObject({
        instructions: "Research prepared:restart",
        runId: "run-delegation-restart",
      });
      expect(completed.isError).not.toBe(true);
      expect(completed.structuredContent).toMatchObject({
        run: {
          state: { result: "published:after restart" },
          status: "completed",
        },
      });
      expect(executions).toEqual({ prepare: 1, publish: 1 });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("resumes a delegated child workflow through control-plane MCP", async () => {
    const app = delegatedChildApp();
    const host = await createWorkflowAppHost(app, {
      storage: { kind: "memory" },
    });
    const mcp = createWorkflowControlPlaneMcpProvider({
      controlPlane: host.controlPlane,
      toolPrefix: "dromio",
    });
    const started = await host.controlPlane.startRun({
      input: "Investigate child identity",
      runId: "run-child-delegation-mcp",
      workflowId: "delegated-parent-app",
    });
    const hook = started.pendingHooks?.[0];

    expect(started.status).toBe("waiting");
    expect(hook?.token).toStartWith("hook:run-child-delegation-mcp:child:child:");
    expect(hook?.input).toMatchObject({
      instructions: "Investigate child identity",
      stepId: "delegate",
      workflowId: "delegated-child-app",
    });
    expect((hook?.input as { runId?: string }).runId).not.toBe(started.runId);

    const completed = await mcp.callTool("dromio.resume_hook", {
      token: hook?.token,
      value: { report: "child result through MCP" },
    });

    expect(completed.isError).not.toBe(true);
    expect(completed.structuredContent).toMatchObject({
      run: {
        runId: "run-child-delegation-mcp",
        state: { report: "child result through MCP" },
        status: "completed",
      },
    });
  });

  test("distinguishes valid handoff completion from downstream workflow failure", async () => {
    const executions = { prepare: 0, publish: 0 };
    const app = delegatedApp(executions, { failPublish: true });
    const host = await createWorkflowAppHost(app, {
      storage: { kind: "memory" },
    });
    const mcp = createWorkflowControlPlaneMcpProvider({
      controlPlane: host.controlPlane,
      toolPrefix: "dromio",
    });
    const started = await host.controlPlane.startRun({
      input: "failure boundary",
      runId: "run-delegation-downstream-failure",
      workflowId: "delegated-content",
    });

    const result = await mcp.callTool("dromio.resume_hook", {
      token: started.pendingHooks?.[0]?.token,
      value: { report: "valid delegated output" },
    });
    const run = (result.structuredContent as {
      run?: { events?: Array<{ detail?: unknown; stepId?: string; type: string }>; status?: string };
    }).run;

    expect(result.isError).not.toBe(true);
    expect(run?.status).toBe("failed");
    expect(run?.events?.find((event) =>
      event.type === "step.failed" && event.stepId === "publish"
    )?.detail).toEqual({ error: "Publishing failed after delegation." });
    expect(run?.events?.some((event) => event.type === "hook.resumed")).toBe(true);
    expect(executions).toEqual({ prepare: 1, publish: 1 });
  });
});

function delegatedChildApp() {
  const delegate = step.delegate({
    id: "child.delegate",
    input: { request: z.string() },
    instructions: ({ input }) => input.request,
    output: { report: z.string() },
  });
  const child = workflow({
    catalog: [delegate],
    document: {
      edges: [
        { id: "trigger-delegate", source: "trigger", target: "delegate" },
        { id: "delegate-end", source: "delegate", target: "end" },
      ],
      end: { id: "end", output: { report: { jsonSchema: { type: "string" } } }, type: "result" },
      id: "delegated-child-app",
      nodes: [{ catalogItemId: delegate.id, id: "delegate" }],
      trigger: { id: "trigger", input: { request: { jsonSchema: { type: "string" } } }, type: "manual" },
      version: 1,
    },
    input: { request: z.string() },
    output: { report: z.string() },
  });
  const nested = step.workflow({ id: "parent.child", workflow: child });
  const parent = workflow({
    catalog: [nested],
    document: {
      edges: [
        { id: "trigger-child", source: "trigger", target: "child" },
        { id: "child-end", source: "child", target: "end" },
      ],
      end: { id: "end", output: { report: { jsonSchema: { type: "string" } } }, type: "result" },
      id: "delegated-parent-app",
      nodes: [{ catalogItemId: nested.id, id: "child" }],
      trigger: { id: "trigger", input: { request: { jsonSchema: { type: "string" } } }, type: "manual" },
      version: 1,
    },
    input: { request: z.string() },
    output: { report: z.string() },
  });
  return workflowApp({ id: "delegated-child-test-app", workflows: [parent] });
}

function delegatedApp(
  executions: { prepare: number; publish: number },
  options: { failPublish?: boolean } = {},
) {
  const prepare = step({
    id: "content.prepare",
    input: { prompt: z.string() },
    output: { brief: z.string() },
    run({ input }) {
      executions.prepare += 1;
      return { brief: `prepared:${input.prompt}` };
    },
  });
  const research = step.delegate({
    capabilities: ["browser", "search"],
    context: ({ input }) => ({ brief: input.brief }),
    id: "content.research",
    input: { brief: z.string() },
    instructions: ({ input }) => `Research ${input.brief}`,
    output: { report: z.string().min(3) },
    summary: ({ input }) => `Research ${input.brief}`,
    title: "External research",
  });
  const publish = step({
    id: "content.publish",
    input: { report: z.string() },
    output: { result: z.string() },
    run({ input }) {
      executions.publish += 1;
      if (options.failPublish) return fail("Publishing failed after delegation.");
      return { result: `published:${input.report}` };
    },
  });
  const delegatedWorkflow = workflow({
    catalog: [prepare, research, publish],
    document: {
      edges: [
        { id: "trigger-prepare", source: "trigger", target: "prepare" },
        { id: "prepare-research", source: "prepare", target: "research" },
        { id: "research-publish", source: "research", target: "publish" },
        { id: "publish-end", source: "publish", target: "end" },
      ],
      end: { id: "end", output: { result: { jsonSchema: { type: "string" } } }, type: "result" },
      id: "delegated-content",
      nodes: [
        { catalogItemId: prepare.id, id: "prepare" },
        { catalogItemId: research.id, id: "research" },
        { catalogItemId: publish.id, id: "publish" },
      ],
      trigger: { id: "trigger", input: { prompt: { jsonSchema: { type: "string" } } }, type: "manual" },
      version: 1,
    },
    input: { prompt: z.string() },
    output: { result: z.string() },
  });
  return workflowApp({
    id: "delegation-app",
    workflows: [delegatedWorkflow],
  });
}
