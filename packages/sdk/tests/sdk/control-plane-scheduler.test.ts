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
} from "@dromio/workflow/core";
import {
  createSqliteWorkflowRuntimeStore,
  createWorkflowControlPlane,
  runTriggerWorker,
  scheduleIdempotencyKey,
  type Clock,
  type IdGenerator,
  type TriggerDescriptor,
  type TriggerJobSnapshot,
  type TriggerRegistryStore,
} from "@dromio/workflow/workflow-control-plane";

describe("workflow control-plane schedule scheduler", () => {
  test("enqueues one next occurrence for repeated passes in the same minute", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-control-plane-scheduler-idem-"));
    try {
      const harness = createHarness(path.join(directory, "runtime.sqlite"), [
        scheduleTrigger("cron.every-minute", "scheduled"),
      ]);

      await runWorkerOnce(harness);
      await runWorkerOnce(harness);
      const jobs = await triggerJobs(harness);

      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        availableAt: "2026-05-10T00:01:00.000Z",
        idempotencyKey: scheduleIdempotencyKey("cron.every-minute", "2026-05-10T00:01:00.000Z"),
        kind: "trigger",
        occurrenceId: "2026-05-10T00:01:00.000Z",
        status: "queued",
        triggerId: "cron.every-minute",
        workflowId: "scheduled",
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("fires a due scheduled job and materializes the following occurrence once", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-control-plane-scheduler-fire-"));
    try {
      const harness = createHarness(path.join(directory, "runtime.sqlite"), [
        scheduleTrigger("cron.every-minute", "scheduled"),
      ]);
      await runWorkerOnce(harness);

      harness.clock.set(new Date("2026-05-10T00:01:01.000Z"));
      await runWorkerOnce(harness);
      await runWorkerOnce(harness);

      const runs = await harness.controlPlane.listRuns({ originType: "schedule" });
      const jobs = await triggerJobs(harness);
      const fired = requireJob(jobs, "2026-05-10T00:01:00.000Z");
      const following = jobs.filter((job) => job.availableAt === "2026-05-10T00:02:00.000Z");

      expect(runs).toHaveLength(1);
      expect(runs[0]?.workflowId).toBe("scheduled");
      expect(fired.status).toBe("completed");
      expect(fired.runId).toBe(runs[0]?.runId);
      expect(following).toHaveLength(1);
      expect(following[0]?.status).toBe("queued");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("ignores disabled schedule triggers and non-schedule trigger types", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-control-plane-scheduler-ignore-"));
    try {
      const harness = createHarness(path.join(directory, "runtime.sqlite"), [
        {
          ...scheduleTrigger("cron.disabled", "scheduled"),
          enabled: false,
        },
        {
          ...scheduleTrigger("manual.with-cron", "manual"),
          type: "manual",
        },
      ]);

      await runWorkerOnce(harness);

      expect(await triggerJobs(harness)).toHaveLength(0);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("fires a persisted scheduled occurrence after restart without duplicating it", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-control-plane-scheduler-restart-"));
    const dbPath = path.join(directory, "runtime.sqlite");
    const triggers = [scheduleTrigger("cron.every-minute", "scheduled")];
    try {
      {
        const phaseA = createHarness(dbPath, triggers);
        await runWorkerOnce(phaseA);
        expect(await triggerJobs(phaseA)).toHaveLength(1);
      }

      const phaseB = createHarness(dbPath, triggers);
      phaseB.clock.set(new Date("2026-05-10T00:00:20.000Z"));
      await runWorkerOnce(phaseB);
      expect((await triggerJobs(phaseB)).filter(
        (job) => job.availableAt === "2026-05-10T00:01:00.000Z",
      )).toHaveLength(1);

      phaseB.clock.set(new Date("2026-05-10T00:01:01.000Z"));
      await runWorkerOnce(phaseB);
      const jobs = await triggerJobs(phaseB);
      const fired = requireJob(jobs, "2026-05-10T00:01:00.000Z");
      const runs = await phaseB.controlPlane.listRuns({ originType: "schedule" });

      expect(fired.status).toBe("completed");
      expect(runs).toHaveLength(1);
      expect(runs[0]?.workflowId).toBe("scheduled");
      expect(jobs.filter((job) => job.availableAt === "2026-05-10T00:01:00.000Z")).toHaveLength(1);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("skips missed past occurrences and only enqueues the next future occurrence", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-control-plane-scheduler-skip-"));
    try {
      const harness = createHarness(path.join(directory, "runtime.sqlite"), [
        scheduleTrigger("cron.every-minute", "scheduled"),
      ]);
      harness.clock.set(new Date("2026-05-10T00:05:30.000Z"));

      await runWorkerOnce(harness);
      const jobs = await triggerJobs(harness);

      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.availableAt).toBe("2026-05-10T00:06:00.000Z");
      expect(jobs.some((job) => job.availableAt < "2026-05-10T00:06:00.000Z")).toBe(false);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

type SchedulerHarness = ReturnType<typeof createHarness>;

function createHarness(dbPath: string, triggers: TriggerDescriptor[]) {
  const clock = mutableClock("2026-05-10T00:00:10.000Z");
  const app = createScheduleApp();
  const runtime = createWorkflowAppRuntime(app);
  const store = createSqliteWorkflowRuntimeStore(dbPath);
  const controlPlane = createWorkflowControlPlane({
    app,
    clock: clock.clock,
    idGenerator: sequenceIds(),
    runtime,
    runtimeStore: store,
    triggerStore: triggerStore(triggers),
  });
  return {
    clock,
    controlPlane,
  };
}

async function runWorkerOnce(harness: SchedulerHarness): Promise<void> {
  await runTriggerWorker({
    clock: harness.clock.clock,
    controlPlane: harness.controlPlane,
    once: true,
    workerId: "schedule-worker",
  });
}

function createScheduleApp(): WorkflowApp {
  return createWorkflowApp({
    defaultWorkflow: "scheduled",
    id: "scheduler-test",
    workflows: {
      manual: {
        result: { format: formatState },
        workflow: loop<unknown, string>({
          id: "manual",
          steps: [
            createRuntimeStep("finish", () => done({ workflow: "manual" })),
          ],
        }),
      },
      scheduled: {
        result: { format: formatState },
        workflow: loop<unknown, string>({
          id: "scheduled",
          steps: [
            createRuntimeStep("finish", ({ input }) => done({ input, workflow: "scheduled" })),
          ],
        }),
      },
    },
  });
}

function scheduleTrigger(id: string, workflowId: string): TriggerDescriptor {
  return {
    config: {
      cron: "* * * * *",
      timezone: "UTC",
    },
    enabled: true,
    id,
    label: id,
    type: "schedule",
    workflowId,
  };
}

function triggerStore(triggers: TriggerDescriptor[]): TriggerRegistryStore {
  return {
    async read() {
      return { triggers, version: 1 };
    },
  };
}

async function triggerJobs(
  harness: SchedulerHarness,
): Promise<TriggerJobSnapshot[]> {
  return harness.controlPlane.listTriggerJobs({ kind: "trigger" });
}

function requireJob(
  jobs: TriggerJobSnapshot[],
  availableAt: string,
): TriggerJobSnapshot {
  const job = jobs.find((item) => item.availableAt === availableAt);
  if (!job) throw new Error(`Expected job at ${availableAt}.`);
  return job;
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

function formatState(session: { state?: unknown }) {
  return JSON.stringify(session.state ?? {});
}
