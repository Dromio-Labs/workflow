import {
  chatShellSchemaVersion,
  ChatShellManifestSchema,
  type ChatShellManifest,
  type ChatShellRuntime,
} from "../contracts/chatShellManifest";
import shellRegistryJson from "./mock-backend/chatShellRegistry.json";
import controlPlaneJson from "./mock-backend/controlPlane.json";

const shellRegistry = shellRegistryJson;

const baseManifestInput = {
  appearance: {
    colorMode: "dark",
    density: "comfortable",
    radius: {
      frame: "1rem",
      frameSm: "20px",
      mode: "default",
      scale: 1,
    },
    shell: {
      viewportHeight: "520px",
      viewportHeightLg: "48rem",
      viewportHeightMd: "36rem",
      viewportHeightSm: "620px",
      viewportMaxWidth: "80rem",
    },
    tokens: {},
    typography: {
      scale: "default",
    },
  },
  controlPlane: controlPlaneJson,
  layout: {
    sidebar: {
      collapsedWidth: 8,
      defaultWidth: 300,
      maxWidth: 380,
      minWidth: 220,
    },
    sidePanel: {
      defaultOpen: false,
      defaultWidth: 540,
      maxWidth: 680,
      minWidth: 260,
    },
    statusPanel: {
      defaultOpen: true,
    },
  },
  registries: {
    chrome: shellRegistry.window,
    composer: shellRegistry.composer,
    layoutSlots: shellRegistry.layoutSlots,
    navActions: shellRegistry.navActions,
    settings: shellRegistry.settings,
    sidebar: shellRegistry.sidebar,
    status: shellRegistry.status,
    user: shellRegistry.user,
  },
  runtime: {
    conversation: {
      state: "streaming",
    },
  },
  schemaVersion: chatShellSchemaVersion,
};

function createMockManifest(runtime: ChatShellRuntime): ChatShellManifest {
  return ChatShellManifestSchema.parse({
    ...baseManifestInput,
    runtime,
  });
}

export const mockChatShellManifest = createMockManifest({
  conversation: {
    state: "streaming",
  },
});

export const mockChatShellManifests = {
  complete: createMockManifest({
    conversation: {
      state: "complete",
    },
  }),
  default: mockChatShellManifest,
  empty: createMockManifest({
    conversation: {
      state: "empty",
    },
  }),
  error: createMockManifest({
    conversation: {
      error: {
        detail: "The local preview command exited before returning a browser-ready URL.",
        title: "Run interrupted",
      },
      state: "error",
    },
  }),
  streaming: mockChatShellManifest,
} satisfies Record<string, ChatShellManifest>;

export type MockChatShellManifestName = keyof typeof mockChatShellManifests;
