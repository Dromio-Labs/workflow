import {
  ChatShell,
  defineChatShellExtension,
} from "@dromio/chat-shell-ui";
import "@dromio/chat-shell-ui/styles.css";

import {createMinimalChatShellManifest} from "../shared/minimalManifest";

const manifest = createMinimalChatShellManifest();

const reviewExtension = defineChatShellExtension({
  sidePanel: {
    initialSurfaceId: "review",
    surfaces: [
      {
        content: {
          body: "Custom content rendered by the host app.",
          title: "Review notes",
        },
        icon: "file-diff",
        label: "Review",
        renderer: ({closeSidePanel, helpers, layout, surface}) => (
          <section aria-label={surface.label} style={{padding: 16}}>
            <header style={{alignItems: "center", display: "flex", justifyContent: "space-between"}}>
              <strong>{surface.content.title}</strong>
              <button type="button" onClick={closeSidePanel}>Close</button>
            </header>
            <p>{surface.content.body}</p>
            <small>Panel width: {layout.width}px</small>
            {helpers.renderDefaultContent()}
          </section>
        ),
        rendererId: "side-panel.review-notes",
        surfaceId: "review",
        surfaceKind: "review-notes",
      },
    ],
  },
});

export function App() {
  return <ChatShell extensions={reviewExtension} manifest={manifest} />;
}
