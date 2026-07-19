import type { EventRecord } from "../../core/index.js";
import {
  createTraceTree,
  type TraceTreeEventMapper,
  type TraceTreeSnapshot,
} from "./trace-tree.js";

export type TraceStreamUpdate = {
  event: EventRecord;
  snapshot: TraceTreeSnapshot;
};

export type TraceStreamListener = (update: TraceStreamUpdate) => void | Promise<void>;

export type TraceStream = {
  push(event: EventRecord): TraceTreeSnapshot;
  pushMany(events: EventRecord[]): TraceTreeSnapshot;
  snapshot(): TraceTreeSnapshot;
  subscribe(listener: TraceStreamListener): () => void;
};

export function createTraceStream(input: {
  mapEvent?: TraceTreeEventMapper;
} = {}): TraceStream {
  const tree = createTraceTree({ mapEvent: input.mapEvent });
  const listeners = new Set<TraceStreamListener>();
  return {
    push(event) {
      const snapshot = tree.push(event);
      for (const listener of listeners) {
        void listener({ event, snapshot });
      }
      return snapshot;
    },
    pushMany(events) {
      let snapshot = tree.snapshot();
      for (const event of events) {
        snapshot = this.push(event);
      }
      return snapshot;
    },
    snapshot() {
      return tree.snapshot();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
