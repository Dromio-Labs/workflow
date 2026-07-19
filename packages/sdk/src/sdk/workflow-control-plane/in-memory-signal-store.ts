import type {
  SignalWaitSnapshot,
  StoredSignalOccurrence,
  WorkflowRuntimeStore,
} from "./types.js";

type SignalMethods = Pick<
  WorkflowRuntimeStore,
  | "claimNextSignalDelivery"
  | "completeSignalDelivery"
  | "failSignalDelivery"
  | "getSignalOccurrence"
  | "putSignalOccurrence"
  | "syncSignalWaits"
>;

export type InMemorySignalStoreSnapshot = {
  signalOccurrences: StoredSignalOccurrence[];
  signalWaits: SignalWaitSnapshot[];
};

export type InMemorySignalStoreCapabilities = SignalMethods & {
  signalSnapshot(): InMemorySignalStoreSnapshot;
};

export function createInMemorySignalStoreCapabilities(
  seed: Partial<InMemorySignalStoreSnapshot> = {},
): InMemorySignalStoreCapabilities {
  const occurrences = new Map(
    (seed.signalOccurrences ?? []).map((item) => [item.id, clone(item)]),
  );
  const waits = new Map(
    (seed.signalWaits ?? []).map((item) => [item.token, clone(item)]),
  );
  return {
    claimNextSignalDelivery(input) {
      releaseExpired(input.now);
      const candidates = [...occurrences.values()]
        .filter((item) => item.status === "pending")
        .sort(byCreatedAt);
      const match = candidates.map((occurrence) => ({
        occurrence,
        wait: [...waits.values()]
          .filter((item) => item.status === "pending"
            && item.signalId === occurrence.signalId
            && item.correlationHash === occurrence.correlationHash)
          .sort(byCreatedAt)[0],
      })).find((item) => item.wait);
      if (!match?.wait) return undefined;
      const { occurrence, wait } = match;
      const claimedOccurrence: StoredSignalOccurrence = {
        ...occurrence,
        attempts: occurrence.attempts + 1,
        lockedBy: input.workerId,
        lockedUntil: new Date(Date.parse(input.now) + input.leaseMs).toISOString(),
        status: "claimed",
        updatedAt: input.now,
        waitToken: wait.token,
      };
      const claimedWait: SignalWaitSnapshot = {
        ...wait,
        status: "claimed",
        updatedAt: input.now,
      };
      occurrences.set(occurrence.id, clone(claimedOccurrence));
      waits.set(wait.token, clone(claimedWait));
      return {
        occurrence: clone(claimedOccurrence),
        wait: clone(claimedWait),
      };
    },
    completeSignalDelivery(input) {
      const occurrence = requireOccurrence(input.occurrenceId);
      const wait = requireWait(input.waitToken);
      const completed: StoredSignalOccurrence = {
        ...occurrence,
        error: undefined,
        lockedBy: undefined,
        lockedUntil: undefined,
        runId: input.runId,
        status: "delivered",
        updatedAt: input.now,
        waitToken: input.waitToken,
      };
      occurrences.set(completed.id, clone(completed));
      waits.set(wait.token, clone({ ...wait, status: "consumed", updatedAt: input.now }));
      return clone(completed);
    },
    failSignalDelivery(input) {
      const occurrence = requireOccurrence(input.occurrenceId);
      if (occurrence.waitToken) releaseWait(occurrence.waitToken, input.now);
      const failed: StoredSignalOccurrence = {
        ...occurrence,
        error: input.error,
        lockedBy: undefined,
        lockedUntil: undefined,
        status: input.retry ? "pending" : "failed",
        updatedAt: input.now,
        waitToken: undefined,
      };
      occurrences.set(failed.id, clone(failed));
      return clone(failed);
    },
    getSignalOccurrence(id) {
      const occurrence = occurrences.get(id);
      return occurrence ? clone(occurrence) : undefined;
    },
    putSignalOccurrence(input) {
      const existing = [...occurrences.values()].find((item) =>
        item.signalId === input.signalId && item.idempotencyKey === input.idempotencyKey
      );
      if (existing) return { created: false, occurrence: clone(existing) };
      const occurrence: StoredSignalOccurrence = {
        ...input,
        attempts: 0,
        status: "pending",
      };
      occurrences.set(occurrence.id, clone(occurrence));
      return { created: true, occurrence: clone(occurrence) };
    },
    signalSnapshot() {
      return {
        signalOccurrences: [...occurrences.values()].map(clone),
        signalWaits: [...waits.values()].map(clone),
      };
    },
    syncSignalWaits(input) {
      const active = new Set(input.waits.map((wait) => wait.token));
      for (const wait of waits.values()) {
        if (wait.runId === input.runId && wait.status === "pending" && !active.has(wait.token)) {
          waits.delete(wait.token);
        }
      }
      for (const wait of input.waits) {
        const existing = waits.get(wait.token);
        if (existing?.status === "claimed" || existing?.status === "consumed") continue;
        waits.set(wait.token, clone({ ...wait, updatedAt: input.now }));
      }
    },
  };

  function releaseExpired(now: string): void {
    for (const occurrence of occurrences.values()) {
      if (
        occurrence.status !== "claimed"
        || !occurrence.lockedUntil
        || occurrence.lockedUntil > now
      ) continue;
      if (occurrence.waitToken) releaseWait(occurrence.waitToken, now);
      occurrences.set(occurrence.id, clone({
        ...occurrence,
        lockedBy: undefined,
        lockedUntil: undefined,
        status: "pending",
        updatedAt: now,
        waitToken: undefined,
      }));
    }
  }

  function releaseWait(token: string, now: string): void {
    const wait = waits.get(token);
    if (wait?.status === "claimed") {
      waits.set(token, clone({ ...wait, status: "pending", updatedAt: now }));
    }
  }

  function requireOccurrence(id: string): StoredSignalOccurrence {
    const occurrence = occurrences.get(id);
    if (!occurrence) throw new Error(`Unknown signal occurrence: ${id}`);
    return occurrence;
  }

  function requireWait(token: string): SignalWaitSnapshot {
    const wait = waits.get(token);
    if (!wait) throw new Error(`Unknown signal wait: ${token}`);
    return wait;
  }
}

function byCreatedAt(left: { createdAt: string }, right: { createdAt: string }) {
  return left.createdAt.localeCompare(right.createdAt);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
