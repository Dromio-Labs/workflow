import type { CliRenderer } from "@opentui/core";
import type { WorkflowViewSnapshot } from "@dromio/workflow-room-protocol";
import type { Accessor, Setter } from "solid-js";
import type { TriggerDescriptor, TriggerJobSnapshot, WorkflowControlPlane } from "../../../workflow-control-plane/index.js";
import type {
  WorkflowTuiExportFieldDescriptor,
  WorkflowTuiExportHandler,
  WorkflowTuiKeymap,
  WorkflowTuiTriggerBoundarySummary,
} from "../workflow-app-tui.js";
import type {
  WorkflowApp,
  WorkflowAppModelWorkerOption,
  WorkflowAppRun,
  WorkflowAppRunOrigin,
  WorkflowAppRuntime,
  WorkflowAppWorkflowDescriptor,
} from "../workflow-app.js";
import type { WorkflowRunStore, WorkflowRunStoreSnapshot } from "../workflow-run-store.js";
import type { WorkflowMetadataSelectionRow } from "./artifact-step-pages.js";
import type {
  ConfigValueEditor,
  PromptFileViewer,
  ResultArtifactPopupState,
  ShellCommand,
  ShellDialog,
  ShellRoute,
  ShellStatus,
  ShellToast,
  SidebarTab,
  SlashCommand,
  StartCenterTab,
  StartPane,
  StepInspectorPopupState,
  TuiArtifact,
  TuiInputForm,
  TuiInputMode,
  TuiWorkflowAppManifest,
  TuiPromptAttachment,
  TuiWorkspaceFrame,
  WorkflowExportWizardState,
  WorkflowLibraryAppListing,
  WorkflowLibraryViewMode,
  WorkflowViewProtocolPanelMode,
  WorkflowSessionListDialogState,
} from "./types.js";
import type { StartStepOutlineItem } from "./workflow-design.js";

export type WorkflowAppTuiShellProps = {
  app: WorkflowApp;
  commandName?: string;
  controlPlane?: WorkflowControlPlane;
  defaultPrompt?: string;
  emptyAnswerHint?: false | string;
  exportWorkflows?: WorkflowTuiExportHandler;
  initialRunId?: string;
  initialWorkflowId?: string;
  keymap?: Partial<WorkflowTuiKeymap>;
  onExit(): void;
  runtime: WorkflowAppRuntime;
};

export type WorkflowAppTuiShellContext = () => WorkflowAppTuiShellContextValue;

export type WorkflowAppTuiShellContextValue = {
  [key: string]: any;
  activeModelStep: Accessor<WorkflowRunStoreSnapshot["steps"][number] | undefined>;
  activeRunHeaderMeta: Accessor<string | undefined>;
  appListings: Accessor<WorkflowLibraryAppListing[]>;
  appManifests: Accessor<TuiWorkflowAppManifest[]>;
  artifacts: Accessor<TuiArtifact[]>;
  commandIndex: Accessor<number>;
  commandName: string;
  commandOpen: Accessor<boolean>;
  commandQuery: Accessor<string>;
  configOverridesByWorkflow: Accessor<Record<string, Record<string, unknown>>>;
  configValueEditor: Accessor<ConfigValueEditor | undefined>;
  detailCollapsedStepIds: Accessor<ReadonlySet<string>>;
  dialog: Accessor<ShellDialog | undefined>;
  dimensions: Accessor<{ height: number; width: number }>;
  error: Accessor<string>;
  expandedStartStepIds: Accessor<ReadonlySet<string>>;
  filteredCommands: Accessor<ShellCommand[]>;
  filteredSlashCommands: Accessor<SlashCommand[]>;
  filteredWorkflows: Accessor<WorkflowAppWorkflowDescriptor[]>;
  hasRunningStep: Accessor<boolean>;
  hookRun: Accessor<WorkflowAppRun | undefined>;
  hookValue: Accessor<string>;
  initialFormatted: { error: string; result: string };
  initialRun: WorkflowAppRun | undefined;
  initialStore: WorkflowRunStore;
  initialWorkflow: string;
  initialWorkflowIds: string[];
  inputModeByWorkflow: Accessor<Record<string, TuiInputMode>>;
  keymap: WorkflowTuiKeymap;
  lastRunIdsByWorkflow: Map<string, string>;
  lastViewedRunId: Accessor<string | undefined>;
  latestRun: () => WorkflowAppRun | undefined;
  leaderActive: Accessor<boolean>;
  leaderForKey: boolean;
  libraryDiagramOpen: Accessor<boolean>;
  libraryViewMode: Accessor<WorkflowLibraryViewMode>;
  libraryWorkflowIds: Accessor<string[]>;
  metadataPopupOpen: Accessor<boolean>;
  modelWorkerOptions: Accessor<WorkflowAppModelWorkerOption[]>;
  prompt: Accessor<string>;
  promptAttachments: Accessor<TuiPromptAttachment[]>;
  promptCursor: Accessor<number>;
  promptFileViewer: Accessor<PromptFileViewer | undefined>;
  promptFileViewerScrollOffset: Accessor<number>;
  promptHistory: string[];
  promptHistoryCursor: number | undefined;
  promptHistoryDraft: string;
  setPromptHistoryCursor(value: number | undefined): void;
  setPromptHistoryDraft(value: string): void;
  props: WorkflowAppTuiShellProps;
  questionActive: Accessor<boolean>;
  renderer: CliRenderer;
  result: Accessor<string>;
  resultPopup: Accessor<ResultArtifactPopupState | undefined>;
  resultPopupScrollOffset: Accessor<number>;
  route: Accessor<ShellRoute>;
  selectedInputFieldIndex: Accessor<number>;
  selectedJobIndex: Accessor<number>;
  selectedLibraryIndex: Accessor<number>;
  selectedMetadataPromptRowIndex: Accessor<number>;
  selectedMetadataRows: Accessor<WorkflowMetadataSelectionRow[]>;
  selectedSidebarTab: Accessor<SidebarTab>;
  selectedStartCenterTab: Accessor<StartCenterTab>;
  selectedStartInputMode: Accessor<TuiInputMode>;
  selectedStartOutlineItem: Accessor<StartStepOutlineItem | undefined>;
  selectedStartPane: Accessor<StartPane>;
  selectedStartStepId: Accessor<string>;
  selectedStartTriggerSummary: Accessor<WorkflowTuiTriggerBoundarySummary | undefined>;
  selectedTrigger: Accessor<TriggerDescriptor | undefined>;
  selectedTriggerIndex: Accessor<number>;
  selectedTriggerJob: Accessor<TriggerJobSnapshot | undefined>;
  selectedWorkflow: Accessor<WorkflowAppWorkflowDescriptor>;
  selectedWorkflowId: Accessor<string>;
  selectedWorkflowIndex: Accessor<number>;
  selectedWorkspaceFrame: Accessor<TuiWorkspaceFrame | undefined>;
  sessionListDialog: Accessor<WorkflowSessionListDialogState | undefined>;
  setArtifacts: Setter<TuiArtifact[]>;
  setCommandIndex: Setter<number>;
  setCommandOpen: Setter<boolean>;
  setCommandQuery: Setter<string>;
  setConfigOverridesByWorkflow: Setter<Record<string, Record<string, unknown>>>;
  setConfigValueEditor: Setter<ConfigValueEditor | undefined>;
  setDetailCollapsedStepIds: Setter<ReadonlySet<string>>;
  setDialog: Setter<ShellDialog | undefined>;
  setError: Setter<string>;
  setExpandedStartStepIds: Setter<ReadonlySet<string>>;
  setHookRun: Setter<WorkflowAppRun | undefined>;
  setHookValue: Setter<string>;
  setInputModeByWorkflow: Setter<Record<string, TuiInputMode>>;
  setLastViewedRunId: Setter<string | undefined>;
  setLeaderActive: Setter<boolean>;
  setLeaderForKey(value: boolean): void;
  setLibraryDiagramOpen: Setter<boolean>;
  setLibraryViewMode: Setter<WorkflowLibraryViewMode>;
  setMetadataPopupOpen: Setter<boolean>;
  setPrompt: Setter<string>;
  setPromptAttachments: Setter<TuiPromptAttachment[]>;
  setPromptCursor: Setter<number>;
  setPromptFileViewer: Setter<PromptFileViewer | undefined>;
  setPromptFileViewerScrollOffset: Setter<number>;
  setQuestionActive: Setter<boolean>;
  setResult: Setter<string>;
  setResultPopup: Setter<ResultArtifactPopupState | undefined>;
  setResultPopupScrollOffset: Setter<number>;
  setRoute: Setter<ShellRoute>;
  setSelectedInputFieldIndex: Setter<number>;
  setSelectedJobIndex: Setter<number>;
  setSelectedMetadataPromptRowIndex: Setter<number>;
  setSelectedSidebarTab: Setter<SidebarTab>;
  setSelectedStartCenterTab: Setter<StartCenterTab>;
  setSelectedStartPane: Setter<StartPane>;
  setSelectedStartStepId: Setter<string>;
  setSelectedTriggerIndex: Setter<number>;
  setSelectedWorkflowId: Setter<string>;
  setSessionListDialog: Setter<WorkflowSessionListDialogState | undefined>;
  setSlashIndex: Setter<number>;
  setSlashOpen: Setter<boolean>;
  setSlashQuery: Setter<string>;
  setSnapshot: Setter<WorkflowRunStoreSnapshot>;
  setSpinnerFrame: Setter<number>;
  setStatus: Setter<ShellStatus>;
  setStepInspectorPopup: Setter<StepInspectorPopupState | undefined>;
  setStepInspectorPopupScrollOffset: Setter<number>;
  setStepInspectorPopupSelectedLineIndex: Setter<number>;
  setStore: Setter<WorkflowRunStore>;
  setToast: Setter<ShellToast | undefined>;
  setTriggerJobs: Setter<TriggerJobSnapshot[]>;
  setTriggers: Setter<TriggerDescriptor[]>;
  setViewedRunOrigin: Setter<WorkflowAppRunOrigin | undefined>;
  setWorkflowExportMode: Setter<boolean>;
  setWorkflowExportSelection: Setter<ReadonlySet<string>>;
  setWorkflowExportWizard: Setter<WorkflowExportWizardState | undefined>;
  setWorkflowQuery: Setter<string>;
  setWorkflowRoomVisible: Setter<boolean>;
  setWorkflowViewProtocolMode: Setter<WorkflowViewProtocolPanelMode>;
  setWorkflowRevision: Setter<number>;
  setWorkspaceRevision: Setter<number>;
  showSidebar: Accessor<boolean>;
  showStartDiagramPane: Accessor<boolean>;
  slashCommands: Accessor<SlashCommand[]>;
  slashIndex: Accessor<number>;
  slashOpen: Accessor<boolean>;
  slashQuery: Accessor<string>;
  snapshot: Accessor<WorkflowRunStoreSnapshot>;
  spinnerFrame: Accessor<number>;
  startDesignGraph: Accessor<ReturnType<WorkflowApp["graph"]>>;
  startInputForm: Accessor<TuiInputForm | undefined>;
  startStepOutlineItems: Accessor<StartStepOutlineItem[]>;
  startWorkflowTriggerSummary: Accessor<WorkflowTuiTriggerBoundarySummary | undefined>;
  status: Accessor<ShellStatus>;
  stepInspectorPopup: Accessor<StepInspectorPopupState | undefined>;
  stepInspectorPopupScrollOffset: Accessor<number>;
  stepInspectorPopupSelectedLineIndex: Accessor<number>;
  store: Accessor<WorkflowRunStore>;
  toast: Accessor<ShellToast | undefined>;
  triggerJobs: Accessor<TriggerJobSnapshot[]>;
  triggers: Accessor<TriggerDescriptor[]>;
  viewedRun: () => WorkflowAppRun | undefined;
  viewedRunOrigin: Accessor<WorkflowAppRunOrigin | undefined>;
  visibleStartInputForm: Accessor<TuiInputForm | undefined>;
  workflowExportFields: Accessor<WorkflowTuiExportFieldDescriptor[]>;
  workflowExportMode: Accessor<boolean>;
  workflowExportSelection: Accessor<ReadonlySet<string>>;
  workflowExportWizard: Accessor<WorkflowExportWizardState | undefined>;
  workflowIds: Accessor<string[]>;
  workflowQuery: Accessor<string>;
  workflowRoomVisible: Accessor<boolean>;
  workflowViewProtocolMode: Accessor<WorkflowViewProtocolPanelMode>;
  workflowViewSnapshot: Accessor<WorkflowViewSnapshot | undefined>;
  workflowRevision: Accessor<number>;
  workflows: Accessor<WorkflowAppWorkflowDescriptor[]>;
  workspaceRevision: Accessor<number>;
};
