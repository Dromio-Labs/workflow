import { describe, expect, test } from "bun:test";
import {
  createHook,
  done,
  loop,
  createRuntimeStep,
} from "@dromio/workflow/core";
import { createIntentRuntime } from "@dromio/workflow/core";

describe("intent runtime", () => {
  test("starts a loop workflow and exposes session events", async () => {
    const runtime = createIntentRuntime({
      workflows: {
        "demo.workflow": loop({
          id: "demo.workflow",
          steps: [
            createRuntimeStep("finish", () => done({ ok: true })),
          ],
        }),
      },
    });

    const session = await runtime.startWorkflow("demo.workflow", { prompt: "ship it" });

    expect(session.workflowKey).toBe("demo.workflow");
    expect(session.status).toBe("completed");
    expect(session.state.finish).toEqual({ ok: true });
    expect(await runtime.getSession(session.runId)).toEqual(session);
    expect((await runtime.listEvents(session.runId)).map((event) => event.type)).toContain("run.completed");
    expect(await runtime.listWorkflows()).toEqual([
      { description: undefined, key: "demo.workflow", title: undefined },
    ]);
  });

  test("resumes hooks through the shared runtime API", async () => {
    const approval = createHook<{ message: string }, "approved">({
      id: "approval.required",
    });
    const runtime = createIntentRuntime({
      workflows: {
        gated: loop({
          id: "gated",
          steps: [
            createRuntimeStep("approve", async (context) => {
              const answer = await context.waitFor(approval, { message: "Approve?" });
              return done({ answer });
            }),
          ],
        }),
      },
    });

    const waiting = await runtime.startWorkflow("gated", {});
    const [hook] = waiting.pendingHooks;

    expect(waiting.status).toBe("waiting");
    expect(hook?.token).toStartWith("hook:");

    const completed = await runtime.resumeHook({
      token: hook!.token,
      value: "approved",
    });

    expect(completed.status).toBe("completed");
    expect(completed.state.approve).toEqual({ answer: "approved" });
  });

  test("applies generic actions and reruns from checkpoints", async () => {
    const gate = createHook<{}, string>({ id: "gate" });
    const runtime = createIntentRuntime({
      workflows: {
        gated: loop({
          id: "gated",
          steps: [
            createRuntimeStep("wait", async (context) => {
              const answer = await context.waitFor(gate, {});
              return done({ answer });
            }),
          ],
        }),
        loop: loop({
          id: "loop",
          steps: [
            createRuntimeStep("one", () => done({ count: 1 })),
            createRuntimeStep("two", () => done({ count: 2 })),
          ],
        }),
      },
    });

    const session = await runtime.startWorkflow("gated", {});
    const action = await runtime.applyAction({
      actionKey: "cancel",
      input: { reason: "done checking" },
      sessionId: session.runId,
    });

    expect(action.status).toBe("accepted");
    expect(action.session?.status).toBe("cancelled");

    const rerunSource = await runtime.startWorkflow("loop", {});
    const [checkpoint] = await runtime.listCheckpoints(rerunSource.runId);
    const child = await runtime.rerunFromCheckpoint({
      checkpointId: checkpoint!.checkpointId,
      sessionId: rerunSource.runId,
    });

    expect(child.parentRunId).toBe(rerunSource.runId);
    expect(child.status).toBe("completed");
  });

  test("supports explicit app-provided runtime workflows", async () => {
    const runtime = createIntentRuntime({
      workflows: {
        explicit: {
          key: "explicit",
          async start(input: unknown, options?: { emit?: (event: { message: string; type: string }) => void; runId?: string }) {
            options?.emit?.({
              message: "Explicit workflow ran.",
              type: "explicit.ran",
            });
            return {
              session: {
                checkpoints: [],
                events: [],
                input,
                output: { ok: true },
                pendingHooks: [],
                pendingQuestions: [],
                runId: options?.runId ?? "explicit_run",
                state: {},
                status: "completed" as const,
                workflowKey: "explicit",
              },
            };
          },
        },
      },
    });

    const session = await runtime.startWorkflow("explicit", { ok: true }, { runId: "run_explicit" });

    expect(session.runId).toBe("run_explicit");
    expect(session.output).toEqual({ ok: true });
    expect(session.events[0]?.type).toBe("explicit.ran");
  });
});
