import type {
  RuntimeSessionControl,
  RuntimeSessionSnapshot,
} from "./runtime.types.js";
import {
  runRuntimeEffect,
  runtimeOperationEffect,
} from "./effects.js";
import { cloneSnapshot } from "./sessions.js";
import { toJsonObject, type JsonObject } from "../../shared/json.js";

export interface RuntimeStorageBridge {
  createSession(input: RuntimeStorageBridgeCreateSessionInput): Promise<RuntimeStorageBridgeSession>;
  readSession(id: string): Promise<RuntimeStorageBridgeSessionRecord | undefined>;
  resumeSession(input: { readonly id: string }): Promise<RuntimeStorageBridgeSession>;
}

export interface RuntimeStorageBridgeCreateSessionInput {
  readonly id: string;
  readonly status?: string;
  readonly title?: string;
  readonly metadata?: JsonObject;
}

export interface RuntimeStorageBridgeSessionRecord {
  readonly id: string;
}

export interface RuntimeStorageBridgeSession {
  appendEvents(events: readonly RuntimeStorageBridgeEvent[]): Promise<unknown>;
  loadHistory(): Promise<{ readonly events: readonly RuntimeStorageBridgeRecordedEvent[] }>;
  updateMetadata?(patch: { readonly status?: string; readonly metadata?: JsonObject }): Promise<unknown>;
}

export interface RuntimeStorageBridgeEvent {
  readonly eventId: string;
  readonly type: string;
  readonly version: number;
  readonly payload: JsonObject;
}

export interface RuntimeStorageBridgeRecordedEvent extends RuntimeStorageBridgeEvent {
  readonly seq: number;
}

export interface RuntimeSessionStoreOptions {
  readonly storage?: RuntimeStorageBridge;
}

export class RuntimeSessionStore {
  readonly controls = new Map<string, RuntimeSessionControl>();
  readonly sessions = new Map<string, RuntimeSessionSnapshot>();

  constructor(private readonly options: RuntimeSessionStoreOptions = {}) {}

  get(runId: string) {
    const session = this.sessions.get(runId);
    return session ? cloneSnapshot(session) : undefined;
  }

  getControl(runId: string) {
    return this.controls.get(runId);
  }

  list() {
    return [...this.sessions.values()].map((session) => cloneSnapshot(session));
  }

  save(session: RuntimeSessionSnapshot, control?: RuntimeSessionControl) {
    this.sessions.set(session.runId, cloneSnapshot(session));
    if (control) {
      this.controls.set(session.runId, control);
    }
  }

  async saveDurable(
    session: RuntimeSessionSnapshot,
    control?: RuntimeSessionControl,
  ): Promise<void> {
    return runRuntimeEffect(runtimeOperationEffect("runtime.store.saveDurable", async () => {
      const storageSession = await this.ensureStorageSession(session);
      if (storageSession) {
        await storageSession.appendEvents([
          {
            eventId: `workflow-runtime-snapshot:${session.runId}:${session.events.length}`,
            type: "workflow.runtime.snapshot",
            version: 1,
            payload: { session: toJsonObject(cloneSnapshot(session)) },
          },
        ]);
        await storageSession.updateMetadata?.({
          status: workflowRuntimeStatusToThreadStatus(session.status),
          metadata: {
            workflowKey: session.workflowKey,
            runId: session.runId,
          },
        });
      }
      this.save(session, control);
    }));
  }

  async getDurable(runId: string): Promise<RuntimeSessionSnapshot | undefined> {
    const storageSession = await this.resumeStorageSession(runId);
    if (!storageSession) {
      return this.get(runId);
    }
    const history = await storageSession.loadHistory();
    const event = [...history.events]
      .reverse()
      .find((candidate) => candidate.type === "workflow.runtime.snapshot");
    const session = event?.payload.session;
    if (!session || typeof session !== "object" || Array.isArray(session)) {
      return this.get(runId);
    }
    return cloneSnapshot(session as unknown as RuntimeSessionSnapshot);
  }

  private async ensureStorageSession(
    session: RuntimeSessionSnapshot,
  ): Promise<RuntimeStorageBridgeSession | null> {
    if (!this.options.storage) {
      return null;
    }
    const existing = await this.options.storage.readSession(session.runId);
    return existing
      ? this.options.storage.resumeSession({ id: session.runId })
      : this.options.storage.createSession({
          id: session.runId,
          status: workflowRuntimeStatusToThreadStatus(session.status),
          title: session.workflowKey,
          metadata: {
            workflowKey: session.workflowKey,
            runId: session.runId,
          },
        });
  }

  private async resumeStorageSession(runId: string): Promise<RuntimeStorageBridgeSession | null> {
    if (!this.options.storage || !(await this.options.storage.readSession(runId))) {
      return null;
    }
    return this.options.storage.resumeSession({ id: runId });
  }
}

function workflowRuntimeStatusToThreadStatus(status: RuntimeSessionSnapshot["status"]): string {
  switch (status) {
    case "running":
      return "running";
    case "failed":
      return "failed";
    case "completed":
    case "cancelled":
      return "completed";
    case "idle":
    case "paused":
    case "waiting":
      return "idle";
  }
}
