import { isJsonObject, isJsonValue } from "./json.js";
import { validateWorkflowJsonRenderDocument } from "./json-render.js";
import { readOnlyWorkflowViewCapabilities } from "./capabilities.js";
import { validateCommandResults } from "./validation-command-results.js";
import {
  computeWorkflowRenderLayout,
  workflowRenderLayoutProfiles,
  type WorkflowRenderLayoutBox,
  type WorkflowRenderLayoutProfile,
  type WorkflowRenderLayoutSize,
} from "@dromio/workflow-canvas-protocol";
import type {
  WorkflowRenderModel,
  WorkflowRenderNodeKind,
  WorkflowRenderPort,
} from "@dromio/workflow-canvas-protocol";
import type { WorkflowViewValidationIssue } from "./snapshot.js";
import type { WorkflowViewSnapshot } from "./snapshot.js";
import {
  renderValidationIssueFromUiIssue,
  type WorkflowRenderValidationIssue,
} from "./validation-codes.js";
import { addIssue } from "./validation-issue.js";

export {
  workflowRenderValidationIssueCodes,
  type WorkflowRenderValidationIssue,
  type WorkflowRenderValidationIssueCode,
} from "./validation-codes.js";

export type WorkflowRenderValidation = {
  issues: WorkflowRenderValidationIssue[];
  ok: boolean;
};

export type WorkflowRenderValidationOptions = {
  layoutProfile?: WorkflowRenderLayoutProfile;
  validateLayout?: boolean;
  viewport?: WorkflowRenderLayoutSize;
};

export type WorkflowViewValidationOptions = {
  layoutProfile?: WorkflowRenderLayoutProfile;
  validateLayout?: boolean;
  viewport?: WorkflowRenderLayoutSize;
};

const nodeKinds = new Set<WorkflowRenderNodeKind>([
  "end",
  "group",
  "initial",
  "step",
  "trigger",
  "workflow",
]);

const layoutContainerKinds = new Set(["child-group", "loop-group"]);

export function validateWorkflowViewSnapshot(
  snapshot: WorkflowViewSnapshot,
  options: WorkflowViewValidationOptions = {},
): WorkflowViewValidationIssue[] {
  const issues: WorkflowViewValidationIssue[] = [];
  validateRenderModel(snapshot.render, "render", issues);
  if (options.validateLayout ?? true) validateRenderLayout(snapshot.render, options, issues);
  validateCapabilities(snapshot, issues);
  validateHooks(snapshot, issues);
  validateResult(snapshot, issues);
  validateRoom(snapshot, issues);
  validateCommandResults(snapshot, issues);
  return issues;
}

export function workflowViewSnapshotIsRenderable(
  snapshot: WorkflowViewSnapshot,
  options?: WorkflowViewValidationOptions,
): boolean {
  return validateWorkflowViewSnapshot(snapshot, options).every((issue) => issue.severity !== "error");
}

export function withWorkflowViewValidation(
  snapshot: WorkflowViewSnapshot,
  options?: WorkflowViewValidationOptions,
): WorkflowViewSnapshot {
  const issues = validateWorkflowViewSnapshot(snapshot, options);
  return {
    ...snapshot,
    validation: {
      issues,
      renderable: issues.every((issue) => issue.severity !== "error"),
    },
  };
}

export function assertWorkflowViewSnapshot(
  snapshot: WorkflowViewSnapshot,
  options?: WorkflowViewValidationOptions,
): void {
  const issues = validateWorkflowViewSnapshot(snapshot, options).filter((issue) => issue.severity === "error");
  if (issues.length) {
    throw new Error(issues.map((issue) => issue.message).join("\n"));
  }
}

export function validateWorkflowRenderability(
  model: WorkflowRenderModel,
  options: WorkflowRenderValidationOptions = {},
): WorkflowRenderValidation {
  const issues = validateWorkflowViewSnapshot({
    capabilities: readOnlyWorkflowViewCapabilities,
    pendingHooks: [],
    render: model,
    version: "workflow-view/v1",
  }, options).map(renderValidationIssueFromUiIssue);
  return {
    issues,
    ok: issues.every((issue) => issue.severity !== "error"),
  };
}

function validateRenderModel(
  model: WorkflowRenderModel,
  path: string,
  issues: WorkflowViewValidationIssue[],
) {
  const modelId = stringField(model.id);
  const modelLabel = stringField(model.label);
  if (!modelId.trim()) addIssue(issues, "render.model.id_missing", "Render model id is required.", `${path}.id`);
  if (!modelLabel.trim()) addIssue(issues, "render.model.label_missing", `Render model ${modelId || path} needs a label.`, `${path}.label`);

  const nodeIds = new Set<string>();
  for (const [index, node] of model.nodes.entries()) {
    const nodePath = `${path}.nodes.${index}`;
    const nodeId = stringField(node.id);
    if (!nodeId.trim()) {
      addIssue(issues, "render.node.id_missing", `Render node at index ${index} is missing an id.`, `${nodePath}.id`);
      continue;
    }
    if (nodeIds.has(nodeId)) addIssue(issues, "render.node.id_duplicate", `Render node ${nodeId} is duplicated.`, `${nodePath}.id`);
    nodeIds.add(nodeId);
    const nodeKind = node.kind as string | undefined;
    if (!nodeKind?.trim()) {
      addIssue(issues, "render.node.kind_missing", `Render node ${nodeId} needs a kind.`, `${nodePath}.kind`);
    } else if (!nodeKinds.has(node.kind)) {
      addIssue(issues, "render.node.kind_invalid", `Render node ${nodeId} has invalid kind ${node.kind}.`, `${nodePath}.kind`);
    }
    if (!stringField(node.label).trim()) addIssue(issues, "render.node.label_missing", `Render node ${nodeId} needs a label.`, `${nodePath}.label`);
    if (!isJsonObject(node.metadata)) {
      addIssue(issues, "render.node.metadata_invalid", `Render node ${nodeId} metadata must be a JSON object.`, `${nodePath}.metadata`);
    }
    validateNodeSemantic(node.semantic, nodeId, `${nodePath}.semantic`, issues);
    for (const [portIndex, port] of node.ports.entries()) {
      validateRenderPort(port, nodeId, `${nodePath}.ports.${portIndex}`, issues);
    }
    if (node.childWorkflow) {
      const childWorkflowId = stringField(node.childWorkflow.id);
      if (!childWorkflowId.trim()) {
        addIssue(issues, "render.child_workflow.id_missing", `Render node ${nodeId} has a child workflow without an id.`, `${nodePath}.childWorkflow.id`);
      }
      if (!stringField(node.childWorkflow.label).trim()) {
        addIssue(issues, "render.child_workflow.label_missing", `Child workflow ${childWorkflowId || nodeId} needs a label.`, `${nodePath}.childWorkflow.label`);
      }
      validateRenderModel(node.childWorkflow.model, `${nodePath}.childWorkflow.model`, issues);
    }
  }

  for (const [index, edge] of model.edges.entries()) {
    if (!nodeIds.has(edge.source)) addIssue(issues, "render.edge.source_missing", `Render edge ${edge.id} source ${edge.source} does not exist.`, `${path}.edges.${index}.source`);
    if (!nodeIds.has(edge.target)) addIssue(issues, "render.edge.target_missing", `Render edge ${edge.id} target ${edge.target} does not exist.`, `${path}.edges.${index}.target`);
    if (!isJsonObject(edge.metadata)) {
      addIssue(issues, "render.edge.metadata_invalid", `Render edge ${edge.id} metadata must be a JSON object.`, `${path}.edges.${index}.metadata`);
    }
    validateEdgeSemantic(edge.semantic, edge.id, `${path}.edges.${index}.semantic`, issues);
  }

  for (const [index, loop] of model.loops.entries()) {
    if (!nodeIds.has(loop.start)) addIssue(issues, "render.loop.start_missing", `Render loop ${loop.id} start ${loop.start} does not exist.`, `${path}.loops.${index}.start`);
    if (!nodeIds.has(loop.end)) addIssue(issues, "render.loop.end_missing", `Render loop ${loop.id} end ${loop.end} does not exist.`, `${path}.loops.${index}.end`);
    if (loop.backTo && !nodeIds.has(loop.backTo)) addIssue(issues, "render.loop.back_to_missing", `Render loop ${loop.id} backTo ${loop.backTo} does not exist.`, `${path}.loops.${index}.backTo`);
  }

  validateRenderTopology(model, path, issues);

  if (model.selectedNodeId && !nodeIds.has(model.selectedNodeId)) {
    addIssue(issues, "render.selected_node_missing", `Selected render node ${model.selectedNodeId} does not exist.`, `${path}.selectedNodeId`);
  }
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function validateNodeSemantic(
  value: unknown,
  nodeId: string,
  path: string,
  issues: WorkflowViewValidationIssue[],
) {
  const semantic = recordValue(value);
  const role = stringField(semantic?.role);
  const simpleRoles = new Set([
    "action",
    "boundary",
    "evaluation",
    "gate",
    "group",
    "merge",
    "model",
    "workflow",
  ]);
  const valid = simpleRoles.has(role)
    || (role === "fork" && Array.isArray(semantic?.branches))
    || (role === "interaction" && (
      semantic?.interactionKind === "approval"
      || semantic?.interactionKind === "question"
      || semantic?.interactionKind === "timer"
    ))
    || (role === "join" && (semantic?.policy === "all" || semantic?.policy === "any"))
    || (role === "router" && Array.isArray(semantic?.routes))
    || (role === "terminal" && (semantic?.outcome === "result" || semantic?.outcome === "failed" || semantic?.outcome === "cancelled"))
    || (role === "trigger" && typeof semantic?.triggerType === "string" && typeof semantic?.inputMode === "string");
  if (!valid) {
    addIssue(issues, "render.node.semantic_invalid", `Render node ${nodeId} has invalid semantic role data.`, path);
  }
}

function validateEdgeSemantic(
  value: unknown,
  edgeId: string,
  path: string,
  issues: WorkflowViewValidationIssue[],
) {
  const semantic = recordValue(value);
  const role = stringField(semantic?.role);
  const valid = role === "composition" || role === "loop" || role === "merge" || role === "sequence"
    || (role === "branch" && Boolean(recordValue(semantic?.branch)))
    || (role === "join" && (semantic?.policy === "all" || semantic?.policy === "any"))
    || (role === "route" && Boolean(recordValue(semantic?.route)));
  if (!valid) {
    addIssue(issues, "render.edge.semantic_invalid", `Render edge ${edgeId} has invalid semantic role data.`, path);
  }
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function validateRenderTopology(
  model: WorkflowRenderModel,
  path: string,
  issues: WorkflowViewValidationIssue[],
) {
  const triggers = model.nodes.filter((node) => node.kind === "trigger");
  const initials = model.nodes.filter((node) => node.kind === "initial");
  const ends = model.nodes.filter((node) => node.kind === "end");
  if (initials.length > 1) {
    addIssue(
      issues,
      "render.topology.initial_count_invalid",
      `Render model ${model.id} may have at most one initial node; found ${initials.length}.`,
      `${path}.nodes`,
    );
  }
  if (triggers.length < 1) {
    addIssue(
      issues,
      "render.topology.trigger_count_invalid",
      `Render model ${model.id} must have at least one trigger node; found ${triggers.length}.`,
      `${path}.nodes`,
    );
  }
  if (ends.length !== 1) {
    addIssue(
      issues,
      "render.topology.end_count_invalid",
      `Render model ${model.id} must have exactly one end node; found ${ends.length}.`,
      `${path}.nodes`,
    );
  }
  if (!triggers.length) {
    return;
  }

  const outgoing = new Map<string, string[]>();
  for (const edge of model.edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  const reachable = new Set<string>();
  const root = initials[0]?.id ?? triggers[0]!.id;
  const queue = [root];
  while (queue.length) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const target of outgoing.get(current) ?? []) {
      if (!reachable.has(target)) queue.push(target);
    }
  }
  for (const [index, node] of model.nodes.entries()) {
    if (reachable.has(node.id)) continue;
    addIssue(
      issues,
      "render.topology.node_unreachable",
      `Render node ${node.id} is not reachable from workflow root ${root}.`,
      `${path}.nodes.${index}`,
    );
  }
}

function validateRenderPort(
  port: WorkflowRenderPort,
  nodeId: string,
  path: string,
  issues: WorkflowViewValidationIssue[],
) {
  if (port.id.trim() && (port.type === "source" || port.type === "target")) return;
  addIssue(issues, "render.port_invalid", `Render node ${nodeId} has an invalid port.`, path);
}

function validateRenderLayout(
  model: WorkflowRenderModel,
  options: WorkflowViewValidationOptions,
  issues: WorkflowViewValidationIssue[],
) {
  const profile = options.layoutProfile ?? workflowRenderLayoutProfiles.web;
  const layout = computeWorkflowRenderLayout(model, profile);
  const boxById = new Map(layout.boxes.map((box) => [box.id, box]));
  const nodeBoxes = layout.boxes.filter((box) => !layoutContainerKinds.has(box.kind));

  for (let leftIndex = 0; leftIndex < nodeBoxes.length; leftIndex += 1) {
    const left = nodeBoxes[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < nodeBoxes.length; rightIndex += 1) {
      const right = nodeBoxes[rightIndex]!;
      if ((left.parentId ?? "") !== (right.parentId ?? "")) continue;
      if (!boxesOverlap(left, right)) continue;
      addIssue(issues, "render.layout.node_overlap", `Render nodes ${left.id} and ${right.id} overlap in the computed layout.`, `render.layout.boxes.${left.id}`);
    }
  }

  for (const edge of layout.edges) {
    if (edge.kind !== "sequence") continue;
    const source = boxById.get(edge.sourceBoxId);
    const target = boxById.get(edge.targetBoxId);
    if (!(source && target)) continue;
    const backward = profile.direction === "LR" ? target.x < source.x : target.y < source.y;
    if (backward) addIssue(issues, "render.layout.sequence_edge_backward", `Render edge ${edge.id} points backward in ${profile.direction} layout.`, `render.layout.edges.${edge.id}`);
  }

  for (const group of layout.boxes.filter((box) => box.kind === "child-group")) {
    const children = layout.boxes.filter((box) => box.parentId === group.id && box.kind !== "loop-group");
    if (children.length && children.every((child) => containsBox(group, child))) continue;
    addIssue(issues, "render.layout.child_group_bounds_invalid", `Child workflow group ${group.id} does not contain its rendered child nodes.`, `render.layout.boxes.${group.id}`);
  }

  for (const group of layout.boxes.filter((box) => box.kind === "loop-group")) {
    const siblings = layout.boxes.filter((box) =>
      box.parentId === group.parentId &&
      !layoutContainerKinds.has(box.kind) &&
      boxCenterInside(group, box)
    );
    if (siblings.length > 0) continue;
    addIssue(issues, "render.layout.loop_group_bounds_invalid", `Loop group ${group.id} does not contain any rendered loop nodes.`, `render.layout.boxes.${group.id}`);
  }

  if (options.viewport && (layout.width > options.viewport.width || layout.height > options.viewport.height)) {
    addIssue(
      issues,
      "render.layout.viewport_exceeded",
      `Computed workflow layout ${layout.width}x${layout.height} exceeds viewport ${options.viewport.width}x${options.viewport.height}.`,
      "render.layout",
      "warning",
    );
  }
}

function boxesOverlap(left: WorkflowRenderLayoutBox, right: WorkflowRenderLayoutBox) {
  return left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y;
}

function containsBox(container: WorkflowRenderLayoutBox, child: WorkflowRenderLayoutBox) {
  return child.x >= container.x &&
    child.y >= container.y &&
    child.x + child.width <= container.x + container.width &&
    child.y + child.height <= container.y + container.height;
}

function boxCenterInside(container: WorkflowRenderLayoutBox, child: WorkflowRenderLayoutBox) {
  const x = child.x + child.width / 2;
  const y = child.y + child.height / 2;
  return x >= container.x &&
    x <= container.x + container.width &&
    y >= container.y &&
    y <= container.y + container.height;
}

function validateHooks(snapshot: WorkflowViewSnapshot, issues: WorkflowViewValidationIssue[]) {
  const tokens = new Set<string>();
  for (const [index, hook] of snapshot.pendingHooks.entries()) {
    if (!hook.token.trim()) addIssue(issues, "hook.token_missing", `Pending hook ${hook.id} is missing a token.`, `pendingHooks.${index}.token`);
    if (tokens.has(hook.token)) addIssue(issues, "hook.token_duplicate", `Pending hook token for ${hook.id} is duplicated.`, `pendingHooks.${index}.token`);
    tokens.add(hook.token);
    if (!isJsonValue(hook.input)) addIssue(issues, "hook.input_invalid", `Pending hook ${hook.id} input must be JSON-serializable.`, `pendingHooks.${index}.input`);
    if (hook.render?.kind === "json-render") {
      addJsonRenderIssues(
        validateWorkflowJsonRenderDocument(
          hook.render.document,
          `pendingHooks.${index}.render.document`,
        ).issues,
        issues,
        "hook",
      );
    }
  }
}

function validateCapabilities(
  snapshot: WorkflowViewSnapshot,
  issues: WorkflowViewValidationIssue[],
) {
  if (!snapshot.capabilities.workflow.render) {
    addIssue(
      issues,
      "capability.workflow.render_required",
      "Workflow View snapshots must advertise workflow.render capability.",
      "capabilities.workflow.render",
    );
  }
  if (snapshot.pendingHooks.length && !snapshot.capabilities.workflow.resumeHook) {
    addIssue(
      issues,
      "capability.workflow.resume_hook_required",
      "Workflow View snapshots with pending hooks must advertise workflow.resumeHook capability.",
      "capabilities.workflow.resumeHook",
    );
  }
  const hasJsonRenderHook = snapshot.pendingHooks.some((hook) => hook.render?.kind === "json-render");
  if (hasJsonRenderHook && !snapshot.capabilities.result.jsonRender) {
    addIssue(
      issues,
      "capability.result.json_render_required",
      "Workflow View snapshots with json-render hooks must advertise result.jsonRender capability.",
      "capabilities.result.jsonRender",
    );
  }
  if (snapshot.result?.kind === "json-render" && !snapshot.capabilities.result.jsonRender) {
    addIssue(
      issues,
      "capability.result.json_render_required",
      "Workflow View snapshots with json-render results must advertise result.jsonRender capability.",
      "capabilities.result.jsonRender",
    );
  }
  if (snapshot.result?.kind === "json" && !snapshot.capabilities.result.json) {
    addIssue(
      issues,
      "capability.result.json_required",
      "Workflow View snapshots with JSON results must advertise result.json capability.",
      "capabilities.result.json",
    );
  }
  if (snapshot.result?.kind === "markdown" && !snapshot.capabilities.result.markdown) {
    addIssue(
      issues,
      "capability.result.markdown_required",
      "Workflow View snapshots with Markdown results must advertise result.markdown capability.",
      "capabilities.result.markdown",
    );
  }
}

function validateResult(snapshot: WorkflowViewSnapshot, issues: WorkflowViewValidationIssue[]) {
  const result = snapshot.result;
  if (!result) return;
  if (result.kind === "json" && !isJsonValue(result.value)) addIssue(issues, "result.json_invalid", "JSON result must be JSON-serializable.", "result.value");
  if (result.kind === "markdown" && !result.value.trim()) addIssue(issues, "result.markdown_empty", "Markdown result is empty.", "result.value", "warning");
  if (result.kind === "json-render") {
    addJsonRenderIssues(
      validateWorkflowJsonRenderDocument(result.document, "result.document").issues,
      issues,
      "result",
    );
  }
}

function addJsonRenderIssues(
  jsonRenderIssues: ReturnType<typeof validateWorkflowJsonRenderDocument>["issues"],
  issues: WorkflowViewValidationIssue[],
  prefix: "hook" | "result",
) {
  for (const issue of jsonRenderIssues) {
    addIssue(issues, `${prefix}.${issue.code}`, issue.message, issue.path);
  }
}

function validateRoom(snapshot: WorkflowViewSnapshot, issues: WorkflowViewValidationIssue[]) {
  if (!snapshot.room) return;
  const messageIds = new Set<string>();
  for (const [index, message] of snapshot.room.messages.entries()) {
    if (messageIds.has(message.id)) addIssue(issues, "room.message.id_duplicate", `Room message ${message.id} is duplicated.`, `room.messages.${index}.id`);
    messageIds.add(message.id);
    if (message.metadata && !isJsonObject(message.metadata)) addIssue(issues, "room.message.metadata_invalid", `Room message ${message.id} metadata must be a JSON object.`, `room.messages.${index}.metadata`);
  }
}
