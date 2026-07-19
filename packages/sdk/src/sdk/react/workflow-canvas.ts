import {
  createElement,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import {
  computeWorkflowRenderLayout,
  workflowRenderLayoutProfiles,
  workflowRenderSemanticLabel,
  type WorkflowRenderLayout,
  type WorkflowRenderLayoutBox,
  type WorkflowRenderLayoutEdge,
  type WorkflowRenderLayoutProfile,
  type WorkflowRendererAdapter,
  type WorkflowRenderModel,
  type WorkflowRenderNode,
} from "../client/workflow-render/index.js";
export type WorkflowCanvasProps = {
  ariaLabel?: string;
  autoFit?: boolean;
  className?: string;
  layoutProfile?: WorkflowRenderLayoutProfile;
  model: WorkflowRenderModel;
  onSelectNode?(nodeId: string | undefined): void;
  renderNodeDetails?(node: WorkflowRenderNode): ReactNode;
  selectedNodeId?: string;
  showControls?: boolean;
  showInspector?: boolean;
  style?: CSSProperties;
};
export type WorkflowReactCanvasAdapterOptions = Omit<WorkflowCanvasProps, "model">;
type ViewportTransform = { scale: number; x: number; y: number };
const minimumScale = 0.2;
const maximumScale = 2;
const fitPadding = 44;
export const workflowReactCanvasAdapter: WorkflowRendererAdapter<
  WorkflowReactCanvasAdapterOptions,
  ReactElement
> = {
  id: "sdk.react.workflow-canvas",
  target: "react",
  render(model, options) {
    return createElement(WorkflowCanvas, { ...options, model });
  },
};
export function WorkflowCanvas(props: WorkflowCanvasProps): ReactElement {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    pointerX: number;
    pointerY: number;
    x: number;
    y: number;
  } | undefined>(undefined);
  const markerId = `dromio-canvas-arrow-${useId().replaceAll(":", "")}`;
  const layout = useMemo(
    () => computeWorkflowRenderLayout(props.model, props.layoutProfile ?? workflowRenderLayoutProfiles.web),
    [props.layoutProfile, props.model],
  );
  const nodeByLayoutId = useMemo(() => workflowNodeByLayoutId(props.model), [props.model]);
  const [internalSelectedNodeId, setInternalSelectedNodeId] = useState<string>();
  const [transform, setTransform] = useState<ViewportTransform>({ scale: 1, x: fitPadding, y: fitPadding });
  const selectedNodeId = props.selectedNodeId ?? internalSelectedNodeId ?? props.model.selectedNodeId;
  const selectedNode = selectedNodeId ? findWorkflowNode(props.model, selectedNodeId) : undefined;

  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const availableWidth = Math.max(1, viewport.clientWidth - fitPadding * 2);
    const availableHeight = Math.max(1, viewport.clientHeight - fitPadding * 2);
    const scale = clamp(Math.min(availableWidth / layout.width, availableHeight / layout.height), minimumScale, 1);
    setTransform({
      scale,
      x: (viewport.clientWidth - layout.width * scale) / 2,
      y: (viewport.clientHeight - layout.height * scale) / 2,
    });
  }, [layout.height, layout.width]);

  useEffect(() => {
    if (props.autoFit === false) return;
    fit();
    if (typeof ResizeObserver === "undefined" || !viewportRef.current) return;
    const observer = new ResizeObserver(fit);
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, [fit, props.autoFit]);

  function selectNode(nodeId: string | undefined) {
    setInternalSelectedNodeId(nodeId);
    props.onSelectNode?.(nodeId);
  }

  function zoomTo(nextScale: number, anchor?: { x: number; y: number }) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const scale = clamp(nextScale, minimumScale, maximumScale);
    const point = anchor ?? { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
    setTransform((current) => {
      const worldX = (point.x - current.x) / current.scale;
      const worldY = (point.y - current.y) / current.scale;
      return {
        scale,
        x: point.x - worldX * scale,
        y: point.y - worldY * scale,
      };
    });
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    zoomTo(transform.scale * (event.deltaY > 0 ? 0.9 : 1.1), {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  }

  function beginPan(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as Element).closest("button")) return;
    dragRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: transform.x,
      y: transform.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.dragging = "true";
  }

  function pan(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setTransform((current) => ({
      ...current,
      x: drag.x + event.clientX - drag.pointerX,
      y: drag.y + event.clientY - drag.pointerY,
    }));
  }

  function endPan(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    event.currentTarget.dataset.dragging = "false";
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const delta = event.shiftKey ? 80 : 28;
    if (event.key === "+" || event.key === "=") zoomTo(transform.scale * 1.15);
    else if (event.key === "-") zoomTo(transform.scale / 1.15);
    else if (event.key === "0") fit();
    else if (event.key === "ArrowLeft") setTransform((value) => ({ ...value, x: value.x + delta }));
    else if (event.key === "ArrowRight") setTransform((value) => ({ ...value, x: value.x - delta }));
    else if (event.key === "ArrowUp") setTransform((value) => ({ ...value, y: value.y + delta }));
    else if (event.key === "ArrowDown") setTransform((value) => ({ ...value, y: value.y - delta }));
    else return;
    event.preventDefault();
  }

  return createElement(
    "section",
    {
      className: props.className,
      "data-dromio-workflow-canvas": props.model.id,
      style: { ...canvasShellStyle, ...props.style },
    },
    props.showControls === false ? undefined : createElement(CanvasControls, {
      fit,
      scale: transform.scale,
      zoomIn: () => zoomTo(transform.scale * 1.15),
      zoomOut: () => zoomTo(transform.scale / 1.15),
    }),
    createElement(
      "div",
      {
        "aria-label": props.ariaLabel ?? `${props.model.label} workflow canvas`,
        "aria-roledescription": "interactive workflow canvas",
        "data-dragging": "false",
        onKeyDown: handleKeyDown,
        onPointerCancel: endPan,
        onPointerDown: beginPan,
        onPointerMove: pan,
        onPointerUp: endPan,
        onWheel: handleWheel,
        ref: viewportRef,
        role: "application",
        style: viewportStyle,
        tabIndex: 0,
      },
      createElement(
        "div",
        {
          "data-dromio-canvas-world": true,
          style: {
            height: layout.height,
            left: 0,
            position: "absolute",
            top: 0,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: "0 0",
            width: layout.width,
          } satisfies CSSProperties,
        },
        createElement(CanvasEdges, { layout, markerId, nodeByLayoutId }),
        layout.boxes.slice().sort((left, right) => left.zIndex - right.zIndex).map((box, index) =>
          createElement(CanvasBox, {
            box,
            index,
            key: box.id,
            node: nodeByLayoutId.get(box.id),
            onSelect: selectNode,
            selectedNodeId,
          })
        ),
      ),
      createElement("div", { style: helpStyle }, "Drag to pan · Scroll to zoom · Select a step to inspect"),
      props.showInspector === false || !selectedNode
        ? undefined
        : createElement(NodeInspector, {
          close: () => selectNode(undefined),
          node: selectedNode,
          renderNodeDetails: props.renderNodeDetails,
        }),
    ),
  );
}

function CanvasControls(props: { fit(): void; scale: number; zoomIn(): void; zoomOut(): void }) {
  return createElement("div", { "aria-label": "Workflow canvas controls", style: controlsStyle },
    createElement("button", { "aria-label": "Zoom out", onClick: props.zoomOut, style: controlButtonStyle, type: "button" }, "−"),
    createElement("output", { style: zoomOutputStyle }, `${Math.round(props.scale * 100)}%`),
    createElement("button", { "aria-label": "Zoom in", onClick: props.zoomIn, style: controlButtonStyle, type: "button" }, "+"),
    createElement("button", { onClick: props.fit, style: controlButtonStyle, type: "button" }, "Fit"),
  );
}

function CanvasEdges(props: {
  layout: WorkflowRenderLayout;
  markerId: string;
  nodeByLayoutId: Map<string, WorkflowRenderNode>;
}) {
  const selectedRoute = props.layout.edges.some((edge) => edge.semantic.role === "route" && edge.semantic.route.selected);
  return createElement("svg", {
    "aria-hidden": true,
    height: props.layout.height,
    style: { inset: 0, overflow: "visible", pointerEvents: "none", position: "absolute" },
    viewBox: `0 0 ${props.layout.width} ${props.layout.height}`,
    width: props.layout.width,
  },
  createElement("defs", undefined,
    createElement("marker", { id: props.markerId, markerHeight: 8, markerWidth: 8, orient: "auto", refX: 7, refY: 4 },
      createElement("path", { d: "M0,0 L8,4 L0,8 z", fill: "context-stroke" }),
    ),
  ),
  props.layout.edges.map((edge) => createElement(CanvasEdge, {
    edge,
    faded: selectedRoute && edge.semantic.role === "route" && !edge.semantic.route.selected,
    key: edge.id,
    markerId: props.markerId,
    source: props.nodeByLayoutId.get(edge.sourceBoxId),
    target: props.nodeByLayoutId.get(edge.targetBoxId),
  })));
}

function CanvasEdge(props: {
  edge: WorkflowRenderLayoutEdge;
  faded: boolean;
  markerId: string;
  source?: WorkflowRenderNode;
  target?: WorkflowRenderNode;
}) {
  const selected = props.edge.semantic.role === "route" && props.edge.semantic.route.selected;
  const status = props.target?.status === "running" || props.source?.status === "running"
    ? "running"
    : props.target?.status === "completed" ? "completed" : undefined;
  const stroke = status === "completed" ? "#22c55e" : status === "running" || selected ? "#00a5ef" : "#71717a";
  const midpoint = props.edge.points[Math.floor(props.edge.points.length / 2)];
  return createElement("g", {
    "data-edge-kind": props.edge.kind,
    "data-edge-status": status ?? "idle",
    "data-route-selected": selected,
    opacity: props.faded ? 0.2 : 1,
  },
  createElement("polyline", {
    fill: "none",
    markerEnd: `url(#${props.markerId})`,
    points: props.edge.points.map((point) => `${point.x},${point.y}`).join(" "),
    stroke,
    strokeDasharray: status === "running" ? "6 7" : props.edge.kind === "loop" || props.edge.kind === "merge" ? "5 5" : undefined,
    strokeWidth: selected ? 3 : 1.5,
  }),
  props.edge.label && midpoint
    ? createElement("text", { fill: "#a1a1aa", fontSize: 10, textAnchor: "middle", x: midpoint.x, y: midpoint.y - 8 }, props.edge.label)
    : undefined);
}

function CanvasBox(props: {
  box: WorkflowRenderLayoutBox;
  index: number;
  node?: WorkflowRenderNode;
  onSelect(nodeId: string): void;
  selectedNodeId?: string;
}) {
  const position = {
    height: props.box.height,
    left: props.box.x,
    position: "absolute",
    top: props.box.y,
    width: props.box.width,
  } satisfies CSSProperties;
  if (props.box.kind === "child-group" || props.box.kind === "loop-group") {
    return createElement("div", {
      "data-canvas-group": props.box.kind,
      style: {
        ...position,
        background: "rgba(255,255,255,.018)",
        border: `1px dashed ${props.box.kind === "loop-group" ? "rgba(234,179,8,.35)" : "rgba(255,255,255,.16)"}`,
        borderRadius: 12,
        boxSizing: "border-box",
        color: "#71717a",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: ".08em",
        padding: "11px 13px",
        textTransform: "uppercase",
      },
    }, props.box.label);
  }
  if (props.box.kind === "initial") {
    return createElement("span", {
      "aria-label": props.box.label || "Initial state",
      role: "img",
      style: {
        ...position,
        background: "#f4f4f5",
        border: "5px solid #f4f4f5",
        borderRadius: 999,
        boxShadow: "0 0 0 3px rgba(244,244,245,.14)",
        boxSizing: "border-box",
      },
    });
  }
  const node = props.node;
  const semantic = node ? workflowRenderSemanticLabel(node.semantic) : props.box.kind;
  const selected = node?.id === props.selectedNodeId;
  const status = node?.status ?? "pending";
  return createElement("button", {
    "aria-label": `${props.box.label}, ${semantic}, ${status}`,
    "data-node-semantic": node?.semantic.role ?? props.box.kind,
    "data-node-status": status,
    "data-selected": selected,
    disabled: !node,
    onClick: () => node && props.onSelect(node.id),
    style: { ...position, ...nodeStyle(status, selected, Boolean(props.box.parentId)) },
    type: "button",
  },
  createElement("span", { style: nodeIconStyle(status) }, iconFor(node?.semantic.role ?? props.box.kind)),
  createElement("strong", { style: nodeLabelStyle }, props.box.label),
  createElement("span", { style: tagsStyle },
    createElement("span", { style: tagStyle }, semantic),
    status === "pending" ? undefined : createElement("span", { style: statusTagStyle(status) }, status),
    node?.childWorkflow ? createElement("span", { style: tagStyle }, "child workflow") : undefined,
  ));
}

function NodeInspector(props: {
  close(): void;
  node: WorkflowRenderNode;
  renderNodeDetails?: WorkflowCanvasProps["renderNodeDetails"];
}) {
  return createElement("aside", { "aria-label": "Selected workflow step", style: inspectorStyle },
    createElement("button", { "aria-label": "Close step inspector", onClick: props.close, style: closeButtonStyle, type: "button" }, "×"),
    createElement("span", { style: inspectorEyebrowStyle }, workflowRenderSemanticLabel(props.node.semantic)),
    createElement("h3", { style: inspectorHeadingStyle }, props.node.label),
    createElement("span", { style: statusTagStyle(props.node.status ?? "pending") }, props.node.status ?? "pending"),
    props.node.description ? createElement("p", { style: inspectorCopyStyle }, props.node.description) : undefined,
    createElement("dl", { style: inspectorListStyle },
      createElement("dt", { style: inspectorTermStyle }, "Step"),
      createElement("dd", { style: inspectorValueStyle }, props.node.id),
      props.node.catalogItemId ? createElement("dt", { style: inspectorTermStyle }, "Catalog item") : undefined,
      props.node.catalogItemId ? createElement("dd", { style: inspectorValueStyle }, props.node.catalogItemId) : undefined,
    ),
    props.renderNodeDetails?.(props.node),
  );
}

function workflowNodeByLayoutId(model: WorkflowRenderModel, prefix = ""): Map<string, WorkflowRenderNode> {
  const nodes = new Map<string, WorkflowRenderNode>();
  for (const node of model.nodes) {
    const layoutId = `${prefix}${node.id}`;
    nodes.set(layoutId, node);
    if (!node.childWorkflow) continue;
    for (const [id, childNode] of workflowNodeByLayoutId(node.childWorkflow.model, `${layoutId}:child:`)) nodes.set(id, childNode);
  }
  return nodes;
}

function findWorkflowNode(model: WorkflowRenderModel, nodeId: string): WorkflowRenderNode | undefined {
  for (const node of model.nodes) {
    if (node.id === nodeId) return node;
    const child = node.childWorkflow && findWorkflowNode(node.childWorkflow.model, nodeId);
    if (child) return child;
  }
  return undefined;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function iconFor(role: string) {
  const icons: Record<string, string> = {
    approval: "✓", child: "▣", end: "■", evaluation: "◎", fork: "⑂", initial: "●",
    join: "⋈", loop: "↻", question: "?", result: "◆", route: "◇", router: "◇", trigger: "↗",
  };
  return icons[role] ?? "→";
}

function nodeStyle(status: string, selected: boolean, nested: boolean): CSSProperties {
  const statusColor: Record<string, string> = {
    completed: "rgba(34,197,94,.72)", failed: "#ef4444", running: "#00a5ef", waiting: "#eab308",
  };
  return {
    alignItems: "center",
    background: nested ? "#202020" : "#181818",
    border: `1px solid ${selected ? "#00a5ef" : statusColor[status] ?? "#3f3f46"}`,
    borderRadius: 9,
    boxShadow: selected ? "0 0 0 2px rgba(0,165,239,.28), 0 12px 30px rgba(0,0,0,.3)" : "0 10px 28px rgba(0,0,0,.22)",
    color: "#f4f4f5",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 9,
    justifyContent: "center",
    padding: 13,
    textAlign: "center",
  };
}

function nodeIconStyle(status: string): CSSProperties {
  return {
    alignItems: "center", background: "#232323", border: "1px solid #3f3f46", borderRadius: 6,
    color: status === "completed" ? "#22c55e" : status === "running" ? "#00a5ef" : "#a1a1aa",
    display: "flex", fontSize: 16, height: 30, justifyContent: "center", width: 30,
  };
}

function statusTagStyle(status: string): CSSProperties {
  const color: Record<string, string> = {
    completed: "#22c55e", failed: "#ef4444", pending: "#a1a1aa", running: "#00a5ef", skipped: "#a1a1aa", waiting: "#eab308",
  };
  return { ...tagStyle, color: color[status] ?? "#a1a1aa" };
}

const canvasShellStyle: CSSProperties = {
  background: "#111", border: "1px solid #2d2d30", borderRadius: 12, color: "#f4f4f5",
  minHeight: 520, overflow: "hidden", position: "relative",
};
const viewportStyle: CSSProperties = {
  cursor: "grab", height: "100%", inset: 0, minHeight: 520, overflow: "hidden", position: "absolute", touchAction: "none",
};
const controlsStyle: CSSProperties = {
  alignItems: "center", background: "rgba(24,24,24,.94)", border: "1px solid #3f3f46", borderRadius: 8,
  display: "flex", gap: 3, padding: 4, position: "absolute", right: 12, top: 12, zIndex: 5,
};
const controlButtonStyle: CSSProperties = {
  background: "#232323", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7", cursor: "pointer",
  font: "600 12px ui-sans-serif,system-ui,sans-serif", minHeight: 29, minWidth: 29, padding: "4px 9px",
};
const zoomOutputStyle: CSSProperties = { color: "#a1a1aa", font: "10px ui-monospace,monospace", minWidth: 38, textAlign: "center" };
const helpStyle: CSSProperties = { bottom: 10, color: "#71717a", fontSize: 10, left: 14, pointerEvents: "none", position: "absolute" };
const nodeLabelStyle: CSSProperties = { fontSize: 13, lineHeight: 1.25 };
const tagsStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" };
const tagStyle: CSSProperties = {
  background: "rgba(255,255,255,.06)", borderRadius: 999, color: "#a1a1aa", fontSize: 8, fontWeight: 700,
  letterSpacing: ".05em", padding: "3px 6px", textTransform: "uppercase",
};
const inspectorStyle: CSSProperties = {
  background: "rgba(24,24,24,.97)", border: "1px solid #3f3f46", borderRadius: 10, bottom: 38, boxShadow: "0 16px 44px rgba(0,0,0,.38)",
  color: "#f4f4f5", display: "grid", gap: 10, maxWidth: 300, padding: 16, position: "absolute", right: 14, width: "calc(100% - 60px)", zIndex: 4,
};
const closeButtonStyle: CSSProperties = { ...controlButtonStyle, position: "absolute", right: 8, top: 8 };
const inspectorEyebrowStyle: CSSProperties = { color: "#00a5ef", fontSize: 9, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" };
const inspectorHeadingStyle: CSSProperties = { fontSize: 16, margin: 0, paddingRight: 24 };
const inspectorCopyStyle: CSSProperties = { color: "#a1a1aa", fontSize: 12, lineHeight: 1.5, margin: 0 };
const inspectorListStyle: CSSProperties = { display: "grid", gap: 5, gridTemplateColumns: "88px 1fr", margin: 0 };
const inspectorTermStyle: CSSProperties = { color: "#71717a", fontSize: 10, fontWeight: 700, textTransform: "uppercase" };
const inspectorValueStyle: CSSProperties = { color: "#d4d4d8", fontFamily: "ui-monospace,monospace", fontSize: 10, margin: 0, overflowWrap: "anywhere" };
