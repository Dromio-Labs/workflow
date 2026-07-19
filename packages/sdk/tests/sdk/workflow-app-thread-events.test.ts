import { describe, expect, test } from "bun:test";
import {
  createWorkflowApp,
  createWorkflowAppRuntime,
  snapshotWorkflowAppRun,
  type WorkflowAppThreadEventEmitInput,
} from "@dromio/workflow/app";
import {
  ask,
  createHook,
  done,
  loop,
  createRuntimeStep,
} from "@dromio/workflow/core";

describe("workflow app thread suspension events", () => {
  test("Given a thread-originated run, when it parks on a question, then that thread receives one run.suspended event", async () => {
    const emitted: WorkflowAppThreadEventEmitInput[] = [];
    const runtime = createWorkflowAppRuntime(createQuestionApp(), {
      threadEvents: { emit: (event) => emitted.push(event) },
    });

    const run = await runtime.startRun({
      input: "ship it",
      origin: { threadId: "thread-1", type: "manual" },
      runId: "run-thread-question",
      workflowId: "planner",
    });

    expect(run.status).toBe("waiting");
    expect(emitted).toEqual([
      {
        threadId: "thread-1",
        event: {
          interactions: [
            {
              id: "scope",
              kind: "question",
              summary: "What scope should the plan cover?",
              title: "Scope",
              token: expect.stringMatching(/^question:run-thread-question:collect:1:scope:/),
            },
          ],
          runId: "run-thread-question",
          type: "run.suspended",
          workflowId: "planner",
        },
      },
    ]);
  });

  test("Given a run without a thread origin, when it parks, then no thread event is emitted", async () => {
    const emitted: WorkflowAppThreadEventEmitInput[] = [];
    const runtime = createWorkflowAppRuntime(createQuestionApp(), {
      threadEvents: { emit: (event) => emitted.push(event) },
    });

    await runtime.startRun({
      input: "ship it",
      origin: { type: "manual" },
      runId: "run-manual-question",
      workflowId: "planner",
    });

    expect(emitted).toEqual([]);
  });

  test("Given two thread-originated runs, when both park, then each event goes only to its originating thread", async () => {
    const emitted: WorkflowAppThreadEventEmitInput[] = [];
    const runtime = createWorkflowAppRuntime(createQuestionApp(), {
      threadEvents: { emit: (event) => emitted.push(event) },
    });

    await runtime.startRun({
      input: "ship one",
      origin: { threadId: "thread-1", type: "manual" },
      runId: "run-thread-one",
      workflowId: "planner",
    });
    await runtime.startRun({
      input: "ship two",
      origin: { threadId: "thread-2", type: "manual" },
      runId: "run-thread-two",
      workflowId: "planner",
    });

    expect(emitted.map((item) => [item.threadId, item.event.runId])).toEqual([
      ["thread-1", "run-thread-one"],
      ["thread-2", "run-thread-two"],
    ]);
  });

  test("Given the same parked run is hydrated again, when the same wait is observed, then it emits only once", async () => {
    const emitted: WorkflowAppThreadEventEmitInput[] = [];
    const runtime = createWorkflowAppRuntime(createQuestionApp(), {
      threadEvents: { emit: (event) => emitted.push(event) },
    });
    const run = await runtime.startRun({
      input: "ship it",
      origin: { threadId: "thread-1", type: "manual" },
      runId: "run-dedupe-question",
      workflowId: "planner",
    });

    await runtime.hydrateRun?.(snapshotWorkflowAppRun(runtime.app, run));

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.event.interactions[0]).toMatchObject({
      id: "scope",
      kind: "question",
      summary: "What scope should the plan cover?",
      token: expect.stringMatching(/^question:run-dedupe-question:collect:1:scope:/),
    });
  });

  test("Given a thread-originated run parks on an approval hook, then the event carries card render fields", async () => {
    const emitted: WorkflowAppThreadEventEmitInput[] = [];
    const runtime = createWorkflowAppRuntime(createApprovalApp(), {
      threadEvents: { emit: (event) => emitted.push(event) },
    });

    await runtime.startRun({
      input: "deploy",
      origin: { threadId: "thread-approval", type: "manual" },
      runId: "run-approval",
      workflowId: "deploy",
    });

    expect(emitted).toEqual([
      {
        threadId: "thread-approval",
        event: {
          interactions: [
            {
              id: "deploy.approval",
              kind: "approval",
              summary: "Approve production deploy?",
              title: "Deploy approval",
              token: "hook:run-approval:approval:1:0:deploy_approval",
            },
          ],
          runId: "run-approval",
          type: "run.suspended",
          workflowId: "deploy",
        },
      },
    ]);
  });
});

function createQuestionApp() {
  return createWorkflowApp({
    defaultWorkflow: "planner",
    workflows: {
      planner: {
        workflow: loop({
          id: "question-flow",
          steps: [
            createRuntimeStep("collect", () =>
              ask({
                id: "scope",
                options: [{ label: "Minimal", value: "minimal" }],
                prompt: "What scope should the plan cover?",
                title: "Scope",
                type: "choice",
              })
            ),
          ],
        }),
      },
    },
  });
}

function createApprovalApp() {
  const approval = createHook<{ message: string }, { approved: boolean }>({
    id: "deploy.approval",
    title: "Deploy approval",
  });
  return createWorkflowApp({
    defaultWorkflow: "deploy",
    workflows: {
      deploy: {
        workflow: loop({
          id: "approval-flow",
          steps: [
            createRuntimeStep("approval", async (context) => {
              const decision = await context.waitFor(approval, {
                message: "Approve production deploy?",
              });
              return done(decision);
            }),
          ],
        }),
      },
    },
  });
}
