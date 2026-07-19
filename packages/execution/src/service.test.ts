import { describe, expect, test } from "bun:test";
import { MemoryExecutionStore } from "./memory-store.js";
import { ExecutionService } from "./service.js";

function fixture() {
	let now = new Date("2026-01-01T00:00:00Z");
	let id = 0;
	const store = new MemoryExecutionStore();
	const service = new ExecutionService({
		store,
		clock: { now: () => now },
		ids: { create: (kind) => `${kind}-${++id}` },
	});
	return {
		service,
		store,
		advance: (ms: number) => {
			now = new Date(now.getTime() + ms);
		},
	};
}

const input = {
	tenantId: "tenant-1",
	applicationId: "app-1",
	sourceType: "thread_turn" as const,
	sourceId: "turn-1",
	idempotencyKey: "turn-1-generation-1",
	correlationId: "correlation-1",
	requestId: "request-1",
	commandId: "command-1",
};

describe("ExecutionService", () => {
	test("deduplicates enqueue and claims with a fencing token", async () => {
		const { service } = fixture();
		const first = await service.enqueue(input);
		expect((await service.enqueue(input)).id).toBe(first.id);
		const claim = await service.claim({
			workerId: "worker-1",
			queues: ["default"],
			leaseMs: 1_000,
		});
		expect(claim?.attempt.fencingToken).toBe(1);
	});

	test("recovers expired leases and rejects the stale worker", async () => {
		const { service, advance } = fixture();
		const run = await service.enqueue(input);
		const first = await service.claim({
			workerId: "worker-1",
			queues: ["default"],
			leaseMs: 1_000,
		});
		advance(1_001);
		const second = await service.claim({
			workerId: "worker-2",
			queues: ["default"],
			leaseMs: 1_000,
		});

		expect(second?.attempt.fencingToken).toBe(2);
		expect(
			service.complete(run.id, first!.attempt.id, first!.attempt.fencingToken),
		).rejects.toMatchObject({ code: "stale_fence" });
	});

	test("releases compute at a waitpoint and resumes the same run", async () => {
		const { service } = fixture();
		const run = await service.enqueue(input);
		const claim = await service.claim({
			workerId: "worker-1",
			queues: ["default"],
			leaseMs: 1_000,
		});
		const waiting = await service.wait(
			run.id,
			claim!.attempt.id,
			claim!.attempt.fencingToken,
			{
				type: "approval",
				key: "approval-1",
				continuationToken: "continuation-1",
			},
		);
		expect(waiting.status).toBe("waiting");
		expect(await service.resume(run.id, "approval-1")).toMatchObject({
			status: "queued",
			resumedFrom: {
				waitpoint: { key: "approval-1", continuationToken: "continuation-1" },
			},
		});
	});

	test("retries retryable failures with bounded backoff", async () => {
		const { service, advance } = fixture();
		const run = await service.enqueue({ ...input, maxAttempts: 2 });
		const claim = await service.claim({
			workerId: "worker-1",
			queues: ["default"],
			leaseMs: 1_000,
		});
		const retry = await service.fail(
			run.id,
			claim!.attempt.id,
			claim!.attempt.fencingToken,
			"provider_unavailable",
			true,
		);
		expect(retry.status).toBe("queued");
		expect(
			await service.claim({
				workerId: "worker-2",
				queues: ["default"],
				leaseMs: 1_000,
			}),
		).toBeUndefined();
		advance(1_000);
		expect(
			(
				await service.claim({
					workerId: "worker-2",
					queues: ["default"],
					leaseMs: 1_000,
				})
			)?.attempt.number,
		).toBe(2);
	});

	test("enforces concurrency keys while a run owns compute", async () => {
		const { service } = fixture();
		await service.enqueue({ ...input, concurrencyKey: "thread-1" });
		await service.enqueue({
			...input,
			sourceId: "turn-2",
			idempotencyKey: "turn-2",
			concurrencyKey: "thread-1",
		});
		await service.claim({
			workerId: "worker-1",
			queues: ["default"],
			leaseMs: 1_000,
		});
		expect(
			await service.claim({
				workerId: "worker-2",
				queues: ["default"],
				leaseMs: 1_000,
			}),
		).toBeUndefined();
	});

	test("durably deduplicates steering signals on the active run", async () => {
		const { service } = fixture();
		const run = await service.enqueue(input);
		await service.claim({
			workerId: "worker-1",
			queues: ["default"],
			leaseMs: 1_000,
		});
		const signal = await service.signal(run.id, {
			commandId: "steer-1",
			type: "steer",
			payload: { itemId: "item-1" },
		});
		expect(
			await service.signal(run.id, {
				commandId: "steer-1",
				type: "steer",
				payload: { itemId: "item-1" },
			}),
		).toEqual(signal);
		expect(await service.listSignals(run.id)).toEqual([signal]);
	});
});
