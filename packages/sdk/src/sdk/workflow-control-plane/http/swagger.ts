export function swaggerResponse(spec: unknown): Response {
  return new Response(`<!doctype html>
<html>
  <head>
    <title>Dromio Workflow Control Plane</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
    <style>
      :root {
        color-scheme: dark;
        --intent-bg: #09090b;
        --intent-panel: #111113;
        --intent-panel-soft: #18181b;
        --intent-border: #2a2a2f;
        --intent-text: #f4f4f5;
        --intent-muted: #a1a1aa;
        --intent-accent: #38bdf8;
        --intent-success: #34d399;
      }

      html,
      body,
      .swagger-ui,
      .swagger-ui .info,
      .swagger-ui .scheme-container,
      .swagger-ui section.models {
        background: var(--intent-bg);
        color: var(--intent-text);
      }

      body {
        margin: 0;
        min-height: 100vh;
      }

      .swagger-ui {
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .swagger-ui .topbar {
        display: none;
      }

      .swagger-ui .wrapper {
        max-width: 1180px;
      }

      .swagger-ui .info .title,
      .swagger-ui .info p,
      .swagger-ui .opblock-tag,
      .swagger-ui table thead tr td,
      .swagger-ui table thead tr th,
      .swagger-ui .parameter__name,
      .swagger-ui .parameter__type,
      .swagger-ui .response-col_status,
      .swagger-ui .response-col_description,
      .swagger-ui .tab li,
      .swagger-ui section.models h4,
      .swagger-ui .model-title,
      .swagger-ui section.models .model-title__text,
      .swagger-ui .model,
      .swagger-ui .prop-type,
      .swagger-ui .prop-format {
        color: var(--intent-text);
      }

      .swagger-ui .info .base-url,
      .swagger-ui .markdown p,
      .swagger-ui .model .property,
      .swagger-ui .parameter__in,
      .swagger-ui .response-col_links,
      .swagger-ui .servers-title,
      .swagger-ui small,
      .swagger-ui label {
        color: var(--intent-muted);
      }

      .swagger-ui .scheme-container,
      .swagger-ui .opblock,
      .swagger-ui section.models,
      .swagger-ui .model-box,
      .swagger-ui .responses-inner,
      .swagger-ui .opblock-body pre,
      .swagger-ui .highlight-code {
        background: var(--intent-panel);
        border-color: var(--intent-border);
        box-shadow: none;
      }

      .swagger-ui .opblock .opblock-summary,
      .swagger-ui .opblock-section-header,
      .swagger-ui .responses-table,
      .swagger-ui table tbody tr td {
        background: var(--intent-panel-soft);
        border-color: var(--intent-border);
      }

      .swagger-ui .opblock .opblock-body,
      .swagger-ui .opblock .parameters-container,
      .swagger-ui .opblock .responses-wrapper,
      .swagger-ui .opblock .responses-inner {
        background: #0c1116 !important;
        color: var(--intent-text) !important;
      }

      .swagger-ui .opblock .opblock-section-header {
        background: #15161a !important;
        border-bottom: 1px solid var(--intent-border) !important;
        box-shadow: none !important;
        color: var(--intent-text) !important;
      }

      .swagger-ui .opblock table,
      .swagger-ui .opblock table tbody,
      .swagger-ui .opblock table tbody tr,
      .swagger-ui .opblock table tbody tr td,
      .swagger-ui .opblock table thead tr,
      .swagger-ui .opblock table thead tr td,
      .swagger-ui .opblock table thead tr th {
        background: var(--intent-panel) !important;
        border-color: var(--intent-border) !important;
        color: var(--intent-text) !important;
      }

      .swagger-ui .opblock .highlight-code,
      .swagger-ui .opblock .microlight,
      .swagger-ui .opblock pre {
        background: #111113 !important;
        border-color: var(--intent-border) !important;
        color: #f8fafc !important;
      }

      .swagger-ui .dialog-ux .backdrop-ux {
        background: rgba(0, 0, 0, 0.72) !important;
      }

      .swagger-ui .dialog-ux .modal-ux,
      .swagger-ui .dialog-ux .modal-ux-content {
        background: var(--intent-panel) !important;
        border-color: var(--intent-border) !important;
        color: var(--intent-text) !important;
      }

      .swagger-ui .dialog-ux .modal-ux-header {
        background: var(--intent-panel-soft) !important;
        border-bottom: 1px solid var(--intent-border) !important;
      }

      .swagger-ui section.models {
        border: 1px solid var(--intent-border);
        border-radius: 8px;
        margin-top: 32px;
      }

      .swagger-ui section.models .model-container {
        background: #0c0c0f !important;
        border: 1px solid transparent;
        border-radius: 6px;
        margin: 10px 20px;
      }

      .swagger-ui input,
      .swagger-ui select,
      .swagger-ui textarea {
        background: #0f172a;
        border: 1px solid var(--intent-border);
        color: var(--intent-text);
      }

      .swagger-ui .btn,
      .swagger-ui .execute-wrapper .btn {
        background: #0f172a;
        border-color: #3f3f46;
        color: var(--intent-text);
        box-shadow: none;
      }

      .swagger-ui .btn.authorize,
      .swagger-ui .btn.execute {
        background: #075985;
        border-color: #0ea5e9;
        color: white;
      }

      .swagger-ui .opblock.opblock-get {
        background: rgba(56, 189, 248, 0.08);
        border-color: rgba(56, 189, 248, 0.45);
      }

      .swagger-ui .opblock.opblock-post {
        background: rgba(52, 211, 153, 0.08);
        border-color: rgba(52, 211, 153, 0.45);
      }

      .swagger-ui a,
      .swagger-ui .link,
      .swagger-ui .model-toggle::after {
        color: var(--intent-accent);
      }

      .swagger-ui svg,
      .swagger-ui .model-toggle::after,
      .swagger-ui .dialog-ux .close-modal svg {
        filter: invert(1) hue-rotate(180deg);
      }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>SwaggerUIBundle({ spec: ${safeScriptJson(spec)}, dom_id: "#swagger-ui" });</script>
  </body>
</html>`, {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
}

function safeScriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
