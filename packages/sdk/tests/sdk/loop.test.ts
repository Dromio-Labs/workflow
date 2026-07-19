import { describe, expect, test } from "bun:test";
import { z } from "zod";

import {
  InMemoryLoopStore,
  ask,
  commandEvent,
  createAiRuntimeStep,
  createHook,
  done,
  goto,
  loop,
  projectLoopGraph,
  retry,
  createContractedRuntimeStep,
  createRuntimeStep,
  workerItemEvent,
} from "@dromio/workflow/core";

describe("loop event log", () => {
  test("creates generic command run events", () => {
    expect(commandEvent({
      command: "bun run check",
      commandId: "check:bun-run-check",
      durationMs: 42,
      exitCode: 0,
      output: "ok",
      title: "Run bun run check",
      type: "command.completed",
    })).toMatchObject({
      command: "bun run check",
      commandId: "check:bun-run-check",
      durationMs: 42,
      exitCode: 0,
      message: "Ran bun run check.",
      output: "ok",
      title: "Run bun run check",
      type: "command.completed",
    });
  });

  test("adds run identity, monotonic indexes, step correlation, and step metadata", async () => {
    const observedStepMetadata: unknown[] = [];
    const app = loop<unknown, string>({
      id: "test.loop",
      steps: [
        createRuntimeStep("inspect", (context) => {
          observedStepMetadata.push(context.step);
          context.emit({
            message: "Custom event.",
            type: "custom.event",
          });
          return done({ ok: true });
        }),
      ],
    });

    const session = await app.start("input", { runId: "run_test" });

    expect(session.runId).toBe("run_test");
    expect(session.events.map((event) => event.index)).toEqual(
      session.events.map((_, index) => index),
    );
    expect(session.events.every((event) => event.runId === "run_test")).toBe(true);
    expect(session.events.every((event) => event.correlationId.length > 0)).toBe(true);
    expect(session.events[0]?.type).toBe("run.started");
    expect(session.events.at(-1)?.type).toBe("run.completed");

    const stepStarted = session.events.find((event) => event.type === "step.started");
    const custom = session.events.find((event) => event.type === "custom.event");
    expect(stepStarted).toMatchObject({
      attempt: 1,
      correlationId: "run:run_test:step:inspect:attempt:1",
      stepId: "inspect",
    });
    expect(custom).toMatchObject({
      attempt: 1,
      correlationId: "run:run_test:step:inspect:attempt:1",
    });
    expect(custom && "stepId" in custom).toBe(false);
    expect(observedStepMetadata).toEqual([
      {
        attempt: 1,
        correlationId: "run:run_test:step:inspect:attempt:1",
        id: "inspect",
        idempotencyKey: "run_test:inspect:1",
        runId: "run_test",
        workflowId: "test.loop",
      },
    ]);
  });

  test("increments step attempt metadata after retry", async () => {
    const attempts: number[] = [];
    const app = loop({
      id: "retry.loop",
      steps: [
        createRuntimeStep("sometimes", (context) => {
          attempts.push(context.step.attempt);
          return context.step.attempt === 1
            ? retry("try again")
            : done("ok");
        }),
      ],
    });

    const session = await app.start("input", { runId: "run_retry" });

    expect(attempts).toEqual([1, 2]);
    expect(session.events.find((event) => event.type === "step.retrying")).toMatchObject({
      attempt: 1,
      correlationId: "run:run_retry:step:sometimes:attempt:1",
      stepId: "sometimes",
    });
    const completed = session.events.filter((event) => event.type === "step.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      attempt: 2,
      correlationId: "run:run_retry:step:sometimes:attempt:2",
      stepId: "sometimes",
    });
    expect(completed[0]?.durationMs).toEqual(expect.any(Number));
  });

  test("uses step retry budgets instead of a global retry count", async () => {
    const attempts: number[] = [];
    const app = loop<unknown, string>({
      id: "retry.budget.loop",
      steps: [
        createRuntimeStep("sometimes", (context) => {
          attempts.push(context.step.attempt);
          return context.step.attempt < 4
            ? retry("try again")
            : done("ok");
        }, { maxRetries: 3 }),
      ],
    });

    const session = await app.start("input", { runId: "run_retry_budget" });

    expect(session.status).toBe("completed");
    expect(attempts).toEqual([1, 2, 3, 4]);
    expect(session.events.filter((event) => event.type === "step.retrying")).toHaveLength(3);
    expect(session.events.find((event) => event.type === "step.retrying")).toMatchObject({
      detail: {
        maxRetries: 3,
        reason: "try again",
        retries: 1,
      },
      durationMs: expect.any(Number),
    });
  });

  test("fails when a step exceeds its retry budget", async () => {
    const app = loop({
      id: "retry.fail.loop",
      steps: [
        createRuntimeStep("always", () => retry("still bad"), { maxRetries: 0 }),
      ],
    });

    const session = await app.start("input", { runId: "run_retry_fail" });

    expect(session.status).toBe("failed");
    expect(session.events.find((event) => event.type === "step.failed")).toMatchObject({
      detail: {
        maxRetries: 0,
        reason: "still bad",
      },
      durationMs: expect.any(Number),
      stepId: "always",
    });
  });
});

describe("loop worker item events", () => {
  test("emits normalized worker item activity with step correlation", async () => {
    const app = loop<unknown, string>({
      id: "worker.loop",
      steps: [
        createAiRuntimeStep("execute", {
          run({ emit }) {
            emit(workerItemEvent({
              itemId: "item_1",
              itemKind: "model_step",
              preview: "Worker started",
              provider: "test-worker",
              providerRefs: { sessionId: "provider_session" },
              title: "Worker started",
              type: "worker.item.started",
            }));
            emit(workerItemEvent({
              itemId: "item_1",
              itemKind: "model_step",
              output: { complete: true },
              preview: "Worker completed",
              provider: "test-worker",
              title: "Worker completed",
              type: "worker.item.completed",
            }));
            return done({ complete: true });
          },
        }),
      ],
    });

    const session = await app.start("input", { runId: "run_worker" });
    const workerEvents = session.events.filter((event) =>
      event.type.startsWith("worker.item.")
    );

    expect(workerEvents).toHaveLength(2);
    expect(workerEvents[0]).toMatchObject({
      attempt: 1,
      correlationId: "run:run_worker:step:execute:attempt:1",
      itemId: "item_1",
      itemKind: "model_step",
      provider: "test-worker",
      providerRefs: { sessionId: "provider_session" },
      type: "worker.item.started",
    });
    expect("stepId" in workerEvents[0]!).toBe(false);
    expect(workerEvents[1]).toMatchObject({
      output: { complete: true },
      type: "worker.item.completed",
    });
  });
});

describe("loop checkpoints", () => {
  test("records generic checkpoints before each step run", async () => {
    const app = loop<unknown, { task: string }>({
      id: "checkpoint.loop",
      steps: [
        createRuntimeStep("prepare", () => done({ prepared: true })),
        createRuntimeStep("execute", () => done({ executed: true })),
      ],
    });

    const session = await app.start({ task: "ship it" }, { runId: "run_checkpoint" });

    expect(session.checkpoints).toHaveLength(2);
    expect(session.checkpoints[0]).toMatchObject({
      attempt: 1,
      eventIndex: 3,
      input: { task: "ship it" },
      runId: "run_checkpoint",
      state: {},
      stepId: "prepare",
    });
    expect(session.checkpoints[1]).toMatchObject({
      attempt: 1,
      input: { task: "ship it" },
      runId: "run_checkpoint",
      state: {
        prepare: { prepared: true },
        prepared: true,
      },
      stepId: "execute",
    });

    const checkpointEvents = session.events.filter((event) =>
      event.type === "checkpoint.created"
    );
    expect(checkpointEvents).toHaveLength(2);
    expect(checkpointEvents[0]).toMatchObject({
      attempt: 1,
      index: session.checkpoints[0]!.eventIndex,
      stepId: "prepare",
    });
    expect(checkpointEvents[0]!.detail).toEqual({
      checkpoint: session.checkpoints[0],
    });
  });

  test("records retry attempts as separate checkpoints", async () => {
    const app = loop({
      id: "checkpoint.retry.loop",
      steps: [
        createRuntimeStep("sometimes", (context) =>
          context.step.attempt === 1
            ? retry("not yet", { firstAttemptSeen: true })
            : done({ ok: true })
        ),
      ],
    });

    const session = await app.start("input", { runId: "run_checkpoint_retry" });

    expect(session.checkpoints.map((checkpoint) => ({
      attempt: checkpoint.attempt,
      state: checkpoint.state,
      stepId: checkpoint.stepId,
    }))).toEqual([
      { attempt: 1, state: {}, stepId: "sometimes" },
      { attempt: 2, state: { firstAttemptSeen: true }, stepId: "sometimes" },
    ]);
  });
});

describe("loop session controls", () => {
  test("pauses and resumes a waiting session with generic events", async () => {
    const app = loop({
      id: "pause.loop",
      steps: [
        createRuntimeStep("ask", () =>
          ask({
            id: "destination",
            prompt: "Where should this go?",
            title: "Destination",
            type: "text",
          })
        ),
      ],
    });
    const session = await app.start("input", { runId: "run_pause" });

    await session.pause({ reason: "operator review" });

    expect(session.status).toBe("paused");
    expect(session.events.at(-1)).toMatchObject({
      detail: { reason: "operator review" },
      type: "run.paused",
    });

    await session.resume();

    expect(session.status).toBe("waiting");
    expect(session.events.find((event) => event.type === "run.resumed")).toMatchObject({
      type: "run.resumed",
      runId: "run_pause",
    });
  });

  test("cancels a waiting session and prevents later resume", async () => {
    const app = loop({
      id: "cancel.loop",
      steps: [
        createRuntimeStep("ask", () =>
          ask({
            id: "destination",
            prompt: "Where should this go?",
            title: "Destination",
            type: "text",
          })
        ),
      ],
    });
    const session = await app.start("input", { runId: "run_cancel" });

    await session.cancel({ reason: "user stopped" });
    await session.resume();

    expect(session.status).toBe("cancelled");
    expect(session.pendingHooks).toEqual([]);
    expect(session.pendingQuestions).toEqual([]);
    expect(session.events.at(-1)).toMatchObject({
      detail: { reason: "user stopped" },
      type: "run.cancelled",
    });
  });

  test("reruns from a checkpoint as a child session", async () => {
    const seen: Array<{ input: unknown; state: unknown; step: string }> = [];
    const app = loop({
      id: "rerun.loop",
      steps: [
        createRuntimeStep("prepare", () => done({ prepared: true })),
        createRuntimeStep("execute", (context) => {
          seen.push({
            input: context.input,
            state: { ...context.state },
            step: context.step.id,
          });
          return done({ executed: true });
        }),
      ],
    });
    const session = await app.start({ task: "ship it" }, { runId: "run_parent" });
    const executeCheckpoint = session.checkpoints.find((checkpoint) =>
      checkpoint.stepId === "execute"
    );

    const child = await session.rerunFromCheckpoint({
      checkpointId: executeCheckpoint!.checkpointId,
      runId: "run_child",
    });

    expect(child.runId).toBe("run_child");
    expect(child.parentRunId).toBe("run_parent");
    expect(child.parentCheckpointId).toBe(executeCheckpoint!.checkpointId);
    expect(child.status).toBe("completed");
    expect(child.events[0]).toMatchObject({
      type: "run.started",
      runId: "run_child",
    });
    expect(child.events.some((event) =>
      event.type === "step.started" && event.stepId === "prepare"
    )).toBe(false);
    expect(child.events.some((event) =>
      event.type === "step.started" && event.stepId === "execute"
    )).toBe(true);
    expect(seen.at(-1)).toEqual({
      input: { task: "ship it" },
      state: {
        prepare: { prepared: true },
        prepared: true,
      },
      step: "execute",
    });
    expect(session.events.at(-1)).toMatchObject({
      detail: {
        childRunId: "run_child",
        checkpoint: executeCheckpoint,
      },
      type: "run.rerun.created",
    });
  });
});

describe("loop stores", () => {
  test("persists sessions, events, and checkpoints through a generic store", async () => {
    const store = new InMemoryLoopStore<string>();
    const app = loop<unknown, string>({
      id: "store.loop",
      steps: [
        createRuntimeStep("prepare", () => done({ prepared: true })),
      ],
    });

    const session = await app.start("input", {
      runId: "run_store",
      store,
    });

    expect(await store.getSession("run_store")).toEqual({
      input: "input",
      parentCheckpointId: undefined,
      parentRunId: undefined,
      runId: "run_store",
      status: "completed",
    });
    expect(await store.listEvents("run_store")).toEqual(session.events);
    expect(await store.listCheckpoints("run_store")).toEqual(session.checkpoints);
  });

  test("persists generic rerun actions and child session metadata", async () => {
    const store = new InMemoryLoopStore<{ task: string }>();
    const app = loop<unknown, { task: string }>({
      id: "store.rerun.loop",
      steps: [
        createRuntimeStep("prepare", () => done({ prepared: true })),
        createRuntimeStep("execute", () => done({ executed: true })),
      ],
    });
    const session = await app.start({ task: "ship it" }, {
      runId: "run_store_parent",
      store,
    });
    const checkpoint = session.checkpoints.find((item) =>
      item.stepId === "execute"
    )!;

    const child = await session.rerunFromCheckpoint({
      checkpointId: checkpoint.checkpointId,
      runId: "run_store_child",
    });

    expect(await store.listActions("run_store_parent")).toEqual([
      expect.objectContaining({
        input: {
          checkpointId: checkpoint.checkpointId,
          childRunId: "run_store_child",
        },
        name: "rerunFromCheckpoint",
        runId: "run_store_parent",
      }),
    ]);
    expect(await store.getSession("run_store_child")).toEqual({
      input: { task: "ship it" },
      parentCheckpointId: checkpoint.checkpointId,
      parentRunId: "run_store_parent",
      runId: "run_store_child",
      status: "completed",
    });
    expect(await store.listEvents("run_store_child")).toEqual(child.events);
  });
});

describe("loop transitions", () => {
  test("lets a step continue at another generic step", async () => {
    const visits: string[] = [];
    const app = loop({
      id: "transition.loop",
      steps: [
        createRuntimeStep("prepare", () => done({ count: 0 })),
        createRuntimeStep("decide", (context) => {
          visits.push(`decide:${context.step.attempt}`);
          const count = Number(context.state.count ?? 0);
          return count < 1
            ? goto("fix", "score below threshold")
            : goto("result", "score passed");
        }),
        createRuntimeStep("fix", (context) => {
          visits.push(`fix:${context.step.attempt}`);
          return goto("decide", "recheck after fix", {
            count: Number(context.state.count ?? 0) + 1,
          });
        }),
        createRuntimeStep("result", (context) => {
          visits.push(`result:${context.step.attempt}`);
          return done({ count: context.state.count });
        }),
      ],
    });

    const session = await app.start("input", { runId: "run_goto" });

    expect(session.status).toBe("completed");
    expect(visits).toEqual(["decide:1", "fix:1", "decide:2", "result:1"]);
    expect(session.state.result).toEqual({ count: 1 });
    expect(session.events.filter((event) => event.type === "step.goto")).toEqual([
      expect.objectContaining({
        attempt: 1,
        detail: {
          fromStepId: "decide",
          reason: "score below threshold",
          targetStepId: "fix",
        },
        stepId: "decide",
      }),
      expect.objectContaining({
        attempt: 1,
        detail: {
          fromStepId: "fix",
          reason: "recheck after fix",
          targetStepId: "decide",
        },
        stepId: "fix",
      }),
      expect.objectContaining({
        attempt: 2,
        detail: {
          fromStepId: "decide",
          reason: "score passed",
          targetStepId: "result",
        },
        stepId: "decide",
      }),
    ]);
  });

  test("fails clearly when a transition targets an unknown step", async () => {
    const app = loop({
      id: "transition.invalid.loop",
      steps: [
        createRuntimeStep("decide", () => goto("missing")),
      ],
    });

    const session = await app.start("input", { runId: "run_bad_goto" });

    expect(session.status).toBe("failed");
    expect(session.events.find((event) => event.type === "step.failed")).toMatchObject({
      detail: {
        fromStepId: "decide",
        targetStepId: "missing",
      },
      message: "Unknown step target: missing",
      stepId: "decide",
    });
  });
});

describe("loop graph projection", () => {
  test("projects generic step metadata without product graph ids", () => {
    const app = loop({
      description: "Runs a generic sequence.",
      id: "custom.loop",
      label: "Custom Loop",
      steps: [
        createRuntimeStep("prepare", () => done(), {
          description: "Prepare input.",
          kind: "setup",
          label: "Prepare",
        }),
        createAiRuntimeStep("execute", {
          kind: "worker",
          label: "Execute",
          maxRetries: 3,
          run: () => done(),
        }),
        createRuntimeStep("result", () => done()),
      ],
    });

    expect(app.graph()).toEqual({
      description: "Runs a generic sequence.",
      edges: [
        { from: "prepare", id: "prepare->execute", kind: "sequence", to: "execute" },
        { from: "execute", id: "execute->result", kind: "sequence", to: "result" },
      ],
      id: "custom.loop",
      label: "Custom Loop",
      nodes: [
        {
          description: "Prepare input.",
          id: "prepare",
          kind: "setup",
          label: "Prepare",
          maxRetries: 1,
        },
        {
          description: undefined,
          id: "execute",
          kind: "worker",
          label: "Execute",
          maxRetries: 3,
        },
        {
          description: undefined,
          id: "result",
          kind: "step",
          label: "Result",
          maxRetries: 1,
        },
      ],
    });
  });

  test("projects a loop config without constructing a runner", () => {
    expect(projectLoopGraph({
      id: "tiny.flow",
      steps: [
        createRuntimeStep("first", () => done()),
        createRuntimeStep("second", () => done()),
      ],
    })).toMatchObject({
      edges: [
        { from: "first", id: "first->second", kind: "sequence", to: "second" },
      ],
      id: "tiny.flow",
      label: "Tiny Flow",
      nodes: [
        { id: "first", kind: "step", label: "First" },
        { id: "second", kind: "step", label: "Second" },
      ],
    });
  });

  test("projects step contract ports and runs with typed state input", async () => {
    const requestSchema = z.object({
      prompt: z.string().trim().min(1),
    });
    const planSchema = z.object({
      title: z.string().trim().min(1),
    });
    const app = loop<unknown, { prompt: string }>({
      id: "typed.flow",
      steps: [
        createRuntimeStep("prepare", ({ input }) => done({
          request: {
            prompt: input.prompt,
          },
        })),
        createContractedRuntimeStep({
          id: "draft-plan",
          input: {
            request: requestSchema,
          },
          output: {
            plan: planSchema,
          },
          run({ input }) {
            return done({
              plan: {
                title: input.request.prompt.trim(),
              },
            });
          },
        }),
      ],
    });

    const graphNode = app.graph().nodes.find((node) => node.id === "draft-plan");
    expect(graphNode).toMatchObject({
      id: "draft-plan",
      input: [
        {
          contractId: "draft-plan.input.request",
          key: "request",
        },
      ],
      output: [
        {
          contractId: "draft-plan.output.plan",
          key: "plan",
        },
      ],
    });

    const session = await app.start({ prompt: "  create a todo app  " });

    expect(session.state.plan).toEqual({
      title: "create a todo app",
    });
  });
});

describe("loop hooks", () => {
  test("creates a token-addressable hook and resumes the step with its value", async () => {
    const approvalHook = createHook<{ prompt: string }, string>({
      id: "approval.required",
    });
    const app = loop({
      id: "hook.loop",
      steps: [
        createRuntimeStep("approve", async (context) => {
          const value = await context.waitFor(approvalHook, {
            prompt: "Approve this action?",
          });
          return done({ value });
        }),
      ],
    });

    const session = await app.start("input", { runId: "run_hook" });

    expect(session.status).toBe("waiting");
    expect(session.pendingHooks).toHaveLength(1);
    expect(session.pendingHooks[0]).toMatchObject({
      correlationId: "run:run_hook:step:approve:attempt:1",
      id: "approval.required",
      input: { prompt: "Approve this action?" },
      stepId: "approve",
      token: "hook:run_hook:approve:1:0:approval_required",
    });
    expect(session.events.find((event) => event.type === "hook.waiting")).toMatchObject({
      attempt: 1,
      correlationId: "run:run_hook:step:approve:attempt:1",
      stepId: "approve",
    });
    expect(session.events.find((event) => event.type === "step.waiting")).toMatchObject({
      durationMs: expect.any(Number),
      stepId: "approve",
    });

    await session.resumeHook({
      token: session.pendingHooks[0]!.token,
      value: "approved",
    });

    expect(session.status).toBe("completed");
    expect(session.state.value).toBe("approved");
    expect(session.events.find((event) => event.type === "hook.resumed")).toMatchObject({
      type: "hook.resumed",
      runId: "run_hook",
    });
  });

  test("carries wait hook metadata for inbox-style approvals", async () => {
    const approvalHook = createHook<
      { message: string; requestedScope: string[] },
      { approved: boolean; grantId?: string }
    >({
      expiresAt: "2026-05-09T12:30:00.000Z",
      id: "secret.github-token",
      kind: "secret.access",
      title: "GitHub token access",
    });
    const app = loop({
      id: "hook.metadata.loop",
      steps: [
        createRuntimeStep("request-secret", async (context) => {
          const decision = await context.waitFor(approvalHook, {
            message: "Approve GitHub token access?",
            requestedScope: ["repo:write"],
          });
          if (!decision.approved) return done({ approved: false });
          return done({ approved: true, grantId: decision.grantId });
        }),
      ],
    });

    const session = await app.start("input", { runId: "run_hook_metadata" });
    const [hook] = session.pendingHooks;

    expect(session.status).toBe("waiting");
    expect(hook).toMatchObject({
      expiresAt: "2026-05-09T12:30:00.000Z",
      id: "secret.github-token",
      input: {
        message: "Approve GitHub token access?",
        requestedScope: ["repo:write"],
      },
      kind: "secret.access",
      stepId: "request-secret",
      title: "GitHub token access",
    });
    expect(session.events.find((event) => event.type === "step.waiting")).toMatchObject({
      detail: {
        hook: expect.objectContaining({
          id: "secret.github-token",
          kind: "secret.access",
          title: "GitHub token access",
        }),
      },
      stepId: "request-secret",
    });

    await session.resumeHook({
      token: hook!.token,
      value: { approved: true, grantId: "grant_123" },
    });

    expect(session.status).toBe("completed");
    expect(session.state).toMatchObject({
      approved: true,
      grantId: "grant_123",
      "request-secret": {
        approved: true,
        grantId: "grant_123",
      },
    });
  });

  test("rejects unknown and consumed hook tokens clearly", async () => {
    const approvalHook = createHook<{ prompt: string }, string>({
      id: "approval.required",
    });
    const app = loop({
      id: "hook.loop",
      steps: [
        createRuntimeStep("approve", async (context) => {
          const value = await context.waitFor(approvalHook, {
            prompt: "Approve this action?",
          });
          return done({ value });
        }),
      ],
    });
    const session = await app.start("input", { runId: "run_hook_reuse" });
    const token = session.pendingHooks[0]!.token;

    await expect(session.resumeHook({
      token: "missing",
      value: "approved",
    })).rejects.toThrow("Unknown hook token: missing");

    await session.resumeHook({ token, value: "approved" });

    await expect(session.resumeHook({
      token,
      value: "approved again",
    })).rejects.toThrow(`Hook token has already been consumed: ${token}`);
  });

  test("cancels pending hook tokens and emits hook cancellation events", async () => {
    const approvalHook = createHook<{ prompt: string }, string>({
      id: "approval.required",
    });
    const app = loop({
      id: "hook.cancel.loop",
      steps: [
        createRuntimeStep("approve", async (context) => {
          const value = await context.waitFor(approvalHook, {
            prompt: "Approve this action?",
          });
          return done({ value });
        }),
      ],
    });
    const session = await app.start("input", { runId: "run_hook_cancel" });
    const token = session.pendingHooks[0]!.token;

    await session.cancel({ reason: "operator stopped" });

    expect(session.status).toBe("cancelled");
    expect(session.pendingHooks).toEqual([]);
    expect(session.pendingQuestions).toEqual([]);
    expect(session.events.find((event) => event.type === "hook.cancelled")).toMatchObject({
      detail: {
        hook: expect.objectContaining({
          id: "approval.required",
          token,
        }),
        reason: "operator stopped",
      },
      stepId: "approve",
      type: "hook.cancelled",
    });
    await expect(session.resumeHook({
      token,
      value: "late approval",
    })).rejects.toThrow(`Hook token has already been consumed: ${token}`);
  });

  test("bridges questions into hook wait and resume events", async () => {
    const app = loop({
      id: "question.loop",
      steps: [
        createRuntimeStep("ask", () =>
          ask({
            id: "destination",
            prompt: "Where should this go?",
            title: "Destination",
            type: "text",
          })
        ),
      ],
    });
    const session = await app.start("input", { runId: "run_question_hook" });

    expect(session.pendingQuestions).toHaveLength(1);
    expect(session.pendingHooks).toHaveLength(1);
    expect(session.pendingHooks[0]).toMatchObject({
      id: "destination",
      kind: "question",
    });
    expect(session.pendingHooks[0]?.token).toStartWith("question:run_question_hook:ask:1:destination:");

    await session.answer({
      questionId: "destination",
      value: "https://example.com",
    });

    expect(session.events.find((event) => event.type === "hook.resumed")).toMatchObject({
      detail: {
        hook: expect.objectContaining({
          id: "destination",
          kind: "question",
        }),
        value: "https://example.com",
      },
    });
  });

  test("resolves question answers before accepting them", async () => {
    const app = loop({
      questionResolvers: {
        "test.destination"(input) {
          const utterance = String(input.utterance);
          if (utterance.includes("change")) {
            return {
              confidence: 0.9,
              kind: "revision" as const,
              message: "This is a revision, not a destination.",
              status: "revision" as const,
              targetRequirementIds: ["delivery_surface"],
            };
          }
          return {
            confidence: 0.95,
            kind: "answer" as const,
            normalizedValue: utterance.toUpperCase(),
            status: "accepted" as const,
          };
        },
      },
      id: "question.resolution.loop",
      steps: [
        createRuntimeStep("ask", ({ answers }) => {
          if (answers.destination) return done({ destination: answers.destination });
          return ask({
            id: "destination",
            prompt: "Where should this go?",
            resolverId: "test.destination",
            title: "Destination",
            type: "text",
          });
        }),
        createRuntimeStep("finish", ({ answers }) => done({ destination: answers.destination })),
      ],
    });
    const session = await app.start("input", { runId: "run_question_eval" });

    await session.answer({
      questionId: "destination",
      value: "can i change the surface?",
    });

    expect(session.answers.destination).toBeUndefined();
    expect(session.pendingQuestions).toHaveLength(1);
    expect(session.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "question.resolution.started",
      "question.resolution.completed",
      "question.resolution.rejected",
    ]));
    expect(session.events.find((event) => event.type === "question.resolution.rejected")).toMatchObject({
      detail: {
        kind: "revision",
        questionId: "destination",
        status: "revision",
        targetRequirementIds: ["delivery_surface"],
      },
    });

    await session.answer({
      questionId: "destination",
      value: "alpha",
    });
    await session.resume();

    expect(session.status).toBe("completed");
    expect(session.state.finish).toEqual({ destination: "ALPHA" });
    expect(session.events.find((event) => event.type === "question.resolution.accepted")).toMatchObject({
      detail: {
        kind: "answer",
        normalizedValue: "ALPHA",
        questionId: "destination",
        status: "accepted",
      },
    });
  });

  test("passes unresolved question resolution history to the resolver", async () => {
    const historyLengths: number[] = [];
    const app = loop({
      questionResolvers: {
        "test.destination"(input) {
          historyLengths.push(input.history?.length ?? 0);
          const previousSuggestion = [...(input.history ?? [])].reverse().find((item) =>
            item.resolution.status === "needs_input" &&
            item.resolution.kind === "suggestion" &&
            item.resolution.suggestedValue
          );
          if (previousSuggestion && String(input.utterance).includes("good")) {
            return {
              confidence: 0.95,
              kind: "answer" as const,
              normalizedValue: previousSuggestion.resolution.status === "needs_input"
                ? previousSuggestion.resolution.suggestedValue
                : undefined,
              status: "accepted" as const,
            };
          }
          return {
            confidence: 0.8,
            kind: "suggestion" as const,
            message: "Try ./alpha.",
            status: "needs_input" as const,
            suggestedValue: "./alpha",
          };
        },
      },
      id: "question.resolution.history.loop",
      steps: [
        createRuntimeStep("ask", ({ answers }) => {
          if (answers.destination) return done({ destination: answers.destination });
          return ask({
            id: "destination",
            prompt: "Where should this go?",
            resolverId: "test.destination",
            title: "Destination",
            type: "text",
          });
        }),
      ],
    });
    const session = await app.start("input", { runId: "run_question_history" });

    await session.answer({ questionId: "destination", value: "suggest?" });
    await session.answer({ questionId: "destination", value: "sounds good" });
    await session.resume();

    expect(historyLengths).toEqual([0, 1]);
    expect(session.state.ask).toEqual({ destination: "./alpha" });
  });
});
