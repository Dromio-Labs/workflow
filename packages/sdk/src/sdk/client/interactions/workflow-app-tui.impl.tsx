/** @jsxImportSource @opentui/solid */
import {
  createCliRenderer,
  decodePasteBytes,
  parseKeypress,
  type CliRenderer,
  type KeyEvent,
  type MouseEvent as TuiMouseEvent,
  type PasteEvent,
  SyntaxStyle,
} from "@opentui/core";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { platform, release, tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  render,
  usePaste,
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/solid";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  type JSX,
  untrack,
} from "solid-js";
import {
  createWorkflowRunStore,
  type WorkflowRunConversationSection,
  type WorkflowRunConversationView,
  type WorkflowRunSemanticRow,
  type WorkflowRunStore,
  type WorkflowRunStoreSnapshot,
} from "./workflow-run-store.js";
import {
  createQuestionDockController,
  QuestionDock,
  type QuestionDockController,
} from "./opentui-workflow-renderer.impl.js";
import {
  artifactEnd,
} from "./workflow-app-artifacts.js";
import {
  projectWorkflowDiagram,
  projectWorkflowGraphDiagram,
  workflowWorkspacePatchPreview,
} from "./workflow-diagram.js";
import {
  createWorkflowAppRuntime,
  formatWorkflowAppResult,
  resolveWorkflowAppStartInput,
  snapshotWorkflowAppRun,
  type WorkflowApp,
  type WorkflowAppArtifact,
  type WorkflowAppInputAttachment,
  type WorkflowAppRun,
  type WorkflowAppRunOrigin,
  type WorkflowAppRunSnapshot,
  type WorkflowAppRuntime,
  type WorkflowAppWorkflowDescriptor,
} from "./workflow-app.js";
import type {
  EventRecord,
} from "../../core/index.js";
import type {
  TriggerDescriptor,
  TriggerJobSnapshot,
  WorkflowControlPlane,
} from "../../workflow-control-plane/index.js";
import {
  triggerInputJsonRender,
} from "../../workflow-control-plane/index.js";
import type {
  RunWorkflowTuiAppOptions,
  WorkflowTuiExportFieldDescriptor,
  WorkflowTuiExportHandler,
  WorkflowTuiExportResult,
  WorkflowTuiKeymap,
} from "./workflow-app-tui.js";
import {
  normalizeWorkflowTuiKeymap,
  workflowTuiOpenApiUrl,
  workflowTuiSwaggerUrl,
  workflowTuiTriggerBoundarySummary,
  type WorkflowTuiTriggerBoundarySummary,
  workflowTuiTriggerCurl,
} from "./workflow-app-tui.js";

import type { ConfigValueEditor, ConfigValueSaveTarget, ExternalEditorTarget, PromptFileViewer, ResultArtifactPopupState, ShellCommand, ShellDialog, ShellRoute, ShellStatus, ShellToast, SidebarTab, SlashCommand, StartCenterTab, StartPane, StepInspectorPopupAction, StepInspectorPopupLine, StepInspectorPopupState, TuiArtifact, TuiFormattedRun, TuiInputForm, TuiInputFormField, TuiInputMode, TuiWorkflowAppManifest, TuiWorkflowAppWorkflowGroup, TuiPromptAttachment, TuiWorkspaceFrame, WorkflowConfigField, WorkflowExportWizardState, WorkflowLibraryAppListing, WorkflowLibraryViewMode, WorkflowSessionListDialogState, WorkflowViewProtocolPanelMode } from "./workflow-app-tui-parts/types.js";
import { truncate, truncateToWidth } from "./workflow-app-tui-parts/string-format.js";
import { defaultTriggerInputText, formFieldCursorEnd, formFieldEditableValue, formFieldStructuredLine, formFieldStructuredPrefix, formFieldValue, inputDraftPreview, inputFormHeaderLine, inputFormValueMissing, inputFormValueTypeError, jsonExampleLinesFromText, jsonRenderFields, parsePromptObject, publishedInputExampleLines, renderedJsonFormPrompt, renderedJsonFormValidation, stringValue, titleFromIdentifier, triggerInputExampleLines, triggerInputFields, triggerInputIsSingleText, tuiFormValue, workflowStartInputForm } from "./workflow-app-tui-parts/input-form.js";
import { appendPromptText, extensionForMediaType, formatBytes, isPromptAttachmentMediaType, mediaTypeFromPath, nextAttachmentLabel, pastedFilePath, promptAttachmentDisplayPath, promptInputWithAttachments, safeFilenameStem, savePromptAttachment } from "./workflow-app-tui-parts/attachments.js";
import { copyTextToClipboard, copyTextToNativeClipboard, externalEditorCommandParts, openExternalUrl, openPathInExternalEditor, prepareExternalEditorPath, readClipboardImage, resetTerminalInputModes, runBufferedCommand, runExternalEditorCommand, writeClipboardCommand } from "./workflow-app-tui-parts/native-io.js";

import { modelWorkerOptionLabel } from "./workflow-app-tui-parts/active-run-session.js";
import { runDurationText } from "./workflow-app-tui-parts/activity-table.js";
import { displayText, nestedStepById, nestedStepRows, stepDetailTitle, type WorkflowStepDetailTarget, workflowStepDisplayLabel } from "./workflow-app-tui-parts/artifact-step-pages.js";
import { clampNumber, CommandPalette, SlashCommandMenu, WorkflowExportWizardDialog } from "./workflow-app-tui-parts/command-palette.js";
import { metadataRowExternalEditorTarget, workflowConfigExternalEditorTarget, workflowConfigFieldEffectiveValue, workflowConfigurationEditPrompt, workflowConfigValueFromDraft, workflowPromptWithConfigValue, workflowPromptWithoutConfigValue, writeWorkflowConfigValue } from "./workflow-app-tui-parts/config-utils.js";
import { WorkflowDiagramPopup } from "./workflow-app-tui-parts/diagram-view.js";
import { artifactContent, artifactDisplayPath, ConfigValueEditorDialog, firstStepInspectorPopupActionLineIndex, PromptFileViewerDialog, promptFileViewerMaxScrollOffset, promptFileViewerViewportRows, resultArtifactName, ResultArtifactPopup, resultPopupMaxScrollOffset, resultPopupVisibleRows, selectedArtifactFor, ShellDialogView, ShellToastView, StepInspectorPopup, stepInspectorPopupActionLineIndexes, stepInspectorPopupContentWidth, stepInspectorPopupMaxScrollOffset, stepInspectorPopupVisibleRows, stepInspectorPopupWrappedIndexForLine, toastLeft, toastWidth } from "./workflow-app-tui-parts/dialogs-popups.js";
import { HookDock, InteractionDock, StatusBar } from "./workflow-app-tui-parts/dock-status.js";
import { isRecord, readWorkflowAppManifests, workflowLibraryAppListings, workflowLibraryAppQueryWorkflowIds, workflowLibrarySelectableWorkflowIds } from "./workflow-app-tui-parts/library-view.js";
import { clampIndex, deletePreviousWord, isCtrlNavigationKey, isDeletePreviousWordKey, isDownKey, isEndKey, isEscapeKey, isHomeKey, isInterruptKey, isLeftKey, isPageDownKey, isPageUpKey, isPasteKey, isReturnKey, isRightKey, isSlashCommandKey, isUpKey, keyMatches, parseHookInput, stepSpins } from "./workflow-app-tui-parts/routing-keyboard.js";
import { findWorkflowAppRun, formatTuiRunResult, isWorkflowTuiImmediateExitSequence, propsOnInterrupt, shellStatus, workflowStepLabelForToast } from "./workflow-app-tui-parts/runtime-utils.js";
import { filteredWorkflowSessionRuns, normalizeWorkflowSessionListPosition, WorkflowSessionListDialog, workflowSessionListVisibleCount } from "./workflow-app-tui-parts/session-dialog.js";
import { clearTerminalSurface, ShellHeader, ShellMain } from "./workflow-app-tui-parts/shell-frame.js";
import { formatWorkspaceTestDuration, workflowCanvasGraph, WorkflowSidebar, workspaceIssueValue, workspacePatchCount } from "./workflow-app-tui-parts/sidebar.js";
import { StartMetadataPopup } from "./workflow-app-tui-parts/start-metadata-panel.js";
import { stepRuntimeDataContent } from "./workflow-app-tui-parts/step-detail-view.js";
import { formatDromioWordmark, LAYOUT, shouldUseAnsiColor, SPINNER_FRAMES, THEME, TUI_NAME, WORKFLOW_EXPORT_STEPS } from "./workflow-app-tui-parts/style.js";
import { firstDesignNodeId, parentStepIdFromChildStepId, slashCommandInputForRun, workflowDescriptor, workflowDiagramSelectableStepIds, workflowStartOutlineItems } from "./workflow-app-tui-parts/workflow-design.js";
import { defaultWorkflowExportFields, workflowExportInitialValues, workflowExportStepFields, workflowExportStepIndex, workflowExportValidationError } from "./workflow-app-tui-parts/workflow-export.js";
import { metadataSelectionRows } from "./workflow-app-tui-parts/workflow-file-helpers.js";
import { workflowAppTuiProtocolSnapshot } from "./workflow-app-tui-parts/workflow-view-protocol-snapshot.js";

import { createWorkflowAppTuiShellHandlers1 } from "./workflow-app-tui-parts/shell-handlers-1.js";
import { createWorkflowAppTuiShellHandlers2 } from "./workflow-app-tui-parts/shell-handlers-2.js";
import { createWorkflowAppTuiShellHandlers3 } from "./workflow-app-tui-parts/shell-handlers-3.js";
import { createWorkflowAppTuiShellHandlers4 } from "./workflow-app-tui-parts/shell-handlers-4.js";
import { createWorkflowAppTuiShellHandlers5 } from "./workflow-app-tui-parts/shell-handlers-5.js";
import { createWorkflowAppTuiShellHandlers6 } from "./workflow-app-tui-parts/shell-handlers-6.js";
import { createWorkflowAppTuiShellHandlers7 } from "./workflow-app-tui-parts/shell-handlers-7.js";
import { createWorkflowAppTuiShellHandlers8 } from "./workflow-app-tui-parts/shell-handlers-8.js";
import { createWorkflowAppTuiShellHandlers9 } from "./workflow-app-tui-parts/shell-handlers-9.js";
import { createWorkflowAppTuiShellHandlers10 } from "./workflow-app-tui-parts/shell-handlers-10.js";
import { createWorkflowAppTuiShellHandlers11 } from "./workflow-app-tui-parts/shell-handlers-11.js";
import { createWorkflowAppTuiShellHandlers12 } from "./workflow-app-tui-parts/shell-handlers-12.js";
import { createWorkflowAppTuiShellHandlers13 } from "./workflow-app-tui-parts/shell-handlers-13.js";
import { WorkflowAppTuiShellView } from "./workflow-app-tui-parts/shell-view.js";
import { createWorkflowAppTuiShellCommands } from "./workflow-app-tui-parts/shell-commands.js";
import { installWorkflowAppTuiShellInput } from "./workflow-app-tui-parts/shell-input.js";
import { type WorkflowAppTuiShellContext } from "./workflow-app-tui-parts/shell-context.js";
import { createPromptHistoryState } from "./workflow-app-tui-parts/prompt-history.js";
export { formatWorkflowTuiExitSummary } from "./workflow-app-tui-parts/exit-summary.js";
export { runWorkflowTuiApp } from "./workflow-app-tui-parts/runner.js";
export { isWorkflowTuiEscapeSequence, isWorkflowTuiImmediateExitSequence } from "./workflow-app-tui-parts/runtime-utils.js";
import { createWorkflowAppTuiShellDerived } from "./workflow-app-tui-parts/shell-derived.js";

export function WorkflowAppTuiShell(props: {
  app: WorkflowApp;
  commandName?: string;
  defaultPrompt?: string;
  emptyAnswerHint?: false | string;
  exportWorkflows?: WorkflowTuiExportHandler;
  initialRunId?: string;
  initialWorkflowId?: string;
  onExit(): void;
  controlPlane?: WorkflowControlPlane;
  keymap?: Partial<WorkflowTuiKeymap>;
  runtime: WorkflowAppRuntime;
}) {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const initialWorkflowIds = props.app.workflowIds();
  const commandName = props.commandName ?? TUI_NAME;
  const keymap = normalizeWorkflowTuiKeymap(props.keymap);
  const initialRun = findWorkflowAppRun(props.runtime, props.initialRunId);
  const initialWorkflow = initialRun?.workflowId ?? (props.initialWorkflowId && initialWorkflowIds.includes(props.initialWorkflowId)
    ? props.initialWorkflowId
    : props.app.defaultWorkflowId);
  const initialStore = createWorkflowRunStore({
    batchMs: initialRun ? 0 : undefined,
    graph: props.app.graph(initialWorkflow),
    input: initialRun?.input,
  });
  if (initialRun) {
    for (const event of initialRun.events) initialStore.push(event);
    initialStore.flush();
  }
  const initialFormatted = initialRun
    ? formatTuiRunResult(props.app, initialRun)
    : { error: "", result: "" };
  const questionController = createQuestionDockController();
  const [route, setRoute] = createSignal<ShellRoute>(initialRun
    ? {
      runId: initialRun.runId,
      type: "run",
      workflowId: initialRun.workflowId,
    }
    : props.defaultPrompt
    ? { type: "start", workflowId: initialWorkflow }
    : { type: "library" });
  const [selectedWorkflowId, setSelectedWorkflowId] = createSignal(initialWorkflow);
  const [store, setStore] = createSignal<WorkflowRunStore>(initialStore);
  const [snapshot, setSnapshot] = createSignal<WorkflowRunStoreSnapshot>(initialStore.snapshot());
  const [questionActive, setQuestionActive] = createSignal(Boolean(questionController.current()));
  const [hookRun, setHookRun] = createSignal<WorkflowAppRun | undefined>(
    initialRun?.session.pendingHooks?.length ? initialRun : undefined,
  );
  const [hookValue, setHookValue] = createSignal("");
  const [prompt, setPrompt] = createSignal(props.defaultPrompt ?? "");
  const [promptCursor, setPromptCursor] = createSignal((props.defaultPrompt ?? "").length);
  const [result, setResult] = createSignal(initialFormatted.result);
  const [error, setError] = createSignal(initialFormatted.error);
  const [status, setStatus] = createSignal<ShellStatus>(initialRun ? shellStatus(initialRun.status) : "idle");
  const [commandOpen, setCommandOpen] = createSignal(false);
  const [commandIndex, setCommandIndex] = createSignal(0);
  const [commandQuery, setCommandQuery] = createSignal("");
  const [slashOpen, setSlashOpen] = createSignal(false);
  const [slashIndex, setSlashIndex] = createSignal(0);
  const [slashQuery, setSlashQuery] = createSignal("");
  const [leaderActive, setLeaderActive] = createSignal(false);
  const [dialog, setDialog] = createSignal<ShellDialog | undefined>();
  const [configValueEditor, setConfigValueEditor] = createSignal<ConfigValueEditor | undefined>();
  const [promptFileViewer, setPromptFileViewer] = createSignal<PromptFileViewer | undefined>();
  const [promptFileViewerScrollOffset, setPromptFileViewerScrollOffset] = createSignal(0);
  const [resultPopup, setResultPopup] = createSignal<ResultArtifactPopupState | undefined>();
  const [resultPopupScrollOffset, setResultPopupScrollOffset] = createSignal(0);
  const [stepInspectorPopup, setStepInspectorPopup] = createSignal<StepInspectorPopupState | undefined>();
  const [stepInspectorPopupScrollOffset, setStepInspectorPopupScrollOffset] = createSignal(0);
  const [stepInspectorPopupSelectedLineIndex, setStepInspectorPopupSelectedLineIndex] = createSignal(0);
  const [sessionListDialog, setSessionListDialog] = createSignal<WorkflowSessionListDialogState | undefined>();
  const [libraryDiagramOpen, setLibraryDiagramOpen] = createSignal(false);
  const [metadataPopupOpen, setMetadataPopupOpen] = createSignal(false);
  const [selectedMetadataPromptRowIndex, setSelectedMetadataPromptRowIndex] = createSignal(0);
  const [toast, setToast] = createSignal<ShellToast | undefined>();
  const [spinnerFrame, setSpinnerFrame] = createSignal(0);
  const [artifacts, setArtifacts] = createSignal<TuiArtifact[]>(initialRun?.artifacts ?? []);
  const [workflowQuery, setWorkflowQuery] = createSignal("");
  const [libraryViewMode, setLibraryViewMode] = createSignal<WorkflowLibraryViewMode>("apps");
  const [workflowExportMode, setWorkflowExportMode] = createSignal(false);
  const [workflowExportSelection, setWorkflowExportSelection] = createSignal<ReadonlySet<string>>(new Set());
  const [workflowExportWizard, setWorkflowExportWizard] = createSignal<WorkflowExportWizardState | undefined>();
  const [workflowRevision, setWorkflowRevision] = createSignal(0);
  const [triggers, setTriggers] = createSignal<TriggerDescriptor[]>([]);
  const [triggerJobs, setTriggerJobs] = createSignal<TriggerJobSnapshot[]>([]);
  const [selectedTriggerIndex, setSelectedTriggerIndex] = createSignal(0);
  const [selectedJobIndex, setSelectedJobIndex] = createSignal(0);
  const [selectedInputFieldIndex, setSelectedInputFieldIndex] = createSignal(0);
  const [inputModeByWorkflow, setInputModeByWorkflow] = createSignal<Record<string, TuiInputMode>>({});
  const [workflowViewProtocolMode, setWorkflowViewProtocolMode] = createSignal<WorkflowViewProtocolPanelMode>("render");
  const [workflowRoomVisible, setWorkflowRoomVisible] = createSignal(true);
  const [configOverridesByWorkflow, setConfigOverridesByWorkflow] = createSignal<Record<string, Record<string, unknown>>>({});
  const [workspaceRevision, setWorkspaceRevision] = createSignal(0);
  const [lastViewedRunId, setLastViewedRunId] = createSignal<string | undefined>(initialRun?.runId);
  const [viewedRunOrigin, setViewedRunOrigin] = createSignal<WorkflowAppRunOrigin | undefined>(initialRun?.origin);
  const [selectedStartPane, setSelectedStartPane] = createSignal<StartPane>(props.defaultPrompt ? "fields" : "steps");
  const [selectedStartCenterTab, setSelectedStartCenterTab] = createSignal<StartCenterTab>("canvas");
  const [selectedSidebarTab, setSelectedSidebarTab] = createSignal<SidebarTab>(
    initialRun && (initialRun.status === "running" || initialRun.status === "waiting")
      ? "activity"
      : "config",
  );
  const [selectedStartStepId, setSelectedStartStepId] = createSignal(firstDesignNodeId(props.app, initialWorkflow));
  const [expandedStartStepIds, setExpandedStartStepIds] = createSignal<ReadonlySet<string>>(new Set());
  const [detailCollapsedStepIds, setDetailCollapsedStepIds] = createSignal<ReadonlySet<string>>(new Set());
  const [promptAttachments, setPromptAttachments] = createSignal<TuiPromptAttachment[]>([]);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let spinnerTimer: ReturnType<typeof setInterval> | undefined;
  const promptHistoryState = createPromptHistoryState();
  const lastRunIdsByWorkflow = new Map<string, string>(
    initialRun ? [[initialRun.workflowId, initialRun.runId]] : [],
  );
  let unsubscribeStore = initialStore.subscribe(setSnapshot);
  let unsubscribeRun: (() => void) | undefined = initialRun
    ? props.runtime.subscribe(initialRun.runId, (event) => {
      initialStore.push(event);
    })
    : undefined;
  let leaderForKey = false;
  onCleanup(() => {
    if (toastTimer) clearTimeout(toastTimer);
    if (spinnerTimer) clearInterval(spinnerTimer);
    renderer.console.onCopySelection = undefined;
    unsubscribeRun?.();
    unsubscribeStore();
    store().close();
  });
  onCleanup(questionController.subscribe((request) => {
    setQuestionActive(Boolean(request));
  }));
  if (initialRun) updateArtifactsForRun(initialRun);
  onMount(() => {
    renderer.console.onCopySelection = (text: string) => {
      if (!text) return;
      copyTextWithToast(text);
      renderer.clearSelection();
    };
    void refreshTriggerRuntime();
  });

  const workflows = createMemo(() => {
    workflowRevision();
    return props.app.listWorkflows();
  });
  const appManifests = createMemo(() => {
    workflowRevision();
    return readWorkflowAppManifests(process.cwd());
  });
  const appListings = createMemo(() => workflowLibraryAppListings(appManifests(), workflows()));
  const workflowIds = createMemo(() => {
    workflowRevision();
    return props.app.workflowIds();
  });
  const selectedWorkflow = createMemo(() => workflowDescriptor(workflows(), selectedWorkflowId()));
  const selectedWorkspaceFrame = createMemo(() => {
    workspaceRevision();
    snapshot();
    return props.app.workspaceFrame(selectedWorkflowId());
  });
  const hasRunningStep = createMemo(() => snapshot().steps.some((step) => stepSpins(step.status)));
  const visibleQuestionActive = createMemo(() => questionActive());
  let terminalClearSignature = "";
  createEffect(() => {
    const size = dimensions();
    const currentRoute = route();
    const signature = [
      currentRoute.type,
      currentRoute.type === "run" ? currentRoute.runId : selectedWorkflowId(),
      status(),
      workflowViewProtocolMode(),
      workflowRoomVisible() ? "room" : "no-room",
      visibleQuestionActive() ? "question" : "no-question",
      `${size.width}x${size.height}`,
    ].join(":");
    if (signature === terminalClearSignature) return;
    terminalClearSignature = signature;
    clearTerminalSurface(renderer);
  });
  let shellHandlers: Record<string, any> = {};
  let commands = () => [] as ShellCommand[];
  let filteredCommands = () => [] as ShellCommand[];
  let slashCommands = () => [] as SlashCommand[];
  let filteredSlashCommands = () => [] as SlashCommand[];
  const setLeaderForKey = (value: boolean) => {
    leaderForKey = value;
  };
  const { activeRunHeaderMeta, showSidebar, showStartDiagramPane, selectedWorkflowIndex, filteredWorkflows, libraryWorkflowIds, selectedLibraryIndex, workflowExportFields, selectedTrigger, startDesignGraph, startStepOutlineItems, selectedStartOutlineItem, startWorkflowTriggerSummary, selectedStartTriggerSummary, selectedMetadataRows, startInputForm, selectedStartInputMode, visibleStartInputForm, selectedTriggerJob, latestRun, modelWorkerOptions, viewedRun, activeModelStep } = createWorkflowAppTuiShellDerived({ appListings, dimensions, expandedStartStepIds, inputModeByWorkflow, lastViewedRunId, libraryViewMode, prompt, props, route, runById: (runId: string) => shellHandlers.runById?.(runId), selectedJobIndex, selectedStartStepId, selectedTriggerIndex, selectedWorkflow, selectedWorkflowId, selectedWorkflowRun: () => shellHandlers.selectedWorkflowRun?.(), selectedWorkspaceFrame, snapshot, status, triggerJobs, triggers, workflowIds, workflowQuery, workflows });
  const shellContext: WorkflowAppTuiShellContext = () => ({ activeModelStep, activeRunHeaderMeta, appListings, appManifests, artifacts, commandIndex, commandName, commandOpen, commandQuery, configOverridesByWorkflow, configValueEditor, detailCollapsedStepIds, dialog, dimensions, error, expandedStartStepIds, filteredCommands, filteredSlashCommands, filteredWorkflows, hasRunningStep, hookRun, hookValue, initialFormatted, initialRun, initialStore, initialWorkflow, initialWorkflowIds, inputModeByWorkflow, keymap, lastRunIdsByWorkflow, lastViewedRunId, latestRun, leaderActive, leaderForKey, libraryDiagramOpen, libraryViewMode, libraryWorkflowIds, metadataPopupOpen, modelWorkerOptions, prompt, promptAttachments, promptCursor, promptFileViewer, promptFileViewerScrollOffset, promptHistory: promptHistoryState.items, promptHistoryCursor: promptHistoryState.cursor, promptHistoryDraft: promptHistoryState.draft, setPromptHistoryCursor: promptHistoryState.setCursor, setPromptHistoryDraft: promptHistoryState.setDraft, props, questionActive, questionController, renderer, result, resultPopup, resultPopupScrollOffset, route, selectedInputFieldIndex, selectedJobIndex, selectedLibraryIndex, selectedMetadataPromptRowIndex, selectedMetadataRows, selectedSidebarTab, selectedStartCenterTab, selectedStartInputMode, selectedStartOutlineItem, selectedStartPane, selectedStartStepId, selectedStartTriggerSummary, selectedTrigger, selectedTriggerIndex, selectedTriggerJob, selectedWorkflow, selectedWorkflowId, selectedWorkflowIndex, selectedWorkspaceFrame, sessionListDialog, setArtifacts, setCommandIndex, setCommandOpen, setCommandQuery, setConfigOverridesByWorkflow, setConfigValueEditor, setDetailCollapsedStepIds, setDialog, setError, setExpandedStartStepIds, setHookRun, setHookValue, setInputModeByWorkflow, setLastViewedRunId, setLeaderActive, setLeaderForKey, setLibraryDiagramOpen, setLibraryViewMode, setMetadataPopupOpen, setPrompt, setPromptAttachments, setPromptCursor, setPromptFileViewer, setPromptFileViewerScrollOffset, setQuestionActive, setResult, setResultPopup, setResultPopupScrollOffset, setRoute, setSelectedInputFieldIndex, setSelectedJobIndex, setSelectedMetadataPromptRowIndex, setSelectedSidebarTab, setSelectedStartCenterTab, setSelectedStartPane, setSelectedStartStepId, setSelectedTriggerIndex, setSelectedWorkflowId, setSessionListDialog, setSlashIndex, setSlashOpen, setSlashQuery, setSnapshot, setSpinnerFrame, setStatus, setStepInspectorPopup, setStepInspectorPopupScrollOffset, setStepInspectorPopupSelectedLineIndex, setStore, setToast, setTriggerJobs, setTriggers, setViewedRunOrigin, setWorkflowExportMode, setWorkflowExportSelection, setWorkflowExportWizard, setWorkflowQuery, setWorkflowRoomVisible, setWorkflowViewProtocolMode, setWorkflowRevision, setWorkspaceRevision, showSidebar, showStartDiagramPane, slashCommands, slashIndex, slashOpen, slashQuery, snapshot, spinnerFrame, spinnerTimer, startDesignGraph, startInputForm, startStepOutlineItems, startWorkflowTriggerSummary, status, stepInspectorPopup, stepInspectorPopupScrollOffset, stepInspectorPopupSelectedLineIndex, store, terminalClearSignature, toast, toastTimer, triggerJobs, triggers, unsubscribeRun, unsubscribeStore, updateArtifactsForRun, viewedRun, viewedRunOrigin, visibleQuestionActive, visibleStartInputForm, workflowExportFields, workflowExportMode, workflowExportSelection, workflowExportWizard, workflowIds, workflowQuery, workflowRoomVisible, workflowViewProtocolMode, workflowViewSnapshot: () => workflowAppTuiProtocolSnapshot({ app: props.app, fixture: process.env.DROMIO_WORKFLOW_UI_FIXTURE, run: viewedRun(), selectedStepId: snapshot().currentStepId, workflowId: selectedWorkflowId() }), workflowRevision, workflows, workspaceRevision, ...shellHandlers });
  shellHandlers = { ...createWorkflowAppTuiShellHandlers1(shellContext), ...createWorkflowAppTuiShellHandlers2(shellContext), ...createWorkflowAppTuiShellHandlers3(shellContext), ...createWorkflowAppTuiShellHandlers4(shellContext), ...createWorkflowAppTuiShellHandlers5(shellContext), ...createWorkflowAppTuiShellHandlers6(shellContext), ...createWorkflowAppTuiShellHandlers7(shellContext), ...createWorkflowAppTuiShellHandlers8(shellContext), ...createWorkflowAppTuiShellHandlers9(shellContext), ...createWorkflowAppTuiShellHandlers10(shellContext), ...createWorkflowAppTuiShellHandlers11(shellContext), ...createWorkflowAppTuiShellHandlers12(shellContext), ...createWorkflowAppTuiShellHandlers13(shellContext) };
  const { commandKey, openWorkflowSessions, loadWorkflowSessions, liveWorkflowRunSnapshots, handleSessionListDialogKey, moveWorkflowSessionListSelection, scrollWorkflowSessions, handleDialogKey, handlePromptFileViewerKey, handleStepInspectorPopupKey, closeStepInspectorPopup, openSelectedStepInspectorPopupLine, moveStepInspectorPopupSelection, keepStepInspectorPopupLineVisible, scrollPromptFileViewer, handleMetadataPopupKey, handleConfigValueEditorKey, handleConfigValueEditorPaste, setConfigValueEditorDraft, openConfigValueEditor, openPromptFileViewer, selectedExternalEditorTarget, openWorkflowConfigExternalEditor, openSelectedExternalEditorTarget, openExternalEditorTarget, refreshWorkflowConfigOverridesFromFile, openActiveRunStepInspectorPopup, openStepRuntimeDataViewer, openActivityContentViewer, toggleConfigValueEditorTarget, saveConfigValueEditor, copySelectionToClipboard, copySelectedTextToClipboard, copyTextWithToast, showToast, handleInterruptKey, handleCommandKey, buildWorkflowShellSlashCommands, openSlashCommands, toggleLibraryView, closeSlashCommands, handleSlashCommandKey, handleLibraryKey, openWorkflowExportMode, toggleWorkflowExportSelection, openWorkflowExportWizard, handleWorkflowExportWizardKey, handleWorkflowExportWizardPaste, submitWorkflowExportWizard, handleLibraryDiagramKey, replacePromptDraft, editPromptDraft, insertPromptTextAtCursor, appendPromptTextAtCursor, deletePromptCharacterBeforeCursor, deletePromptWordBeforeCursor, movePromptCursor, handleStartKey, switchStartPane, handleStartStepPaneKey, handleStartCanvasPaneKey, handleStartMetadataPaneKey, handleStepDetailTreeKey, isStartStepPaneEditingKey, handleStartFormKey, setStartInputMode, handleTriggersKey, handleTriggerFireKey, handleTriggerJobsKey, handlePasteEvent, pasteClipboardImage, attachPromptFile, addPromptAttachment, handleRunKey, handleResultPopupKey, handleHookKey, installStore, installViewedRun, installViewedRunSnapshot, viewRun, openResultPopup, viewArtifact, viewStep, viewRunSnapshot, selectWorkflow, selectWorkflowIndexId, selectStartStep, selectStartStepBoundary, selectStartCanvasStep, selectStartCanvasBoundary, selectStartStepId, selectStartDiagramStepId, expandSelectedStartStep, collapseSelectedStartStep, prepareSelectedStepForDetail, selectStepDetailStep, selectStepDetailBoundary, selectedStepDetailTarget, openSelectedStepRuntimeData, selectStepDetailStepId, collapseSelectedDetailStep, expandSelectedDetailStep, visibleStepDetailStepIds, selectedStepDetailStepId, stepDetailParentStepId, stepDetailStepHasChildren, setDetailStepCollapsed, toggleDetailStepCollapsed, setStartStepExpanded, selectInputField, moveFormFieldCursor, editFormFieldDraft, setFormFieldValue, rememberPromptHistory, recallPromptHistory, resetPromptHistoryBrowse, updateWorkflowQuery, refreshTriggerRuntime, selectTriggerIndex, selectJobIndex, navigateTriggers, navigateTriggerJobs, navigateTriggerFire, submitTriggerPrompt, selectedWorkspaceSource, workspaceCommands, publishSelectedWorkspaceDraft, testSelectedWorkspaceDraft, registerPublishedWorkspaceWorkflow, mutateSelectedWorkspace, triggerCommands, copySelectedTriggerCurl, copyOpenApiUrl, openSwaggerUi, copySelectedJobId, openSelectedJobRun, retrySelectedJob, confirmSelectedJobCancel, confirmSelectedJobDeadLetter, runJobOperation, showHelpDialog, showErrorDialog, stepModelSelectionCommands, selectStepModel, navigateLibrary, navigateStart, navigateBackFromRoute, activeWorkflowBlocksLibraryNavigation, isActiveWorkflowStatus, showWorkflowLibraryBlockedToast, clearPromptDraft, submitPrompt, startInputValidation, promptTextForStartSubmission, workspaceTestPromptInput, submitHookValue, continueRun, rememberRun, selectedWorkflowRun, runById } = shellHandlers;
  createEffect(() => {
    selectedWorkflowId();
    setSelectedStartPane(props.defaultPrompt && route().type === "start" ? "fields" : "steps");
    setSelectedStartCenterTab("canvas");
    setExpandedStartStepIds(new Set<string>());
    setDetailCollapsedStepIds(new Set<string>());
    setSelectedInputFieldIndex(0);
    setSelectedMetadataPromptRowIndex(0);
  });
  createEffect(() => {
    const currentRoute = route();
    if (currentRoute.type !== "start") return;
    const itemIds = startStepOutlineItems().map((item) => item.id);
    if (itemIds.length === 0) return;
    if (!itemIds.includes(selectedStartStepId() ?? "")) {
      setSelectedStartStepId(itemIds[0]);
    }
  });
  createEffect(() => {
    const form = startInputForm();
    if (!form) {
      setSelectedInputFieldIndex(0);
      return;
    }
    setSelectedInputFieldIndex((index) => clampIndex(index, form.fields.length));
  });
  createEffect(() => {
    setPromptCursor((cursor) => clampNumber(cursor, 0, prompt().length));
  });
  createEffect(() => {
    const rows = selectedMetadataRows();
    setSelectedMetadataPromptRowIndex((index) => clampIndex(index, rows.length));
  });
  commands = createWorkflowAppTuiShellCommands(shellContext);
  filteredCommands = createMemo(() => {
    const query = commandQuery().trim().toLowerCase();
    if (!query) return commands();
    return commands().filter((command) =>
      command.title.toLowerCase().includes(query) ||
      command.value.toLowerCase().includes(query) ||
      command.hint?.toLowerCase().includes(query)
    );
  });
  slashCommands = createMemo(() => buildWorkflowShellSlashCommands());
  filteredSlashCommands = createMemo(() => {
    const query = slashQuery().trim().toLowerCase();
    if (!query) return slashCommands();
    const commandQuery = query.split(/\s+/, 1)[0] ?? query;
    return slashCommands().filter((command: any) =>
      command.name.toLowerCase().includes(commandQuery) ||
      command.description.toLowerCase().includes(query)
    );
  });
  createEffect(() => {
    if (!hasRunningStep()) {
      if (spinnerTimer) {
        clearInterval(spinnerTimer);
        spinnerTimer = undefined;
      }
      setSpinnerFrame(0);
      return;
    }
    if (spinnerTimer) return;
    spinnerTimer = setInterval(() => {
      setSpinnerFrame((frame) => (frame + 1) % SPINNER_FRAMES.length);
    }, 80);
    if (typeof spinnerTimer === "object" && "unref" in spinnerTimer) spinnerTimer.unref();
  });

  installWorkflowAppTuiShellInput(shellContext);
  return <WorkflowAppTuiShellView ctx={shellContext} />;

  function updateArtifactsForRun(run: WorkflowAppRun) {
    if (lastViewedRunId() === run.runId) setArtifacts(run.artifacts ?? []);
  }
}
