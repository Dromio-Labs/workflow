import {
  ChatShell,
  defineChatShellExtension,
} from "@dromio/chat-shell-ui";
import {ChatShellManifestSchema} from "@dromio/chat-shell-ui/chat-shell-contracts/v1";
import "@dromio/chat-shell-ui/styles.css";

import {createMinimalChatShellManifest} from "../shared/minimalManifest";

const baseManifest = createMinimalChatShellManifest();
const manifest = ChatShellManifestSchema.parse({
  ...baseManifest,
  appearance: {
    ...baseManifest.appearance,
    density: "compact",
  },
  registries: {
    ...baseManifest.registries,
    chrome: {
      ...baseManifest.registries.chrome,
      sidePanel: {
        ...baseManifest.registries.chrome.sidePanel,
        initialSurfaceId: "audit",
        surfaces: [
          ...baseManifest.registries.chrome.sidePanel.surfaces,
          {
            content: {
              body: "Frontend-owned audit panel wrapped around default manifest content.",
              title: "Audit",
            },
            icon: "custom:audit",
            label: "Audit",
            rendererId: "side-panel.audit",
            surfaceId: "audit",
            surfaceKind: "audit",
          },
        ],
      },
    },
    layoutSlots: baseManifest.registries.layoutSlots.map((slot) => slot.region === "windowChrome"
      ? {
          ...slot,
          rendererId: "shell.partner.window-chrome",
        }
      : slot),
  },
});

const shellExtension = defineChatShellExtension({
  icons: {
    "custom:audit": ({className, name}) => (
      <span aria-hidden="true" className={className} data-icon-name={name}>$</span>
    ),
  },
  renderers: {
    shell: {
      "shell.partner.window-chrome": ({helpers, layout}) => (
        <div data-compact={layout.compact}>
          {helpers.renderDefault()}
        </div>
      ),
    },
    sidePanel: {
      "side-panel.audit": ({helpers, surface}) => (
        <section aria-label={surface.label}>
          {helpers.renderDefaultContent()}
        </section>
      ),
    },
  },
});

export function App() {
  return <ChatShell extensions={shellExtension} manifest={manifest} />;
}
