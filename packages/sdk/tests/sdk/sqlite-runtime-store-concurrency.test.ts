import { describe, expect, test } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSqliteWorkflowRuntimeStore } from "../../src/sdk/workflow-control-plane/sqlite-runtime-store.js";

const NOW = "2026-07-22T00:00:00.000Z";
const CLAIM_COUNT = 500;
const DATASET_ROWS_PER_WORKER = 125;
const WORKER_COUNT = 4;

describe("SQLite workflow runtime store concurrency", () => {
	test("independent worker processes claim each trigger job exactly once", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "dromio-sqlite-claims-"));
		try {
			const databasePath = path.join(directory, "runtime.sqlite");
			const store = createSqliteWorkflowRuntimeStore(databasePath);
			for (let index = 0; index < CLAIM_COUNT; index += 1) {
				await store.enqueueTriggerJob({
					availableAt: NOW,
					createdAt: new Date(Date.parse(NOW) + index).toISOString(),
					id: `job-${index}`,
					maxAttempts: 3,
					occurrenceId: `occurrence-${index}`,
					payload: { input: { index }, source: "test" },
					status: "queued",
					triggerId: "concurrency.trigger",
					updatedAt: NOW,
					workflowId: "concurrency",
				});
			}

			const workers = Array.from({ length: WORKER_COUNT }, (_, index) =>
				startWorker<string[]>("sqlite-trigger-claim-worker.ts", databasePath, `worker-${index}`),
			);
			await Promise.all(workers.map((worker) => worker.ready));
			for (const worker of workers) worker.process.stdin.end("claim\n");

			const results = await Promise.all(workers.map((worker) => worker.result));
			const ids = results.flatMap((result) => result.claimed);
			expect(results.map((result) => result.exitCode)).toEqual(
				Array.from({ length: WORKER_COUNT }, () => 0),
			);
			expect(new Set(ids).size).toBe(CLAIM_COUNT);
			expect(ids).toHaveLength(CLAIM_COUNT);
			const stored = await store.listTriggerJobs({ status: "claimed" });
			expect(stored).toHaveLength(CLAIM_COUNT);
			expect(stored.every((job) => job.attempts === 1)).toBe(true);
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	}, 15_000);

	test("independent worker processes claim each signal delivery once per active lease", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "dromio-sqlite-signals-"));
		try {
			const databasePath = path.join(directory, "runtime.sqlite");
			const store = createSqliteWorkflowRuntimeStore(databasePath);
			for (let index = 0; index < CLAIM_COUNT; index += 1) {
				const createdAt = new Date(Date.parse(NOW) + index).toISOString();
				await store.putSignalOccurrence({
					correlation: { claim: "shared" },
					correlationHash: "shared-correlation",
					createdAt,
					id: `signal-occurrence-${index}`,
					idempotencyKey: `signal-key-${index}`,
					occurredAt: createdAt,
					payload: { index },
					payloadHash: `payload-${index}`,
					signalId: "concurrency.signal",
					updatedAt: createdAt,
				});
			}
			await store.syncSignalWaits({
				now: NOW,
				runId: "concurrency-signal-run",
				waits: Array.from({ length: CLAIM_COUNT }, (_, index) => {
					const createdAt = new Date(Date.parse(NOW) + index).toISOString();
					return {
						contractFingerprint: "concurrency-contract",
						correlation: { claim: "shared" },
						correlationHash: "shared-correlation",
						createdAt,
						runId: "concurrency-signal-run",
						signalId: "concurrency.signal",
						status: "pending" as const,
						stepId: `signal-step-${index}`,
						token: `signal-wait-${index}`,
						updatedAt: createdAt,
					};
				}),
			});

			const workers = Array.from({ length: WORKER_COUNT }, (_, index) =>
				startWorker<SignalClaim[]>("sqlite-signal-claim-worker.ts", databasePath, `signal-worker-${index}`),
			);
			await Promise.all(workers.map((worker) => worker.ready));
			for (const worker of workers) worker.process.stdin.end("claim\n");

			const results = await Promise.all(workers.map((worker) => worker.result));
			const claims = results.flatMap((result) => result.claimed);
			expect(results.map((result) => result.exitCode)).toEqual(
				Array.from({ length: WORKER_COUNT }, () => 0),
			);
			expect(claims).toHaveLength(CLAIM_COUNT);
			expect(new Set(claims.map((claim) => claim.occurrenceId)).size).toBe(CLAIM_COUNT);
			expect(new Set(claims.map((claim) => claim.waitToken)).size).toBe(CLAIM_COUNT);
			expect(claims.every((claim) => claim.attempts === 1)).toBe(true);
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	}, 15_000);

	test("independent processes upsert dataset rows without snapshot-upgrade failures", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "dromio-sqlite-datasets-"));
		try {
			const databasePath = path.join(directory, "runtime.sqlite");
			const store = createSqliteWorkflowRuntimeStore(databasePath);
			await store.upsertDatasetRows?.({
				key: ["ownerId", "itemId"],
				name: "concurrency_items",
				rows: [],
				schemaFingerprint: "concurrency-items-v1",
				version: 1,
			});

			const workers = Array.from({ length: WORKER_COUNT }, (_, index) =>
				startWorker<{ inserted: number; updated: number }>(
					"sqlite-dataset-upsert-worker.ts",
					databasePath,
					`dataset-worker-${index}`,
				),
			);
			await Promise.all(workers.map((worker) => worker.ready));
			for (const worker of workers) worker.process.stdin.end("upsert\n");

			const results = await Promise.all(workers.map((worker) => worker.result));
			expect(results.map((result) => result.exitCode)).toEqual(
				Array.from({ length: WORKER_COUNT }, () => 0),
			);
			expect(results.map((result) => result.claimed)).toEqual(
				Array.from({ length: WORKER_COUNT }, () => ({ inserted: DATASET_ROWS_PER_WORKER, updated: 0 })),
			);
			const rows = await store.queryDatasetRows?.({
				key: ["ownerId", "itemId"],
				name: "concurrency_items",
				schemaFingerprint: "concurrency-items-v1",
				version: 1,
			}, { limit: WORKER_COUNT * DATASET_ROWS_PER_WORKER });
			expect(rows).toHaveLength(WORKER_COUNT * DATASET_ROWS_PER_WORKER);
			expect(new Set(rows?.map((row) => row.itemId)).size).toBe(WORKER_COUNT * DATASET_ROWS_PER_WORKER);
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	}, 15_000);
});

type SignalClaim = { attempts: number; occurrenceId: string; waitToken: string };

function startWorker<Claim>(fixture: string, databasePath: string, workerId: string): {
	process: ChildProcessWithoutNullStreams;
	ready: Promise<void>;
	result: Promise<{ claimed: Claim; exitCode: number }>;
} {
	const child = spawn(process.execPath, [
		path.join(import.meta.dir, "fixtures", fixture),
		databasePath,
		workerId,
		NOW,
	]);
	let stdout = "";
	let stderr = "";
	let markReady: (() => void) | undefined;
	let failReady: ((error: Error) => void) | undefined;
	const ready = new Promise<void>((resolve, reject) => {
		markReady = resolve;
		failReady = reject;
	});
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		stdout += chunk;
		if (stdout.startsWith("ready\n")) markReady?.();
	});
	child.stderr.on("data", (chunk: string) => {
		stderr += chunk;
	});
	const result = new Promise<{ claimed: Claim; exitCode: number }>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code) => {
			const exitCode = code ?? -1;
			if (!stdout.startsWith("ready\n")) {
				failReady?.(new Error(`Worker ${workerId} exited before ready: ${stderr}`));
			}
			if (exitCode !== 0) {
				reject(new Error(`Worker ${workerId} exited ${exitCode}: ${stderr}`));
				return;
			}
			const payload = stdout.slice("ready\n".length).trim();
			resolve({ claimed: JSON.parse(payload) as Claim, exitCode });
		});
	});
	return { process: child, ready, result };
}
