import type { DromioActorContextV1 } from "@dromio/protocols";
import type { ThreadServiceClock, ThreadStore } from "./ports.js";
import type { ThreadService } from "./service.js";

export class ThreadInteractionExpiryWorker {
  constructor(private readonly options: {
    readonly store: ThreadStore;
    readonly service: ThreadService;
    readonly clock?: ThreadServiceClock;
  }) {}

  async dispatchExpired(limit = 100): Promise<number> {
    const now = (this.options.clock ?? systemClock).now();
    let expired = 0;
    for (const candidate of await this.options.store.listExpiredInteractions(now, limit)) {
      const actor: DromioActorContextV1 = {
        schemaVersion: "dromio.actor-context.v1",
        subject: { type: "system", id: "thread-interaction-expiry-worker" },
        ...candidate.scope,
        roles: ["system"],
        groupIds: [],
      };
      if (await this.options.service.expireInteraction(
        { actor, commandId: `expire:${candidate.interaction.id}:${candidate.interaction.version}` },
        candidate.interaction.id,
      )) expired += 1;
    }
    return expired;
  }
}

const systemClock: ThreadServiceClock = { now: () => new Date().toISOString() };
