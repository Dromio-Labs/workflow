import { expect, test } from "bun:test";
import { ExecutionService, MemoryExecutionStore } from "@dromio/execution";
import type { DromioActorContextV1 } from "@dromio/protocols";
import { MemoryThreadStore, ThreadService, type ThreadStore } from "@dromio/thread-service";
import { TriggerService } from "./service.js";
import { ThreadExecutionDispatcher } from "./thread-dispatcher.js";
import { MemoryTriggerStore } from "./types.js";

test("thread execution outbox maps through chat Trigger into one durable run", async () => {
	const actor: DromioActorContextV1 = {
		schemaVersion: "dromio.actor-context.v1",
		subject: { type: "user", id: "user-1" },
		tenantId: "tenant-1",
		applicationId: "app-1",
		roles: [],
		groupIds: [],
	};
	const store = new MemoryThreadStore();
	const threads = new ThreadService({ store, steeringSupported: true });
	const execution = new ExecutionService({ store: new MemoryExecutionStore() });
	const triggerStore = new MemoryTriggerStore();
	const triggers = new TriggerService({ store: triggerStore, execution });
	const dispatcher = new ThreadExecutionDispatcher({
		store,
		triggers,
		execution,
	});
	const lineage = {
		correlationId: "correlation-1",
		requestId: "request-1",
		source: "chat" as const,
	};
	const thread = (
		await threads.createThread({
			actor,
			commandId: "command-create",
			...lineage,
		})
	).resource;
	const turn = (
		await threads.createTurn(
			{ actor, commandId: "command-send", ...lineage },
			{ threadId: thread.id, content: [{ type: "text", text: "Hello" }] },
		)
	).resource;
	const snapshot = await threads.getThread(
		{ actor, commandId: "read" },
		thread.id,
	);
	expect(snapshot.thread.provenance).toMatchObject({
		correlationId: "correlation-1",
		requestId: "request-1",
		commandId: "command-create",
		threadId: thread.id,
	});
	expect(snapshot.items[0]?.provenance).toMatchObject({
		correlationId: "correlation-1",
		requestId: "request-1",
		commandId: "command-send",
		threadId: thread.id,
		turnId: turn.id,
		itemId: snapshot.items[0]?.id,
	});
	expect(turn.provenance).toMatchObject({
		correlationId: "correlation-1",
		requestId: "request-1",
		commandId: "command-send",
		threadId: thread.id,
		turnId: turn.id,
	});
	const turnEvents = await store.readThreadEvents(actor, thread.id, 1, 10);
	expect(
		turnEvents.every(
			(event) =>
				event.correlationId === "correlation-1" &&
				event.requestId === "request-1" &&
				event.commandId === "command-send",
		),
	).toBe(true);
	expect(await dispatcher.dispatchPending()).toBe(1);
	expect(await dispatcher.dispatchPending()).toBe(0);
	const receipt = await triggerStore.getReceipt(
		actor.tenantId,
		actor.applicationId,
		"command-send",
	);
	expect(receipt?.occurrence).toMatchObject({
		correlationId: "correlation-1",
		requestId: "request-1",
		commandId: "command-send",
	});
	const run = (await execution.listRuns())[0];
	if (!run) throw new Error("Expected a thread execution run.");
	expect(run).toMatchObject({
		sourceId: turn.id,
		correlationId: "correlation-1",
		requestId: "request-1",
		commandId: "command-send",
		concurrencyKey: thread.id,
		payload: { threadId: thread.id, turnId: turn.id },
	});
	const claim = await execution.claim({
		workerId: "worker-1",
		queues: ["default"],
		leaseMs: 30_000,
	});
	expect(claim?.attempt).toMatchObject({
		runId: run.id,
		correlationId: "correlation-1",
	});
	await threads.transitionTurn(
		{ actor, commandId: "run" },
		{
			threadId: thread.id,
			turnId: turn.id,
			status: "running",
			executionRunId: run.id,
		},
	);
	const steering = await threads.steerTurn(
		{ actor, commandId: "steer" },
		{
			threadId: thread.id,
			turnId: turn.id,
			content: [{ type: "text", text: "Prioritize safety" }],
		},
	);
	expect(await dispatcher.dispatchPending()).toBe(1);
	expect(await execution.listSignals(run.id)).toMatchObject([
		{
			commandId: "steer",
			type: "steer",
			payload: { itemId: steering.resource.id },
		},
	]);
	expect(await dispatcher.dispatchPending()).toBe(0);
	await threads.cancelTurn({ actor, commandId: "cancel" }, thread.id, turn.id);
	expect(await dispatcher.dispatchPending()).toBe(1);
	expect(await execution.getRun(run.id)).toMatchObject({ status: "cancelling" });
});

test("redelivers an outbox entry after dispatch succeeds but publication crashes", async () => {
	const actor: DromioActorContextV1 = { schemaVersion: "dromio.actor-context.v1", subject: { type: "user", id: "user-1" }, tenantId: "tenant-1", applicationId: "app-1", roles: [], groupIds: [] };
	const store = new MemoryThreadStore(); const threads = new ThreadService({ store }); const execution = new ExecutionService({ store: new MemoryExecutionStore() }); const triggerStore = new MemoryTriggerStore(); const triggers = new TriggerService({ store: triggerStore, execution });
	const thread = (await threads.createThread({ actor, commandId: "create" })).resource; await threads.createTurn({ actor, commandId: "send" }, { threadId: thread.id, content: [{ type: "text", text: "Hello" }] });
	let failPublication = true;
	const crashStore = new Proxy(store, { get(target, property, receiver) { if (property === "markOutboxPublished") return async () => { if (failPublication) { failPublication = false; throw new Error("simulated publication crash"); } }; const value = Reflect.get(target, property, receiver) as unknown; return typeof value === "function" ? value.bind(target) : value; } }) as ThreadStore;
	const crashing = new ThreadExecutionDispatcher({ store: crashStore, triggers, execution });
	expect(crashing.dispatchPending()).rejects.toThrow("simulated publication crash");
	expect(await execution.listRuns()).toHaveLength(1); expect(await store.readOutbox(10, "execution.commands")).toHaveLength(1);
	const recovered = new ThreadExecutionDispatcher({ store, triggers, execution }); expect(await recovered.dispatchPending()).toBe(1); expect(await recovered.dispatchPending()).toBe(0); expect(await execution.listRuns()).toHaveLength(1);
});
