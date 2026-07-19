import type {ChatShellEvent} from "@dromio/chat-shell-ui";
import {
  chatShellSchemaVersion,
  ChatShellManifestSchema,
  type ChatShellManifest,
} from "@dromio/chat-shell-ui/chat-shell-contracts/v1";

type BackendThread = {
  readonly id: string;
  readonly prompt: string;
  readonly title: string;
};

export type BackendSnapshot = {
  readonly activeThreadId: string;
  readonly threads: readonly BackendThread[];
};

export function createInitialByoBackendSnapshot(): BackendSnapshot {
  return {
    activeThreadId: "thread-byo-1",
    threads: [
      {
        id: "thread-byo-1",
        prompt: "Show a backend-owned ChatShell control-plane manifest.",
        title: "Backend-owned manifest",
      },
    ],
  };
}

export function createManifestFromBackendSnapshot(snapshot: BackendSnapshot): ChatShellManifest {
  const activeThread = snapshot.threads.find((thread) => thread.id === snapshot.activeThreadId) ?? snapshot.threads[0];

  if (!activeThread) {
    throw new Error("BYO backend snapshot must contain at least one thread.");
  }

  return ChatShellManifestSchema.parse({
    appearance: {
      colorMode: "dark",
      density: "comfortable",
    },
    controlPlane: createControlPlane(snapshot, activeThread.id),
    layout: {
      sidebar: {collapsedWidth: 56, defaultWidth: 260, maxWidth: 360, minWidth: 200},
      sidePanel: {defaultOpen: true, defaultWidth: 320, maxWidth: 520, minWidth: 260},
      statusPanel: {defaultOpen: true},
    },
    registries: createRegistries(activeThread),
    runtime: {conversation: {state: "complete"}},
    schemaVersion: chatShellSchemaVersion,
  });
}

export function handleBackendControlPlaneEvent(
  snapshot: BackendSnapshot,
  event: ChatShellEvent,
): {snapshot: BackendSnapshot} {
  if (event.type === "task.select") {
    return {
      snapshot: {
        ...snapshot,
        activeThreadId: event.taskId,
      },
    };
  }

  if (event.type === "composer.submit") {
    const prompt = event.payload.prompt.trim() || "Submitted an empty prompt";
    const nextThread = {
      id: `thread-byo-${snapshot.threads.length + 1}`,
      prompt,
      title: toThreadTitle(prompt),
    };

    return {
      snapshot: {
        activeThreadId: nextThread.id,
        threads: [nextThread, ...snapshot.threads],
      },
    };
  }

  return {snapshot};
}

function createControlPlane(snapshot: BackendSnapshot, activeThreadId: string) {
  return {
    activeThreadId,
    activeWorkspaceId: "workspace-byo",
    conversations: snapshot.threads.map((thread) => ({
      branch: "byo/backend-owned",
      changes: {additions: 1, deletions: 0},
      goal: {
        completed: false,
        subtitle: "plain backend records",
        title: thread.title,
      },
      id: conversationId(thread),
      progress: [
        "Receive ChatShell event",
        "Reduce backend state",
        "Parse manifest replacement",
      ],
      threadId: thread.id,
    })),
    messageParts: snapshot.threads.flatMap((thread) => [
      {
        content: thread.prompt,
        id: userPartId(thread),
        messageId: userMessageId(thread),
        type: "content" as const,
      },
      {
        content: `The host backend accepted the prompt and returned a parsed manifest for "${thread.title}".`,
        id: assistantPartId(thread),
        messageId: assistantMessageId(thread),
        type: "content" as const,
      },
    ]),
    messages: snapshot.threads.flatMap((thread) => [
      {
        conversationId: conversationId(thread),
        id: userMessageId(thread),
        partIds: [userPartId(thread)],
        role: "user" as const,
      },
      {
        conversationId: conversationId(thread),
        durationMs: 180,
        id: assistantMessageId(thread),
        partIds: [assistantPartId(thread)],
        role: "assistant" as const,
        showHeader: true,
      },
    ]),
    threads: snapshot.threads.map((thread) => ({
      active: thread.id === activeThreadId,
      conversationId: conversationId(thread),
      id: thread.id,
      title: thread.title,
      workspaceId: "workspace-byo",
    })),
    toolCalls: [],
    workspaces: [
      {
        id: "workspace-byo",
        name: "BYO backend",
        threadIds: snapshot.threads.map((thread) => thread.id),
      },
    ],
  };
}

function createRegistries(activeThread: BackendThread) {
  return {
    chrome: {
      appPicker: menu("app-picker"),
      branch: "byo/backend-owned",
      branchMenu: menu("branch-menu"),
      moreMenu: menu("more-menu"),
      sidePanel: {
        initialSurfaceId: "backend-state",
        surfaces: [
          {
            content: {
              body: "The host backend owns plain thread records, validates a full ChatShell manifest, and replaces shell state after events.",
              title: "Backend-owned state",
            },
            icon: "target",
            label: "Backend",
            rendererId: "side-panel.default-content",
            surfaceId: "backend-state",
            surfaceKind: "default-content",
          },
          {
            content: {title: "Composer"},
            icon: "message-plus",
            label: "Composer",
            rendererId: "side-panel.composer",
            surfaceId: "composer",
            surfaceKind: "composer",
          },
        ],
        tabMenuSurfaceIds: ["backend-state", "composer"],
      },
      title: "BYO backend example",
      workspace: "BYO backend",
    },
    composer: {
      addMenu: menu("add-menu"),
      approvalMenu: menu("approval-menu"),
      approvalMode: "on-request",
      contextUsage: {ariaLabel: "0% context used"},
      model: "example-model",
      modelMenu: menu("model-menu"),
      placeholder: "Ask the backend",
      promptCommands: {mentionAdd: [], mentionFiles: [], skills: [], slash: []},
      reasoning: "standard",
      reasoningMenu: menu("reasoning-menu"),
      speedMenu: menu("speed-menu"),
    },
    layoutSlots: [
      {id: "slot-window", order: 0, region: "windowChrome", rendererId: "shell.window-chrome"},
      {id: "slot-sidebar", order: 1, region: "sidebar", rendererId: "shell.sidebar"},
      {id: "slot-timeline", order: 2, region: "timeline", rendererId: "shell.timeline"},
      {id: "slot-composer", order: 3, region: "composer", rendererId: "shell.composer"},
      {id: "slot-status", order: 4, region: "statusRail", rendererId: "shell.status-rail"},
      {id: "slot-side-panel", order: 5, region: "sidePanel", rendererId: "shell.side-panel"},
      {id: "slot-settings", order: 6, region: "settings", rendererId: "shell.settings"},
      {id: "slot-overlays", order: 7, region: "overlays", rendererId: "shell.overlays.mac-top"},
    ],
    navActions: [{id: "new", icon: "plus", label: "New"}],
    settings: {
      activeSectionId: "general",
      general: {generalRows: [], permissionRows: [], workModes: []},
      navSections: [{id: "root", items: [{id: "general", icon: "settings", label: "General"}]}],
      searchPlaceholder: "Search settings",
    },
    sidebar: {
      archiveToggle: {id: "archive", icon: "archive", label: "Archive"},
      contextMenus: {task: menu("task-menu"), workspace: menu("workspace-menu")},
      tasksTitle: "Backend threads",
    },
    status: {
      git: {additions: 1, branch: "byo/backend-owned", deletions: 0},
      goal: {
        status: "active",
        subtitle: "backend-owned manifest replacement",
        title: activeThread.title,
      },
      progress: [
        {id: "receive-event", label: "Receive event", status: "done"},
        {id: "reduce-state", label: "Reduce backend state", status: "done"},
        {id: "parse-manifest", label: "Parse manifest", status: "done"},
      ],
      sections: [
        {
          id: "summary",
          rows: [
            {id: "thread", kind: "goal", label: "Active thread", value: activeThread.title},
            {id: "branch", kind: "branch", label: "Branch", value: "byo/backend-owned"},
          ],
          title: "Backend summary",
        },
      ],
    },
    user: {
      avatar: "BY",
      email: "backend@example.com",
      name: "Backend Owner",
      settingsMenu: menu("settings-menu"),
    },
  };
}

function menu(id: string) {
  return {id, sections: []};
}

function conversationId(thread: BackendThread) {
  return `conversation-${thread.id}`;
}

function userMessageId(thread: BackendThread) {
  return `message-user-${thread.id}`;
}

function assistantMessageId(thread: BackendThread) {
  return `message-assistant-${thread.id}`;
}

function userPartId(thread: BackendThread) {
  return `part-user-${thread.id}`;
}

function assistantPartId(thread: BackendThread) {
  return `part-assistant-${thread.id}`;
}

function toThreadTitle(prompt: string) {
  return prompt.length > 58 ? `${prompt.slice(0, 55)}...` : prompt;
}
