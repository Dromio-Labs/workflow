import type { WorkflowApp, WorkflowAppArtifact, WorkflowAppInputAttachment, WorkflowAppRunSnapshot, WorkflowAppWorkflowDescriptor } from "../workflow-app.js";
import type { WorkflowTuiExportResult } from "../workflow-app-tui.js";
import type { WorkflowJsonRenderViewMode } from "@dromio/workflow-room-protocol";

export type ShellStatus = "completed" | "failed" | "idle" | "running" | "waiting";

export type WorkflowLibraryViewMode = "apps" | "workflows";

export type StartPane = "canvas" | "fields" | "metadata" | "steps";

export type StartCenterTab = "activity" | "canvas";

export type SidebarTab = "activity" | "config";

export type ShellRoute =
  | { artifactName?: string; type: "artifact"; runId?: string; workflowId: string }
  | { type: "library" }
  | { type: "run"; runId?: string; workflowId: string }
  | { type: "step"; runId?: string; stepId: string; workflowId: string }
  | { type: "start"; workflowId: string }
  | { type: "triggerFire"; triggerId: string; workflowId: string }
  | { type: "triggerJobs"; jobId?: string }
  | { type: "triggers"; triggerId?: string };

export type ShellCommand = {
  hint?: string;
  title: string;
  value: string;
  run(): void;
};

export type SlashCommand = {
  description: string;
  name: string;
  run(): void;
};

export type ShellDialog = {
  confirm?: () => void;
  confirmOnInterrupt?: boolean;
  message: string;
  title: string;
  variant: "confirm" | "error" | "help";
};

export type WorkflowExportWizardState = {
  error?: string;
  fieldIndex: number;
  result?: WorkflowTuiExportResult;
  running: boolean;
  step: number;
  values: Record<string, string>;
};

export type ShellToast = {
  message: string;
  title?: string;
  variant: "error" | "info" | "success" | "warning";
};

export type ExternalEditorTarget = {
  create?: boolean;
  defaultContent?: string;
  filePath: string;
  kind: "config" | "file";
  title: string;
  workflowId?: string;
};

export type WorkflowConfigField = NonNullable<WorkflowAppWorkflowDescriptor["configuration"]>["fields"][number];

export type ConfigValueSaveTarget = "config" | "request";

export type ConfigValueEditor = {
  configPath?: string;
  draft: string;
  field: WorkflowConfigField;
  saveTarget: ConfigValueSaveTarget;
  workflowId: string;
};

export type PromptFileViewer = {
  content: string;
  displayPath: string;
  path: string;
  title?: string;
};

export type ResultArtifactPopupState = {
  artifact?: TuiArtifact;
  content: string;
  error: string;
  name: string;
};

export type StepInspectorPopupAction = {
  kind: "promptFile";
  path: string;
} | {
  content: string;
  displayPath: string;
  kind: "content";
  path: string;
  title: string;
};

export type StepInspectorPopupLine = {
  action?: StepInspectorPopupAction;
  text: string;
};

export type StepInspectorPopupState = {
  lines: StepInspectorPopupLine[];
  stepId: string;
  title: string;
};

export type WorkflowSessionListDialogState = {
  error?: string;
  loading: boolean;
  query: string;
  runs: WorkflowAppRunSnapshot[];
  scrollOffset: number;
  selectedIndex: number;
  workflowId: string;
};

export type TuiArtifact = WorkflowAppArtifact;

export type TuiWorkspaceFrame = NonNullable<ReturnType<WorkflowApp["workspaceFrame"]>>;

export type TuiFormattedRun = {
  error: string;
  result: string;
};

export type TuiPromptAttachment = WorkflowAppInputAttachment & {
  id: string;
};

export type TuiInputMode = "raw" | "render";

export type WorkflowViewProtocolPanelMode = WorkflowJsonRenderViewMode;

export type TuiWorkflowAppManifest = {
  defaultWorkflow: string;
  description?: string;
  id: string;
  label: string;
  workflowGroups: TuiWorkflowAppWorkflowGroup[];
};

export type TuiWorkflowAppWorkflowGroup = {
  id: string;
  label: string;
  workflows: string[];
};

export type WorkflowLibraryAppListing = {
  description?: string;
  groups: Array<{
    id: string;
    label: string;
    workflows: WorkflowAppWorkflowDescriptor[];
  }>;
  id: string;
  label: string;
};

export type TuiInputForm = {
  fields: TuiInputFormField[];
  kind: "json" | "text";
  title: string;
};

export type TuiInputFormField = {
  defaultValue?: unknown;
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  type: "checkbox" | "number" | "textarea" | "text";
  value: boolean | string | undefined;
  valueType?: "boolean" | "json" | "number" | "string";
};
