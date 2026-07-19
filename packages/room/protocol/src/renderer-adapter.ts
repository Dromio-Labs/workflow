import {
  capabilityEnabled,
  workflowViewCapabilityPaths,
  type WorkflowViewCapabilities,
  type WorkflowViewCapabilityPath,
} from "./capabilities.js";
import { workflowViewCommandResultToJsonRenderDocument } from "./commands.js";
import { workflowHookToJsonRenderDocument } from "./hooks.js";
import {
  workflowJsonRenderInspectionPreference,
  type WorkflowJsonRenderDocument,
  type WorkflowJsonRenderViewMode,
} from "./json-render.js";
import type {
  WorkflowRenderLayoutProfile,
  WorkflowRenderLayoutSize,
} from "@dromio/workflow-canvas-protocol";
import { workflowResultToJsonRenderDocument } from "./result.js";
import type {
  WorkflowViewSnapshot,
  WorkflowViewValidationIssue,
} from "./snapshot.js";
import { validateWorkflowViewSnapshot } from "./validation.js";
import { addIssue } from "./validation-issue.js";

export type WorkflowViewRendererAdapterSurface =
  | "dromio-platform"
  | "dromio-workbench-tui"
  | "sdk-react-preview"
  | "watson"
  | (string & {});

export type WorkflowJsonRenderInspectionControl =
  | "inline-tabs"
  | "none"
  | "settings-menu";

export type WorkflowViewRendererAdapterContract = {
  capabilities: WorkflowViewCapabilities;
  id: string;
  jsonRender?: {
    components?: readonly string[];
    defaultMode?: WorkflowJsonRenderViewMode;
    inspectionControl?: WorkflowJsonRenderInspectionControl;
    inspectionModes?: readonly WorkflowJsonRenderViewMode[];
  };
  label: string;
  layoutProfile?: WorkflowRenderLayoutProfile;
  surface: WorkflowViewRendererAdapterSurface;
  viewport?: WorkflowRenderLayoutSize;
};

export type WorkflowViewRendererAdapterValidation = {
  adapter: WorkflowViewRendererAdapterContract;
  issues: WorkflowViewValidationIssue[];
  ok: boolean;
};

const requiredJsonRenderInspectionModes = workflowJsonRenderInspectionPreference.modes.map(
  (mode) => mode.mode,
);

export function validateWorkflowViewRendererAdapterSnapshot(
  adapter: WorkflowViewRendererAdapterContract,
  snapshot: WorkflowViewSnapshot,
): WorkflowViewRendererAdapterValidation {
  const issues = [
    ...validateWorkflowViewSnapshot(snapshot, {
      layoutProfile: adapter.layoutProfile,
      viewport: adapter.viewport,
    }),
  ];

  validateRendererAdapterContract(adapter, issues);
  validateSnapshotCapabilityClaims(adapter, snapshot, issues);
  validateAdapterJsonRenderSupport(adapter, snapshot, issues);

  return {
    adapter,
    issues,
    ok: issues.every((issue) => issue.severity !== "error"),
  };
}

export function workflowViewRendererAdapterSnapshotIsRenderable(
  adapter: WorkflowViewRendererAdapterContract,
  snapshot: WorkflowViewSnapshot,
): boolean {
  return validateWorkflowViewRendererAdapterSnapshot(adapter, snapshot).ok;
}

function validateRendererAdapterContract(
  adapter: WorkflowViewRendererAdapterContract,
  issues: WorkflowViewValidationIssue[],
) {
  if (!adapter.id.trim()) {
    addIssue(issues, "adapter.id_missing", "Renderer adapter id is required.", "adapter.id");
  }
  if (!adapter.label.trim()) {
    addIssue(issues, "adapter.label_missing", "Renderer adapter label is required.", "adapter.label");
  }
  if (!adapter.surface.trim()) {
    addIssue(issues, "adapter.surface_missing", "Renderer adapter surface is required.", "adapter.surface");
  }
  if (!adapter.capabilities.workflow.render) {
    addIssue(
      issues,
      "adapter.capability.workflow_render_required",
      "Renderer adapters must support workflow.render.",
      "adapter.capabilities.workflow.render",
    );
  }
}

function validateSnapshotCapabilityClaims(
  adapter: WorkflowViewRendererAdapterContract,
  snapshot: WorkflowViewSnapshot,
  issues: WorkflowViewValidationIssue[],
) {
  for (const path of workflowViewCapabilityPaths) {
    const snapshotClaimsCapability = capabilityEnabled(snapshot.capabilities, path);
    const adapterSupportsCapability = capabilityEnabled(adapter.capabilities, path);
    if (!snapshotClaimsCapability || adapterSupportsCapability) continue;

    addIssue(
      issues,
      "adapter.capability.unsupported_claim",
      `Snapshot advertises ${path}, but renderer adapter ${adapter.id} does not support it.`,
      `capabilities.${path}`,
    );
  }
}

function validateAdapterJsonRenderSupport(
  adapter: WorkflowViewRendererAdapterContract,
  snapshot: WorkflowViewSnapshot,
  issues: WorkflowViewValidationIssue[],
) {
  const documents = collectJsonRenderDocuments(snapshot);
  if (!documents.length) return;

  if (!adapter.capabilities.result.jsonRender) {
    addIssue(
      issues,
      "adapter.capability.json_render_required",
      `Renderer adapter ${adapter.id} must support result.jsonRender for this snapshot.`,
      "adapter.capabilities.result.jsonRender",
    );
  }

  validateJsonRenderInspection(adapter, issues);

  const supportedComponents = adapter.jsonRender?.components
    ? new Set(adapter.jsonRender.components)
    : undefined;
  if (!supportedComponents) return;

  for (const document of documents) {
    if (supportedComponents.has(document.component)) continue;
    addIssue(
      issues,
      "adapter.json_render.component_unsupported",
      `Renderer adapter ${adapter.id} does not support json-render component ${document.component}.`,
      "adapter.jsonRender.components",
    );
  }
}

function validateJsonRenderInspection(
  adapter: WorkflowViewRendererAdapterContract,
  issues: WorkflowViewValidationIssue[],
) {
  const defaultMode = adapter.jsonRender?.defaultMode ??
    workflowJsonRenderInspectionPreference.defaultMode;
  if (defaultMode !== workflowJsonRenderInspectionPreference.defaultMode) {
    addIssue(
      issues,
      "adapter.json_render.default_mode_invalid",
      `Renderer adapter ${adapter.id} must default json-render cards to rendered component mode.`,
      "adapter.jsonRender.defaultMode",
    );
  }

  const inspectionControl = adapter.jsonRender?.inspectionControl ??
    workflowJsonRenderInspectionPreference.inspectionControl;
  if (inspectionControl !== workflowJsonRenderInspectionPreference.inspectionControl) {
    addIssue(
      issues,
      "adapter.json_render.inspection_control_invalid",
      `Renderer adapter ${adapter.id} must hide json-render inspection modes behind a settings menu.`,
      "adapter.jsonRender.inspectionControl",
    );
  }

  const inspectionModes = new Set(adapter.jsonRender?.inspectionModes ?? requiredJsonRenderInspectionModes);
  for (const mode of requiredJsonRenderInspectionModes) {
    if (inspectionModes.has(mode)) continue;
    addIssue(
      issues,
      "adapter.json_render.inspection_mode_missing",
      `Renderer adapter ${adapter.id} must expose json-render ${mode} mode from the settings menu.`,
      "adapter.jsonRender.inspectionModes",
    );
  }
}

function collectJsonRenderDocuments(snapshot: WorkflowViewSnapshot): WorkflowJsonRenderDocument[] {
  const documents = snapshot.pendingHooks.map((hook) => workflowHookToJsonRenderDocument(hook));
  const result = snapshot.result ? workflowResultToJsonRenderDocument(snapshot.result) : undefined;
  if (result) documents.push(result);
  for (const commandResult of snapshot.commandResults ?? []) {
    documents.push(workflowViewCommandResultToJsonRenderDocument(commandResult));
  }
  return documents;
}
