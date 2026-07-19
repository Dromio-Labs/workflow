import {
  createElement,
  type CSSProperties,
  type RefObject,
  type ReactElement,
  useEffect,
  useRef,
} from "react";
import type {
  WorkflowRenderLayoutEdge,
  WorkflowRendererAdapter,
  WorkflowRenderModel,
  WorkflowRenderNode,
} from "../client/workflow-render/index.js";
import {
  computeWorkflowRenderLayout,
  workflowRenderSemanticLabel,
  workflowRenderLayoutProfiles,
} from "../client/workflow-render/index.js";

export type WorkflowCanvasPreviewProps = {
  className?: string;
  model: WorkflowRenderModel;
  selectedNodeId?: string;
  style?: CSSProperties;
  onSelectNode?(nodeId: string): void;
};

export type WorkflowReactPreviewAdapterOptions = Omit<WorkflowCanvasPreviewProps, "model">;

const nodeWidth = 184;
const nodeHeight = 76;
const padding = 40;

type WorkflowPreviewLayoutNode = WorkflowRenderNode & {
  layoutId: string;
  layoutPosition: {
    x: number;
    y: number;
  };
};

type WorkflowPreviewLayout = {
  edges: WorkflowRenderLayoutEdge[];
  height: number;
  nodes: WorkflowPreviewLayoutNode[];
  width: number;
};

export const workflowReactPreviewAdapter: WorkflowRendererAdapter<
  WorkflowReactPreviewAdapterOptions,
  ReactElement
> = {
  id: "sdk.react.workflow-preview",
  target: "react",
  render(model, options) {
    return createElement(WorkflowCanvasPreview, {
      ...options,
      model,
    });
  },
};

export function WorkflowCanvasPreview(props: WorkflowCanvasPreviewProps): ReactElement {
  const layout = workflowCanvasPreviewLayout(props.model);
  const selectedNodeId = props.selectedNodeId ?? props.model.selectedNodeId;
  const selectedNodeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (typeof selectedNodeRef.current?.scrollIntoView !== "function") return;
    selectedNodeRef.current.scrollIntoView({
      block: "center",
      inline: "center",
    });
  }, [selectedNodeId]);
  return createElement(
    "div",
    {
      className: props.className,
      "data-dromio-workflow-preview": props.model.id,
      style: {
        background: "#f8fafc",
        border: "1px solid #d8dee8",
        borderRadius: 8,
        color: "#172033",
        minHeight: layout.height,
        minWidth: layout.width,
        overflow: "auto",
        position: "relative",
        ...props.style,
      } satisfies CSSProperties,
    },
    createElement(WorkflowEdgesSvg, {
      layout,
    }),
    layout.nodes.map((node) =>
      createElement(WorkflowPreviewNode, {
        key: node.layoutId,
        node,
        nodeRef: selectedNodeId === node.id ? selectedNodeRef : undefined,
        onSelectNode: props.onSelectNode,
        selected: selectedNodeId === node.id,
      })
    ),
    props.model.warnings.length
      ? createElement("div", {
        style: warningStyle,
      }, props.model.warnings.join(" "))
      : undefined,
  );
}

function WorkflowEdgesSvg(props: {
  layout: WorkflowPreviewLayout;
}) {
  const nodeById = new Map(props.layout.nodes.map((node) => [node.layoutId, node]));
  return createElement(
    "svg",
    {
      "aria-label": `Workflow connections: ${props.layout.edges.map(edgeAccessibleLabel).join(", ")}`,
      height: props.layout.height,
      role: "img",
      style: {
        inset: 0,
        pointerEvents: "none",
        position: "absolute",
      } satisfies CSSProperties,
      width: props.layout.width,
    },
    props.layout.edges.flatMap((edge) => {
      const source = nodeById.get(edge.sourceBoxId);
      const target = nodeById.get(edge.targetBoxId);
      if (!source || !target) return [];
      const start = nodeCenter(source);
      const end = nodeCenter(target);
      const startY = start.y + nodeHeight / 2;
      const endY = end.y - nodeHeight / 2;
      const midY = startY + Math.max(36, (endY - startY) / 2);
      const selected = edge.semantic.role === "route" && edge.semantic.route.selected;
      return createElement("g", { key: edge.id },
        createElement("path", {
          "aria-label": edgeAccessibleLabel(edge),
          d: `M ${start.x} ${startY} C ${start.x} ${midY}, ${end.x} ${midY}, ${end.x} ${endY}`,
          fill: "none",
          role: "img",
          stroke: selected ? "#2563eb" : "#64748b",
          strokeDasharray: selected ? undefined : edge.semantic.role === "merge" ? "5 4" : undefined,
          strokeWidth: selected ? 4 : 2,
          tabIndex: edge.label ? 0 : -1,
        }),
        edge.label
          ? createElement("text", {
            fill: selected ? "#1d4ed8" : "#334155",
            fontSize: 12,
            textAnchor: "middle",
            x: (start.x + end.x) / 2,
            y: midY - 6,
          }, `${selected ? "✓ " : ""}${edge.label}`)
          : undefined,
      );
    }),
  );
}

function WorkflowPreviewNode(props: {
  nodeRef?: RefObject<HTMLButtonElement | null>;
  node: WorkflowPreviewLayoutNode;
  selected: boolean;
  onSelectNode?(nodeId: string): void;
}) {
  return createElement(
    "button",
    {
      "aria-label": `${props.node.label}, ${workflowRenderSemanticLabel(props.node.semantic)}${props.node.status ? `, ${props.node.status}` : ""}`,
      "data-layout-id": props.node.layoutId,
      "data-layout-x": props.node.layoutPosition.x,
      "data-layout-y": props.node.layoutPosition.y,
      "data-node-kind": props.node.kind,
      "data-node-semantic": props.node.semantic.role,
      "data-node-status": props.node.status ?? "pending",
      onClick: () => props.onSelectNode?.(props.node.id),
      ref: props.nodeRef,
      style: {
        ...nodeStyle,
        borderColor: props.selected ? "#2563eb" : "#cbd5e1",
        boxShadow: props.selected ? "0 0 0 3px rgba(37, 99, 235, 0.18)" : "0 8px 20px rgba(15, 23, 42, 0.08)",
        left: props.node.layoutPosition.x + padding,
        top: props.node.layoutPosition.y + padding,
      } satisfies CSSProperties,
      type: "button",
    },
    createElement("span", { style: kindStyle }, workflowRenderSemanticLabel(props.node.semantic)),
    createElement("strong", { style: labelStyle }, props.node.label),
    props.node.status
      ? createElement("span", { style: statusStyle(props.node.status) }, props.node.status)
      : undefined,
  );
}

function edgeAccessibleLabel(edge: WorkflowRenderLayoutEdge) {
  if (edge.semantic.role === "route") {
    return `${edge.semantic.route.label} route, ${edge.semantic.route.selected ? "selected" : "not selected"}`;
  }
  if (edge.semantic.role === "branch") return `${edge.semantic.branch.label} branch`;
  if (edge.semantic.role === "join") return `${edge.semantic.policy} join`;
  return edge.label ? `${edge.semantic.role}: ${edge.label}` : edge.semantic.role;
}

function nodeCenter(node: WorkflowPreviewLayoutNode) {
  return {
    x: node.layoutPosition.x + padding + nodeWidth / 2,
    y: node.layoutPosition.y + padding + nodeHeight / 2,
  };
}

export function workflowCanvasPreviewLayout(model: WorkflowRenderModel): WorkflowPreviewLayout {
  const renderLayout = computeWorkflowRenderLayout(model, workflowRenderLayoutProfiles.reactPreview);
  const nodeByLayoutId = workflowNodeByLayoutId(model);
  const layoutNodes = renderLayout.boxes.flatMap((box) => {
    if (box.kind === "child-group" || box.kind === "loop-group") return [];
    const node = nodeByLayoutId.get(box.id);
    if (!node) return [];
    return [{
      ...node,
      layoutId: box.id,
      layoutPosition: {
        x: box.x,
        y: box.y,
      },
    }];
  });

  return {
    edges: renderLayout.edges,
    height: renderLayout.height + padding * 2,
    nodes: layoutNodes,
    width: renderLayout.width + padding * 2,
  };
}

function workflowNodeByLayoutId(model: WorkflowRenderModel, prefix = "") {
  const nodes = new Map<string, WorkflowRenderNode>();
  for (const node of model.nodes) {
    const layoutId = `${prefix}${node.id}`;
    nodes.set(layoutId, node);
    if (!node.childWorkflow) continue;
    for (const [childLayoutId, childNode] of workflowNodeByLayoutId(node.childWorkflow.model, `${layoutId}:child:`)) {
      nodes.set(childLayoutId, childNode);
    }
  }
  return nodes;
}

function statusStyle(status: string): CSSProperties {
  const colors: Record<string, string> = {
    completed: "#15803d",
    failed: "#b91c1c",
    pending: "#64748b",
    running: "#0369a1",
    skipped: "#64748b",
    waiting: "#a16207",
  };
  return {
    color: colors[status] ?? "#64748b",
    fontSize: 12,
    lineHeight: "16px",
    textTransform: "capitalize",
  };
}

const nodeStyle: CSSProperties = {
  alignItems: "flex-start",
  background: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  height: nodeHeight,
  padding: "10px 12px",
  position: "absolute",
  textAlign: "left",
  width: nodeWidth,
};

const kindStyle: CSSProperties = {
  color: "#475569",
  fontSize: 11,
  letterSpacing: 0,
  lineHeight: "14px",
  textTransform: "uppercase",
};

const labelStyle: CSSProperties = {
  color: "#0f172a",
  fontSize: 14,
  lineHeight: "18px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  width: "100%",
};

const warningStyle: CSSProperties = {
  bottom: 12,
  color: "#92400e",
  fontSize: 12,
  left: padding,
  position: "absolute",
};
