import type { EventRecord } from "../loop/index.js";

export async function* eventStreamFromList(
  read: () => Promise<EventRecord[]> | EventRecord[],
  fromIndex = 0,
): AsyncIterable<EventRecord> {
  const seen = new Set<number>();
  for (const event of await read()) {
    if (event.index < fromIndex || seen.has(event.index)) continue;
    seen.add(event.index);
    yield event;
  }
}
