import { workflowGuiStyles } from "../workflow-app-gui/page.js";
import styles from "./styles.css.txt" with { type: "text" };
import type { WorkflowSvgAppPayload } from "../workflow-app-svg.js";

export const workflowSvgAppStyles = `${workflowGuiStyles}\n${styles}`;

export function renderWorkflowSvgAppPage(payload: WorkflowSvgAppPayload) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(payload.title)} · Workflow field</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body class="dark">
  <div id="workflow-svg-root" class="gui-stage" data-workflow-svg="${escapeHtml(payload.appId)}"></div>
  <script id="workflow-svg-data" type="application/json">${safeJson(payload)}</script>
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
