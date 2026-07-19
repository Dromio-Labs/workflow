import type { EventRecord } from "../../core/loop/index.js";
import type { InteractionTimelineItem } from "./interaction.types.js";

export function projectTimeline(events: EventRecord[]): InteractionTimelineItem[] {
  return events.map((event) => ({
    event,
    id: `${event.runId}:${event.index}:timeline`,
    index: event.index,
    label: event.message,
    status: statusForEvent(event.type),
    timestamp: event.timestamp,
    type: event.type,
  }));
}

function statusForEvent(type: string): InteractionTimelineItem["status"] {
  if (type.endsWith(".failed") || type === "run.failed") return "error";
  if (type.includes("waiting") || type === "question.requested") return "waiting";
  if (type.endsWith(".started") || type === "run.started") return "running";
  return "done";
}
