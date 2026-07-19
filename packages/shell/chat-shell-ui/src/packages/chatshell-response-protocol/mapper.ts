import {appendToolInputDelta, buildToolInputPreview, type ToolInputBuffer} from "./toolInput";
import type {ModelStreamEvent, StreamEvent, ToolInput} from "./types";

export type StreamMapperState = {
  toolInputsById: Map<string, ToolInputBuffer>;
  toolMessageById: Map<string, string>;
  toolNameById: Map<string, string>;
};

export function createStreamMapperState(): StreamMapperState {
  return {
    toolInputsById: new Map(),
    toolMessageById: new Map(),
    toolNameById: new Map(),
  };
}

export function mapModelStreamEvent(
  event: ModelStreamEvent,
  state: StreamMapperState,
): StreamEvent[] {
  switch (event.kind) {
    case "user_message":
    case "assistant_start":
    case "finish":
      return [event];

    case "text_delta":
      return [{
        content: event.delta,
        kind: "agent_message_chunk",
        messageId: event.messageId,
      }];

    case "reasoning_delta":
      return [{
        content: event.delta,
        kind: "agent_thought_chunk",
        messageId: event.messageId,
      }];

    case "tool_input_start":
      state.toolInputsById.set(event.toolCallId, {deltaCount: 0, rawInput: ""});
      state.toolMessageById.set(event.toolCallId, event.messageId);
      state.toolNameById.set(event.toolCallId, event.toolName);
      return [{
        input: {},
        kind: "tool_call",
        messageId: event.messageId,
        status: "pending",
        title: getToolTitle(event.toolName, {}),
        toolId: event.toolCallId,
        toolName: event.toolName,
      }];

    case "tool_input_delta": {
      const buffer = appendToolInputDelta(state.toolInputsById.get(event.toolCallId), event.delta);
      state.toolInputsById.set(event.toolCallId, buffer);
      const preview = buildToolInputPreview(buffer.rawInput);

      return [{
        input: preview.input,
        kind: "tool_call_update",
        status: "pending",
        toolId: event.toolCallId,
      }];
    }

    case "tool_input_end": {
      const buffer = state.toolInputsById.get(event.toolCallId);
      const preview = buildToolInputPreview(buffer?.rawInput ?? "", event.input);

      return [{
        input: preview.input,
        kind: "tool_call_update",
        status: "running",
        toolId: event.toolCallId,
      }];
    }

    case "tool_call":
      return [{
        input: event.input,
        kind: "tool_call_update",
        status: event.status,
        toolId: event.toolCallId,
      }];
  }
}

function getToolTitle(toolName: string, input: ToolInput) {
  if (input.summary) {
    return input.summary;
  }

  if (toolName === "changes") {
    return "3 files changed";
  }

  if (toolName === "shell") {
    return input.command ? `Ran ${input.command}` : "Ran command";
  }

  return toolName;
}
