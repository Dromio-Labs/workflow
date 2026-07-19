import {
  chatShellSchemaVersion,
  ChatShellManifestSchema,
  type ChatShellManifest,
} from "@dromio/chat-shell-ui/chat-shell-contracts/v1";

const menu = (id: string) => ({id, sections: []});

export function createMinimalChatShellManifest(
  overrides: Partial<ChatShellManifest> = {},
): ChatShellManifest {
  return ChatShellManifestSchema.parse({
    appearance: {
      colorMode: "dark",
      density: "comfortable",
    },
    schemaVersion: chatShellSchemaVersion,
    layout: {
      sidebar: {collapsedWidth: 56, defaultWidth: 260, maxWidth: 360, minWidth: 200},
      sidePanel: {defaultOpen: true, defaultWidth: 320, maxWidth: 520, minWidth: 260},
      statusPanel: {defaultOpen: true},
    },
    registries: {
      chrome: {
        appPicker: menu("app-picker"),
        branch: "main",
        branchMenu: menu("branch-menu"),
        moreMenu: menu("more-menu"),
        sidePanel: {
          initialSurfaceId: "composer",
          surfaces: [
            {
              content: {title: "Composer"},
              icon: "message-plus",
              label: "Composer",
              rendererId: "side-panel.composer",
              surfaceId: "composer",
              surfaceKind: "composer",
            },
          ],
        },
        title: "ChatShell Example",
        workspace: "Workspace",
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
        tasksTitle: "Tasks",
      },
      status: {
        git: {additions: 0, branch: "main", deletions: 0},
        goal: {status: "active", subtitle: "Consumer sample", title: "Package smoke"},
        progress: [{id: "package", label: "Package", status: "active"}],
        sections: [
          {
            id: "summary",
            rows: [{id: "branch", kind: "branch", label: "Branch", value: "main"}],
            title: "Summary",
          },
        ],
      },
      user: {
        avatar: "EX",
        email: "example@example.com",
        name: "Example User",
        settingsMenu: menu("settings-menu"),
      },
    },
    controlPlane: {
      activeThreadId: "thread-1",
      activeWorkspaceId: "workspace-1",
      conversations: [
        {
          branch: "main",
          changes: {additions: 0, deletions: 0},
          goal: {completed: false, subtitle: "Consumer sample", title: "Package smoke"},
          id: "conversation-1",
          progress: [],
          threadId: "thread-1",
        },
      ],
      messageParts: [
        {
          content: "Open a package smoke workspace",
          id: "part-user-1",
          messageId: "message-user-1",
          type: "content",
        },
      ],
      messages: [
        {
          conversationId: "conversation-1",
          id: "message-user-1",
          partIds: ["part-user-1"],
          role: "user",
        },
      ],
      threads: [
        {
          active: true,
          conversationId: "conversation-1",
          id: "thread-1",
          title: "Example",
          workspaceId: "workspace-1",
        },
      ],
      toolCalls: [],
      workspaces: [{id: "workspace-1", name: "Workspace", threadIds: ["thread-1"]}],
    },
    runtime: {conversation: {state: "empty"}},
    ...overrides,
  });
}
