import { describe, expect, test } from "bun:test";
import type { DromioActorContextV1 } from "@dromio/protocols";
import { MemoryThreadStore } from "./memory-store.js";
import { ThreadService } from "./service.js";

const actor: DromioActorContextV1 = {
  schemaVersion: "dromio.actor-context.v1",
  subject: { type: "user", id: "user-1" },
  tenantId: "tenant-1",
  applicationId: "app-1",
  roles: ["owner"],
  groupIds: [],
};

function createFixture() {
  const store = new MemoryThreadStore();
  let nextId = 0;
  const service = new ThreadService({
    store,
    clock: { now: () => "2026-01-01T00:00:00.000Z" },
    ids: { create: (kind) => `${kind}-${++nextId}` },
  });
  return { service, store };
}

describe("ThreadService", () => {
  test("creates explicit threads with a durable receipt and sequenced outbox event", async () => {
    const { service, store } = createFixture();
    const receipt = await service.createThread(
      { actor, commandId: "command-1", idempotencyKey: "new-chat" },
      { title: "Support" },
    );

    expect(receipt.resource.title).toBe("Support");
    expect(receipt.threadSequence).toBe(1);
    expect((await store.readApplicationEvents(actor, 0, 10)).map((event) => event.type)).toEqual(["thread.created"]);
    expect((await store.readOutbox(10)).map((entry) => entry.topic)).toEqual(["thread.events"]);
  });

  test("replays permanent idempotency receipts and rejects key reuse", async () => {
    const { service } = createFixture();
    const context = { actor, commandId: "command-1", idempotencyKey: "new-chat" };
    const first = await service.createThread(context, { title: "Support" });
    const replay = await service.createThread({ ...context, commandId: "command-2" }, { title: "Support" });

    expect(replay.resource.id).toBe(first.resource.id);
    expect(replay.replayed).toBe(true);
    expect(service.createThread(context, { title: "Different" })).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  test("writes the message, turn, events, and execution outbox atomically", async () => {
    const { service, store } = createFixture();
    const thread = (await service.createThread({ actor, commandId: "command-1" })).resource;
    const turn = await service.createTurn(
      { actor, commandId: "command-2", idempotencyKey: "send-1" },
      { threadId: thread.id, content: [{ type: "text", text: "Hello" }] },
    );
    const snapshot = await service.getThread({ actor, commandId: "query-1" }, thread.id);

    expect(turn.resource.status).toBe("eligible");
    expect(snapshot.thread.title).toBe("Hello");
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.turns).toHaveLength(1);
    expect((await store.readThreadEvents(actor, thread.id, 1, 10)).map((event) => event.type)).toEqual([
      "thread.updated",
      "item.created",
      "turn.queued",
      "turn.eligible",
    ]);
    expect((await store.readOutbox(10)).map((entry) => entry.topic)).toEqual([
      "thread.events",
      "thread.events",
      "thread.events",
      "thread.events",
      "thread.events",
      "execution.commands",
    ]);
  });

  test("summarizes only the first message when a thread still has its default title", async () => {
    const { service } = createFixture();
    const thread = (
      await service.createThread({ actor, commandId: "create" })
    ).resource;
    await service.createTurn(
      { actor, commandId: "first" },
      {
        threadId: thread.id,
        content: [
          {
            type: "text",
            text: "  Investigate   why browser screenshots are not visible in the conversation and provide proof  ",
          },
        ],
      },
    );
    await service.createTurn(
      { actor, commandId: "second" },
      { threadId: thread.id, content: [{ type: "text", text: "Ignore me" }] },
    );

    expect(
      (await service.getThread({ actor, commandId: "read" }, thread.id)).thread
        .title,
    ).toBe("Investigate why browser screenshots are not visible in the…");
  });

  test("preserves an explicit thread title when the first turn starts", async () => {
    const { service } = createFixture();
    const thread = (
      await service.createThread(
        { actor, commandId: "create" },
        { title: "Browser evidence" },
      )
    ).resource;
    await service.createTurn(
      { actor, commandId: "first" },
      { threadId: thread.id, content: [{ type: "text", text: "Ignore me" }] },
    );

    expect(
      (await service.getThread({ actor, commandId: "read" }, thread.id)).thread
        .title,
    ).toBe("Browser evidence");
  });

  test("keeps later turns queued behind the logical head turn", async () => {
    const { service } = createFixture();
    const thread = (await service.createThread({ actor, commandId: "command-1" })).resource;
    await service.createTurn({ actor, commandId: "command-2" }, { threadId: thread.id, content: [{ type: "text", text: "One" }] });
    const second = await service.createTurn({ actor, commandId: "command-3" }, { threadId: thread.id, content: [{ type: "text", text: "Two" }] });

    expect(second.resource.status).toBe("queued");
  });

  test("retains the logical slot while waiting and promotes FIFO after completion", async () => {
    const { service, store } = createFixture();
    const thread = (await service.createThread({ actor, commandId: "command-1" })).resource;
    const first = await service.createTurn({ actor, commandId: "command-2" }, { threadId: thread.id, content: [{ type: "text", text: "One" }] });
    const second = await service.createTurn({ actor, commandId: "command-3" }, { threadId: thread.id, content: [{ type: "text", text: "Two" }] });
    await service.transitionTurn({ actor, commandId: "command-4" }, { threadId: thread.id, turnId: first.resource.id, status: "running" });
    await service.transitionTurn({ actor, commandId: "command-5" }, { threadId: thread.id, turnId: first.resource.id, status: "waiting_for_approval" });
    expect((await service.getThread({ actor, commandId: "query-1" }, thread.id)).turns.find((turn) => turn.id === second.resource.id)?.status).toBe("queued");
    await service.transitionTurn({ actor, commandId: "command-6" }, { threadId: thread.id, turnId: first.resource.id, status: "running" });
    await service.transitionTurn({ actor, commandId: "command-7" }, { threadId: thread.id, turnId: first.resource.id, status: "completed" });
    expect((await service.getThread({ actor, commandId: "query-2" }, thread.id)).turns.find((turn) => turn.id === second.resource.id)?.status).toBe("eligible");
    expect((await store.readOutbox(100)).filter((entry) => entry.topic === "execution.commands")).toHaveLength(2);
  });

  test("enforces optimistic versions and tenant isolation", async () => {
    const { service } = createFixture();
    const thread = (await service.createThread({ actor, commandId: "command-1" })).resource;
    expect(service.updateThread({ actor, commandId: "command-2" }, thread.id, { title: "No", expectedVersion: 99 })).rejects.toMatchObject({ code: "version_conflict" });

    const otherActor = { ...actor, tenantId: "tenant-2" };
    expect(service.getThread({ actor: otherActor, commandId: "query-1" }, thread.id)).rejects.toMatchObject({ code: "resource_not_found" });
    const ungrantedMember = { ...actor, subject: { type: "user" as const, id: "user-2" }, roles: [] };
    expect(service.getThread({ actor: ungrantedMember, commandId: "query-2" }, thread.id)).rejects.toMatchObject({ code: "permission_denied" });
  });

  test("persists one-shot interactions and emits durable resume work", async () => {
    const { service, store } = createFixture();
    const thread = (await service.createThread({ actor, commandId: "create" })).resource;
    const turn = await service.createTurn({ actor, commandId: "send" }, { threadId: thread.id, content: [{ type: "text", text: "Delete it" }] });
    await service.transitionTurn({ actor, commandId: "start" }, { threadId: thread.id, turnId: turn.resource.id, status: "running" });
    const tool = await approvalTool(service, thread.id, turn.resource.id, "files.delete", { fileId: "file-1" });
    const interaction = await service.createInteraction({ actor, commandId: "ask" }, { threadId: thread.id, turnId: turn.resource.id, itemId: tool.id, kind: "approval", operation: "files.delete", toolVersion: "1", argumentsDigest: tool.argumentsDigest, requestedPermissions: ["files:delete"] });
    expect((await service.getThread({ actor, commandId: "interaction-item-read" }, thread.id)).items).toContainEqual(expect.objectContaining({ type: "approval_request", resourceId: interaction.resource.id, status: "pending" }));
    const resolved = await service.resolveInteraction({ actor, commandId: "approve", idempotencyKey: "approve-1" }, { interactionId: interaction.resource.id, decision: "approved" });
    expect(resolved.resource.status).toBe("resolved");
    expect((await service.getThread({ actor, commandId: "recover" }, thread.id)).interactions).toMatchObject([{ id: interaction.resource.id, status: "resolved" }]);
    expect((await service.getThread({ actor, commandId: "resolved-item-read" }, thread.id)).items).toContainEqual(expect.objectContaining({ type: "approval_request", resourceId: interaction.resource.id, status: "resolved" }));
    expect(service.resolveInteraction({ actor, commandId: "approve-again" }, { interactionId: interaction.resource.id, decision: "approved" })).rejects.toMatchObject({ code: "interaction_already_resolved" });
    expect((await store.readOutbox(100)).filter((entry) => entry.topic === "execution.commands")).toHaveLength(2);
  });

  test("binds approvals to exact tool arguments and validates typed answers", async () => {
    const { service } = createFixture();
    const thread = (await service.createThread({ actor, commandId: "create" })).resource;
    const turn = (await service.createTurn({ actor, commandId: "send" }, { threadId: thread.id, content: [{ type: "text", text: "Validate" }] })).resource;
    await service.transitionTurn({ actor, commandId: "start" }, { threadId: thread.id, turnId: turn.id, status: "running" });
    const tool = await approvalTool(service, thread.id, turn.id, "files.delete", { fileId: "file-1" });
    expect(service.createInteraction({ actor, commandId: "wrong-digest" }, { threadId: thread.id, turnId: turn.id, itemId: tool.id, kind: "approval", operation: "files.delete", toolVersion: "1", argumentsDigest: "sha256:wrong", requestedPermissions: ["files:delete"] })).rejects.toMatchObject({ code: "validation_failed" });
    expect(service.createInteraction({ actor, commandId: "wrong-operation" }, { threadId: thread.id, turnId: turn.id, itemId: tool.id, kind: "approval", operation: "files.read", toolVersion: "1", argumentsDigest: tool.argumentsDigest, requestedPermissions: ["files:read"] })).rejects.toMatchObject({ code: "validation_failed" });
    const question = await service.createInteraction({ actor, commandId: "question" }, { threadId: thread.id, turnId: turn.id, itemId: tool.id, kind: "question", prompt: "Count?", answerSchema: { type: "integer", minimum: 1 } });
    expect(service.resolveInteraction({ actor, commandId: "invalid-answer" }, { interactionId: question.resource.id, answer: "one" })).rejects.toMatchObject({ code: "validation_failed" });
    expect((await service.resolveInteraction({ actor, commandId: "valid-answer" }, { interactionId: question.resource.id, answer: 1 })).resource).toMatchObject({ status: "resolved", answer: 1 });
  });

  test("persists denied approvals and typed form answers as one-shot durable resumes", async () => {
    const { service, store } = createFixture();
    const thread = (await service.createThread({ actor, commandId: "create" })).resource;
    const turn = (await service.createTurn(
      { actor, commandId: "send" },
      { threadId: thread.id, content: [{ type: "text", text: "Collect refund details" }] },
    )).resource;
    await service.transitionTurn(
      { actor, commandId: "start" },
      { threadId: thread.id, turnId: turn.id, status: "running" },
    );
    const itemId = (await service.getThread({ actor, commandId: "read" }, thread.id)).items[0]!.id;
    const form = await service.createInteraction(
      { actor, commandId: "form" },
      {
        threadId: thread.id,
        turnId: turn.id,
        itemId,
        kind: "form",
        prompt: "Refund details",
        answerSchema: {
          type: "object",
          required: ["orderId", "reason"],
          properties: {
            orderId: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
    );
    const formAnswer = { orderId: "ORDER-1", reason: "duplicate" };
    expect((await service.resolveInteraction(
      { actor, commandId: "answer-form" },
      { interactionId: form.resource.id, answer: formAnswer },
    )).resource).toMatchObject({ kind: "form", status: "resolved", answer: formAnswer });

    const tool = await approvalTool(service, thread.id, turn.id, "refund.issue", { orderId: "ORDER-1" });
    const approval = await service.createInteraction(
      { actor, commandId: "approval" },
      {
        threadId: thread.id,
        turnId: turn.id,
        itemId: tool.id,
        kind: "approval",
        operation: "refund.issue",
        toolVersion: "1",
        argumentsDigest: tool.argumentsDigest,
        requestedPermissions: ["refund:issue"],
      },
    );
    expect((await service.resolveInteraction(
      { actor, commandId: "deny" },
      { interactionId: approval.resource.id, decision: "denied" },
    )).resource).toMatchObject({ kind: "approval", status: "resolved", decision: "denied" });
    expect((await store.readOutbox(100)).filter((entry) =>
      entry.topic === "execution.commands" && entry.payload.operation === "resume_thread_turn"
    )).toHaveLength(2);
  });

  test("records revisions, redaction, access grants, and per-user state", async () => {
    const { service, store } = createFixture();
    const thread = (await service.createThread({ actor, commandId: "create" })).resource;
    await service.createTurn({ actor, commandId: "head" }, { threadId: thread.id, content: [{ type: "text", text: "head" }] });
    await service.createTurn({ actor, commandId: "send" }, { threadId: thread.id, content: [{ type: "text", text: "secret" }] });
    const message = (await service.getThread({ actor, commandId: "read" }, thread.id)).items[1]!;
    await service.reviseMessage({ actor, commandId: "revise" }, { threadId: thread.id, messageId: message.id, content: [{ type: "text", text: "corrected" }] });
    const redacted = await service.redactMessage({ actor, commandId: "redact" }, { threadId: thread.id, messageId: message.id, content: [] });
    expect(redacted.resource).toMatchObject({ status: "redacted", contextVisibility: "excluded", revision: 3 });
    const revisions = await store.listMessageRevisions(actor, thread.id, message.id);
    expect(revisions).toHaveLength(1);
    expect(JSON.stringify(revisions)).not.toContain("secret");
    expect(JSON.stringify(revisions)).not.toContain("corrected");
    expect((await service.grantAccess({ actor, commandId: "grant" }, { threadId: thread.id, principal: { type: "user", id: "user-2" }, role: "viewer" })).resource.role).toBe("viewer");
    const sharedBefore = await store.readApplicationEvents(actor, 0, 100);
    const updated = await service.updateUserState({ actor, commandId: "pin" }, thread.id, { pinnedAt: "2026-01-01T00:00:00Z", pinRank: 2, lastReadItemOrdinal: 1, expectedVersion: 0 });
    expect(updated.resource).toMatchObject({ lastReadItemOrdinal: 1, version: 1 });
    expect(updated.userSequence).toBe(1);
    const unpinned = await service.updateUserState({ actor, commandId: "unpin" }, thread.id, { pinnedAt: null, pinRank: null, expectedVersion: 1 });
    expect(unpinned.resource).not.toHaveProperty("pinnedAt");
    expect(unpinned.resource).not.toHaveProperty("pinRank");
    expect((await service.listThreads({ actor, commandId: "list" })).userStates).toEqual([unpinned.resource]);
    expect(unpinned.userSequence).toBe(2);
    expect(await store.readApplicationEvents(actor, 0, 100)).toEqual(sharedBefore);
    expect(await store.readUserEvents(actor, actor.subject.id, 0, 100)).toMatchObject([
      { type: "user_state.updated", threadId: thread.id, sequence: 1 },
      { type: "user_state.updated", threadId: thread.id, sequence: 2 },
    ]);
    expect(service.updateUserState({ actor, commandId: "stale" }, thread.id, { lastReadItemOrdinal: 2, expectedVersion: 0 })).rejects.toMatchObject({ code: "version_conflict" });
  });

  test("forks from the prior stable boundary when editing after execution eligibility", async () => {
    const { service } = createFixture(); const source = (await service.createThread({ actor, commandId: "create" }, { title: "Source" })).resource;
    await service.createTurn({ actor, commandId: "send" }, { threadId: source.id, content: [{ type: "text", text: "original" }] }); const sourceMessage = (await service.getThread({ actor, commandId: "read" }, source.id)).items[0]!;
    const edited = await service.reviseMessage({ actor, commandId: "edit", idempotencyKey: "edit-1" }, { threadId: source.id, messageId: sourceMessage.id, content: [{ type: "text", text: "edited" }] });
    expect(edited.resource.threadId).not.toBe(source.id); expect(edited.resource).toMatchObject({ type: "message", content: [{ type: "text", text: "edited" }] });
    expect((await service.getThread({ actor, commandId: "source-read" }, source.id)).items[0]).toMatchObject({ content: [{ type: "text", text: "original" }] });
    const branch = await service.getThread({ actor, commandId: "branch-read" }, edited.resource.threadId); expect(branch.thread.parentThreadId).toBe(source.id); expect(branch.turns[0]?.regeneratedFromTurnId).toBeDefined();
    expect((await service.reviseMessage({ actor, commandId: "replay", idempotencyKey: "edit-1" }, { threadId: source.id, messageId: sourceMessage.id, content: [{ type: "text", text: "edited" }] })).resource.threadId).toBe(branch.thread.id);
  });

  test("withdraws queued input without rewriting or cancelling the active head", async () => {
    const { service } = createFixture(); const thread = (await service.createThread({ actor, commandId: "create" })).resource;
    const head = (await service.createTurn({ actor, commandId: "head" }, { threadId: thread.id, content: [{ type: "text", text: "active" }] })).resource;
    const queued = (await service.createTurn({ actor, commandId: "queued" }, { threadId: thread.id, content: [{ type: "text", text: "withdraw me" }] })).resource;
    const message = (await service.getThread({ actor, commandId: "read" }, thread.id)).items.find((item) => item.turnId === queued.id)!;
    const withdrawn = await service.withdrawMessage({ actor, commandId: "withdraw", idempotencyKey: "withdraw-1" }, { threadId: thread.id, messageId: message.id, content: [] });
    expect(withdrawn.resource).toMatchObject({ status: "withdrawn", content: [], contextVisibility: "excluded" }); const snapshot = await service.getThread({ actor, commandId: "verify" }, thread.id);
    expect(snapshot.turns.find((turn) => turn.id === queued.id)?.status).toBe("cancelled"); expect(snapshot.turns.find((turn) => turn.id === head.id)?.status).toBe("eligible");
  });

  test("forks immutable history with ancestry and fresh resource identities", async () => {
    const { service } = createFixture();
    const source = (await service.createThread({ actor, commandId: "create" }, { title: "Original" })).resource;
    const turn = (await service.createTurn({ actor, commandId: "send" }, { threadId: source.id, content: [{ type: "text", text: "Fork me" }] })).resource;
    await service.transitionTurn({ actor, commandId: "start" }, { threadId: source.id, turnId: turn.id, status: "running" });
    await service.appendAssistantOutput({ actor, commandId: "output" }, { threadId: source.id, turnId: turn.id, text: "Done", final: true });
    await service.transitionTurn({ actor, commandId: "complete" }, { threadId: source.id, turnId: turn.id, status: "completed" });
    const fork = (await service.forkThread({ actor, commandId: "fork", idempotencyKey: "fork-1" }, { sourceThreadId: source.id, throughTurnId: turn.id })).resource;
    const snapshot = await service.getThread({ actor, commandId: "read-fork" }, fork.id);
    expect(snapshot.items.map((item) => item.id)).not.toEqual((await service.getThread({ actor, commandId: "read-source" }, source.id)).items.map((item) => item.id));
    expect(snapshot.items.map((item) => item.type === "message" ? item.content : [])).toEqual([[{ type: "text", text: "Fork me" }], [{ type: "text", text: "Done" }]]);
    expect((await service.getThreadAncestry({ actor, commandId: "ancestry" }, fork.id)).map((thread) => thread.id)).toEqual([source.id]);
  });

  test("retries and regenerates from immutable user input with explicit lineage", async () => {
    const { service } = createFixture();
    const thread = (await service.createThread({ actor, commandId: "create" })).resource;
    const source = (await service.createTurn({ actor, commandId: "send" }, { threadId: thread.id, content: [{ type: "text", text: "Again" }] })).resource;
    await service.transitionTurn({ actor, commandId: "start" }, { threadId: thread.id, turnId: source.id, status: "running" });
    await service.transitionTurn({ actor, commandId: "fail" }, { threadId: thread.id, turnId: source.id, status: "failed" });
    const retry = (await service.retryTurn({ actor, commandId: "retry", idempotencyKey: "retry-1" }, thread.id, source.id)).resource;
    expect(retry.retryOfTurnId).toBe(source.id);
    await service.transitionTurn({ actor, commandId: "retry-start" }, { threadId: thread.id, turnId: retry.id, status: "running" });
    await service.transitionTurn({ actor, commandId: "retry-complete" }, { threadId: thread.id, turnId: retry.id, status: "completed" });
    const regenerate = (await service.regenerateTurn({ actor, commandId: "regenerate" }, thread.id, source.id)).resource;
    expect(regenerate.regeneratedFromTurnId).toBe(source.id);
    const snapshot = await service.getThread({ actor, commandId: "read" }, thread.id);
    expect(snapshot.items.filter((item) => item.type === "message" && item.role === "user").map((item) => item.type === "message" ? item.content : [])).toEqual([
      [{ type: "text", text: "Again" }],
      [{ type: "text", text: "Again" }],
      [{ type: "text", text: "Again" }],
    ]);
  });

  test("persists drafts, share links, exports, retention, holds, audit, and purge receipts", async () => {
    const { service } = createFixture();
    const thread = (await service.createThread({ actor, commandId: "create" })).resource;
    const draft = (await service.saveDraft({ actor, commandId: "draft" }, { threadId: thread.id, content: [{ type: "text", text: "unsent" }] })).resource;
    expect((await service.getDraft({ actor, commandId: "draft-read" }, thread.id)?.then((value) => value?.version))).toBe(draft.version);
    const link = (await service.createShareLink({ actor, commandId: "share" }, { threadId: thread.id, tokenDigest: "sha256:secret", role: "viewer" })).resource;
    expect((await service.revokeAccess({ actor, commandId: "revoke" }, thread.id, link.id)).resource.revokedAt).toBeDefined();
    expect((await service.createExport({ actor, commandId: "export" }, { threadId: thread.id, format: "dromio-json", includeAudit: true })).resource.status).toBe("queued");
    expect((await service.setRetentionPolicy({ actor, commandId: "retention" }, { retainForDays: 30, deleteAfterDays: 90 })).resource.deleteAfterDays).toBe(90);
    const hold = (await service.placeLegalHold({ actor, commandId: "hold" }, { threadId: thread.id, reason: "case-1" })).resource;
    expect(service.deleteThread({ actor, commandId: "delete" }, thread.id)).rejects.toMatchObject({ code: "retention_locked" });
    await service.releaseLegalHold({ actor, commandId: "release" }, thread.id, hold.id);
    expect((await service.deleteThread({ actor, commandId: "delete" }, thread.id)).resource.status).toBe("deleting");
    const purge = (await service.purgeThread({ actor, commandId: "purge" }, thread.id)).resource;
    expect(purge.propagationTargets).toEqual(["context", "search", "files", "execution", "cache"]);
    expect(purge.status).toBe("pending");
    expect((await service.getThread({ actor, commandId: "read" }, thread.id)).thread.status).toBe("purged");
    expect((await service.getPurgeReceipt({ actor, commandId: "receipt" }, thread.id))?.id).toBe(purge.id);
    expect(await service.listAudit({ actor, commandId: "audit" }, thread.id)).not.toHaveLength(0);
  });

  test("permanently deduplicates governance, tool, and usage commands", async () => {
    const { service } = createFixture();
    const thread = (await service.createThread({ actor, commandId: "create" })).resource;
    const turn = (await service.createTurn(
      { actor, commandId: "send" },
      { threadId: thread.id, content: [{ type: "text", text: "Run it" }] },
    )).resource;
    await service.transitionTurn(
      { actor, commandId: "start" },
      { threadId: thread.id, turnId: turn.id, status: "running" },
    );

    const shareContext = { actor, commandId: "share", idempotencyKey: "share-once" };
    const shareInput = { threadId: thread.id, tokenDigest: "sha256:once", role: "viewer" as const };
    const firstShare = await service.createShareLink(shareContext, shareInput);
    const replayedShare = await service.createShareLink(
      { ...shareContext, commandId: "share-retry" },
      shareInput,
    );
    expect(replayedShare).toMatchObject({ replayed: true, resource: { id: firstShare.resource.id } });

    const toolContext = { actor, commandId: "tool", idempotencyKey: "tool-once" };
    const toolInput = {
      threadId: thread.id,
      turnId: turn.id,
      toolId: "browser.navigate",
      arguments: { url: "https://example.com" },
      effect: "read_only" as const,
      recoveryPolicy: "automatic_retry" as const,
    };
    const firstTool = await service.startToolCall(toolContext, toolInput);
    const replayedTool = await service.startToolCall(
      { ...toolContext, commandId: "tool-retry" },
      toolInput,
    );
    expect(replayedTool).toMatchObject({ replayed: true, resource: { id: firstTool.resource.id } });

    const usageContext = { actor, commandId: "usage", idempotencyKey: "usage-once" };
    const usageInput = {
      threadId: thread.id,
      turnId: turn.id,
      runId: "run-1",
      attemptId: "attempt-1",
      providerId: "provider-1",
      inputTokens: 10,
      outputTokens: 5,
      status: "final" as const,
    };
    const firstUsage = await service.recordUsage(usageContext, usageInput);
    const replayedUsage = await service.recordUsage(
      { ...usageContext, commandId: "usage-retry" },
      usageInput,
    );
    expect(replayedUsage.id).toBe(firstUsage.id);
    expect(await service.listUsage({ actor, commandId: "usage-read" }, thread.id)).toHaveLength(1);
  });

  test("rejects unsafe automatic recovery policies for side-effecting tools", async () => {
    const { service } = createFixture(); const thread = (await service.createThread({ actor, commandId: "create" })).resource;
    const turn = (await service.createTurn({ actor, commandId: "send" }, { threadId: thread.id, content: [{ type: "text", text: "Charge it" }] })).resource;
    await service.transitionTurn({ actor, commandId: "start" }, { threadId: thread.id, turnId: turn.id, status: "running" });
    const base = { threadId: thread.id, turnId: turn.id, toolId: "payments.charge", arguments: { amount: 100 }, recoveryPolicy: "automatic_retry" as const };
    expect(service.startToolCall({ actor, commandId: "unsafe" }, { ...base, effect: "non_idempotent" })).rejects.toMatchObject({ code: "validation_failed" });
    expect(service.startToolCall({ actor, commandId: "missing-key" }, { ...base, effect: "idempotent" })).rejects.toMatchObject({ code: "validation_failed" });
    const safe = await service.startToolCall({ actor, commandId: "safe" }, { ...base, effect: "idempotent", idempotencyKey: "charge-order-1" });
    expect(safe.resource).toMatchObject({ effect: "idempotent", recoveryPolicy: "automatic_retry", idempotencyKey: "charge-order-1" });
  });

  test("rejects expired and superseded execution attempts at the thread boundary", async () => {
    const { service } = createFixture();
    const thread = (await service.createThread({ actor, commandId: "create" })).resource;
    const turn = (await service.createTurn(
      { actor, commandId: "send" },
      { threadId: thread.id, content: [{ type: "text", text: "Fence me" }] },
    )).resource;
    const attemptOne = {
      runId: "run-1",
      attemptId: "attempt-1",
      fencingToken: 1,
      leaseExpiresAt: "2027-01-01T00:00:00.000Z",
    };
    await service.transitionTurn(
      { actor, commandId: "claim-1", execution: attemptOne },
      { threadId: thread.id, turnId: turn.id, status: "running" },
    );
    await service.transitionTurn(
      { actor, commandId: "wait-1", execution: attemptOne },
      { threadId: thread.id, turnId: turn.id, status: "waiting_for_input" },
    );
    const attemptTwo = { ...attemptOne, attemptId: "attempt-2", fencingToken: 2 };
    await service.transitionTurn(
      { actor, commandId: "claim-2", execution: attemptTwo },
      { threadId: thread.id, turnId: turn.id, status: "running" },
    );
    expect(service.appendAssistantOutput(
      { actor, commandId: "stale-output", execution: attemptOne },
      { threadId: thread.id, turnId: turn.id, text: "stale" },
    )).rejects.toMatchObject({ code: "stale_execution_attempt" });
    expect(service.appendAssistantOutput(
      { actor, commandId: "expired-output", execution: { ...attemptTwo, leaseExpiresAt: "2025-01-01T00:00:00.000Z" } },
      { threadId: thread.id, turnId: turn.id, text: "expired" },
    )).rejects.toMatchObject({ code: "stale_execution_attempt" });
  });

  test("returns typed steering capability errors and atomically records supported steering", async () => {
    const unsupported = createFixture(); const thread = (await unsupported.service.createThread({ actor, commandId: "create" })).resource; const turn = (await unsupported.service.createTurn({ actor, commandId: "send" }, { threadId: thread.id, content: [{ type: "text", text: "start" }] })).resource; await unsupported.service.transitionTurn({ actor, commandId: "start" }, { threadId: thread.id, turnId: turn.id, status: "running" }); expect(unsupported.service.steerTurn({ actor, commandId: "steer" }, { threadId: thread.id, turnId: turn.id, content: [{ type: "text", text: "change course" }] })).rejects.toMatchObject({ code: "steering_not_supported" });
    const store = new MemoryThreadStore(); let id = 0; const service = new ThreadService({ store, steeringSupported: true, ids: { create: (kind) => `${kind}-${++id}` } }); const supportedThread = (await service.createThread({ actor, commandId: "supported-create" })).resource; const supportedTurn = (await service.createTurn({ actor, commandId: "supported-send" }, { threadId: supportedThread.id, content: [{ type: "text", text: "start" }] })).resource; await service.transitionTurn({ actor, commandId: "supported-start" }, { threadId: supportedThread.id, turnId: supportedTurn.id, status: "running" }); const steerContext = { actor, commandId: "supported-steer", idempotencyKey: "steer-once" }; const steerInput = { threadId: supportedThread.id, turnId: supportedTurn.id, content: [{ type: "text" as const, text: "change course" }] }; const steered = await service.steerTurn(steerContext, steerInput); const replayed = await service.steerTurn({ ...steerContext, commandId: "supported-steer-retry" }, steerInput); expect(steered.resource).toMatchObject({ role: "user", turnId: supportedTurn.id }); expect(replayed).toMatchObject({ replayed: true, resource: { id: steered.resource.id } }); expect((await store.readOutbox(100, "execution.commands")).at(-1)?.payload.operation).toBe("steer_thread_turn");
  });
});

async function approvalTool(
  service: ThreadService,
  threadId: string,
  turnId: string,
  toolId: string,
  args: Record<string, string>,
): Promise<{ readonly id: string; readonly argumentsDigest: string }> {
  const tool = await service.startToolCall(
    { actor, commandId: `tool-${toolId}-${crypto.randomUUID()}` },
    { threadId, turnId, toolId, toolVersion: "1", arguments: args, effect: "read_only", recoveryPolicy: "automatic_retry" },
  );
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const argumentsDigest = `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  return { id: tool.resource.id, argumentsDigest };
}
