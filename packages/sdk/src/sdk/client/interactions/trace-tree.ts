import type {
  EventRecord,
  TraceContext,
} from "../../core/index.js";

export type TraceTreeEventMapper = (event: EventRecord) => TraceContext | undefined;

export type TraceTreeNode = {
  attributes: NonNullable<TraceContext["attributes"]>;
  children: TraceTreeNode[];
  events: EventRecord[];
  kind: TraceContext["kind"];
  name: string;
  parentSpanId?: string;
  spanId: string;
  status: NonNullable<TraceContext["status"]>;
  traceId: string;
};

export type TraceTreeSnapshot = {
  nodes: TraceTreeNode[];
  orphanEvents: EventRecord[];
};

export type TraceTree = {
  push(event: EventRecord): TraceTreeSnapshot;
  pushMany(events: EventRecord[]): TraceTreeSnapshot;
  snapshot(): TraceTreeSnapshot;
};

export function createTraceTree(input: {
  mapEvent?: TraceTreeEventMapper;
} = {}): TraceTree {
  const nodes = new Map<string, MutableTraceTreeNode>();
  const events: EventRecord[] = [];
  const orphanEvents: EventRecord[] = [];

  return {
    push(event) {
      events.push(event);
      const trace = event.trace ?? input.mapEvent?.(event);
      if (!trace) {
        orphanEvents.push(event);
        return snapshot(nodes, orphanEvents);
      }
      const node = upsertNode(nodes, trace);
      node.events.push(event);
      return snapshot(nodes, orphanEvents);
    },
    pushMany(nextEvents) {
      for (const event of nextEvents) {
        this.push(event);
      }
      return snapshot(nodes, orphanEvents);
    },
    snapshot() {
      void events;
      return snapshot(nodes, orphanEvents);
    },
  };
}

export function projectTraceTree(
  events: EventRecord[],
  input: { mapEvent?: TraceTreeEventMapper } = {},
) {
  return createTraceTree(input).pushMany(events);
}

type MutableTraceTreeNode = Omit<TraceTreeNode, "children"> & {
  children: MutableTraceTreeNode[];
};

function upsertNode(nodes: Map<string, MutableTraceTreeNode>, trace: TraceContext) {
  const id = nodeKey(trace.traceId, trace.spanId);
  let node = nodes.get(id);
  if (!node) {
    node = {
      attributes: trace.attributes ?? {},
      children: [],
      events: [],
      kind: trace.kind ?? "internal",
      name: trace.name,
      parentSpanId: trace.parentSpanId,
      spanId: trace.spanId,
      status: trace.status ?? "unset",
      traceId: trace.traceId,
    };
    nodes.set(id, node);
  } else {
    node.attributes = { ...node.attributes, ...trace.attributes };
    node.kind = trace.kind ?? node.kind;
    node.name = trace.name || node.name;
    node.parentSpanId = trace.parentSpanId ?? node.parentSpanId;
    node.status = combineStatus(node.status, trace.status ?? "unset");
  }
  if (trace.parentSpanId) {
    const parent = upsertNode(nodes, {
      name: trace.parentSpanId,
      spanId: trace.parentSpanId,
      status: "unset",
      traceId: trace.traceId,
    });
    if (!parent.children.some((child) => child.spanId === node.spanId && child.traceId === node.traceId)) {
      parent.children.push(node);
    }
  }
  return node;
}

function snapshot(nodes: Map<string, MutableTraceTreeNode>, orphanEvents: EventRecord[]): TraceTreeSnapshot {
  const childKeys = new Set<string>();
  for (const node of nodes.values()) {
    for (const child of node.children) {
      childKeys.add(nodeKey(child.traceId, child.spanId));
    }
  }
  return {
    nodes: [...nodes.values()]
      .filter((node) => !childKeys.has(nodeKey(node.traceId, node.spanId)))
      .map(cloneNode),
    orphanEvents: [...orphanEvents],
  };
}

function cloneNode(node: MutableTraceTreeNode): TraceTreeNode {
  return {
    ...node,
    attributes: { ...node.attributes },
    children: node.children.map(cloneNode),
    events: [...node.events],
  };
}

function nodeKey(traceId: string, spanId: string) {
  return `${traceId}:${spanId}`;
}

function combineStatus(
  current: NonNullable<TraceContext["status"]>,
  next: NonNullable<TraceContext["status"]>,
) {
  if (current === "error" || next === "error") return "error";
  if (current === "ok" || next === "ok") return "ok";
  return "unset";
}
