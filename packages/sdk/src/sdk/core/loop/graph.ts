import type {
  LoopBoundary,
  LoopConfig,
  LoopGraphBoundary,
  LoopGraphEdge,
  LoopGraphProjection,
} from "./loop.types.js";
import {
  normalizeOperationContract,
} from "../prompted-operation/contracts.js";

export function projectLoopGraph<TUse, TInput>(
  config: LoopConfig<TUse, TInput>,
): LoopGraphProjection {
  const trigger = config.trigger
    ? projectBoundary(config.trigger, "trigger", config.id)
    : undefined;
  const end = config.end
    ? projectBoundary(config.end, "end", config.id)
    : undefined;
  const nodes = config.steps.map((item) => {
    const input = projectPorts(item.input);
    const output = projectPorts(item.output);
    return {
      description: item.description,
      id: item.id,
      ...(input ? { input } : {}),
      kind: item.kind ?? "step",
      label: item.label ?? humanizeId(item.id),
      maxRetries: item.maxRetries ?? 1,
      ...(item.models?.length ? { models: item.models } : {}),
      ...(output ? { output } : {}),
    };
  });
  return {
    description: config.description,
    ...(end ? { end } : {}),
    edges: projectEdges(config, trigger, end),
    id: config.id,
    label: config.label ?? humanizeId(config.id),
    nodes,
    ...(trigger ? { trigger } : {}),
  };
}

function projectBoundary(
  boundary: LoopBoundary,
  kind: "end" | "trigger",
  workflowId: string,
): LoopGraphBoundary {
  const input = projectBoundaryPorts(boundary, "input", workflowId);
  const output = projectBoundaryPorts(boundary, "output", workflowId);
  return {
    boundary: kind,
    ...(boundary.config ? { config: boundary.config } : {}),
    description: boundary.description,
    id: boundary.id,
    ...(input ? { input } : {}),
    label: boundary.label ?? humanizeId(boundary.id),
    ...(output ? { output } : {}),
    ...(boundary.type ? { type: boundary.type } : {}),
  };
}

function projectEdges<TUse, TInput>(
  config: LoopConfig<TUse, TInput>,
  trigger: LoopGraphBoundary | undefined,
  end: LoopGraphBoundary | undefined,
): LoopGraphEdge[] {
  const edges = config.steps.slice(1).map((item, index) => ({
    from: config.steps[index]!.id,
    id: `${config.steps[index]!.id}->${item.id}`,
    kind: "sequence" as const,
    to: item.id,
  }));
  const first = config.steps[0];
  const last = config.steps.at(-1);
  if (trigger && first) {
    edges.unshift({
      from: trigger.id,
      id: `${trigger.id}->${first.id}`,
      kind: "sequence",
      to: first.id,
    });
  }
  if (end && last) {
    edges.push({
      from: last.id,
      id: `${last.id}->${end.id}`,
      kind: "sequence",
      to: end.id,
    });
  }
  if (trigger && end && !first) {
    edges.push({
      from: trigger.id,
      id: `${trigger.id}->${end.id}`,
      kind: "sequence",
      to: end.id,
    });
  }
  return edges;
}

function projectPorts(
  contracts: LoopConfig<unknown, unknown>["steps"][number]["input"],
) {
  const entries = Object.entries(contracts ?? {});
  if (entries.length === 0) return undefined;
  return entries.map(([key, contract]) => ({
    contractId: contract.id,
    jsonSchema: contract.jsonSchema,
    key,
  }));
}

function projectBoundaryPorts(
  boundary: LoopBoundary,
  side: "input" | "output",
  workflowId: string,
) {
  const entries = Object.entries(boundary[side] ?? {});
  if (entries.length === 0) return undefined;
  return entries.map(([key, source]) => {
    const contract = normalizeOperationContract(`${workflowId}.${boundary.id}.${side}.${key}`, source);
    return {
      contractId: contract.id,
      jsonSchema: contract.jsonSchema,
      key,
    };
  });
}

function humanizeId(value: string) {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}
