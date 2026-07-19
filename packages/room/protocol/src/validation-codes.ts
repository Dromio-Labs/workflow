import type { WorkflowViewValidationIssue } from "./snapshot.js";

export const workflowRenderValidationIssueCodes = [
  "RENDER_CHILD_GROUP_BOUNDS_INVALID",
  "RENDER_CHILD_WORKFLOW_ID_MISSING",
  "RENDER_CHILD_WORKFLOW_LABEL_MISSING",
  "RENDER_DUPLICATE_NODE_ID",
  "RENDER_EDGE_METADATA_INVALID",
  "RENDER_EDGE_SEMANTIC_INVALID",
  "RENDER_EDGE_SOURCE_MISSING",
  "RENDER_EDGE_TARGET_MISSING",
  "RENDER_LAYOUT_VIEWPORT_EXCEEDED",
  "RENDER_LOOP_BACK_TO_MISSING",
  "RENDER_LOOP_END_MISSING",
  "RENDER_LOOP_GROUP_BOUNDS_INVALID",
  "RENDER_LOOP_START_MISSING",
  "RENDER_MODEL_ID_MISSING",
  "RENDER_MODEL_INVALID",
  "RENDER_MODEL_LABEL_MISSING",
  "RENDER_NODE_ID_MISSING",
  "RENDER_NODE_KIND_INVALID",
  "RENDER_NODE_KIND_MISSING",
  "RENDER_NODE_LABEL_MISSING",
  "RENDER_NODE_METADATA_INVALID",
  "RENDER_NODE_SEMANTIC_INVALID",
  "RENDER_NODE_OVERLAP",
  "RENDER_NODE_POSITION_INVALID",
  "RENDER_NODE_UNREACHABLE",
  "RENDER_PORT_INVALID",
  "RENDER_SELECTED_NODE_MISSING",
  "RENDER_SEQUENCE_EDGE_BACKWARD",
  "RENDER_TOPOLOGY_END_COUNT_INVALID",
  "RENDER_TOPOLOGY_INITIAL_COUNT_INVALID",
  "RENDER_TOPOLOGY_TRIGGER_COUNT_INVALID",
] as const;

export type WorkflowRenderValidationIssueCode =
  typeof workflowRenderValidationIssueCodes[number];

export type WorkflowRenderValidationIssue = {
  code: WorkflowRenderValidationIssueCode;
  details?: Record<string, unknown>;
  message: string;
  nodeId?: string;
  path: string;
  severity: "error" | "warning";
};

const renderIssueCodeByUiCode: Record<string, WorkflowRenderValidationIssueCode> = {
  "render.child_workflow.id_missing": "RENDER_CHILD_WORKFLOW_ID_MISSING",
  "render.child_workflow.label_missing": "RENDER_CHILD_WORKFLOW_LABEL_MISSING",
  "render.edge.metadata_invalid": "RENDER_EDGE_METADATA_INVALID",
  "render.edge.semantic_invalid": "RENDER_EDGE_SEMANTIC_INVALID",
  "render.edge.source_missing": "RENDER_EDGE_SOURCE_MISSING",
  "render.edge.target_missing": "RENDER_EDGE_TARGET_MISSING",
  "render.layout.child_group_bounds_invalid": "RENDER_CHILD_GROUP_BOUNDS_INVALID",
  "render.layout.loop_group_bounds_invalid": "RENDER_LOOP_GROUP_BOUNDS_INVALID",
  "render.layout.node_overlap": "RENDER_NODE_OVERLAP",
  "render.layout.sequence_edge_backward": "RENDER_SEQUENCE_EDGE_BACKWARD",
  "render.layout.viewport_exceeded": "RENDER_LAYOUT_VIEWPORT_EXCEEDED",
  "render.loop.back_to_missing": "RENDER_LOOP_BACK_TO_MISSING",
  "render.loop.end_missing": "RENDER_LOOP_END_MISSING",
  "render.loop.start_missing": "RENDER_LOOP_START_MISSING",
  "render.model.id_missing": "RENDER_MODEL_ID_MISSING",
  "render.model.label_missing": "RENDER_MODEL_LABEL_MISSING",
  "render.node.id_duplicate": "RENDER_DUPLICATE_NODE_ID",
  "render.node.id_missing": "RENDER_NODE_ID_MISSING",
  "render.node.kind_invalid": "RENDER_NODE_KIND_INVALID",
  "render.node.kind_missing": "RENDER_NODE_KIND_MISSING",
  "render.node.label_missing": "RENDER_NODE_LABEL_MISSING",
  "render.node.metadata_invalid": "RENDER_NODE_METADATA_INVALID",
  "render.node.semantic_invalid": "RENDER_NODE_SEMANTIC_INVALID",
  "render.port_invalid": "RENDER_PORT_INVALID",
  "render.selected_node_missing": "RENDER_SELECTED_NODE_MISSING",
  "render.topology.end_count_invalid": "RENDER_TOPOLOGY_END_COUNT_INVALID",
  "render.topology.initial_count_invalid": "RENDER_TOPOLOGY_INITIAL_COUNT_INVALID",
  "render.topology.node_unreachable": "RENDER_NODE_UNREACHABLE",
  "render.topology.trigger_count_invalid": "RENDER_TOPOLOGY_TRIGGER_COUNT_INVALID",
};

export function renderValidationIssueFromUiIssue(
  issue: WorkflowViewValidationIssue,
): WorkflowRenderValidationIssue {
  const code = renderIssueCodeByUiCode[issue.code] ?? "RENDER_MODEL_INVALID";
  return {
    code,
    message: issue.message,
    path: issue.path ?? "render",
    severity: issue.severity,
  };
}
