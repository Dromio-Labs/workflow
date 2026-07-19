import type { EventRecord } from "../../core/loop/index.js";
import type { InteractionMessage } from "./interaction.types.js";

export function projectMessages(events: EventRecord[]): InteractionMessage[] {
  return events
    .filter((event) => event.message)
    .map((event) => ({
      eventIndex: event.index,
      id: `${event.runId}:${event.index}:message`,
      role: roleForEvent(event),
      text: event.message,
      timestamp: event.timestamp,
      type: event.type,
    }));
}

function roleForEvent(event: EventRecord): InteractionMessage["role"] {
  if (event.type === "question.answered" || event.type === "hook.resumed") {
    return "user";
  }
  if (event.type.startsWith("run.")) return "system";
  return "assistant";
}
