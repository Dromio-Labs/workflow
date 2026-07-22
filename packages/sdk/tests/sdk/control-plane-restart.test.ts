import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createWorkflowApp,
  createWorkflowAppRuntime,
  type WorkflowApp,
  type WorkflowAppRunSnapshot,
  type WorkflowAppRuntime,
} from "@dromio/workflow/client";
import {
  createHook,
  done,
  loop,
  createRuntimeStep,
  type EventRecord,
} from "@dromio/workflow/core";
import {
  createSqliteWorkflowRuntimeStore,
  createWorkflowControlPlane,
  createWorkflowControlPlaneHttpAdapter,
  type TriggerRegistryStore,
  type WorkflowRuntimeStore,
} from "@dromio/workflow/workflow-control-plane";

describe("workflow control-plane restart rehydration", () => {
  test("answers a paused run from a fresh process and completes without replaying completed steps", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-control-plane-restart-"));
    const dbPath = path.join(directory, "runtime.sqlite");
    let runId = "";

    try {
      {
        const phaseA = createHarness(dbPath);
        const started = await phaseA.controlPlane.startRun({
          input: "ship it",
          runId: "run_restart_answer",
          workflowId: "approval",
        });

        expect(started.status).toBe("waiting");
        expect(started.pendingHooks?.[0]?.id).toBe("approval");
        expect(await storedStatus(phaseA.store, started.runId)).toBe("waiting");
        runId = started.runId;
      }

      const phaseB = createHarness(dbPath);
      const response = await phaseB.http.fetch(new Request(
        `http://local/api/runs/${encodeURIComponent(runId)}/questions/approval/answer`,
        {
          body: JSON.stringify({ value: "yes" }),
          method: "POST",
        },
      ));
      const completed = runFromBody(await jsonBody(response));
      const stored = await phaseB.store.getWorkflowRun(runId);

      expect(completed.status).toBe("completed");
      expect(completed.result).toBe(JSON.stringify({ approved: "yes", prepared: true }));
      expect(stored?.status).toBe("completed");
      expect(stored?.events.map((event) => event.index)).toEqual(
        stored?.events.map((_event, index) => index),
      );
      expect(eventCount(stored?.events ?? [], "step.completed", "prepare")).toBe(1);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("resumes from a stored answer after a crash before resume", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-control-plane-crash-"));
    const dbPath = path.join(directory, "runtime.sqlite");
    let runId = "";
    let token = "";

    try {
      {
        const phaseA = createHarness(dbPath);
        const started = await phaseA.controlPlane.startRun({
          input: "ship it",
          runId: "run_restart_crash",
          workflowId: "approval",
        });
        runId = started.runId;
        token = started.pendingHooks?.[0]?.token ?? "";
      }

      {
        const phaseB = createHarness(dbPath, (app) => {
          const runtime = createWorkflowAppRuntime(app);
          return {
            ...runtime,
            async resumeRun() {
              throw new Error("simulated crash before resume");
            },
          };
        });
        const response = await phaseB.http.fetch(new Request(
          `http://local/api/runs/${encodeURIComponent(runId)}/questions/approval/answer`,
          {
            body: JSON.stringify({ value: "yes" }),
            method: "POST",
          },
        ));

        expect(response.status).toBe(500);
        const stored = await phaseB.store.getWorkflowRun(runId);
        expect(stored?.status).toBe("waiting");
        expect(stored?.answers?.approval).toBe("yes");
        expect(stored?.durable?.hookAnswers[token]).toBe("yes");
      }

      const phaseC = createHarness(dbPath);
      const completed = await phaseC.controlPlane.resumeRun(runId);

      expect(completed.status).toBe("completed");
      expect(completed.result).toBe(JSON.stringify({ approved: "yes", prepared: true }));
      expect(eventCount(completed.events, "step.completed", "prepare")).toBe(1);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("resumes a hook token after restart without a run id", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-control-plane-hook-"));
    const dbPath = path.join(directory, "runtime.sqlite");
    let token = "";

    try {
      {
        const phaseA = createHarness(dbPath);
        const started = await phaseA.controlPlane.startRun({
          input: "ship it",
          runId: "run_restart_hook",
          workflowId: "token",
        });

        expect(started.status).toBe("waiting");
        token = started.pendingHooks?.[0]?.token ?? "";
        expect(token).toStartWith("hook:");
      }

      const phaseB = createHarness(dbPath);
      const response = await phaseB.http.fetch(new Request(
        `http://local/api/hooks/${encodeURIComponent(token)}/resume`,
        {
          body: JSON.stringify({ value: "approved" }),
          method: "POST",
        },
      ));
      const completed = runFromBody(await jsonBody(response));

      expect(completed.status).toBe("completed");
      expect(completed.result).toBe(JSON.stringify({ hook: "approved", prepared: true }));
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("resumes a durable question token after restart through the answer path", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-control-plane-question-hook-"));
    const dbPath = path.join(directory, "runtime.sqlite");
    let token = "";

    try {
      {
        const phaseA = createHarness(dbPath);
        const started = await phaseA.controlPlane.startRun({
          input: "ship it",
          runId: "run_restart_question_hook",
          workflowId: "approval",
        });
        token = started.pendingHooks?.[0]?.token ?? "";
        expect(started.pendingHooks?.[0]?.kind).toBe("question");
      }

      const phaseB = createHarness(dbPath);
      const completed = await phaseB.controlPlane.resumeHook({ token, value: "yes" });

      expect(completed.status).toBe("completed");
      expect(completed.result).toBe(JSON.stringify({ approved: "yes", prepared: true }));
      expect(eventCount(completed.events, "step.completed", "prepare")).toBe(1);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("reconciles a stale hydrated run after another process advances it", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-control-plane-reconcile-"));
    const dbPath = path.join(directory, "runtime.sqlite");

    try {
      const starter = createHarness(dbPath);
      const started = await starter.controlPlane.startRun({
        input: "ship it",
        runId: "run_restart_reconcile",
        workflowId: "two-stage",
      });
      const observer = createHarness(dbPath);
      expect((await observer.controlPlane.getRun(started.runId)).pendingHooks?.[0]?.id)
        .toBe("approval");

      const worker = createHarness(dbPath);
      const advanced = await worker.controlPlane.answerQuestion(started.runId, {
        questionId: "approval",
        value: "yes",
      });
      expect(advanced.pendingHooks?.[0]?.id).toBe("release");

      const reconciled = await observer.controlPlane.getRun(started.runId);
      expect(reconciled.pendingHooks?.[0]?.id).toBe("release");
      const completed = await observer.controlPlane.answerQuestion(started.runId, {
        questionId: "release",
        value: "now",
      });
      expect(completed.status).toBe("completed");
      expect(completed.result).toContain('"approved":"yes"');
      expect(completed.result).toContain('"released":"now"');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("rejects a stale waiting write after another controller completes the run", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-control-plane-monotonic-"));
    const dbPath = path.join(directory, "runtime.sqlite");
    let releaseStaleWrite: (() => void) | undefined;

    try {
      const starter = createHarness(dbPath);
      const waiting = await starter.controlPlane.startRun({
        input: "ship it",
        runId: "run_restart_monotonic",
        workflowId: "approval",
      });
      const deferred = deferFirstRunWrite(createSqliteWorkflowRuntimeStore(dbPath));
      releaseStaleWrite = deferred.release;
      const staleController = createHarness(dbPath, createWorkflowAppRuntime, deferred.store);
      await staleController.controlPlane.getRun(waiting.runId);

      const staleResume = staleController.controlPlane.resumeRun(waiting.runId);
      await withTimeout(deferred.entered, "Stale controller did not reach persistence.");
      const winner = createHarness(dbPath);
      const completed = await winner.controlPlane.answerQuestion(waiting.runId, {
        questionId: "approval",
        value: "yes",
      });
      deferred.release();
      const reconciled = await staleResume;
      const stored = await winner.store.getWorkflowRun(waiting.runId);

      expect(completed.status).toBe("completed");
      expect(reconciled.status).toBe("completed");
      expect(stored?.status).toBe("completed");
      expect(eventCount(stored?.events ?? [], "step.completed", "finish")).toBe(1);
    } finally {
      releaseStaleWrite?.();
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("returns not found for unknown runs and conflict for terminal resumed runs", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-control-plane-errors-"));
    const dbPath = path.join(directory, "runtime.sqlite");
    let terminalRunId = "";

    try {
      {
        const phaseA = createHarness(dbPath);
        const completed = await phaseA.controlPlane.startRun({
          input: "done",
          runId: "run_restart_terminal",
          workflowId: "complete",
        });
        expect(completed.status).toBe("completed");
        terminalRunId = completed.runId;
      }

      const phaseB = createHarness(dbPath);
      const unknown = await phaseB.http.fetch(new Request(
        "http://local/api/runs/missing/questions/approval/answer",
        {
          body: JSON.stringify({ value: "yes" }),
          method: "POST",
        },
      ));
      const terminal = await phaseB.http.fetch(new Request(
        `http://local/api/runs/${encodeURIComponent(terminalRunId)}/resume`,
        { method: "POST" },
      ));

      expect(unknown.status).toBe(404);
      expect(terminal.status).toBe(409);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("surfaces runtime registry failures instead of treating them as absent live runs", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-control-plane-registry-error-"));

    try {
      const { controlPlane } = createHarness(path.join(directory, "runtime.sqlite"), (app) => ({
        ...createWorkflowAppRuntime(app),
        listRuns() {
          throw new Error("runtime registry unavailable");
        },
      }));

      await expect(controlPlane.getRun("missing")).rejects.toThrow("runtime registry unavailable");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

function createHarness(
  dbPath: string,
  runtimeFactory: (app: WorkflowApp) => WorkflowAppRuntime = createWorkflowAppRuntime,
  runtimeStore?: WorkflowRuntimeStore,
) {
  const app = createRestartApp();
  const runtime = runtimeFactory(app);
  const store = runtimeStore ?? createSqliteWorkflowRuntimeStore(dbPath);
  const controlPlane = createWorkflowControlPlane({
    app,
    runtime,
    runtimeStore: store,
    triggerStore: emptyTriggerStore(),
  });
  return {
    controlPlane,
    http: createWorkflowControlPlaneHttpAdapter({ controlPlane }),
    store,
  };
}

function deferFirstRunWrite(store: WorkflowRuntimeStore): {
  readonly entered: Promise<void>;
  readonly release: () => void;
  readonly store: WorkflowRuntimeStore;
} {
  let enter!: () => void;
  let release!: () => void;
  let delayed = true;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return {
    entered,
    release,
    store: {
      ...store,
      async putWorkflowRun(snapshot) {
        if (delayed) {
          delayed = false;
          enter();
          await gate;
        }
        return await store.putWorkflowRun(snapshot);
      },
    },
  };
}

async function withTimeout<Value>(promise: Promise<Value>, message: string): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 1_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function createRestartApp(): WorkflowApp {
  const approval = createHook<{ label: string }, string>({
    id: "approval",
    kind: "question",
  });
  const tokenApproval = createHook<{ label: string }, string>({
    id: "token-approval",
  });
  const release = createHook<{ label: string }, string>({
    id: "release",
    kind: "question",
  });

  return createWorkflowApp({
    defaultWorkflow: "approval",
    id: "restart-test",
    workflows: {
      approval: {
        result: { format: formatFinish },
        workflow: loop<unknown, string>({
          id: "approval",
          steps: [
            createRuntimeStep("prepare", () => done({ prepared: true })),
            createRuntimeStep("approve", async (context) => {
              const approved = await context.waitFor(approval, { label: "Approve?" });
              return done({ approved, prepared: context.state.prepared });
            }),
            createRuntimeStep("finish", (context) => done({
              approved: context.state.approved,
              prepared: context.state.prepared,
            })),
          ],
        }),
      },
      complete: {
        result: { format: formatFinish },
        workflow: loop<unknown, string>({
          id: "complete",
          steps: [
            createRuntimeStep("finish", () => done({ ok: true })),
          ],
        }),
      },
      token: {
        result: { format: formatFinish },
        workflow: loop<unknown, string>({
          id: "token",
          steps: [
            createRuntimeStep("prepare", () => done({ prepared: true })),
            createRuntimeStep("approve", async (context) => {
              const hook = await context.waitFor(tokenApproval, { label: "Approve?" });
              return done({ hook, prepared: context.state.prepared });
            }),
            createRuntimeStep("finish", (context) => done({
              hook: context.state.hook,
              prepared: context.state.prepared,
            })),
          ],
        }),
      },
      "two-stage": {
        result: { format: formatFinish },
        workflow: loop<unknown, string>({
          id: "two-stage",
          steps: [
            createRuntimeStep("approve", async (context) => done({
              approved: await context.waitFor(approval, { label: "Approve?" }),
            })),
            createRuntimeStep("release", async (context) => done({
              approved: context.state.approved,
              released: await context.waitFor(release, { label: "Release?" }),
            })),
          ],
        }),
      },
    },
  });
}

function emptyTriggerStore(): TriggerRegistryStore {
  return {
    async read() {
      return { triggers: [], version: 1 };
    },
  };
}

async function storedStatus(store: WorkflowRuntimeStore, runId: string) {
  return (await store.getWorkflowRun(runId))?.status;
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  expect(response.status).toBeGreaterThanOrEqual(200);
  expect(response.status).toBeLessThan(300);
  return await response.json() as Record<string, unknown>;
}

function runFromBody(body: Record<string, unknown>): WorkflowAppRunSnapshot {
  const run = body.run;
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    throw new Error("Expected workflow run response body.");
  }
  return run as WorkflowAppRunSnapshot;
}

function formatFinish(session: { state?: unknown }) {
  const state = isRecord(session.state) ? session.state : {};
  return JSON.stringify(state.finish ?? state);
}

function eventCount(
  events: readonly EventRecord[],
  type: string,
  stepId: string,
) {
  return events.filter((event) => event.type === type && event.stepId === stepId).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
