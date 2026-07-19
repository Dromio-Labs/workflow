import {
  createWorkflowHookResumeCommand,
  createWorkflowJsonRenderRegistry,
  createWorkflowViewCommandResult,
  inspectWorkflowJsonRenderDocument,
  interactiveWorkflowViewCapabilities,
  processImagesViewSnapshot,
  renderWorkflowJsonRenderDocument,
  validateWorkflowViewRendererAdapterSnapshot,
  workflowHookToJsonRenderDocument,
  workflowJsonRenderInspectionPreference,
  workflowResultToJsonRenderDocument,
  workflowViewCommandResultToJsonRenderDocument,
  type JsonObject,
  type WorkflowJsonRenderRendererInput,
  type WorkflowViewCommandResult,
  type WorkflowViewRendererAdapterContract,
  type WorkflowViewRendererAdapterValidation,
  type WorkflowViewSnapshot,
} from "@dromio/workflow-room-protocol";
import { workflowRenderLayoutProfiles } from "@dromio/workflow-canvas-protocol";
import { THEME } from "./style.js";
import type { WorkflowViewProtocolPanelMode } from "./types.js";
import {
  buttonLine,
  chipLine,
  dividerCardLines,
  intersperseBlankLines,
  terminalCard,
  wrappedCardText,
} from "./workflow-view-protocol-card-lines.js";

export type ProtocolLine = {
  fg?: string;
  text: string;
};

type ProtocolRendererInput = WorkflowJsonRenderRendererInput<Record<string, string | undefined>>;

type ProtocolDocumentSection = {
  document: unknown;
  title: string;
};

export const workbenchTuiWorkflowRendererAdapterContract = {
  capabilities: interactiveWorkflowViewCapabilities,
  id: "dromio-workbench-tui.workflow-protocol-panel",
  jsonRender: {
    components: ["ApprovalCard", "CommandStatus", "ImageBatchSummary", "JsonInspector"],
    defaultMode: workflowJsonRenderInspectionPreference.defaultMode,
    inspectionControl: workflowJsonRenderInspectionPreference.inspectionControl,
    inspectionModes: workflowJsonRenderInspectionPreference.modes.map((mode) => mode.mode),
  },
  label: "Dromio Workbench TUI workflow protocol panel",
  layoutProfile: workflowRenderLayoutProfiles.terminal,
  surface: "dromio-workbench-tui",
} satisfies WorkflowViewRendererAdapterContract;

export function validateWorkbenchTuiWorkflowViewSnapshot(
  snapshot: WorkflowViewSnapshot,
): WorkflowViewRendererAdapterValidation {
  return validateWorkflowViewRendererAdapterSnapshot(
    workbenchTuiWorkflowRendererAdapterContract,
    snapshot,
  );
}

export function workflowViewProtocolFixtureSnapshot(input: {
  fixture?: string;
  workflowId?: string;
}): WorkflowViewSnapshot | undefined {
  if (input.fixture !== "process-images") return undefined;
  if (input.workflowId && input.workflowId !== processImagesViewSnapshot.render.id) return undefined;
  return {
    ...processImagesViewSnapshot,
    commandResults: processImagesViewSnapshot.commandResults?.length
      ? processImagesViewSnapshot.commandResults
      : [processImagesTuiCommandResult()],
  };
}

export function workflowViewProtocolLines(
  snapshot: WorkflowViewSnapshot,
  options: { mode?: WorkflowViewProtocolPanelMode } = {},
): ProtocolLine[] {
  const mode = options.mode ?? "render";
  if (mode !== "render") {
    return [
      ...roomHeaderLines(snapshot, mode),
      ...inspectionLines(snapshot, mode),
      ...validationLines(snapshot),
    ];
  }
  return intersperseBlankLines([
    roomHeaderLines(snapshot, mode),
    hookLines(snapshot),
    commandResultLines(snapshot),
    resultLines(snapshot),
    validationAlertLines(snapshot),
  ].filter((lines) => lines.length > 0));
}

function roomHeaderLines(snapshot: WorkflowViewSnapshot, mode: WorkflowViewProtocolPanelMode): ProtocolLine[] {
  if (mode === "render") return [];
  const modeText = mode === "json"
    ? "Component JSON inspection"
    : "Component schema inspection";
  return [
    { fg: THEME.muted, text: `Inspection · ${snapshot.render.id}` },
    { fg: THEME.info, text: modeText },
  ];
}

function inspectionLines(
  snapshot: WorkflowViewSnapshot,
  mode: Exclude<WorkflowViewProtocolPanelMode, "render">,
): ProtocolLine[] {
  const documents = protocolDocumentSections(snapshot);
  if (documents.length === 0) {
    return [{ fg: THEME.muted, text: "No JSON Render documents in this workflow state" }];
  }
  return documents.flatMap((section) => jsonRenderInspectionLines(section, mode));
}

function protocolDocumentSections(snapshot: WorkflowViewSnapshot): ProtocolDocumentSection[] {
  const sections: ProtocolDocumentSection[] = [];
  for (const hook of snapshot.pendingHooks) {
    sections.push({
      document: workflowHookToJsonRenderDocument(hook),
      title: `Human input · ${hook.title}`,
    });
  }
  for (const result of snapshot.commandResults ?? []) {
    sections.push({
      document: workflowViewCommandResultToJsonRenderDocument(result),
      title: `Command status · ${commandTypeLabel(result.command.type)}`,
    });
  }
  const resultDocument = snapshot.result ? workflowResultToJsonRenderDocument(snapshot.result) : undefined;
  if (resultDocument) {
    sections.push({
      document: resultDocument,
      title: snapshot.result?.title ?? "Workflow result",
    });
  }
  return sections;
}

function jsonRenderInspectionLines(
  section: ProtocolDocumentSection,
  mode: Exclude<WorkflowViewProtocolPanelMode, "render">,
): ProtocolLine[] {
  const inspection = inspectWorkflowJsonRenderDocument(section.document, {
    fallbackTitle: section.title,
  });
  const source = mode === "json"
    ? inspection.jsonText
    : JSON.stringify(inspection.schema, null, 2);
  const title = mode === "json" ? "Component JSON" : "Component schema";
  return [
    { fg: THEME.accent, text: `${title} · ${section.title}` },
    { fg: inspection.validation.ok ? THEME.success : THEME.warning, text: `${inspection.component} · ${inspection.schema.catalog}` },
    ...source.split("\n").map((text) => ({ fg: THEME.muted, text })),
  ];
}

function hookLines(snapshot: WorkflowViewSnapshot): ProtocolLine[] {
  if (snapshot.pendingHooks.length === 0) return [];
  return intersperseBlankLines(
    snapshot.pendingHooks.map((hook) =>
      renderProtocolDocumentLines(workflowHookToJsonRenderDocument(hook), {
        approveLabel: hook.render?.kind === "approval" ? hook.render.approveLabel : undefined,
        rejectLabel: hook.render?.kind === "approval" ? hook.render.rejectLabel : undefined,
        statusLabel: `${snapshot.pendingHooks.length} pending`,
      })
    ),
  );
}

function commandResultLines(snapshot: WorkflowViewSnapshot): ProtocolLine[] {
  const results = snapshot.commandResults ?? [];
  if (results.length === 0) return [];
  return intersperseBlankLines(
    results.map((result) =>
      renderProtocolDocumentLines(workflowViewCommandResultToJsonRenderDocument(result), {
        statusLabel: `${results.length} recorded`,
      })
    ),
  );
}

function resultLines(snapshot: WorkflowViewSnapshot): ProtocolLine[] {
  if (!snapshot.result) return [];
  const document = workflowResultToJsonRenderDocument(snapshot.result);
  if (!document) {
    return snapshot.result.kind === "markdown"
      ? [
        { fg: THEME.accent, text: snapshot.result.title ?? "Workflow result" },
        { text: snapshot.result.value },
      ]
      : [];
  }
  return [
    ...renderProtocolDocumentLines(document),
  ];
}

function validationLines(snapshot: WorkflowViewSnapshot): ProtocolLine[] {
  const validation = validateWorkbenchTuiWorkflowViewSnapshot(snapshot);
  const checks = validation.ok
    ? ["Graph is renderable"]
    : validation.issues.map((issue) => `${issue.severity}: ${issue.message}`);
  return [
    { fg: validation.ok ? THEME.success : THEME.warning, text: "Checks" },
    ...checks.map((text) => fieldLine("Status", text, validation.ok ? THEME.success : THEME.warning)),
  ];
}

function validationAlertLines(snapshot: WorkflowViewSnapshot): ProtocolLine[] {
  const validation = validateWorkbenchTuiWorkflowViewSnapshot(snapshot);
  if (validation.ok) return [];
  return [
    { fg: THEME.warning, text: "Renderer warning" },
    ...validation.issues.map((issue) => fieldLine("Issue", issue.message, THEME.warning)),
  ];
}

function renderProtocolDocumentLines(
  document: unknown,
  context: Record<string, string | undefined> = {},
): ProtocolLine[] {
  const rendered = renderWorkflowJsonRenderDocument(protocolTuiRegistry, document, {
    context,
  });
  if (!rendered.ok) {
    return [{ fg: THEME.warning, text: `${rendered.component} · no TUI renderer registered` }];
  }
  return rendered.output;
}

const protocolTuiRegistry = createWorkflowJsonRenderRegistry<
  ProtocolLine[],
  Record<string, string | undefined>
>({
  fallback: renderUnknownComponent,
  renderers: {
    ApprovalCard: renderApprovalCard,
    CommandStatus: renderCommandStatus,
    ImageBatchSummary: renderImageBatchSummary,
    JsonInspector: renderJsonInspector,
  },
});

function renderApprovalCard(input: ProtocolRendererInput): ProtocolLine[] {
  const title = stringProp(input.props, "title") ?? "Approval required";
  const imageCount = numberProp(input.props, "imageCount");
  const question = stringProp(input.props, "question");
  return terminalCard({
    accent: THEME.warning,
    body: [
      { fg: THEME.muted, text: "?  Human input" },
      { fg: THEME.text, text: title },
      chipLine([
        imageCount === undefined ? undefined : `${imageCount} images`,
        approvalModeLabel(stringProp(input.props, "subtitle")),
      ]),
      ...dividerCardLines(THEME.warning),
      ...wrappedCardText(question ?? "Waiting for human input.", THEME.text),
      buttonLine(input.context?.approveLabel ?? "Approve", input.context?.rejectLabel ?? "Reject"),
    ],
    badge: input.context?.statusLabel,
    title: "Human input",
  });
}

function renderCommandStatus(input: ProtocolRendererInput): ProtocolLine[] {
  const error = stringProp(input.props, "errorMessage");
  return terminalCard({
    accent: error ? THEME.error : THEME.success,
    body: error
      ? [
        { fg: THEME.error, text: "!  Response failed" },
        ...wrappedCardText(error, THEME.error),
      ]
      : [
        { fg: THEME.success, text: "✓  Response recorded" },
        { fg: THEME.text, text: `● ${responseStatusText(input.props) ?? "Accepted"}` },
        { fg: THEME.muted, text: `◌ ${commandDispatchText(input.props) ?? "Saved"}` },
        ...dividerCardLines(THEME.success),
        { fg: THEME.muted, text: `◷ ${workflowContinuationText(input.props) ?? "Waiting for workflow"}` },
      ],
    badge: input.context?.statusLabel,
    title: "Response",
  });
}

function renderImageBatchSummary(input: ProtocolRendererInput): ProtocolLine[] {
  const imageCount = numberProp(input.props, "imageCount") ?? 0;
  const pendingApproval = input.props.pendingApproval === true;
  return terminalCard({
    accent: THEME.info,
    body: [
      { fg: THEME.info, text: "▥  Image batch summary" },
      { fg: THEME.text, text: `${imageCount} images` },
      { fg: THEME.info, text: "||||||||||||...." },
      ...dividerCardLines(THEME.info),
      {
        fg: pendingApproval ? THEME.warning : THEME.success,
        text: `◷ State: ${pendingApproval ? "Awaiting approval" : "Ready"}`,
      },
    ],
    title: "Image batch summary",
  });
}

function renderJsonInspector(input: ProtocolRendererInput): ProtocolLine[] {
  return [
    fieldLine("Title", stringProp(input.props, "title") ?? "JSON inspector", THEME.muted),
    ...wrappedOptionalFieldLine("Value", JSON.stringify(input.props.value ?? null), THEME.muted),
  ];
}

function renderUnknownComponent(input: ProtocolRendererInput): ProtocolLine[] {
  return [{ fg: THEME.warning, text: `${input.component} · custom JSON Render component` }];
}

function processImagesTuiCommandResult(): WorkflowViewCommandResult {
  const hook = processImagesViewSnapshot.pendingHooks[0];
  if (!hook) {
    throw new Error("Process Images TUI fixture requires a pending hook.");
  }
  const command = createWorkflowHookResumeCommand(hook, {
    source: {
      adapterId: "workbench.terminal",
      surface: "tui",
    },
    value: {
      approved: true,
    },
  });
  if (!command) {
    throw new Error("Process Images TUI fixture hook cannot create a resume command.");
  }
  return createWorkflowViewCommandResult({
    command,
    dispatch: { mode: "linked-run-metadata" },
  });
}

function commandDispatchText(props: JsonObject) {
  const mode = stringProp(props, "dispatchMode");
  const status = stringProp(props, "dispatchStatus");
  if (!mode) return undefined;
  const normalizedMode = mode.toLowerCase();
  if (status === "rejected") return "Not recorded";
  if (normalizedMode === "linked-run metadata") return "Saved for this run";
  if (normalizedMode === "watson trace") return "Saved to Watson trace";
  if (normalizedMode === "room") return "Sent to the room";
  if (normalizedMode === "runtime") return "Sent to the workflow";
  return status && status !== "recorded" ? `${mode} · ${status}` : mode;
}

type WorkflowViewCommandType = WorkflowViewCommandResult["command"]["type"];

const COMMAND_TYPE_LABELS: Record<WorkflowViewCommandType, string> = {
  "room.recordDecision": "Record room decision",
  "room.resolveHand": "Resolve hand raise",
  "room.appendMessage": "Add room message",
  "workflow.action.apply": "Apply workflow action",
  "workflow.checkpoint.rerun": "Rerun checkpoint",
  "workflow.hook.resume": "Resume workflow hook",
  "workflow.question.answer": "Answer workflow question",
  "workflow.session.pause": "Pause workflow session",
};

function commandTypeLabel(type: string): string {
  return COMMAND_TYPE_LABELS[type as WorkflowViewCommandType] ?? type;
}

function responseStatusText(props: JsonObject) {
  const status = stringProp(props, "status");
  if (status === "accepted") return "Accepted";
  if (status === "rejected") return "Rejected";
  return status;
}

function approvalModeLabel(value: string | undefined) {
  if (!value) return "Human review";
  return value.toLowerCase().includes("approval") ? "Manual approval" : workflowStepLabel(value);
}

function workflowStepLabel(value: string | undefined) {
  if (!value) return undefined;
  return value
    .split("·")
    .map((part) => titleCaseIdentifier(part.trim()))
    .filter(Boolean)
    .join(" ");
}

function titleCaseIdentifier(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function workflowContinuationText(props: JsonObject) {
  const label = stringProp(props, "runtimeLabel");
  if (label === "runtime resumed") return "Workflow resumed";
  if (label === "runtime not resumed") return "Waiting for workflow to continue";
  if (label === "runtime not dispatched") return "Waiting for dispatch";
  return label;
}

function fieldLine(
  label: string,
  value: number | string,
  fg: string,
): ProtocolLine {
  return {
    fg,
    text: `  ${label}: ${compactLineValue(String(value))}`,
  };
}

function wrappedOptionalFieldLine(
  label: string,
  value: number | string | undefined,
  fg: string,
): ProtocolLine[] {
  if (value === undefined || value === "") return [];
  const [first, ...rest] = wrapLineValue(String(value));
  return [
    { fg, text: `  ${label}: ${first}` },
    ...rest.map((text) => ({ fg, text: `    ${text}` })),
  ];
}

function compactLineValue(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

function wrapLineValue(value: string): string[] {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= 38) return [text];
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > 38) {
    const breakAt = remaining.lastIndexOf(" ", 38);
    const end = breakAt > 20 ? breakAt : 38;
    lines.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) lines.push(remaining);
  return lines;
}

function stringProp(props: JsonObject, key: string) {
  const value = props[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberProp(props: JsonObject, key: string) {
  const value = props[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
