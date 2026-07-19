import { Flowchart } from "@kitlangton/merman";
import type {
  WorkflowRendererAdapter,
  WorkflowRenderModel,
} from "@dromio/workflow-canvas-protocol";
import {
  renderWorkflowModelToMermaid,
  type WorkflowMermaidRenderDirection,
} from "../workflow-render/index.js";
import type { WorkflowDiagramProjection } from "./workflow-diagram.js";

export type WorkflowOpenTuiMermanRenderOptions = {
  activeEdgeProgress?: number;
  color?: boolean;
  direction?: WorkflowMermaidRenderDirection;
  includeStatus?: boolean;
  minNodeGap?: number;
  minRankGap?: number;
};

export type WorkflowOpenTuiMermanRenderPlan = {
  activeEdge?: WorkflowDiagramProjection["activeEdge"];
  activeEdgeProgress?: number;
  activeNode?: string;
  content: string;
  minNodeGap: number;
  minRankGap: number;
  nodeBgColors: Record<string, string>;
  nodeColors: Record<string, string>;
  renderable: typeof Flowchart.Renderable;
};

export type WorkflowOpenTuiMermanParsedDiagram = ReturnType<typeof Flowchart.parse>;

export type WorkflowOpenTuiMermanRenderables = {
  workflow_flowchart: typeof Flowchart.Renderable;
};

export type WorkflowOpenTuiMermanRegister = (renderables: WorkflowOpenTuiMermanRenderables) => void;

export type WorkflowOpenTuiMermanRenderer = WorkflowRendererAdapter<
  WorkflowOpenTuiMermanRenderOptions,
  WorkflowOpenTuiMermanRenderPlan
> & {
  readonly engine: "merman";
  readonly renderable: typeof Flowchart.Renderable;
  readonly renderables: WorkflowOpenTuiMermanRenderables;
  install(register: WorkflowOpenTuiMermanRegister): void;
  parse(content: string): WorkflowOpenTuiMermanParsedDiagram;
  renderPlainProjection(
    projection: WorkflowDiagramProjection,
    options?: WorkflowOpenTuiMermanRenderOptions,
  ): string;
  renderProjection(
    projection: WorkflowDiagramProjection,
    options?: WorkflowOpenTuiMermanRenderOptions,
  ): WorkflowOpenTuiMermanRenderPlan;
};

let installed = false;

export const workflowOpenTuiMermanRenderer: WorkflowOpenTuiMermanRenderer = {
  engine: "merman",
  id: "sdk.opentui.merman.workflow",
  render(model, options = {}) {
    return workflowOpenTuiMermanRenderPlan({
      content: renderWorkflowModelToMermaid(model, {
        direction: options.direction,
        includeStatus: options.includeStatus,
      }),
      options,
    });
  },
  renderable: Flowchart.Renderable,
  renderables: {
    workflow_flowchart: Flowchart.Renderable,
  },
  target: "opentui",
  install(register) {
    if (installed) return;
    register(workflowOpenTuiMermanRenderer.renderables);
    installed = true;
  },
  parse(content) {
    return Flowchart.parse(content);
  },
  renderPlainProjection(projection, options = {}) {
    return Flowchart.render(projection.content, {
      activeEdge: projection.activeEdge,
      activeEdgeProgress: projection.activeEdge ? options.activeEdgeProgress : undefined,
      activeNode: projection.activeNode,
      color: options.color ?? false,
      minNodeGap: options.minNodeGap ?? 2,
      minRankGap: options.minRankGap ?? 4,
    });
  },
  renderProjection(projection, options = {}) {
    return workflowOpenTuiMermanRenderPlan({
      activeEdge: projection.activeEdge,
      activeNode: projection.activeNode,
      content: projection.content,
      nodeBgColors: projection.nodeBgColors,
      nodeColors: projection.nodeColors,
      options,
    });
  },
};

export function installWorkflowOpenTuiMermanRenderer(register: WorkflowOpenTuiMermanRegister) {
  workflowOpenTuiMermanRenderer.install(register);
}

function workflowOpenTuiMermanRenderPlan(input: {
  activeEdge?: WorkflowDiagramProjection["activeEdge"];
  activeNode?: string;
  content: string;
  nodeBgColors?: Record<string, string>;
  nodeColors?: Record<string, string>;
  options: WorkflowOpenTuiMermanRenderOptions;
}): WorkflowOpenTuiMermanRenderPlan {
  return {
    ...(input.activeEdge ? { activeEdge: input.activeEdge } : {}),
    ...(input.activeNode ? { activeNode: input.activeNode } : {}),
    activeEdgeProgress: input.activeEdge ? input.options.activeEdgeProgress : undefined,
    content: input.content,
    minNodeGap: input.options.minNodeGap ?? 2,
    minRankGap: input.options.minRankGap ?? 4,
    nodeBgColors: input.nodeBgColors ?? {},
    nodeColors: input.nodeColors ?? {},
    renderable: Flowchart.Renderable,
  };
}
