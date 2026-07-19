/// <reference path="./assets.d.ts" />

import activityScript from "./activity.js.txt" with { type: "text" };
import chatShellStyles from "@dromio/chat-shell-ui/styles.css" with { type: "text" };
import canvasEdgesScript from "./canvas-edges.js.txt" with { type: "text" };
import clientScript from "./client.js.txt" with { type: "text" };
import controlsScript from "./controls.js.txt" with { type: "text" };
import jsonScript from "./json.js.txt" with { type: "text" };
import runtimeScript from "./runtime.js.txt" with { type: "text" };
import styles from "./styles.css.txt" with { type: "text" };
import type { WorkflowGuiPayload } from "../workflow-app-gui.js";

export const workflowGuiActivityScript = activityScript;
export const workflowGuiCanvasEdgesScript = canvasEdgesScript;
export const workflowGuiClientScript = clientScript;
export const workflowGuiControlsScript = controlsScript;
export const workflowGuiJsonScript = jsonScript;
export const workflowGuiRuntimeScript = runtimeScript;
export const workflowGuiStyles = `${chatShellStyles}\n${styles}`;

export function renderWorkflowGuiPage(payload: WorkflowGuiPayload): string {
  const title = escapeHtml(payload.title);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Workflow canvas</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body class="dark">
  <div id="workflow-gui-root" class="gui-stage" data-workflow-gui="${escapeHtml(payload.appId)}"></div>
  <script id="workflow-gui-data" type="application/json">${safeJson(payload)}</script>
  <script type="module" src="/shell.js"></script>
</body>
</html>`;
}

function safeJson(value: unknown) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
