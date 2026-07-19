import {
  createElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  createWorkflowHookResumeCommand,
  workflowViewCommandResultKey,
  workflowViewCommandResultToJsonRenderDocument,
  workflowResultToJsonRenderDocument,
} from "@dromio/workflow-room-protocol";
import type {
  WorkflowJsonRenderDocument,
  WorkflowHookRequest,
  WorkflowResultPresentation,
  WorkflowViewCommand,
  WorkflowViewCommandResult,
  WorkflowViewSnapshot,
} from "@dromio/workflow-room-protocol";
import type {
  WorkflowRenderModel,
} from "../client/workflow-render/index.js";
import {
  WorkflowCanvas,
} from "./workflow-canvas.js";
import {
  approvalCardDocumentForHook,
  WorkflowJsonRenderDocumentPreview,
  WorkflowJsonRenderFrame,
} from "./workflow-json-render-preview.js";

type JsonRenderResult = Extract<WorkflowResultPresentation, { kind: "json-render" }>;

export type WorkflowViewSnapshotPreviewProps = {
  className?: string;
  renderJsonRender?(result: JsonRenderResult): ReactNode;
  snapshot: WorkflowViewSnapshot;
  style?: CSSProperties;
  onCommand?(command: WorkflowViewCommand): void | Promise<void>;
};

export function WorkflowViewSnapshotPreview(props: WorkflowViewSnapshotPreviewProps): ReactElement {
  return createElement(
    "section",
    {
      className: props.className,
      "data-dromio-workflow-view-snapshot": props.snapshot.render.id,
      style: {
        display: "grid",
        gap: 16,
        ...props.style,
      } satisfies CSSProperties,
    },
    createElement(WorkflowCanvas, {
      model: props.snapshot.render as WorkflowRenderModel,
      selectedNodeId: props.snapshot.selectedNodeId ?? props.snapshot.render.selectedNodeId,
    }),
    props.snapshot.pendingHooks.length
      ? createElement(WorkflowHooksPreview, {
        onCommand: props.onCommand,
        runId: props.snapshot.run?.runId,
        hooks: props.snapshot.pendingHooks,
      })
      : undefined,
    props.snapshot.commandResults?.length
      ? createElement(WorkflowCommandStatusPreview, {
        commandResults: props.snapshot.commandResults,
      })
      : undefined,
    props.snapshot.result
      ? createElement(WorkflowResultPreview, {
        renderJsonRender: props.renderJsonRender,
        result: props.snapshot.result,
      })
      : undefined,
    props.snapshot.validation?.issues.length
      ? createElement(WorkflowValidationPreview, {
        issues: props.snapshot.validation.issues,
      })
      : undefined,
  );
}

function WorkflowCommandStatusPreview(props: {
  commandResults: WorkflowViewCommandResult[];
}) {
  return createElement(
    "section",
    {
      "aria-label": "Workflow command status",
      "data-dromio-workflow-command-results": props.commandResults.length,
      style: panelStyle,
    },
    createElement("h3", { style: headingStyle }, "Command status"),
    props.commandResults.map((result) => {
      const document = workflowViewCommandResultToJsonRenderDocument(result);
      return createElement(
        WorkflowJsonRenderFrame,
        {
          badge: "command",
          document,
          key: workflowViewCommandResultKey(result),
          title: result.command.type,
        },
        createElement(WorkflowJsonRenderDocumentPreview, {
          document,
        }),
      );
    }),
  );
}

function WorkflowHooksPreview(props: {
  hooks: WorkflowHookRequest[];
  runId?: string;
  onCommand?(command: WorkflowViewCommand): void | Promise<void>;
}) {
  return createElement(
    "section",
    {
      "aria-label": "Pending workflow human input",
      "data-dromio-workflow-hooks": props.hooks.length,
      style: panelStyle,
    },
    createElement("h3", { style: headingStyle }, "Human input"),
    props.hooks.map((hook) =>
      createElement(
        "article",
        {
          "data-dromio-workflow-hook": hook.id,
          key: hook.id,
          style: hookStyle,
        },
        hook.render?.kind === "approval"
          ? createElement(
            WorkflowJsonRenderFrame,
            {
              badge: "approval",
              document: approvalCardDocumentForHook(hook),
              title: hook.title ?? "Human input",
            },
            createElement(WorkflowJsonRenderDocumentPreview, {
              document: approvalCardDocumentForHook(hook),
            }),
            createElement(ApprovalActions, {
              hook,
              onCommand: props.onCommand,
              runId: hook.runId ?? props.runId,
            }),
          )
          : hook.render?.kind === "json-render"
            ? createElement(WorkflowJsonRenderFrame, {
              badge: "json-render",
              document: hook.render.document as WorkflowJsonRenderDocument,
              title: hook.title ?? "Human input",
            })
          : createElement("small", { style: mutedStyle }, hook.render?.kind ?? hook.kind ?? "form"),
      )
    ),
  );
}

function ApprovalActions(props: {
  hook: WorkflowHookRequest;
  runId?: string;
  onCommand?(command: WorkflowViewCommand): void | Promise<void>;
}) {
  const dispatch = (approved: boolean) => {
    const command = createWorkflowHookResumeCommand(props.hook, {
      runId: props.runId,
      source: {
        adapterId: "dromio-sdk-react-preview",
        surface: "react",
      },
      value: { approved },
    });
    if (!command) return;
    void props.onCommand?.(command);
  };
  return createElement(
    "div",
    { style: actionsStyle },
    createElement(
      "button",
      {
        disabled: !props.runId,
        onClick: () => dispatch(true),
        style: primaryButtonStyle,
        type: "button",
      },
      props.hook.render?.kind === "approval" ? props.hook.render.approveLabel ?? "Approve" : "Approve",
    ),
    createElement(
      "button",
      {
        disabled: !props.runId,
        onClick: () => dispatch(false),
        style: secondaryButtonStyle,
        type: "button",
      },
      props.hook.render?.kind === "approval" ? props.hook.render.rejectLabel ?? "Reject" : "Reject",
    ),
  );
}

function WorkflowResultPreview(props: {
  renderJsonRender?: WorkflowViewSnapshotPreviewProps["renderJsonRender"];
  result: WorkflowResultPresentation;
}) {
  const title = props.result.title ?? "Workflow result";
  const jsonRenderDocument = workflowResultToJsonRenderDocument(props.result);
  if (jsonRenderDocument) {
    const rendered = props.result.kind === "json-render"
      ? props.renderJsonRender?.(props.result)
      : undefined;
    return createElement(
      WorkflowJsonRenderFrame,
      {
        badge: "json-render",
        "data-dromio-workflow-result": props.result.kind,
        document: jsonRenderDocument,
        title,
      },
      rendered,
    );
  }
  return createElement(
    "section",
    {
      "aria-label": title,
      "data-dromio-workflow-result": props.result.kind,
      style: panelStyle,
    },
    createElement("h3", { style: headingStyle }, title),
    createElement(
      "div",
      { style: markdownStyle },
      props.result.kind === "markdown" ? props.result.value : "Workflow result is not renderable.",
    ),
  );
}

function WorkflowValidationPreview(props: {
  issues: NonNullable<WorkflowViewSnapshot["validation"]>["issues"];
}) {
  return createElement(
    "section",
    {
      "aria-label": "Workflow render validation",
      "data-dromio-workflow-validation": props.issues.length,
      style: panelStyle,
    },
    createElement("h3", { style: headingStyle }, "Validation"),
    createElement(
      "ul",
      { style: listStyle },
      props.issues.map((issue) =>
        createElement("li", { key: `${issue.code}:${issue.path ?? ""}` }, `${issue.severity}: ${issue.message}`)
      ),
    ),
  );
}

const panelStyle: CSSProperties = {
  background: "#ffffff",
  border: "1px solid #d8dee8",
  borderRadius: 8,
  color: "#172033",
  padding: 16,
};

const headingStyle: CSSProperties = {
  fontSize: 14,
  lineHeight: "18px",
  margin: "0 0 10px",
};

const hookStyle: CSSProperties = {
  display: "grid",
  gap: 8,
};

const actionsStyle: CSSProperties = {
  display: "flex",
  gap: 8,
};

const primaryButtonStyle: CSSProperties = {
  background: "#0f766e",
  border: "1px solid #0f766e",
  borderRadius: 6,
  color: "#ffffff",
  padding: "6px 10px",
};

const secondaryButtonStyle: CSSProperties = {
  background: "#ffffff",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  color: "#334155",
  padding: "6px 10px",
};

const preStyle: CSSProperties = {
  background: "#f8fafc",
  borderRadius: 6,
  fontSize: 12,
  margin: 0,
  overflow: "auto",
  padding: 10,
};

const mutedStyle: CSSProperties = {
  color: "#64748b",
};

const markdownStyle: CSSProperties = {
  color: "#334155",
  whiteSpace: "pre-wrap",
};

const listStyle: CSSProperties = {
  margin: 0,
  paddingLeft: 18,
};
