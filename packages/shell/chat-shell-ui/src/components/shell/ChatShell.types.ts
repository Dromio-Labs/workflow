import type {CSSProperties, ReactNode} from "react";
import type {ConversationState} from "@chatshell/response-protocol";

import type {
  ChatShellRuntime,
  ChatShellManifest,
  ChatShellMenuItem,
  ChatShellSidePanelSurface,
  ChatShellSidePanelRendererId,
  ChatShellSlot,
  ChatShellSlotRendererId,
  IconName,
} from "../../contracts/chatShellManifest";
import type {
  ShellPresentationPatch,
  ShellPresentationPolicy,
  ShellPresentationPreferences,
} from "../../contracts/chatShellPresentation";
import type {ChatShellDevToolsOptions} from "../presentation/ChatShellPresentationDevTools";

export type ChatShellComposerAttachment = {
  readonly file: File;
  readonly id: string;
  readonly name: string;
  readonly src: string;
};

export type ChatShellComposerSubmitPayload = {
  readonly attachments: readonly ChatShellComposerAttachment[];
  readonly prompt: string;
};

export type ChatShellEvent =
  | {
      readonly decision: "approve" | "reject";
      readonly requestId: string;
      readonly type: "approval.respond";
    }
  | {
      readonly actionId: string;
      readonly surface?: string;
      readonly type: "action.trigger";
    }
  | {
      readonly payload: ChatShellComposerSubmitPayload;
      readonly type: "composer.submit";
    }
  | {
      readonly item: ChatShellMenuItem;
      readonly menuId: string;
      readonly type: "menu.select";
    }
  | {
      readonly collapsed: boolean;
      readonly type: "sidebar.toggle";
    }
  | {
      readonly open: boolean;
      readonly type: "settings.close" | "settings.open" | "status.toggle";
    }
  | {
      readonly panelId: "sidebar" | "sidePanel" | string;
      readonly type: "panel.resize";
      readonly width: number;
    }
  | {
      readonly settingId: string;
      readonly type: "settings.change";
      readonly value: boolean | string;
    }
  | {
      readonly surfaceId: string;
      readonly type: "sidePanel.close" | "sidePanel.open";
    }
  | {
      readonly surfaceId: string;
      readonly type: "sidePanel.resize";
      readonly width: number;
    }
  | {
      readonly surfaceId: string;
      readonly type: "sidePanel.select";
    }
  | {
      readonly statusId: string;
      readonly type: "status.select";
    }
  | {
      readonly taskId: string;
      readonly type: "task.select";
    }
  | {
      readonly fullscreen: boolean;
      readonly type: "window.fullscreen.toggle";
    };

export type ChatShellEventHandler = (event: ChatShellEvent) => void | Promise<void>;

export type ChatShellSidePanelRendererProps = {
  readonly activeSurface: ChatShellManifest["registries"]["chrome"]["sidePanel"]["surfaces"][number];
  readonly closeSidePanel: () => void;
  readonly composer: ChatShellManifest["registries"]["composer"];
  readonly emitEvent: ChatShellEventHandler;
  readonly helpers: {
    readonly renderComposer: () => ReactNode;
    readonly renderDefaultContent: () => ReactNode;
  };
  readonly layout: {
    readonly compact: boolean;
    readonly open: boolean;
    readonly resizing: boolean;
    readonly width: number;
  };
  readonly onComposerSubmit: (payload: ChatShellComposerSubmitPayload) => void | Promise<void>;
  readonly onMenuSelect: (menuId: string, item: ChatShellMenuItem) => void;
  readonly openSidePanel: () => void;
  readonly selectSurface: (surfaceId: string) => void;
  readonly surface: ChatShellManifest["registries"]["chrome"]["sidePanel"]["surfaces"][number];
  readonly surfaces: readonly ChatShellManifest["registries"]["chrome"]["sidePanel"]["surfaces"][number][];
};

export type ChatShellSidePanelRenderer = (props: ChatShellSidePanelRendererProps) => ReactNode;

export type ChatShellSidePanelRendererRegistry = Partial<Record<ChatShellSidePanelRendererId, ChatShellSidePanelRenderer>>;

export type ChatShellSlotRendererProps = {
  readonly actions: ChatShellSlotActions;
  readonly emitEvent: ChatShellEventHandler;
  readonly helpers: {
    readonly renderDefault: () => ReactNode;
  };
  readonly layout: {
    readonly compact: boolean;
    readonly fullscreen: boolean;
    readonly settingsOpen: boolean;
    readonly sidebarCollapsed: boolean;
    readonly sidebarWidth: number;
    readonly sidePanelOpen: boolean;
    readonly sidePanelResizing: boolean;
    readonly sidePanelWidth: number;
    readonly statusOpen: boolean;
  };
  readonly manifest: ChatShellManifest;
  readonly registry: ChatShellManifest["registries"];
  readonly slot: ChatShellSlot;
};

export type ChatShellSlotActions = {
  readonly closeSettings: () => void;
  readonly closeSidePanel: () => void;
  readonly openSettings: () => void;
  readonly openSidePanel: () => void;
  readonly selectMenu: (menuId: string, item: ChatShellMenuItem) => void;
  readonly selectSidePanelSurface: (surfaceId: string) => void;
  readonly selectTask: (taskId: string) => void;
  readonly submitComposer: (payload: ChatShellComposerSubmitPayload) => void | Promise<void>;
  readonly toggleFullscreen: () => void;
  readonly toggleSidebar: () => void;
  readonly toggleSidePanel: () => void;
  readonly toggleStatus: () => void;
  readonly triggerAction: (actionId: string, surface?: string) => void;
};

export type ChatShellSlotRenderer = (props: ChatShellSlotRendererProps) => ReactNode;

export type ChatShellSlotRendererRegistry = Partial<Record<ChatShellSlotRendererId, ChatShellSlotRenderer>>;

export type ChatShellIconRendererProps = {
  readonly "aria-hidden"?: true;
  readonly className: string;
  readonly name: IconName;
  readonly style?: CSSProperties;
};

export type ChatShellIconRenderer = (props: ChatShellIconRendererProps) => ReactNode;

export type ChatShellIconRendererRegistry = Partial<Record<ChatShellIconRendererProps["name"], ChatShellIconRenderer>>;

export type ChatShellRendererRegistry = {
  readonly icons?: ChatShellIconRendererRegistry;
  readonly shell?: ChatShellSlotRendererRegistry;
  readonly sidePanel?: ChatShellSidePanelRendererRegistry;
};

export type ChatShellConversationStateOverride = {
  readonly isStreaming: boolean;
  /** Pending user decisions projected by a backend without exposing tool input. */
  readonly pendingApprovals?: readonly {
    readonly requestId: string;
    readonly summary: string;
  }[];
  /** Content-state override (simulated/demo backends supply partial messages). */
  readonly state?: ConversationState;
  /** Runtime-state override (real backends drive empty/streaming/error/complete). */
  readonly runtimeState?: ChatShellRuntime["conversation"]["state"];
};

export type ChatShellSidePanelExtensionSurface = ChatShellSidePanelSurface & {
  readonly renderer?: ChatShellSidePanelRenderer;
};

export type ChatShellSlotExtensionRegistration = Omit<ChatShellSlot, "id" | "order"> & {
  readonly id?: string;
  readonly order?: number;
  readonly renderer?: ChatShellSlotRenderer;
};

export type ChatShellExtension = {
  readonly id?: string;
  readonly icons?: ChatShellIconRendererRegistry;
  readonly renderers?: ChatShellRendererRegistry;
  readonly shell?: {
    readonly slots?: readonly ChatShellSlotExtensionRegistration[];
  };
  readonly sidePanel?: {
    readonly initialSurfaceId?: string;
    readonly surfaces?: readonly ChatShellSidePanelExtensionSurface[];
    readonly tabMenuSurfaceIds?: readonly string[];
  };
};

export type ChatShellProps = {
  readonly conversationStateOverride?: ChatShellConversationStateOverride;
  readonly devtools?: ChatShellDevToolsOptions;
  readonly extensions?: ChatShellExtension | readonly ChatShellExtension[];
  /**
   * Seeds the windowed/fullscreen toggle's initial state. Ignored in
   * embedded frames, which always fill their container. Defaults to
   * windowed (false) so a standalone product demo starts as a floating
   * window unless the host asks to start maximized.
   */
  readonly initialFullscreen?: boolean;
  readonly manifest: ChatShellManifest;
  readonly onEvent?: ChatShellEventHandler;
  readonly onFullscreenChange?: (fullscreen: boolean) => void;
  readonly presentation?: ShellPresentationPatch;
  readonly presentationPolicy?: ShellPresentationPolicy;
  readonly presentationPreferences?: ShellPresentationPreferences;
  readonly renderers?: ChatShellRendererRegistry;
};
