import type {
	DromioJsonObject,
	DromioThreadEventType,
	DromioThreadEventV1,
	DromioThreadV1,
	DromioTurnV1,
} from "@dromio/protocols";
import {
	ThreadServiceError,
	threadNotFound,
	versionConflict,
} from "./errors.js";
import { correlation } from "./lineage.js";
import {
	type ThreadIdFactory,
	type ThreadPolicyPort,
	type ThreadServiceClock,
	type ThreadStore,
	type ThreadTransaction,
} from "./ports.js";
import type {
	StoredCommandReceipt,
	ThreadCommandContext,
	ThreadOutboxEntry,
	ThreadReceipt,
	ThreadScope,
	ThreadSnapshot,
	TransitionTurnInput,
} from "./types.js";
import { createThreadAccessPolicy } from "./access-policy.js";

export interface ThreadServiceOptions {
	readonly store: ThreadStore;
	readonly policy?: ThreadPolicyPort;
	readonly clock?: ThreadServiceClock;
	readonly ids?: ThreadIdFactory;
	readonly steeringSupported?: boolean;
}

export class ThreadServiceKernel {
	protected readonly store: ThreadStore;
	protected readonly policy: ThreadPolicyPort;
	protected readonly clock: ThreadServiceClock;
	protected readonly ids: ThreadIdFactory;

	constructor(options: ThreadServiceOptions) {
		this.store = options.store;
		this.policy = options.policy ?? createThreadAccessPolicy(options.store);
		this.clock = options.clock ?? { now: () => new Date().toISOString() };
		this.ids = options.ids ?? {
			create: (kind) => `${kind}_${crypto.randomUUID()}`,
		};
	}

	protected async snapshot(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<ThreadSnapshot> {
		const scope = scopeFrom(context);
		const thread = await this.requireThread(scope, threadId);
		await this.authorize("thread.read", context, scope, thread);
		const [items, turns, interactions] = await Promise.all([
			this.store.listItems(scope, threadId),
			this.store.listTurns(scope, threadId),
			this.store.listInteractions(scope, threadId),
		]);
		return {
			thread,
			items,
			turns,
			interactions,
			throughSequence: thread.lastSequence,
		};
	}

	protected async listAuthorizedTurns(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<readonly DromioTurnV1[]> {
		const scope = scopeFrom(context);
		const thread = await this.requireThread(scope, threadId);
		await this.authorize("thread.read", context, scope, thread);
		return this.store.listTurns(scope, threadId);
	}

	protected async getAuthorizedTurn(
		context: ThreadCommandContext,
		threadId: string,
		turnId: string,
	): Promise<DromioTurnV1> {
		const turn = (await this.listAuthorizedTurns(context, threadId)).find(
			(candidate) => candidate.id === turnId,
		);
		if (!turn) {
			throw new ThreadServiceError({
				code: "resource_not_found",
				message: `Turn ${turnId} was not found.`,
			});
		}
		return turn;
	}

	protected async appendEventAndAdvance(
		tx: ThreadTransaction,
		thread: DromioThreadV1,
		context: ThreadCommandContext,
		type: DromioThreadEventType,
		payload: DromioJsonObject,
	): Promise<DromioThreadV1> {
		const next = { ...thread, lastSequence: thread.lastSequence + 1 };
		await this.appendEvent(tx, next, context, type, payload);
		return next;
	}

	protected async appendEvent(
		tx: ThreadTransaction,
		thread: DromioThreadV1,
		context: ThreadCommandContext,
		type: DromioThreadEventType,
		payload: DromioJsonObject,
	): Promise<DromioThreadEventV1> {
		const event: DromioThreadEventV1 = {
			schemaVersion: "dromio.thread-event.v1",
			eventId: this.ids.create("event"),
			type,
			tenantId: thread.tenantId,
			applicationId: thread.applicationId,
			threadId: thread.id,
			sequence: thread.lastSequence,
			applicationSequence: await tx.nextApplicationSequence(thread),
			timestamp: this.clock.now(),
			correlationId: context.correlationId ?? context.commandId,
			requestId: context.requestId ?? context.commandId,
			commandId: context.commandId,
			payload,
		};
		await tx.appendEvent(event);
		await tx.appendOutbox(this.eventOutbox(event));
		return event;
	}

	protected async appendExecutionOutbox(
		tx: ThreadTransaction,
		scope: ThreadScope,
		thread: DromioThreadV1,
		turn: DromioTurnV1,
		now: string,
		context: ThreadCommandContext,
	): Promise<void> {
		await tx.appendOutbox({
			id: this.ids.create("outbox"),
			topic: "execution.commands",
			aggregateId: thread.id,
			payload: {
				schemaVersion: "dromio.execution-command.v1",
				...correlation(context),
				operation: "execute_thread_turn",
				...scope,
				threadId: thread.id,
				turnId: turn.id,
				turnOrdinal: turn.ordinal,
				...(turn.modelSelection
					? {
							modelSelection: {
								modelId: turn.modelSelection.modelId,
								providerId: turn.modelSelection.providerId,
								...(turn.modelSelection.reasoningEffort
									? { reasoningEffort: turn.modelSelection.reasoningEffort }
									: {}),
							},
						}
					: {}),
				generation: 1,
				createdAt: now,
			},
			createdAt: now,
			attempts: 0,
		});
	}

	protected async requireThread(
		scope: ThreadScope,
		threadId: string,
	): Promise<DromioThreadV1> {
		const thread = await this.store.getThread(scope, threadId);
		if (!thread) throw threadNotFound(threadId);
		return thread;
	}

	protected async authorize(
		action: Parameters<ThreadPolicyPort["authorize"]>[0]["action"],
		context: ThreadCommandContext,
		scope: ThreadScope,
		thread?: DromioThreadV1,
	): Promise<void> {
		await this.policy.authorize({
			action,
			actor: context.actor,
			scope,
			...(thread ? { thread } : {}),
		});
	}

	protected async canRead(
		context: ThreadCommandContext,
		scope: ThreadScope,
		thread: DromioThreadV1,
	): Promise<boolean> {
		try {
			await this.authorize("thread.read", context, scope, thread);
			return true;
		} catch (error) {
			if (
				error instanceof ThreadServiceError &&
				error.code === "permission_denied"
			) {
				return false;
			}
			throw error;
		}
	}

	private eventOutbox(event: DromioThreadEventV1): ThreadOutboxEntry {
		return {
			id: this.ids.create("outbox"),
			topic: "thread.events",
			aggregateId: event.threadId,
			payload: {
				eventId: event.eventId,
				type: event.type,
				tenantId: event.tenantId,
				applicationId: event.applicationId,
				threadId: event.threadId,
				sequence: event.sequence,
				applicationSequence: event.applicationSequence,
			},
			createdAt: event.timestamp,
			attempts: 0,
		};
	}
}

export function scopeFrom(context: ThreadCommandContext): ThreadScope {
	return {
		tenantId: context.actor.tenantId,
		applicationId: context.actor.applicationId,
	};
}

export async function requireTransactionThread(
	tx: ThreadTransaction,
	scope: ThreadScope,
	threadId: string,
): Promise<DromioThreadV1> {
	const thread = await tx.getThread(threadId);
	if (
		!thread ||
		thread.tenantId !== scope.tenantId ||
		thread.applicationId !== scope.applicationId
	) {
		throw threadNotFound(threadId);
	}
	return thread;
}

export function assertVersion(
	thread: DromioThreadV1,
	expected: number | undefined,
): void {
	if (expected !== undefined && thread.version !== expected) {
		throw versionConflict(expected, thread.version);
	}
}

export function isTerminal(status: DromioTurnV1["status"]): boolean {
	return ["completed", "failed", "cancelled"].includes(status);
}

export function allowedTransition(
	from: DromioTurnV1["status"],
	to: TransitionTurnInput["status"],
): boolean {
	const allowed: Readonly<
		Record<DromioTurnV1["status"], readonly TransitionTurnInput["status"][]>
	> = {
		queued: ["cancelled"],
		eligible: ["running", "failed", "cancelling", "cancelled"],
		running: [
			"running",
			"waiting_for_approval",
			"waiting_for_input",
			"completed",
			"failed",
			"cancelling",
			"cancelled",
		],
		waiting_for_approval: ["running", "cancelling", "cancelled"],
		waiting_for_input: ["running", "cancelling", "cancelled"],
		cancelling: ["cancelled", "failed"],
		completed: [],
		failed: [],
		cancelled: [],
	};
	return allowed[from].includes(to);
}

export function eventForTurnStatus(
	status: TransitionTurnInput["status"],
): DromioThreadEventType {
	if (status === "running") return "turn.started";
	if (status === "waiting_for_approval") return "turn.waiting_for_approval";
	if (status === "waiting_for_input") return "turn.waiting_for_input";
	if (status === "completed") return "turn.completed";
	if (status === "failed") return "turn.failed";
	if (status === "cancelling") return "turn.cancelling";
	return "turn.cancelled";
}

export function commandDigest(name: string, input: object): string {
	return JSON.stringify([name, input]);
}

export async function replayReceipt<Resource>(
	tx: ThreadTransaction,
	scope: ThreadScope,
	context: ThreadCommandContext,
	commandName: string,
	inputDigest: string,
): Promise<ThreadReceipt<Resource> | undefined> {
	if (!context.idempotencyKey) return undefined;
	const stored = await tx.getReceipt(scope, context.idempotencyKey);
	if (!stored) return undefined;
	if (
		stored.commandName !== commandName ||
		stored.inputDigest !== inputDigest
	) {
		throw new ThreadServiceError({
			code: "idempotency_conflict",
			message: "The idempotency key was already used with a different command.",
		});
	}
	return { ...stored.receipt, replayed: true } as ThreadReceipt<Resource>;
}

export async function persistReceipt(
	tx: ThreadTransaction,
	scope: ThreadScope,
	context: ThreadCommandContext,
	commandName: string,
	inputDigest: string,
	receipt: StoredCommandReceipt["receipt"],
): Promise<void> {
	if (!context.idempotencyKey) return;
	await tx.putReceipt({
		scope,
		idempotencyKey: context.idempotencyKey,
		commandName,
		inputDigest,
		receipt,
	});
}

export function makeReceipt<Resource>(
	commandId: string,
	resource: Resource,
	sequence: {
		readonly applicationSequence?: number;
		readonly sequence: number;
	},
	replayed: boolean,
): ThreadReceipt<Resource> {
	return {
		schemaVersion: "dromio.command-receipt.v1",
		commandId,
		resource,
		...(sequence.applicationSequence
			? { applicationSequence: sequence.applicationSequence }
			: {}),
		threadSequence: sequence.sequence,
		replayed,
	};
}
