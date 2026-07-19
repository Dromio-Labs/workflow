import type {
	ClaimedExecution,
	EnqueueRunInput,
	ExecutionAttempt,
	ExecutionClock,
	ExecutionIdFactory,
	ExecutionRun,
	ExecutionStore,
	ExecutionTransaction,
	ExecutionWaitpoint,
	JsonValue,
} from "./types.js";

export class ExecutionError extends Error {
	constructor(
		readonly code:
			| "not_found"
			| "stale_fence"
			| "invalid_state"
			| "cancellation_requested"
			| "idempotency_conflict",
		message: string,
	) {
		super(message);
		this.name = "ExecutionError";
	}
}

export class ExecutionService {
	private readonly store: ExecutionStore;
	private readonly clock: ExecutionClock;
	private readonly ids: ExecutionIdFactory;

	constructor(options: {
		readonly store: ExecutionStore;
		readonly clock?: ExecutionClock;
		readonly ids?: ExecutionIdFactory;
	}) {
		this.store = options.store;
		this.clock = options.clock ?? { now: () => new Date() };
		this.ids = options.ids ?? {
			create: (kind) => `${kind}_${crypto.randomUUID()}`,
		};
	}

	async getRun(runId: string): Promise<ExecutionRun | undefined> {
		return (await this.store.listRuns()).find((run) => run.id === runId);
	}
	listRuns(): Promise<readonly ExecutionRun[]> {
		return this.store.listRuns();
	}
	listAttempts(runId: string): Promise<readonly ExecutionAttempt[]> {
		return this.store.listAttempts(runId);
	}
	async listSignals(
		runId: string,
		after = 0,
	): Promise<readonly import("./types.js").ExecutionSignal[]> {
		return (
			(await this.getRun(runId))?.signals?.filter(
				(signal) => signal.ordinal > after,
			) ?? []
		);
	}
	purgeThread(threadId: string): Promise<number> {
		return this.store.purgeThread(threadId);
	}

	async enqueue(input: EnqueueRunInput): Promise<ExecutionRun> {
		return this.store.transaction((tx) => {
			const existing = tx.findByIdempotency(
				input.tenantId,
				input.applicationId,
				input.idempotencyKey,
			);
			if (existing) {
				if (
					existing.sourceId !== input.sourceId ||
					existing.sourceType !== input.sourceType
				) {
					throw new ExecutionError(
						"idempotency_conflict",
						"The idempotency key belongs to another execution source.",
					);
				}
				return existing;
			}
			const now = this.clock.now().toISOString();
			const run: ExecutionRun = {
				id: this.ids.create("run"),
				tenantId: input.tenantId,
				applicationId: input.applicationId,
				sourceType: input.sourceType,
				sourceId: input.sourceId,
				idempotencyKey: input.idempotencyKey,
				correlationId: input.correlationId,
				requestId: input.requestId,
				commandId: input.commandId,
				queue: input.queue ?? "default",
				priority: input.priority ?? 0,
				status: "queued",
				maxAttempts: Math.max(1, input.maxAttempts ?? 3),
				attemptCount: 0,
				availableAt: now,
				createdAt: now,
				updatedAt: now,
				...(input.concurrencyKey
					? { concurrencyKey: input.concurrencyKey }
					: {}),
				...(input.payload ? { payload: input.payload } : {}),
			};
			tx.putRun(run);
			return run;
		});
	}

	async claim(input: {
		readonly workerId: string;
		readonly queues: readonly string[];
		readonly leaseMs: number;
	}): Promise<ClaimedExecution | undefined> {
		return this.store.transaction((tx) => {
			const now = this.clock.now();
			expireLeases(tx, now);
			const run = tx
				.listRuns()
				.filter(
					(candidate) =>
						candidate.status === "queued" &&
						input.queues.includes(candidate.queue) &&
						new Date(candidate.availableAt) <= now,
				)
				.filter(
					(candidate) =>
						!candidate.concurrencyKey || concurrencyAvailable(tx, candidate),
				)
				.sort(
					(left, right) =>
						right.priority - left.priority ||
						left.createdAt.localeCompare(right.createdAt),
				)[0];
			if (!run) return undefined;

			const attempt: ExecutionAttempt = {
				id: this.ids.create("attempt"),
				runId: run.id,
				correlationId: run.correlationId,
				number: run.attemptCount + 1,
				status: "leased",
				workerId: input.workerId,
				fencingToken: tx.nextFencingToken(run.id),
				leaseExpiresAt: new Date(now.getTime() + input.leaseMs).toISOString(),
				startedAt: now.toISOString(),
				heartbeatAt: now.toISOString(),
			};
			const claimed = {
				...run,
				status: "running" as const,
				attemptCount: attempt.number,
				updatedAt: now.toISOString(),
			};
			tx.putRun(claimed);
			tx.putAttempt(attempt);
			return { run: claimed, attempt };
		});
	}

	async heartbeat(
		runId: string,
		attemptId: string,
		fencingToken: number,
		leaseMs: number,
	): Promise<ExecutionAttempt> {
		return this.updateAttempt(
			runId,
			attemptId,
			fencingToken,
			(run, attempt, now, tx) => {
				assertNotCancelling(run);
				const updated = {
					...attempt,
					status: "running" as const,
					heartbeatAt: now.toISOString(),
					leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
				};
				tx.putAttempt(updated);
				tx.putRun({ ...run, updatedAt: now.toISOString() });
				return updated;
			},
		);
	}

	async wait(
		runId: string,
		attemptId: string,
		fencingToken: number,
		waitpoint: ExecutionWaitpoint,
	): Promise<ExecutionRun> {
		return this.updateAttempt(
			runId,
			attemptId,
			fencingToken,
			(run, attempt, now, tx) => {
				assertNotCancelling(run);
				tx.putAttempt({
					...attempt,
					status: "waiting",
					completedAt: now.toISOString(),
				});
				const updated = {
					...run,
					status: "waiting" as const,
					waitpoint,
					resumedFrom: undefined,
					updatedAt: now.toISOString(),
				};
				tx.putRun(updated);
				return updated;
			},
		);
	}

	async resume(runId: string, waitpointKey: string): Promise<ExecutionRun> {
		return this.store.transaction((tx) => {
			const run = requireRun(tx, runId);
			if (run.status !== "waiting" || run.waitpoint?.key !== waitpointKey)
				throw new ExecutionError(
					"invalid_state",
					"Run is not waiting at this waitpoint.",
				);
			const now = this.clock.now().toISOString();
			const updated = {
				...run,
				status: "queued" as const,
				resumedFrom: { waitpoint: run.waitpoint, resumedAt: now },
				waitpoint: undefined,
				availableAt: now,
				updatedAt: now,
			};
			tx.putRun(updated);
			return updated;
		});
	}

	async complete(
		runId: string,
		attemptId: string,
		fencingToken: number,
		result: Readonly<Record<string, JsonValue>> = {},
	): Promise<ExecutionRun> {
		return this.updateAttempt(
			runId,
			attemptId,
			fencingToken,
			(run, attempt, now, tx) => {
				assertNotCancelling(run);
				tx.putAttempt({
					...attempt,
					status: "completed",
					completedAt: now.toISOString(),
				});
				const updated = {
					...run,
					status: "completed" as const,
					result,
					updatedAt: now.toISOString(),
				};
				tx.putRun(updated);
				return updated;
			},
		);
	}

	async fail(
		runId: string,
		attemptId: string,
		fencingToken: number,
		errorCode: string,
		retryable: boolean,
	): Promise<ExecutionRun> {
		return this.updateAttempt(
			runId,
			attemptId,
			fencingToken,
			(run, attempt, now, tx) => {
				assertNotCancelling(run);
				tx.putAttempt({
					...attempt,
					status: "failed",
					completedAt: now.toISOString(),
				});
				const retry =
					retryable &&
					run.attemptCount < run.maxAttempts &&
					!run.cancellationRequestedAt;
				const delayMs = retry
					? Math.min(60_000, 1_000 * 2 ** (run.attemptCount - 1))
					: 0;
				const updated: ExecutionRun = {
					...run,
					status: retry ? "queued" : "failed",
					availableAt: new Date(now.getTime() + delayMs).toISOString(),
					updatedAt: now.toISOString(),
					errorCode,
				};
				tx.putRun(updated);
				return updated;
			},
		);
	}

	async acknowledgeCancellation(
		runId: string,
		attemptId: string,
		fencingToken: number,
	): Promise<ExecutionRun> {
		return this.updateAttempt(
			runId,
			attemptId,
			fencingToken,
			(run, attempt, now, tx) => {
				if (run.status !== "cancelling") {
					throw new ExecutionError(
						"invalid_state",
						"Only a cancelling run can acknowledge cancellation.",
					);
				}
				tx.putAttempt({
					...attempt,
					status: "cancelled",
					completedAt: now.toISOString(),
				});
				const updated = {
					...run,
					status: "cancelled" as const,
					updatedAt: now.toISOString(),
				};
				tx.putRun(updated);
				return updated;
			},
		);
	}

	async cancel(runId: string): Promise<ExecutionRun> {
		return this.store.transaction((tx) => {
			const run = requireRun(tx, runId);
			if (
				run.status === "completed" ||
				run.status === "failed" ||
				run.status === "cancelled"
			)
				return run;
			const now = this.clock.now().toISOString();
			const immediate = run.status === "queued" || run.status === "waiting";
			const updated = {
				...run,
				status: immediate ? ("cancelled" as const) : ("cancelling" as const),
				cancellationRequestedAt: now,
				updatedAt: now,
			};
			tx.putRun(updated);
			return updated;
		});
	}

	async signal(
		runId: string,
		input: {
			readonly commandId: string;
			readonly type: "steer";
			readonly payload: Readonly<Record<string, JsonValue>>;
		},
	): Promise<import("./types.js").ExecutionSignal> {
		return this.store.transaction((tx) => {
			const run = requireRun(tx, runId);
			const existing = run.signals?.find(
				(signal) => signal.commandId === input.commandId,
			);
			if (existing) return existing;
			if (run.status !== "running")
				throw new ExecutionError(
					"invalid_state",
					"Execution signals require a running run.",
				);
			const signals = run.signals ?? [];
			const signal = {
				id: this.ids.create("signal"),
				ordinal: signals.length + 1,
				...input,
				createdAt: this.clock.now().toISOString(),
			};
			tx.putRun({
				...run,
				signals: [...signals, signal],
				updatedAt: signal.createdAt,
			});
			return signal;
		});
	}

	async retry(runId: string): Promise<ExecutionRun> {
		return this.store.transaction((tx) => {
			const run = requireRun(tx, runId);
			if (run.status !== "failed" && run.status !== "cancelled")
				throw new ExecutionError(
					"invalid_state",
					"Only failed or cancelled runs can be retried manually.",
				);
			const now = this.clock.now().toISOString();
			const updated = {
				...run,
				status: "queued" as const,
				availableAt: now,
				updatedAt: now,
				cancellationRequestedAt: undefined,
				errorCode: undefined,
				maxAttempts: Math.max(run.maxAttempts, run.attemptCount + 1),
			};
			tx.putRun(updated);
			return updated;
		});
	}

	private async updateAttempt<Result>(
		runId: string,
		attemptId: string,
		fencingToken: number,
		work: (
			run: ExecutionRun,
			attempt: ExecutionAttempt,
			now: Date,
			tx: ExecutionTransaction,
		) => Result,
	): Promise<Result> {
		return this.store.transaction((tx) => {
			const run = requireRun(tx, runId);
			const attempt = tx
				.listAttempts(runId)
				.find((candidate) => candidate.id === attemptId);
			if (!attempt)
				throw new ExecutionError(
					"not_found",
					`Attempt ${attemptId} was not found.`,
				);
			if (
				attempt.fencingToken !== fencingToken ||
				tx
					.listAttempts(runId)
					.some((candidate) => candidate.fencingToken > fencingToken)
			) {
				throw new ExecutionError(
					"stale_fence",
					"The attempt fencing token is stale.",
				);
			}
			return work(run, attempt, this.clock.now(), tx);
		});
	}
}

function assertNotCancelling(run: ExecutionRun): void {
	if (run.status === "cancelling") {
		throw new ExecutionError(
			"cancellation_requested",
			"Execution cancellation was requested.",
		);
	}
}

function expireLeases(tx: ExecutionTransaction, now: Date): void {
	for (const run of tx.listRuns()) {
		if (run.status !== "running" && run.status !== "cancelling") continue;
		const attempt = tx.listAttempts(run.id).at(-1);
		if (!attempt || new Date(attempt.leaseExpiresAt) > now) continue;
		tx.putAttempt({
			...attempt,
			status: "expired",
			completedAt: now.toISOString(),
		});
		const retry =
			run.attemptCount < run.maxAttempts && !run.cancellationRequestedAt;
		tx.putRun({
			...run,
			status: retry
				? "queued"
				: run.cancellationRequestedAt
					? "cancelled"
					: "failed",
			availableAt: now.toISOString(),
			updatedAt: now.toISOString(),
			...(retry ? {} : { errorCode: "lease_expired" }),
		});
	}
}

function concurrencyAvailable(
	tx: ExecutionTransaction,
	candidate: ExecutionRun,
): boolean {
	return !tx
		.listRuns()
		.some(
			(run) =>
				run.id !== candidate.id &&
				run.tenantId === candidate.tenantId &&
				run.concurrencyKey === candidate.concurrencyKey &&
				(run.status === "running" || run.status === "cancelling"),
		);
}

function requireRun(tx: ExecutionTransaction, runId: string): ExecutionRun {
	const run = tx.getRun(runId);
	if (!run)
		throw new ExecutionError("not_found", `Run ${runId} was not found.`);
	return run;
}
