import {
  ChatShellManifestSchema,
  type ChatShellControlPlane,
  type ChatShellManifest,
  type ChatShellRuntime,
} from "@dromio/chat-shell-ui/chat-shell-contracts/v1";

import {createMinimalChatShellManifest} from "../shared/minimalManifest";

export type BackendRuntimeState = ChatShellRuntime["conversation"]["state"];
export type BackendToolCallStatus = ChatShellControlPlane["toolCalls"][number]["status"];

export type BackendMessage = {
  readonly content?: string;
  readonly id: string;
  readonly role: "assistant" | "user";
  readonly toolCallId?: string;
  readonly type: "content" | "thought" | "tool-call";
};

export type BackendToolCall = {
  readonly id: string;
  readonly input: unknown;
  readonly messageId: string;
  readonly status: BackendToolCallStatus;
  readonly toolName: string;
};

export type ProductionBackendSnapshot = {
  readonly branch: string;
  readonly error?: {
    readonly detail: string;
    readonly title: string;
  };
  readonly messages: readonly BackendMessage[];
  readonly runtimeState: BackendRuntimeState;
  readonly title: string;
  readonly toolCalls: readonly BackendToolCall[];
  readonly workspaceName: string;
};

export function createManifestFromProductionSnapshot(snapshot: ProductionBackendSnapshot): ChatShellManifest {
  const base = createMinimalChatShellManifest();
  const controlPlane = createControlPlane(snapshot);
  const progressStatus = snapshot.runtimeState === "complete" ? "done" : snapshot.runtimeState === "error" ? "pending" : "active";

  return ChatShellManifestSchema.parse({
    ...base,
    controlPlane,
    registries: {
      ...base.registries,
      chrome: {
        ...base.registries.chrome,
        branch: snapshot.branch,
        title: "Production backend adapter",
        workspace: snapshot.workspaceName,
      },
      composer: {
        ...base.registries.composer,
        placeholder: "Post composer.submit to the host backend",
      },
      status: {
        ...base.registries.status,
        git: {
          additions: snapshot.messages.length,
          branch: snapshot.branch,
          deletions: 0,
        },
        goal: {
          status: snapshot.runtimeState,
          subtitle: "backend-owned manifest replacement",
          title: snapshot.title,
        },
        progress: [
          {id: "load-manifest", label: "Load manifest", status: "done"},
          {id: "post-event", label: "Post ChatShell event", status: progressStatus},
          {id: "validate-replacement", label: "Validate replacement", status: progressStatus},
        ],
        sections: [
          {
            id: "backend-runtime",
            rows: [
              {
                icon: snapshot.runtimeState === "error" ? "x" : "terminal",
                id: "runtime-state",
                kind: "progress",
                label: "Runtime",
                status: progressStatus,
                value: snapshot.runtimeState,
              },
              {
                icon: "wand",
                id: "tool-calls",
                kind: "progress",
                label: "Tool calls",
                metadata: snapshot.toolCalls.map((toolCall) => `${toolCall.toolName}:${toolCall.status}`),
                status: snapshot.toolCalls.some((toolCall) => toolCall.status === "running") ? "active" : progressStatus,
                value: String(snapshot.toolCalls.length),
              },
            ],
            status: snapshot.runtimeState,
            title: "Backend runtime",
          },
        ],
      },
    },
    runtime: {
      conversation: {
        error: snapshot.error,
        state: snapshot.runtimeState,
      },
    },
  });
}

export const emptyBackendSnapshot = createBackendSnapshot({
  messages: [],
  runtimeState: "empty",
  title: "Empty backend conversation",
  toolCalls: [],
});

export const streamingBackendSnapshot = createBackendSnapshot({
  messages: [
    {content: "Run deployment checks", id: "message-user-1", role: "user", type: "content"},
    {content: "I am checking the release health.", id: "message-assistant-1", role: "assistant", type: "content"},
  ],
  runtimeState: "streaming",
  title: "Streaming release check",
  toolCalls: [],
});

export const toolCallRunningBackendSnapshot = createBackendSnapshot({
  messages: [
    {content: "Inspect production health", id: "message-user-2", role: "user", type: "content"},
    {id: "message-assistant-2", role: "assistant", toolCallId: "tool-health", type: "tool-call"},
  ],
  runtimeState: "streaming",
  title: "Health inspection running",
  toolCalls: [
    {id: "tool-health", input: {service: "chat-shell"}, messageId: "message-assistant-2", status: "running", toolName: "health.check"},
  ],
});

export const toolCallCompletedBackendSnapshot = createBackendSnapshot({
  messages: [
    {content: "Inspect production health", id: "message-user-3", role: "user", type: "content"},
    {id: "message-assistant-3", role: "assistant", toolCallId: "tool-health-complete", type: "tool-call"},
    {content: "Health check completed successfully.", id: "message-assistant-4", role: "assistant", type: "content"},
  ],
  runtimeState: "complete",
  title: "Health inspection completed",
  toolCalls: [
    {id: "tool-health-complete", input: {service: "chat-shell"}, messageId: "message-assistant-3", status: "completed", toolName: "health.check"},
  ],
});

export const toolCallFailedBackendSnapshot = createBackendSnapshot({
  messages: [
    {content: "Inspect production health", id: "message-user-4", role: "user", type: "content"},
    {id: "message-assistant-5", role: "assistant", toolCallId: "tool-health-failed", type: "tool-call"},
    {content: "Health check failed before returning a healthy status.", id: "message-assistant-6", role: "assistant", type: "content"},
  ],
  runtimeState: "error",
  title: "Health inspection failed",
  toolCalls: [
    {id: "tool-health-failed", input: {service: "chat-shell"}, messageId: "message-assistant-5", status: "failed", toolName: "health.check"},
  ],
  error: {
    detail: "The backend health.check tool returned a failed status.",
    title: "Tool call failed",
  },
});

export const completedBackendSnapshot = createBackendSnapshot({
  messages: [
    {content: "Summarize the deployment", id: "message-user-5", role: "user", type: "content"},
    {content: "Deployment completed and the shell received a final manifest.", id: "message-assistant-7", role: "assistant", type: "content"},
  ],
  runtimeState: "complete",
  title: "Deployment summary",
  toolCalls: [],
});

export const errorBackendSnapshot = createBackendSnapshot({
  messages: [
    {content: "Load production thread", id: "message-user-6", role: "user", type: "content"},
  ],
  runtimeState: "error",
  title: "Backend request failed",
  toolCalls: [],
  error: {
    detail: "The host backend returned HTTP 503 while loading the thread.",
    title: "Backend unavailable",
  },
});

function createBackendSnapshot(overrides: Partial<ProductionBackendSnapshot>): ProductionBackendSnapshot {
  return {
    branch: "production/adapter",
    messages: [],
    runtimeState: "empty",
    title: "Production adapter",
    toolCalls: [],
    workspaceName: "production-host",
    ...overrides,
  };
}

function createControlPlane(snapshot: ProductionBackendSnapshot): ChatShellControlPlane {
  const conversationId = "conversation-production";
  const threadId = "thread-production";
  const workspaceId = "workspace-production";
  const messageParts = snapshot.messages.map((message) => {
    const partId = `part-${message.id}`;

    if (message.type === "tool-call") {
      if (!message.toolCallId) {
        throw new Error(`Backend tool-call message "${message.id}" is missing toolCallId.`);
      }

      return {
        id: partId,
        messageId: message.id,
        toolCallId: message.toolCallId,
        type: "tool-call" as const,
      };
    }

    return {
      content: message.content ?? "",
      id: partId,
      messageId: message.id,
      type: message.type,
    };
  });

  return {
    activeThreadId: threadId,
    activeWorkspaceId: workspaceId,
    conversations: [
      {
        branch: snapshot.branch,
        changes: {additions: snapshot.messages.length, deletions: 0},
        goal: {
          completed: snapshot.runtimeState === "complete",
          subtitle: "production backend adapter reference",
          title: snapshot.title,
        },
        id: conversationId,
        progress: snapshot.toolCalls.map((toolCall) => `${toolCall.toolName}:${toolCall.status}`),
        threadId,
      },
    ],
    messageParts,
    messages: snapshot.messages.map((message) => ({
      conversationId,
      id: message.id,
      partIds: [`part-${message.id}`],
      role: message.role,
      showHeader: message.role === "assistant",
    })),
    threads: [
      {
        active: true,
        conversationId,
        id: threadId,
        timeLabel: "now",
        title: snapshot.title,
        workspaceId,
      },
    ],
    toolCalls: snapshot.toolCalls.map((toolCall) => ({...toolCall})),
    workspaces: [
      {
        id: workspaceId,
        name: snapshot.workspaceName,
        threadIds: [threadId],
      },
    ],
  };
}
