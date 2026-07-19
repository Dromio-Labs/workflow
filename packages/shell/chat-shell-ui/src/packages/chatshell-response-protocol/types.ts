export type ToolStatus = "pending" | "running" | "completed" | "failed";

export type ResponseMedia = {
  availability?: "ready" | "unavailable";
  error?: string;
  fileId: string;
  mediaType: string;
  name: string;
  retryUrl?: string;
  url: string;
};

export type ToolInput = {
  command?: string;
  files?: Array<{
    additions: number;
    deletions: number;
    language: "css" | "html" | "javascript";
    name: string;
  }>;
  summary?: string;
  media?: Array<{
    fileId: string;
    mediaType: string;
    name: string;
    url: string;
  }>;
  toolSummary?: {
    action: string;
    additions?: number;
    command?: string;
    deletions?: number;
    detail?: string;
    files?: Array<{
      language: "css" | "html" | "javascript";
      name: string;
    }>;
    icon: "edit" | "none" | "search" | "terminal" | "tool";
    statusLabel?: string;
  };
};

export type ModelStreamEvent =
  | {
      content: string;
      id: string;
      kind: "user_message";
      media?: ResponseMedia[];
    }
  | {
      id: string;
      kind: "assistant_start";
      media?: ResponseMedia[];
      showHeader?: boolean;
      startedAt: number;
    }
  | {
      delta: string;
      kind: "text_delta" | "reasoning_delta";
      messageId: string;
    }
  | {
      kind: "tool_input_start";
      messageId: string;
      toolCallId: string;
      toolName: string;
    }
  | {
      delta: string;
      kind: "tool_input_delta";
      toolCallId: string;
    }
  | {
      input?: ToolInput;
      kind: "tool_input_end";
      toolCallId: string;
    }
  | {
      input: ToolInput;
      kind: "tool_call";
      messageId: string;
      status: ToolStatus;
      toolCallId: string;
      toolName: string;
    }
  | {
      durationMs: number;
      kind: "finish";
      messageId: string;
    };

export type StreamEvent =
  | {
      content: string;
      id: string;
      kind: "user_message";
      media?: ResponseMedia[];
    }
  | {
      id: string;
      kind: "assistant_start";
      media?: ResponseMedia[];
      showHeader?: boolean;
      startedAt: number;
    }
  | {
      content: string;
      kind: "agent_message_chunk" | "agent_thought_chunk";
      messageId: string;
    }
  | {
      input: ToolInput;
      kind: "tool_call";
      messageId: string;
      status: ToolStatus;
      title: string;
      toolId: string;
      toolName: string;
    }
  | {
      input?: ToolInput;
      kind: "tool_call_update";
      status: ToolStatus;
      toolId: string;
    }
  | {
      durationMs: number;
      kind: "finish";
      messageId: string;
    };

export type MessagePart =
  | {
      content: string;
      type: "content";
    }
  | {
      content: string;
      type: "thought";
    }
  | {
      toolId: string;
      type: "tool-call";
    };

export type ToolCall = {
  input: ToolInput;
  status: ToolStatus;
  title: string;
  toolId: string;
  toolName: string;
};

export type ChatMessage = {
  content: string;
  durationMs?: number;
  id: string;
  media: ResponseMedia[];
  modelId?: string;
  modelLabel?: string;
  parts: MessagePart[];
  role: "assistant" | "user";
  providerId?: string;
  showHeader?: boolean;
  startedAt?: number;
  status: "streaming" | "complete";
  toolCalls: ToolCall[];
};

export type ConversationState = {
  messages: ChatMessage[];
};
