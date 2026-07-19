import {
  ChatShell,
  defineChatShellExtension,
} from "@dromio/chat-shell-ui";
import "@dromio/chat-shell-ui/styles.css";

import {createMinimalChatShellManifest} from "../shared/minimalManifest";

const rendererIds = {
  browser: "side-panel.browser",
  composer: "shell.partner.composer",
  review: "side-panel.review",
  terminal: "side-panel.terminal",
} as const;

const surfaceIds = {
  browser: "custom-browser",
  review: "custom-review",
  terminal: "custom-terminal",
} as const;

const manifest = createMinimalChatShellManifest();

const extension = defineChatShellExtension({
  icons: {
    "custom:browser": ({className}) => (
      <span aria-hidden="true" className={className} style={{fontSize: 14, lineHeight: 1}}>B</span>
    ),
    "custom:review": ({className}) => (
      <span aria-hidden="true" className={className} style={{fontSize: 14, lineHeight: 1}}>R</span>
    ),
    "custom:terminal": ({className}) => (
      <span aria-hidden="true" className={className} style={{fontSize: 14, lineHeight: 1}}>$</span>
    ),
  },
  shell: {
    slots: [
      {
        order: -1,
        region: "composer",
        renderer: ({actions, helpers, layout}) => (
          <div
            data-custom-composer
            style={{
              borderTop: layout.compact ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(255,255,255,0.14)",
              paddingTop: 8,
            }}
          >
            {helpers.renderDefault()}
            <button
              type="button"
              onClick={() => actions.triggerAction("composer.template", "composer")}
              style={{margin: "0 24px 16px"}}
            >
              Insert template
            </button>
          </div>
        ),
        rendererId: rendererIds.composer,
      },
    ],
  },
  sidePanel: {
    initialSurfaceId: surfaceIds.terminal,
    surfaces: [
      {
        content: {
          body: "npm run check:contract",
          items: [
            {label: "cwd", value: "~/workspace/product"},
            {label: "status", value: "Ready"},
          ],
          title: "Terminal",
        },
        icon: "custom:terminal",
        label: "Terminal",
        renderer: ({layout, surface}) => (
          <section aria-label={surface.label} style={{height: "100%", overflowY: "auto", padding: 24}}>
            <strong>{surface.content.title}</strong>
            <pre style={{whiteSpace: "pre-wrap"}}>{surface.content.body}</pre>
            <small>{layout.width}px wide</small>
          </section>
        ),
        rendererId: rendererIds.terminal,
        surfaceId: surfaceIds.terminal,
        surfaceKind: "terminal",
      },
      {
        content: {
          body: "http://127.0.0.1:8210",
          items: [
            {label: "viewport", value: "1440 x 960"},
            {label: "route", value: "/settings/billing"},
          ],
          title: "Browser",
        },
        icon: "custom:browser",
        label: "Browser",
        renderer: ({closeSidePanel, helpers, surface}) => (
          <section aria-label={surface.label} style={{height: "100%", overflowY: "auto", padding: 24}}>
            <header style={{alignItems: "center", display: "flex", justifyContent: "space-between"}}>
              <strong>{surface.content.title}</strong>
              <button type="button" onClick={closeSidePanel}>Close</button>
            </header>
            <p>{surface.content.body}</p>
            {helpers.renderDefaultContent()}
          </section>
        ),
        rendererId: rendererIds.browser,
        surfaceId: surfaceIds.browser,
        surfaceKind: "browser",
      },
      {
        content: {
          body: "Buyer-defined review UI rendered outside shell internals.",
          items: [
            {label: "checks", value: "3 pending"},
            {label: "owner", value: "Design systems"},
          ],
          title: "Review",
        },
        icon: "custom:review",
        label: "Review",
        renderer: ({helpers, selectSurface, surface}) => (
          <section aria-label={surface.label} style={{height: "100%", overflowY: "auto", padding: 24}}>
            <strong>{surface.content.title}</strong>
            <p>{surface.content.body}</p>
            <button type="button" onClick={() => selectSurface(surfaceIds.terminal)}>Open terminal</button>
            {helpers.renderDefaultContent()}
          </section>
        ),
        rendererId: rendererIds.review,
        surfaceId: surfaceIds.review,
        surfaceKind: "review",
      },
    ],
  },
});

export function App() {
  return <ChatShell extensions={extension} manifest={manifest} />;
}
