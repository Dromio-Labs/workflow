import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ExecutionService } from "./service.js";
import { SqliteExecutionStore } from "./sqlite-store.js";

test("SQLite execution state, attempts, and fencing survive restart", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "dromio-execution-"));
	const file = path.join(root, "execution.sqlite");
	let id = 0;
	try {
		const firstDb = new Database(file);
		const first = new ExecutionService({
			store: new SqliteExecutionStore(firstDb),
			ids: { create: (kind) => `${kind}-${++id}` },
		});
		const lineage = {
			correlationId: "correlation-1",
			requestId: "request-1",
			commandId: "command-1",
		};
		const run = await first.enqueue({
			tenantId: "tenant-1",
			applicationId: "app-1",
			sourceType: "thread_turn",
			sourceId: "turn-1",
			idempotencyKey: "turn-1",
			...lineage,
		});
		const claim = await first.claim({
			workerId: "worker-1",
			queues: ["default"],
			leaseMs: 1,
		});
		expect(claim?.attempt.fencingToken).toBe(1);
		await first.signal(run.id, {
			commandId: "steer-1",
			type: "steer",
			payload: { itemId: "item-1" },
		});
		firstDb.close();
		const secondDb = new Database(file);
		const second = new ExecutionService({
			store: new SqliteExecutionStore(secondDb),
			ids: { create: (kind) => `${kind}-${++id}` },
			clock: { now: () => new Date(Date.now() + 60_000) },
		});
		expect(
			(
				await second.enqueue({
					tenantId: "tenant-1",
					applicationId: "app-1",
					sourceType: "thread_turn",
					sourceId: "turn-1",
					idempotencyKey: "turn-1",
					...lineage,
				})
			).id,
		).toBe(run.id);
		expect(await second.listSignals(run.id)).toMatchObject([
			{ commandId: "steer-1", payload: { itemId: "item-1" } },
		]);
		expect(
			(
				await second.claim({
					workerId: "worker-2",
					queues: ["default"],
					leaseMs: 1_000,
				})
			)?.attempt.fencingToken,
		).toBe(2);
		secondDb.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("SQLite preserves an opaque provider continuation across wait and process restart", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "dromio-execution-resume-"));
	const file = path.join(root, "execution.sqlite");
	let id = 0;
	try {
		const firstDb = new Database(file);
		const first = new ExecutionService({
			store: new SqliteExecutionStore(firstDb),
			ids: { create: (kind) => `${kind}-${++id}` },
		});
		const run = await first.enqueue({
			tenantId: "tenant-1",
			applicationId: "app-1",
			sourceType: "thread_turn",
			sourceId: "turn-resume",
			idempotencyKey: "turn-resume",
			correlationId: "correlation-resume",
			requestId: "request-resume",
			commandId: "command-resume",
		});
		const claim = await first.claim({
			workerId: "worker-1",
			queues: ["default"],
			leaseMs: 30_000,
		});
		await first.wait(run.id, claim!.attempt.id, claim!.attempt.fencingToken, {
			key: "approval-1",
			type: "approval",
			continuationToken: "opaque-provider-continuation",
		});
		firstDb.close();

		const secondDb = new Database(file);
		const second = new ExecutionService({
			store: new SqliteExecutionStore(secondDb),
			ids: { create: (kind) => `${kind}-${++id}` },
		});
		const resumed = await second.resume(run.id, "approval-1");
		expect(resumed.resumedFrom?.waitpoint.continuationToken).toBe(
			"opaque-provider-continuation",
		);
		expect(
			(
				await second.claim({
					workerId: "worker-2",
					queues: ["default"],
					leaseMs: 30_000,
				})
			)?.run.id,
		).toBe(run.id);
		secondDb.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
