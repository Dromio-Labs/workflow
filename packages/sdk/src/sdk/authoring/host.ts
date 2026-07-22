import { randomUUID } from "node:crypto";
import {
  createWorkflowAppRuntime,
  snapshotWorkflowAppRun,
  type WorkflowAppRun,
  type WorkflowAppRuntime,
} from "../client/interactions/workflow-app.js";
import {
  createSqliteWorkflowRuntimeStore,
  createWorkflowControlPlane,
  createWorkflowControlPlaneHttpAdapter,
  runSignalDeliveryPass,
  type AuthTokenVerifier,
  type TriggerRegistryStore,
  type WorkflowControlPlane,
  type WorkflowRuntimeStore,
} from "../workflow-control-plane/index.js";
import { signalWaitsForRunSnapshot } from "../workflow-control-plane/signal-waits.js";
import type { AuthoredWorkflowApp } from "./app.js";

export type WorkflowAppHostStorage =
  | { kind: "memory" }
  | { kind: "sqlite"; path: string };

export type CreateWorkflowAppHostOptions = {
  auth?: AuthTokenVerifier;
  runtime?: WorkflowAppRuntime;
  runtimeStore?: WorkflowRuntimeStore;
  storage?: WorkflowAppHostStorage;
  triggerStore?: TriggerRegistryStore;
  workerId?: string;
};

export type WorkflowAppHost = {
  controlPlane: WorkflowControlPlane;
  deliverSignals(): Promise<number>;
  fetch(request: Request): Promise<Response>;
  persistRun(run: WorkflowAppRun): Promise<void>;
  reconcileSignalWaits(): Promise<void>;
  runtime: WorkflowAppRuntime;
  runtimeStore: WorkflowRuntimeStore;
};

export type RunWorkflowServerOptions = CreateWorkflowAppHostOptions & {
  hostname?: string;
  port?: number;
  signalPollIntervalMs?: number;
};

export type WorkflowServer = WorkflowAppHost & {
  hostname: string;
  port: number;
  stop(): void;
  url: string;
};

export async function createWorkflowAppHost(
  app: AuthoredWorkflowApp,
  options: CreateWorkflowAppHostOptions = {},
): Promise<WorkflowAppHost> {
  const runtimeStore = options.runtimeStore ?? storageRuntimeStore(options.storage);
  const baseRuntime = options.runtime ?? createWorkflowAppRuntime(app);
  const persistRuntimeRun = async (run: WorkflowAppRun) => {
    const snapshot = snapshotWorkflowAppRun(app, run);
    const now = new Date().toISOString();
    const persisted = await runtimeStore.putWorkflowRun(snapshot);
    if (!persisted.written) return;
    await runtimeStore.syncSignalWaits({
      now,
      runId: snapshot.runId,
      waits: signalWaitsForRunSnapshot(snapshot, now),
    });
    await runtimeStore.appendWorkflowRunEvents(snapshot.runId, snapshot.events);
  };
  const runtime = persistentWorkflowAppRuntime(baseRuntime, persistRuntimeRun);
  const controlPlane = createWorkflowControlPlane({
    app,
    auth: options.auth,
    // The control plane owns its durable compare-and-swap writes. Giving it
    // the persistence-wrapped public runtime would write every transition
    // twice and let equivalent concurrent answers both advance a run.
    runtime: baseRuntime,
    runtimeStore,
    signals: app.signals,
    triggerStore: options.triggerStore ?? emptyTriggerStore,
  });
  const http = createWorkflowControlPlaneHttpAdapter({ controlPlane });
  const workerId = options.workerId ?? `signal-worker-${randomUUID()}`;
  const host: WorkflowAppHost = {
    controlPlane,
    async deliverSignals() {
      let delivered = 0;
      while (await runSignalDeliveryPass({
        controlPlane,
        runtimeStore,
        workerId,
      })) delivered += 1;
      return delivered;
    },
    fetch(request) {
      return http.fetch(request);
    },
    persistRun: persistRuntimeRun,
    async reconcileSignalWaits() {
      const now = new Date().toISOString();
      for (const run of await runtimeStore.listWorkflowRuns()) {
        if (["cancelled", "completed", "failed"].includes(run.status)) continue;
        await runtimeStore.syncSignalWaits({
          now,
          runId: run.runId,
          waits: signalWaitsForRunSnapshot(run, now),
        });
      }
    },
    runtime,
    runtimeStore,
  };
  await host.reconcileSignalWaits();
  return host;
}

function persistentWorkflowAppRuntime(
  runtime: WorkflowAppRuntime,
  persist: (run: WorkflowAppRun) => Promise<void>,
): WorkflowAppRuntime {
  const persistent: WorkflowAppRuntime = {
    ...runtime,
    async answerQuestion(runId, input) {
      return persistResult(runtime.answerQuestion(runId, input));
    },
    async rerunFromStep(runId, input) {
      return persistResult(runtime.rerunFromStep(runId, input));
    },
    async resumeHook(input) {
      return persistResult(runtime.resumeHook(input));
    },
    async resumeRun(runId) {
      return persistResult(runtime.resumeRun(runId));
    },
    async startRun(input) {
      return persistResult(runtime.startRun(input));
    },
  };
  if (runtime.hydrateRun) {
    persistent.hydrateRun = async (snapshot) => persistResult(runtime.hydrateRun!(snapshot));
  }
  return persistent;

  async function persistResult(result: Promise<WorkflowAppRun>) {
    const run = await result;
    await persist(run);
    return run;
  }
}

export async function runWorkflowServer(
  app: AuthoredWorkflowApp,
  options: RunWorkflowServerOptions = {},
): Promise<WorkflowServer> {
  const hostname = options.hostname ?? "127.0.0.1";
  if (!isLoopback(hostname) && !options.auth) {
    throw new Error("A non-loopback workflow server requires an auth verifier.");
  }
  const host = await createWorkflowAppHost(app, options);
  const server = Bun.serve({
    fetch(request) {
      return host.fetch(request);
    },
    hostname,
    port: options.port ?? 4323,
  });
  const timer = setInterval(() => {
    void host.deliverSignals();
  }, options.signalPollIntervalMs ?? 100);
  timer.unref?.();
  return {
    ...host,
    hostname: server.hostname ?? hostname,
    port: server.port ?? options.port ?? 4323,
    stop() {
      clearInterval(timer);
      server.stop();
    },
    url: server.url.toString().replace(/\/$/, ""),
  };
}

function storageRuntimeStore(storage: WorkflowAppHostStorage | undefined) {
  if (!storage || storage.kind === "memory") {
    return createSqliteWorkflowRuntimeStore(":memory:");
  }
  return createSqliteWorkflowRuntimeStore(storage.path);
}

function isLoopback(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost";
}

const emptyTriggerStore: TriggerRegistryStore = {
  async read() {
    return { triggers: [], version: 1 };
  },
};
