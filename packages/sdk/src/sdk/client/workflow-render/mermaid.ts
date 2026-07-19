import type {
  WorkflowRendererAdapter,
  WorkflowRenderModel,
  WorkflowRenderNode,
} from "./types.js";
import { workflowRenderSemanticLabel } from "@dromio/workflow-canvas-protocol";

export type WorkflowMermaidRenderDirection = "BT" | "LR" | "RL" | "TB";

export type WorkflowMermaidRenderOptions = {
  direction?: WorkflowMermaidRenderDirection;
  includeStatus?: boolean;
};

export const workflowMermaidRenderer: WorkflowRendererAdapter<
  WorkflowMermaidRenderOptions,
  string
> = {
  id: "sdk.mermaid.workflow",
  target: "mermaid",
  render(model, options) {
    return renderWorkflowModelToMermaid(model, options);
  },
};

export function renderWorkflowModelToMermaid(
  model: WorkflowRenderModel,
  options: WorkflowMermaidRenderOptions = {},
): string {
  const direction = options.direction ?? "LR";
  const nodeIds = new Map(model.nodes.map((node, index) => [node.id, `n${index}`]));
  const lines = [`flowchart ${direction}`];

  for (const node of model.nodes) {
    const mermaidNodeId = requireMermaidNodeId(nodeIds, node.id);
    lines.push(
      `  ${mermaidNodeId}["${renderNodeLabel(node, options)}"]:::${nodeClass(node)}`,
    );
  }

  for (const edge of model.edges) {
    const source = requireMermaidNodeId(nodeIds, edge.source, edge.id);
    const target = requireMermaidNodeId(nodeIds, edge.target, edge.id);
    const edgeText = edge.semantic.role === "route" && edge.semantic.route.selected
      ? `✓ ${edge.semantic.route.label}`
      : edge.label;
    const label = edgeText ? `|${escapeMermaidText(edgeText)}|` : "";
    lines.push(`  ${source} -->${label} ${target}`);
  }

  lines.push(
    "  classDef kindTrigger fill:#e9f7ff,stroke:#0369a1,color:#0f172a;",
    "  classDef kindInitial fill:#0f172a,stroke:#0f172a,color:#0f172a;",
    "  classDef kindStep fill:#f8fafc,stroke:#475569,color:#0f172a;",
    "  classDef kindWorkflow fill:#f5f3ff,stroke:#7c3aed,color:#0f172a;",
    "  classDef kindGroup fill:#fefce8,stroke:#a16207,color:#0f172a;",
    "  classDef kindEnd fill:#ecfdf5,stroke:#047857,color:#0f172a;",
  );

  return `${lines.join("\n")}\n`;
}

function renderNodeLabel(
  node: WorkflowRenderNode,
  options: WorkflowMermaidRenderOptions,
): string {
  const parts = [node.label, workflowRenderSemanticLabel(node.semantic)];
  if (options.includeStatus && node.status) parts.push(node.status);
  return parts.map(escapeMermaidText).join("<br/>");
}

function nodeClass(node: WorkflowRenderNode) {
  if (node.semantic.role === "trigger") return "kindTrigger";
  if (node.semantic.role === "boundary") return "kindInitial";
  if (node.semantic.role === "terminal" || node.semantic.role === "join" || node.semantic.role === "merge") return "kindEnd";
  if (node.semantic.role === "workflow" || node.semantic.role === "router" || node.semantic.role === "fork") return "kindWorkflow";
  if (node.semantic.role === "group") return "kindGroup";
  return "kindStep";
}

function requireMermaidNodeId(
  nodeIds: Map<string, string>,
  renderNodeId: string,
  edgeId?: string,
): string {
  const nodeId = nodeIds.get(renderNodeId);
  if (nodeId) return nodeId;
  const edgeContext = edgeId ? ` for edge ${edgeId}` : "";
  throw new Error(`Cannot render Mermaid workflow${edgeContext}: missing node ${renderNodeId}.`);
}

function escapeMermaidText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;");
}
