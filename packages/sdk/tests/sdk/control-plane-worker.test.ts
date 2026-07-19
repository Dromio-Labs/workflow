import { describe, expect, test } from "bun:test";
import type { WorkflowAppRunSnapshot } from "@dromio/workflow/client";
import {
	runTriggerWorker,
	type TriggerJobSnapshot,
	type WorkflowControlPlane,
} from "@dromio/workflow/workflow-control-plane";

describe("workflow control-plane trigger worker", () => {
	test("claims and starts one trigger job", async () => {
		const started: string[] = [];
		const claims: Array<{ leaseMs?: number; workerId: string }> = [];
		const controlPlane = mockControlPlane({
			claimNextTriggerJob: async (input) => {
				claims.push(input);
				return triggerJob("job-1");
			},
			startRunFromTriggerJob: async (jobId) => {
				started.push(jobId);
				return workflowRun(jobId);
			},
		});

		await runTriggerWorker({
			controlPlane,
			leaseMs: 5000,
			once: true,
			workerId: "worker-1",
		});

		expect(claims).toEqual([{ leaseMs: 5000, workerId: "worker-1" }]);
		expect(started).toEqual(["job-1"]);
	});

	test("fails a claimed trigger job when starting the run fails", async () => {
		const failed: Array<{ error: string; jobId: string }> = [];
		const controlPlane = mockControlPlane({
			claimNextTriggerJob: async () => triggerJob("job-failed"),
			failTriggerJob: async (input) => {
				failed.push(input);
				return triggerJob(input.jobId);
			},
			startRunFromTriggerJob: async () => {
				throw new Error("runtime unavailable");
			},
		});

		await runTriggerWorker({
			controlPlane,
			once: true,
			workerId: "worker-1",
		});

		expect(failed).toEqual([
			{
				error: "runtime unavailable",
				jobId: "job-failed",
			},
		]);
	});

	test("heartbeats an active lease while a trigger run is executing", async () => {
		const heartbeats: string[] = [];
		const job = {
			...triggerJob("job-slow"),
			leaseId: "lease-slow",
			lockedUntil: new Date(Date.now() + 150).toISOString(),
			status: "claimed" as const,
		};
		const controlPlane = mockControlPlane({
			claimNextTriggerJob: async () => job,
			heartbeatTriggerJob: async (input) => {
				heartbeats.push(input.leaseId ?? "missing");
				return job;
			},
			startRunFromTriggerJob: async (_jobId, leaseId) => {
				expect(leaseId).toBe("lease-slow");
				await Bun.sleep(420);
				return workflowRun(job.id);
			},
		});

		await runTriggerWorker({ controlPlane, once: true, workerId: "worker-slow" });

		expect(heartbeats.length).toBeGreaterThanOrEqual(2);
		expect(heartbeats.every((leaseId) => leaseId === "lease-slow")).toBe(true);
	});

	test("exits promptly when aborted during polling sleep", async () => {
		const controller = new AbortController();
		let claims = 0;
		const controlPlane = mockControlPlane({
			claimNextTriggerJob: async () => {
				claims += 1;
				return undefined;
			},
		});

		const worker = runTriggerWorker({
			controlPlane,
			intervalMs: 30_000,
			signal: controller.signal,
			workerId: "worker-1",
		});

		await waitUntil(() => claims === 1);
		controller.abort();

		await expect(worker).resolves.toBeUndefined();
		expect(claims).toBe(1);
	});
});

function mockControlPlane(
	input: Partial<WorkflowControlPlane>,
): WorkflowControlPlane {
	return {
		claimNextTriggerJob: async () => undefined,
		enqueueScheduledTriggerOccurrence: async () => {
			throw new Error("No schedule occurrences expected in this worker test.");
		},
		failTriggerJob: async (input) => triggerJob(input.jobId),
		listTriggers: async () => [],
		startRunFromTriggerJob: async (jobId) => workflowRun(jobId),
		...input,
	} as WorkflowControlPlane;
}

function triggerJob(id: string): TriggerJobSnapshot {
	return {
		attempts: 0,
		availableAt: "2026-05-10T00:00:00.000Z",
		createdAt: "2026-05-10T00:00:00.000Z",
		id,
		kind: "trigger",
		maxAttempts: 3,
		occurrenceId: "occ-worker",
		payload: {
			input: {},
			source: "test",
		},
		status: "queued",
		triggerId: "planner.request",
		updatedAt: "2026-05-10T00:00:00.000Z",
		workflowId: "planner",
	};
}

function workflowRun(jobId: string): WorkflowAppRunSnapshot {
	return {
		artifacts: [],
		events: [],
		input: "{}",
		origin: {
			triggerJobId: jobId,
			type: "manual",
		},
		pendingQuestions: [],
		runId: `run-${jobId}`,
		status: "completed",
		workflowId: "planner",
	};
}

async function waitUntil(predicate: () => boolean): Promise<void> {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > 1000) {
			throw new Error("Timed out waiting for condition.");
		}
		await new Promise((resolve) => {
			setTimeout(resolve, 1);
		});
	}
}
