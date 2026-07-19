import type {
  EventRecord,
  LoopActionRecord,
  LoopCheckpoint,
  LoopSessionRecord,
  LoopStore,
} from "./loop.types.js";

export class InMemoryLoopStore<TInput = unknown> implements LoopStore<TInput> {
  readonly actions = new Map<string, LoopActionRecord[]>();
  readonly checkpoints = new Map<string, Array<LoopCheckpoint<TInput>>>();
  readonly events = new Map<string, EventRecord[]>();
  readonly sessions = new Map<string, LoopSessionRecord<TInput>>();

  appendAction(action: LoopActionRecord) {
    const records = this.actions.get(action.runId) ?? [];
    records.push(cloneSnapshot(action));
    this.actions.set(action.runId, records);
  }

  appendCheckpoint(checkpoint: LoopCheckpoint<TInput>) {
    const records = this.checkpoints.get(checkpoint.runId) ?? [];
    records.push(cloneSnapshot(checkpoint));
    this.checkpoints.set(checkpoint.runId, records);
  }

  appendEvent(event: EventRecord) {
    const records = this.events.get(event.runId) ?? [];
    records.push(cloneSnapshot(event));
    this.events.set(event.runId, records);
  }

  getSession(runId: string) {
    const session = this.sessions.get(runId);
    return session ? cloneSnapshot(session) : undefined;
  }

  listActions(runId: string) {
    return cloneSnapshot(this.actions.get(runId) ?? []);
  }

  listCheckpoints(runId: string) {
    return cloneSnapshot(this.checkpoints.get(runId) ?? []);
  }

  listEvents(runId: string) {
    return cloneSnapshot(this.events.get(runId) ?? []);
  }

  saveSession(session: LoopSessionRecord<TInput>) {
    this.sessions.set(session.runId, cloneSnapshot(session));
  }
}

function cloneSnapshot<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}
