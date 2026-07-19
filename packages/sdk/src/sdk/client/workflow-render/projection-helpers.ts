import type {
  LoopGraphBoundary,
  LoopGraphPort,
} from "../../core/index.js";
import type {
  WorkflowRenderPort,
} from "./types.js";

export function boundaryPorts(
  boundary: LoopGraphBoundary,
  kind: "end" | "trigger",
): WorkflowRenderPort[] {
  if (kind === "trigger") return portsForSide(boundary.output ?? boundary.input, boundary.id, "source");
  return portsForSide(boundary.input ?? boundary.output, boundary.id, "target");
}

export function stepPorts(
  input: LoopGraphPort[] | undefined,
  output: LoopGraphPort[] | undefined,
  id: string,
) {
  return [
    ...portsForSide(input, id, "target"),
    ...portsForSide(output, id, "source"),
  ];
}

function portsForSide(
  ports: LoopGraphPort[] | undefined,
  nodeId: string,
  type: "source" | "target",
): WorkflowRenderPort[] {
  if (!ports?.length) return [{ id: `${nodeId}:${type === "source" ? "out" : "in"}`, type }];
  return ports.map((port) => ({
    id: `${nodeId}:${type}:${port.key}`,
    key: port.key,
    label: port.key,
    type,
  }));
}
