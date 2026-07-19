import type { ThreadOutboxEntry } from "./types.js";
import type { ThreadStore } from "./ports.js";

export interface ThreadEventProjectionPort {
  project(entry: ThreadOutboxEntry): Promise<void>;
}

export class ThreadEventOutboxRelay {
  constructor(
    private readonly options: {
      readonly store: ThreadStore;
      readonly projections: readonly ThreadEventProjectionPort[];
      readonly now?: () => string;
    },
  ) {}

  async dispatchPending(limit = 100): Promise<number> {
    let count = 0;
    for (const entry of await this.options.store.readOutbox(limit, "thread.events")) {
      for (const projection of this.options.projections) await projection.project(entry);
      await this.options.store.markOutboxPublished(
        entry.id,
        this.options.now?.() ?? new Date().toISOString(),
      );
      count += 1;
    }
    return count;
  }
}
