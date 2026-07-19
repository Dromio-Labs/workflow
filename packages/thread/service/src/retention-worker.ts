import type { DromioActorContextV1, DromioThreadV1 } from "@dromio/protocols";
import { ThreadServiceError } from "./errors.js";
import type { ThreadServiceClock, ThreadStore } from "./ports.js";
import { ThreadService } from "./service.js";
import type { ThreadCommandContext, ThreadScope } from "./types.js";

export interface ThreadRetentionRunResult {
  readonly scanned: number;
  readonly archived: number;
  readonly deletionRequested: number;
  readonly purged: number;
  readonly held: number;
}

export class ThreadRetentionWorker {
  constructor(
    private readonly options: {
      readonly store: ThreadStore;
      readonly service: ThreadService;
      readonly actor: DromioActorContextV1;
      readonly clock?: ThreadServiceClock;
      readonly purgeDeletedAfterDays?: number;
    },
  ) {}

  async run(scope: ThreadScope): Promise<ThreadRetentionRunResult> {
    const policy = await this.options.store.getRetentionPolicy(scope);
    if (!policy) return emptyResult();
    const threads = await this.readSnapshot(scope);
    const result = mutableResult(threads.length);
    const now = Date.parse((this.options.clock ?? systemClock).now());

    for (const thread of threads) {
      if (thread.status === "purged") continue;
      if (thread.status === "deleting") {
        await this.purgeWhenDue(scope, thread, policy.id, now, result);
        continue;
      }
      const age = ageInDays(thread.createdAt, now);
      const deleteAfterDays = policy.deleteAfterDays ?? policy.retainForDays;
      if (age >= deleteAfterDays) {
        await this.applyHeldAction(result, () =>
          this.options.service.deleteThread(
            command(this.options.actor, `retention:${policy.id}:${thread.id}:delete`),
            thread.id,
          ),
        );
        continue;
      }
      if (
        thread.status === "active" &&
        policy.archiveAfterDays !== undefined &&
        age >= policy.archiveAfterDays
      ) {
        await this.options.service.archiveThread(
          command(this.options.actor, `retention:${policy.id}:${thread.id}:archive`),
          thread.id,
          thread.version,
        );
        result.archived += 1;
      }
    }
    return result;
  }

  private async purgeWhenDue(
    scope: ThreadScope,
    thread: DromioThreadV1,
    policyId: string,
    now: number,
    result: MutableRetentionResult,
  ): Promise<void> {
    const grace = this.options.purgeDeletedAfterDays;
    if (grace === undefined || ageInDays(thread.updatedAt, now) < grace) return;
    await this.applyHeldAction(result, () =>
      this.options.service.purgeThread(
        command(this.options.actor, `retention:${policyId}:${thread.id}:purge`),
        thread.id,
      ),
      "purge",
    );
  }

  private async applyHeldAction(
    result: MutableRetentionResult,
    action: () => Promise<unknown>,
    kind: "delete" | "purge" = "delete",
  ): Promise<void> {
    try {
      await action();
      if (kind === "purge") result.purged += 1;
      else result.deletionRequested += 1;
    } catch (error) {
      if (error instanceof ThreadServiceError && error.code === "retention_locked") {
        result.held += 1;
        return;
      }
      throw error;
    }
  }

  private async readSnapshot(scope: ThreadScope): Promise<readonly DromioThreadV1[]> {
    const threads: DromioThreadV1[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.options.store.listThreads({ ...scope, cursor, limit: 100 });
      threads.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return threads;
  }
}

interface MutableRetentionResult {
  scanned: number;
  archived: number;
  deletionRequested: number;
  purged: number;
  held: number;
}

const systemClock: ThreadServiceClock = { now: () => new Date().toISOString() };

function command(actor: DromioActorContextV1, key: string): ThreadCommandContext {
  return { actor, commandId: key, idempotencyKey: key };
}

function ageInDays(timestamp: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(timestamp)) / 86_400_000));
}

function mutableResult(scanned: number): MutableRetentionResult {
  return { scanned, archived: 0, deletionRequested: 0, purged: 0, held: 0 };
}

function emptyResult(): ThreadRetentionRunResult {
  return mutableResult(0);
}
