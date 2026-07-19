import { expect, test } from "bun:test";
import type { DromioActorContextV1 } from "@dromio/protocols";
import { MemoryThreadStore } from "./memory-store.js";
import { ThreadService } from "./service.js";
import { ThreadInteractionExpiryWorker } from "./interaction-expiry-worker.js";

test("expires pending interactions and resumes their exact turn without user input", async () => {
  const actor: DromioActorContextV1 = { schemaVersion: "dromio.actor-context.v1", subject: { type: "user", id: "owner" }, tenantId: "tenant-1", applicationId: "app-1", roles: ["owner"], groupIds: [] };
  let now = "2026-01-01T00:00:00.000Z"; let id = 0;
  const store = new MemoryThreadStore(); const clock = { now: () => now };
  const service = new ThreadService({ store, clock, ids: { create: (kind) => `${kind}-${++id}` } });
  const thread = (await service.createThread({ actor, commandId: "create" })).resource;
  const turn = (await service.createTurn({ actor, commandId: "send" }, { threadId: thread.id, content: [{ type: "text", text: "Ask" }] })).resource;
  await service.transitionTurn({ actor, commandId: "start" }, { threadId: thread.id, turnId: turn.id, status: "running" });
  const messageId = (await service.getThread({ actor, commandId: "read" }, thread.id)).items[0]!.id;
  const interaction = (await service.createInteraction({ actor, commandId: "question" }, { threadId: thread.id, turnId: turn.id, itemId: messageId, kind: "question", prompt: "Continue?", answerSchema: { type: "boolean" }, expiresAt: "2026-01-01T00:01:00.000Z" })).resource;
  now = "2026-01-01T00:02:00.000Z";
  const worker = new ThreadInteractionExpiryWorker({ store, service, clock });
  expect(await worker.dispatchExpired()).toBe(1);
  expect(await worker.dispatchExpired()).toBe(0);
  const snapshot = await service.getThread({ actor, commandId: "expired-read" }, thread.id);
  expect(snapshot.interactions).toContainEqual(expect.objectContaining({ id: interaction.id, status: "expired" }));
  expect(snapshot.items).toContainEqual(expect.objectContaining({ resourceId: interaction.id, status: "expired", type: "question" }));
  expect((await store.readOutbox(100, "execution.commands")).at(-1)?.payload).toMatchObject({ operation: "resume_thread_turn", threadId: thread.id, turnId: turn.id, turnOrdinal: turn.ordinal, answer: null });
});
