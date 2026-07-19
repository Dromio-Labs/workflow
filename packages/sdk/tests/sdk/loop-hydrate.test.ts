import { describe, expect, test } from "bun:test";

import {
  UnresumableRunError,
  ask,
  createHook,
  done,
  loop,
  retry,
  createRuntimeStep,
  type LoopHydrationSnapshot,
  type LoopSession,
} from "../../src/sdk/core/loop/index.js";
import {
  snapshotWorkflowAppRun,
  type RunnableWorkflowAppWorkflow,
  type WorkflowApp,
  type WorkflowAppRun,
} from "../../src/sdk/client/interactions/workflow-app.js";

const approvalHook = createHook<{ prompt: string }, string>({
  id: "approval.required",
});

const sequentialHook = createHook<{ label: string }, string>({
  id: "sequential.approval",
});

describe("loop hydration", () => {
  test("hydrates a parked wait hook and continues event indexes without replaying completed steps", async () => {
    const workflow = approvalWorkflow();
    const session = await workflow.start("input", { runId: "run_hydrate_hook" });
    const snapshot = snapshotFromSession(workflow, session);
    const firstNewIndex = maxEventIndex(snapshot.events) + 1;
    const hydrated = approvalWorkflow().hydrate(snapshot);

    await hydrated.resumeHook({
      token: snapshot.pendingHooks![0]!.token,
      value: "approved",
    });

    expect(hydrated.status).toBe("completed");
    expect(hydrated.state.finish).toEqual({ approved: "approved" });
    expect(hydrated.events.at(snapshot.events.length)?.index).toBe(firstNewIndex);
    expect(hydrated.events.filter((event) =>
      event.type === "step.completed" && event.stepId === "prepare"
    )).toHaveLength(1);
    expect(hydrated.events.filter((event) =>
      event.type === "step.created" && event.stepId === "prepare"
    )).toHaveLength(1);
  });

  test("preserves sequential wait hook answers so the next ordinal replays after restart", async () => {
    const workflow = sequentialHookWorkflow();
    const session = await workflow.start("input", { runId: "run_hydrate_sequence" });
    const firstToken = session.pendingHooks[0]!.token;

    await session.resumeHook({ token: firstToken, value: "first" });
    const secondToken = session.pendingHooks[0]!.token;
    const snapshot = snapshotFromSession(workflow, session);
    const hydrated = sequentialHookWorkflow().hydrate(snapshot);

    await hydrated.resumeHook({ token: secondToken, value: "second" });

    expect(secondToken).toBe("hook:run_hydrate_sequence:collect:1:1:sequential_approval");
    expect(hydrated.status).toBe("completed");
    expect(hydrated.state.collect).toEqual({ first: "first", second: "second" });
  });

  test("hydrates pending questions and accepts answer() before resume", async () => {
    const workflow = questionWorkflow();
    const session = await workflow.start("input", { runId: "run_hydrate_question" });
    const snapshot = snapshotFromSession(workflow, session);
    const hydrated = questionWorkflow().hydrate(snapshot);

    await hydrated.answer({ questionId: "destination", value: "docs" });
    await hydrated.resume();

    expect(hydrated.status).toBe("completed");
    expect(hydrated.answers.destination).toBe("docs");
    expect(hydrated.state.finish).toEqual({ destination: "docs" });
  });

  test("keeps retry attempt and idempotency key stable when hydrating a parked step", async () => {
    const workflow = retryThenHookWorkflow();
    const session = await workflow.start("input", { runId: "run_hydrate_attempt" });
    const token = session.pendingHooks[0]!.token;
    const snapshot = snapshotFromSession(workflow, session);
    const hydrated = retryThenHookWorkflow().hydrate(snapshot);
    const hydratedEventCount = hydrated.events.length;

    await hydrated.resumeHook({ token, value: "approved" });

    expect(token).toBe("hook:run_hydrate_attempt:approve:2:0:approval_required");
    expect(hydrated.state.approve).toEqual({
      attempt: 2,
      idempotencyKey: "run_hydrate_attempt:approve:2",
      value: "approved",
    });
    expect(hydrated.events.slice(hydratedEventCount).some((event) =>
      event.type === "step.retrying"
    )).toBe(false);
  });

  test("derives legacy single-hook snapshots without a durable block", async () => {
    const workflow = approvalWorkflow();
    const session = await workflow.start("input", { runId: "run_hydrate_legacy" });
    const { durable: _durable, ...legacySnapshot } = snapshotFromSession(workflow, session);
    const hydrated = approvalWorkflow().hydrate(legacySnapshot);

    await hydrated.resumeHook({
      token: legacySnapshot.pendingHooks![0]!.token,
      value: "approved",
    });

    expect(hydrated.status).toBe("completed");
    expect(hydrated.state.finish).toEqual({ approved: "approved" });
  });

  test("rejects corrupt legacy snapshots that cannot identify a resumable step", () => {
    const corrupt: LoopHydrationSnapshot<string> = {
      events: [],
      input: "input",
      pendingQuestions: [],
      runId: "run_hydrate_corrupt",
      status: "waiting",
    };

    expect(() => approvalWorkflow().hydrate(corrupt)).toThrow(UnresumableRunError);
  });
});

function approvalWorkflow() {
  return loop<unknown, string>({
    id: "hydrate.approval",
    steps: [
      createRuntimeStep("prepare", () => done({ prepared: true })),
      createRuntimeStep("approve", async (context) => {
        const approved = await context.waitFor(approvalHook, {
          prompt: "Approve this action?",
        });
        return done({ approved });
      }),
      createRuntimeStep("finish", (context) => done({ approved: context.state.approved })),
    ],
  });
}

function sequentialHookWorkflow() {
  return loop<unknown, string>({
    id: "hydrate.sequential",
    steps: [
      createRuntimeStep("collect", async (context) => {
        const first = await context.waitFor(sequentialHook, { label: "first" });
        const second = await context.waitFor(sequentialHook, { label: "second" });
        return done({ first, second });
      }),
    ],
  });
}

function questionWorkflow() {
  return loop<unknown, string>({
    id: "hydrate.question",
    steps: [
      createRuntimeStep("ask", (context) => {
        if (context.answers.destination) {
          return done({ destination: context.answers.destination });
        }
        return ask({
          id: "destination",
          prompt: "Where should this go?",
          title: "Destination",
          type: "text",
        });
      }),
      createRuntimeStep("finish", (context) => done({ destination: context.state.destination })),
    ],
  });
}

function retryThenHookWorkflow() {
  return loop<unknown, string>({
    id: "hydrate.retry",
    steps: [
      createRuntimeStep("approve", async (context) => {
        if (context.step.attempt === 1) return retry("transient");
        const value = await context.waitFor(approvalHook, {
          prompt: "Approve retry?",
        });
        return done({
          attempt: context.step.attempt,
          idempotencyKey: context.step.idempotencyKey,
          value,
        });
      }, { maxRetries: 1 }),
    ],
  });
}

function snapshotFromSession(
  workflow: ReturnType<typeof approvalWorkflow>,
  session: LoopSession<unknown, string>,
) {
  const run: WorkflowAppRun = {
    artifacts: [],
    events: session.events,
    input: "input",
    runId: session.runId,
    session,
    status: session.status,
    workflowId: workflow.id,
  };
  return snapshotWorkflowAppRun(workflowAppFor(workflow), run);
}

function workflowAppFor(
  workflow: RunnableWorkflowAppWorkflow<string, LoopSession<unknown, string>>,
): WorkflowApp {
  return {
    defaultWorkflowId: workflow.id,
    getWorkflow() {
      return { title: workflow.id, workflow };
    },
    graph() {
      return workflow.graph();
    },
    id: "hydrate.test",
    listCommands() {
      return [];
    },
    listWorkflows() {
      return [{
        id: workflow.id,
        title: workflow.id,
        triggers: [{
          id: "manual",
          input: { kind: "prompt", required: true },
          label: "Manual",
          type: "manual",
        }],
      }];
    },
    title: "Hydrate Test",
    workflowIds() {
      return [workflow.id];
    },
    workspaceFrame() {
      return undefined;
    },
  };
}

function maxEventIndex(events: readonly { index: number }[]) {
  return events.reduce((max, event) => Math.max(max, event.index), -1);
}
