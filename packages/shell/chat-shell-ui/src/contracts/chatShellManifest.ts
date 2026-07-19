import {z} from "zod";
import {validateManifestPresentation} from "./chatShellManifestPresentationValidation";

import {ChatShellCapabilitiesSchema} from "./chatShellPresentation";

export const chatShellSchemaVersion = "chat-shell.v1" as const;

export const BuiltInIconNameSchema = z.enum([
  "archive",
  "branch",
  "check",
  "chevron-down",
  "clock",
  "commit",
  "copy",
  "external-window",
  "file",
  "file-diff",
  "folder",
  "folder-open",
  "folder-plus",
  "fork",
  "globe",
  "list",
  "layout-panel-left",
  "message-plus",
  "mic",
  "more",
  "package",
  "pencil",
  "pin",
  "plan",
  "plus",
  "settings",
  "shield",
  "spark",
  "stop",
  "square-chart",
  "target",
  "terminal",
  "wand",
  "x",
]);

export const CustomIconNameSchema = z.custom<`custom:${string}`>(
  (value) => typeof value === "string" && /^custom:[a-z][a-z0-9-]*(?:[.:/-][a-z0-9]+)*$/.test(value),
  "Custom icon names must start with custom: and use lowercase namespaced identifiers.",
);

export const IconNameSchema = z.union([BuiltInIconNameSchema, CustomIconNameSchema]);

export type BuiltInIconName = z.infer<typeof BuiltInIconNameSchema>;
export type CustomIconName = z.infer<typeof CustomIconNameSchema>;
export type IconName = z.infer<typeof IconNameSchema>;

export type ChatShellMenu = {
  id: string;
  searchPlaceholder?: string;
  sections: ChatShellMenuSection[];
  submenus?: Record<string, ChatShellMenu>;
};

export type ChatShellMenuSection = {
  id: string;
  items: ChatShellMenuItem[];
  title?: string;
};

export type ChatShellMenuItem = {
  checked?: boolean;
  description?: string;
  disabled?: boolean;
  icon?: IconName;
  id: string;
  label: string;
  shortcut?: string;
  submenuId?: string;
  value?: string;
};

export const ChatShellMenuItemSchema: z.ZodType<ChatShellMenuItem> = z.object({
  checked: z.boolean().optional(),
  description: z.string().optional(),
  disabled: z.boolean().optional(),
  icon: IconNameSchema.optional(),
  id: z.string().min(1),
  label: z.string(),
  shortcut: z.string().optional(),
  submenuId: z.string().optional(),
  value: z.string().optional(),
}).strict();

export const ChatShellMenuSectionSchema: z.ZodType<ChatShellMenuSection> = z.object({
  id: z.string().min(1),
  items: z.array(ChatShellMenuItemSchema),
  title: z.string().optional(),
}).strict();

export const ChatShellMenuSchema: z.ZodType<ChatShellMenu> = z.lazy(() => z.object({
  id: z.string().min(1),
  searchPlaceholder: z.string().min(1).optional(),
  sections: z.array(ChatShellMenuSectionSchema),
  submenus: z.record(z.string(), ChatShellMenuSchema).optional(),
}).strict());

export const ChatShellActionSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  icon: IconNameSchema,
  shortcut: z.string().optional(),
}).strict();

export const ChatShellSidePanelContentItemSchema = z.object({
  label: z.string(),
  value: z.string().optional(),
}).strict();

export const ChatShellSidePanelContentSchema = z.object({
  body: z.string().optional(),
  items: z.array(ChatShellSidePanelContentItemSchema).optional(),
  title: z.string(),
}).strict();

export const ChatShellSidePanelSurfaceKindSchema = z.string()
  .min(1)
  .regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/, "Side panel surfaceKind must use lowercase dotted or kebab-case identifiers.");

export const ChatShellSidePanelRendererIdSchema = z.custom<`side-panel.${string}`>(
  (value) => typeof value === "string" && /^side-panel\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(value),
  "Side panel rendererId must start with side-panel. and use lowercase dotted or kebab-case identifiers.",
);

export const ChatShellSidePanelSurfaceSchema = z.object({
  content: ChatShellSidePanelContentSchema,
  icon: IconNameSchema,
  label: z.string(),
  rendererId: ChatShellSidePanelRendererIdSchema,
  shortcut: z.string().optional(),
  surfaceId: z.string().min(1),
  surfaceKind: ChatShellSidePanelSurfaceKindSchema,
}).strict();

export const ChatShellSidePanelSchema = z.object({
  inactiveTab: z.object({
    icon: IconNameSchema,
    label: z.string(),
  }).strict().optional(),
  initialSurfaceId: z.string().min(1),
  surfaces: z.array(ChatShellSidePanelSurfaceSchema).min(1),
  tabMenuSurfaceIds: z.array(z.string()).optional(),
}).strict().superRefine((panel, context) => {
  const surfaceIds = new Set<string>();

  panel.surfaces.forEach((surface, index) => {
    if (surfaceIds.has(surface.surfaceId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Side panel surfaceId "${surface.surfaceId}" must be unique.`,
        path: ["surfaces", index, "surfaceId"],
      });
    }

    surfaceIds.add(surface.surfaceId);
  });

  if (panel.initialSurfaceId && !panel.surfaces.some((surface) => surface.surfaceId === panel.initialSurfaceId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Side panel initialSurfaceId "${panel.initialSurfaceId}" must reference a registered surface.`,
      path: ["initialSurfaceId"],
    });
  }

  const tabMenuSurfaceIds = new Set<string>();

  panel.tabMenuSurfaceIds?.forEach((surfaceId, index) => {
    if (tabMenuSurfaceIds.has(surfaceId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Side panel tabMenuSurfaceIds[${index}] "${surfaceId}" must be unique.`,
        path: ["tabMenuSurfaceIds", index],
      });
    }

    tabMenuSurfaceIds.add(surfaceId);

    if (!panel.surfaces.some((surface) => surface.surfaceId === surfaceId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Side panel tabMenuSurfaceIds[${index}] "${surfaceId}" must reference a registered surface.`,
        path: ["tabMenuSurfaceIds", index],
      });
    }
  });

  panel.surfaces.forEach((surface, index) => {
    const builtInRendererKind =
      surface.rendererId === "side-panel.composer"
        ? "composer"
        : surface.rendererId === "side-panel.default-content"
          ? "default-content"
          : null;

    if (builtInRendererKind && surface.surfaceKind !== builtInRendererKind) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Side panel built-in renderer "${surface.rendererId}" requires surfaceKind "${builtInRendererKind}".`,
        path: ["surfaces", index, "surfaceKind"],
      });
    }
  });
});

export const ChatShellWindowSchema = z.object({
  appPicker: ChatShellMenuSchema.optional(),
  branch: z.string(),
  branchMenu: ChatShellMenuSchema,
  moreMenu: ChatShellMenuSchema,
  sidePanel: ChatShellSidePanelSchema,
  title: z.string(),
  titleGenerating: z.boolean().optional(),
  workspace: z.string(),
}).strict();

export const ChatShellUserSchema = z.object({
  avatar: z.string(),
  email: z.string(),
  name: z.string(),
  settingsMenu: ChatShellMenuSchema,
}).strict();

export const ChatShellSidebarSchema = z.object({
  archiveToggle: ChatShellActionSchema,
  /** When present, the tasks panel shows a client-side filter input. */
  filter: z.object({
    placeholder: z.string().min(1),
  }).strict().optional(),
  contextMenus: z.object({
    task: ChatShellMenuSchema,
    workspace: ChatShellMenuSchema,
  }).strict(),
  tasksTitle: z.string(),
}).strict();

export const ChatShellTaskSchema = z.object({
  ephemeral: z.boolean().optional(),
  id: z.string().min(1),
  timeLabel: z.string().optional(),
  title: z.string(),
  titleGenerating: z.boolean().optional(),
  unread: z.boolean().optional(),
}).strict();

export const ChatShellWorkspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  tasks: z.array(ChatShellTaskSchema),
}).strict();

export const ChatShellTasksSchema = z.object({
  activeTaskId: z.string().min(1),
  pinned: z.array(ChatShellTaskSchema).optional(),
  workspaces: z.array(ChatShellWorkspaceSchema),
}).strict();

export const ChatShellStatusRowSchema = z.object({
  additions: z.number().optional(),
  deletions: z.number().optional(),
  description: z.string().optional(),
  icon: IconNameSchema.optional(),
  id: z.string().min(1),
  kind: z.enum(["action", "branch", "commit", "goal", "progress"]),
  label: z.string(),
  menu: ChatShellMenuSchema.optional(),
  metadata: z.array(z.string()).optional(),
  status: z.enum(["done", "active", "pending", "failed"]).optional(),
  title: z.string().optional(),
  trailingIcon: IconNameSchema.optional(),
  value: z.string().optional(),
}).strict();

export const ChatShellStatusSectionSchema = z.object({
  id: z.string().min(1),
  rows: z.array(ChatShellStatusRowSchema),
  status: z.string().optional(),
  title: z.string(),
}).strict();

export const ChatShellStatusSchema = z.object({
  git: z.object({
    additions: z.number(),
    branch: z.string(),
    deletions: z.number(),
  }).strict(),
  goal: z.object({
    status: z.string(),
    subtitle: z.string(),
    title: z.string(),
  }).strict(),
  progress: z.array(z.object({
    id: z.string().min(1),
    label: z.string(),
    status: z.enum(["done", "active", "pending", "failed"]),
  }).strict()),
  sections: z.array(ChatShellStatusSectionSchema),
}).strict();

export const ChatShellComposerSchema = z.object({
  addMenu: ChatShellMenuSchema,
  approvalMenu: ChatShellMenuSchema,
  approvalMode: z.string(),
  contextUsage: z.object({
    ariaLabel: z.string(),
  }).strict().optional(),
  interruptAction: ChatShellActionSchema.optional(),
  model: z.string(),
  modelMenu: ChatShellMenuSchema,
  placeholder: z.string(),
  promptCommands: z.object({
    mentionAdd: z.array(ChatShellMenuItemSchema),
    mentionFiles: z.array(ChatShellMenuItemSchema),
    skills: z.array(ChatShellMenuItemSchema),
    slash: z.array(ChatShellMenuItemSchema),
  }).strict(),
  reasoning: z.string(),
  reasoningMenu: ChatShellMenuSchema,
  speedMenu: ChatShellMenuSchema,
  /** Copy for the built-in empty-conversation state; hosts brand it here. */
  emptyState: z.object({
    subtitle: z.string().min(1),
    title: z.string().min(1),
  }).strict().optional(),
  /**
   * Prompt chips rendered by the built-in timeline while the conversation is
   * empty; selecting one submits the prompt through the composer.
   */
  suggestions: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    prompt: z.string().min(1),
  }).strict()).optional(),
}).strict();

const ChatShellSettingsBaseControlRowSchema = z.object({
  description: z.string().optional(),
  id: z.string().min(1),
  label: z.string(),
});

const ChatShellSettingsToggleRowSchema = ChatShellSettingsBaseControlRowSchema.extend({
  control: z.literal("toggle"),
  enabled: z.boolean(),
}).strict();

const ChatShellSettingsChoiceRowSchema = ChatShellSettingsBaseControlRowSchema.extend({
  control: z.enum(["select", "segmented"]),
  options: z.array(z.string().min(1)).min(1),
  value: z.string().min(1),
}).strict();

export const ChatShellSettingsControlRowSchema = z.discriminatedUnion("control", [
  ChatShellSettingsToggleRowSchema,
  ChatShellSettingsChoiceRowSchema,
]).superRefine((row, context) => {
  if ((row.control === "select" || row.control === "segmented") && !row.options.includes(row.value)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Settings row value "${row.value}" must be one of its options.`,
      path: ["value"],
    });
  }
});

export const ChatShellSettingsSchema = z.object({
  activeSectionId: z.string().min(1),
  general: z.object({
    generalRows: z.array(ChatShellSettingsControlRowSchema),
    permissionRows: z.array(ChatShellSettingsControlRowSchema),
    workModes: z.array(z.object({
      checked: z.boolean().optional(),
      description: z.string(),
      icon: IconNameSchema,
      id: z.string().min(1),
      label: z.string(),
    }).strict()),
  }).strict(),
  navSections: z.array(z.object({
    id: z.string().min(1),
    items: z.array(z.object({
      external: z.boolean().optional(),
      icon: IconNameSchema,
      id: z.string().min(1),
      label: z.string(),
    }).strict()),
    title: z.string().optional(),
  }).strict()),
  searchPlaceholder: z.string(),
}).strict().superRefine((settings, context) => {
  const navItemIds = new Set(settings.navSections.flatMap((section) => section.items.map((item) => item.id)));

  if (!navItemIds.has(settings.activeSectionId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Settings activeSectionId "${settings.activeSectionId}" must reference a registered nav item.`,
      path: ["activeSectionId"],
    });
  }
});

export const ChatShellSlotRegionSchema = z.enum([
  "composer",
  "overlays",
  "settings",
  "sidebar",
  "sidePanel",
  "statusRail",
  "timeline",
  "windowChrome",
]);

export const ChatShellBuiltInSlotRendererIdSchema = z.enum([
  "shell.composer",
  "shell.overlays.mac-top",
  "shell.settings",
  "shell.sidebar",
  "shell.side-panel",
  "shell.status-rail",
  "shell.timeline",
  "shell.window-chrome",
]);

export const ChatShellSlotRendererIdSchema = z.custom<`shell.${string}`>(
  (value) => typeof value === "string" && /^shell\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(value),
  "Shell slot rendererId must start with shell. and use lowercase dotted or kebab-case identifiers.",
);

export const ChatShellSlotSchema = z.object({
  id: z.string().min(1),
  order: z.number().int(),
  region: ChatShellSlotRegionSchema,
  rendererId: ChatShellSlotRendererIdSchema,
  visible: z.boolean().optional(),
}).strict();

export const ChatShellRegistriesSchema = z.object({
  chrome: ChatShellWindowSchema,
  composer: ChatShellComposerSchema,
  layoutSlots: z.array(ChatShellSlotSchema).min(1),
  navActions: z.array(ChatShellActionSchema),
  settings: ChatShellSettingsSchema,
  sidebar: ChatShellSidebarSchema,
  status: ChatShellStatusSchema,
  user: ChatShellUserSchema,
}).strict().superRefine((registries, context) => {
  const layoutSlotIds = new Set<string>();

  registries.layoutSlots.forEach((slot, index) => {
    if (layoutSlotIds.has(slot.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Shell layout slot id "${slot.id}" must be unique.`,
        path: ["layoutSlots", index, "id"],
      });
    }

    layoutSlotIds.add(slot.id);
  });

  const activeRegions = new Set(registries.layoutSlots.filter((slot) => slot.visible !== false).map((slot) => slot.region));

  const requiredRegions = [
    "composer",
    "settings",
    "sidebar",
    "timeline",
    "windowChrome",
  ] as const satisfies readonly z.infer<typeof ChatShellSlotRegionSchema>[];

  requiredRegions.forEach((region) => {
    if (!activeRegions.has(region)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Shell slot region "${region}" must have a visible registered slot.`,
        path: ["layoutSlots"],
      });
    }
  });

  const expectedRendererByRegion = {
    composer: "shell.composer",
    overlays: "shell.overlays.mac-top",
    settings: "shell.settings",
    sidebar: "shell.sidebar",
    sidePanel: "shell.side-panel",
    statusRail: "shell.status-rail",
    timeline: "shell.timeline",
    windowChrome: "shell.window-chrome",
  } satisfies Record<z.infer<typeof ChatShellSlotRegionSchema>, z.infer<typeof ChatShellBuiltInSlotRendererIdSchema>>;

  const builtInRendererRegions = new Map<string, string>(
    Object.entries(expectedRendererByRegion).map(([region, rendererId]) => [rendererId, region]),
  );

  registries.layoutSlots.forEach((slot, index) => {
    const expectedRendererId = expectedRendererByRegion[slot.region];
    const builtInRegion = builtInRendererRegions.get(slot.rendererId);

    if (builtInRegion && slot.rendererId !== expectedRendererId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Shell built-in renderer "${slot.rendererId}" can only be used for region "${builtInRegion}". Use "${expectedRendererId}" for region "${slot.region}" or register a custom shell.* renderer.`,
        path: ["layoutSlots", index, "rendererId"],
      });
    }
  });
});

export const ChatShellRuntimeSchema = z.object({
  conversation: z.object({
    error: z.object({
      detail: z.string(),
      title: z.string(),
    }).strict().optional(),
    state: z.enum(["complete", "empty", "error", "streaming"]),
  }).strict(),
}).strict();

export const ChatShellAppearanceColorModeSchema = z.enum(["dark", "light", "system"]);
export const ChatShellAppearanceDensitySchema = z.enum(["compact", "comfortable"]);
export const ChatShellAppearanceRadiusModeSchema = z.enum(["default", "sharp", "rounded"]);
export const ChatShellAppearanceTypeScaleSchema = z.enum(["default", "compact", "large"]);

const ChatShellCssValueSchema = z.string().min(1);

export const ChatShellAppearanceTokenOverridesSchema = z.object({
  accent: ChatShellCssValueSchema.optional(),
  accentForeground: ChatShellCssValueSchema.optional(),
  background: ChatShellCssValueSchema.optional(),
  backgroundAlt: ChatShellCssValueSchema.optional(),
  brand: ChatShellCssValueSchema.optional(),
  border: ChatShellCssValueSchema.optional(),
  foreground: ChatShellCssValueSchema.optional(),
  foregroundSubtle: ChatShellCssValueSchema.optional(),
  inputBorderFocused: ChatShellCssValueSchema.optional(),
  surface: ChatShellCssValueSchema.optional(),
  surfaceHover: ChatShellCssValueSchema.optional(),
  windowBg: ChatShellCssValueSchema.optional(),
  windowBorder: ChatShellCssValueSchema.optional(),
  windowShadow: ChatShellCssValueSchema.optional(),
}).strict();

export const ChatShellAppearanceRadiusSchema = z.object({
  frame: ChatShellCssValueSchema.optional(),
  frameSm: ChatShellCssValueSchema.optional(),
  mode: ChatShellAppearanceRadiusModeSchema.optional(),
  scale: z.number().positive().optional(),
}).strict();

export const ChatShellAppearanceTypographySchema = z.object({
  baseFontSize: ChatShellCssValueSchema.optional(),
  fontFamily: ChatShellCssValueSchema.optional(),
  monoFontFamily: ChatShellCssValueSchema.optional(),
  scale: ChatShellAppearanceTypeScaleSchema.optional(),
}).strict();

export const ChatShellAppearanceShellSizingSchema = z.object({
  viewportHeight: ChatShellCssValueSchema.optional(),
  viewportHeightLg: ChatShellCssValueSchema.optional(),
  viewportHeightMd: ChatShellCssValueSchema.optional(),
  viewportHeightSm: ChatShellCssValueSchema.optional(),
  viewportMaxHeight: ChatShellCssValueSchema.optional(),
  viewportMaxWidth: ChatShellCssValueSchema.optional(),
  viewportMinHeight: ChatShellCssValueSchema.optional(),
}).strict();

export const ChatShellAppearanceSchema = z.object({
  colorMode: ChatShellAppearanceColorModeSchema.optional(),
  density: ChatShellAppearanceDensitySchema.optional(),
  radius: ChatShellAppearanceRadiusSchema.optional(),
  shell: ChatShellAppearanceShellSizingSchema.optional(),
  tokens: ChatShellAppearanceTokenOverridesSchema.optional(),
  typography: ChatShellAppearanceTypographySchema.optional(),
}).strict();

export const ChatShellLayoutSchema = z.object({
  /**
   * "windowed" (default) renders the floating desktop-window presentation
   * with the workspace sidebar. "embedded" renders a full-bleed frame that
   * fills the host container with no window mock, workspace sidebar, or mac
   * overlay — for hosts that mount the shell inside their own product UI.
   */
  frame: z.enum(["windowed", "embedded"]).optional(),
  sidePanel: z.object({
    defaultOpen: z.boolean(),
    defaultWidth: z.number(),
    maxWidth: z.number(),
    minWidth: z.number(),
  }).strict(),
  sidebar: z.object({
    collapsedWidth: z.number(),
    defaultWidth: z.number(),
    maxWidth: z.number(),
    minWidth: z.number(),
  }).strict(),
  statusPanel: z.object({
    defaultOpen: z.boolean(),
  }).strict(),
}).strict();

function addDuplicateIdIssues<T extends {id: string}>(
  records: readonly T[],
  recordLabel: string,
  path: Array<number | string>,
  context: z.RefinementCtx,
) {
  const seenIds = new Set<string>();

  records.forEach((record, index) => {
    if (seenIds.has(record.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Control plane ${recordLabel} id "${record.id}" must be unique.`,
        path: [...path, index, "id"],
      });
    }

    seenIds.add(record.id);
  });
}

function addMissingReferenceIssue({
  context,
  path,
  sourceId,
  sourceLabel,
  targetId,
  targetLabel,
}: {
  context: z.RefinementCtx;
  path: Array<number | string>;
  sourceId: string;
  sourceLabel: string;
  targetId: string;
  targetLabel: string;
}) {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: `Control plane ${sourceLabel} "${sourceId}" references missing ${targetLabel} "${targetId}".`,
    path,
  });
}

export const ChatShellControlPlaneSchema = z.object({
  activeThreadId: z.string().min(1),
  activeWorkspaceId: z.string().min(1),
  conversations: z.array(z.object({
    branch: z.string(),
    changes: z.object({
      additions: z.number(),
      deletions: z.number(),
    }).strict(),
    goal: z.object({
      completed: z.boolean(),
      subtitle: z.string(),
      title: z.string(),
    }).strict(),
    id: z.string().min(1),
    progress: z.array(z.string()),
    threadId: z.string().min(1),
  }).strict()),
  messageParts: z.array(z.union([
    z.object({
      content: z.string(),
      id: z.string().min(1),
      messageId: z.string().min(1),
      type: z.enum(["content", "thought"]),
    }).strict(),
    z.object({
      id: z.string().min(1),
      messageId: z.string().min(1),
      toolCallId: z.string().min(1),
      type: z.literal("tool-call"),
    }).strict(),
    z.object({
      availability: z.enum(["ready", "unavailable"]).optional(),
      error: z.string().optional(),
      fileId: z.string().min(1),
      id: z.string().min(1),
      mediaType: z.string().min(1),
      messageId: z.string().min(1),
      name: z.string().min(1),
      retryUrl: z.string().min(1).optional(),
      type: z.literal("media"),
      url: z.string().min(1),
    }).strict(),
  ])),
  messages: z.array(z.object({
    conversationId: z.string().min(1),
    durationMs: z.number().optional(),
    id: z.string().min(1),
    modelId: z.string().min(1).optional(),
    modelLabel: z.string().min(1).optional(),
    partIds: z.array(z.string().min(1)),
    role: z.enum(["assistant", "user"]),
    providerId: z.string().min(1).optional(),
    showHeader: z.boolean().optional(),
  }).strict()),
  threads: z.array(z.object({
    active: z.boolean().optional(),
    conversationId: z.string().min(1),
    ephemeral: z.boolean().optional(),
    id: z.string().min(1),
    pinnedAt: z.string().datetime().optional(),
    pinRank: z.number().nonnegative().optional(),
    timeLabel: z.string().optional(),
    title: z.string(),
    titleGenerating: z.boolean().optional(),
    unread: z.boolean().optional(),
    workspaceId: z.string().min(1),
  }).strict()),
  toolCalls: z.array(z.object({
    id: z.string().min(1),
    input: z.unknown(),
    messageId: z.string().min(1),
    status: z.enum(["completed", "failed", "pending", "running"]),
    toolName: z.string(),
  }).strict()),
  workspaces: z.array(z.object({
    id: z.string().min(1),
    name: z.string(),
    threadIds: z.array(z.string().min(1)),
  }).strict()),
}).strict().superRefine((controlPlane, context) => {
  addDuplicateIdIssues(controlPlane.workspaces, "workspace", ["workspaces"], context);
  addDuplicateIdIssues(controlPlane.threads, "thread", ["threads"], context);
  addDuplicateIdIssues(controlPlane.conversations, "conversation", ["conversations"], context);
  addDuplicateIdIssues(controlPlane.messages, "message", ["messages"], context);
  addDuplicateIdIssues(controlPlane.messageParts, "message part", ["messageParts"], context);
  addDuplicateIdIssues(controlPlane.toolCalls, "tool call", ["toolCalls"], context);

  const workspaceById = new Map(controlPlane.workspaces.map((workspace) => [workspace.id, workspace]));
  const threadById = new Map(controlPlane.threads.map((thread) => [thread.id, thread]));
  const conversationById = new Map(controlPlane.conversations.map((conversation) => [conversation.id, conversation]));
  const messageById = new Map(controlPlane.messages.map((message) => [message.id, message]));
  const messagePartById = new Map(controlPlane.messageParts.map((part) => [part.id, part]));
  const toolCallById = new Map(controlPlane.toolCalls.map((toolCall) => [toolCall.id, toolCall]));

  const activeWorkspace = workspaceById.get(controlPlane.activeWorkspaceId);
  const activeThread = threadById.get(controlPlane.activeThreadId);

  if (!activeWorkspace) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Control plane activeWorkspaceId "${controlPlane.activeWorkspaceId}" must reference a workspace.`,
      path: ["activeWorkspaceId"],
    });
  }

  if (!activeThread) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Control plane activeThreadId "${controlPlane.activeThreadId}" must reference a thread.`,
      path: ["activeThreadId"],
    });
  }

  if (activeWorkspace && activeThread) {
    if (activeThread.workspaceId !== activeWorkspace.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Control plane activeThreadId "${activeThread.id}" must belong to activeWorkspaceId "${activeWorkspace.id}".`,
        path: ["activeThreadId"],
      });
    }

    if (!activeWorkspace.threadIds.includes(activeThread.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Control plane activeThreadId "${activeThread.id}" must be listed in activeWorkspaceId "${activeWorkspace.id}".`,
        path: ["activeThreadId"],
      });
    }
  }

  controlPlane.workspaces.forEach((workspace, workspaceIndex) => {
    const seenThreadIds = new Set<string>();

    workspace.threadIds.forEach((threadId, threadIndex) => {
      const path = ["workspaces", workspaceIndex, "threadIds", threadIndex];

      if (seenThreadIds.has(threadId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Control plane workspace "${workspace.id}" threadIds[${threadIndex}] "${threadId}" must be unique.`,
          path,
        });
      }

      seenThreadIds.add(threadId);

      const thread = threadById.get(threadId);

      if (!thread) {
        addMissingReferenceIssue({
          context,
          path,
          sourceId: workspace.id,
          sourceLabel: "workspace",
          targetId: threadId,
          targetLabel: "thread",
        });
        return;
      }

      if (thread.workspaceId !== workspace.id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Control plane workspace "${workspace.id}" threadIds[${threadIndex}] "${threadId}" must reference a thread owned by that workspace.`,
          path,
        });
      }
    });
  });

  controlPlane.threads.forEach((thread, index) => {
    if (!workspaceById.has(thread.workspaceId)) {
      addMissingReferenceIssue({
        context,
        path: ["threads", index, "workspaceId"],
        sourceId: thread.id,
        sourceLabel: "thread",
        targetId: thread.workspaceId,
        targetLabel: "workspace",
      });
    }

    const conversation = conversationById.get(thread.conversationId);

    if (!conversation) {
      addMissingReferenceIssue({
        context,
        path: ["threads", index, "conversationId"],
        sourceId: thread.id,
        sourceLabel: "thread",
        targetId: thread.conversationId,
        targetLabel: "conversation",
      });
      return;
    }

    if (conversation.threadId !== thread.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Control plane thread "${thread.id}" conversationId "${thread.conversationId}" must reference a conversation owned by that thread.`,
        path: ["threads", index, "conversationId"],
      });
    }
  });

  controlPlane.conversations.forEach((conversation, index) => {
    const thread = threadById.get(conversation.threadId);

    if (!thread) {
      addMissingReferenceIssue({
        context,
        path: ["conversations", index, "threadId"],
        sourceId: conversation.id,
        sourceLabel: "conversation",
        targetId: conversation.threadId,
        targetLabel: "thread",
      });
      return;
    }

    if (thread.conversationId !== conversation.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Control plane conversation "${conversation.id}" threadId "${conversation.threadId}" must reference a thread owned by that conversation.`,
        path: ["conversations", index, "threadId"],
      });
    }
  });

  controlPlane.messages.forEach((message, messageIndex) => {
    if (!conversationById.has(message.conversationId)) {
      addMissingReferenceIssue({
        context,
        path: ["messages", messageIndex, "conversationId"],
        sourceId: message.id,
        sourceLabel: "message",
        targetId: message.conversationId,
        targetLabel: "conversation",
      });
    }

    const seenPartIds = new Set<string>();

    message.partIds.forEach((partId, partIndex) => {
      const path = ["messages", messageIndex, "partIds", partIndex];

      if (seenPartIds.has(partId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Control plane message "${message.id}" partIds[${partIndex}] "${partId}" must be unique.`,
          path,
        });
      }

      seenPartIds.add(partId);

      const part = messagePartById.get(partId);

      if (!part) {
        addMissingReferenceIssue({
          context,
          path,
          sourceId: message.id,
          sourceLabel: "message",
          targetId: partId,
          targetLabel: "message part",
        });
        return;
      }

      if (part.messageId !== message.id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Control plane message "${message.id}" partIds[${partIndex}] "${partId}" must reference a part owned by that message.`,
          path,
        });
      }
    });
  });

  controlPlane.messageParts.forEach((part, index) => {
    const message = messageById.get(part.messageId);

    if (!message) {
      addMissingReferenceIssue({
        context,
        path: ["messageParts", index, "messageId"],
        sourceId: part.id,
        sourceLabel: "message part",
        targetId: part.messageId,
        targetLabel: "message",
      });
    }

    if (part.type !== "tool-call") {
      return;
    }

    const toolCall = toolCallById.get(part.toolCallId);

    if (!toolCall) {
      addMissingReferenceIssue({
        context,
        path: ["messageParts", index, "toolCallId"],
        sourceId: part.id,
        sourceLabel: "message part",
        targetId: part.toolCallId,
        targetLabel: "tool call",
      });
      return;
    }

    if (message && toolCall.messageId !== message.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Control plane message part "${part.id}" toolCallId "${part.toolCallId}" must reference a tool call owned by the same message.`,
        path: ["messageParts", index, "toolCallId"],
      });
    }
  });

  controlPlane.toolCalls.forEach((toolCall, index) => {
    if (!messageById.has(toolCall.messageId)) {
      addMissingReferenceIssue({
        context,
        path: ["toolCalls", index, "messageId"],
        sourceId: toolCall.id,
        sourceLabel: "tool call",
        targetId: toolCall.messageId,
        targetLabel: "message",
      });
    }
  });
});

export const ChatShellManifestSchema = z.object({
  appearance: ChatShellAppearanceSchema.optional(),
  capabilities: ChatShellCapabilitiesSchema.optional(),
  controlPlane: ChatShellControlPlaneSchema,
  layout: ChatShellLayoutSchema,
  registries: ChatShellRegistriesSchema,
  runtime: ChatShellRuntimeSchema,
  schemaVersion: z.literal(chatShellSchemaVersion),
}).strict().superRefine(validateManifestPresentation);

export type ChatShellAction = z.infer<typeof ChatShellActionSchema>;
export type ChatShellAppearance = z.infer<typeof ChatShellAppearanceSchema>;
export type ChatShellAppearanceColorMode = z.infer<typeof ChatShellAppearanceColorModeSchema>;
export type ChatShellAppearanceDensity = z.infer<typeof ChatShellAppearanceDensitySchema>;
export type ChatShellAppearanceRadius = z.infer<typeof ChatShellAppearanceRadiusSchema>;
export type ChatShellAppearanceRadiusMode = z.infer<typeof ChatShellAppearanceRadiusModeSchema>;
export type ChatShellAppearanceShellSizing = z.infer<typeof ChatShellAppearanceShellSizingSchema>;
export type ChatShellAppearanceTokenOverrides = z.infer<typeof ChatShellAppearanceTokenOverridesSchema>;
export type ChatShellAppearanceTypography = z.infer<typeof ChatShellAppearanceTypographySchema>;
export type ChatShellAppearanceTypeScale = z.infer<typeof ChatShellAppearanceTypeScaleSchema>;
export type ChatShellComposerConfig = z.infer<typeof ChatShellComposerSchema>;
export type ChatShellControlPlane = z.infer<typeof ChatShellControlPlaneSchema>;
export type ChatShellLayoutConfig = z.infer<typeof ChatShellLayoutSchema>;
export type ChatShellManifest = z.infer<typeof ChatShellManifestSchema>;
export type ChatShellRegistries = z.infer<typeof ChatShellRegistriesSchema>;
export type ChatShellRuntime = z.infer<typeof ChatShellRuntimeSchema>;
export type ChatShellSettings = z.infer<typeof ChatShellSettingsSchema>;
export type ChatShellSettingsControlRow = z.infer<typeof ChatShellSettingsControlRowSchema>;
export type ChatShellSlot = z.infer<typeof ChatShellSlotSchema>;
export type ChatShellSlotRendererId = z.infer<typeof ChatShellSlotRendererIdSchema>;
export type ChatShellSlotRegion = z.infer<typeof ChatShellSlotRegionSchema>;
export type ChatShellSidePanel = z.infer<typeof ChatShellSidePanelSchema>;
export type ChatShellSidePanelContent = z.infer<typeof ChatShellSidePanelContentSchema>;
export type ChatShellSidePanelSurface = z.infer<typeof ChatShellSidePanelSurfaceSchema>;
export type ChatShellSidePanelSurfaceKind = z.infer<typeof ChatShellSidePanelSurfaceKindSchema>;
export type ChatShellSidePanelRendererId = z.infer<typeof ChatShellSidePanelRendererIdSchema>;
export type ChatShellSidePanelOption = ChatShellSidePanelSurface;
export type ChatShellSidebar = z.infer<typeof ChatShellSidebarSchema>;
export type ChatShellStatus = z.infer<typeof ChatShellStatusSchema>;
export type ChatShellStatusRow = z.infer<typeof ChatShellStatusRowSchema>;
export type ChatShellStatusSection = z.infer<typeof ChatShellStatusSectionSchema>;
export type ChatShellTask = z.infer<typeof ChatShellTaskSchema>;
export type ChatShellTasks = z.infer<typeof ChatShellTasksSchema>;
export type ChatShellUser = z.infer<typeof ChatShellUserSchema>;
export type ChatShellWindow = z.infer<typeof ChatShellWindowSchema>;
export type ChatShellWorkspace = z.infer<typeof ChatShellWorkspaceSchema>;
