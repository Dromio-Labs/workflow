import {
  ChatShell,
  defineChatShellRenderers,
  type ChatShellEvent,
} from "./chat-shell";
import {ChatShellManifestSchema} from "./chat-shell-contracts";
import {mockChatShellManifest} from "./chat-shell-mock-backend";

let latestEvent: ChatShellEvent | null = null;

const manifest = ChatShellManifestSchema.parse({
  ...mockChatShellManifest,
  registries: {
    ...mockChatShellManifest.registries,
    chrome: {
      ...mockChatShellManifest.registries.chrome,
      sidePanel: {
        ...mockChatShellManifest.registries.chrome.sidePanel,
        initialSurfaceId: "contract-terminal",
        surfaces: [
          ...mockChatShellManifest.registries.chrome.sidePanel.surfaces,
          {
            content: {
              body: "Custom renderer smoke surface.",
              title: "Terminal",
            },
            icon: "terminal",
            label: "Terminal",
            rendererId: "side-panel.terminal",
            surfaceId: "contract-terminal",
            surfaceKind: "terminal",
          },
        ],
        tabMenuSurfaceIds: [
          ...(mockChatShellManifest.registries.chrome.sidePanel.tabMenuSurfaceIds ?? []),
          "contract-terminal",
        ],
      },
    },
    layoutSlots: mockChatShellManifest.registries.layoutSlots.map((slot) => slot.region === "windowChrome"
      ? {
          ...slot,
          rendererId: "shell.contract.window-chrome" as const,
        }
      : slot),
  },
});

const renderers = defineChatShellRenderers({
  icons: {
    terminal: ({className, name}) => (
      <span aria-hidden="true" className={className} data-contract-icon={name} />
    ),
  },
  shell: {
    "shell.contract.window-chrome": (props) => (
      <div data-contract-slot={props.slot.region}>
        {props.helpers.renderDefault()}
      </div>
    ),
  },
  sidePanel: {
    "side-panel.terminal": (props) => (
      <div className="h-full overflow-y-auto px-8 pb-6 pt-6">
        {props.helpers.renderDefaultContent()}
      </div>
    ),
  },
});

export const chatShellContractElement = (
  <ChatShell
    manifest={manifest}
    onEvent={(event) => {
      latestEvent = event;
      void latestEvent;
    }}
    renderers={renderers}
  />
);
