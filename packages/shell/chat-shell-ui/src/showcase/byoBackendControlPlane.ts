import type {ChatShellEvent} from "../chat-shell";
import {
  chatShellSchemaVersion,
  ChatShellManifestSchema,
  type ChatShellAppearance,
  type ChatShellControlPlane,
  type ChatShellLayoutConfig,
  type ChatShellManifest,
  type ChatShellRegistries,
  type ChatShellRuntime,
} from "../chat-shell-contracts";

export type BackendSnapshot = {
  appearance?: ChatShellAppearance;
  controlPlane: ChatShellControlPlane;
  layout: ChatShellLayoutConfig;
  registries: ChatShellRegistries;
  runtime: ChatShellRuntime;
};

export type BackendEventResult = {
  readonly eventLogEntry: string;
  readonly manifest: ChatShellManifest;
  readonly snapshot: BackendSnapshot;
};

const backendAppearance = {
  colorMode: "dark",
  density: "comfortable",
  radius: {
    frame: "1rem",
    frameSm: "20px",
    mode: "default",
    scale: 1,
  },
  shell: {
    viewportHeight: "640px",
    viewportHeightLg: "640px",
    viewportHeightMd: "620px",
    viewportHeightSm: "620px",
    viewportMaxWidth: "100%",
  },
  tokens: {},
  typography: {
    scale: "default",
  },
} satisfies ChatShellAppearance;

const backendLayout = {
  sidebar: {
    collapsedWidth: 8,
    defaultWidth: 300,
    maxWidth: 380,
    minWidth: 220,
  },
  sidePanel: {
    defaultOpen: true,
    defaultWidth: 540,
    maxWidth: 680,
    minWidth: 260,
  },
  statusPanel: {
    defaultOpen: true,
  },
} satisfies ChatShellLayoutConfig;

const emptyMenu = (id: string) => ({
  id,
  sections: [],
});

const backendRegistries = {
  chrome: {
    appPicker: {
      id: "byo-app-picker",
      sections: [
        {
          id: "apps",
          items: [
            {checked: true, id: "host-app", label: "Host app", value: "Host app"},
          ],
        },
      ],
    },
    branch: "backend/byo-control-plane",
    branchMenu: emptyMenu("byo-branch-menu"),
    moreMenu: emptyMenu("byo-more-menu"),
    sidePanel: {
      inactiveTab: {
        icon: "file",
        label: "Open file",
      },
      initialSurfaceId: "backend-state",
      surfaces: [
        {
          content: {
            body: "Backend-owned plain objects are parsed into the manifest rendered here.",
            items: [
              {label: "Owner", value: "host backend"},
              {label: "Validation", value: "ChatShellManifestSchema.parse"},
            ],
            title: "BYO backend",
          },
          icon: "target",
          label: "Backend",
          rendererId: "side-panel.default-content",
          surfaceId: "backend-state",
          surfaceKind: "default-content",
        },
        {
          content: {
            body: "A built-in composer side panel remains available through manifest registration.",
            title: "Side chat",
          },
          icon: "message-plus",
          label: "Side chat",
          rendererId: "side-panel.composer",
          surfaceId: "side-chat",
          surfaceKind: "composer",
        },
      ],
      tabMenuSurfaceIds: ["backend-state", "side-chat"],
    },
    title: "BYO backend control plane",
    workspace: "backend-demo",
  },
  composer: {
    addMenu: emptyMenu("byo-add-menu"),
    approvalMenu: {
      id: "byo-approval-menu",
      sections: [
        {
          id: "approval",
          items: [
            {checked: true, icon: "shield", id: "ask", label: "Ask before changes", value: "Ask before changes"},
          ],
        },
      ],
    },
    approvalMode: "Ask before changes",
    contextUsage: {
      ariaLabel: "Context usage 1,024 of 200,000",
    },
    model: "GPT-5.5",
    modelMenu: {
      id: "byo-model-menu",
      sections: [
        {
          id: "models",
          items: [
            {checked: true, id: "gpt-55", label: "GPT-5.5", value: "GPT-5.5"},
          ],
        },
      ],
    },
    placeholder: "Submit a prompt to replace the backend-owned manifest",
    promptCommands: {
      mentionAdd: [],
      mentionFiles: [{disabled: true, id: "search-files", label: "Type to search files"}],
      skills: [],
      slash: [],
    },
    reasoning: "Medium",
    reasoningMenu: emptyMenu("byo-reasoning-menu"),
    speedMenu: emptyMenu("byo-speed-menu"),
  },
  layoutSlots: [
    {id: "sidebar-default", order: 10, region: "sidebar", rendererId: "shell.sidebar", visible: true},
    {id: "window-chrome-default", order: 20, region: "windowChrome", rendererId: "shell.window-chrome", visible: true},
    {id: "timeline-default", order: 30, region: "timeline", rendererId: "shell.timeline", visible: true},
    {id: "composer-default", order: 40, region: "composer", rendererId: "shell.composer", visible: true},
    {id: "status-rail-default", order: 50, region: "statusRail", rendererId: "shell.status-rail", visible: true},
    {id: "side-panel-default", order: 60, region: "sidePanel", rendererId: "shell.side-panel", visible: true},
    {id: "settings-default", order: 70, region: "settings", rendererId: "shell.settings", visible: true},
    {id: "mac-overlays-default", order: 80, region: "overlays", rendererId: "shell.overlays.mac-top", visible: true},
  ],
  navActions: [
    {icon: "message-plus", id: "new-chat", label: "New Task"},
    {icon: "folder-plus", id: "open-workspace", label: "Open Workspace"},
  ],
  settings: {
    activeSectionId: "general",
    general: {
      generalRows: [
        {
          control: "segmented",
          id: "density",
          label: "Density",
          options: ["Comfortable", "Compact"],
          value: "Comfortable",
        },
      ],
      permissionRows: [
        {
          control: "toggle",
          enabled: true,
          id: "default-permissions",
          label: "Default permissions",
        },
      ],
      workModes: [
        {
          checked: true,
          description: "Backend-owned control-plane state",
          icon: "terminal",
          id: "backend",
          label: "Backend adapter",
        },
      ],
    },
    navSections: [
      {
        id: "personal",
        items: [
          {icon: "settings", id: "general", label: "General"},
        ],
        title: "Personal",
      },
    ],
    searchPlaceholder: "Search settings...",
  },
  sidebar: {
    archiveToggle: {icon: "archive", id: "toggle-archived", label: "Toggle archived tasks"},
    contextMenus: {
      task: emptyMenu("byo-task-menu"),
      workspace: emptyMenu("byo-workspace-menu"),
    },
    tasksTitle: "Tasks",
  },
  status: {
    git: {
      additions: 0,
      branch: "backend/byo-control-plane",
      deletions: 0,
    },
    goal: {
      status: "Ready",
      subtitle: "plain backend objects",
      title: "Build a manifest without mock backend imports",
    },
    progress: [
      {id: "progress-event", label: "Receive ChatShell event", status: "done"},
      {id: "progress-reduce", label: "Reduce backend snapshot", status: "active"},
      {id: "progress-parse", label: "Parse replacement manifest", status: "pending"},
    ],
    sections: [
      {
        id: "goal",
        rows: [
          {
            icon: "target",
            id: "goal-current",
            kind: "goal",
            label: "Build a manifest without mock backend imports",
            metadata: ["BYO", "Zod parsed"],
          },
        ],
        status: "Ready",
        title: "Goal",
      },
      {
        id: "progress",
        rows: [
          {icon: "check", id: "progress-event", kind: "progress", label: "Receive ChatShell event", status: "done"},
          {icon: "clock", id: "progress-reduce", kind: "progress", label: "Reduce backend snapshot", status: "active"},
          {icon: "shield", id: "progress-parse", kind: "progress", label: "Parse replacement manifest", status: "pending"},
        ],
        title: "Progress",
      },
    ],
  },
  user: {
    avatar: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='18' fill='%231f2937'/%3E%3Ctext x='32' y='39' text-anchor='middle' font-family='Arial,sans-serif' font-size='20' font-weight='700' fill='white'%3EBA%3C/text%3E%3C/svg%3E",
    email: "backend@example.com",
    name: "Backend Adapter",
    settingsMenu: emptyMenu("byo-user-settings"),
  },
} satisfies ChatShellRegistries;

const backendControlPlane = {
  activeThreadId: "thread-byo-initial",
  activeWorkspaceId: "workspace-byo",
  conversations: [
    {
      branch: "backend/byo-control-plane",
      changes: {
        additions: 0,
        deletions: 0,
      },
      goal: {
        completed: false,
        subtitle: "plain objects -> schema parse -> shell render",
        title: "Prove BYO control-plane ownership",
      },
      id: "conversation-byo-initial",
      progress: [
        "Define backend-owned workspace, thread, and message records",
        "Parse a complete ChatShell manifest",
        "Replace the manifest after composer submit",
      ],
      threadId: "thread-byo-initial",
    },
  ],
  messageParts: [
    {
      content: "Show a backend-owned ChatShell control-plane manifest.",
      id: "part-byo-initial-user",
      messageId: "message-byo-initial-user",
      type: "content",
    },
    {
      content: "This initial transcript is owned by the BYO backend demo, not by the mock backend package.",
      id: "part-byo-initial-content",
      messageId: "message-byo-initial-assistant",
      type: "content",
    },
  ],
  messages: [
    {
      conversationId: "conversation-byo-initial",
      id: "message-byo-initial-user",
      partIds: ["part-byo-initial-user"],
      role: "user",
    },
    {
      conversationId: "conversation-byo-initial",
      durationMs: 180,
      id: "message-byo-initial-assistant",
      partIds: ["part-byo-initial-content"],
      role: "assistant",
      showHeader: true,
    },
  ],
  threads: [
    {
      active: true,
      conversationId: "conversation-byo-initial",
      id: "thread-byo-initial",
      timeLabel: "now",
      title: "Prove BYO control-plane ownership",
      workspaceId: "workspace-byo",
    },
  ],
  toolCalls: [],
  workspaces: [
    {
      id: "workspace-byo",
      name: "backend-demo",
      threadIds: ["thread-byo-initial"],
    },
  ],
} satisfies ChatShellControlPlane;

export function createManifestFromBackendSnapshot(snapshot: BackendSnapshot): ChatShellManifest {
  return ChatShellManifestSchema.parse({
    appearance: snapshot.appearance,
    controlPlane: snapshot.controlPlane,
    layout: snapshot.layout,
    registries: snapshot.registries,
    runtime: snapshot.runtime,
    schemaVersion: chatShellSchemaVersion,
  });
}

export function createInitialByoBackendSnapshot(): BackendSnapshot {
  return {
    appearance: structuredClone(backendAppearance),
    controlPlane: structuredClone(backendControlPlane),
    layout: structuredClone(backendLayout),
    registries: structuredClone(backendRegistries),
    runtime: {
      conversation: {
        state: "complete",
      },
    },
  };
}

export function handleBackendControlPlaneEvent(snapshot: BackendSnapshot, event: ChatShellEvent): BackendEventResult {
  const nextSnapshot = structuredClone(snapshot);
  const eventLogEntry = describeChatShellEvent(event);

  switch (event.type) {
    case "composer.submit": {
      appendComposerTurn(nextSnapshot, event.payload.prompt);
      break;
    }

    case "task.select": {
      nextSnapshot.controlPlane.activeThreadId = event.taskId;
      nextSnapshot.controlPlane.threads = nextSnapshot.controlPlane.threads.map((thread) => ({
        ...thread,
        active: thread.id === event.taskId,
      }));
      nextSnapshot.runtime = {
        conversation: {
          state: "complete",
        },
      };
      break;
    }

    case "settings.change": {
      nextSnapshot.appearance = {
        ...nextSnapshot.appearance,
        density: event.settingId.includes("compact") || event.value === "Compact" ? "compact" : nextSnapshot.appearance?.density,
      };
      break;
    }
  }

  return {
    eventLogEntry,
    manifest: createManifestFromBackendSnapshot(nextSnapshot),
    snapshot: nextSnapshot,
  };
}

function appendComposerTurn(snapshot: BackendSnapshot, prompt: string) {
  const trimmedPrompt = prompt.trim() || "Submitted an empty prompt";
  const controlPlane = snapshot.controlPlane;
  const sequence = controlPlane.messages.length + 1;
  const threadId = `thread-byo-${sequence}`;
  const conversationId = `conversation-byo-${sequence}`;
  const userMessageId = `message-byo-user-${sequence}`;
  const assistantMessageId = `message-byo-assistant-${sequence}`;
  const userPartId = `part-byo-user-${sequence}`;
  const thoughtPartId = `part-byo-thought-${sequence}`;
  const contentPartId = `part-byo-content-${sequence}`;
  const title = toThreadTitle(trimmedPrompt);
  const activeWorkspace = controlPlane.workspaces.find((workspace) => workspace.id === controlPlane.activeWorkspaceId)
    ?? controlPlane.workspaces[0];

  if (!activeWorkspace) {
    throw new Error("BYO backend snapshot must contain at least one workspace.");
  }

  controlPlane.activeWorkspaceId = activeWorkspace.id;
  controlPlane.activeThreadId = threadId;
  controlPlane.workspaces = controlPlane.workspaces.map((workspace) => workspace.id === activeWorkspace.id
    ? {
        ...workspace,
        threadIds: [threadId, ...workspace.threadIds],
      }
    : workspace);
  controlPlane.threads = [
    {
      active: true,
      conversationId,
      id: threadId,
      timeLabel: "now",
      title,
      workspaceId: activeWorkspace.id,
    },
    ...controlPlane.threads.map((thread) => ({...thread, active: false})),
  ];
  controlPlane.conversations = [
    {
      branch: "byo/control-plane",
      changes: {
        additions: 1,
        deletions: 0,
      },
      goal: {
        completed: false,
        subtitle: "validated manifest replacement",
        title,
      },
      id: conversationId,
      progress: [
        "Receive ChatShell event in the host app",
        "Apply backend control-plane state transition",
        "Validate and replace the full manifest snapshot",
      ],
      threadId,
    },
    ...controlPlane.conversations,
  ];
  controlPlane.messages = [
    {
      conversationId,
      id: userMessageId,
      partIds: [userPartId],
      role: "user",
    },
    {
      conversationId,
      durationMs: 420,
      id: assistantMessageId,
      partIds: [thoughtPartId, contentPartId],
      role: "assistant",
      showHeader: true,
    },
    ...controlPlane.messages,
  ];
  controlPlane.messageParts = [
    {
      content: trimmedPrompt,
      id: userPartId,
      messageId: userMessageId,
      type: "content",
    },
    {
      content: "The host backend accepted composer.submit and created a new control-plane snapshot.",
      id: thoughtPartId,
      messageId: assistantMessageId,
      type: "thought",
    },
    {
      content: `Parsed a fresh manifest for "${title}". The shell did not mutate conversation data locally; it rendered the backend-owned replacement snapshot.`,
      id: contentPartId,
      messageId: assistantMessageId,
      type: "content",
    },
    ...controlPlane.messageParts,
  ];
  snapshot.runtime = {
    conversation: {
      state: "complete",
    },
  };
}

function describeChatShellEvent(event: ChatShellEvent) {
  switch (event.type) {
    case "composer.submit":
      return `composer.submit "${event.payload.prompt}"`;
    case "task.select":
      return `task.select ${event.taskId}`;
    case "sidePanel.select":
      return `sidePanel.select ${event.surfaceId}`;
    case "status.toggle":
      return `status.toggle ${String(event.open)}`;
    case "sidebar.toggle":
      return `sidebar.toggle ${String(event.collapsed)}`;
    case "settings.change":
      return `settings.change ${event.settingId}`;
    default:
      return event.type;
  }
}

function toThreadTitle(prompt: string) {
  return prompt.length > 58 ? `${prompt.slice(0, 55)}...` : prompt;
}
