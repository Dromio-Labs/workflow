import type {
  JsonObject,
} from "./json.js";

export const DROMIO_WORKFLOW_RENDER_CATALOG_ID = "dromio.workflow-view.v1";

export const workflowJsonRenderViewModes = [
  "render",
  "json",
  "schema",
] as const;

export type WorkflowJsonRenderViewMode =
  typeof workflowJsonRenderViewModes[number];

export const workflowJsonRenderDisplayModes = [
  {
    description: "Show the mission-focused component UI.",
    label: "Rendered component",
    mode: "render",
  },
  {
    description: "Inspect the JSON Render component document.",
    label: "Component JSON",
    mode: "json",
  },
  {
    description: "Inspect catalog, props, and validation status.",
    label: "Schema",
    mode: "schema",
  },
] as const satisfies readonly WorkflowJsonRenderDisplayMode[];

export type WorkflowJsonRenderDisplayMode = {
  description: string;
  label: string;
  mode: WorkflowJsonRenderViewMode;
};

export type WorkflowJsonRenderInspectionPreference = {
  copyActionLabel: "Copy JSON";
  defaultMode: "render";
  displayLabel: "JSON Render display settings";
  inspectionControl: "settings-menu";
  modes: typeof workflowJsonRenderDisplayModes;
};

export const workflowJsonRenderInspectionPreference = {
  copyActionLabel: "Copy JSON",
  defaultMode: "render",
  displayLabel: "JSON Render display settings",
  inspectionControl: "settings-menu",
  modes: workflowJsonRenderDisplayModes,
} as const satisfies WorkflowJsonRenderInspectionPreference;

export function workflowJsonRenderDisplayModeForMode(
  mode: WorkflowJsonRenderViewMode,
): WorkflowJsonRenderDisplayMode {
  return workflowJsonRenderDisplayModes.find((item) => item.mode === mode) ??
    workflowJsonRenderDisplayModes[0];
}

export type WorkflowJsonRenderComponent =
  | "ApprovalCard"
  | "CommandStatus"
  | "ImageBatchSummary"
  | "JsonInspector"
  | "KeyValueList"
  | "MarkdownBlock"
  | "MetricGrid"
  | "QuestionForm"
  | "StatusPill"
  | "TraceEventList";

export type WorkflowJsonRenderDocument = JsonObject & {
  component: WorkflowJsonRenderComponent | string;
  props?: JsonObject;
};

export type WorkflowJsonRenderPropType =
  | "array"
  | "boolean"
  | "json"
  | "number"
  | "object"
  | "string";

export type WorkflowJsonRenderPropSpec = {
  description?: string;
  required?: boolean;
  type: WorkflowJsonRenderPropType;
};

export type WorkflowJsonRenderComponentSpec = {
  description: string;
  props: Record<string, WorkflowJsonRenderPropSpec>;
  requiredProps?: string[];
};

export type WorkflowJsonRenderCatalog = {
  components: Record<WorkflowJsonRenderComponent, WorkflowJsonRenderComponentSpec>;
  id: typeof DROMIO_WORKFLOW_RENDER_CATALOG_ID;
};

export type WorkflowJsonRenderComponentEntry = WorkflowJsonRenderComponentSpec & {
  name: WorkflowJsonRenderComponent;
  requiredProps: string[];
};

export type WorkflowJsonRenderInspectionOptions = {
  fallbackTitle?: string;
};

export const dromioWorkflowJsonRenderCatalog: WorkflowJsonRenderCatalog = {
  components: {
    ApprovalCard: {
      description: "Human approval prompt with typed fields and approve/reject actions.",
      props: {
        approveLabel: { type: "string" },
        imageCount: { type: "number" },
        question: { type: "string" },
        rejectLabel: { type: "string" },
        subtitle: { type: "string" },
        title: { required: true, type: "string" },
      },
    },
    CommandStatus: {
      description: "Workflow View command dispatch status summary.",
      props: {
        accepted: { type: "boolean" },
        commandType: { required: true, type: "string" },
        dispatchMode: { type: "string" },
        dispatchStatus: { type: "string" },
        errorMessage: { type: "string" },
        runtimeLabel: { type: "string" },
        runtimeResumed: { type: "boolean" },
        status: { required: true, type: "string" },
        targetId: { type: "string" },
      },
    },
    ImageBatchSummary: {
      description: "Image-processing batch summary for process-images workflows.",
      props: {
        imageCount: { required: true, type: "number" },
        pendingApproval: { required: true, type: "boolean" },
        workflowId: { type: "string" },
      },
    },
    JsonInspector: {
      description: "Explicit debug-only JSON display fallback.",
      props: {
        title: { type: "string" },
        value: { required: true, type: "json" },
      },
    },
    KeyValueList: {
      description: "Label/value data list.",
      props: {
        items: { required: true, type: "array" },
      },
    },
    MarkdownBlock: {
      description: "Markdown content block.",
      props: {
        value: { required: true, type: "string" },
      },
    },
    MetricGrid: {
      description: "Grid of metrics.",
      props: {
        metrics: { required: true, type: "array" },
      },
    },
    QuestionForm: {
      description: "Human question form.",
      props: {
        description: { type: "string" },
        fields: { type: "array" },
        question: { required: true, type: "string" },
        submitLabel: { type: "string" },
        title: { type: "string" },
      },
    },
    StatusPill: {
      description: "Compact status label.",
      props: {
        label: { required: true, type: "string" },
      },
    },
    TraceEventList: {
      description: "Trace event list.",
      props: {
        events: { required: true, type: "array" },
      },
    },
  },
  id: DROMIO_WORKFLOW_RENDER_CATALOG_ID,
};

export const workflowJsonRenderCatalogComponentNames = new Set<string>(
  Object.keys(dromioWorkflowJsonRenderCatalog.components),
);

export function listWorkflowJsonRenderComponents(
  catalog = dromioWorkflowJsonRenderCatalog,
): WorkflowJsonRenderComponentEntry[] {
  return (Object.entries(catalog.components) as [WorkflowJsonRenderComponent, WorkflowJsonRenderComponentSpec][])
    .map(([name, spec]) => ({
      ...spec,
      name,
      props: { ...spec.props },
      requiredProps: workflowJsonRenderRequiredProps(spec),
    }));
}

export function getWorkflowJsonRenderComponentSpec(
  component: string,
  catalog = dromioWorkflowJsonRenderCatalog,
): WorkflowJsonRenderComponentSpec | undefined {
  const spec = catalog.components[component as WorkflowJsonRenderComponent];
  return spec
    ? {
        ...spec,
        props: { ...spec.props },
        requiredProps: workflowJsonRenderRequiredProps(spec),
      }
    : undefined;
}

export function workflowJsonRenderComponentIsRegistered(
  component: string,
  catalog = dromioWorkflowJsonRenderCatalog,
): boolean {
  return Boolean(getWorkflowJsonRenderComponentSpec(component, catalog));
}

export function workflowJsonRenderRequiredProps(
  spec: WorkflowJsonRenderComponentSpec,
): string[] {
  return spec.requiredProps ?? Object.entries(spec.props)
    .filter(([, prop]) => prop.required)
    .map(([name]) => name);
}
