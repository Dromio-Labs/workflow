export type ExecutionRunStatus =
	| "queued"
	| "running"
	| "waiting"
	| "cancelling"
	| "completed"
	| "failed"
	| "cancelled";
export type ExecutionAttemptStatus =
	| "leased"
	| "running"
	| "waiting"
	| "completed"
	| "failed"
	| "cancelled"
	| "expired";

export interface ExecutionRun {
	readonly id: string;
	readonly tenantId: string;
	readonly applicationId: string;
	readonly sourceType: "thread_turn" | "workflow" | "task";
	readonly sourceId: string;
	readonly idempotencyKey: string;
	readonly correlationId: string;
	readonly requestId: string;
	readonly commandId: string;
	readonly queue: string;
	readonly priority: number;
	readonly status: ExecutionRunStatus;
	readonly maxAttempts: number;
	readonly attemptCount: number;
	readonly availableAt: string;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly concurrencyKey?: string;
	readonly waitpoint?: ExecutionWaitpoint;
	readonly resumedFrom?: ExecutionResumePoint;
	readonly cancellationRequestedAt?: string;
	readonly result?: Readonly<Record<string, JsonValue>>;
	readonly errorCode?: string;
	readonly payload?: Readonly<Record<string, JsonValue>>;
	readonly signals?: readonly ExecutionSignal[];
}

export interface ExecutionSignal {
	readonly id: string;
	readonly ordinal: number;
	readonly type: "steer";
	readonly commandId: string;
	readonly payload: Readonly<Record<string, JsonValue>>;
	readonly createdAt: string;
}

export interface ExecutionAttempt {
	readonly id: string;
	readonly runId: string;
	readonly correlationId: string;
	readonly number: number;
	readonly status: ExecutionAttemptStatus;
	readonly workerId: string;
	readonly fencingToken: number;
	readonly leaseExpiresAt: string;
	readonly startedAt: string;
	readonly heartbeatAt: string;
	readonly completedAt?: string;
}

export interface ExecutionWaitpoint {
	readonly type: "approval" | "input" | "timer" | "external_event";
	readonly key: string;
	readonly resumeAfter?: string;
	readonly continuationToken?: string;
}

export interface ExecutionResumePoint {
	readonly waitpoint: ExecutionWaitpoint;
	readonly resumedAt: string;
}

export interface EnqueueRunInput {
	readonly tenantId: string;
	readonly applicationId: string;
	readonly sourceType: ExecutionRun["sourceType"];
	readonly sourceId: string;
	readonly idempotencyKey: string;
	readonly correlationId: string;
	readonly requestId: string;
	readonly commandId: string;
	readonly queue?: string;
	readonly priority?: number;
	readonly maxAttempts?: number;
	readonly concurrencyKey?: string;
	readonly payload?: Readonly<Record<string, JsonValue>>;
}

export interface ClaimedExecution {
	readonly run: ExecutionRun;
	readonly attempt: ExecutionAttempt;
}

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

export interface ExecutionStore {
	transaction<Result>(
		work: (transaction: ExecutionTransaction) => Result,
	): Promise<Result>;
	listRuns(): Promise<readonly ExecutionRun[]>;
	listAttempts(runId: string): Promise<readonly ExecutionAttempt[]>;
	purgeThread(threadId: string): Promise<number>;
}

export interface ExecutionTransaction {
	getRun(id: string): ExecutionRun | undefined;
	findByIdempotency(
		tenantId: string,
		applicationId: string,
		key: string,
	): ExecutionRun | undefined;
	listRuns(): readonly ExecutionRun[];
	putRun(run: ExecutionRun): void;
	listAttempts(runId: string): readonly ExecutionAttempt[];
	putAttempt(attempt: ExecutionAttempt): void;
	nextFencingToken(runId: string): number;
}

export interface ExecutionClock {
	now(): Date;
}
export interface ExecutionIdFactory {
	create(kind: "run" | "attempt" | "signal"): string;
}
