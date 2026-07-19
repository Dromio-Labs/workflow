import {
  createElement,
  useState,
  type ReactNode,
} from "react";
import { DromioMarkdown } from "@dromio/chat-shell-ui";
import {
  createWorkflowJsonRenderRegistry,
  inspectWorkflowJsonRenderDocument,
  renderWorkflowJsonRenderDocument,
  workflowHookToJsonRenderDocument,
  workflowJsonRenderInspectionPreference,
  type WorkflowHookRequest,
  type WorkflowJsonRenderInspection,
  type WorkflowJsonRenderDocument,
  type WorkflowJsonRenderRendererInput,
  type WorkflowJsonRenderViewMode,
} from "@dromio/workflow-room-protocol";
import {
  badgeStyle,
  commandStatusCardStyle,
  factGridStyle,
  factStyle,
  headingStyle,
  issueListStyle,
  jsonRenderHeaderActionsStyle,
  jsonRenderHeaderStyle,
  markdownBlockStyle,
  mutedStyle,
  panelStyle,
  preStyle,
  renderCardStyle,
  schemaPanelStyle,
  schemaSummaryStyle,
  settingsButtonStyle,
  settingsIconStyle,
  settingsMenuButtonActiveStyle,
  settingsMenuButtonStyle,
  settingsMenuStyle,
  settingsStyle,
  summaryCardStyle,
  summaryMetricStyle,
  warningTextStyle,
} from "./workflow-json-render-preview.styles.js";

export function WorkflowJsonRenderFrame(props: {
  badge?: string;
  children?: ReactNode;
  chrome?: "default" | "content-only";
  document: WorkflowJsonRenderDocument;
  initialMode?: WorkflowJsonRenderViewMode;
  title: string;
  ["data-dromio-workflow-result"]?: string;
}) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [mode, setMode] = useState<WorkflowJsonRenderViewMode>(
    props.initialMode ?? workflowJsonRenderInspectionPreference.defaultMode,
  );
  const inspection = inspectWorkflowJsonRenderDocument(props.document, {
    fallbackTitle: props.title,
  });
  const changeMode = (nextMode: WorkflowJsonRenderViewMode) => {
    setMode(nextMode);
    setIsSettingsOpen(false);
  };
  return createElement(
    "section",
    {
      "aria-label": props.title,
      "data-dromio-workflow-json-render-component": inspection.component,
      "data-dromio-workflow-json-render-frame": "",
      "data-dromio-workflow-json-render-mode": mode,
      ...(props["data-dromio-workflow-result"]
        ? { "data-dromio-workflow-result": props["data-dromio-workflow-result"] }
        : {}),
      style: panelStyle,
    },
    props.chrome === "content-only"
      ? undefined
      : createElement(
        "div",
        { style: jsonRenderHeaderStyle },
        createElement("h3", { style: headingStyle }, props.title),
        createElement(
          "div",
          { style: jsonRenderHeaderActionsStyle },
          createElement("span", { style: badgeStyle }, props.badge ?? "json-render"),
          createElement(WorkflowJsonRenderSettingsMenu, {
            inspection,
            isOpen: isSettingsOpen,
            mode,
            onModeChange: changeMode,
            onToggle: () => setIsSettingsOpen((open) => !open),
          }),
        ),
      ),
    mode === "render"
      ? props.children ?? createElement(WorkflowJsonRenderDocumentPreview, {
        document: inspection.document,
      })
      : undefined,
    mode === "json"
      ? createElement("pre", {
        "data-dromio-workflow-json-render-json": "",
        style: preStyle,
      }, inspection.jsonText)
      : undefined,
    mode === "schema"
      ? createElement(WorkflowJsonRenderSchemaPanel, { inspection })
      : undefined,
  );
}

function WorkflowJsonRenderSettingsMenu(props: {
  inspection: WorkflowJsonRenderInspection;
  isOpen: boolean;
  mode: WorkflowJsonRenderViewMode;
  onModeChange(mode: WorkflowJsonRenderViewMode): void;
  onToggle(): void;
}) {
  const copyJson = () => {
    if (typeof navigator === "undefined") return;
    void navigator.clipboard?.writeText(props.inspection.jsonText);
  };
  return createElement(
    "div",
    {
      "data-dromio-workflow-json-render-settings": "",
      style: settingsStyle,
    },
    createElement(
      "button",
      {
        "aria-expanded": props.isOpen,
        "aria-label": props.inspection.preference.displayLabel,
        onClick: props.onToggle,
        style: settingsButtonStyle,
        type: "button",
      },
      createElement(
        "svg",
        {
          "aria-hidden": true,
          fill: "none",
          height: 14,
          stroke: "currentColor",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          strokeWidth: 1.8,
          style: settingsIconStyle,
          viewBox: "0 0 24 24",
          width: 14,
        },
        createElement("path", {
          d: "M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z",
        }),
        createElement("path", {
          d: "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1Z",
        }),
      ),
    ),
    props.isOpen
      ? createElement(
        "div",
        {
          "aria-label": "JSON Render display options",
          role: "menu",
          style: settingsMenuStyle,
        },
        props.inspection.preference.modes.map((displayMode) =>
          createElement(
            "button",
            {
              "aria-checked": props.mode === displayMode.mode,
              key: displayMode.mode,
              onClick: () => props.onModeChange(displayMode.mode),
              role: "menuitemradio",
              style: {
                ...settingsMenuButtonStyle,
                ...(props.mode === displayMode.mode ? settingsMenuButtonActiveStyle : {}),
              },
              type: "button",
            },
            displayMode.label,
          )
        ),
        createElement(
          "button",
          {
            onClick: copyJson,
            role: "menuitem",
            style: settingsMenuButtonStyle,
            type: "button",
          },
          props.inspection.preference.copyActionLabel,
        ),
      )
      : undefined,
  );
}

function WorkflowJsonRenderSchemaPanel(props: {
  inspection: WorkflowJsonRenderInspection;
}) {
  const { inspection } = props;
  return createElement(
    "div",
    {
      "data-dromio-workflow-json-render-schema": "",
      style: schemaPanelStyle,
    },
    createElement(
      "div",
      { style: schemaSummaryStyle },
      createElement(RenderFact, {
        label: "Catalog",
        value: inspection.schema.catalog,
      }),
      createElement(RenderFact, {
        label: "Component",
        value: inspection.schema.component,
      }),
      createElement(RenderFact, {
        label: "Validation",
        value: inspection.validation.ok ? "valid" : "needs attention",
      }),
    ),
    inspection.validation.issues.length
      ? createElement(
        "ul",
        { style: issueListStyle },
        inspection.validation.issues.map((issue) =>
          createElement("li", { key: `${issue.code}:${issue.path}` }, issue.message)
        ),
      )
      : undefined,
    createElement("pre", { style: preStyle }, JSON.stringify(inspection.schema, null, 2)),
  );
}

export function WorkflowJsonRenderDocumentPreview(props: {
  document: WorkflowJsonRenderDocument;
}) {
  const rendered = renderWorkflowJsonRenderDocument(
    sdkWorkflowJsonRenderRegistry,
    props.document,
  );
  return rendered.ok
    ? rendered.output
    : renderUnregisteredJsonRenderComponent({
      component: rendered.component,
      document: rendered.inspection.document,
      inspection: rendered.inspection,
      props: {},
    });
}

export function approvalCardDocumentForHook(hook: WorkflowHookRequest): WorkflowJsonRenderDocument {
  return workflowHookToJsonRenderDocument(hook);
}

function RenderFact(props: {
  label: string;
  value: ReactNode;
}) {
  return createElement(
    "div",
    { style: factStyle },
    createElement("span", { style: mutedStyle }, props.label),
    createElement("strong", null, props.value),
  );
}

const sdkWorkflowJsonRenderRegistry = createWorkflowJsonRenderRegistry<ReactNode>({
  fallback: renderUnregisteredJsonRenderComponent,
  renderers: {
    ApprovalCard: renderApprovalCard,
    CommandStatus: renderCommandStatus,
    ImageBatchSummary: renderImageBatchSummary,
    JsonInspector: renderJsonInspector,
    MarkdownBlock: renderMarkdownBlock,
  },
});

function renderApprovalCard({ props }: WorkflowJsonRenderRendererInput): ReactNode {
  return createElement(
    "div",
    {
      "data-dromio-workflow-json-render-card": "ApprovalCard",
      style: renderCardStyle,
    },
    createElement("strong", null, stringValue(props.title) ?? "Approval required"),
    stringValue(props.subtitle)
      ? createElement("small", { style: mutedStyle }, stringValue(props.subtitle))
      : undefined,
    createElement(
      "div",
      { style: factGridStyle },
      numberValue(props.imageCount) !== undefined
        ? createElement(RenderFact, {
          label: "Image count",
          value: numberValue(props.imageCount),
        })
        : undefined,
      stringValue(props.question)
        ? createElement(RenderFact, {
          label: "Question",
          value: stringValue(props.question),
        })
        : undefined,
    ),
  );
}

function renderImageBatchSummary({ props }: WorkflowJsonRenderRendererInput): ReactNode {
  const imageCount = numberValue(props.imageCount) ?? 0;
  const pendingApproval = props.pendingApproval === true;
  return createElement(
    "div",
    {
      "data-dromio-workflow-json-render-card": "ImageBatchSummary",
      style: summaryCardStyle,
    },
    createElement(
      "div",
      { style: summaryMetricStyle },
      createElement("strong", null, String(imageCount)),
      createElement("span", null, "images"),
    ),
    createElement("span", { style: mutedStyle }, stringValue(props.workflowId) ?? "process-images"),
    createElement("small", { style: pendingApproval ? warningTextStyle : mutedStyle }, pendingApproval ? "Awaiting approval" : "Ready"),
  );
}

function renderCommandStatus({ props }: WorkflowJsonRenderRendererInput): ReactNode {
  return createElement(
    "div",
    {
      "data-dromio-workflow-json-render-card": "CommandStatus",
      style: commandStatusCardStyle,
    },
    createElement("strong", null, stringValue(props.commandType) ?? "workflow command"),
    createElement(
      "div",
      { style: factGridStyle },
      createElement(RenderFact, {
        label: "Status",
        value: stringValue(props.status) ?? "recorded",
      }),
      stringValue(props.dispatchMode)
        ? createElement(RenderFact, {
          label: "Dispatch",
          value: stringValue(props.dispatchMode),
        })
        : undefined,
      stringValue(props.runtimeLabel)
        ? createElement(RenderFact, {
          label: "Runtime",
          value: stringValue(props.runtimeLabel),
        })
        : undefined,
      stringValue(props.errorMessage)
        ? createElement(RenderFact, {
          label: "Error",
          value: stringValue(props.errorMessage),
        })
        : undefined,
    ),
  );
}

function renderJsonInspector({ props }: WorkflowJsonRenderRendererInput): ReactNode {
  return createElement(
    "div",
    {
      "data-dromio-workflow-json-render-card": "JsonInspector",
      style: renderCardStyle,
    },
    stringValue(props.title)
      ? createElement("strong", null, stringValue(props.title))
      : undefined,
    createElement("pre", { style: preStyle }, JSON.stringify(props.value ?? null, null, 2)),
  );
}

function renderMarkdownBlock({ props }: WorkflowJsonRenderRendererInput): ReactNode {
  return createElement(
    "div",
    {
      "data-dromio-workflow-json-render-card": "MarkdownBlock",
      style: markdownBlockStyle,
    },
    createElement(DromioMarkdown, {
      content: stringValue(props.value) ?? "",
    }),
  );
}

function renderUnregisteredJsonRenderComponent({
  component,
}: WorkflowJsonRenderRendererInput): ReactNode {
  return createElement(
    "div",
    { style: renderCardStyle },
    createElement("strong", null, component),
    createElement("small", { style: mutedStyle }, "No default SDK renderer is registered for this component."),
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
