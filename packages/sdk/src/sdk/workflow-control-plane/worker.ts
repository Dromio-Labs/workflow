import { Effect } from "effect";
import {
	requireTimerJobPayload,
} from "./timer-jobs.js";
import {
	runScheduleTriggerPass,
} from "./schedule-loop.js";
import type {
	Clock,
	TriggerJobSnapshot,
	WorkflowControlPlane,
} from "./types.js";

export type RunTriggerWorkerInput = {
	clock?: Clock;
	controlPlane: WorkflowControlPlane;
	disableScheduleLoop?: boolean;
	intervalMs?: number;
	leaseMs?: number;
	once?: boolean;
	signal?: AbortSignal;
	workerId: string;
};

export async function runTriggerWorker(
	input: RunTriggerWorkerInput,
): Promise<void> {
	await Effect.runPromise(runTriggerWorkerEffect(input));
}

function runTriggerWorkerEffect(
	input: RunTriggerWorkerInput,
): Effect.Effect<void, Error> {
	const intervalMs = input.intervalMs ?? 1_000;
	return Effect.gen(function* () {
		while (!input.signal?.aborted) {
			const job = yield* Effect.tryPromise({
				catch: toError,
				try: () =>
					input.controlPlane.claimNextTriggerJob({
						leaseMs: input.leaseMs,
						workerId: input.workerId,
					}),
			});
			if (!job) {
				yield* runSchedulePassEffect(input);
				if (input.once) return;
				yield* sleepUntilNextPoll(intervalMs, input.signal);
				continue;
			}
				yield* Effect.tryPromise({
				catch: toError,
				try: () =>
					dispatchTriggerJob({
						clock: input.clock,
						controlPlane: input.controlPlane,
						job,
					}),
			}).pipe(
				Effect.catchAll((error) =>
					Effect.tryPromise({
						catch: toError,
						try: () =>
							input.controlPlane.failTriggerJob({
								error: error.message,
								jobId: job.id,
								...(job.leaseId ? { leaseId: job.leaseId } : {}),
							}),
					}),
				),
			);
			yield* runSchedulePassEffect(input);
			if (input.once) return;
		}
	});
}

function runSchedulePassEffect(
	input: RunTriggerWorkerInput,
): Effect.Effect<void, Error> {
	if (input.disableScheduleLoop) return Effect.void;
	return Effect.tryPromise({
		catch: toError,
		try: () =>
			runScheduleTriggerPass({
				clock: input.clock,
				controlPlane: input.controlPlane,
			}),
	});
}

export async function dispatchTriggerJob(input: {
	clock?: Clock;
	controlPlane: WorkflowControlPlane;
	job: TriggerJobSnapshot;
}): Promise<void> {
	if (input.job.kind !== "timer") {
		await withJobHeartbeat(input, () =>
			input.controlPlane.startRunFromTriggerJob(input.job.id, input.job.leaseId)
		);
		return;
	}
	await dispatchTimerJob(input);
}

async function dispatchTimerJob(input: {
	clock?: Clock;
	controlPlane: WorkflowControlPlane;
	job: TriggerJobSnapshot;
}): Promise<void> {
	const payload = requireTimerJobPayload(input.job.payload);
	const firedAt = (input.clock?.now() ?? new Date()).toISOString();
	try {
		const run = await input.controlPlane.resumeHook({
			token: payload.token,
			value: { firedAt },
		});
		await input.controlPlane.completeTriggerJob({
			jobId: input.job.id,
			leaseId: input.job.leaseId,
			runId: run.runId,
		});
	} catch (error) {
		if (!isTimerNoopError(error)) throw error;
		await input.controlPlane.completeTriggerJob({
			jobId: input.job.id,
			leaseId: input.job.leaseId,
			reason: timerNoopReason(error),
			runId: payload.runId,
		});
	}
}

async function withJobHeartbeat<Result>(
	input: { controlPlane: WorkflowControlPlane; job: TriggerJobSnapshot },
	run: () => Promise<Result>,
): Promise<Result> {
	const heartbeat = input.controlPlane.heartbeatTriggerJob;
	if (!heartbeat) return await run();
	const leaseMs = input.job.lockedUntil
		? Math.max(1_000, Date.parse(input.job.lockedUntil) - Date.now())
		: 30_000;
	const intervalMs = Math.max(100, Math.floor(leaseMs / 3));
	let heartbeatError: Error | undefined;
	await heartbeat({
		jobId: input.job.id,
		...(input.job.leaseId ? { leaseId: input.job.leaseId } : {}),
		leaseMs,
	});
	const timer = setInterval(() => {
		void heartbeat({
			jobId: input.job.id,
			...(input.job.leaseId ? { leaseId: input.job.leaseId } : {}),
			leaseMs,
		}).catch((cause) => {
			heartbeatError = toError(cause);
		});
	}, intervalMs);
	timer.unref?.();
	try {
		const result = await run();
		if (heartbeatError) throw heartbeatError;
		return result;
	} finally {
		clearInterval(timer);
	}
}

function sleepUntilNextPoll(
	ms: number,
	externalSignal?: AbortSignal,
): Effect.Effect<void> {
	if (externalSignal?.aborted) return Effect.void;
	return Effect.async<void>((resume, signal) => {
		let settled = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const cleanup = () => {
			if (timeout) clearTimeout(timeout);
			externalSignal?.removeEventListener("abort", abort);
			signal.removeEventListener("abort", abort);
		};
		const settle = () => {
			if (settled) return;
			settled = true;
			cleanup();
			resume(Effect.void);
		};
		const abort = () => {
			settle();
		};
		timeout = setTimeout(settle, ms);
		timeout.unref?.();
		externalSignal?.addEventListener("abort", abort, { once: true });
		signal.addEventListener("abort", abort, { once: true });

		return Effect.sync(cleanup);
	});
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function isTimerNoopError(error: unknown): boolean {
	const code = errorCode(error);
	return code === "HOOK_CONSUMED" ||
		code === "HOOK_NOT_FOUND" ||
		code === "RUN_NOT_FOUND" ||
		code === "RUN_NOT_RESUMABLE";
}

function timerNoopReason(error: unknown): string {
	const code = errorCode(error);
	return code ? `Timer resume skipped: ${code}.` : "Timer resume skipped.";
}

function errorCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" ? code : undefined;
}
