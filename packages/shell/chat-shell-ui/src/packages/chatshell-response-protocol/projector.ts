import type {ChatMessage, ConversationState, StreamEvent, ToolCall} from "./types";

export const initialConversationState: ConversationState = {
  messages: [],
};

export function projectStreamEvent(
  state: ConversationState,
  event: StreamEvent,
): ConversationState {
  switch (event.kind) {
    case "user_message":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            content: event.content,
            id: event.id,
            media: event.media ?? [],
            parts: [{type: "content", content: event.content}],
            role: "user",
            status: "complete",
            toolCalls: [],
          },
        ],
      };

    case "assistant_start":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            content: "",
            id: event.id,
            media: event.media ?? [],
            parts: [],
            role: "assistant",
            showHeader: event.showHeader,
            startedAt: event.startedAt,
            status: "streaming",
            toolCalls: [],
          },
        ],
      };

    case "agent_message_chunk":
      return updateMessage(state, event.messageId, (message) => {
        const parts = [...message.parts];
        const lastPart = parts.at(-1);

        if (lastPart?.type === "content") {
          parts[parts.length - 1] = {
            ...lastPart,
            content: lastPart.content + event.content,
          };
        } else {
          parts.push({type: "content", content: event.content});
        }

        return {
          ...message,
          content: message.content + event.content,
          parts,
        };
      });

    case "agent_thought_chunk":
      return updateMessage(state, event.messageId, (message) => {
        const parts = [...message.parts];
        const lastPart = parts.at(-1);

        if (lastPart?.type === "thought") {
          parts[parts.length - 1] = {
            ...lastPart,
            content: lastPart.content + event.content,
          };
        } else {
          parts.push({type: "thought", content: event.content});
        }

        return {
          ...message,
          parts,
        };
      });

    case "tool_call":
      return updateMessage(state, event.messageId, (message) => ({
        ...message,
        parts: [...message.parts, {type: "tool-call", toolId: event.toolId}],
        toolCalls: [
          ...message.toolCalls,
          {
            input: event.input,
            status: event.status,
            title: event.title,
            toolId: event.toolId,
            toolName: event.toolName,
          },
        ],
      }));

    case "tool_call_update":
      return {
        ...state,
        messages: state.messages.map((message) => ({
          ...message,
          toolCalls: message.toolCalls.map((toolCall) => (
            toolCall.toolId === event.toolId
              ? {
                  ...toolCall,
                  input: event.input ? {...toolCall.input, ...event.input} : toolCall.input,
                  status: event.status,
                }
              : toolCall
          )),
        })),
      };

    case "finish":
      return updateMessage(state, event.messageId, (message) => ({
        ...message,
        durationMs: event.durationMs,
        status: "complete",
      }));
  }
}

export function getToolCall(message: ChatMessage, toolId: string): ToolCall | undefined {
  return message.toolCalls.find((toolCall) => toolCall.toolId === toolId);
}

function updateMessage(
  state: ConversationState,
  messageId: string,
  updater: (message: ChatMessage) => ChatMessage,
): ConversationState {
  return {
    ...state,
    messages: state.messages.map((message) => (
      message.id === messageId ? updater(message) : message
    )),
  };
}
