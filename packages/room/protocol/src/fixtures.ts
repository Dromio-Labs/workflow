import { interactiveWorkflowViewCapabilities } from "./capabilities.js";
import type { WorkflowHookRequest } from "./hooks.js";
import type { WorkflowRenderModel } from "@dromio/workflow-canvas-protocol";
import type { WorkflowRoomSnapshot } from "./room.js";
import type { WorkflowRunSnapshot } from "./run.js";
import type { WorkflowViewSnapshot } from "./snapshot.js";
import { withWorkflowViewValidation } from "./validation.js";

export const processImageItemRenderModel: WorkflowRenderModel = {
  edges: [
    edge("child-start-to-fingerprint", "process-image-item:trigger", "fingerprint-image"),
    edge("fingerprint-to-extract", "fingerprint-image", "extract-image-content"),
    edge("extract-to-describe", "extract-image-content", "describe-image"),
    edge("describe-to-persist", "describe-image", "persist-image-summary"),
    edge("persist-to-child-end", "persist-image-summary", "process-image-item:end"),
  ],
  id: "process-image-item",
  label: "Process Image Item",
  loops: [],
  nodes: [
    node("process-image-item:trigger", "trigger", "Image ready", "completed"),
    node("fingerprint-image", "step", "01 Fingerprint image", "running"),
    node("extract-image-content", "step", "02 Extract image content", "pending"),
    node("describe-image", "step", "03 Describe image", "pending"),
    node("persist-image-summary", "step", "04 Persist image summary", "pending"),
    node("process-image-item:end", "end", "Image summarized", "pending"),
  ],
  readOnly: false,
  selectedNodeId: "fingerprint-image",
  warnings: [],
};

export const processImagesRenderModel: WorkflowRenderModel = {
  edges: [
    edge("start-to-resolve", "process-images:trigger", "resolve-config"),
    edge("resolve-to-discover", "resolve-config", "discover-images"),
    edge("discover-to-batch", "discover-images", "process-batch"),
    edge("batch-to-summary", "process-batch", "prepare-summary"),
    edge("summary-to-end", "prepare-summary", "process-images:end"),
  ],
  id: "process-images",
  label: "Process Images",
  loops: [
    {
      end: "process-batch",
      id: "per-image-loop",
      label: "for each image",
      start: "discover-images",
    },
  ],
  nodes: [
    node("process-images:trigger", "trigger", "Process images request", "completed"),
    node("resolve-config", "step", "01 Resolve config", "completed"),
    node("discover-images", "step", "02 Discover images", "completed"),
    {
      ...node("process-batch", "workflow", "03 Process batch for each image", "waiting"),
      childWorkflow: {
        execution: {
          itemLabelPath: "$.path",
          itemSource: "$.images",
          kind: "foreach",
          label: "For each discovered image",
        },
        id: "process-image-item",
        label: "Process Image Item",
        model: processImageItemRenderModel,
      },
      childWorkflowId: "process-image-item",
    },
    node("prepare-summary", "step", "04 Prepare summary", "pending"),
    node("process-images:end", "end", "Images processed", "pending"),
  ],
  readOnly: false,
  selectedNodeId: "process-batch",
  warnings: [],
};

export const processImagesPendingHook: WorkflowHookRequest = {
  id: "process-images.batch.approval",
  input: {
    imageCount: 42,
    question: "Approve processing the discovered images?",
  },
  kind: "approval",
  render: {
    approveLabel: "Approve batch",
    kind: "approval",
    rejectLabel: "Hold",
  },
  runId: "run_process_images_001",
  stepId: "process-batch",
  title: "Approve image batch",
  token: "hook_process_images_batch_001",
};

export const processImagesRoomSnapshot: WorkflowRoomSnapshot = {
  adapter: {
    id: "fixture.room",
    label: "Fixture Room",
  },
  artifacts: [],
  decisions: [],
  events: [
    {
      id: "evt_room_created",
      kind: "room.created",
      payload: {
        title: "Process Images review",
      },
    },
  ],
  handRaises: [
    {
      id: "hand_raise_process_batch",
      priority: "normal",
      question: "Should we process all 42 discovered images?",
      status: "open",
    },
  ],
  id: "room_process_images",
  kind: "custom",
  messages: [
    {
      content: "Please review the Process Images workflow before it runs the batch step.",
      id: "msg_review_request",
      role: "user",
      visibility: "public",
    },
  ],
  metadata: {
    workflowId: "process-images",
  },
  participants: [
    {
      displayName: "User",
      id: "participant_user",
      kind: "human",
      status: "active",
    },
    {
      agentId: "workflow-builder",
      displayName: "Workflow Builder",
      id: "participant_workflow_builder",
      kind: "agent",
      status: "active",
    },
  ],
  status: "active",
  title: "Process Images review",
  workflowRuns: [
    {
      id: "room_run_process_images",
      runId: "run_process_images_001",
      status: "waiting",
      workflowId: "process-images",
    },
  ],
};

export const processImagesRunSnapshot: WorkflowRunSnapshot = {
  events: [
    {
      index: 1,
      message: "Process Images workflow started.",
      runId: "run_process_images_001",
      type: "workflow.started",
    },
    {
      index: 2,
      message: "Waiting for image batch approval.",
      runId: "run_process_images_001",
      stepId: "process-batch",
      type: "step.waiting",
    },
  ],
  input: {
    rootDir: "raw",
  },
  pendingHooks: [processImagesPendingHook],
  runId: "run_process_images_001",
  status: "waiting",
  workflowId: "process-images",
};

export const processImagesViewSnapshot: WorkflowViewSnapshot = withWorkflowViewValidation({
  capabilities: interactiveWorkflowViewCapabilities,
  pendingHooks: [processImagesPendingHook],
  render: processImagesRenderModel,
  result: {
    document: {
      component: "ImageBatchSummary",
      props: {
        imageCount: 42,
        pendingApproval: true,
      },
    },
    kind: "json-render",
    title: "Image batch summary",
  },
  room: processImagesRoomSnapshot,
  run: processImagesRunSnapshot,
  selectedNodeId: "process-batch",
  version: "workflow-view/v1",
});

function node(
  id: string,
  kind: WorkflowRenderModel["nodes"][number]["kind"],
  label: string,
  status: WorkflowRenderModel["nodes"][number]["status"],
) {
  return {
    id,
    kind,
    label,
    metadata: {},
    ports: [],
    semantic: kind === "trigger"
      ? { inputMode: "none" as const, role: "trigger" as const, triggerType: "manual" as const }
      : kind === "end"
        ? { outcome: "result" as const, role: "terminal" as const }
        : kind === "workflow"
          ? { role: "workflow" as const }
          : { role: "action" as const },
    status,
  };
}

function edge(id: string, source: string, target: string) {
  return {
    id,
    metadata: {},
    semantic: { role: "sequence" as const },
    source,
    target,
  };
}
