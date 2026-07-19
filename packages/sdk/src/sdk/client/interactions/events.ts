import type { EventRecord } from "../../core/loop/index.js";

export function mergeEvents(existing: EventRecord[], incoming: EventRecord[]): EventRecord[] {
  const byIndex = new Map<number, EventRecord>();
  for (const event of [...existing, ...incoming]) {
    byIndex.set(event.index, event);
  }
  return [...byIndex.values()].sort((left, right) => left.index - right.index);
}
