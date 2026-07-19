import { describe, expect, test } from "bun:test";
import type { DromioActorContextV1 } from "@dromio/protocols";
import { MemoryThreadStore } from "./memory-store.js";
import { ThreadRetentionWorker } from "./retention-worker.js";
import { ThreadService } from "./service.js";

const actor: DromioActorContextV1 = {
  schemaVersion: "dromio.actor-context.v1",
  subject: { type: "system", id: "retention-worker" },
  tenantId: "tenant-1",
  applicationId: "app-1",
  roles: ["admin"],
  groupIds: [],
};

describe("ThreadRetentionWorker", () => {
  test("archives, requests deletion, purges after grace, and preserves legal holds", async () => {
    const store = new MemoryThreadStore();
    let now = "2026-01-01T00:00:00.000Z";
    let id = 0;
    const clock = { now: () => now };
    const service = new ThreadService({
      store,
      clock,
      ids: { create: (kind) => `${kind}-${++id}` },
    });
    const first = (await service.createThread({ actor, commandId: "first" })).resource;
    const held = (await service.createThread({ actor, commandId: "held" })).resource;
    await service.setRetentionPolicy(
      { actor, commandId: "policy-1" },
      { retainForDays: 30, archiveAfterDays: 30, deleteAfterDays: 180 },
    );
    now = "2026-04-15T00:00:00.000Z";
    const worker = new ThreadRetentionWorker({
      store,
      service,
      actor,
      clock,
      purgeDeletedAfterDays: 30,
    });

    expect(await worker.run(actor)).toEqual({
      scanned: 2,
      archived: 2,
      deletionRequested: 0,
      purged: 0,
      held: 0,
    });
    await service.placeLegalHold(
      { actor, commandId: "hold" },
      { threadId: held.id, reason: "litigation" },
    );
    await service.setRetentionPolicy(
      { actor, commandId: "policy-2" },
      { retainForDays: 30, archiveAfterDays: 30, deleteAfterDays: 90 },
    );
    expect(await worker.run(actor)).toMatchObject({ deletionRequested: 1, held: 1 });
    expect((await store.getThread(actor, first.id))?.status).toBe("deleting");
    expect((await store.getThread(actor, held.id))?.status).toBe("archived");

    now = "2026-05-16T00:00:00.000Z";
    expect(await worker.run(actor)).toMatchObject({ purged: 1, held: 1 });
    expect((await store.getThread(actor, first.id))?.status).toBe("purged");
    expect((await store.getPurgeReceipt(actor, first.id))?.threadId).toBe(first.id);
  });

  test("rejects contradictory retention windows", async () => {
    const service = new ThreadService({ store: new MemoryThreadStore() });
    expect(
      service.setRetentionPolicy(
        { actor, commandId: "invalid" },
        { retainForDays: 30, deleteAfterDays: 10 },
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});
