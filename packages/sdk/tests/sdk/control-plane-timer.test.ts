import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createWorkflowApp,
  createWorkflowAppRuntime,
  type WorkflowApp,
} from "@dromio/workflow/client";
import {
  done,
  loop,
  createRuntimeStep,
  type EventRecord,
} from "@dromio/workflow/core";
import {
  dispatchTriggerJob,
  runTriggerWorker,
  type Clock,
  type IdGenerator,
  type TriggerJobSnapshot,
  type TriggerRegistryStore,
  createSqliteWorkflowRuntimeStore,
  createWorkflowControlPlane,
} from "@dromio/workflow/workflow-control-plane";

describe("workflow control-plane durable timers", () => {
  test("parks step.sleep({ ms }) and enqueues one timer job for the hook", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-control-plane-timer-park-"));
    try {
      const harness = createHarness(path.join(directory, "runtime.sqlite"));
      const started = await harness.controlPlane.startRun({
        input: "sleep",
        runId: "run_timer_park",
        workflowId: "timer",
      });
      const hook = started.pendingHooks?.[0];
      const jobs = await timerJobs(harness.controlPlane);

      expect(started.status).toBe("waiting");
      expect(hook?.kind).toBe("timer");
      expect(typeof hook?.expiresAt).toBe("string");
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        availableAt: hook?.expiresAt,
        idempotencyKey: hook?.token,
        kind: "timer",
        payload: {
          runId: started.runId,
          source: "timer",
          token: hook?.token,
        },
        triggerId: "$timer",
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("worker waits for availableAt and then fires the timer hook", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-control-plane-timer-fire-"));
    try {
      const harness = createHarness(path.join(directory, "runtime.sqlite"));
      const started = await harness.controlPlane.startRun({
        input: "sleep",
        runId: "run_timer_fire",
        workflowId: "timer",
      });
      const job = (await timerJobs(harness.controlPlane))[0]!;

      harness.clock.set(new Date(Date.parse(job.availableAt) - 1));
      await runTriggerWorker({
        clock: harness.clock.clock,
        controlPlane: harness.controlPlane,
        once: true,
        workerId: "timer-worker",
      });
      expect((await harness.controlPlane.getTriggerJob(job.id)).status).toBe("queued");
      expect((await harness.store.getWorkflowRun(started.runId))?.status).toBe("waiting");

      harness.clock.set(new Date(Date.parse(job.availableAt) + 1));
      await runTriggerWorker({
        clock: harness.clock.clock,
        controlPlane: harness.controlPlane,
        once: true,
        workerId: "timer-worker",
      });
      const completed = await harness.controlPlane.getRun(started.runId);

      expect(completed.status).toBe("completed");
      expect((await harness.controlPlane.getTriggerJob(job.id)).status).toBe("completed");
      expect(hookResumeCount(completed.events)).toBe(1);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("fresh control-plane process fires a persisted timer job after restart", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-control-plane-timer-restart-"));
    const dbPath = path.join(directory, "runtime.sqlite");
    try {
      const phaseA = createHarness(dbPath);
      const started = await phaseA.controlPlane.startRun({
        input: "sleep",
        runId: "run_timer_restart",
        workflowId: "timer",
      });
      const job = (await timerJobs(phaseA.controlPlane))[0]!;

      const phaseB = createHarness(dbPath);
      phaseB.clock.set(new Date(Date.parse(job.availableAt) + 1));
      await runTriggerWorker({
        clock: phaseB.clock.clock,
        controlPlane: phaseB.controlPlane,
        once: true,
        workerId: "timer-worker",
      });
      const completed = await phaseB.store.getWorkflowRun(started.runId);

      expect(completed?.status).toBe("completed");
      expect(hookResumeCount(completed?.events ?? [])).toBe(1);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("dispatching the same timer job twice is a no-op success on the second fire", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-control-plane-timer-double-"));
    try {
      const harness = createHarness(path.join(directory, "runtime.sqlite"));
      const started = await harness.controlPlane.startRun({
        input: "sleep",
        runId: "run_timer_double",
        workflowId: "timer",
      });
      const job = (await timerJobs(harness.controlPlane))[0]!;
      harness.clock.set(new Date(Date.parse(job.availableAt) + 1));
      const claimed = await harness.controlPlane.claimNextTriggerJob({
        workerId: "timer-worker",
      });
      expect(claimed?.id).toBe(job.id);

      await dispatchTriggerJob({
        clock: harness.clock.clock,
        controlPlane: harness.controlPlane,
        job: claimed!,
      });
      await dispatchTriggerJob({
        clock: harness.clock.clock,
        controlPlane: harness.controlPlane,
        job: claimed!,
      });
      const completed = await harness.controlPlane.getRun(started.runId);

      expect(completed.status).toBe("completed");
      expect(hookResumeCount(completed.events)).toBe(1);
      expect((await harness.controlPlane.getTriggerJob(job.id)).status).toBe("completed");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("persisting the same parked sleep twice keeps one timer job row", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-control-plane-timer-idempotent-"));
    try {
      const harness = createHarness(path.join(directory, "runtime.sqlite"));
      const started = await harness.controlPlane.startRun({
        input: "sleep",
        runId: "run_timer_idempotent",
        workflowId: "timer",
      });

      const resumed = await harness.controlPlane.resumeRun(started.runId);
      const jobs = await timerJobs(harness.controlPlane);

      expect(resumed.status).toBe("waiting");
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.idempotencyKey).toBe(started.pendingHooks?.[0]?.token);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

function createHarness(dbPath: string) {
  const clock = mutableClock("2026-05-10T00:00:00.000Z");
  const app = createTimerApp();
  const runtime = createWorkflowAppRuntime(app);
  const store = createSqliteWorkflowRuntimeStore(dbPath);
  const controlPlane = createWorkflowControlPlane({
    app,
    clock: clock.clock,
    idGenerator: sequenceIds(),
    runtime,
    runtimeStore: store,
    triggerStore: emptyTriggerStore(),
  });
  return {
    clock,
    controlPlane,
    store,
  };
}

function createTimerApp(): WorkflowApp {
  return createWorkflowApp({
    defaultWorkflow: "timer",
    id: "timer-test",
    workflows: {
      timer: {
        result: { format: formatState },
        workflow: loop<unknown, string>({
          id: "timer",
          steps: [
            createRuntimeStep("sleep", async (context) => {
              const timer = await context.sleep({ id: "durable-sleep", ms: 60_000 });
              return done({ firedAt: timer.firedAt });
            }),
          ],
        }),
      },
    },
  });
}

async function timerJobs(controlPlane: {
  listTriggerJobs(filter?: { kind?: "timer" }): Promise<TriggerJobSnapshot[]>;
}) {
  return controlPlane.listTriggerJobs({ kind: "timer" });
}

function emptyTriggerStore(): TriggerRegistryStore {
  return {
    async read() {
      return { triggers: [], version: 1 };
    },
  };
}

function mutableClock(initial: string): { clock: Clock; set(value: Date): void } {
  let current = new Date(initial);
  return {
    clock: {
      now: () => current,
    },
    set(value) {
      current = value;
    },
  };
}

function sequenceIds(): IdGenerator {
  let next = 0;
  return {
    id(prefix) {
      next += 1;
      return `${prefix}_${next}`;
    },
  };
}

function hookResumeCount(events: readonly EventRecord[]) {
  return events.filter((event) => event.type === "hook.resumed").length;
}

function formatState(session: { state?: unknown }) {
  return JSON.stringify(session.state ?? {});
}
